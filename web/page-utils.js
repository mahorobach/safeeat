/**
 * EatEase — 共通ページ切替ユーティリティ
 */

var _ALL_PAGES = [
  'landing-page',
  'mode-select-page',
  'scanner-page',
  'user-settings-page',
  'mylist-page',
  'save-barcode-page',
  'mylist-add-page',
];

function showById(id) {
  if (window._stopBarcodeScanner) window._stopBarcodeScanner();
  _ALL_PAGES.forEach((pageId) => {
    const el = document.getElementById(pageId);
    if (el) el.style.display = 'none';
  });
  const page = document.getElementById(id);
  if (page) page.style.display = 'block';
}
