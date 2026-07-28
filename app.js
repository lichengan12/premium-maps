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
  try { return JSON.parse(localStorage.getItem("maps_accounts") || "{}"); } catch { return {}; }
}
function saveAccounts(a) { localStorage.setItem("maps_accounts", JSON.stringify(a)); }

async function hashPass(p) {
  const data = new TextEncoder().encode(p + "maps_salt_v1");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    tab.classList.add("active");
    const form = tab.dataset.tab === "login" ? $("#formLogin") : $("#formRegister");
    form.classList.add("active");
  });
});

$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const pass = $("#loginPass").value;
  const accounts = getAccounts();
  const acc = accounts[email];
  if (!acc) return toast("No account with that email");
  const h = await hashPass(pass);
  if (h !== acc.pass) return toast("Wrong password");
  setUser({ name: acc.name, email, picture: null, sub: "email:" + email });
  closeWelcome();
  requestLocation(true);
  toast("Logged in as " + acc.name);
});

$("#formRegister").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#regName").value.trim();
  const email = $("#regEmail").value.trim().toLowerCase();
  const pass = $("#regPass").value;
  if (pass.length < 4) return toast("Password too short");
  const accounts = getAccounts();
  if (accounts[email]) return toast("Email already registered — log in");
  accounts[email] = { name, pass: await hashPass(pass) };
  saveAccounts(accounts);
  setUser({ name, email, picture: null, sub: "email:" + email });
  closeWelcome();
  requestLocation(true);
  toast("Account created — welcome, " + name);
});

$("#btnAllowLocation").addEventListener("click", () => { closeWelcome(); requestLocation(true); });
$("#btnSkip").addEventListener("click", () => {
  closeWelcome();
  setUser({ name: "Guest", email: "guest@local", picture: null, sub: "guest" });
  toast("Continuing as guest");
});

$("#btnGoogleLogin").addEventListener("click", () => {
  if (window.google?.accounts?.id) {
    google.accounts.id.prompt((n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) toast("Google prompt unavailable — check Client ID origins");
    });
  } else toast("Google Sign-In still loading…");
});

function closeWelcome() {
  welcome.classList.add("hidden");
  localStorage.setItem("maps_welcome_done", "1");
}

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      try {
        const payload = JSON.parse(atob(response.credential.split(".")[1]));
        setUser({ name: payload.name, email: payload.email, picture: payload.picture, sub: payload.sub });
        closeWelcome();
        requestLocation(true);
        toast("Welcome, " + (payload.given_name || payload.name));
      } catch { toast("Google sign-in failed"); }
    },
    auto_select: false
  });
}

function setUser(user) {
  currentUser = user;
  localStorage.setItem("maps_user", JSON.stringify(user));
  userChip.classList.add("visible");
  $("#userName").textContent = user.name;
  $("#userEmail").textContent = user.email;
  const av = $("#userAvatar");
  if (user.picture) av.innerHTML = `<img src="${user.picture}" alt="" referrerpolicy="no-referrer" />`;
  else av.textContent = (user.name || "?").charAt(0).toUpperCase();
  initPeer();
}

function loadUser() {
  try {
    const raw = localStorage.getItem("maps_user");
    if (raw) setUser(JSON.parse(raw));
  } catch {}
}

function requestLocation(centerMap = false) {
  if (!navigator.geolocation) return toast("Geolocation not supported");
  toast("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      showMyLocation(latitude, longitude, accuracy, centerMap);
      startLocationWatch();
      toast("Location found");
    },
    (err) => {
      if (err.code === 1) toast("Location permission denied");
      else toast("Could not get location");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
  );
}

