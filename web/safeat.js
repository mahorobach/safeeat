/**
 * EatEase — メインUI ロジック
 * Phase 1: オリエンタルベジタリアン特化
 * Claude API はサーバー経由のため、フロントに API キーは不要（site-config.js の API_BASE のみ）
 */

const APP_VERSION = '0.5.20';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if (el) el.textContent = `v${APP_VERSION}`;
});

const SAFEAT_API_URL =
  (window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE) || "https://safeeat-production-b7c5.up.railway.app";

const MODE_DEFINITIONS = {
  oriental: {
    label: '🌿 オリエンタルベジタリアン',
    modebarLabel: 'オリエンタルベジ',
    rules: [
      { type: 'ng', text: 'ニンニク・ネギ・ニラ・らっきょう・玉ねぎ（五葷）' },
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ok', text: '卵・乳製品・蜂蜜・ローヤルゼリー OK' },
    ],
  },
  vegan: {
    label: '🌱 ヴィーガン',
    modebarLabel: 'ヴィーガン',
    rules: [
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ng', text: '卵・乳製品・蜂蜜・ゼラチン等すべての動物由来成分' },
      { type: 'ok', text: '植物性成分すべて OK' },
    ],
  },
  lacto_ovo: {
    label: '🥚 ラクト・オボベジタリアン',
    modebarLabel: 'ラクト・オボ',
    rules: [
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ok', text: '卵・乳製品・蜂蜜 OK' },
      { type: 'ok', text: '植物性成分すべて OK' },
    ],
  },
};

let currentSessionMode = 'oriental';

// デザインシステム切替（app.eatease.net / localhost → EatEase UI）
if (window.SITE_CONFIG?.isEatEase) {
  document.body.classList.add('ee-page');
}

// Supabase Auth トークン（ログイン後に localStorage に格納）
function getAuthToken() {
  return localStorage.getItem("safeat_auth_token") || null;
}

// --- DOM refs ---
const textarea      = document.getElementById("ingredients-textarea");
const analyzeBtn    = document.getElementById("analyze-btn");
const errorBox      = document.getElementById("error-box");
const resultSection = document.getElementById("result-section");

// =============================================
// ユーザー検証DB
// ログイン中: Render API (/api/ingredients POST)
// 未ログイン: localStorage にフォールバック
// =============================================
const USER_DB_KEY = "safeat_user_ingredients";

function getUserDB() {
  try {
    return JSON.parse(localStorage.getItem(USER_DB_KEY) || "{}");
  } catch {
    return {};
  }
}

