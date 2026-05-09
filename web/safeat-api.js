/**
 * EatEase — 解析 API クライアント
 * Claude API はサーバー側（Render 等）で呼び出す。キーはサーバーの環境変数のみ。
 */

const API_BASE =
  (typeof window !== "undefined" && window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE) ||
  "https://safeeat-production-b7c5.up.railway.app";

/** Render スリープ復帰用に全呼び出しで共有する 1 回きりの待機 */
let _warmPromise = null;

function ensureApiWarm() {
  if (_warmPromise) return _warmPromise;
  _warmPromise = (async () => {
    const ctrl = new AbortController();
    /** 長すぎると「エラーまで待った」体感のみ悪化。POST 側でリトライする */
    const tid = setTimeout(() => ctrl.abort(), 22_000);
    try {
      await fetch(`${API_BASE}/api/health`, {
        method: "GET",
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch {
      /* メインはリトライ */
    } finally {
      clearTimeout(tid);
    }
  })();
  return _warmPromise;
}

function isLocalApiBase() {
  const b = String(API_BASE || "");
  return b.includes("localhost") || b.includes("127.0.0.1");
}

/** 接続失敗時のメッセージ（ローカル開発では Render 向け文言を出さない） */
function networkFailureUserMessage() {
  if (isLocalApiBase()) {
    return [
      "APIサーバーに接続できませんでした（ローカル開発）。",
      "① 別ターミナルで server を起動: cd server && npm run dev",
      "② ブラウザで http://localhost:3000/api/health が表示されるか確認",
      "③ server/.env の ALLOWED_ORIGINS に、今開いているURL（http://localhost:5500 と http://127.0.0.1:5500）を入れる",
    ].join(" ");
  }
  return (
    "通信が途中で切れました。無料ホスティングでは起動直後も不安定なことがあります。原材料を切り取り、30秒〜1分あけて再試行するか、テキスト入力をご利用ください。"
  );
}

function isLikelyNetworkError(err) {
  if (!(err instanceof TypeError)) return false;
  const m = String(err.message || "").toLowerCase();
  return (
    m.includes("fetch") ||
    m.includes("networkerror") ||
    m.includes("failed to fetch") ||
    m.includes("load failed") ||
    m.includes("network request failed")
  );
}

/**
 * @param {string} ingredientsText - 成分表テキスト
 * @returns {Promise<{ok, gray, ng, unknown, overall, summary}>}
 */
async function analyzeWithClaude(ingredientsText) {
  await ensureApiWarm();
  const res = await fetchWithRetry(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredients: ingredientsText }),
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `サーバーエラー (${res.status})`);
  }

  return data.data;
}

/**
 * 指数バックオフ付きフェッチ（429/529/502/503/504 もリトライ）
 * @param {number} baseDelayMs — 1回目の待ちの基準（画像POSTは長め推奨）
 */
