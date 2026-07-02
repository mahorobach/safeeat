/**
 * VegEatEase — Service Worker
 *
 * 既存のバージョン付きJS/CSSを古いキャッシュで上書きしないよう、
 * リクエストは常にネットワークへ通す。オフライン対応は別フェーズで扱う。
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});
