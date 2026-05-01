import { Router } from "express";

const router = Router();

const GEMINI_MODEL = (process.env.GEMINI_MODEL || "").trim() || "gemini-3.0-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

const ORIENTAL_RULES = `
オリエンタルベジタリアン判定基準:
❌ NG: 肉類全般・魚介類全般・五葷（ニンニク・ネギ・ニラ・らっきょう・玉ねぎ、エキス・パウダー・加工品含む）・コチニール色素(E120)・コラーゲン・ゼラチン・シェラック・動物性油脂
✅ OK: 卵・乳製品全般・カゼイン・蜂蜜・ローヤルゼリー・大豆レシチン・乳酸・植物性油脂全般・ビタミンD（羊毛由来）・アサフェティダ
🟡 グレー: グリセリン（由来不明）・天然香料（動物性の可能性あり）・酵素（動物性はNG）・ビタミンD（由来不明）
`;

const IMAGE_ANALYZE_PROMPT = `この食品パッケージ画像の【原材料名・成分表示ブロック】を読み取り、オリエンタルベジタリアン基準で判定してください。

作業手順:
1. 原材料名欄のテキストを一字一句に近づけて転記する（栄養成分表・キャッチコピーは無視）
2. 転記した各成分を下記基準で分類する

${ORIENTAL_RULES}

未知成分は語尾・E番号・化学名から推測し、confidence（low/medium/high）と reason を付記。

必ず以下のJSON形式のみで返答（説明・Markdown不可）:
{
  "extractedText": "原材料名欄から写し取った全文（読点「、」区切り）",
  "ok":      [{"name": "成分名", "reason": "理由"}],
  "gray":    [{"name": "成分名", "reason": "理由", "detail": "詳細説明"}],
  "ng":      [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠"}],
  "overall": "ok|gray|ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

const TEXT_ANALYZE_PROMPT = (ingredients) => `以下の食品成分リストをオリエンタルベジタリアン基準で判定してください。

${ORIENTAL_RULES}

未知成分は語尾・E番号・化学名から推測し、confidence と reason を付記。

成分リスト:
${ingredients}

必ず以下のJSON形式のみで返答（説明・Markdown不可）:
{
  "ok":      [{"name": "成分名", "reason": "理由"}],
  "gray":    [{"name": "成分名", "reason": "理由", "detail": "詳細説明"}],
  "ng":      [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠"}],
  "overall": "ok|gray|ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

function getGeminiKey(res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "サーバー設定エラー（GEMINI_API_KEY 未設定）" });
    return null;
  }
  return apiKey;
}

function parseGeminiResponse(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("Gemini API から応答がありませんでした");
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/) || s.match(/(\{[\s\S]*\})/);
    if (!m) throw new Error("Gemini レスポンスの解析に失敗しました");
    return JSON.parse(m[1]);
  }
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// =============================================
// POST /api/analyze/gemini/image  — 1ステップ（読み取り＋判定）
// =============================================
router.post("/image", async (req, res, next) => {
  const { image } = req.body;

  if (!image?.data) {
    return res.status(400).json({ ok: false, error: "image.data は必須です（Base64文字列）" });
  }
  if (!VALID_MIME_TYPES.includes(image.mediaType)) {
    return res.status(400).json({
      ok: false,
      error: `image.mediaType が不正です。対応形式: ${VALID_MIME_TYPES.join(", ")}`,
    });
  }

  const sizeBytes = Buffer.byteLength(image.data, "base64");
  if (sizeBytes > IMAGE_SIZE_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `画像サイズが上限（5MB）を超えています（${(sizeBytes / 1024 / 1024).toFixed(1)}MB）`,
    });
  }

  const apiKey = getGeminiKey(res);
  if (!apiKey) return;

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: image.mediaType, data: image.data } },
            { text: IMAGE_ANALYZE_PROMPT },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      throw new Error(geminiData?.error?.message || `Gemini API エラー (${geminiRes.status})`);
    }

    const parsed = parseGeminiResponse(extractGeminiText(geminiData));
    const { extractedText = "", ...classification } = parsed;
    if (!Array.isArray(classification.unknown)) classification.unknown = [];

    const total =
      (classification.ok || []).length +
      (classification.gray || []).length +
      (classification.ng || []).length +
      (classification.unknown || []).length;

    if (total === 0 && !extractedText) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。原材料の範囲を選択してから再試行してください。",
      });
    }

    res.json({ ok: true, data: classification, extractedText });
  } catch (e) {
    next(e);
  }
});

// =============================================
// POST /api/analyze/gemini/text  — テキスト判定（Gemini 版）
// =============================================
router.post("/text", async (req, res, next) => {
  const { ingredients } = req.body;
  if (!ingredients || !String(ingredients).trim()) {
    return res.status(400).json({ ok: false, error: "ingredients は必須です" });
  }

  const apiKey = getGeminiKey(res);
  if (!apiKey) return;

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: TEXT_ANALYZE_PROMPT(String(ingredients)) }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      throw new Error(geminiData?.error?.message || `Gemini API エラー (${geminiRes.status})`);
    }

    const result = parseGeminiResponse(extractGeminiText(geminiData));
    if (!Array.isArray(result.unknown)) result.unknown = [];

    res.json({ ok: true, data: result });
  } catch (e) {
    next(e);
  }
});

