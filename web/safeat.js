/**
 * SafeEat — メインUI ロジック
 * Phase 1: オリエンタルベジタリアン特化
 * Claude API はサーバー経由のため、フロントに API キーは不要（site-config.js の API_BASE のみ）
 */

const SAFEAT_API_URL =
  (window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE) || "https://safeeat-rrzd.onrender.com";

// Supabase Auth トークン（ログイン後に sessionStorage に格納）
function getAuthToken() {
  return sessionStorage.getItem("safeat_auth_token") || null;
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
const VISION_MAX_EDGE     = 1024;
const VISION_JPEG_QUALITY = 0.76;
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

function clearImage() {
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

// --- Analyze ---
analyzeBtn.addEventListener("click", handleAnalyze);

document.getElementById("btn-extract-then-classify")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-extract-then-classify");
  clearError();
  btn.disabled = true;
  setLoading(true);
  try {
    document.querySelectorAll(".input-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === "text"),
    );
    document.getElementById("tab-text").style.display = "";
    document.getElementById("tab-image").style.display = "none";
    await handleTextAnalyze();
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
});

async function handleAnalyze() {
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
    setLoading(false);
  }
}

async function handleTextAnalyze() {
  const ingredientsText = textarea.value.trim();
  if (!ingredientsText) {
    showError("成分表を入力してください。");
    return;
  }
  try {
    const result = await analyzeWithClaude(ingredientsText);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false, ingredientsText);
  } catch (err) {
    try {
      const result = localFallback(ingredientsText);
      const promoted = promoteFromUserDB(result);
      renderResult(promoted, true, ingredientsText);
    } catch {
      showError(`解析エラー：${err.message}`);
    }
  }
}

async function handleImageAnalyze() {
  if (!_imageBase64) {
    showError("画像を選択してください。");
    return;
  }
  try {
    const { extractedText } = await extractTextFromImage(_imageBase64, _imageMediaType);
    renderExtractOnlyResult(extractedText);
  } catch (err) {
    showError(`読み取りエラー：${err.message}`);
  }
}

/** 画像→テキストのみ成功時。判定リストは出さず、テキスト欄に転記して次の操作を案内する */
function renderExtractOnlyResult(extractedText) {
  const text = String(extractedText || "").trim();
  if (!text) {
    showError("読み取ったテキストが空です。写真の切り取りを試すか、別の画像を選んでください。");
    return;
  }
  clearError();
  textarea.value = text;

  const banner = document.getElementById("overall-banner");
  banner.className = "overall-banner extract-only";
  document.getElementById("overall-icon").textContent = "📄";
  document.getElementById("overall-verdict").textContent = "読み取りのみ完了（判定は未実行）";
  document.getElementById("overall-verdict").className = "verdict";
  document.getElementById("overall-summary").textContent =
    "テキスト欄に読み取り結果を入れました。余分な行を直したあと、下のボタンで成分判定に進めます。";

  renderExtractedAccordion(text, true);
  renderNgList([]);
  renderGrayList([]);
  renderOkList([]);
  renderUnknownList([]);
  updateUserDBBadge();

  const dbNote = document.querySelector(".user-db-note");
  if (dbNote) dbNote.style.display = "none";

  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.hidden = false;

  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
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

// --- ローカルフォールバック ---
function localFallback(text) {
  const db = window.SafeEatDB;
  const rules = window.SafeEatRules;
  if (!db || !rules) throw new Error("判定モジュールが読み込まれていません。ページを再読み込みしてください。");

  const ingredients = text
    .split(/[,、，\/\n・]+/)
    .map((s) => s.replace(/\s+/g, "").trim())
    .filter(Boolean);

  return rules.judgeIngredients(ingredients, db);
}

// --- Result rendering ---
const OVERALL_CONFIG = {
  ok:   { icon: "✅", label: "オリエンタルベジタリアンとして食べられます" },
  gray: { icon: "🟡", label: "由来確認が必要な成分があります" },
  ng:   { icon: "❌", label: "このモードでは食べられません" },
};

function renderResult(result, isOffline, extractedText) {
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.hidden = true;

  const dbNote = document.querySelector(".user-db-note");
  if (dbNote) dbNote.style.display = "";

  const cfg = OVERALL_CONFIG[result.overall] || OVERALL_CONFIG.gray;
  document.getElementById("overall-icon").textContent = cfg.icon;

  const verdict = document.getElementById("overall-verdict");
  verdict.textContent = cfg.label;
  verdict.className = `verdict ${result.overall}`;

  const summaryEl = document.getElementById("overall-summary");
  summaryEl.textContent = result.summary + (isOffline ? "（オフライン判定）" : "");

  document.getElementById("overall-banner").className = `overall-banner ${result.overall}`;

  renderExtractedAccordion(extractedText, false);
  renderNgList(result.ng || []);
  renderGrayList(result.gray || []);
  renderOkList(result.ok || []);
  renderUnknownList(result.unknown || []);
  updateUserDBBadge();

  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (el) el.querySelector(".count").textContent = `${count}件`;
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
    ? onImageTab
      ? "読み取り中..."
      : "解析中..."
    : onImageTab
      ? "この画像で読み取る"
      : "成分を解析する";
}
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("visible");
}
function clearError() {
  errorBox.classList.remove("visible");
  errorBox.textContent = "";
}
function hideResult() {
  resultSection.classList.remove("visible");
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.hidden = true;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

updateUserDBBadge();
