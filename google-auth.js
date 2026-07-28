// Google Sign-In (popup OAuth)
const GOOGLE_CLIENT_ID = "213167991809-5e4dq56drdap064jmvdd7ptqqt42erie.apps.googleusercontent.com";
let googleTokenClient = null;

function handleGoogleCredential(credential) {
  try {
    var parts = credential.split(".");
    var json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    var payload = JSON.parse(json);
    if (typeof setUser === "function") {
      setUser({ name: payload.name || payload.email, email: payload.email, picture: payload.picture || null, sub: payload.sub });
    }
    if (typeof closeWelcome === "function") closeWelcome();
    if (typeof requestLocation === "function") requestLocation(true);
    if (typeof toast === "function") toast("Welcome, " + (payload.given_name || payload.name || "Google user"));
  } catch (e) {
    console.error(e);
    if (typeof toast === "function") toast("Google sign-in failed");
  }
}

function handleGoogleAccessToken(token) {
  fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token }
  }).then(function (res) {
    if (!res.ok) throw new Error("userinfo");
    return res.json();
  }).then(function (profile) {
    if (typeof setUser === "function") {
      setUser({ name: profile.name || profile.email, email: profile.email, picture: profile.picture || null, sub: profile.sub });
    }
    if (typeof closeWelcome === "function") closeWelcome();
    if (typeof requestLocation === "function") requestLocation(true);
    if (typeof toast === "function") toast("Welcome, " + (profile.given_name || profile.name || "Google user"));
  }).catch(function (e) {
    console.error(e);
    if (typeof toast === "function") toast("Google sign-in failed");
  });
}

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || !window.google || !google.accounts) return;
  if (google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: function (response) {
        if (response && response.credential) handleGoogleCredential(response.credential);
      },
      auto_select: false
    });
  }
  if (google.accounts.oauth2) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      callback: function (tokenResponse) {
        if (tokenResponse && tokenResponse.access_token) handleGoogleAccessToken(tokenResponse.access_token);
        else if (tokenResponse && tokenResponse.error) {
          if (typeof toast === "function") toast("Google login cancelled");
        }
      }
    });
  }
}

function startGoogleLogin() {
  if (!window.google || !google.accounts) {
    if (typeof toast === "function") toast("Google still loading, try again");
    return;
  }
  if (!googleTokenClient && google.accounts.oauth2) initGoogleSignIn();
  if (googleTokenClient) {
    googleTokenClient.requestAccessToken({ prompt: "consent" });
    return;
  }
  if (google.accounts.id) {
    google.accounts.id.prompt(function (n) {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        if (typeof toast === "function") toast("Add https://lichengan12.github.io to OAuth JavaScript origins");
      }
    });
  } else if (typeof toast === "function") {
    toast("Google Sign-In unavailable");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("btnGoogleLogin");
  if (btn) btn.addEventListener("click", function (e) {
    e.preventDefault();
    startGoogleLogin();
  });
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    if (window.google && google.accounts) {
      initGoogleSignIn();
      clearInterval(t);
    }
    if (tries > 40) clearInterval(t);
  }, 250);
});
