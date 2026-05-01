# SafeEat — Claude Code 指示

**作業前に `README.md` を読むこと。** アーキテクチャ・フロー・環境変数・ロードマップがすべて揃っている。

## 絶対ルール

| ルール | 理由 |
|---|---|
| `web/` から Claude API を直接呼ばない | APIキー漏洩防止 |
| APIキーを `web/` に置かない | `CLAUDE_API_KEY` はサーバー環境変数のみ |
| `safeat.js` は UI操作のみ記述する | ビジネスロジックをUIに混在させない |

## 写真フロー（変更禁止）

1. **抽出:** `POST /api/analyze` with `{ type: "image", extractOnly: true }` → `extractedText`
2. **判定:** `POST /api/analyze` with `{ ingredients: "..." }`

`type: "image"` かつ `extractOnly` なしのワンショットは **廃止（400）**。

## 判定ロジックの場所

- ブラウザ用（オフライン）: `web/lib/rules.js`
- 共通版（Node.js + ブラウザ）: `shared/rules.js`
- Claude 判定プロンプト: `server/routes/analyze.js`

## 作業後チェックリスト

- [ ] `web/` にシークレットを置いていない
- [ ] 写真フローが extractOnly → ingredients と齟齬ない
- [ ] 新ルート追加時は CORS・`server/index.js` のマウント確認
- [ ] 本番URL変更時は `web/site-config.js` と `ALLOWED_ORIGINS` の両方