async function saveUserIngredient(name, category, reason) {
  const db = getUserDB();
  db[name] = { category, reason, verified: true, savedAt: new Date().toISOString() };
  localStorage.setItem(USER_DB_KEY, JSON.stringify(db));

  const token = getAuthToken();
  if (!token) return;

  try {
    await fetch(`${SAFEAT_API_URL}/api/ingredients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ name, category, reason, confidence: "low" }),
    });
  } catch {
    // API 失敗時は localStorage のみで継続
  }
}

function lookupUserDB(name) {
  return getUserDB()[name] || null;
}

function getUserDBCount() {
  return Object.keys(getUserDB()).length;
}

// --- Tab switching ---
document.querySelectorAll(".input-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".input-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.getElementById("tab-text").style.display  = tab.dataset.tab === "text"  ? "" : "none";
    document.getElementById("tab-image").style.display = tab.dataset.tab === "image" ? "" : "none";
    setLoading(false); // ラベルを更新
  });
});

function getActiveTab() {
  return document.querySelector(".input-tab.active")?.dataset.tab || "text";
}

// --- Image state ---
let _imageBase64 = null;
let _imageMediaType = null;
/** 結果画面でテキストと照合するため、読み取り成功時点の画像（data URL） */
let _comparePhotoDataUrl = null;

const dropZone        = document.getElementById("drop-zone");
const imageInput      = document.getElementById("image-input");
const imagePreview    = document.getElementById("image-preview");
const dropPlaceholder = document.getElementById("drop-placeholder");
const clearImageBtn   = document.getElementById("clear-image-btn");
const imageToolbar    = document.getElementById("image-toolbar");
const cropPanel       = document.getElementById("crop-panel");
const cropCanvas      = document.getElementById("crop-canvas");
const btnStartCrop    = document.getElementById("btn-start-crop");
const btnApplyCrop    = document.getElementById("btn-apply-crop");
const btnCancelCrop   = document.getElementById("btn-cancel-crop");

const VALID_IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];

function isUnsupportedImageMime(file) {
  const t = (file.type || "").toLowerCase();
  return t === "image/heic" || t === "image/heif";
}

/** モバイルでは type が空・octet-stream になりがち。デコード可能なら受け入れる */
function mayBeProcessableImageFile(file) {
  if (!file?.type) return true;
  const t = file.type.toLowerCase();
  if (VALID_IMG_TYPES.includes(t)) return true;
  if (t.startsWith("image/")) return true;
  if (t === "application/octet-stream") return true;
  return false;
}

/** タイムアウトしやすいホスティング向け。長辺を抑えロード削減 */
const VISION_MAX_EDGE     = 900;
const VISION_JPEG_QUALITY = 0.78;
const IMG_MAX_BYTES       = 5 * 1024 * 1024;

let _currentImageBlob = null;

dropZone.addEventListener("click", (e) => {
  if (e.target === clearImageBtn || clearImageBtn.contains(e.target)) return;
  if (cropPanel.style.display !== "none") return;
  imageInput.click();
});
imageInput.addEventListener("change", () => { if (imageInput.files[0]) setImageFile(imageInput.files[0]); });

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) setImageFile(e.dataTransfer.files[0]);
});

clearImageBtn.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });

btnStartCrop.addEventListener("click", (e) => { e.stopPropagation(); openCropPanel(); });
btnCancelCrop.addEventListener("click", (e) => { e.stopPropagation(); closeCropPanel(); });
btnApplyCrop.addEventListener("click", (e) => { e.stopPropagation(); applyCropSelection(); });
document.getElementById("btn-toolbar-clear")?.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });

function clearCompareSnapshot() {
  _comparePhotoDataUrl = null;
  const wrap = document.getElementById("result-compare-photo-wrap");
  const img = document.getElementById("result-compare-photo");
  if (wrap) {
    wrap.style.display = "none";
    wrap.setAttribute("hidden", "");
  }
  if (img) img.removeAttribute("src");
}

function updateResultComparePhoto() {
  const wrap = document.getElementById("result-compare-photo-wrap");
  const img = document.getElementById("result-compare-photo");
  if (!wrap || !img) return;
  if (_comparePhotoDataUrl) {
    img.src = _comparePhotoDataUrl;
    img.alt = "読み取りに使った写真";
    wrap.removeAttribute("hidden");
    wrap.style.display = "";
  } else {
    wrap.style.display = "none";
    wrap.setAttribute("hidden", "");
    img.removeAttribute("src");
  }
}

function clearImage() {
  clearCompareSnapshot();
  _imageBase64 = _imageMediaType = null;
  _currentImageBlob = null;
  imagePreview.style.display = "none";
  imagePreview.src = "";
  dropPlaceholder.style.display = "";
  clearImageBtn.style.display = "none";
  imageToolbar.style.display = "none";
  cropPanel.style.display = "none";
  dropZone.classList.remove("has-image");
  imageInput.value = "";
  teardownCropInteraction();
}

function prepareImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        reject(new Error("bad image"));
        return;
      }
      const scale = Math.min(1, VISION_MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/jpeg",
        VISION_JPEG_QUALITY,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function setImageFile(file) {
  if (isUnsupportedImageMime(file)) {
    showError(
      "HEIC（iPhoneの写真）形式はこのブラウザでは読み取れません。写真アプリで「JPEGでコピー」するか、スクリーンショットをJPEGで保存してから選んでください。",
    );
    return;
  }
  if (!mayBeProcessableImageFile(file)) {
    showError("JPEG / PNG / WEBP 形式の画像を選択してください。");
    return;
  }
  if (file.size > IMG_MAX_BYTES) {
    showError("ファイルサイズは 5MB 以内にしてください。");
    return;
  }
  clearError();

  let blob;
  try {
    blob = await prepareImageForUpload(file);
  } catch {
    showError("画像の処理に失敗しました。別の画像を選択してください。");
    return;
  }

  try {
    _currentImageBlob = blob;
    _imageBase64 = await blobToBase64(blob);
    _imageMediaType = "image/jpeg";

    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src = objUrl;
    imagePreview.style.display = "block";
    dropPlaceholder.style.display = "none";
    clearImageBtn.style.display  = "inline-block";
    imageToolbar.style.display   = "block";
    cropPanel.style.display      = "none";
    dropZone.classList.add("has-image");
    requestAnimationFrame(() =>
      imageToolbar?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  } catch {
    showError("画像の読み込みに失敗しました。");
  }
}

let _cropCtx = null;
let _cropImg = null;
let _cropDrag = false;
let _cropX0 = 0, _cropY0 = 0, _cropX1 = 0, _cropY1 = 0;
const CROP_MIN_PX = 36;

function getCanvasPointer(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function redrawCropCanvas() {
  if (!_cropCtx || !_cropImg) return;
  const ctx = _cropCtx;
  const cw = cropCanvas.width;
  const ch = cropCanvas.height;
  ctx.drawImage(_cropImg, 0, 0, cw, ch);
  const x0 = Math.min(_cropX0, _cropX1);
  const y0 = Math.min(_cropY0, _cropY1);
  const x1 = Math.max(_cropX0, _cropX1);
  const y1 = Math.max(_cropY0, _cropY1);
  if (x1 - x0 > 2 && y1 - y0 > 2) {
    ctx.fillStyle = "rgba(21, 101, 192, 0.2)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = "#1565c0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

function openCropPanel() {
  if (!_currentImageBlob) return;
  const url = URL.createObjectURL(_currentImageBlob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    _cropImg = img;
    const maxDisplay = 720;
    let dw = img.naturalWidth;
    let dh = img.naturalHeight;
    if (dw > maxDisplay) {
      const s = maxDisplay / dw;
      dw = Math.round(dw * s);
      dh = Math.round(dh * s);
    }
    cropCanvas.width = dw;
    cropCanvas.height = dh;
    _cropCtx = cropCanvas.getContext("2d");
    _cropCtx.drawImage(img, 0, 0, dw, dh);
    _cropX0 = _cropY0 = _cropX1 = _cropY1 = 0;
    btnApplyCrop.disabled = true;
    imageToolbar.style.display = "none";
    cropPanel.style.display = "block";
    setupCropInteraction();
    requestAnimationFrame(() =>
      cropPanel.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showError("切り取り用に画像を開けませんでした。");
  };
  img.src = url;
}

function closeCropPanel() {
  cropPanel.style.display = "none";
  imageToolbar.style.display = "block";
  teardownCropInteraction();
  _cropImg = null;
  _cropCtx = null;
}

function setupCropInteraction() {
  const onDown = (e) => {
    e.preventDefault();
    _cropDrag = true;
    const p = getCanvasPointer(e, cropCanvas);
    _cropX0 = _cropX1 = p.x;
    _cropY0 = _cropY1 = p.y;
    btnApplyCrop.disabled = true;
  };
  const onMove = (e) => {
    if (!_cropDrag) return;
    e.preventDefault();
    const p = getCanvasPointer(e, cropCanvas);
    _cropX1 = p.x;
    _cropY1 = p.y;
    redrawCropCanvas();
  };
  const onUp = (e) => {
    if (!_cropDrag) return;
    e.preventDefault();
    _cropDrag = false;
    const w = Math.abs(_cropX1 - _cropX0);
    const h = Math.abs(_cropY1 - _cropY0);
    btnApplyCrop.disabled = w < CROP_MIN_PX || h < CROP_MIN_PX;
  };

  cropCanvas._sfDown = onDown;
  cropCanvas._sfMove = onMove;
  cropCanvas._sfUp = onUp;

  cropCanvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  cropCanvas.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", onUp);
}

function teardownCropInteraction() {
  if (!cropCanvas._sfDown) return;
  cropCanvas.removeEventListener("mousedown", cropCanvas._sfDown);
  window.removeEventListener("mousemove", cropCanvas._sfMove);
  window.removeEventListener("mouseup", cropCanvas._sfUp);
  cropCanvas.removeEventListener("touchstart", cropCanvas._sfDown);
  window.removeEventListener("touchmove", cropCanvas._sfMove);
  window.removeEventListener("touchend", cropCanvas._sfUp);
  cropCanvas._sfDown = cropCanvas._sfMove = cropCanvas._sfUp = null;
}

async function applyCropSelection() {
  if (!_cropImg || btnApplyCrop.disabled) return;
  const x0 = Math.min(_cropX0, _cropX1);
  const y0 = Math.min(_cropY0, _cropY1);
  const x1 = Math.max(_cropX0, _cropX1);
  const y1 = Math.max(_cropY0, _cropY1);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < CROP_MIN_PX || rh < CROP_MIN_PX) return;

  const fx = _cropImg.naturalWidth / cropCanvas.width;
  const fy = _cropImg.naturalHeight / cropCanvas.height;
  const sx = Math.max(0, Math.floor(x0 * fx));
  const sy = Math.max(0, Math.floor(y0 * fy));
  const sw = Math.min(_cropImg.naturalWidth - sx, Math.ceil(rw * fx));
  const sh = Math.min(_cropImg.naturalHeight - sy, Math.ceil(rh * fy));
  if (sw < CROP_MIN_PX || sh < CROP_MIN_PX) return;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(_cropImg, sx, sy, sw, sh, 0, 0, sw, sh);

  let blob = await new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("crop failed"))),
      "image/jpeg",
      VISION_JPEG_QUALITY,
    );
  });

  try {
    blob = await prepareImageForUpload(new File([blob], "crop.jpg", { type: "image/jpeg" }));
  } catch { /* そのまま */ }

  try {
    _currentImageBlob = blob;
    _imageBase64 = await blobToBase64(blob);
    _imageMediaType = "image/jpeg";
    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src = objUrl;
  } catch {
    showError("切り取り画像の保存に失敗しました。");
    return;
  }

  closeCropPanel();
  clearError();
}

// エンジンは Gemini 詳細に固定
function getSelectedEngine() { return "gemini-detailed"; }

// --- Analyze ---
let _isAnalyzing = false;
analyzeBtn.addEventListener("click", handleAnalyze);

function switchToTextInputTab() {
  document.querySelectorAll(".input-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === "text"),
  );
  document.getElementById("tab-text").style.display = "";
  document.getElementById("tab-image").style.display = "none";
}

document.getElementById("btn-extract-then-classify")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-extract-then-classify");
  clearError();
  btn.disabled = true;
  setLoading(true);
  try {
    switchToTextInputTab();
    await handleTextAnalyze();
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
});

async function handleAnalyze() {
  if (_isAnalyzing) return;
  _isAnalyzing = true;
  clearError();
  hideResult();
  setLoading(true);

  try {
    if (getActiveTab() === "image") {
      await handleImageAnalyze();
    } else {
      await handleTextAnalyze();
    }
  } finally {
    _isAnalyzing = false;
    setLoading(false);
  }
}

/**
 * テキスト欄の内容で API 判定（画像読み取り後の自動実行・手動ボタン共通）
 * @param {boolean} [recoverManualStepOnFail] 画像フローで失敗したとき「この内容で成分判定する」を再表示する
 */
async function classifyExtractedText(ingredientsText, recoverManualStepOnFail = false) {
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.setAttribute("hidden", "");
  try {
    const result = await analyzeWithClaude(ingredientsText);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false, ingredientsText);
  } catch (err) {
    showError(`解析エラー：${err.message}`);
    if (recoverManualStepOnFail) restoreExtractOnlyManualStep(ingredientsText);
  }
}

async function handleTextAnalyze() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  const ingredientsText = textarea.value.trim();
  if (!ingredientsText) {
    showError("成分表を入力してください。");
    return;
  }

  try {
    const result = await analyzeTextWithGemini(ingredientsText);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false, ingredientsText);
    refreshScanBadge();
  } catch (err) {
    if (err.message === "scan_limit_exceeded") {
      showError("今月の無料枠（10回）を使い切りました。来月リセットされます。");
      return;
    }
    showError(`解析エラー：${err.message}`);
  }
}

async function handleImageAnalyze() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  if (!_imageBase64) {
    showError("画像を選択してください。");
    return;
  }

  const engine = getSelectedEngine();
  if (engine === "gemini-detailed") {
    await handleImageAnalyzeGeminiDetailed();
    return;
  }
  if (engine === "gemini") {
    await handleImageAnalyzeGemini();
    return;
  }

  // --- Claude 2ステップ（既存フロー）---
  try {
    const { extractedText } = await extractTextFromImage(_imageBase64, _imageMediaType);
    const text = String(extractedText || "").trim();
    if (!text) {
      showError("読み取ったテキストが空です。写真の切り取りを試すか、別の画像を選んでください。");
      return;
    }
    clearError();
    switchToTextInputTab();
    textarea.value = text;
    renderExtractOnlyResult(text, { autoClassifyNext: true });
    await classifyExtractedText(text, true);
  } catch (err) {
    showError(`読み取りエラー：${err.message}`);
  }
}

async function handleImageAnalyzeGemini() {
  try {
    _comparePhotoDataUrl = `data:${_imageMediaType};base64,${_imageBase64}`;
    const { data, extractedText } = await analyzeImageWithGemini(_imageBase64, _imageMediaType);
    const text = String(extractedText || "").trim();
    clearError();
    switchToTextInputTab();
    if (text) textarea.value = text;
    const promoted = promoteFromUserDB(data);
    renderResult(promoted, false, text);
  } catch (err) {
    showError(`Gemini 解析エラー：${err.message}`);
  }
}

// =============================================
// Gemini 詳細モード（確信度 + BBox + ベジ判定）
// =============================================

async function handleImageAnalyzeGeminiDetailed() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  try {
    _comparePhotoDataUrl = `data:${_imageMediaType};base64,${_imageBase64}`;
    const { data, extractedText } = await analyzeImageWithGeminiDetailed(_imageBase64, _imageMediaType);
    const text = String(extractedText || "").trim();
    clearError();
    switchToTextInputTab();
    if (text) textarea.value = text;
    // 写真＋読み取りテキストをClaude フローと同様に表示
    renderExtractedAccordion(text, false);
    updateResultComparePhoto();
    renderDetailedResult(data, _comparePhotoDataUrl, text);
    refreshScanBadge();
  } catch (err) {
    if (err.message === "scan_limit_exceeded") {
      showError("今月の無料枠（10回）を使い切りました。来月リセットされます。");
    } else {
      showError(`Gemini 詳細解析エラー：${err.message}`);
    }
  }
}

/** bounding_box [ymin,xmin,ymax,xmax] (0-1000) の領域を共有 canvas にズーム描画 */
function drawZoom(imageDataUrl, bbox, caption) {
  const zoomArea   = document.getElementById('ingredient-zoom-area');
  const zoomCanvas = document.getElementById('zoom-canvas');
  const zoomCaption = document.getElementById('zoom-caption');
  if (!zoomArea || !zoomCanvas) return;

  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const pad = 0.25;

    const ymin = (bbox[0] / 1000) * h;
    const xmin = (bbox[1] / 1000) * w;
    const ymax = (bbox[2] / 1000) * h;
    const xmax = (bbox[3] / 1000) * w;

    const bw = xmax - xmin;
    const bh = ymax - ymin;
    const sx = Math.max(0, xmin - bw * pad);
    const sy = Math.max(0, ymin - bh * pad);
    const sw = Math.min(w - sx, bw * (1 + pad * 2));
    const sh = Math.min(h - sy, bh * (1 + pad * 2));

    const MAX_W = 380;
    zoomCanvas.width  = Math.min(MAX_W, sw * 2);
    zoomCanvas.height = Math.round(sh * (zoomCanvas.width / sw));
    zoomCanvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, zoomCanvas.width, zoomCanvas.height);

    if (zoomCaption) zoomCaption.textContent = caption || '';
    zoomArea.style.display = 'block';
    zoomArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  img.src = imageDataUrl;
}

document.getElementById('zoom-close-btn')?.addEventListener('click', () => {
  const el = document.getElementById('ingredient-zoom-area');
  if (el) el.style.display = 'none';
});

const VEGE_STATUS_CONFIG = {
  Red:    { icon: "❌", label: "NG", cls: "ng" },
  Yellow: { icon: "🟡", label: "要確認", cls: "gray" },
  Green:  { icon: "✅", label: "OK", cls: "ok" },
};

function buildDetailedItem(item, imageDataUrl) {
  const vcfg = VEGE_STATUS_CONFIG[item.vege_status] || VEGE_STATUS_CONFIG.Yellow;
  const confPct = Math.round(item.confidence * 100);
  const confCls = confPct >= 80 ? "conf-high" : confPct >= 60 ? "conf-mid" : "conf-low";
  const checkFlag = item.requires_user_check
    ? `<span class="check-flag">⚠ 要確認</span>` : "";

  const li = document.createElement("li");
  li.className = "detailed-item";
  li.innerHTML = `
    <div class="detailed-item-top">
      <span class="ing-name ${vcfg.cls}">${esc(item.text)}</span>
      ${checkFlag}
      <span class="conf-badge ${confCls}">${confPct}%</span>
    </div>
    <div class="ing-reason">${esc(item.reason)}</div>
    ${item.user_prompt ? `<div class="user-prompt-text">💬 ${esc(item.user_prompt)}</div>` : ""}
    ${item.requires_user_check && imageDataUrl && item.bounding_box
      ? `<button class="btn-zoom-bbox" data-bbox="${esc(JSON.stringify(item.bounding_box))}"
           data-caption="${esc(item.user_prompt || item.text)}">🔍 この箇所をズーム</button>`
      : ""}`;

  li.querySelector(".btn-zoom-bbox")?.addEventListener("click", (e) => {
    const bbox = JSON.parse(e.currentTarget.dataset.bbox);
    const caption = e.currentTarget.dataset.caption;
    drawZoom(imageDataUrl, bbox, caption);
  });
  return li;
}

function renderDetailedResult(data, imageDataUrl, extractedText) {
  const wrap = document.getElementById("detailed-result-wrap");
  if (!wrap) return;

  // overall バナーを final_decision から設定
  const decisionMap = { OK: "ok", NG: "ng", Pending: "gray" };
  const overall = decisionMap[data.final_decision] || "gray";
  const cfg = OVERALL_CONFIG[overall];
  document.getElementById("overall-icon").textContent    = overall === 'ng' ? '✕' : overall === 'ok' ? '✓' : '△';
  document.getElementById("overall-verdict").textContent = cfg.label;
  const bannerElD = document.getElementById("overall-banner");
  bannerElD.classList.remove('ng', 'ok', 'warn');
  bannerElD.classList.add(overall === 'gray' ? 'warn' : overall);
  document.getElementById("overall-summary").textContent =
    `Gemini 詳細モード / ${data.ingredients.length}件の成分を解析`;

  // 成分を vege_status でグループ化（Red→NG、Yellow→Gray、Green→OK）
  const groups = { Red: [], Yellow: [], Green: [] };
  for (const item of data.ingredients) {
    (groups[item.vege_status] || groups.Yellow).push(item);
  }

  const listMap = [
    { status: "Red",    listId: "ng-list",   headerId: "ng-header" },
    { status: "Yellow", listId: "gray-list",  headerId: "gray-header" },
    { status: "Green",  listId: "ok-list",    headerId: "ok-header" },
  ];

  for (const { status, listId, headerId } of listMap) {
    const items  = groups[status];
    const listEl = document.getElementById(listId);
    if (!listEl) continue;
    setHeaderCount(headerId, items.length);
    listEl.innerHTML = "";
    if (items.length === 0) { listEl.innerHTML = emptyLi(); continue; }
    for (const item of items) listEl.appendChild(buildDetailedItem(item, imageDataUrl));
  }

  document.getElementById("unknown-card").style.display = "none";

  // detailed-result-wrap はズームキャンバスのみ使用（内側のリストカードは非表示）
  const innerCard = wrap.querySelector(".result-list-card");
  if (innerCard) innerCard.style.display = "none";
  wrap.style.display = "block";

  updateResultComparePhoto();
  showResultResetBtn();
  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });

  _lastExtractedText = extractedText || null;
  window._lastAnalysisResult = { overall };
  showSaveButtonIfSafe({ overall }, extractedText, currentSessionMode);
  showFeedbackButton({ overall }, extractedText);
}

function hideDetailedResult() {
  const wrap = document.getElementById("detailed-result-wrap");
  if (wrap) {
    wrap.style.display = "none";
    const innerCard = wrap.querySelector(".result-list-card");
    if (innerCard) innerCard.style.display = "";
  }
  const zoomArea = document.getElementById("ingredient-zoom-area");
  if (zoomArea) zoomArea.style.display = "none";
}

/**
 * 画像→テキストのみ成功時、またはその直後の自動判定待ち UI
 * @param {{ autoClassifyNext?: boolean }} [options] true のとき手動ボタンを隠し「判定中」を表示（自動解析直前）
 */
function renderExtractOnlyResult(extractedText, options = {}) {
  const autoClassifyNext = options.autoClassifyNext === true;
  const text = String(extractedText || "").trim();
  if (!text) {
    showError("読み取ったテキストが空です。写真の切り取りを試すか、別の画像を選んでください。");
    return;
  }
  clearError();
  textarea.value = text;
  if (_imageBase64 && _imageMediaType) {
    _comparePhotoDataUrl = `data:${_imageMediaType};base64,${_imageBase64}`;
  }

  const banner = document.getElementById("overall-banner");
  banner.classList.remove('ng', 'ok', 'warn');
  document.getElementById("overall-icon").textContent = "📄";
  const extractActions = document.getElementById("extract-only-actions");

  if (autoClassifyNext) {
    document.getElementById("overall-verdict").textContent = "判別中";
    document.getElementById("overall-summary").textContent =
      "読み取ったテキストで成分判定を実行しています。しばらくお待ちください。";
    if (extractActions) extractActions.setAttribute("hidden", "");
  } else {
    document.getElementById("overall-verdict").textContent = "読み取りのみ完了（判定は未実行）";
    document.getElementById("overall-summary").textContent =
      "テキスト欄に読み取り結果を入れました。余分な行を直したあと、下のボタンで成分判定に進めます。";
    if (extractActions) extractActions.removeAttribute("hidden");
  }

  renderExtractedAccordion(text, true);
  renderNgList([]);
  renderGrayList([]);
  renderOkList([]);
  renderUnknownList([]);
  updateUserDBBadge();

  const dbNote = document.querySelector(".user-db-note");
  if (dbNote) dbNote.style.display = "none";

  updateResultComparePhoto();
  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 自動判定に失敗したあと、手動で「この内容で成分判定する」を出す */
function restoreExtractOnlyManualStep(ingredientsText) {
  const banner = document.getElementById("overall-banner");
  banner.classList.remove('ng', 'ok', 'warn');
  document.getElementById("overall-icon").textContent = "📄";
  document.getElementById("overall-verdict").textContent = "読み取りのみ完了（判定は未実行）";
  document.getElementById("overall-summary").textContent =
    "テキスト欄に読み取り結果を入れました。余分な行を直したあと、下のボタンで成分判定に進めます。";
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.removeAttribute("hidden");
  if (ingredientsText != null) textarea.value = String(ingredientsText);
}

/**
 * ユーザーが過去に検証した成分を unknown から正しい分類へ移動
 */
function promoteFromUserDB(result) {
  if (!result.unknown || result.unknown.length === 0) return result;

  const promoted = { ...result, unknown: [] };

  for (const item of result.unknown) {
    const saved = lookupUserDB(item.name);
    if (saved) {
      const entry = { name: item.name, reason: saved.reason + "（ユーザー確認済み）" };
      if (saved.category === "ok")   promoted.ok   = [...(promoted.ok   || []), entry];
      if (saved.category === "gray") promoted.gray = [...(promoted.gray || []), { ...entry, detail: null }];
      if (saved.category === "ng")   promoted.ng   = [...(promoted.ng   || []), entry];
    } else {
      promoted.unknown.push(item);
    }
  }

  if ((promoted.ng || []).length > 0)                                       promoted.overall = "ng";
  else if ((promoted.gray || []).length > 0 || (promoted.unknown || []).length > 0) promoted.overall = "gray";
  else                                                                       promoted.overall = "ok";

  return promoted;
}


let _lastAnalysisResult = null;
let _lastExtractedText  = null;

// --- Result rendering ---
const OVERALL_CONFIG = {
  ok:   { icon: "✅", label: "オリエンタルベジタリアンとして食べられます" },
  gray: { icon: "🟡", label: "由来確認が必要な成分があります" },
  ng:   { icon: "❌", label: "このモードでは食べられません" },
};

function renderResult(result, isOffline, extractedText) {
  console.log('判定結果オブジェクト:', JSON.stringify(result));
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.setAttribute("hidden", "");

  const dbNote = document.querySelector(".user-db-note");
  if (dbNote) dbNote.style.display = "";

  const cfg = OVERALL_CONFIG[result.overall] || OVERALL_CONFIG.gray;
  document.getElementById("overall-icon").textContent = result.overall === 'ng' ? '✕' : result.overall === 'ok' ? '✓' : '△';

  const verdict = document.getElementById("overall-verdict");
  verdict.textContent = cfg.label;

  const summaryEl = document.getElementById("overall-summary");
  summaryEl.textContent = result.summary + (isOffline ? "（オフライン判定）" : "");

  const bannerEl = document.getElementById("overall-banner");
  bannerEl.classList.remove('ng', 'ok', 'warn');
  bannerEl.classList.add(result.overall === 'gray' ? 'warn' : (result.overall || 'warn'));

  renderExtractedAccordion(extractedText, false);
  renderNgList(result.ng || []);
  renderGrayList(result.gray || []);
  renderOkList(result.ok || []);
  renderUnknownList(result.unknown || []);
  updateUserDBBadge();

  _lastExtractedText = extractedText || null;

  updateResultComparePhoto();
  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });

  window._lastAnalysisResult = result;
  showSaveButtonIfSafe(result, extractedText, currentSessionMode);
  showFeedbackButton(result, extractedText);
}

function showSaveButtonIfSafe(result, ingredientText, currentMode) {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (!saveArea || !getAuthToken()) return;

  const overall = result?.overall;

  if (overall === 'ok') {
    saveArea.style.display = 'block';
    saveArea.dataset.ingredientText = ingredientText;
    saveArea.dataset.dietMode = currentMode;

  } else if (overall === 'gray') {
    saveArea.style.display = 'block';
    saveArea.dataset.ingredientText = ingredientText;
    saveArea.dataset.dietMode = currentMode;

    const note = saveArea.querySelector('.save-gray-note')
      || document.createElement('p');
    note.className = 'save-gray-note';
    note.textContent = '由来確認が必要な成分が含まれています。ご自身でOKと判断した場合のみ登録してください。';
    saveArea.insertBefore(note, saveArea.firstChild);

  } else {
    saveArea.style.display = 'none';
  }
}

function showFeedbackButton(result, ingredientText) {
  const area = document.getElementById('feedback-area');
  if (!area) return;

  const overall = result?.overall ?? '';
  const overallLabel =
    overall === 'ok'   ? '✅ 安全' :
    overall === 'gray' ? '🟡 グレー（由来確認が必要）' :
    overall === 'ng'   ? '❌ NG' : '不明';

  const formUrl = new URL(
    'https://docs.google.com/forms/d/e/1FAIpQLScVzJR3QHoFgF7-4gb6E0CFmmBlYUsaU9atqYLhU52lUA25Fg/viewform'
  );
  formUrl.searchParams.set('entry.89304498', overallLabel);
  formUrl.searchParams.set('entry.1427059370',
    (ingredientText ?? '').slice(0, 300));

  const btn = document.getElementById('btn-feedback');
  if (btn) {
    btn.onclick = () => window.open(formUrl.toString(), '_blank');
  }

  area.style.display = 'block';
}

function renderExtractedAccordion(text, openNow) {
  const accordion = document.getElementById("extracted-accordion");
  if (!text) { accordion.style.display = "none"; return; }
  document.getElementById("extracted-text").textContent = text;
  accordion.style.display = "";
  accordion.open = !!openNow;
}

function renderNgList(items) {
  setHeaderCount("ng-header", items.length);
  const list = document.getElementById("ng-list");
  list.innerHTML = "";
  if (items.length === 0) { list.innerHTML = emptyLi(); return; }
  items.forEach(({ name, reason }) => {
    list.appendChild(makeLi(`<span class="ing-name">${esc(name)}</span><span class="ing-reason">${esc(reason || "")}</span>`));
  });
}

function renderGrayList(items) {
  setHeaderCount("gray-header", items.length);
  const list = document.getElementById("gray-list");
  list.innerHTML = "";
  if (items.length === 0) { list.innerHTML = emptyLi(); return; }
  items.forEach(({ name, reason, detail }) => {
    list.appendChild(makeLi(`
      <span class="ing-name">${esc(name)}</span>
      <span class="ing-reason">${esc(reason || "")}</span>
      ${detail ? `<div class="ing-detail">${esc(detail)}</div>` : ""}
    `));
  });
}

function renderOkList(items) {
  setHeaderCount("ok-header", items.length);
  const list = document.getElementById("ok-list");
  list.innerHTML = "";
  if (items.length === 0) { list.innerHTML = emptyLi(); return; }
  items.forEach(({ name, reason }) => {
    list.appendChild(makeLi(`<span class="ing-name">${esc(name)}</span><span class="ing-reason">${esc(reason || "")}</span>`));
  });
}

function renderUnknownList(items) {
  const card = document.getElementById("unknown-card");
  const list  = document.getElementById("unknown-list");
  setHeaderCount("unknown-header", items.length);

  if (items.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";
  list.innerHTML = "";

  items.forEach(({ name, inferred, confidence, reason }) => {
    const li = document.createElement("li");
    const confLabel = { low: "推測・低", medium: "推測・中", high: "推測・高" }[confidence] || "推測";

    li.innerHTML = `
      <span class="ing-name">
        ${esc(name)}
        <span class="inferred-badge ${esc(confidence)}">🔍 ${esc(confLabel)}</span>
      </span>
      <span class="ing-reason">推定分類: ${inferredLabel(inferred)}</span>
      <span class="ing-inferred-reason">${esc(reason || "")}</span>
      <div class="feedback-row" data-name="${esc(name)}">
        <span class="feedback-label">この成分の正解を教えてください:</span>
        <div class="feedback-btns">
          <button class="fb-btn fb-ok"   data-cat="ok">✅ OK</button>
          <button class="fb-btn fb-gray" data-cat="gray">🟡 グレー</button>
          <button class="fb-btn fb-ng"   data-cat="ng">❌ NG</button>
        </div>
        <div class="feedback-reason-row" style="display:none">
          <input class="fb-reason-input" type="text" placeholder="理由（任意）" maxlength="100">
          <button class="fb-save-btn">保存</button>
        </div>
        <div class="feedback-saved" style="display:none">✓ 保存しました。次回からこの成分は自動分類されます。</div>
      </div>`;

    li.querySelectorAll(".fb-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        li.querySelectorAll(".fb-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        li.querySelector(".feedback-reason-row").style.display = "flex";
        li.querySelector(".fb-reason-input").dataset.category = btn.dataset.cat;
      });
    });

    li.querySelector(".fb-save-btn").addEventListener("click", async () => {
      const input    = li.querySelector(".fb-reason-input");
      const category = input.dataset.category;
      const reason   = input.value.trim() || `ユーザーが「${inferredLabel(category).replace(/[✅🟡❌（推測）]/g, "").trim()}」と確認`;
      if (!category) return;

      await saveUserIngredient(name, category, reason);
      li.querySelector(".feedback-reason-row").style.display = "none";
      li.querySelector(".feedback-saved").style.display = "block";
      li.querySelectorAll(".fb-btn").forEach((b) => b.disabled = true);
      updateUserDBBadge();
    });

    list.appendChild(li);
  });
}

function inferredLabel(inferred) {
  return { ok: "✅ OK（推測）", gray: "🟡 グレー（推測）", ng: "❌ NG（推測）" }[inferred] || "不明";
}

function updateUserDBBadge() {
  const badge = document.getElementById("user-db-count");
  if (!badge) return;
  const count = getUserDBCount();
  badge.textContent = count > 0 ? `${count}件の検証済み成分` : "";
  badge.style.display = count > 0 ? "inline" : "none";
}

// --- UI helpers ---
function setHeaderCount(headerId, count) {
  const el = document.getElementById(headerId);
  if (el) el.querySelector(".ee-result-count").textContent = `${count}件`;
}
function makeLi(html) {
  const li = document.createElement("li");
  li.innerHTML = html;
  return li;
}
function emptyLi() { return `<li class="empty-list">なし</li>`; }

function setLoading(on) {
  analyzeBtn.disabled = on;
  analyzeBtn.classList.toggle("loading", on);
  const onImageTab = getActiveTab() === "image";
  document.querySelector(".btn-label").textContent = on
    ? "解析中..."
    : onImageTab ? "この画像で読み取る" : "成分を解析する";
}
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("visible");
}
function clearError() {
  errorBox.classList.remove("visible");
  errorBox.textContent = "";
}
function showResultResetBtn() {
  const wrap = document.getElementById("result-reset-wrap");
  if (wrap) wrap.style.display = "";
}
function hideResultResetBtn() {
  const wrap = document.getElementById("result-reset-wrap");
  if (wrap) wrap.style.display = "none";
}

document.getElementById("btn-result-reset")?.addEventListener("click", () => {
  clearImage();
  hideResult();
  textarea.value = "";
  clearError();
  window.scrollTo({ top: 0, behavior: "smooth" });
  // 写真タブに切り替えてカメラを使いやすくする
  document.querySelectorAll(".input-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === "image"),
  );
  document.getElementById("tab-text").style.display  = "none";
  document.getElementById("tab-image").style.display = "";
});

function hideResult() {
  resultSection.classList.remove("visible");
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.setAttribute("hidden", "");
  hideDetailedResult();
  hideResultResetBtn();
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

updateUserDBBadge();

// =============================================
// 認証 UI
// =============================================

async function refreshScanBadge() {
  const badge = document.getElementById("scan-badge");
  if (!badge) return;
  const token = localStorage.getItem("safeat_auth_token");
  if (!token) return;
  try {
    const res = await fetch(`${SAFEAT_API_URL}/api/user/scan-count`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok) {
      badge.textContent = `残り ${data.remaining} 回`;
      badge.classList.toggle("exhausted", data.remaining === 0);
    }
  } catch {}
}

function openAuthModal(mode = "login") {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  modal.removeAttribute("hidden");
  setAuthModalMode(mode);
  setTimeout(() => document.getElementById("auth-email")?.focus(), 50);
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.setAttribute("hidden", "");
  const err = document.getElementById("auth-error");
  if (err) { err.textContent = ""; err.className = "auth-error"; }
}

function setAuthModalMode(mode) {
  const form = document.getElementById("auth-form");
  if (form) form.dataset.mode = mode;
  const title = document.getElementById("auth-form-title");
  if (title) title.textContent = mode === "login" ? "ログイン" : "新規登録";
  const label = document.getElementById("auth-submit-label");
  if (label) label.textContent = mode === "login" ? "ログイン" : "登録する";
  const toggle = document.getElementById("auth-toggle-btn");
  if (toggle) toggle.textContent = mode === "login" ? "新規登録はこちら" : "ログインはこちら";
  const forgot = document.getElementById("auth-forgot-btn");
  if (forgot) forgot.style.display = mode === "login" ? "" : "none";
}

async function updateAuthUI(session) {
  const area = document.getElementById("auth-area");
  if (!area) return;

  if (session?.user) {
    const token = session.access_token;
    let remaining = "?";
    let plan = "free";
    try {
      const r = await fetch(`${SAFEAT_API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.ok) { remaining = d.data.remaining; plan = d.data.plan; }
    } catch {}

    const email = esc(session.user.email);
    const badgeHtml = plan === "free"
      ? `<span class="scan-badge${remaining === 0 ? " exhausted" : ""}" id="scan-badge">残り ${remaining} 回</span>`
      : `<span class="scan-badge-unlimited">✨ 無制限</span>`;

    area.innerHTML = `
      ${badgeHtml}
      <div class="user-icon-wrap" id="user-icon-wrap" title="${email}">
        <span class="user-icon-inner">👤</span>
        <span class="user-tooltip">${email}</span>
      </div>`;
  } else {
    area.innerHTML = `
      <button class="btn-auth" id="btn-open-login" type="button">ログイン</button>
      <button class="btn-auth-outline" id="btn-open-signup" type="button">新規登録</button>`;
    document.getElementById("btn-open-login")?.addEventListener("click", () => openAuthModal("login"));
    document.getElementById("btn-open-signup")?.addEventListener("click", () => openAuthModal("signup"));
  }
}

