// PREMIUM MAPS — Auth · Friends · Voice · Screen
const GOOGLE_CLIENT_ID = "213167991809-5e4dq56drdap064jmvdd7ptqqt42erie.apps.googleusercontent.com";

let map, markers = [], dropMode = false, markerId = 0;
let placesService, autocompleteService;
let myLocationMarker = null, accuracyCircle = null;
let currentUser = null;
let peer = null, myPeerId = null, roomPeers = {}, friendMarkers = {};
let localStream = null, screenStream = null, currentCall = null, screenCall = null;
let watchId = null, currentRoom = null;

const $ = (s) => document.querySelector(s);
const welcome = $("#welcome");
const searchInput = $("#searchInput");
const searchResults = $("#searchResults");
const markersList = $("#markersList");
const statusCoords = $("#statusCoords");
const statusZoom = $("#statusZoom");
const toastEl = $("#toast");
const layersPanel = $("#layersPanel");
const sidebar = $("#sidebar");
const userChip = $("#userChip");
const friendsList = $("#friendsList");
const callBar = $("#callBar");
const roomStatus = $("#roomStatus");
const remoteAudio = $("#remoteAudio");
const remoteScreen = $("#remoteScreen");
const screenShareBox = $("#screenShareBox");

function getAccounts() {
  try { return JSON.parse(localStorage.getItem("maps_accounts") || "{}"); } catch (e) { return {}; }
}
function saveAccounts(a) { localStorage.setItem("maps_accounts", JSON.stringify(a)); }

async function hashPass(p) {
  const data = new TextEncoder().encode(p + "maps_salt_v1");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2400);
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}
function closeWelcome() {
  if (welcome) welcome.classList.add("hidden");
  try { localStorage.setItem("maps_welcome_done", "1"); } catch (e) {}
}

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    tab.classList.add("active");
    const form = tab.dataset.tab === "login" ? $("#formLogin") : $("#formRegister");
    if (form) form.classList.add("active");
  });
});

if ($("#formLogin")) $("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const pass = $("#loginPass").value;
  const accounts = getAccounts();
  const acc = accounts[email];
  if (!acc) return toast("No account with that email");
  const h = await hashPass(pass);
  if (h !== acc.pass) return toast("Wrong password");
  setUser({ name: acc.name, email: email, picture: null, sub: "email:" + email });
  closeWelcome();
  requestLocation(true);
  toast("Logged in as " + acc.name);
});

if ($("#formRegister")) $("#formRegister").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#regName").value.trim();
  const email = $("#regEmail").value.trim().toLowerCase();
  const pass = $("#regPass").value;
  if (pass.length < 4) return toast("Password too short");
  const accounts = getAccounts();
  if (accounts[email]) return toast("Email already registered");
  accounts[email] = { name: name, pass: await hashPass(pass) };
  saveAccounts(accounts);
  setUser({ name: name, email: email, picture: null, sub: "email:" + email });
  closeWelcome();
  requestLocation(true);
  toast("Account created");
});

if ($("#btnAllowLocation")) $("#btnAllowLocation").addEventListener("click", () => { closeWelcome(); requestLocation(true); });
if ($("#btnSkip")) $("#btnSkip").addEventListener("click", () => {
  closeWelcome();
  setUser({ name: "Guest", email: "guest@local", picture: null, sub: "guest" });
  toast("Continuing as guest");
});
if ($("#btnGoogleLogin")) $("#btnGoogleLogin").addEventListener("click", () => {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    google.accounts.id.prompt();
  } else toast("Google Sign-In still loading");
});

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || !window.google || !window.google.accounts || !window.google.accounts.id) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: function (response) {
      try {
        const payload = JSON.parse(atob(response.credential.split(".")[1]));
        setUser({ name: payload.name, email: payload.email, picture: payload.picture, sub: payload.sub });
        closeWelcome();
        requestLocation(true);
        toast("Welcome, " + (payload.given_name || payload.name));
      } catch (e) { toast("Google sign-in failed"); }
    },
    auto_select: false
  });
}

