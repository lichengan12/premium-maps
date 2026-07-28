// PREMIUM MAPS
const GOOGLE_CLIENT_ID = "213167991809-5e4dq56drdap064jmvdd7ptqqt42erie.apps.googleusercontent.com";

let map, markers = [], dropMode = false, markerId = 0;
let placesService, autocompleteService;
let myLocationMarker = null, accuracyCircle = null;
let currentUser = null;
let peer = null, myPeerId = null, roomPeers = {}, friendMarkers = {};
let localStream = null, screenStream = null, currentCall = null, screenCall = null;
let watchId = null;

function $(s) { return document.querySelector(s); }
function toast(msg) {
  var el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, String.fromCharCode(38) + "amp;")
    .replace(/</g, String.fromCharCode(38) + "lt;")
    .replace(/>/g, String.fromCharCode(38) + "gt;")
    .replace(/"/g, String.fromCharCode(38) + "quot;");
}
function closeWelcome() {
  var w = $("#welcome");
  if (w) w.classList.add("hidden");
  try { localStorage.setItem("maps_welcome_done", "1"); } catch (e) {}
}

function getAccounts() {
  try { return JSON.parse(localStorage.getItem("maps_accounts") || "{}"); } catch (e) { return {}; }
}
function saveAccounts(a) { localStorage.setItem("maps_accounts", JSON.stringify(a)); }

async function hashPass(p) {
  var data = new TextEncoder().encode(p + "maps_salt_v1");
  var buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function setUser(user) {
  currentUser = user;
  try { localStorage.setItem("maps_user", JSON.stringify(user)); } catch (e) {}
  var chip = $("#userChip");
  if (chip) chip.classList.add("visible");
  if ($("#userName")) $("#userName").textContent = user.name;
  if ($("#userEmail")) $("#userEmail").textContent = user.email;
  var av = $("#userAvatar");
  if (av) {
    if (user.picture) {
      av.innerHTML = "";
      var img = document.createElement("img");
      img.src = user.picture;
      img.referrerPolicy = "no-referrer";
      av.appendChild(img);
    } else {
      av.textContent = (user.name || "?").charAt(0).toUpperCase();
    }
  }
  if (typeof initPeer === "function") initPeer();
}

function loadUser() {
  try {
    var raw = localStorage.getItem("maps_user");
    if (raw) setUser(JSON.parse(raw));
  } catch (e) {}
}

document.querySelectorAll(".auth-tab").forEach(function (tab) {
  tab.addEventListener("click", function () {
    document.querySelectorAll(".auth-tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".auth-form").forEach(function (f) { f.classList.remove("active"); });
    tab.classList.add("active");
    var form = tab.getAttribute("data-tab") === "login" ? $("#formLogin") : $("#formRegister");
    if (form) form.classList.add("active");
  });
});

if ($("#formLogin")) {
  $("#formLogin").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("#loginEmail").value.trim().toLowerCase();
    var pass = $("#loginPass").value;
    var accounts = getAccounts();
    var acc = accounts[email];
    if (!acc) return toast("No account with that email");
    var h = await hashPass(pass);
    if (h !== acc.pass) return toast("Wrong password");
    setUser({ name: acc.name, email: email, picture: null, sub: "email:" + email });
    closeWelcome();
    requestLocation(true);
    toast("Logged in as " + acc.name);
  });
}

if ($("#formRegister")) {
  $("#formRegister").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("#regName").value.trim();
    var email = $("#regEmail").value.trim().toLowerCase();
    var pass = $("#regPass").value;
    if (pass.length < 4) return toast("Password too short");
    var accounts = getAccounts();
    if (accounts[email]) return toast("Email already registered");
    accounts[email] = { name: name, pass: await hashPass(pass) };
    saveAccounts(accounts);
    setUser({ name: name, email: email, picture: null, sub: "email:" + email });
    closeWelcome();
    requestLocation(true);
    toast("Account created");
  });
}

if ($("#btnAllowLocation")) {
  $("#btnAllowLocation").addEventListener("click", function () {
    closeWelcome();
    requestLocation(true);
  });
}
if ($("#btnSkip")) {
  $("#btnSkip").addEventListener("click", function () {
    closeWelcome();
    setUser({ name: "Guest", email: "guest@local", picture: null, sub: "guest" });
    toast("Continuing as guest");
  });
}