document.getElementById("auth-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!window.SafeEatAuth) return;

  const mode     = e.currentTarget.dataset.mode || "login";
  const email    = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errEl    = document.getElementById("auth-error");
  const spinner  = document.getElementById("auth-spinner");
  const submitBtn = document.getElementById("auth-submit-btn");

  errEl.textContent = "";
  errEl.className = "auth-error";
  submitBtn.disabled = true;
  if (spinner) spinner.style.display = "";

  try {
    if (mode === "login") {
      const { error } = await window.SafeEatAuth.signIn(email, password);
      if (error) { errEl.textContent = error.message; return; }
      closeAuthModal();
    } else {
      const { error } = await window.SafeEatAuth.signUp(email, password);
      if (error) { errEl.textContent = error.message; return; }
      errEl.className = "auth-error success";
      errEl.textContent = "確認メールを送信しました。メール内のリンクをクリックしてログインしてください。";
    }
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
  }
});

document.getElementById("auth-modal-close")?.addEventListener("click", closeAuthModal);
document.getElementById("auth-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAuthModal();
});
document.getElementById("auth-toggle-btn")?.addEventListener("click", () => {
  const mode = document.getElementById("auth-form")?.dataset.mode;
  setAuthModalMode(mode === "login" ? "signup" : "login");
  document.getElementById("auth-error").textContent = "";
});
document.getElementById("auth-forgot-btn")?.addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const errEl = document.getElementById("auth-error");
  if (!email) { errEl.textContent = "メールアドレスを入力してください。"; return; }
  await window.SafeEatAuth?.resetPassword(email);
  errEl.className = "auth-error success";
  errEl.textContent = "リセットメールを送信しました。";
});

