// ==========================================
// Service Worker – Learning App
// ==========================================

const CACHE_NAME = "learning-app-v2";

// 🔹 Statische Dateien (App-Shell)
const STATIC_ASSETS = [
  "index.html",
  "assets/css/style.css",
  "assets/js/app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

// ==========================================
// INSTALL
// ==========================================
self.addEventListener("install", (event) => {
  console.log("SW: Install");

  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// ==========================================
// ACTIVATE
// ==========================================
self.addEventListener("activate", (event) => {
  console.log("SW: Activate");

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("SW: delete old cache", key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// ==========================================
// FETCH
// ==========================================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  // ❗ nur GET Requests behandeln (fix für HEAD-Fehler)
  if (req.method !== "GET") return;

  console.log("FETCH:", url);

  // ------------------------------------------
  // 🔥 CSV: Network first, fallback to cache
  // ------------------------------------------
  if (url.endsWith(".csv")) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(req).then(res => {
            return res || new Response("Offline CSV not available", { status: 503 });
          });
        })
    );
    return;
  }

  // ------------------------------------------
  // 🔹 Google Fonts ignorieren (optional, stabiler offline)
  // ------------------------------------------
  if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) {
    return;
  }

window.addEventListener("beforeinstallprompt", (e) => {
  console.log("INSTALL EVENT READY");
});

  // ------------------------------------------
  // 🔹 APP-SHELL: Cache First
  // ------------------------------------------
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(req)
        .then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, clone);
          });
          return networkResponse;
        })
        .catch(() => {
          return caches.match("index.html");
        });
    })
  );
});