function requestLocation(centerMap) {
  if (centerMap === undefined) centerMap = false;
  if (!navigator.geolocation) return toast("Geolocation not supported");
  toast("Getting your location");
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      showMyLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, centerMap);
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
    position: { lat: lat, lng: lng },
    map: map,
    title: "You are here",
    zIndex: 999,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: "#4285F4",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 3
    }
  });
  accuracyCircle = new google.maps.Circle({
    map: map,
    center: { lat: lat, lng: lng },
    radius: Math.min(accuracy, 250),
    fillColor: "#4285F4",
    fillOpacity: 0.12,
    strokeColor: "#4285F4",
    strokeOpacity: 0.3,
    strokeWeight: 1
  });
  markers = markers.filter(function (m) { return !m.isMe; });
  markerId += 1;
  var info = new google.maps.InfoWindow({
    content: "<div style='font-family:Inter,sans-serif;padding:3px'><strong>You are here</strong></div>"
  });
  myLocationMarker.addListener("click", function () { info.open(map, myLocationMarker); });
  markers.unshift({
    id: markerId, lat: lat, lng: lng, title: "You are here",
    marker: myLocationMarker, info: info, isMe: true
  });
  renderMarkersList();
  if (center) {
    map.panTo({ lat: lat, lng: lng });
    if (map.getZoom() < 15) map.setZoom(16);
  }
}

function initPeer() {
  if (typeof Peer === "undefined") { setTimeout(initPeer, 500); return; }
  if (peer) return;
  peer = new Peer(undefined, { debug: 0 });
  peer.on("open", function (id) { myPeerId = id; });
  peer.on("connection", function (conn) { setupDataConn(conn); });
  peer.on("call", function (call) {
    var meta = call.metadata || {};
    if (meta.type === "screen") {
      call.answer();
      call.on("stream", function (stream) {
        var v = $("#remoteScreen");
        if (v) v.srcObject = stream;
        var box = $("#screenShareBox");
        if (box) box.classList.add("visible");
        toast("Friend is sharing screen");
      });
      screenCall = call;
    } else {
      call.answer(localStream || undefined);
      call.on("stream", function (stream) {
        var a = $("#remoteAudio");
        if (a) a.srcObject = stream;
        toast("Voice connected");
      });
      currentCall = call;
    }
  });
}

function setRoomLive(live, text) {
  var el = $("#roomStatus");
  if (!el) return;
  el.classList.toggle("live", live);
  el.innerHTML = '<span class="dot"></span> ' + text;
}

function setupDataConn(conn) {
  conn.on("open", function () {
    roomPeers[conn.peer] = conn;
    var name = (conn.metadata && conn.metadata.name) || "Friend";
    addFriendUI(conn.peer, name, true);
    setRoomLive(true, "Connected");
    toast("Connected to " + name);
    conn.send({ type: "hello", name: (currentUser && currentUser.name) || "Friend" });
    if (myLocationMarker) {
      var p = myLocationMarker.getPosition();
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
    if (friendMarkers[conn.peer]) {
      friendMarkers[conn.peer].setMap(null);
      delete friendMarkers[conn.peer];
    }
    if (Object.keys(roomPeers).length === 0) setRoomLive(false, "Not in a room");
  });
}

function broadcastLocation(lat, lng) {
  var payload = { type: "loc", lat: lat, lng: lng, name: (currentUser && currentUser.name) || "Friend" };
  Object.keys(roomPeers).forEach(function (k) {
    var c = roomPeers[k];
    if (c && c.open) c.send(payload);
  });
}

function addFriendUI(peerId, name, online) {
  var list = $("#friendsList");
  if (!list) return;
  var el = list.querySelector('[data-peer="' + peerId + '"]');
  if (!el) {
    el = document.createElement("div");
    el.className = "friend-card";
    el.setAttribute("data-peer", peerId);
    list.appendChild(el);
  }
  el.innerHTML = '<div class="friend-avatar">' + (name || "?").charAt(0).toUpperCase() +
    '</div><div class="friend-info"><div class="fname">' + escapeHtml(name) +
    '</div><div class="fmeta">' + (online ? "Online" : "Offline") + "</div></div>";
}

function updateFriendMarker(peerId, lat, lng, name) {
  if (!map || !window.google) return;
  if (friendMarkers[peerId]) {
    friendMarkers[peerId].setPosition({ lat: lat, lng: lng });
  } else {
    friendMarkers[peerId] = new google.maps.Marker({
      position: { lat: lat, lng: lng },
      map: map,
      title: name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: "#f9ab00",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3
      }
    });
  }
  renderMarkersList();
}

