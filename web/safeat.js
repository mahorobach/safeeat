/**
 * EatEase — メインUI ロジック
 * Phase 1: オリエンタルベジタリアン特化
 * Claude API はサーバー経由のため、フロントに API キーは不要（site-config.js の API_BASE のみ）
 */

const APP_VERSION = '0.5.46';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if (el) el.textContent = `v${APP_VERSION}`;
});

// デザインシステム切替（app.eatease.net / localhost → EatEase UI）
if (window.SITE_CONFIG?.isEatEase) {
  document.body.classList.add('ee-page');
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
    await fetchApi("/api/ingredients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, category, reason, confidence: "low" }),
    }, token);
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
    const result = await analyzeTextWithGemini(ingredientsText, currentSessionMode);
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
    const { data, extractedText } = await analyzeImageWithGemini(_imageBase64, _imageMediaType, currentSessionMode);
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
    const { data, extractedText, product_name } = await analyzeImageWithGeminiDetailed(_imageBase64, _imageMediaType, currentSessionMode);
    _lastExtractedProductName = product_name ?? null;
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


let _lastAnalysisResult       = null;
let _lastExtractedText        = null;
let _lastScannedProduct       = null;
let _lastExtractedProductName = null;

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
  const savedMsg = document.getElementById('mylist-saved-message');
  if (savedMsg) savedMsg.style.display = 'none';
  const saveSection = document.getElementById('save-product-section');
  if (saveSection) saveSection.style.display = 'none';
  const saveToMylistArea = document.getElementById('save-to-mylist-area');
  if (saveToMylistArea) saveToMylistArea.style.display = 'none';

  // バーコード・商品名データのクリア
  _lastScannedProduct = null;
  _lastExtractedProductName = null;

  // 入力欄・ボタンの状態をリセット
  const input = document.getElementById('input-product-name');
  if (input) input.value = '';
  const form = document.getElementById('save-no-barcode-form');
  if (form) form.style.display = 'none';
  const btnBarcode = document.getElementById('btn-save-to-mylist');
  if (btnBarcode) {
    btnBarcode.style.display = '';
    btnBarcode.disabled = false;
    btnBarcode.textContent = '📷 バーコードを読み取り、この商品をリストに登録';
  }
  const btnNoBarcode = document.getElementById('btn-save-no-barcode');
  if (btnNoBarcode) {
    btnNoBarcode.style.display = '';
    btnNoBarcode.disabled = false;
  }

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
      const { data } = await fetchApiJson("/api/user/settings", {}, session.access_token);
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
        const token = _session?.access_token || getAuthToken();
        await fetchApi("/api/user/settings", {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, mode_selected: true }),
        }, token);
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
