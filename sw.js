// ==========================================
// Service Worker – Learning App
// ==========================================

// 🔹 Version bei jedem Release erhöhen!
const CACHE_NAME = "learning-app-v1";

// 🔹 Statische Dateien (App-Shell)
const STATIC_ASSETS = [
  "index.html",                // oder "index.html"
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

  self.skipWaiting(); // sofort aktivierbar

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return event.waitUntil(
  Promise.all(
    STATIC_ASSETS.map(url =>
      fetch(url).then(res => {
        if (!res.ok) {
          console.error("❌ Fehler bei:", url);
        } else {
          console.log("✅ OK:", url);
        }
        return res;
      })
    )
  )
);
    })
  );
});

// ==========================================
// ACTIVATE
// ==========================================
self.addEventListener("activate", (event) => {
  console.log("SW: Activate");

  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("SW: delete old cache", key);
            return caches.delete(key);
          }
        })
      );
    })
  );

  self.clients.claim(); // sofort Kontrolle übernehmen
});

// ==========================================
// FETCH
// ==========================================
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  console.log("FETCH:", event.request.url);
  // ------------------------------------------
  // 🔥 CSV IMMER FRISCH LADEN
  // ------------------------------------------
 // ------------------------------------------
// CSV: Network first, fallback to cache
// ------------------------------------------
if (url.includes(".csv")) {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // im Cache speichern
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // offline fallback
        return caches.match(event.request);
      })
  );
  return;
}

  // ------------------------------------------
  // 🔹 APP-SHELL: Cache First
  // ------------------------------------------
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // optional: neue Dateien cachen
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // fallback (optional)
          if (event.request.destination === "document") {
            return caches.match("/index.html");
          }
        });
    })
  );
});