if (window.SafeEatAuth) {
  window.SafeEatAuth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      localStorage.setItem("safeat_auth_token", session.access_token);
    } else {
      localStorage.removeItem("safeat_auth_token");
    }
    updateAuthUI(session);
  });
  window.SafeEatAuth.getSession().then((session) => updateAuthUI(session));
} else {
  updateAuthUI(null);
}

// =============================================
// カメラ直接撮影（枠合わせ）
// =============================================

let _cameraStream = null;

const btnOpenCamera    = document.getElementById("btn-open-camera");
const cameraOverlay    = document.getElementById("camera-overlay");
const cameraVideo      = document.getElementById("camera-video");
const cameraGuideBox   = document.getElementById("camera-guide-box");
const btnCameraCapture = document.getElementById("btn-camera-capture");
const btnCameraCancel  = document.getElementById("btn-camera-cancel");

if (btnOpenCamera) btnOpenCamera.style.display = "inline-block";

btnOpenCamera?.addEventListener("click", (e) => {
  e.stopPropagation();
  openCameraOverlay();
});

btnCameraCapture?.addEventListener("click", () => captureFromCamera());
btnCameraCancel?.addEventListener("click",  () => closeCameraOverlay());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cameraOverlay && !cameraOverlay.hidden) closeCameraOverlay();
});

