/**
 * SafeEat — 解析 API クライアント
 * Claude API はサーバー側（Render 等）で呼び出す。キーはサーバーの環境変数のみ。
 */

const API_BASE =
  (typeof window !== "undefined" && window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE) ||
  "https://safeeat-rrzd.onrender.com";

/** Render スリープ復帰用に全呼び出しで共有する 1 回きりの待機 */
let _warmPromise = null;

function ensureApiWarm() {
  if (_warmPromise) return _warmPromise;
  _warmPromise = (async () => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 90_000);
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
      const retriableHttp =
        res.status === 429 ||
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
      lastError = err;
      if (isLikelyNetworkError(err)) {
        lastError = new Error(
          "通信が途中で切れました（サーバーがスリープから起きるまで1分ほどかかることがあります）。Wi‑Fi で原材料だけを切り取り、1分後に再試行するか、テキスト入力をご利用ください。",
        );
      }
      if (attempt < maxRetries - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt) + Math.random() * 1200);
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
  const tid = setTimeout(() => ctrl.abort(), 240_000);
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
      6,
      2800,
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
