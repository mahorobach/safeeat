/**
 * SafeEat — 解析 API クライアント
 * Claude API はサーバー側（Render）で呼び出すため、APIキーはここに不要
 */

const API_BASE = "https://safeeat-rrzd.onrender.com";

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
      lastError = err;
      if (attempt < maxRetries - 1) await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