async function openCameraOverlay() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      if (err.name === "NotAllowedError") {
        showError("カメラのアクセスが拒否されています。ブラウザの設定でカメラを許可してください。");
        return;
      }
      // getUserMedia 非対応端末は file input にフォールバック
      await showGuideAndCapture();
      return;
    }
  }
  _cameraStream = stream;
  cameraVideo.srcObject = stream;
  try { await cameraVideo.play(); } catch { /* autoplay属性で再生済みの場合は無視 */ }

  // 映像が実際に取得できているか確認（真っ暗＝0x0 の場合は file input fallback）
  await new Promise(r => setTimeout(r, 600));
  if (cameraVideo.videoWidth === 0) {
    closeCameraOverlay();
    await showGuideAndCapture();
    return;
  }

  cameraOverlay.removeAttribute("hidden");
}

// ネイティブカメラ使用時：撮影前にガイド枠を見せてから開く
function showGuideAndCapture() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.88)',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'gap:20px', 'padding:24px',
    ].join(';');

    const frame = document.createElement('div');
    frame.style.cssText = [
      'width:80%', 'aspect-ratio:3/2',
      'border:3px dashed #fff', 'border-radius:8px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'color:#fff', 'font-size:13px', 'text-align:center', 'padding:12px',
    ].join(';');
    frame.textContent = '原材料名・成分表示をこの枠に合わせて撮影してください';

    const hint = document.createElement('p');
    hint.style.cssText = 'color:#ccc;font-size:13px;text-align:center;margin:0;';
    hint.textContent = '近づいて成分表だけが枠内に入るようにしてください';

    const btnShoot = document.createElement('button');
    btnShoot.textContent = '📷 カメラを開く';
    btnShoot.style.cssText = [
      'padding:12px 32px', 'font-size:16px', 'font-weight:bold',
      'background:#1565c0', 'color:#fff',
      'border:none', 'border-radius:8px', 'cursor:pointer',
    ].join(';');

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'キャンセル';
    btnCancel.style.cssText = [
      'padding:8px 24px', 'font-size:14px',
      'background:transparent', 'color:#aaa',
      'border:1px solid #666', 'border-radius:8px', 'cursor:pointer',
    ].join(';');

    overlay.append(frame, hint, btnShoot, btnCancel);
    document.body.appendChild(overlay);

    btnShoot.addEventListener('click', () => {
      document.body.removeChild(overlay);
      imageInput.click();
      resolve();
    });
    btnCancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve();
    });
  });
}