if ($("#btnCreateRoom")) {
  $("#btnCreateRoom").addEventListener("click", function () {
    if (!peer || !myPeerId) { initPeer(); return toast("Connecting, try again"); }
    if ($("#roomCode")) $("#roomCode").value = myPeerId;
    setRoomLive(true, "Hosting room");
    var bar = $("#callBar");
    if (bar) bar.classList.add("visible");
    toast("Room created — copy the code");
  });
}
if ($("#btnJoinRoom")) {
  $("#btnJoinRoom").addEventListener("click", function () {
    var code = ($("#roomCode") && $("#roomCode").value.trim()) || "";
    if (!code) return toast("Enter a room code");
    if (!peer || !myPeerId) { initPeer(); return toast("Connecting, try again"); }
    if (code === myPeerId) return toast("That is your own code");
    var conn = peer.connect(code, {
      reliable: true,
      metadata: { name: (currentUser && currentUser.name) || "Friend" }
    });
    setupDataConn(conn);
    setRoomLive(true, "Joining");
    var bar = $("#callBar");
    if (bar) bar.classList.add("visible");
  });
}
if ($("#btnCopyRoom")) {
  $("#btnCopyRoom").addEventListener("click", function () {
    var code = (($("#roomCode") && $("#roomCode").value.trim()) || myPeerId) || "";
    if (!code) return toast("Create or join a room first");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(function () { toast("Code copied"); });
    } else toast(code);
  });
}

if ($("#btnVoice")) {
  $("#btnVoice").addEventListener("click", async function () {
    var peers = Object.keys(roomPeers);
    if (!peers.length) return toast("Join a room first");
    try {
      if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      currentCall = peer.call(peers[0], localStream, { metadata: { type: "voice" } });
      currentCall.on("stream", function (stream) {
        var a = $("#remoteAudio");
        if (a) a.srcObject = stream;
        toast("Voice connected");
      });
      toast("Calling");
    } catch (e) { toast("Mic denied"); }
  });
}
if ($("#btnScreen")) {
  $("#btnScreen").addEventListener("click", async function () {
    var peers = Object.keys(roomPeers);
    if (!peers.length) return toast("Join a room first");
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      screenCall = peer.call(peers[0], screenStream, { metadata: { type: "screen" } });
      toast("Sharing screen");
      screenStream.getVideoTracks()[0].onended = function () { stopScreen(); };
    } catch (e) { toast("Screen share cancelled"); }
  });
}
function stopScreen() {
  if (screenStream) {
    screenStream.getTracks().forEach(function (t) { t.stop(); });
    screenStream = null;
  }
  if (screenCall) { try { screenCall.close(); } catch (e) {} screenCall = null; }
  var box = $("#screenShareBox");
  if (box) box.classList.remove("visible");
  var v = $("#remoteScreen");
  if (v) v.srcObject = null;
}
if ($("#btnHangup")) {
  $("#btnHangup").addEventListener("click", function () {
    if (currentCall) { try { currentCall.close(); } catch (e) {} currentCall = null; }
    stopScreen();
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    toast("Call ended");
  });
}

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
    if (e.latLng && $("#statusCoords")) {
      $("#statusCoords").textContent = e.latLng.lat().toFixed(5) + ", " + e.latLng.lng().toFixed(5);
    }
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

  updateStatus();
  loadUser();
  loadSavedMarkers();
  setTimeout(initPeer, 600);
  if (typeof initGoogleSignIn === "function") setTimeout(initGoogleSignIn, 400);

  if (localStorage.getItem("maps_welcome_done") === "1") {
    closeWelcome();
    if (!myLocationMarker) setTimeout(function () { requestLocation(true); }, 700);
  }
}
window.initMap = initMap;