function setUser(user) {
  currentUser = user;
  try { localStorage.setItem("maps_user", JSON.stringify(user)); } catch (e) {}
  if (userChip) userChip.classList.add("visible");
  if ($("#userName")) $("#userName").textContent = user.name;
  if ($("#userEmail")) $("#userEmail").textContent = user.email;
  const av = $("#userAvatar");
  if (av) {
    if (user.picture) av.innerHTML = '<img src="' + user.picture + '" alt="" referrerpolicy="no-referrer" />';
    else av.textContent = (user.name || "?").charAt(0).toUpperCase();
  }
  initPeer();
}

function loadUser() {
  try {
    const raw = localStorage.getItem("maps_user");
    if (raw) setUser(JSON.parse(raw));
  } catch (e) {}
}

function requestLocation(centerMap) {
  if (centerMap === undefined) centerMap = false;
  if (!navigator.geolocation) return toast("Geolocation not supported");
  toast("Getting your location");
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      const lat = pos.coords.latitude, lng = pos.coords.longitude, accuracy = pos.coords.accuracy;
      showMyLocation(lat, lng, accuracy, centerMap);
      startLocationWatch();
      toast("Location found");
    },
    function (err) {
      if (err.code === 1) toast("Location permission denied");
      else toast("Could not get location");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
  );
}

function startLocationWatch() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    function (pos) {
      showMyLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false);
      broadcastLocation(pos.coords.latitude, pos.coords.longitude);
    },
    function () {},
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function showMyLocation(lat, lng, accuracy, center) {
  if (accuracy === undefined) accuracy = 50;
  if (center === undefined) center = true;
  if (!map || !window.google || !google.maps) return;
  if (myLocationMarker) myLocationMarker.setMap(null);
  if (accuracyCircle) accuracyCircle.setMap(null);
  myLocationMarker = new google.maps.Marker({
    position: { lat: lat, lng: lng }, map: map, title: "You are here", zIndex: 999,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#4285F4", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 }
  });
  accuracyCircle = new google.maps.Circle({
    map: map, center: { lat: lat, lng: lng }, radius: Math.min(accuracy, 250),
    fillColor: "#4285F4", fillOpacity: 0.12, strokeColor: "#4285F4", strokeOpacity: 0.3, strokeWeight: 1
  });
  markers = markers.filter(function (m) { return !m.isMe; });
  markerId += 1;
  const info = new google.maps.InfoWindow({
    content: "<div style=\"font-family:Inter,sans-serif;padding:3px\"><strong>You are here</strong><br><span style=\"color:#5f6368;font-size:12px\">" + lat.toFixed(5) + ", " + lng.toFixed(5) + "</span></div>"
  });
  myLocationMarker.addListener("click", function () { info.open(map, myLocationMarker); });
  markers.unshift({ id: markerId, lat: lat, lng: lng, title: "You are here", marker: myLocationMarker, info: info, isMe: true });
  renderMarkersList();
  if (center) { map.panTo({ lat: lat, lng: lng }); if (map.getZoom() < 15) map.setZoom(16); }
}

function initPeer() {
  if (typeof Peer === "undefined") { setTimeout(initPeer, 500); return; }
  if (peer) return;
  peer = new Peer(undefined, { debug: 0 });
  peer.on("open", function (id) { myPeerId = id; });
  peer.on("connection", function (conn) { setupDataConn(conn); });
  peer.on("call", function (call) {
    const meta = call.metadata || {};
    if (meta.type === "screen") {
      call.answer();
      call.on("stream", function (stream) {
        if (remoteScreen) remoteScreen.srcObject = stream;
        if (screenShareBox) screenShareBox.classList.add("visible");
        toast("Friend is sharing screen");
      });
      screenCall = call;
    } else {
      call.answer(localStream || undefined);
      call.on("stream", function (stream) {
        if (remoteAudio) remoteAudio.srcObject = stream;
        if ($("#btnVoice")) $("#btnVoice").classList.add("on");
        if (callBar) callBar.classList.add("visible");
        toast("Voice connected");
      });
      currentCall = call;
    }
  });
  peer.on("error", function (err) {
    console.warn("Peer error", err);
  });
}

if ($("#btnCreateRoom")) $("#btnCreateRoom").addEventListener("click", function () {
  if (!peer || !myPeerId) { initPeer(); return toast("Connecting, try again"); }
  currentRoom = myPeerId;
  if ($("#roomCode")) $("#roomCode").value = myPeerId;
  setRoomLive(true, "Hosting room — share this code");
  if (callBar) callBar.classList.add("visible");
  toast("Room created");
});

