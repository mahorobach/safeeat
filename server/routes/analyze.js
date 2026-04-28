import { Router } from "express";

const router = Router();
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

【未知成分の処理】
成分名が判定基準に存在しない場合:
- 語尾・接頭辞（〜エキス、〜油、〜タンパク等）から由来を推測
- E番号（食品添加物コード）から種別を特定
- 化学名から動物性か植物性かを判断
- 推測の場合はconfidenceとreasonを必ず付記すること

必ず以下のJSON形式のみで返答すること（他のテキストは絶対に含めないこと）:
{
  "ok": [{"name": "成分名", "reason": "理由"}],
  "gray": [{"name": "成分名", "reason": "理由", "detail": "詳細説明"}],
  "ng": [{"name": "成分名", "reason": "理由"}],
  "unknown": [{"name": "成分名", "inferred": "ok|gray|ng", "confidence": "low|medium|high", "reason": "推測根拠（日本語）"}],
  "overall": "ok" または "gray" または "ng",
  "summary": "総合コメント（日本語・2〜3文）"
}`;

// POST /api/analyze
router.post("/", async (req, res, next) => {
  const { ingredients } = req.body;

  if (!ingredients || !String(ingredients).trim()) {
    return res.status(400).json({ ok: false, error: "ingredients は必須です" });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "サーバー設定エラー（APIキー未設定）" });
  }

  try {
    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `以下の成分リストをオリエンタルベジタリアン基準で分類してください:\n\n${ingredients}`,
          },
        ],
      }),
    });

    const data = await claudeRes.json();

    if (!claudeRes.ok) {
      const msg = data?.error?.message || `Claude APIエラー (${claudeRes.status})`;
      return res.status(502).json({ ok: false, error: msg });
    }

    const text = data.content?.[0]?.text || "";
    const result = parseClaudeResponse(text);
    res.json({ ok: true, data: result });
  } catch (e) {
    next(e);
  }
});

function parseClaudeResponse(text) {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("レスポンスの解析に失敗しました");

  const parsed = JSON.parse(jsonMatch[1]);
  if (!Array.isArray(parsed.unknown)) parsed.unknown = [];
  return parsed;
}

export default router;