function updateStatus() {
  if (!map) return;
  var c = map.getCenter();
  if ($("#statusCoords")) $("#statusCoords").textContent = c.lat().toFixed(5) + ", " + c.lng().toFixed(5);
  if ($("#statusZoom")) $("#statusZoom").textContent = "Zoom " + map.getZoom();
}

function addMarker(lat, lng, title, fly) {
  if (title === undefined) title = "Place";
  if (fly === undefined) fly = true;
  markerId += 1;
  var id = markerId;
  var marker = new google.maps.Marker({
    position: { lat: lat, lng: lng },
    map: map,
    title: title,
    label: { text: String(id), color: "white", fontWeight: "700", fontSize: "11px" },
    animation: google.maps.Animation.DROP,
    draggable: true
  });
  var info = new google.maps.InfoWindow({
    content: "<div style='font-family:Inter,sans-serif;padding:3px'><strong>" + escapeHtml(title) + "</strong></div>"
  });
  marker.addListener("click", function () { info.open(map, marker); });
  marker.addListener("dragend", function () {
    var pos = marker.getPosition();
    var m = markers.find(function (x) { return x.id === id; });
    if (m) { m.lat = pos.lat(); m.lng = pos.lng(); renderMarkersList(); persistMarkers(); }
  });
  markers.push({ id: id, lat: lat, lng: lng, title: title, marker: marker, info: info, isMe: false });
  renderMarkersList();
  persistMarkers();
  if (fly) {
    map.panTo({ lat: lat, lng: lng });
    if (map.getZoom() < 15) map.setZoom(15);
  }
}

function removeMarker(id) {
  var idx = markers.findIndex(function (m) { return m.id === id; });
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
  var list = $("#markersList");
  if (!list) return;
  if (!markers.length) {
    list.innerHTML = '<div class="empty-state">Search or drop a pin</div>';
    return;
  }
  list.innerHTML = markers.map(function (m) {
    return '<div class="marker-card" data-id="' + m.id + '">' +
      '<div class="marker-pin' + (m.isMe ? " me" : "") + '">' + (m.isMe ? "*" : m.id) + "</div>" +
      '<div class="marker-info"><div class="title">' + escapeHtml(m.title) + "</div>" +
      '<div class="coords">' + m.lat.toFixed(5) + ", " + m.lng.toFixed(5) + "</div></div>" +
      (m.friendId ? "" : '<button class="marker-remove" data-remove="' + m.id + '" type="button">x</button>') +
      "</div>";
  }).join("");
  list.querySelectorAll(".marker-card").forEach(function (card) {
    card.addEventListener("click", function (e) {
      if (e.target.closest("[data-remove]")) return;
      var m = markers.find(function (x) { return x.id === +card.getAttribute("data-id"); });
      if (m) {
        map.panTo({ lat: m.lat, lng: m.lng });
        map.setZoom(16);
        if (m.info) m.info.open(map, m.marker);
      }
    });
  });
  list.querySelectorAll("[data-remove]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeMarker(+btn.getAttribute("data-remove"));
    });
  });
}

function persistMarkers() {
  var data = markers.filter(function (m) { return !m.isMe && !m.friendId; }).map(function (m) {
    return { id: m.id, lat: m.lat, lng: m.lng, title: m.title };
  });
  try {
    localStorage.setItem("maps_markers", JSON.stringify(data));
    localStorage.setItem("maps_marker_id", String(markerId));
  } catch (e) {}
}

function loadSavedMarkers() {
  try {
    var savedId = localStorage.getItem("maps_marker_id");
    if (savedId) markerId = parseInt(savedId, 10) || 0;
    var raw = localStorage.getItem("maps_markers");
    if (!raw) return;
    JSON.parse(raw).forEach(function (m) {
      var marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: map,
        title: m.title,
        label: { text: String(m.id), color: "white", fontWeight: "700", fontSize: "11px" },
        draggable: true
      });
      var info = new google.maps.InfoWindow({
        content: "<div style='font-family:Inter,sans-serif;padding:3px'><strong>" + escapeHtml(m.title) + "</strong></div>"
      });
      marker.addListener("click", function () { info.open(map, marker); });
      markers.push({ id: m.id, lat: m.lat, lng: m.lng, title: m.title, marker: marker, info: info, isMe: false });
    });
    renderMarkersList();
  } catch (e) {}
}