function startLocationWatch() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      showMyLocation(latitude, longitude, accuracy, false);
      broadcastLocation(latitude, longitude);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function showMyLocation(lat, lng, accuracy = 50, center = true) {
  if (!map) return;
  if (myLocationMarker) myLocationMarker.setMap(null);
  if (accuracyCircle) accuracyCircle.setMap(null);
  myLocationMarker = new google.maps.Marker({
    position: { lat, lng }, map, title: "You are here", zIndex: 999,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#4285F4", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 }
  });
  accuracyCircle = new google.maps.Circle({
    map, center: { lat, lng }, radius: Math.min(accuracy, 250),
    fillColor: "#4285F4", fillOpacity: 0.12, strokeColor: "#4285F4", strokeOpacity: 0.3, strokeWeight: 1
  });
  markers = markers.filter(m => !m.isMe);
  markerId += 1;
  const info = new google.maps.InfoWindow({
    content: `<div style="font-family:Inter,sans-serif;padding:3px"><strong>You are here</strong><br><span style="color:#5f6368;font-size:12px">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>`
  });
  myLocationMarker.addListener("click", () => info.open(map, myLocationMarker));
  markers.unshift({ id: markerId, lat, lng, title: "You are here", marker: myLocationMarker, info, isMe: true });
  renderMarkersList();
  if (center) { map.panTo({ lat, lng }); if (map.getZoom() < 15) map.setZoom(16); }
}

function initPeer() {
  if (typeof Peer === "undefined") { setTimeout(initPeer, 500); return; }
  if (peer) return;
  peer = new Peer(undefined, { debug: 0 });
  peer.on("open", (id) => { myPeerId = id; });
  peer.on("connection", (conn) => setupDataConn(conn));
  peer.on("call", (call) => {
    const meta = call.metadata || {};
    if (meta.type === "screen") {
      call.answer();
      call.on("stream", (stream) => {
        remoteScreen.srcObject = stream;
        screenShareBox.classList.add("visible");
        toast("Friend is sharing screen");
      });
      screenCall = call;
    } else {
      call.answer(localStream || undefined);
      call.on("stream", (stream) => {
        remoteAudio.srcObject = stream;
        $("#btnVoice").classList.add("on");
        callBar.classList.add("visible");
        toast("Voice connected");
      });
      currentCall = call;
    }
  });
  peer.on("error", (err) => {
    console.warn("Peer error", err);
    if (err.type !== "peer-unavailable") toast("Connection issue: " + (err.type || "error"));
  });
}

$("#btnCreateRoom").addEventListener("click", () => {
  if (!peer || !myPeerId) { initPeer(); return toast("Connecting… try again in a second"); }
  currentRoom = myPeerId;
  $("#roomCode").value = myPeerId;
  setRoomLive(true, "Hosting room — share this code");
  callBar.classList.add("visible");
  toast("Room created — copy & share the code");
});

$("#btnJoinRoom").addEventListener("click", () => {
  const code = $("#roomCode").value.trim();
  if (!code) return toast("Enter a room code");
  if (!peer || !myPeerId) { initPeer(); return toast("Connecting… try again"); }
  if (code === myPeerId) return toast("That's your own code");
  currentRoom = code;
  const conn = peer.connect(code, { reliable: true, metadata: { name: currentUser?.name || "Friend", sub: currentUser?.sub } });
  setupDataConn(conn);
  setRoomLive(true, "Joining room…");
  callBar.classList.add("visible");
});

$("#btnCopyRoom").addEventListener("click", () => {
  const code = $("#roomCode").value.trim() || myPeerId;
  if (!code) return toast("Create or join a room first");
  navigator.clipboard.writeText(code).then(() => toast("Room code copied")).catch(() => toast(code));
});

function setRoomLive(live, text) {
  roomStatus.classList.toggle("live", live);
  roomStatus.innerHTML = `<span class="dot"></span> ${text}`;
}

function setupDataConn(conn) {
  conn.on("open", () => {
    roomPeers[conn.peer] = conn;
    const name = conn.metadata?.name || "Friend";
    addFriendUI(conn.peer, name, true);
    setRoomLive(true, "Connected · live sharing");
    toast("Connected to " + name);
    conn.send({ type: "hello", name: currentUser?.name || "Friend", sub: currentUser?.sub });
    if (myLocationMarker) {
      const p = myLocationMarker.getPosition();
      conn.send({ type: "loc", lat: p.lat(), lng: p.lng(), name: currentUser?.name || "Friend" });
    }
  });
  conn.on("data", (data) => {
    if (!data || !data.type) return;
    if (data.type === "hello") addFriendUI(conn.peer, data.name || "Friend", true);
    if (data.type === "loc") updateFriendMarker(conn.peer, data.lat, data.lng, data.name || "Friend");
  });
  conn.on("close", () => {
    delete roomPeers[conn.peer];
    addFriendUI(conn.peer, "Friend", false);
    if (friendMarkers[conn.peer]) { friendMarkers[conn.peer].setMap(null); delete friendMarkers[conn.peer]; }
    if (Object.keys(roomPeers).length === 0) setRoomLive(false, "Not in a room");
  });
}