async function fetchWithRetry(url, options, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // 429 はクォータ超過のためリトライしない（リトライするとクォータをさらに消費する）
      const retriableHttp =
        res.status === 529 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504;
      if (retriableHttp && attempt < maxRetries - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt) + Math.random() * 800);
        lastError = new Error(`サーバーが混雑しています (${res.status})`);
        continue;
      }
      return res;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          "解析がタイムアウトしました。写真をもっと小さく切り取るか、しばらくして再試行してください。",
        );
      }
      console.error(`[fetchWithRetry] attempt=${attempt} name=${err?.name} msg=${err?.message}`);
      lastError = err;
      if (isLikelyNetworkError(err)) {
        lastError = new Error(networkFailureUserMessage());
      }
      if (attempt < maxRetries - 1) {
        /** ネットワーク切れは長いバックオフを重ねると、失敗までの待ち時間だけが伸びる */
        const delay = isLikelyNetworkError(err)
          ? Math.min(3200, 500 * Math.pow(2, attempt) + Math.random() * 350)
          : baseDelayMs * Math.pow(2, attempt) + Math.random() * 900;
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * 画像から成分テキストのみ取得（サーバー側で Claude Vision 1 往復・判定プロンプトなし）
 * @returns {Promise<{ extractedText: string }>}
 */
async function extractTextFromImage(imageData, mediaType) {
  await ensureApiWarm();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 130_000);
  try {
    const res = await fetchWithRetry(
      `${API_BASE}/api/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          type: "image",
          extractOnly: true,
          image: { data: imageData, mediaType },
          mode: "oriental",
        }),
      },
      4,
      2200,
    );

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`サーバー応答が不正です (${res.status})。API を再デプロイしているか確認してください。`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `サーバーエラー (${res.status})`);
    }

    return { extractedText: data.extractedText || "" };
  } finally {
    clearTimeout(tid);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getAuthHeaders() {
  if (typeof sessionStorage === "undefined") return {};
  const token = sessionStorage.getItem("safeat_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 画像から成分ごとの確信度・BBox・ベジ判定を1ステップで取得（Gemini detailed）
 *
 * @param {string} imageData  - Base64 文字列
 * @param {string} mediaType  - "image/jpeg" 等
 * @returns {Promise<{
 *   data: {
 *     ingredients: Array<{
 *       text: string,
 *       bounding_box: [number, number, number, number],
 *       confidence: number,
 *       requires_user_check: boolean,
 *       user_prompt: string|null,
 *       vege_status: "Green"|"Yellow"|"Red",
 *       reason: string
 *     }>,
 *     final_decision: "OK"|"NG"|"Pending"
 *   },
 *   extractedText: string
 * }>}
 */
async function analyzeImageWithGeminiDetailed(imageData, mediaType, dietMode = "oriental") {
  await ensureApiWarm();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 130_000);
  try {
    const res = await fetchWithRetry(
      `${API_BASE}/api/analyze/gemini/image/detailed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        signal: ctrl.signal,
        body: JSON.stringify({ image: { data: imageData, mediaType }, diet_mode: dietMode }),
      },
      3,
      2200,
    );

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`サーバー応答が不正です (${res.status})`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `サーバーエラー (${res.status})`);
    }

    return { data: data.data, extractedText: data.extractedText || "" };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * 画像から成分抽出＋判定を1ステップで実行（Gemini）
 * @returns {Promise<{ data, extractedText }>}
 */
async function analyzeImageWithGemini(imageData, mediaType, dietMode = "oriental") {
  await ensureApiWarm();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 130_000);
  try {
    const res = await fetchWithRetry(
      `${API_BASE}/api/analyze/gemini/image`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ image: { data: imageData, mediaType }, diet_mode: dietMode }),
      },
      3,
      2200,
    );

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`サーバー応答が不正です (${res.status})`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `サーバーエラー (${res.status})`);
    }

    return { data: data.data, extractedText: data.extractedText || "" };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * テキスト成分を Gemini で判定
 * @returns {Promise<{ok, gray, ng, unknown, overall, summary}>}
 */
async function analyzeTextWithGemini(ingredientsText, dietMode = "oriental") {
  await ensureApiWarm();
  const res = await fetchWithRetry(`${API_BASE}/api/analyze/gemini/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ ingredients: ingredientsText, diet_mode: dietMode }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `サーバーエラー (${res.status})`);
  }

  return data.data;
}

// ===== 商品検索・マイリスト API =====

async function lookupProduct(janCode) {
  const res = await fetch(`${API_BASE}/api/product/lookup?jan=${encodeURIComponent(janCode)}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "商品が見つかりませんでした");
  return data.data;
}

async function saveProduct(productData) {
  const res = await fetch(`${API_BASE}/api/product/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(productData),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "保存に失敗しました");
  return data;
}

async function getMyList() {
  const res = await fetch(`${API_BASE}/api/product/mylist`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "取得に失敗しました");
  return data.data;
}

async function deleteProduct(id) {
  const res = await fetch(`${API_BASE}/api/product/mylist/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "削除に失敗しました");
  return data;
}
