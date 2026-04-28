// SafeEat 判定ロジック — web/lib/ 組み込み版（file:// 対応）
// shared/rules.js の内容と同一

function judgeIngredients(ingredients, db) {
  const ok = [], gray = [], ng = [], unknown = [];

  for (const rawName of ingredients) {
    const name = rawName.trim();
    if (!name) continue;

    const ngMatch   = findMatch(name, db.ingredients.ng.items);
    const okMatch   = findMatch(name, db.ingredients.ok.items);
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
    if (item.keywords.some((kw) => name.includes(kw))) return item;
  }
  return null;
}

function buildSummary(overall, ng, gray, unknown) {
  if (overall === "ng") {
    return `オリエンタルベジタリアンとして食べられません。NGな成分が${ng.length}件あります：${ng.map((i) => i.name).slice(0, 3).join("、")}${ng.length > 3 ? "など" : ""}。`;
  }
  if (overall === "gray") {
    return `全体的にオリエンタルベジタリアン向けですが、由来確認が必要な成分が${gray.length + unknown.length}件あります。`;
  }
  return "オリエンタルベジタリアンとして安全に食べられます。";
}

window.SafeEatRules = { judgeIngredients };
