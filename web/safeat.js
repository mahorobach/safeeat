/**
 * SafeEat — メインUI ロジック
 * Phase 1: オリエンタルベジタリアン特化
 * Claude API はサーバー経由のため、フロントにAPIキーなし
 */

const SAFEAT_API_URL = "https://safeeat-rrzd.onrender.com";

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

// --- Analyze ---
analyzeBtn.addEventListener("click", handleAnalyze);

async function handleAnalyze() {
  clearError();
  hideResult();

  const ingredientsText = textarea.value.trim();
  if (!ingredientsText) {
    showError("成分表を入力してください。");
    return;
  }

  setLoading(true);

  try {
    const result = await analyzeWithClaude(ingredientsText);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false);
  } catch (err) {
    try {
      const result = localFallback(ingredientsText);
      const promoted = promoteFromUserDB(result);
      renderResult(promoted, true);
    } catch {
      showError(`解析エラー：${err.message}`);
    }
  } finally {
    setLoading(false);
  }
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

function renderResult(result, isOffline) {
  const cfg = OVERALL_CONFIG[result.overall] || OVERALL_CONFIG.gray;
  document.getElementById("overall-icon").textContent = cfg.icon;

  const verdict = document.getElementById("overall-verdict");
  verdict.textContent = cfg.label;
  verdict.className = `verdict ${result.overall}`;

  const summaryEl = document.getElementById("overall-summary");
  summaryEl.textContent = result.summary + (isOffline ? "（オフライン判定）" : "");

  document.getElementById("overall-banner").className = `overall-banner ${result.overall}`;

  renderNgList(result.ng || []);
  renderGrayList(result.gray || []);
  renderOkList(result.ok || []);
  renderUnknownList(result.unknown || []);
  updateUserDBBadge();

  resultSection.classList.add("visible");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.querySelector(".btn-label").textContent = on ? "解析中..." : "成分を解析する";
}
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("visible");
}
function clearError() {
  errorBox.classList.remove("visible");
  errorBox.textContent = "";
}
function hideResult() { resultSection.classList.remove("visible"); }

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

updateUserDBBadge();
