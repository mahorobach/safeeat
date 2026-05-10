import { Router } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/client.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();
router.use(optionalAuth);

// "GEMINI_MODEL=gemini-3.0-flash" のように値にキー名が含まれていても正しく取り出す
function parseModelEnv(raw) {
  const s = (raw || "").trim();
  const eqIdx = s.indexOf("=");
  return eqIdx >= 0 ? s.slice(eqIdx + 1).trim() : s;
}
// "models/gemini-1.5-flash" 形式でも "/models/" が重複しないよう正規化
const rawModel = parseModelEnv(process.env.GEMINI_MODEL) || "gemini-1.5-flash";
const GEMINI_MODEL = rawModel.startsWith("models/") ? rawModel.slice("models/".length) : rawModel;
// v1beta に固定（responseMimeType サポート・全モデル対応）
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

console.log(`[Gemini] モデル: ${GEMINI_MODEL}  APIバージョン: v1beta（固定）`);

// =============================================
// Supabase キャッシュ（ws修正済みの共有クライアントを使用）
// =============================================
function getSupabase() {
  return supabaseAdmin ?? null;
}

const FREE_PLAN_LIMIT = 10;
const VALID_DIET_MODES = ["oriental", "vegan", "lacto_ovo", "custom"];

function getDietMode(reqBody) {
  const mode = reqBody?.diet_mode;
  return VALID_DIET_MODES.includes(mode) ? mode : "oriental";
}

async function checkScanLimit(req, res) {
  if (!req.user) return true;
  const sb = getSupabase();
  if (!sb) return true;
  const { data } = await sb.from("user_profiles")
    .select("plan, scan_count, scan_month")
    .eq("id", req.user.id)
    .single();
  const month = new Date().toISOString().slice(0, 7);
  const used  = data?.scan_month === month ? (data?.scan_count || 0) : 0;
  const plan = data?.plan || "free";
  const isLimited = plan === "free" && used >= FREE_PLAN_LIMIT;
  if (isLimited) {
    res.status(429).json({ ok: false, error: "scan_limit_exceeded", message: "今月の無料枠（10回）を使い切りました" });
    return false;
  }
  // tester・pro・business は制限なし
  return true;
}

async function incrementScanCount(userId) {
  if (!userId) return;
  const sb = getSupabase();
  if (!sb) return;
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await sb.from("user_profiles").select("scan_count, scan_month").eq("id", userId).single();
  const newCount = data?.scan_month === month ? (data?.scan_count || 0) + 1 : 1;
  await sb.from("user_profiles").update({ scan_count: newCount, scan_month: month }).eq("id", userId);
}

async function insertScanLog(userId, dietMode = "oriental") {
  if (!userId) return;
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.from("scan_logs").insert({ user_id: userId, diet_mode: dietMode }); } catch {}
}

function hashIngredientText(text) {
  const normalized = String(text)
    .trim()
    .replace(/[（）]/g, (c) => c === "（" ? "(" : ")")
    .replace(/　/g, " ")
    .replace(/[、・，,／/]/g, ",")
    .replace(/\s+/g, "")
    .toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function getCached(hash, dietMode = "oriental") {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("ingredient_cache")
      .select("analysis_result, hit_count")
      .eq("ingredient_hash", hash)
      .eq("diet_mode", dietMode)
      .single();
    if (error || !data) return null;
    sb.from("ingredient_cache")
      .update({ hit_count: data.hit_count + 1 })
      .eq("ingredient_hash", hash)
      .eq("diet_mode", dietMode)
      .then(() => {}).catch(() => {});
    console.log(`[Cache HIT] hash=${hash.slice(0, 8)}...`);
    return data.analysis_result;
  } catch {
    return null;
  }
}

async function setCache(hash, text, result, dietMode = "oriental") {
  const sb = getSupabase();
  if (!sb) { console.error("[Cache] Supabase 未設定（環境変数を確認）"); return; }
  try {
    const { error } = await sb.from("ingredient_cache").upsert(
      { ingredient_hash: hash, ingredient_text: text, analysis_result: result, diet_mode: dietMode },
      { onConflict: "ingredient_hash,diet_mode" },
    );
    if (error) {
      console.error(`[Cache SET失敗] ${error.message} (code=${error.code})`);
    } else {
      console.log(`[Cache SET] hash=${hash.slice(0, 8)}...`);
    }
  } catch (e) {
    console.error("[Cache] 保存失敗:", e.message);
  }
}

const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

const ORIENTAL_RULES = `
オリエンタルベジタリアン判定基準:
NG: 肉類全般・魚介類全般・五葷（ニンニク・ネギ・ニラ・らっきょう・玉ねぎ、エキス・パウダー・加工品含む）・コチニール色素(E120)・コラーゲン・ゼラチン・シェラック・動物性油脂
OK: 卵・乳製品全般・カゼイン・蜂蜜・ローヤルゼリー・大豆レシチン・乳酸・植物性油脂全般・ビタミンD（羊毛由来）・アサフェティダ・大豆・大豆製品全般（醤油・味噌・豆腐・豆乳・大豆たんぱく・納豆・きな粉等）・穀物全般・野菜全般（セロリを含む）・果物全般
注意（誤判定しやすい食材）:
- セロリ: セリ科の野菜でありネギ属ではない。OK。
- セージ: シソ科アキギリ属（サルビア属）のハーブでありネギ属ではない。OK。
グレー: グリセリン（由来不明）・天然香料（動物性の可能性あり）・酵素（動物性はNG）・ビタミンD（由来不明）
`;

