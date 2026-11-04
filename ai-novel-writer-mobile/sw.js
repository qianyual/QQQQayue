/* 书童移动版 — Service Worker：缓存壳，离线可用 */
const CACHE = "anw-mobile-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/icons.js",
  "./js/prompts.js",
  "./js/llm.js",
  "./js/db.js",
  "./js/hud.js",
  "./js/materials.js",
  "./js/skills.js",
  "./js/merge.js",
  "./js/graph.js",
  "./js/exporter.js",
  "./js/epub.js",
  "./js/app.js",
  "./js/compass.js",
  "./icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 网络优先（保证升级及时），断网时回退缓存；API 请求不拦截 */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
