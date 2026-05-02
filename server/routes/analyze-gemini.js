import { Router } from "express";

const router = Router();

// "GEMINI_MODEL=gemini-3.0-flash" のように値にキー名が含まれていても正しく取り出す
function parseModelEnv(raw) {
  const s = (raw || "").trim();
  const eqIdx = s.indexOf("=");
  return eqIdx >= 0 ? s.slice(eqIdx + 1).trim() : s;
}
const GEMINI_MODEL = parseModelEnv(process.env.GEMINI_MODEL) || "gemini-3.0-flash";
// 新しいモデルは v1beta ではなく v1 に存在することがある
// GEMINI_API_VERSION 環境変数で切り替え可（例: v1beta）
const GEMINI_API_VERSION = (process.env.GEMINI_API_VERSION || "v1").trim();
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  .replace("/v1beta/", `/${GEMINI_API_VERSION}/`);

console.log(`[Gemini] モデル: ${GEMINI_MODEL}  APIバージョン: ${GEMINI_API_VERSION}`);
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

const DETAILED_IMAGE_PROMPT = `あなたは食品ラベルの【原材料名欄】を一字一句そのまま書き写す、厳格なOCRスキャナーです。
判定より「正確な転記」を最優先してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【絶対禁止ルール — 違反は重大な食品事故につながる】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 文脈・知識・学習データから文字を補完・推測して追加しない
❌ 「この食品なら〇〇が入っているはず」という先入観で成分を足さない
❌ 画像に存在しない成分を出力しない（捏造禁止）
❌ 画像に存在する成分を省略・統合・言い換えしない（脱落禁止）
❌ 似た文字（「み」と「ス」、「タ」と「ク」など）を決め打ちしない

✅ 画像のピクセルに実際に存在する文字だけを書き写す
✅ 少しでも読み取りに自信がなければ requires_user_check = true にする
✅ 読めない1文字は [?] で表現する

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【確信度の基準（厳しめに評価すること）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- confidence は 0.0〜1.0 で評価
- 以下のいずれかに当てはまれば requires_user_check = true（閾値: 0.85）
  ・文字が小さい／かすれている／印刷がにじんでいる
  ・括弧の内側や行末など読み取りにくい位置にある
  ・似た文字との区別がつかない（例: 「ン」と「ソ」、「タ」と「ク」）
  ・成分名として見慣れない・珍しい文字列
  ・1文字でも判読に迷いがある
- requires_user_check = true のとき:
  ・テキスト末尾に [?] を付加
  ・user_prompt に「ここは"〇〇"と読めますが合っていますか？」の確認文を設定

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【座標（bounding_box）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 各成分テキストの位置を [ymin, xmin, ymax, xmax] 形式で返す（0〜1000 スケール）
- 読み取りに自信がない箇所ほど正確な座標を付けること（ズーム表示に使うため）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【オリエンタルベジタリアン判定（vege_status）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "Red"   : 五葷（にんにく・ねぎ・にら・らっきょう・あさつき）または動物性成分（肉・魚・ゼラチン・コラーゲン・コチニール等）
- "Yellow": 由来不明・要確認（グリセリン・天然香料・酵素・由来不明のビタミンD等）または requires_user_check = true の成分
- "Green" : 明確に安全な成分（植物性油脂・卵・乳製品・大豆レシチン・砂糖・塩等）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【final_decision】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "NG"     : Red が1つ以上ある
- "Pending": Red なし・Yellow または requires_user_check が1つ以上ある
- "OK"     : すべて Green かつ requires_user_check がすべて false

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力形式】説明・Markdown・コードフェンス禁止。JSONのみ。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "ingredients": [
    {
      "text": "成分名（requires_user_check=trueなら末尾に[?]）",
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

    const CONFIDENCE_THRESHOLD = 0.85;

    // サーバー側でも閾値を強制適用（モデルが甘い判定を返しても上書き）
    parsed.ingredients = parsed.ingredients.map((item) => {
      const conf = typeof item.confidence === "number" ? item.confidence : 1.0;
      const forceCheck = conf < CONFIDENCE_THRESHOLD;
      const requiresCheck = Boolean(item.requires_user_check) || forceCheck;
      const text = String(item.text || "");
      // requires_user_check なのに [?] が付いていない場合は付加
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
          ? "Yellow"  // 確信度不足は強制的に要確認扱い
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
