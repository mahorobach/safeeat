import { Router } from "express";

const router = Router();
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL_DEFAULT = "claude-sonnet-4-20250514";
/** テキスト判定（未設定時は Sonnet） */
const MODEL_TEXT = (process.env.CLAUDE_MODEL || "").trim() || MODEL_DEFAULT;
/**
 * 画像1往復用（未設定時は MODEL_TEXT と同じ）
 * 高速化したい場合は Vision 対応の Haiku 4.5 例: claude-haiku-4-5（claude-3-5-haiku-20241022 は廃止）
 */
const MODEL_IMAGE = (process.env.CLAUDE_IMAGE_MODEL || "").trim() || MODEL_TEXT;
/**
 * extractOnly（読み取り専用）のみ。応答が遅いとプロキシが先に切れるため既定は高速 Vision。
 * 上書き: CLAUDE_IMAGE_EXTRACT_MODEL
 * 既定: Haiku 4.5（2026 時点で claude-3-5-haiku-20241022 は API から拒否される）
 */
const MODEL_IMAGE_EXTRACT =
  (process.env.CLAUDE_IMAGE_EXTRACT_MODEL || "").trim() || "claude-haiku-4-5";

/** 0 に近いほど表記ブレを抑える（省略時は 0）。CLAUDE_TEMPERATURE で上書き可 */
const CLAUDE_TEMPERATURE = (() => {
  const raw = (process.env.CLAUDE_TEMPERATURE ?? "").trim();
  if (raw === "") return 0;
  const t = Number(raw);
  return Number.isFinite(t) ? t : 0;
})();

const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB（Base64デコード後のサイズ）

// =============================================
// システムプロンプト（テキスト判定・画像判定共用）
// =============================================
const SYSTEM_PROMPT = `あなたは食品成分の専門家です。
オリエンタルベジタリアンの基準で各成分を厳密に分類してください。
日本語の成分名（片仮名・漢字・ひらがな混じり）、食品添加物のE番号、化学名にも正確に対応してください。

【オリエンタルベジタリアンの判定基準】

❌ NG（食べられない）:
- 肉類全般（牛・豚・鶏・羊・馬・鴨等）およびそのエキス・加工品
- 魚介類全般（魚・えび・かに・貝類・イカ・タコ等）およびフィッシュエキス・魚醤等
- 五葷: ニンニク・ネギ・ニラ・らっきょう・玉ねぎ（エキス・パウダー・加工品を含む）
- コチニール色素・カルミン（E120）: カイガラムシ（虫）由来
- コラーゲン: 動物（魚・豚・牛）由来
- ゼラチン: 動物由来
- シェラック・ラック色素: ラックカイガラムシ（虫）由来
- 動物性油脂（ラード・牛脂・チキンファット等）

✅ OK（食べられる）:
- 卵・卵黄・卵白・卵黄レシチン
- 乳製品全般（牛乳・バター・チーズ・ヨーグルト・クリーム等）
- カゼイン（牛乳由来タンパク質）
- 蜂蜜・ローヤルゼリー・プロポリス
- 大豆レシチン（植物性）
- 乳酸・乳酸ナトリウム（発酵由来）
- 植物性油脂全般
- ビタミンD（羊毛由来・ラノリン由来）
- アサフェティダ（五葷の代替スパイス）
- 海藻類・大豆製品・野菜・果物・穀物

🟡 グレー（由来によって異なる）:
- グリセリン: 植物性→OK / 動物性→NG
- 天然香料: 植物性→OK / 動物性ムスク等→NG
- 酵素: 微生物・植物性→OK / 動物性（ペプシン等）→NG
- ビタミンD（由来不明）: キノコ・羊毛脂由来→OK / 由来不明→グレー
- レシチン（由来不明）: 大豆・卵黄→OK / 動物性→要確認

【未知成分の処理】
成分名が判定基準に存在しない場合:
- 語尾・接頭辞（〜エキス、〜油、〜タンパク等）から由来を推測
- E番号（食品添加物コード）から種別を特定
- 化学名から動物性か植物性かを判断
- 推測の場合はconfidenceとreasonを必ず付記すること

必ず以下のJSON形式のみで返答すること（他のテキストは絶対に含めないこと）:
- ingredientListRaw には入力に現れる**すべての成分名**を含めること（1つも省略・統合・「など」への丸めをしない）。ok/gray/ng/unknown の各 name は ingredientListRaw と矛盾しないこと。
{
  "ingredientListRaw": "扱う全成分名をカンマ区切りの1文字列で列挙（画像入力時は読み取り結果・テキスト入力時は入力一覧に基づく）",
  "ok": [{"name": "成分名", "reason": "理由"}],
  "gray": [{"name": "成分名", "reason": "理由", "detail": "詳細説明"}],
  "ng": [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠（日本語）"}],
  "overall": "ok" または "gray" または "ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

// =============================================
// 共通: Claude に成分判定を依頼
// =============================================
async function analyzeIngredients(ingredientsText, apiKey) {
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_TEXT,
      max_tokens: 2000,
      temperature: CLAUDE_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `以下の成分リストをオリエンタルベジタリアン基準で分類してください:\n\n${ingredientsText}`,
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Claude APIエラー (${res.status})`);
  }

  const parsed = parseClaudeResponse(getAnthropicText(data));
  return splitClassificationResult(parsed).result;
}

