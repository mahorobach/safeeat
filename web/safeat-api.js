/**
 * SafeEat — 解析 API クライアント
 * Claude API はサーバー側（Render 等）で呼び出す。キーはサーバーの環境変数のみ。
 */

const API_BASE =
  (typeof window !== "undefined" && window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE) ||
  "https://safeeat-rrzd.onrender.com";

/**
 * @param {string} ingredientsText - 成分表テキスト
 * @returns {Promise<{ok, gray, ng, unknown, overall, summary}>}
 */
async function analyzeWithClaude(ingredientsText) {
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
 * 指数バックオフ付きフェッチ（最大3回リトライ）
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status === 529) {
        await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500);
        lastError = new Error(`レート制限 (${res.status})`);
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
      if (
        err instanceof TypeError &&
        (String(err.message).includes("fetch") || String(err.message).includes("NetworkError"))
      ) {
        lastError = new Error(
          "通信が途中で切れました。写真は原材料だけを切り取り、Wi‑Fi で再試行するか、テキスト入力をご利用ください。",
        );
      }
      if (attempt < maxRetries - 1) await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError;
}

/**
 * 画像から成分テキストのみ取得（サーバー側で Claude Vision 1 往復・判定プロンプトなし）
 * @returns {Promise<{ extractedText: string }>}
 */
async function extractTextFromImage(imageData, mediaType) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 180_000);
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
      3,
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
