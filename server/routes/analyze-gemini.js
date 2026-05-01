import { Router } from "express";

const router = Router();

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
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

export default router;
