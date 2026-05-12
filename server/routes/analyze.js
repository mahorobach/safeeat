import { Router } from "express";

const router = Router();
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL_DEFAULT = "claude-sonnet-4-20250514";
/** テキスト判定（未設定時は Sonnet） */
const MODEL_TEXT = (process.env.CLAUDE_MODEL || "").trim() || MODEL_DEFAULT;
/**
 * extractOnly（読み取り専用）。精度優先のため既定はテキスト判定と同じモデル（通常 Sonnet）。
 * 高速化だけ優先する場合: CLAUDE_IMAGE_EXTRACT_MODEL=claude-haiku-4-5
 */
const MODEL_IMAGE_EXTRACT = (process.env.CLAUDE_IMAGE_EXTRACT_MODEL || "").trim() || MODEL_TEXT;

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
- セロリ（セリ科の野菜であり、ネギ属・五葷ではないためOK）

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
const IMAGE_EXTRACT_SYSTEM = `あなたは日本の食品パッケージ【原材料名欄】を写し取る純粋なOCRスキャナーです。

=== STEP 1: 画像に実際に見えている文字を全て書き出す ===
原材料名欄に写っているひらがな・カタカナ・漢字・英数字を目に見えたまま列挙してください。
単語として意味が通じなくても構わない。見たままの文字の並びを最優先せよ。
「この食品には○○が入っているはず」という食品知識・先入観を一切使わない。

=== STEP 2: STEP 1 の文字だけで原材料リストを構成する ===
STEP 1 で見えた文字・単語だけを使って ingredientListRaw を作成してください。

絶対禁止:
- 食品の種類（ラーメン・お菓子など）の知識から成分を推測・補完しない
- STEP 1 で見えなかった文字を使わない
- 読めない・不鮮明な部分は [読取不能] と書く。前後の成分から別の語を作らない
- 「鶏肉」「ねぎ」「玉ねぎ」など五葷・肉類は特に慎重に。画像にその文字がなければ絶対に出力しない

その他のルール:
- 栄養成分表・キャッチコピー・写真は無視する
- 括弧「（）」内の文は崩さない
- アレルゲン括弧書き「（一部に小麦・大豆を含む）」は列の末尾に原文に近い形で含める
- ingredientListRaw は日本語読点「、」区切りの1文字列

出力は次の1行のJSONのみ（説明・Markdown・コードフェンス禁止）:
{"ingredientListRaw":"ここへ上記ルールで写し取った全文"}`;

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
      max_tokens: 8192,
      /* 読み取り専用 Vision は temperature 未指定（API 既定） */
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
              text: "この画像の【原材料・添加物の表示ブロック】だけを写し取ってください。まず見えている文字を全て列挙し（STEP 1）、その文字だけで原材料リストを構成してください（STEP 2）。見えていない成分は絶対に追加しない。特に「鶏肉」「ねぎ」「玉ねぎ」などの単語は、画像にその文字が実際に見える場合のみ出力する。出力は system で指定した1行JSONのみ。",
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
    const { image } = req.body;

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

      return res.status(400).json({
        ok: false,
        error:
          "画像でのワンショット判定は廃止しました。extractOnly: true でテキストのみ抽出し、続けて type を省略（既定で text）した POST で ingredients に抽出テキストを渡してください。一本化したい場合は POST /api/analyze/image を利用できます。",
      });
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
// POST /api/analyze/image  — 抽出（Vision）→ テキスト判定（内部2往復、フロント不要時向け）
// =============================================
router.post("/image", async (req, res, next) => {
  const { image, mimeType } = req.body;

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
    const extractedText = await extractIngredientsTextFromImage(image, mimeType, apiKey);
    const trimmed = String(extractedText || "").trim();
    if (!trimmed) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。画像を確認してください。",
      });
    }

    const result = await analyzeIngredients(trimmed, apiKey);
    const n =
      (result.ok || []).length +
      (result.gray || []).length +
      (result.ng || []).length +
      (result.unknown || []).length;
    if (n === 0) {
      return res.status(422).json({
        ok: false,
        error: "成分表が読み取れませんでした。画像を確認してください。",
      });
    }

    res.json({
      ok: true,
      data: result,
      extractedText: trimmed,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
