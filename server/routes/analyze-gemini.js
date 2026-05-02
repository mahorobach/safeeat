import { Router } from "express";

const router = Router();

// "GEMINI_MODEL=gemini-3.0-flash" のように値にキー名が含まれていても正しく取り出す
function parseModelEnv(raw) {
  const s = (raw || "").trim();
  const eqIdx = s.indexOf("=");
  return eqIdx >= 0 ? s.slice(eqIdx + 1).trim() : s;
}
const GEMINI_MODEL = parseModelEnv(process.env.GEMINI_MODEL) || "gemini-1.5-flash-latest";
// responseMimeType は v1beta のみサポート（v1 では未サポート）
const GEMINI_API_VERSION = (process.env.GEMINI_API_VERSION || "v1beta").trim();
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`;

console.log(`[Gemini] モデル: ${GEMINI_MODEL}  APIバージョン: ${GEMINI_API_VERSION}`);
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

const ORIENTAL_RULES = `
オリエンタルベジタリアン判定基準:
NG: 肉類全般・魚介類全般・五葷（ニンニク・ネギ・ニラ・らっきょう・玉ねぎ、エキス・パウダー・加工品含む）・コチニール色素(E120)・コラーゲン・ゼラチン・シェラック・動物性油脂
OK: 卵・乳製品全般・カゼイン・蜂蜜・ローヤルゼリー・大豆レシチン・乳酸・植物性油脂全般・ビタミンD（羊毛由来）・アサフェティダ
グレー: グリセリン（由来不明）・天然香料（動物性の可能性あり）・酵素（動物性はNG）・ビタミンD（由来不明）
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
        generationConfig: { temperature: 0 },
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
        generationConfig: { temperature: 0 },
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

const DETAILED_IMAGE_PROMPT = `あなたは食品ラベルの【原材料名欄】を読み取る純粋なOCRスキャナーです。

=== STEP 1: 画像内の文字を全て書き出す（raw_chars）===

まず最初に、原材料名欄に写っているひらがな・カタカナ・漢字・英数字・記号を
1文字ずつスキャンして、目に入った全文字を raw_chars に羅列してください。

重要: 単語として意味が通じなくても構わない。見たままの文字の並びを最優先せよ。
「この食品なら○○と書いてあるはず」という食品知識・学習データ・先入観を完全に排除し、
ピクセル上に存在する文字だけを写してください。

=== STEP 2: raw_chars から成分名を構成する ===

STEP 1 で書き出した raw_chars に含まれる文字だけを使って各成分名を構成してください。

ocr_verified ルール（厳守）:
- raw_chars に含まれる文字だけで成分名が構成できる場合のみ ocr_verified: true
- raw_chars にない文字が1文字でも成分名に含まれる場合は ocr_verified: false かつ requires_user_check: true
- 1文字でも読み取りに迷いがある場合は ocr_verified: false かつ requires_user_check: true

confidence ルール:
- 0.0〜1.0（1文字でも迷いがあれば 0.75 以下）
- raw_chars にない文字を使って推測・補完した場合は必ず 0.5 以下

=== 画像全体の品質評価 ===

image_quality: "good"（全文字はっきり読める）| "fair"（一部かすれ・小さい・斜め）| "poor"（読み取り困難）
"fair" または "poor" の場合、全成分を requires_user_check: true にする

=== requires_user_check = true のとき ===

テキスト末尾に [?] を付加し、user_prompt に「ここは"○○"と読みましたが正しいですか？」を設定

=== 座標（bounding_box） ===

[ymin, xmin, ymax, xmax] 形式（0〜1000 スケール）。不明は [0,0,0,0]。

=== オリエンタルベジタリアン判定（vege_status） ===

"Red"   : 五葷（にんにく・ねぎ・にら・らっきょう・あさつき）または動物性（肉・魚・ゼラチン等）
"Yellow": 由来不明・要確認（グリセリン・天然香料・酵素等）または requires_user_check=true の成分
"Green" : 明確に安全な植物性成分（植物油脂・卵・乳製品・砂糖・塩等）

=== final_decision ===

"NG"     : Red が1つ以上
"Pending": Red なし・Yellow または requires_user_check が1つ以上
"OK"     : すべて Green かつ requires_user_check がすべて false

=== 出力形式（説明・Markdown・コードフェンス禁止。JSONのみ） ===

{
  "image_quality": "good",
  "raw_chars": "め ん 小 麦 粉 パ ー ム 油 ...",
  "ingredients": [
    {
      "text": "成分名（requires_user_check=trueなら末尾に[?]）",
      "bounding_box": [ymin, xmin, ymax, xmax],
      "confidence": 0.95,
      "ocr_verified": true,
      "requires_user_check": false,
      "user_prompt": null,
      "vege_status": "Green",
      "reason": "判定理由（日本語・1文）"
    }
  ],
  "final_decision": "OK"
}`;

// raw_chars に含まれない日本語文字が成分名に使われていないか確認する
function crossCheckCharsAgainstRaw(ingredientText, rawChars) {
  if (!rawChars) return true; // raw_chars がなければスキップ
  const cleanText = ingredientText.replace(/\s*\[?\?\]?\s*$/, "");
  // ひらがな・カタカナ・漢字のみ対象（記号・英数字は除外）
  const jaChars = [...cleanText].filter((c) => /[぀-鿿]/.test(c));
  return jaChars.every((c) => rawChars.includes(c));
}

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
    console.log(`[Gemini /image/detailed] model="${GEMINI_MODEL}" mediaType="${image.mediaType}"`);
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
        generationConfig: { temperature: 0 },
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

    const CONFIDENCE_THRESHOLD = 0.80;
    const rawChars = parsed.raw_chars || "";

    // image_quality が fair/poor なら全成分を強制チェック
    const imageFair = parsed.image_quality === "fair" || parsed.image_quality === "poor";

    // サーバー側でも閾値・raw_chars 照合を強制適用（モデルが甘い判定を返しても上書き）
    parsed.ingredients = parsed.ingredients.map((item) => {
      const conf = typeof item.confidence === "number" ? item.confidence : 1.0;
      const ocrVerified = item.ocr_verified !== false;
      // raw_chars にない漢字が成分名に含まれる場合は強制チェック
      const charsOk = crossCheckCharsAgainstRaw(String(item.text || ""), rawChars);
      const forceCheck = conf < CONFIDENCE_THRESHOLD || !ocrVerified || imageFair || !charsOk;
      const requiresCheck = Boolean(item.requires_user_check) || forceCheck;
      const text = String(item.text || "");
      const textWithFlag =
        requiresCheck && !text.endsWith("[?]") ? `${text} [?]` : text;

      return {
        text:                textWithFlag,
        bounding_box:        Array.isArray(item.bounding_box) ? item.bounding_box : [0, 0, 0, 0],
        confidence:          conf,
        requires_user_check: requiresCheck,
        user_prompt:         requiresCheck
          ? (item.user_prompt || `ここは「${text.replace(/ ?\[?\?\]?$/, "")}」と読めますが正しいですか？`)
          : null,
        vege_status:         requiresCheck
          ? "Yellow"
          : (["Green", "Yellow", "Red"].includes(item.vege_status) ? item.vege_status : "Yellow"),
        reason:              String(item.reason || ""),
      };
    });

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
