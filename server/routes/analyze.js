import { Router } from "express";

const router = Router();
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL_DEFAULT = "claude-sonnet-4-20250514";
/** テキスト判定（未設定時は Sonnet） */
const MODEL_TEXT = (process.env.CLAUDE_MODEL || "").trim() || MODEL_DEFAULT;
/**
 * 画像1往復用（未設定時は MODEL_TEXT と同じ）
 * 遅い・タイムアウトしやすい場合は例: claude-3-5-haiku-20241022（Vision 対応・高速）
 */
const MODEL_IMAGE = (process.env.CLAUDE_IMAGE_MODEL || "").trim() || MODEL_TEXT;

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

  const parsed = parseClaudeResponse(data.content?.[0]?.text || "");
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

  const text = data.content?.[0]?.text || "";
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

// =============================================
// 画像 → 成分テキストのみ（判定なし・応答短く切り分け用）
// =============================================
const IMAGE_EXTRACT_SYSTEM = `あなたは日本の食品パッケージの【原材料名・成分表示】を読み取る専用アシスタントです。
デザイン・ロゴ・栄養成分表・広告文は無視し、原材料・添加物の列挙だけを抽出してください。

次のJSONのみを返してください（前後に説明文やMarkdown_fenceを付けないこと）:
{"ingredientListRaw":"カンマ区切りで成分名を1行に列挙"}`;

function parseExtractOnlyResponse(text) {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("読み取り結果の解析に失敗しました");

  const parsed = JSON.parse(jsonMatch[1]);
  const raw = typeof parsed.ingredientListRaw === "string" ? parsed.ingredientListRaw.trim() : "";
  if (!raw) {
    throw new Error(
      "成分表のテキストが空でした。原材料部分を切り取るか、別の写真をお試しください。",
    );
  }
  return raw;
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
      model: MODEL_IMAGE,
      max_tokens: 4096,
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
              text: "この画像から原材料・成分表示だけを読み取り、指定のJSONだけを返してください。",
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

  return parseExtractOnlyResponse(data.content?.[0]?.text || "");
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
    const { image, mode = "oriental", extractOnly = false } = req.body;

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
      if (extractOnly === true) {
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