if ($("#btnJoinRoom")) $("#btnJoinRoom").addEventListener("click", function () {
  const code = ($("#roomCode") && $("#roomCode").value.trim()) || "";
  if (!code) return toast("Enter a room code");
  if (!peer || !myPeerId) { initPeer(); return toast("Connecting, try again"); }
  if (code === myPeerId) return toast("That is your own code");
  currentRoom = code;
  const conn = peer.connect(code, { reliable: true, metadata: { name: (currentUser && currentUser.name) || "Friend" } });
  setupDataConn(conn);
  setRoomLive(true, "Joining room");
  if (callBar) callBar.classList.add("visible");
});

if ($("#btnCopyRoom")) $("#btnCopyRoom").addEventListener("click", function () {
  const code = (($("#roomCode") && $("#roomCode").value.trim()) || myPeerId) || "";
  if (!code) return toast("Create or join a room first");
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast("Room code copied"); }).catch(function () { toast(code); });
  else toast(code);
});

function setRoomLive(live, text) {
  if (!roomStatus) return;
  roomStatus.classList.toggle("live", live);
  roomStatus.innerHTML = '<span class="dot"></span> ' + text;
}

function setupDataConn(conn) {
  conn.on("open", function () {
    roomPeers[conn.peer] = conn;
    const name = (conn.metadata && conn.metadata.name) || "Friend";
    addFriendUI(conn.peer, name, true);
    setRoomLive(true, "Connected · live sharing");
    toast("Connected to " + name);
    conn.send({ type: "hello", name: (currentUser && currentUser.name) || "Friend" });
    if (myLocationMarker) {
      const p = myLocationMarker.getPosition();
      conn.send({ type: "loc", lat: p.lat(), lng: p.lng(), name: (currentUser && currentUser.name) || "Friend" });
    }
  });
  conn.on("data", function (data) {
    if (!data || !data.type) return;
    if (data.type === "hello") addFriendUI(conn.peer, data.name || "Friend", true);
    if (data.type === "loc") updateFriendMarker(conn.peer, data.lat, data.lng, data.name || "Friend");
  });
  conn.on("close", function () {
    delete roomPeers[conn.peer];
    addFriendUI(conn.peer, "Friend", false);
    if (friendMarkers[conn.peer]) { friendMarkers[conn.peer].setMap(null); delete friendMarkers[conn.peer]; }
    if (Object.keys(roomPeers).length === 0) setRoomLive(false, "Not in a room");
  });
}

function broadcastLocation(lat, lng) {
  const payload = { type: "loc", lat: lat, lng: lng, name: (currentUser && currentUser.name) || "Friend" };
  Object.keys(roomPeers).forEach(function (k) {
    const c = roomPeers[k];
    if (c && c.open) c.send(payload);
  });
}

function addFriendUI(peerId, name, online) {
  if (!friendsList) return;
  let el = friendsList.querySelector('[data-peer="' + peerId + '"]');
  if (!el) {
    el = document.createElement("div");
    el.className = "friend-card";
    el.setAttribute("data-peer", peerId);
    friendsList.appendChild(el);
  }
  el.innerHTML = '<div class="friend-avatar ' + (online ? "online" : "") + '">' + (name || "?").charAt(0).toUpperCase() + '</div><div class="friend-info"><div class="fname">' + escapeHtml(name) + '</div><div class="fmeta">' + (online ? "Online · sharing location" : "Offline") + '</div></div>';
}

function updateFriendMarker(peerId, lat, lng, name) {
  if (!map || !window.google) return;
  if (friendMarkers[peerId]) {
    friendMarkers[peerId].setPosition({ lat: lat, lng: lng });
  } else {
    const m = new google.maps.Marker({
      position: { lat: lat, lng: lng }, map: map, title: name, zIndex: 900,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#f9ab00", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 }
    });
    friendMarkers[peerId] = m;
  }
  let fm = markers.find(function (x) { return x.friendId === peerId; });
  if (!fm) {
    markerId += 1;
    markers.push({ id: markerId, lat: lat, lng: lng, title: name + " (live)", marker: friendMarkers[peerId], info: null, isMe: false, friendId: peerId });
  } else { fm.lat = lat; fm.lng = lng; }
  renderMarkersList();
  addFriendUI(peerId, name, true);
}