var searchTimeout = null;
function searchPlaces(query) {
  var results = $("#searchResults");
  if (!query || query.length < 2) {
    if (results) results.classList.remove("open");
    return;
  }
  if (!autocompleteService) return;
  autocompleteService.getPlacePredictions(
    { input: query, types: ["geocode", "establishment"] },
    function (predictions, status) {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
        if (results) {
          results.innerHTML = '<div class="result-item"><div class="name">No results</div></div>';
          results.classList.add("open");
        }
        return;
      }
      results.innerHTML = predictions.slice(0, 6).map(function (p) {
        return '<div class="result-item" data-place-id="' + p.place_id + '">' +
          '<div class="name">' + escapeHtml(p.structured_formatting.main_text) + "</div>" +
          '<div class="addr">' + escapeHtml(p.description) + "</div></div>";
      }).join("");
      results.classList.add("open");
      results.querySelectorAll(".result-item").forEach(function (el) {
        el.addEventListener("click", function () {
          placesService.getDetails(
            { placeId: el.getAttribute("data-place-id"), fields: ["geometry", "name"] },
            function (place, st) {
              if (st === google.maps.places.PlacesServiceStatus.OK && place.geometry) {
                addMarker(place.geometry.location.lat(), place.geometry.location.lng(), place.name || "Place");
                results.classList.remove("open");
                if ($("#searchInput")) $("#searchInput").value = place.name || "";
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
  var c = map.getCenter();
  var text = c.lat().toFixed(6) + ", " + c.lng().toFixed(6);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () { toast("Copied"); });
  } else toast(text);
}

function setMapType(type) {
  if (!map) return;
  map.setMapTypeId(type);
  document.querySelectorAll(".layer-option").forEach(function (el) {
    el.classList.toggle("active", el.getAttribute("data-layer") === type);
  });
}

var searchInput = $("#searchInput");
if (searchInput) {
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      searchPlaces(searchInput.value.trim());
    }, 280);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      searchPlaces(searchInput.value.trim());
    }
  });
}
if ($("#searchBtn")) {
  $("#searchBtn").addEventListener("click", function () {
    searchPlaces(searchInput.value.trim());
  });
}
if ($("#btnLocate")) $("#btnLocate").addEventListener("click", function () { requestLocation(true); });
if ($("#btnDropPin")) {
  $("#btnDropPin").addEventListener("click", function () {
    dropMode = !dropMode;
    $("#btnDropPin").classList.toggle("active", dropMode);
    toast(dropMode ? "Click map to drop pin" : "Drop mode off");
  });
}
if ($("#btnClear")) $("#btnClear").addEventListener("click", clearAllMarkers);
if ($("#btnCopy")) $("#btnCopy").addEventListener("click", copyCenter);
if ($("#btnLayers")) {
  $("#btnLayers").addEventListener("click", function (e) {
    e.stopPropagation();
    var p = $("#layersPanel");
    if (p) p.classList.toggle("open");
  });
}
document.addEventListener("click", function (e) {
  if (!e.target.closest("#layersPanel") && !e.target.closest("#btnLayers")) {
    var p = $("#layersPanel");
    if (p) p.classList.remove("open");
  }
});
document.querySelectorAll(".layer-option").forEach(function (el) {
  el.addEventListener("click", function () {
    setMapType(el.getAttribute("data-layer"));
    var p = $("#layersPanel");
    if (p) p.classList.remove("open");
  });
});
if ($("#btnFullscreen")) {
  $("#btnFullscreen").addEventListener("click", function () {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });
}
if ($("#mobileToggle")) {
  $("#mobileToggle").addEventListener("click", function () {
    var s = $("#sidebar");
    if (s) s.classList.toggle("open");
  });
}
