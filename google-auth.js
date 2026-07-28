// google-auth.js — self-contained Google Sign-In
var GOOGLE_CLIENT_ID = "213167991809-5e4dq56drdap064jmvdd7ptqqt42erie.apps.googleusercontent.com";
var googleTokenClient = null;

function hideWelcomeNow() {
  var w = document.getElementById("welcome");
  if (w) {
    w.classList.add("hidden");
    w.style.display = "none";
  }
  try { localStorage.setItem("maps_welcome_done", "1"); } catch (e) {}
}

function saveGoogleUser(user) {
  try { localStorage.setItem("maps_user", JSON.stringify(user)); } catch (e) {}
  try { localStorage.setItem("maps_welcome_done", "1"); } catch (e) {}
  hideWelcomeNow();
  if (typeof setUser === "function") {
    try { setUser(user); } catch (e) { console.error(e); }
  } else {
    var chip = document.getElementById("userChip");
    if (chip) chip.classList.add("visible");
    var n = document.getElementById("userName");
    var em = document.getElementById("userEmail");
    if (n) n.textContent = user.name || "User";
    if (em) em.textContent = user.email || "";
    var av = document.getElementById("userAvatar");
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
  }
  if (typeof requestLocation === "function") {
    try { requestLocation(true); } catch (e) {}
  }
  if (typeof toast === "function") {
    try { toast("Welcome, " + (user.name || "Google user")); } catch (e) {}
  }
}

function handleGoogleCredential(credential) {
  try {
    var parts = credential.split(".");
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var payload = JSON.parse(atob(b64));
    saveGoogleUser({
      name: payload.name || payload.email,
      email: payload.email,
      picture: payload.picture || null,
      sub: payload.sub
    });
  } catch (e) {
    console.error(e);
    if (typeof toast === "function") toast("Google sign-in failed");
  }
}

function handleGoogleAccessToken(token) {
  fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token }
  })
    .then(function (res) {
      if (!res.ok) throw new Error("userinfo " + res.status);
      return res.json();
    })
    .then(function (profile) {
      saveGoogleUser({
        name: profile.name || profile.email,
        email: profile.email,
        picture: profile.picture || null,
        sub: profile.sub
      });
    })
    .catch(function (e) {
      console.error(e);
      if (typeof toast === "function") toast("Google sign-in failed");
    });
}

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || !window.google || !google.accounts) return false;
  if (google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: function (response) {
        if (response && response.credential) handleGoogleCredential(response.credential);
      },
      auto_select: false,
      cancel_on_tap_outside: true
    });
  }
  if (google.accounts.oauth2) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      callback: function (tokenResponse) {
        if (tokenResponse && tokenResponse.access_token) {
          handleGoogleAccessToken(tokenResponse.access_token);
        } else if (tokenResponse && tokenResponse.error) {
          if (typeof toast === "function") toast("Google login cancelled");
        }
      }
    });
  }
  return true;
}

function startGoogleLogin() {
  if (!window.google || !google.accounts) {
    if (typeof toast === "function") toast("Google still loading — wait 2 seconds and try again");
    return;
  }
  if (!googleTokenClient) initGoogleSignIn();
  if (googleTokenClient) {
    googleTokenClient.requestAccessToken({ prompt: "" });
    return;
  }
  if (google.accounts.id) {
    google.accounts.id.prompt(function (n) {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        if (typeof toast === "function") {
          toast("Add https://lichengan12.github.io to Google OAuth JavaScript origins");
        }
      }
    });
  }
}

(function earlyHide() {
  try {
    if (localStorage.getItem("maps_welcome_done") === "1" || localStorage.getItem("maps_user")) {
      hideWelcomeNow();
    }
  } catch (e) {}
})();

function wireGoogleButton() {
  var btn = document.getElementById("btnGoogleLogin");
  if (btn && !btn._googleWired) {
    btn._googleWired = true;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      startGoogleLogin();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireGoogleButton);
} else {
  wireGoogleButton();
}

var _gisTries = 0;
var _gisTimer = setInterval(function () {
  _gisTries++;
  if (window.google && google.accounts) {
    initGoogleSignIn();
    wireGoogleButton();
    clearInterval(_gisTimer);
  }
  if (_gisTries > 50) clearInterval(_gisTimer);
}, 200);
