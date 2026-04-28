/**
 * SafeEat — Claude API 通信処理
 * Phase 1: オリエンタルベジタリアン特化
 */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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
- 魚油・DHA・EPA: 魚由来→NG / 藻類由来→OK

【未知成分の処理】
成分名が判定基準に存在しない場合:
- 語尾・接頭辞（〜エキス、〜油、〜タンパク等）から由来を推測
- E番号（食品添加物コード）から種別を特定
- 化学名から動物性か植物性かを判断
- 推測の場合はconfidenceとreasonを必ず付記すること

必ず以下のJSON形式のみで返答すること（他のテキストは絶対に含めないこと）:
{
  "ok": [{"name": "成分名", "reason": "理由"}],
  "gray": [{"name": "成分名", "reason": "理由", "detail": "詳細説明（植物性→OK、動物性→NG等）"}],
  "ng": [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠（日本語）"}],
  "overall": "ok" または "gray" または "ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

/**
 * @param {string} ingredientsText - 成分表テキスト
 * @param {string} apiKey - Claude APIキー
 * @returns {Promise<{ok, gray, ng, unknown, overall, summary}>}
 */
async function analyzeWithClaude(ingredientsText, apiKey) {
  const body = {
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下の成分リストをオリエンタルベジタリアン基準で分類してください:\n\n${ingredientsText}`,
      },
    ],
  };

  const response = await fetchWithRetry(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || `APIエラー (${response.status})`;
    throw new Error(errMsg);
  }

  const text = data.content?.[0]?.text || "";
  return parseClaudeResponse(text);
}

function parseClaudeResponse(text) {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    throw new Error("APIからのレスポンスを解析できませんでした。");
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    // unknown が未定義の場合はデフォルト値で補完
    if (!Array.isArray(parsed.unknown)) parsed.unknown = [];
    return parsed;
  } catch {
    throw new Error("JSONの解析に失敗しました。");
  }
}

/**
 * 指数バックオフ付きフェッチ（最大3回リトライ）
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status === 529) {
        const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await sleep(waitMs);
        lastError = new Error(`レート制限 (${res.status})。しばらくお待ちください。`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  throw lastError;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
