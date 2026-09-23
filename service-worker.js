const CACHE = "certifica-plus-v7.2";
const local = path => new URL(path, self.registration.scope).href;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/api.js",
  "./js/firebase-client.js",
  "./js/firebase-config.js",
  "./js/default-courses.js",
  "./data/default-courses.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./gestion-cursos/",
  "./gestion-cursos/index.html"
].map(local);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match(local("./index.html"))))
  );
});