function broadcastLocation(lat, lng) {
  const payload = { type: "loc", lat, lng, name: currentUser?.name || "Friend" };
  Object.values(roomPeers).forEach(c => { if (c.open) c.send(payload); });
}

function addFriendUI(peerId, name, online) {
  let el = friendsList.querySelector(`[data-peer="${peerId}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "friend-card";
    el.dataset.peer = peerId;
    friendsList.appendChild(el);
  }
  el.innerHTML = `<div class="friend-avatar ${online ? "online" : ""}">${(name || "?").charAt(0).toUpperCase()}</div><div class="friend-info"><div class="fname">${escapeHtml(name)}</div><div class="fmeta">${online ? "Online · sharing location" : "Offline"}</div></div>`;
}

function updateFriendMarker(peerId, lat, lng, name) {
  if (!map) return;
  if (friendMarkers[peerId]) {
    friendMarkers[peerId].setPosition({ lat, lng });
  } else {
    const m = new google.maps.Marker({
      position: { lat, lng }, map, title: name, zIndex: 900,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#f9ab00", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
      label: { text: (name || "F").charAt(0).toUpperCase(), color: "#202124", fontWeight: "700", fontSize: "11px" }
    });
    const info = new google.maps.InfoWindow({
      content: `<div style="font-family:Inter,sans-serif;padding:3px"><strong>${escapeHtml(name)}</strong><br><span style="color:#5f6368;font-size:12px">Live location</span></div>`
    });
    m.addListener("click", () => info.open(map, m));
    friendMarkers[peerId] = m;
  }
  let fm = markers.find(x => x.friendId === peerId);
  if (!fm) {
    markerId += 1;
    markers.push({ id: markerId, lat, lng, title: name + " (live)", marker: friendMarkers[peerId], info: null, isMe: false, friendId: peerId });
  } else { fm.lat = lat; fm.lng = lng; }
  renderMarkersList();
  addFriendUI(peerId, name, true);
}

$("#btnVoice").addEventListener("click", async () => {
  const peers = Object.keys(roomPeers);
  if (!peers.length) return toast("Join or create a room first");
  try {
    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    currentCall = peer.call(peers[0], localStream, { metadata: { type: "voice" } });
    currentCall.on("stream", (stream) => { remoteAudio.srcObject = stream; toast("Voice call connected"); });
    $("#btnVoice").classList.add("on");
    toast("Calling…");
  } catch { toast("Microphone permission denied"); }
});

$("#btnScreen").addEventListener("click", async () => {
  const peers = Object.keys(roomPeers);
  if (!peers.length) return toast("Join or create a room first");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false
    });
    screenCall = peer.call(peers[0], screenStream, { metadata: { type: "screen" } });
    $("#btnScreen").classList.add("on");
    toast("Sharing screen at 1080p");
    screenStream.getVideoTracks()[0].onended = () => stopScreen();
  } catch { toast("Screen share cancelled or denied"); }
});

function stopScreen() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if (screenCall) { try { screenCall.close(); } catch {} screenCall = null; }
  $("#btnScreen").classList.remove("on");
  screenShareBox.classList.remove("visible");
  remoteScreen.srcObject = null;
}

$("#btnHangup").addEventListener("click", () => {
  if (currentCall) { try { currentCall.close(); } catch {} currentCall = null; }
  stopScreen();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteAudio.srcObject = null;
  $("#btnVoice").classList.remove("on");
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

  map.addListener("mousemove", (e) => {
    if (e.latLng) statusCoords.textContent = `${e.latLng.lat().toFixed(5)}, ${e.latLng.lng().toFixed(5)}`;
  });
  map.addListener("zoom_changed", updateStatus);
  map.addListener("center_changed", updateStatus);
  map.addListener("click", (e) => {
    if (dropMode && e.latLng) {
      addMarker(e.latLng.lat(), e.latLng.lng(), "Dropped Pin");
      dropMode = false;
      $("#btnDropPin").classList.remove("active");
      toast("Pin dropped");
    }
  });
  map.addListener("dblclick", (e) => {
    if (e.latLng) addMarker(e.latLng.lat(), e.latLng.lng(), "Quick Pin");
  });

  updateStatus();
  loadUser();
  loadSavedMarkers();
  setTimeout(initGoogleSignIn, 400);
  setTimeout(initPeer, 600);

  if (localStorage.getItem("maps_welcome_done") === "1") {
    closeWelcome();
    if (!myLocationMarker) setTimeout(() => requestLocation(true), 700);
  }
}
window.initMap = initMap;

function updateStatus() {
  if (!map) return;
  const c = map.getCenter();
  statusCoords.textContent = `${c.lat().toFixed(5)}, ${c.lng().toFixed(5)}`;
  statusZoom.textContent = `Zoom ${map.getZoom()}`;
}

function addMarker(lat, lng, title = "Place", fly = true) {
  markerId += 1;
  const id = markerId;
  const marker = new google.maps.Marker({
    position: { lat, lng }, map, title,
    label: { text: String(id), color: "white", fontWeight: "700", fontSize: "11px" },
    animation: google.maps.Animation.DROP, draggable: true
  });
  const info = new google.maps.InfoWindow({
    content: `<div style="font-family:Inter,sans-serif;padding:3px;min-width:120px"><strong>${escapeHtml(title)}</strong><br><span style="color:#5f6368;font-size:12px">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>`
  });
  marker.addListener("click", () => info.open(map, marker));
  marker.addListener("dragend", () => {
    const pos = marker.getPosition();
    const m = markers.find(m => m.id === id);
    if (m) { m.lat = pos.lat(); m.lng = pos.lng(); renderMarkersList(); persistMarkers(); }
  });
  markers.push({ id, lat, lng, title, marker, info, isMe: false });
  renderMarkersList();
  persistMarkers();
  if (fly) { map.panTo({ lat, lng }); if (map.getZoom() < 15) map.setZoom(15); }
  return id;
}

function removeMarker(id) {
  const idx = markers.findIndex(m => m.id === id);
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
  markers.forEach(m => { if (!m.friendId) m.marker.setMap(null); });
  markers = markers.filter(m => m.friendId);
  myLocationMarker = null;
  if (accuracyCircle) { accuracyCircle.setMap(null); accuracyCircle = null; }
  renderMarkersList();
  persistMarkers();
  toast("Places cleared");
}

function renderMarkersList() {
  if (!markers.length) {
    markersList.innerHTML = `<div class="empty-state">Search or drop a pin</div>`;
    return;
  }
  markersList.innerHTML = markers.map(m => `
    <div class="marker-card" data-id="${m.id}">
      <div class="marker-pin ${m.isMe ? "me" : ""} ${m.friendId ? "friend" : ""}">${m.isMe ? "●" : m.friendId ? (m.title || "F").charAt(0) : m.id}</div>
      <div class="marker-info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="coords">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</div>
      </div>
      ${m.friendId ? "" : `<button class="marker-remove" data-remove="${m.id}" type="button">×</button>`}
    </div>`).join("");
  markersList.querySelectorAll(".marker-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      const m = markers.find(x => x.id === +card.dataset.id);
      if (m) { map.panTo({ lat: m.lat, lng: m.lng }); map.setZoom(16); m.info?.open(map, m.marker); }
    });
  });
  markersList.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); removeMarker(+btn.dataset.remove); });
  });
}

function persistMarkers() {
  const data = markers.filter(m => !m.isMe && !m.friendId).map(m => ({ id: m.id, lat: m.lat, lng: m.lng, title: m.title }));
  localStorage.setItem("maps_markers", JSON.stringify(data));
  localStorage.setItem("maps_marker_id", String(markerId));
}

function loadSavedMarkers() {
  try {
    const savedId = localStorage.getItem("maps_marker_id");
    if (savedId) markerId = parseInt(savedId, 10) || 0;
    const raw = localStorage.getItem("maps_markers");
    if (!raw) return;
    JSON.parse(raw).forEach(m => {
      const marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng }, map, title: m.title,
        label: { text: String(m.id), color: "white", fontWeight: "700", fontSize: "11px" },
        draggable: true
      });
      const info = new google.maps.InfoWindow({
        content: `<div style="font-family:Inter,sans-serif;padding:3px"><strong>${escapeHtml(m.title)}</strong><br><span style="color:#5f6368;font-size:12px">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span></div>`
      });
      marker.addListener("click", () => info.open(map, marker));
      markers.push({ id: m.id, lat: m.lat, lng: m.lng, title: m.title, marker, info, isMe: false });
    });
    renderMarkersList();
  } catch {}
}

let searchTimeout = null;
function searchPlaces(query) {
  if (!query || query.length < 2) { searchResults.classList.remove("open"); return; }
  if (!autocompleteService) return;
  autocompleteService.getPlacePredictions(
    { input: query, types: ["geocode", "establishment"] },
    (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
        searchResults.innerHTML = `<div class="result-item"><div class="name">No results</div></div>`;
        searchResults.classList.add("open");
        return;
      }
      searchResults.innerHTML = predictions.slice(0, 6).map(p => `
        <div class="result-item" data-place-id="${p.place_id}" data-name="${escapeHtml(p.structured_formatting.main_text)}">
          <div class="name">${escapeHtml(p.structured_formatting.main_text)}</div>
          <div class="addr">${escapeHtml(p.description)}</div>
        </div>`).join("");
      searchResults.classList.add("open");
      searchResults.querySelectorAll(".result-item").forEach(el => {
        el.addEventListener("click", () => {
          placesService.getDetails(
            { placeId: el.dataset.placeId, fields: ["geometry", "name"] },
            (place, st) => {
              if (st === google.maps.places.PlacesServiceStatus.OK && place.geometry) {
                addMarker(place.geometry.location.lat(), place.geometry.location.lng(), place.name || el.dataset.name);
                searchResults.classList.remove("open");
                searchInput.value = place.name || el.dataset.name;
              }
            }
          );
        });
      });
    }
  );
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2400);
}
function escapeHtml(str) {
  return String(str).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """);
}
function copyCenter() {
  if (!map) return;
  const c = map.getCenter();
  const text = `${c.lat().toFixed(6)}, ${c.lng().toFixed(6)}`;
  navigator.clipboard.writeText(text).then(() => toast("Coordinates copied")).catch(() => toast(text));
}
function setMapType(type) {
  if (!map) return;
  map.setMapTypeId(type);
  document.querySelectorAll(".layer-option").forEach(el => el.classList.toggle("active", el.dataset.layer === type));
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchPlaces(searchInput.value.trim()), 280);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); searchPlaces(searchInput.value.trim()); }
  if (e.key === "Escape") searchResults.classList.remove("open");
});
$("#searchBtn").addEventListener("click", () => searchPlaces(searchInput.value.trim()));
document.addEventListener("click", (e) => { if (!e.target.closest(".search-box")) searchResults.classList.remove("open"); });
$("#btnLocate").addEventListener("click", () => requestLocation(true));
$("#btnDropPin").addEventListener("click", () => {
  dropMode = !dropMode;
  $("#btnDropPin").classList.toggle("active", dropMode);
  toast(dropMode ? "Click map to drop pin" : "Drop mode off");
});
$("#btnClear").addEventListener("click", clearAllMarkers);
$("#btnCopy").addEventListener("click", copyCenter);
$("#btnLayers").addEventListener("click", (e) => { e.stopPropagation(); layersPanel.classList.toggle("open"); });
document.addEventListener("click", (e) => {
  if (!e.target.closest("#layersPanel") && !e.target.closest("#btnLayers")) layersPanel.classList.remove("open");
});
document.querySelectorAll(".layer-option").forEach(el => {
  el.addEventListener("click", () => { setMapType(el.dataset.layer); layersPanel.classList.remove("open"); });
});
$("#btnFullscreen").addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
$("#mobileToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
document.getElementById("map").addEventListener("click", () => {
  if (window.innerWidth <= 800) sidebar.classList.remove("open");
});