function closeCameraOverlay() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach((t) => t.stop());
    _cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraOverlay.setAttribute("hidden", "");
}

function captureFromCamera() {
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  if (!vw || !vh) {
    showError("カメラの準備ができていません。少し待ってから撮影してください。");
    return;
  }

  const videoRect = cameraVideo.getBoundingClientRect();
  const guideRect = cameraGuideBox.getBoundingClientRect();

  // object-fit:cover の座標変換（表示座標 → 動画ピクセル座標）
  const scale = Math.max(videoRect.width / vw, videoRect.height / vh);
  const xOrig = (videoRect.width  - vw * scale) / 2;
  const yOrig = (videoRect.height - vh * scale) / 2;

  const gLeft = guideRect.left - videoRect.left;
  const gTop  = guideRect.top  - videoRect.top;

  const cropX = Math.max(0, (gLeft - xOrig) / scale);
  const cropY = Math.max(0, (gTop  - yOrig) / scale);
  const cropW = Math.min(guideRect.width  / scale, vw - cropX);
  const cropH = Math.min(guideRect.height / scale, vh - cropY);

  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(cropW);
  canvas.height = Math.round(cropH);
  canvas.getContext("2d").drawImage(
    cameraVideo,
    Math.round(cropX), Math.round(cropY), Math.round(cropW), Math.round(cropH),
    0, 0, canvas.width, canvas.height,
  );

  canvas.toBlob(async (rawBlob) => {
    closeCameraOverlay();
    if (!rawBlob) { showError("撮影に失敗しました。もう一度試してください。"); return; }
    let blob = rawBlob;
    try {
      blob = await prepareImageForUpload(new File([rawBlob], "camera.jpg", { type: "image/jpeg" }));
    } catch { /* リサイズ失敗時はそのまま */ }
    await setProcessedBlob(blob);
  }, "image/jpeg", 0.92);
}

// カメラ撮影後の共通後処理（既存フローと合流）
async function setProcessedBlob(blob) {
  try {
    _currentImageBlob = blob;
    _imageBase64      = await blobToBase64(blob);
    _imageMediaType   = "image/jpeg";

    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src    = objUrl;
    imagePreview.style.display    = "block";
    dropPlaceholder.style.display = "none";
    clearImageBtn.style.display   = "inline-block";
    imageToolbar.style.display    = "block";
    cropPanel.style.display       = "none";
    dropZone.classList.add("has-image");
    clearError();
    requestAnimationFrame(() =>
      imageToolbar?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  } catch {
    showError("撮影した画像の処理に失敗しました。");
  }
}

function applyModeDisplay(mode) {
  const def = MODE_DEFINITIONS[mode] || MODE_DEFINITIONS.oriental;
  currentSessionMode = mode;

  const title = document.getElementById('mode-info-title');
  if (title) title.textContent = def.label;

  const rulesEl = document.getElementById('mode-info-rules');
  if (rulesEl) {
    rulesEl.innerHTML = def.rules
      .map(r => `<div class="mode-rule-row ${r.type}">${r.type === 'ng' ? '❌' : '✅'} ${r.text}</div>`)
      .join('');
  }

  const modebarLabel = document.getElementById('modebar-label');
  if (modebarLabel) modebarLabel.textContent = def.modebarLabel;
}

// ===== ページ切り替え（ランディング / モード選択 / スキャン） =====
(function () {
  const landing    = document.getElementById('landing-page');
  const modeSelect = document.getElementById('mode-select-page');
  const scanner    = document.getElementById('scanner-page');

  // 現在のセッションとナビゲーション済みフラグ
  let _session = null;
  let _hasNavigated = false;

  function showPage(page) {
    const allPages = [
      document.getElementById('landing-page'),
      document.getElementById('mode-select-page'),
      document.getElementById('scanner-page'),
      document.getElementById('user-settings-page'),
      document.getElementById('mylist-page'),
      document.getElementById('save-barcode-page'),
    ];
    allPages.forEach(p => { if (p) p.style.display = 'none'; });
    if (page) page.style.display = 'block';
  }

  async function handleSession(session) {
    _session = session;
    if (!session) {
      _hasNavigated = false;
      showPage(landing);
      const registerLink = document.getElementById('drawer-nav-register');
      if (registerLink) registerLink.style.display = 'none';
      return;
    }
    // 一度スキャナーに到達済み かつ スキャナーページが表示中なら再ナビゲート不要
    // （iOSカメラ復帰・タブ切替などで onAuthStateChange が再発火しても無視）
    if (_hasNavigated && scanner && scanner.style.display !== 'none') return;
    try {
      const res = await fetch(`${SAFEAT_API_URL}/api/user/settings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      const settings = data?.data || {};
      const registerLink = document.getElementById('drawer-nav-register');
      if (registerLink) registerLink.style.display = '';
      if (!settings.mode_selected) {
        showPage(modeSelect);
      } else {
        applyModeDisplay(settings.mode || 'oriental');
        _hasNavigated = true;
        showPage(scanner);
      }
    } catch {
      // ネットワークエラーなど fetch 失敗時：初回未ナビゲートのみモード選択へ
      if (!_hasNavigated) showPage(modeSelect);
    }
  }

  if (window.SafeEatAuth) {
    window.SafeEatAuth.getSession().then((session) => handleSession(session));
    window.SafeEatAuth.onAuthStateChange((_event, session) => handleSession(session));
  }

  // モード選択カードのクリック
  document.querySelectorAll('.mode-select-card:not([disabled])').forEach(card => {
    card.addEventListener('click', async () => {
      const mode = card.dataset.mode;
      try {
        const token = _session?.access_token || localStorage.getItem('safeat_auth_token');
        await fetch(`${SAFEAT_API_URL}/api/user/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode, mode_selected: true }),
        });
      } catch {}
      _hasNavigated = true;
      applyModeDisplay(mode);
      showPage(scanner);
    });
  });

  // モードバー ドロップダウン（一時切替）
  const modeBtn      = document.getElementById('btn-mode-switch');
  const modeDropdown = document.getElementById('modebar-dropdown');
  modeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdown.style.display = modeDropdown.style.display !== 'none' ? 'none' : 'block';
  });
  document.querySelectorAll('.modebar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyModeDisplay(btn.dataset.mode);
      modeDropdown.style.display = 'none';
    });
  });
  document.addEventListener('click', (e) => {
    if (!modeBtn?.contains(e.target) && modeDropdown) modeDropdown.style.display = 'none';
  });

  // 「無料で始める」ボタン
  document.getElementById('btn-hero-signup')
    ?.addEventListener('click', () => openAuthModal('signup'));
  document.getElementById('btn-pricing-signup')
    ?.addEventListener('click', () => openAuthModal('signup'));

  // URLハッシュ #signup で新規登録モーダルを自動表示
  // ランディングページの「成分をチェックする」ボタンから飛んできた場合に対応
  if (window.location.hash === '#signup') {
    setTimeout(() => openAuthModal('signup'), 300);
    history.replaceState(null, '', window.location.pathname);
  }
})();

