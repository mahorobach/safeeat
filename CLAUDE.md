# SafeEat — Claude Code 指示

**作業前に `README.md` を読むこと。** アーキテクチャ・フロー・環境変数・ロードマップがすべて揃っている。

## 絶対ルール

| ルール | 理由 |
|---|---|
| `web/` から Claude / Gemini API を直接呼ばない | APIキー漏洩防止 |
| APIキーを `web/` に置かない | 環境変数はサーバー側のみ |
| `safeat.js` は UI操作のみ記述する | ビジネスロジックをUIに混在させない |

## 現在の解析エンジン（固定）

**Gemini 詳細モード（`gemini-2.5-flash`）のみ使用。** Claude エンジン・通常 Gemini の選択UIは廃止済み。

- エンジン選択: `getSelectedEngine()` は常に `"gemini-detailed"` を返す
- 画像解析: `POST /api/analyze/gemini/image/detailed`
- テキスト解析: `POST /api/analyze/gemini/text`

## 写真フロー（変更禁止）

**Gemini 1ステップフロー（現行）:**

1. **解析:** `POST /api/analyze/gemini/image/detailed` with `{ image: { data, mediaType } }`
   → `{ data: { ingredients, final_decision }, extractedText }` が返る
2. フロントで `extractedText` をテキストエリアに表示・写真と並べて確認
3. 必要に応じてテキストを手動修正後、`POST /api/analyze/gemini/text` で再判定

**旧 Claude 2ステップフロー（参考・廃止はしていない）:**
1. `POST /api/analyze` with `{ type: "image", extractOnly: true }` → `extractedText`
2. `POST /api/analyze` with `{ ingredients: "..." }`

`type: "image"` かつ `extractOnly` なしのワンショットは **廃止（400）**。

## Gemini API 設定

- APIバージョン: `v1beta`（コード内に固定、環境変数では変更不可）
- モデル: `GEMINI_MODEL` 環境変数で切替（デフォルト: `gemini-1.5-flash`）
- `models/` プレフィックス付きで設定しても自動的に除去される
- `responseMimeType: "application/json"` はテキストルートのみ有効

## キャッシュ（Supabase `ingredient_cache`）

- `/text` ルート: 成分テキストの SHA-256 ハッシュでキャッシュ検索 → ヒット時は Gemini API 不使用
- `/image/detailed` ルート: OCR 後の `extractedText` をキャッシュに保存（検索はしない）
- Supabase 未設定時はキャッシュを無視して正常動作

## 判定ロジックの場所

- ブラウザ用（オフライン）: `web/lib/rules.js`
- 共通版（Node.js + ブラウザ）: `shared/rules.js`
- Claude 判定プロンプト: `server/routes/analyze.js`
- Gemini 判定プロンプト: `server/routes/analyze-gemini.js`

## 二重送信・リトライの制御

- フロントエンド: `_isAnalyzing` フラグで解析中の重複クリックを防止
- `fetchWithRetry`: **429（クォータ超過）はリトライしない**（リトライするとクォータをさらに消費）
- サーバー: `geminiCall()` に 45 秒の AbortController タイムアウト

## 作業後チェックリスト

- [ ] `web/` にシークレットを置いていない
- [ ] Gemini ルートの `geminiRes.json()` は try-catch で囲む
- [ ] 新ルート追加時は CORS・`server/index.js` のマウント確認
- [ ] 本番URL変更時は `web/site-config.js` と `ALLOWED_ORIGINS` の両方
- [ ] モデル変更は Railway の `GEMINI_MODEL` 環境変数のみ（コード変更不要）
