/**
 * EatEase — ユーザー検証DB
 * 未知成分のユーザー確認結果を localStorage とAPIへ保存する。
 */

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
