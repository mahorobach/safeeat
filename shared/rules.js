/**
 * SafeEat 判定ロジック（共通モジュール）
 * Web / Android / iOS で共通利用できるよう設計
 * 判定: ok / gray / ng / unknown の4段階
 */

/**
 * ローカルDBを使った成分判定（オフラインフォールバック）
 * @param {string[]} ingredients - 成分名の配列
 * @param {object} db - ingredients-db.json の内容
 * @returns {{ ok, gray, ng, unknown, overall, summary }}
 */
function judgeIngredients(ingredients, db) {
  const ok = [];
  const gray = [];
  const ng = [];
  const unknown = [];

  for (const rawName of ingredients) {
    const name = rawName.trim();
    if (!name) continue;

    const ngMatch  = findMatch(name, db.ingredients.ng.items);
    const okMatch  = findMatch(name, db.ingredients.ok.items);
    const grayMatch = findMatch(name, db.ingredients.gray.items);

    if (ngMatch) {
      ng.push({ name, reason: ngMatch.reason });
    } else if (grayMatch) {
      gray.push({ name, reason: grayMatch.reason, detail: grayMatch.detail || null });
    } else if (okMatch) {
      ok.push({ name, reason: okMatch.reason });
    } else {
      unknown.push({ name, inferred: "gray", confidence: "low", reason: "成分DBに登録がないため要確認" });
    }
  }

  let overall = "ok";
  if (ng.length > 0) overall = "ng";
  else if (gray.length > 0 || unknown.length > 0) overall = "gray";

  const summary = buildSummary(overall, ng, gray, unknown);

  return { ok, gray, ng, unknown, overall, summary };
}

function findMatch(name, items) {
  for (const item of items) {
    if (item.keywords.some((kw) => name.includes(kw))) {
      return item;
    }
  }
  return null;
}

function buildSummary(overall, ng, gray, unknown) {
  if (overall === "ng") {
    return `オリエンタルベジタリアンとして食べられません。NGな成分が${ng.length}件あります：${ng.map((i) => i.name).slice(0, 3).join("、")}${ng.length > 3 ? "など" : ""}。`;
  }
  if (overall === "gray") {
    const total = gray.length + unknown.length;
    return `全体的にオリエンタルベジタリアン向けですが、由来確認が必要な成分が${total}件あります。ラベルの詳細を確認してください。`;
  }
  return "オリエンタルベジタリアンとして安全に食べられます。";
}

// Node.js / ブラウザ両対応
if (typeof module !== "undefined" && module.exports) {
  module.exports = { judgeIngredients };
} else if (typeof window !== "undefined") {
  window.SafeEatRules = { judgeIngredients };
}