function splitClassificationResult(parsed) {
  const raw = typeof parsed.ingredientListRaw === "string" ? parsed.ingredientListRaw.trim() : "";
  const { ingredientListRaw: _unused, ...rest } = parsed;
  if (!Array.isArray(rest.unknown)) rest.unknown = [];

  let extractedText = raw;
  if (!extractedText) {
    extractedText = [
      ...(rest.ok || []).map((x) => x.name),
      ...(rest.gray || []).map((x) => x.name),
      ...(rest.ng || []).map((x) => x.name),
      ...(rest.unknown || []).map((x) => x.name),
    ].join("、");
  }
  return { extractedText, result: rest };
}

/**
 * 画像1枚で読み取り＋分類（Claude 往復1回）— タイムアウト回避・コスト削減
 */
async function analyzeFromImageSingleCall(image, mimeType, apiKey) {
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_IMAGE,
      max_tokens: 4096,
      temperature: CLAUDE_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: image,
              },
            },
            {
              type: "text",
              text: "この画像の【原材料名・成分表示】のみを読み取り、上記ルールのJSON**だけ**を返してください。パッケージ写真・ロゴ・バーコード・栄養成分表のその他の欄は無視してください。",
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Claude Vision APIエラー (${res.status})`);
  }

  const text = getAnthropicText(data);
  const parsed = parseClaudeResponse(text);
  return splitClassificationResult(parsed);
}

function parseClaudeResponse(text) {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("レスポンスの解析に失敗しました");

  const parsed = JSON.parse(jsonMatch[1]);
  if (!Array.isArray(parsed.unknown)) parsed.unknown = [];
  return parsed;
}

/** Messages API の content 配列から最初のテキストを取得（model 差・ブロック順差の吸収） */
function getAnthropicText(data) {
  const parts = data?.content;
  if (!Array.isArray(parts)) return "";
  const block = parts.find((p) => p?.type === "text" && typeof p.text === "string");
  return block ? block.text : "";
}

/** 先頭の { … } を文字列リテラル内を考慮して切り出し */
function extractBalancedJsonObject(s, startIdx) {
  if (!s || s[startIdx] !== "{") return null;
  let depth = 0;
  let inString = false;
  let i = startIdx;
  while (i < s.length) {
    const c = s[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
    i++;
  }
  return null;
}

function truthyExtractOnly(v) {
  if (v === true || v === 1) return true;
  if (typeof v === "string" && v.toLowerCase() === "true") return true;
  return false;
}

// =============================================
// 画像 → 成分テキストのみ（判定なし・応答短く切り分け用）
// =============================================
const IMAGE_EXTRACT_SYSTEM = `あなたは日本の食品パッケージの【原材料名・成分表示】を読み取る専用アシスタントです。
デザイン・ロゴ・栄養成分表・広告文は無視し、原材料・添加物の列挙だけを抽出してください。

読み取りの指針:
- 写真に**判読できる**成分・添加物はできるだけすべて ingredientListRaw に入れる（見落としを減らす。並びはラベルに近い順）
- 魚介・昆布などの**エキス／エキスパウダー**は、見える表記に近い形で列挙する（例: カツオエキス）

次の1行のJSON**だけ**を返してください（前後の説明・Markdown・コードフェンスは禁止）:
{"ingredientListRaw":"カンマまたは読点区切りで成分名を1行に列挙"}`;

function parseExtractOnlyResponse(text) {
  const rawInput = String(text || "").trim();
  if (!rawInput) {
    throw new Error("APIからテキストが返りませんでした。しばらくして再試行してください。");
  }

  const fromIngredientKey = (parsed) => {
    const raw = typeof parsed.ingredientListRaw === "string" ? parsed.ingredientListRaw.trim() : "";
    return raw || null;
  };

  const tryParseJson = (slice) => {
    try {
      const parsed = JSON.parse(slice.trim());
      return fromIngredientKey(parsed);
    } catch {
      return null;
    }
  };

  const fence = rawInput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const v = tryParseJson(fence[1]);
    if (v) return v;
  }

  const i = rawInput.indexOf("{");
  if (i >= 0) {
    const balanced = extractBalancedJsonObject(rawInput, i);
    if (balanced) {
      const v = tryParseJson(balanced);
      if (v) return v;
    }
  }

  const lines = rawInput.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const plain =
    lines.find((l) => /[、,]/.test(l) && l.length >= 6) ||
    (/[、,]/.test(rawInput) && rawInput.length >= 6 ? rawInput : "");
  if (plain) {
    return plain.replace(/^原材料[：:]\s*/i, "").replace(/^成分[：:]\s*/i, "").trim();
  }

  throw new Error("読み取り結果の解析に失敗しました。画像を切り取るか再試行してください。");
}

async function extractIngredientsTextFromImage(image, mimeType, apiKey) {
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_IMAGE_EXTRACT,
      max_tokens: 4096,
      /* 読み取り専用 Vision は temperature 未指定（API 既定）。0 だと細字・エキス行の再現が落ちることがある */
      system: IMAGE_EXTRACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: image,
              },
            },
            {
              type: "text",
              text: "この画像の原材料・成分表示を読み取り、指定の1行JSONだけを返してください。小さな字の行も含め、判読できるものはできるだけ漏れなく列挙してください。",
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Claude Vision APIエラー (${res.status})`);
  }

  return parseExtractOnlyResponse(getAnthropicText(data));
}