// ===== 共通ページ切替ユーティリティ =====
const _ALL_PAGES = ['landing-page', 'mode-select-page', 'scanner-page', 'user-settings-page', 'mylist-page', 'save-barcode-page'];
function showById(id) {
  if (window._stopBarcodeScanner) window._stopBarcodeScanner();
  _ALL_PAGES.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = 'none';
  });
  const page = document.getElementById(id);
  if (page) page.style.display = 'block';
}

// ===== ヘッダーナビ =====
(function () {
  document.getElementById('nav-top')?.addEventListener('click', (e) => {
    e.preventDefault();
    showById('landing-page');
    window.scrollTo(0, 0);
  });

  document.getElementById('nav-app')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!window.SafeEatAuth) return;
    window.SafeEatAuth.getSession().then((session) => {
      if (session?.user) {
        showById('scanner-page');
      } else {
        openAuthModal('login');
      }
    });
  });
})();

// ===== ハンバーガーメニュー =====
(function () {
  const hamburger     = document.getElementById('btn-hamburger');
  const drawerMenu    = document.getElementById('drawer-menu');
  const drawerClose   = document.getElementById('drawer-close');
  const drawerOverlay = document.getElementById('drawer-overlay');

  function openDrawer() {
    hamburger?.classList.add('is-open');
    drawerMenu?.classList.add('is-open');
    drawerMenu?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    hamburger?.classList.remove('is-open');
    drawerMenu?.classList.remove('is-open');
    drawerMenu?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window.closeDrawer = closeDrawer;

  hamburger?.addEventListener('click', openDrawer);
  drawerClose?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);

  document.getElementById('drawer-nav-top')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeDrawer();
    showById('landing-page');
    window.scrollTo(0, 0);
  });

  document.getElementById('drawer-nav-app')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeDrawer();
    if (!window.SafeEatAuth) return;
    window.SafeEatAuth.getSession().then((session) => {
      if (session?.user) {
        showById('scanner-page');
      } else {
        openAuthModal('login');
      }
    });
  });
})();

// ===== ロゴクリックでトップへ =====
document.getElementById('btn-logo-home')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (!window.SafeEatAuth) return;
  window.SafeEatAuth.getSession().then((session) => {
    ['landing-page', 'mode-select-page', 'scanner-page', 'user-settings-page'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const target = session?.user ? 'scanner-page' : 'landing-page';
    const page = document.getElementById(target);
    if (page) page.style.display = 'block';
  });
});

// ===== ユーザーアイコン タップでツールチップ表示（スマホ対応）=====
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('user-icon-wrap');
  if (!wrap) return;
  if (wrap.contains(e.target)) {
    wrap.classList.toggle('tooltip-visible');
  } else {
    wrap.classList.remove('tooltip-visible');
  }
});