if ($("#btnVoice")) $("#btnVoice").addEventListener("click", async function () {
  const peers = Object.keys(roomPeers);
  if (!peers.length) return toast("Join or create a room first");
  try {
    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    currentCall = peer.call(peers[0], localStream, { metadata: { type: "voice" } });
    currentCall.on("stream", function (stream) { if (remoteAudio) remoteAudio.srcObject = stream; toast("Voice connected"); });
    $("#btnVoice").classList.add("on");
    toast("Calling");
  } catch (e) { toast("Microphone permission denied"); }
});

if ($("#btnScreen")) $("#btnScreen").addEventListener("click", async function () {
  const peers = Object.keys(roomPeers);
  if (!peers.length) return toast("Join or create a room first");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false
    });
    screenCall = peer.call(peers[0], screenStream, { metadata: { type: "screen" } });
    $("#btnScreen").classList.add("on");
    toast("Sharing screen 1080p");
    screenStream.getVideoTracks()[0].onended = function () { stopScreen(); };
  } catch (e) { toast("Screen share cancelled"); }
});

function stopScreen() {
  if (screenStream) { screenStream.getTracks().forEach(function (t) { t.stop(); }); screenStream = null; }
  if (screenCall) { try { screenCall.close(); } catch (e) {} screenCall = null; }
  if ($("#btnScreen")) $("#btnScreen").classList.remove("on");
  if (screenShareBox) screenShareBox.classList.remove("visible");
  if (remoteScreen) remoteScreen.srcObject = null;
}

if ($("#btnHangup")) $("#btnHangup").addEventListener("click", function () {
  if (currentCall) { try { currentCall.close(); } catch (e) {} currentCall = null; }
  stopScreen();
  if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
  if (remoteAudio) remoteAudio.srcObject = null;
  if ($("#btnVoice")) $("#btnVoice").classList.remove("on");
  toast("Call ended");
});

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 37.7749, lng: -122.4194 },
    zoom: 13,
    mapTypeId: "satellite",
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
    gestureHandling: "greedy"
  });
  placesService = new google.maps.places.PlacesService(map);
  autocompleteService = new google.maps.places.AutocompleteService();

  map.addListener("mousemove", function (e) {
    if (e.latLng && statusCoords) statusCoords.textContent = e.latLng.lat().toFixed(5) + ", " + e.latLng.lng().toFixed(5);
  });
  map.addListener("zoom_changed", updateStatus);
  map.addListener("center_changed", updateStatus);
  map.addListener("click", function (e) {
    if (dropMode && e.latLng) {
      addMarker(e.latLng.lat(), e.latLng.lng(), "Dropped Pin");
      dropMode = false;
      if ($("#btnDropPin")) $("#btnDropPin").classList.remove("active");
      toast("Pin dropped");
    }
  });
  map.addListener("dblclick", function (e) {
    if (e.latLng) addMarker(e.latLng.lat(), e.latLng.lng(), "Quick Pin");
  });

  updateStatus();
  loadUser();
  loadSavedMarkers();
  setTimeout(initGoogleSignIn, 400);
  setTimeout(initPeer, 600);

  if (localStorage.getItem("maps_welcome_done") === "1") {
    closeWelcome();
    if (!myLocationMarker) setTimeout(function () { requestLocation(true); }, 700);
  }
}
window.initMap = initMap;

function updateStatus() {
  if (!map) return;
  const c = map.getCenter();
  if (statusCoords) statusCoords.textContent = c.lat().toFixed(5) + ", " + c.lng().toFixed(5);
  if (statusZoom) statusZoom.textContent = "Zoom " + map.getZoom();
}