const IMAGE_ANALYZE_PROMPT = `この食品パッケージ画像の【原材料名・成分表示ブロック】を読み取り、オリエンタルベジタリアン基準で判定してください。

作業手順:
1. 画像内に「名称」または商品名が記載されていればそれを product_name に入れる
   原材料名欄のテキストを一字一句に近づけて転記する（栄養成分表・キャッチコピーは無視）
2. 転記した各成分を下記基準で分類する

${ORIENTAL_RULES}

未知成分は語尾・E番号・化学名から推測し、confidence（low/medium/high）と reason を付記。

必ず以下のJSON形式のみで返答（説明・Markdown不可）:
{
  "product_name": "商品名・名称欄に記載された名前（見つからない場合はnull）",
  "extractedText": "原材料名欄から写し取った全文（読点「、」区切り）",
  "ok":      [{"name": "成分名", "reason": "理由"}],
  "gray":    [{"name": "成分名", "reason": "理由", "detail": "詳細説明"}],
  "ng":      [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠"}],
  "overall": "ok|gray|ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

const TEXT_ANALYZE_PROMPT = (ingredients) => `あなたは「オリエンタル・ベジタリアン（五葷抜き・乳卵OK）」の専門家です。以下の食品成分リストを判定してください。

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

function fixControlCharsInJsonStrings(str) {
  // 文字単位のステートマシンで JSON 文字列内の制御文字のみエスケープする
  const CTRL = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
  let result = "";
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (!inString) {
      if (c === '"') inString = true;
      result += c;
      i++;
    } else if (c === "\\") {
      result += c;
      i++;
      if (i < str.length) { result += str[i]; i++; }
    } else if (c === '"') {
      inString = false;
      result += c;
      i++;
    } else if (c.charCodeAt(0) < 0x20) {
      result += CTRL[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

function parseGeminiResponse(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("Gemini API から応答がありませんでした");

  // 段階的にパースを試みる（より侵襲的な修正を後段に）
  const candidates = [s];
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/) || s.match(/(\{[\s\S]*\})/);
  if (m) candidates.push(m[1]);

  for (const str of candidates) {
    // Stage 1: そのままパース
    try { return JSON.parse(str); } catch {}
    // Stage 2: ステートマシンで文字列内制御文字を修正
    try { return JSON.parse(fixControlCharsInJsonStrings(str)); } catch {}
    // Stage 3: 全制御文字をスペースに置換（最終手段。成分名の改行は失われるが許容）
    try { return JSON.parse(str.replace(/[\x00-\x1F\x7F]/g, " ")); } catch {}
  }

  // デバッグ: 最初の制御文字の位置を記録
  const dbg = [...s].findIndex((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7F);
  console.error(`[Gemini parse失敗] len=${s.length} 最初の制御文字位置=${dbg} char=${dbg >= 0 ? s.charCodeAt(dbg) : "none"}`);
  throw new Error("Gemini レスポンスの解析に失敗しました");
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// =============================================
// POST /api/analyze/gemini/image  — 1ステップ（読み取り＋判定）
// =============================================
router.post("/image", async (req, res, next) => {
  const { image } = req.body;
  const dietMode = getDietMode(req.body);

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

    let geminiData;
    try { geminiData = await geminiRes.json(); } catch {
      throw new Error(`Gemini API の応答が不完全です (${geminiRes.status})。もう一度試してください。`);
    }
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

    const productName = parsed.product_name ?? null;
    res.json({ ok: true, data: classification, extractedText, product_name: productName });
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

  const dietMode = getDietMode(req.body);
  const ingredientsStr = String(ingredients).trim();
  const hash = hashIngredientText(ingredientsStr);

  try {
    if (!await checkScanLimit(req, res)) return;

    const cached = await getCached(hash, dietMode);
    if (cached) {
      await incrementScanCount(req.user?.id);
      return res.json({ ok: true, data: cached, fromCache: true });
    }

    const geminiRes = await geminiCall(apiKey, {
      contents: [{ parts: [{ text: TEXT_ANALYZE_PROMPT(ingredientsStr) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });

    let geminiData;
    try { geminiData = await geminiRes.json(); } catch {
      throw new Error(`Gemini API の応答が不完全です (${geminiRes.status})。もう一度試してください。`);
    }
    if (!geminiRes.ok) {
      throw new Error(geminiData?.error?.message || `Gemini API エラー (${geminiRes.status})`);
    }

    const result = parseGeminiResponse(extractGeminiText(geminiData));
    if (!Array.isArray(result.unknown)) result.unknown = [];

    await setCache(hash, ingredientsStr, result, dietMode);
    await incrementScanCount(req.user?.id);
    await insertScanLog(req.user?.id, dietMode);
    res.json({ ok: true, data: result });
  } catch (e) {
    next(e);
  }
});

// =============================================
// POST /api/analyze/gemini/image/detailed
// 1ステップ: 成分ごとにOCR確信度・BBox・ベジ判定を返す
// =============================================

const DETAILED_IMAGE_PROMPT = `あなたはプロ仕様のOCRスキャナーです。食品パッケージ画像から「原材料名欄」のテキストを抽出し、以下のJSON形式で出力してください。

=== 読み取りルール（厳守） ===

- 画像に写っている文字のみを正確に転記する。推測・補完・知識による補足は絶対禁止
- 「この食品なら○○があるはず」という先入観を排除し、ピクセル上の文字だけを見る
- 読み取れない・不明な文字は [?] と記す
- 栄養成分表・賞味期限・キャッチコピーなど原材料名欄以外は無視する

=== 画像品質 ===

image_quality: "good"（全文字はっきり読める）| "fair"（かすれ・小さい・斜め）| "poor"（読み取り困難）
"fair"/"poor" の場合は全成分を requires_user_check: true にする

=== requires_user_check ===

true にする条件（いずれか）:
- 文字がかすれ・つぶれ・小さくて確信が持てない
- 似た字（ン/ソ、己/已 など）で迷う
- confidence < 0.85

true の場合、テキスト末尾に [?] を付加する

=== 座標（bounding_box） ===

[ymin, xmin, ymax, xmax] 形式（0〜1000 スケール）。不明は [0,0,0,0]。

=== オリエンタルベジタリアン判定（vege_status） ===

"Red"   : 五葷（にんにく・ねぎ・にら・らっきょう・あさつき のみ。セロリ・セージ・その他ハーブ類はネギ属ではないためGreen）または動物性（肉・魚・ゼラチン等）
"Yellow": 由来不明・要確認（グリセリン・天然香料・酵素等）または requires_user_check=true
"Green" : 明確に安全な植物性成分（植物油脂・卵・乳製品・カゼイン・蜂蜜・ローヤルゼリー・砂糖・塩・大豆製品全般（醤油・味噌・豆腐・豆乳・大豆たんぱく等）・穀物・野菜・果物等）

=== final_decision ===

"NG"     : Red が1つ以上
"Pending": Red なし・Yellow または requires_user_check が1つ以上
"OK"     : すべて Green かつ requires_user_check がすべて false

=== 出力形式（説明・Markdown・コードフェンス禁止。JSONのみ） ===

{
  "image_quality": "good",
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

const GEMINI_TIMEOUT_MS = 45_000;

async function geminiCall(apiKey, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Gemini API タイムアウト（45秒）。画像が大きすぎるか電波が不安定です。");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

router.post("/image/detailed", async (req, res, next) => {
  const { image } = req.body;
  const dietMode = getDietMode(req.body);

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
    if (!await checkScanLimit(req, res)) return;

    console.log(`[Gemini /image/detailed] model="${GEMINI_MODEL}" mediaType="${image.mediaType}"`);
    const geminiRes = await geminiCall(apiKey, {
      contents: [{
        parts: [
          { inlineData: { mimeType: image.mediaType, data: image.data } },
          { text: DETAILED_IMAGE_PROMPT },
        ],
      }],
      generationConfig: { temperature: 0 },
    });

    let geminiData;
    try { geminiData = await geminiRes.json(); } catch (jsonErr) {
      console.error(`[Gemini /image/detailed] geminiRes.json() 失敗 status=${geminiRes.status}: ${jsonErr.message}`);
      throw new Error(`Gemini API の応答が不完全です (${geminiRes.status})。もう一度試してください。`);
    }
    if (!geminiRes.ok) {
      throw new Error(geminiData?.error?.message || `Gemini API エラー (${geminiRes.status})`);
    }

    const rawText = extractGeminiText(geminiData);
    console.log(`[Gemini /image/detailed] rawText length=${rawText.length} preview="${rawText.slice(0, 120).replace(/\n/g, "\\n")}"`);
    const parsed = parseGeminiResponse(rawText);

    if (!Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。原材料の範囲を選択してから再試行してください。",
      });
    }

    const CONFIDENCE_THRESHOLD = 0.85;
    const imageFair = parsed.image_quality === "fair" || parsed.image_quality === "poor";

    parsed.ingredients = parsed.ingredients.map((item) => {
      const conf = typeof item.confidence === "number" ? item.confidence : 1.0;
      const forceCheck = conf < CONFIDENCE_THRESHOLD || imageFair;
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

    const cacheHash = hashIngredientText(extractedText);
    await setCache(cacheHash, extractedText, parsed, dietMode);
    await incrementScanCount(req.user?.id);
    await insertScanLog(req.user?.id, dietMode);

    res.json({ ok: true, data: parsed, extractedText });
  } catch (e) {
    next(e);
  }
});

export default router;