// ===== ユーザー設定ページ =====
(function () {
  const userSettingsPage = document.getElementById('user-settings-page');
  const scannerPage      = document.getElementById('scanner-page');

  document.getElementById('btn-user-page')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await openUserSettings();
  });

  document.getElementById('btn-settings-back')?.addEventListener('click', () => {
    if (userSettingsPage) userSettingsPage.style.display = 'none';
    if (scannerPage)      scannerPage.style.display = 'block';
  });

  document.getElementById('btn-settings-logout')?.addEventListener('click', () => {
    window.SafeEatAuth?.signOut();
  });

  document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="settings-mode"]:checked');
    if (!selected) return;

    const mode    = selected.value;
    const spinner = document.getElementById('settings-spinner');
    const label   = document.getElementById('settings-save-label');
    const msg     = document.getElementById('settings-save-msg');
    const btn     = document.getElementById('btn-settings-save');

    btn.disabled = true;
    if (spinner) spinner.style.display = '';
    label.textContent = '保存中...';
    msg.textContent = '';
    msg.className = 'settings-save-msg';

    try {
      const token = localStorage.getItem('safeat_auth_token');
      const res = await fetch(`${SAFEAT_API_URL}/api/user/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode, mode_selected: true }),
      });
      const data = await res.json();
      if (data.ok) {
        msg.textContent = '✅ 保存しました';
        msg.className = 'settings-save-msg success';
        applyModeDisplay(mode);
        setTimeout(() => {
          if (userSettingsPage) userSettingsPage.style.display = 'none';
          if (scannerPage)      scannerPage.style.display = 'block';
        }, 1500);
      } else {
        throw new Error(data.error || '保存に失敗しました');
      }
    } catch (err) {
      msg.textContent = `❌ ${err.message}`;
      msg.className = 'settings-save-msg error';
    } finally {
      btn.disabled = false;
      if (spinner) spinner.style.display = 'none';
      label.textContent = 'この設定を保存する';
    }
  });

  async function openUserSettings() {
    if (scannerPage)      scannerPage.style.display = 'none';
    if (userSettingsPage) userSettingsPage.style.display = 'block';

    try {
      const token = localStorage.getItem('safeat_auth_token');

      const meRes  = await fetch(`${SAFEAT_API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meData = await meRes.json();
      if (meData.ok) {
        const d = meData.data;
        const emailEl     = document.getElementById('settings-email');
        const planEl      = document.getElementById('settings-plan');
        const remainingEl = document.getElementById('settings-remaining');
        if (emailEl)     emailEl.textContent    = d.email || '—';
        if (planEl)      planEl.textContent      = d.plan === 'free' ? '無料プラン' : d.plan;
        if (remainingEl) remainingEl.textContent = `${d.remaining} 回`;
      }

      const settingsRes  = await fetch(`${SAFEAT_API_URL}/api/user/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const settingsData = await settingsRes.json();
      const currentMode  = settingsData?.data?.mode || 'oriental';
      const radio = document.querySelector(`input[name="settings-mode"][value="${currentMode}"]`);
      if (radio) radio.checked = true;

      const adminRes  = await fetch(`${SAFEAT_API_URL}/api/admin/check`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const adminData = await adminRes.json();
      const adminLinkEl = document.getElementById('settings-admin-link');
      if (adminLinkEl) {
        adminLinkEl.style.display = (adminData.ok && adminData.isAdmin) ? 'block' : 'none';
      }
    } catch (err) {
      console.error('設定ページの情報取得に失敗:', err);
    }
  }
})();

// ===== バーコードスキャン・マイリスト保存 =====
(function () {
  let _html5QrCode = null;
  let _scannedProduct = null;

  async function stopBarcodeScanner() {
    if (_html5QrCode) {
      try { await _html5QrCode.stop(); } catch (e) { /* ignore */ }
      _html5QrCode = null;
    }
  }

  function closeBarcodeArea() {
    stopBarcodeScanner();
    _scannedProduct = null;
    const area = document.getElementById('barcode-scan-area');
    const preview = document.getElementById('barcode-result-preview');
    const errEl = document.getElementById('barcode-scan-error');
    if (area) area.style.display = 'none';
    if (preview) preview.style.display = 'none';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }

  window._stopBarcodeScanner = stopBarcodeScanner;

  document.getElementById('btn-save-product-open')?.addEventListener('click', async () => {
    if (!window.SafeEatAuth) return;
    const area = document.getElementById('barcode-scan-area');
    if (!area) return;
    area.style.display = '';
    document.getElementById('barcode-result-preview').style.display = 'none';
    document.getElementById('barcode-scan-error').style.display = 'none';

    const errEl = document.getElementById('barcode-scan-error');
    try {
      _html5QrCode = new Html5Qrcode('qr-reader');
      await _html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        },
        async (decodedText) => {
          await stopBarcodeScanner();
          errEl.style.display = 'none';
          try {
            const product = await lookupProduct(decodedText);
            _scannedProduct = product;
            document.getElementById('barcode-product-name').textContent = product.product_name;
            const img = document.getElementById('barcode-product-image');
            img.src = product.image_url || '';
            img.style.display = product.image_url ? '' : 'none';
            const link = document.getElementById('barcode-product-link');
            link.href = product.shop_url || '#';
            const amazonLink = document.getElementById('barcode-amazon-link');
            const amazonQuery = product.jan_code || product.product_name;
            amazonLink.href = `https://www.amazon.co.jp/s?k=${encodeURIComponent(amazonQuery)}&i=grocery&tag=vegeatease-22`;
            document.getElementById('barcode-result-preview').style.display = '';
          } catch (e) {
            errEl.textContent = e.message || '商品情報の取得に失敗しました';
            errEl.style.display = '';
          }
        },
        () => {}
      );
    } catch (e) {
      errEl.textContent = 'カメラを起動できませんでした';
      errEl.style.display = '';
    }
  });

  document.getElementById('btn-barcode-close')?.addEventListener('click', closeBarcodeArea);
  document.getElementById('btn-barcode-cancel')?.addEventListener('click', closeBarcodeArea);

  document.getElementById('btn-barcode-skip')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-barcode-skip');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await saveProduct({
        diet_mode:       currentSessionMode || 'oriental',
        ingredient_text: _lastExtractedText || null,
        is_safe:         true,
      });
      btn.textContent = '✅ 保存しました';
      setTimeout(closeBarcodeArea, 1200);
    } catch (e) {
      const errEl = document.getElementById('barcode-scan-error');
      errEl.textContent = e.message || '保存に失敗しました';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = 'バーコードなしで保存する';
    }
  });

  document.getElementById('btn-barcode-save')?.addEventListener('click', async () => {
    if (!_scannedProduct) return;
    const btn = document.getElementById('btn-barcode-save');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await saveProduct({
        jan_code:        _scannedProduct.jan_code,
        product_name:    _scannedProduct.product_name,
        image_url:       _scannedProduct.image_url,
        shop_url:        _scannedProduct.shop_url,
        amazon_url:      `https://www.amazon.co.jp/s?k=${encodeURIComponent(_scannedProduct.jan_code)}&i=grocery&tag=vegeatease-22`,
        diet_mode:       currentSessionMode || 'oriental',
        ingredient_text: _lastExtractedText || null,
        is_safe:         true,
      });
      btn.textContent = '✅ 保存しました';
      setTimeout(closeBarcodeArea, 1200);
    } catch (e) {
      const errEl = document.getElementById('barcode-scan-error');
      errEl.textContent = e.message || '保存に失敗しました';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = '保存する';
    }
  });

  // ===== 判定OK後マイリスト登録バーコードスキャンページ =====
  let _saveBarcodeScanner = null;

  function openSaveBarcodePage() {
    showById('save-barcode-page');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const resultArea = document.getElementById('barcode-save-result');
    if (resultArea) resultArea.style.display = 'none';
    _saveBarcodeScanner = new Html5Qrcode('save-qr-reader');
    _saveBarcodeScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 100 }, supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA] },
      async (janCode) => {
        await _saveBarcodeScanner.stop().catch(() => {});
        _saveBarcodeScanner = null;
        await onSaveBarcodeScanned(janCode);
      },
      () => {}
    ).catch(() => {});
  }

  async function stopSaveBarcodeScanner() {
    if (_saveBarcodeScanner) {
      await _saveBarcodeScanner.stop().catch(() => {});
      _saveBarcodeScanner = null;
    }
  }

  async function closeSaveBarcodePage() {
    if (_saveBarcodeScanner) {
      await _saveBarcodeScanner.stop().catch(() => {});
      _saveBarcodeScanner = null;
    }
    showById('scanner-page');
  }

  async function onSaveBarcodeScanned(janCode) {
    let productData = null;
    try {
      productData = await lookupProduct(janCode);
    } catch (e) {
      console.warn('楽天API失敗、商品名なしで保存', e);
    }
    await doSaveToMylist({
      jan_code:     janCode,
      product_name: productData?.product_name ?? null,
      image_url:    productData?.image_url    ?? null,
      shop_url:     productData?.shop_url     ?? null,
      amazon_url:   `https://www.amazon.co.jp/s?k=${encodeURIComponent(janCode)}&i=grocery&tag=vegeatease-22`,
    });
  }

  async function doSaveToMylist(productData = {}) {
    const btn = document.getElementById('btn-save-to-mylist');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    let savedOk = false;
    let is409   = false;

    try {
      await saveProduct({
        ingredient_text: _lastExtractedText || null,
        diet_mode:       currentSessionMode || 'oriental',
        is_safe:         true,
        ...productData,
      });
      savedOk = true;
    } catch (e) {
      if (e.message?.includes('保存済み')) {
        is409 = true;
      } else {
        if (btn) { btn.disabled = false; btn.style.display = ''; btn.textContent = '📷 バーコードを読み取り、この商品をリストに登録'; }
        const resultArea = document.getElementById('barcode-save-result');
        const statusEl   = document.getElementById('barcode-save-status');
        if (statusEl) statusEl.textContent = '保存に失敗しました: ' + (e.message || '');
        if (resultArea) resultArea.style.display = '';
        return;
      }
    }

    // 成功 or 保存済み
    await stopSaveBarcodeScanner();

    const resultArea = document.getElementById('barcode-save-result');
    const statusEl   = document.getElementById('barcode-save-status');
    const linksEl    = document.getElementById('barcode-shop-links');

    if (statusEl) statusEl.textContent = savedOk
      ? '✅ マイリストに保存しました'
      : '📋 この商品はすでにマイリストに保存済みです';

    const shopUrl   = productData?.shop_url   || null;
    const amazonUrl = productData?.amazon_url || null;
    if (linksEl) {
      linksEl.innerHTML = `
        ${shopUrl   ? `<a href="${shopUrl}"   target="_blank" rel="noopener" class="btn-feedback">🛒 楽天で購入 →</a>`   : ''}
        ${amazonUrl ? `<a href="${amazonUrl}" target="_blank" rel="noopener" class="btn-feedback">📦 Amazonで購入 →</a>` : ''}
      `;
    }

    if (resultArea) resultArea.style.display = '';
  }

  document.getElementById('btn-save-to-mylist')?.addEventListener('click', openSaveBarcodePage);

  document.getElementById('btn-save-barcode-skip')?.addEventListener('click', async () => {
    await stopSaveBarcodeScanner();
    const productName = prompt('商品名を入力してください（省略可）') ?? '';
    await doSaveToMylist({ product_name: productName || null });
  });

  document.getElementById('btn-save-barcode-cancel')?.addEventListener('click', closeSaveBarcodePage);

  document.getElementById('barcode-goto-mylist')?.addEventListener('click', () => {
    showById('mylist-page');
    loadMyList();
  });

  document.getElementById('barcode-new-scan')?.addEventListener('click', () => {
    showById('scanner-page');
    document.getElementById('btn-result-reset')?.click();
  });

  // ===== マイリストページ =====
  document.getElementById('drawer-nav-mylist')?.addEventListener('click', async (e) => {
    e.preventDefault();
    window.closeDrawer?.();
    showById('mylist-page');
    await loadMyList();
  });

  document.getElementById('drawer-nav-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.closeDrawer?.();
    showById('scanner-page');
    setTimeout(() => {
      const section = document.getElementById('save-product-section');
      if (section) section.style.display = '';
      document.getElementById('btn-save-product-open')?.click();
    }, 100);
  });

  document.getElementById('btn-mylist-back')?.addEventListener('click', () => {
    showById('scanner-page');
  });

  async function loadMyList() {
    const itemsEl = document.getElementById('mylist-items');
    const emptyEl = document.getElementById('mylist-empty');
    if (!itemsEl) return;
    itemsEl.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;">読み込み中…</p>';
    try {
      const items = await getMyList();
      itemsEl.innerHTML = '';
      if (items.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'mylist-card';
        card.innerHTML = `
          ${item.image_url ? `<img class="mylist-card-image" src="${esc(item.image_url)}" alt="">` : '<div class="mylist-card-no-image">📦</div>'}
          <div class="mylist-card-body">
            <div class="mylist-card-name">${esc(item.product_name || '（商品名未登録）')}</div>
            <div class="mylist-card-mode">${esc(item.diet_mode)}</div>
            <div class="mylist-card-links">
              ${item.shop_url ? `<a class="mylist-card-link" href="${esc(item.shop_url)}" target="_blank" rel="noopener">楽天 →</a>` : ''}
              <a class="mylist-card-link mylist-card-link--amazon" href="https://www.amazon.co.jp/s?k=${encodeURIComponent(item.jan_code)}&tag=vegeatease-22" target="_blank" rel="noopener">Amazon →</a>
            </div>
          </div>
          <button class="mylist-card-delete" data-id="${esc(item.id)}" aria-label="削除">✕</button>
        `;
        card.querySelector('.mylist-card-delete')?.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          if (!confirm('このアイテムを削除しますか？')) return;
          try {
            await deleteProduct(id);
            card.remove();
            const remaining = itemsEl.querySelectorAll('.mylist-card');
            if (remaining.length === 0 && emptyEl) emptyEl.style.display = '';
          } catch (err) {
            alert(err.message || '削除に失敗しました');
          }
        });
        itemsEl.appendChild(card);
      });
    } catch (e) {
      itemsEl.innerHTML = `<p style="text-align:center;color:#c00;padding:2rem;">${e.message || '取得に失敗しました'}</p>`;
    }
  }

  window.openSaveBarcodePage = openSaveBarcodePage;
  window.loadMyList = loadMyList;

  document.getElementById('btn-add-to-mylist')?.addEventListener('click', () => {
    openSaveBarcodePage();
  });

  document.getElementById('btn-goto-mylist-from-settings')?.addEventListener('click', () => {
    showById('mylist-page');
    loadMyList();
  });
})();