function getApiKey(res) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "サーバー設定エラー（APIキー未設定）" });
    return null;
  }
  return apiKey;
}

// =============================================
// POST /api/analyze  — type フィールドで text / image を切り替え
// =============================================
router.post("/", async (req, res, next) => {
  const { type = "text" } = req.body;

  if (type === "image") {
    const { image, mode = "oriental" } = req.body;

    if (!image || !image.data) {
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

    const apiKey = getApiKey(res);
    if (!apiKey) return;

    try {
      if (truthyExtractOnly(req.body.extractOnly)) {
        const extractedText = await extractIngredientsTextFromImage(
          image.data,
          image.mediaType,
          apiKey,
        );
        res.json({
          ok: true,
          extractOnly: true,
          extractedText,
        });
        return;
      }

      const { extractedText, result } = await analyzeFromImageSingleCall(
        image.data,
        image.mediaType,
        apiKey,
      );
      const n =
        (result.ok || []).length +
        (result.gray || []).length +
        (result.ng || []).length +
        (result.unknown || []).length;
      if (n === 0 && !String(extractedText || "").trim()) {
        return res.status(422).json({
          ok: false,
          error: "成分表が読み取れませんでした。別の角度から撮影するか、原材料の範囲を切り取ってください。",
        });
      }
      res.json({ ok: true, data: result, extractedText });
    } catch (e) {
      next(e);
    }

  } else {
    // テキスト判定（既存）
    const { ingredients } = req.body;
    if (!ingredients || !String(ingredients).trim()) {
      return res.status(400).json({ ok: false, error: "ingredients は必須です" });
    }

    const apiKey = getApiKey(res);
    if (!apiKey) return;

    try {
      const result = await analyzeIngredients(String(ingredients), apiKey);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  }
});

// =============================================
// POST /api/analyze/image  — 画像 → 成分抽出 → 判定（新規）
// =============================================
router.post("/image", async (req, res, next) => {
  const { image, mimeType, mode = "oriental" } = req.body;

  // バリデーション
  if (!image) {
    return res.status(400).json({ ok: false, error: "image は必須です（Base64文字列）" });
  }
  if (!VALID_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({
      ok: false,
      error: `mimeType が不正です。対応形式: ${VALID_MIME_TYPES.join(", ")}`,
    });
  }

  // ファイルサイズチェック（Base64デコード後の実サイズ）
  const sizeBytes = Buffer.byteLength(image, "base64");
  if (sizeBytes > IMAGE_SIZE_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `画像サイズが上限（5MB）を超えています（${(sizeBytes / 1024 / 1024).toFixed(1)}MB）`,
    });
  }

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  try {
    const { extractedText, result } = await analyzeFromImageSingleCall(image, mimeType, apiKey);
    const n =
      (result.ok || []).length +
      (result.gray || []).length +
      (result.ng || []).length +
      (result.unknown || []).length;
    if (n === 0 && !String(extractedText || "").trim()) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。画像を確認してください。",
      });
    }

    res.json({
      ok: true,
      data: result,
      extractedText,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