function addMarker(lat, lng, title, fly) {
  if (title === undefined) title = "Place";
  if (fly === undefined) fly = true;
  markerId += 1;
  const id = markerId;
  const marker = new google.maps.Marker({
    position: { lat: lat, lng: lng }, map: map, title: title,
    label: { text: String(id), color: "white", fontWeight: "700", fontSize: "11px" },
    animation: google.maps.Animation.DROP, draggable: true
  });
  const info = new google.maps.InfoWindow({
    content: "<div style=\"font-family:Inter,sans-serif;padding:3px\"><strong>" + escapeHtml(title) + "</strong><br><span style=\"color:#5f6368;font-size:12px\">" + lat.toFixed(5) + ", " + lng.toFixed(5) + "</span></div>"
  });
  marker.addListener("click", function () { info.open(map, marker); });
  marker.addListener("dragend", function () {
    const pos = marker.getPosition();
    const m = markers.find(function (x) { return x.id === id; });
    if (m) { m.lat = pos.lat(); m.lng = pos.lng(); renderMarkersList(); persistMarkers(); }
  });
  markers.push({ id: id, lat: lat, lng: lng, title: title, marker: marker, info: info, isMe: false });
  renderMarkersList();
  persistMarkers();
  if (fly) { map.panTo({ lat: lat, lng: lng }); if (map.getZoom() < 15) map.setZoom(15); }
  return id;
}

function removeMarker(id) {
  const idx = markers.findIndex(function (m) { return m.id === id; });
  if (idx === -1) return;
  markers[idx].marker.setMap(null);
  if (markers[idx].isMe) {
    myLocationMarker = null;
    if (accuracyCircle) { accuracyCircle.setMap(null); accuracyCircle = null; }
  }
  markers.splice(idx, 1);
  renderMarkersList();
  persistMarkers();
}

function clearAllMarkers() {
  markers.forEach(function (m) { if (!m.friendId) m.marker.setMap(null); });
  markers = markers.filter(function (m) { return m.friendId; });
  myLocationMarker = null;
  if (accuracyCircle) { accuracyCircle.setMap(null); accuracyCircle = null; }
  renderMarkersList();
  persistMarkers();
  toast("Places cleared");
}

function renderMarkersList() {
  if (!markersList) return;
  if (!markers.length) {
    markersList.innerHTML = '<div class="empty-state">Search or drop a pin</div>';
    return;
  }
  markersList.innerHTML = markers.map(function (m) {
    return '<div class="marker-card" data-id="' + m.id + '"><div class="marker-pin ' + (m.isMe ? "me" : "") + (m.friendId ? " friend" : "") + '">' + (m.isMe ? "•" : (m.friendId ? (m.title || "F").charAt(0) : m.id)) + '</div><div class="marker-info"><div class="title">' + escapeHtml(m.title) + '</div><div class="coords">' + m.lat.toFixed(5) + ", " + m.lng.toFixed(5) + '</div></div>' + (m.friendId ? "" : '<button class="marker-remove" data-remove="' + m.id + '" type="button">×</button>') + '</div>';
  }).join("");
  markersList.querySelectorAll(".marker-card").forEach(function (card) {
    card.addEventListener("click", function (e) {
      if (e.target.closest("[data-remove]")) return;
      const m = markers.find(function (x) { return x.id === +card.getAttribute("data-id"); });
      if (m) { map.panTo({ lat: m.lat, lng: m.lng }); map.setZoom(16); if (m.info) m.info.open(map, m.marker); }
    });
  });
  markersList.querySelectorAll("[data-remove]").forEach(function (btn) {
    btn.addEventListener("click", function (e) { e.stopPropagation(); removeMarker(+btn.getAttribute("data-remove")); });
  });
}

function persistMarkers() {
  const data = markers.filter(function (m) { return !m.isMe && !m.friendId; }).map(function (m) {
    return { id: m.id, lat: m.lat, lng: m.lng, title: m.title };
  });
  try {
    localStorage.setItem("maps_markers", JSON.stringify(data));
    localStorage.setItem("maps_marker_id", String(markerId));
  } catch (e) {}
}

function loadSavedMarkers() {
  try {
    const savedId = localStorage.getItem("maps_marker_id");
    if (savedId) markerId = parseInt(savedId, 10) || 0;
    const raw = localStorage.getItem("maps_markers");
    if (!raw) return;
    JSON.parse(raw).forEach(function (m) {
      const marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng }, map: map, title: m.title,
        label: { text: String(m.id), color: "white", fontWeight: "700", fontSize: "11px" },
        draggable: true
      });
      const info = new google.maps.InfoWindow({
        content: "<div style=\"font-family:Inter,sans-serif;padding:3px\"><strong>" + escapeHtml(m.title) + "</strong></div>"
      });
      marker.addListener("click", function () { info.open(map, marker); });
      markers.push({ id: m.id, lat: m.lat, lng: m.lng, title: m.title, marker: marker, info: info, isMe: false });
    });
    renderMarkersList();
  } catch (e) {}
}