// =============================================
// POST /api/analyze/gemini/image/detailed
// 1ステップ: 成分ごとにOCR確信度・BBox・ベジ判定を返す
// =============================================

const DETAILED_IMAGE_PROMPT = `この食品パッケージ画像の原材料名欄を解析してください。

【作業手順】
1. 原材料名欄の各成分を1つずつ読み取る
2. 各成分について以下を評価・返答する

【OCR確信度】
- 0.0〜1.0 で評価。文字が不鮮明・小さい・かすれている場合は低くする
- 0.8 未満の場合: requires_user_check = true、テキスト末尾に [?] を付加
  user_prompt に「ここは"XXX"と読めますが正しいですか？」形式の確認文を入れる

【座標（bounding_box）】
- 各成分テキストの位置を [ymin, xmin, ymax, xmax] 形式で返す（0〜1000 スケール）
- 全体の原材料行が1ブロックの場合は、個々の単語レベルで分割して座標を付ける

【オリエンタルベジタリアン判定（vege_status）】
- "Red"  : 五葷（にんにく・ねぎ・にら・らっきょう・あさつき）または動物性成分（肉・魚・ゼラチン・コラーゲン・コチニール等）
- "Yellow": 由来が不明・要確認（グリセリン・天然香料・酵素・由来不明のビタミンD等）
- "Green" : 安全な成分（植物性油脂・卵・乳製品・大豆レシチン・砂糖・塩等）

【final_decision】
- "NG"     : Red が1つ以上ある
- "Pending": Red なし・Yellow または requires_user_check が1つ以上ある
- "OK"     : すべて Green かつ requires_user_check がすべて false

必ず以下のJSON形式のみで返答（説明・Markdown・コードフェンス禁止）:
{
  "ingredients": [
    {
      "text": "成分名（確信度<0.8なら末尾に[?]）",
      "bounding_box": [ymin, xmin, ymax, xmax],
      "confidence": 0.95,
      "requires_user_check": false,
      "user_prompt": null,
      "vege_status": "Green",
      "reason": "判定理由（日本語・1文）"
    }
  ],
  "final_decision": "OK"
}`;

router.post("/image/detailed", async (req, res, next) => {
  const { image } = req.body;

  if (!image?.data) {
    return res.status(400).json({ ok: false, error: "image.data は必須です（Base64文字列）" });
  }
  if (!VALID_MIME_TYPES.includes(image.mediaType)) {
    return res.status(400).json({
      ok: false,
      error: `image.mediaType が不正です。対応形式: ${VALID_MIME_TYPES.join(", ")}`,
    });
  }

  const sizeBytes = Buffer.byteLength(image.data, "base64");
  if (sizeBytes > IMAGE_SIZE_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `画像サイズが上限（5MB）を超えています（${(sizeBytes / 1024 / 1024).toFixed(1)}MB）`,
    });
  }

  const apiKey = getGeminiKey(res);
  if (!apiKey) return;

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: image.mediaType, data: image.data } },
            { text: DETAILED_IMAGE_PROMPT },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      throw new Error(geminiData?.error?.message || `Gemini API エラー (${geminiRes.status})`);
    }

    const parsed = parseGeminiResponse(extractGeminiText(geminiData));

    if (!Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。原材料の範囲を選択してから再試行してください。",
      });
    }

    // user_prompt が null 以外でも文字列に統一
    parsed.ingredients = parsed.ingredients.map((item) => ({
      text:               String(item.text || ""),
      bounding_box:       Array.isArray(item.bounding_box) ? item.bounding_box : [0, 0, 0, 0],
      confidence:         typeof item.confidence === "number" ? item.confidence : 1.0,
      requires_user_check: Boolean(item.requires_user_check),
      user_prompt:        item.user_prompt ?? null,
      vege_status:        ["Green", "Yellow", "Red"].includes(item.vege_status) ? item.vege_status : "Yellow",
      reason:             String(item.reason || ""),
    }));

    // final_decision が不正な値の場合は再計算
    const hasRed     = parsed.ingredients.some((i) => i.vege_status === "Red");
    const hasPending = parsed.ingredients.some(
      (i) => i.vege_status === "Yellow" || i.requires_user_check,
    );
    if (!["OK", "NG", "Pending"].includes(parsed.final_decision)) {
      parsed.final_decision = hasRed ? "NG" : hasPending ? "Pending" : "OK";
    }

    // extractedText: フロント textarea 反映用（既存 UI との互換）
    const extractedText = parsed.ingredients.map((i) => i.text.replace(/\s*\[?\?\]?\s*$/, "").trim()).join("、");

    res.json({ ok: true, data: parsed, extractedText });
  } catch (e) {
    next(e);
  }
});

export default router;
