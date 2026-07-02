/**
 * VegEatEase — PWA起動設定
 * Service Workerの登録のみを担当する。
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => console.warn("[PWA] Service Worker registration failed:", error));
  });
})();