let searchTimeout = null;
function searchPlaces(query) {
  if (!query || query.length < 2) { if (searchResults) searchResults.classList.remove("open"); return; }
  if (!autocompleteService) return;
  autocompleteService.getPlacePredictions(
    { input: query, types: ["geocode", "establishment"] },
    function (predictions, status) {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
        if (searchResults) {
          searchResults.innerHTML = '<div class="result-item"><div class="name">No results</div></div>';
          searchResults.classList.add("open");
        }
        return;
      }
      searchResults.innerHTML = predictions.slice(0, 6).map(function (p) {
        return '<div class="result-item" data-place-id="' + p.place_id + '" data-name="' + escapeHtml(p.structured_formatting.main_text) + '"><div class="name">' + escapeHtml(p.structured_formatting.main_text) + '</div><div class="addr">' + escapeHtml(p.description) + '</div></div>';
      }).join("");
      searchResults.classList.add("open");
      searchResults.querySelectorAll(".result-item").forEach(function (el) {
        el.addEventListener("click", function () {
          placesService.getDetails(
            { placeId: el.getAttribute("data-place-id"), fields: ["geometry", "name"] },
            function (place, st) {
              if (st === google.maps.places.PlacesServiceStatus.OK && place.geometry) {
                addMarker(place.geometry.location.lat(), place.geometry.location.lng(), place.name || el.getAttribute("data-name"));
                searchResults.classList.remove("open");
                if (searchInput) searchInput.value = place.name || el.getAttribute("data-name");
              }
            }
          );
        });
      });
    }
  );
}

function copyCenter() {
  if (!map) return;
  const c = map.getCenter();
  const text = c.lat().toFixed(6) + ", " + c.lng().toFixed(6);
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Coordinates copied"); }).catch(function () { toast(text); });
  else toast(text);
}
function setMapType(type) {
  if (!map) return;
  map.setMapTypeId(type);
  document.querySelectorAll(".layer-option").forEach(function (el) {
    el.classList.toggle("active", el.getAttribute("data-layer") === type);
  });
}

if (searchInput) {
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () { searchPlaces(searchInput.value.trim()); }, 280);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); searchPlaces(searchInput.value.trim()); }
    if (e.key === "Escape" && searchResults) searchResults.classList.remove("open");
  });
}
if ($("#searchBtn")) $("#searchBtn").addEventListener("click", function () { searchPlaces(searchInput.value.trim()); });
document.addEventListener("click", function (e) {
  if (!e.target.closest(".search-box") && searchResults) searchResults.classList.remove("open");
});
if ($("#btnLocate")) $("#btnLocate").addEventListener("click", function () { requestLocation(true); });
if ($("#btnDropPin")) $("#btnDropPin").addEventListener("click", function () {
  dropMode = !dropMode;
  $("#btnDropPin").classList.toggle("active", dropMode);
  toast(dropMode ? "Click map to drop pin" : "Drop mode off");
});
if ($("#btnClear")) $("#btnClear").addEventListener("click", clearAllMarkers);
if ($("#btnCopy")) $("#btnCopy").addEventListener("click", copyCenter);
if ($("#btnLayers")) $("#btnLayers").addEventListener("click", function (e) {
  e.stopPropagation();
  if (layersPanel) layersPanel.classList.toggle("open");
});
document.addEventListener("click", function (e) {
  if (!e.target.closest("#layersPanel") && !e.target.closest("#btnLayers") && layersPanel) layersPanel.classList.remove("open");
});
document.querySelectorAll(".layer-option").forEach(function (el) {
  el.addEventListener("click", function () {
    setMapType(el.getAttribute("data-layer"));
    if (layersPanel) layersPanel.classList.remove("open");
  });
});
if ($("#btnFullscreen")) $("#btnFullscreen").addEventListener("click", function () {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
});
if ($("#mobileToggle")) $("#mobileToggle").addEventListener("click", function () {
  if (sidebar) sidebar.classList.toggle("open");
});
var mapEl = document.getElementById("map");
if (mapEl) mapEl.addEventListener("click", function () {
  if (window.innerWidth <= 800 && sidebar) sidebar.classList.remove("open");
});
