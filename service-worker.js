const CACHE = "yousef-auto-parts-v2";
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./favicon.svg",
  "./assets/css/style.css", "./assets/js/config.js", "./assets/js/local-db.js",
  "./assets/js/api.js", "./assets/js/app.js", "./assets/vendor/qrcode.min.js",
  "./assets/vendor/html2canvas.min.js", "./assets/vendor/jspdf.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.includes("supabase.co")) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
