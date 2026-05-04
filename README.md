# SafeEat — 食品成分チェッカー

食品の成分表を入力し、食事スタイル別に成分の安全性を判定するWebアプリ。

---

## ターゲットユーザー

- オリエンタルベジタリアン（五葷抜き）を実践する人
- ゆるベジ・健康志向の日本人
- ヴィーガン・ハラール・アレルギー対応が必要な人（将来対応）
- 訪日外国人（台湾・東南アジア・中東）
- 宗教施設・ベジレストラン・ホテルなどの法人・職員

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / JavaScript（静的） |
| バックエンド | Node.js / Express |
| データベース | Supabase（PostgreSQL） |
| 認証 | Supabase Auth（メール＋パスワード） |
| AI解析（現在） | **Gemini 2.5 Flash**（OCR + 判定 1ステップ） |
| AI解析（Claude・予備） | `claude-sonnet-4-5` 系 |
| キャッシュ | Supabase `ingredient_cache`（SHA-256・モード別複合キー） |
| メール送信 | Resend（SMTP）※設定途中 |
| フロントホスティング | GitHub Pages |
| APIホスティング | Railway |
| ソース管理 | GitHub |
| 決済（将来） | Stripe |

---

## 重要URL

| 項目 | URL |
|---|---|
| フロントエンド | https://mahorobach.github.io/safeeat/web/index.html |
| APIサーバー | https://safeeat-production-b7c5.up.railway.app |
| API死活確認 | https://safeeat-production-b7c5.up.railway.app/api/health |
| GitHubリポジトリ | https://github.com/mahorobach/safeeat |
| 管理者ページ | https://mahorobach.github.io/safeeat/web/admin.html |

---

## ページ構成

| ページ | ファイル | 説明 |
|---|---|---|
| ランディング | `web/index.html` | 未ログイン時のトップページ |
| モード選択 | `web/index.html` | 初回ログイン時のみ表示 |
| スキャンページ | `web/index.html` | ログイン後の解析画面 |
| ユーザー設定 | `web/index.html` | デフォルトモード変更・残り回数確認 |
| 管理者ページ | `web/admin.html` | ユーザー管理・プラン変更 |
| プライバシーポリシー | `web/privacy.html` | 法的ページ |
| 利用規約 | `web/terms.html` | 法的ページ |

---

## 画面遷移フロー

```
未ログイン → ランディングページ
  ↓ 登録・ログイン
初回のみ → モード選択画面
  ↓ モード選択・保存（user_settings.mode_selected = true）
スキャンページ（モードバーで一時切替可能・DBは変わらない）
  ↓
ユーザー設定ページ（デフォルトモード永続変更・残り回数確認・ログアウト）
```

---

## ユーザー認証（Phase 3 完了）

### プラン別制限

| プラン | スキャン回数 | 対象 |
|---|---|---|
| `free` | 月10回（全モード合算） | 一般ユーザー |
| `tester` | 無制限 | 管理者が付与したテストユーザー |
| `pro` | 無制限 | 将来の有料ユーザー |
| `business` | 無制限 | 将来の法人ユーザー |

### Supabaseテーブル（実装済み）

```sql
user_profiles  (id, plan, scan_count, scan_month, created_at, updated_at)
scan_logs      (id, user_id, diet_mode, created_at)
user_settings  (user_id, mode, mode_selected, custom_ng, custom_ok, updated_at)
ingredient_cache (ingredient_hash, diet_mode, ingredient_text, analysis_result, hit_count, created_at)
```

### APIエンドポイント（実装済み）

```
GET  /api/user/me                    → ユーザー情報・残り回数
GET  /api/user/scan-count            → 残り回数（未ログインも可）
POST /api/user/scan-count/increment  → 回数+1・月替わりで自動リセット
GET  /api/user/settings              → 設定取得
PUT  /api/user/settings              → 設定保存（mode・mode_selected）
GET  /api/admin/check                → 管理者チェック
GET  /api/admin/stats                → 統計情報
GET  /api/admin/users                → ユーザー一覧
PUT  /api/admin/users/:id/plan       → プラン変更
```

---

## モード定義（実装済み）

| モード | キー | 説明 |
|---|---|---|
| オリエンタルベジタリアン | `oriental` | 五葷・肉・魚NG。卵・乳製品・蜂蜜OK |
| ヴィーガン | `vegan` | すべての動物由来成分NG |
| ラクト・オボ | `lacto_ovo` | 肉・魚のみNG |
| カスタム | `custom` | 有料プラン・近日公開 |

---

## メール送信設定（★未完了・要対応）

### 現状
- Supabase の「Confirm email」は**OFF**（テスト期間中）
- テスターはメール認証なしで登録・即ログイン可能

### Resend設定状況

| 項目 | 状態 |
|---|---|
| Resendアカウント作成 | ✅ 完了 |
| APIキー作成 | ✅ 完了 |
| Supabase SMTP設定 | ✅ 設定済み（Host: smtp.resend.com / User: resend） |
| `daisho-kikaku.com` ドメイン追加 | ✅ Resendに追加済み |
| XserverでDNSレコード追加 | ⚠️ **途中（要対応）** |
| ドメイン認証完了 | ❌ 未完了 |
| Confirm email をONに戻す | ❌ 未完了 |

### 残りのDNS設定作業

**Xserverパネル → DNS設定 → daisho-kikaku.com → DNSレコード追加**

Resend Dashboard → Domains → daisho-kikaku.com で表示される値を入力：

```
1. DKIM（TXTレコード）
   ホスト名：resend._domainkey
   内容：p=MIGfMA...（Resendに表示されるフルの値）

2. SPF（MXレコード）
   ホスト名：send
   内容：feedback-smtp.ap-northeast-1.amazonses.com
   優先度：10

3. SPF（TXTレコード）
   ホスト名：send
   内容：v=spf1 include:amazonses.com ~all
```

DNS登録後の手順：
1. Resend → 「I've added the records」をクリック
2. ドメインが「Verified」になるまで待つ（最大24時間）
3. Supabase → SMTP Settings → Sender email を `noreply@daisho-kikaku.com` に変更
4. Supabase → Sign In / Providers → Email → 「Confirm email」をONに戻す

---

## 環境変数一覧（Railway）

| 変数 | 必須 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | **はい** | Google AI Studio |
| `GEMINI_MODEL` | 推奨 | 例: `gemini-2.5-flash` |
| `SUPABASE_URL` | **はい** | SupabaseプロジェクトURL |
| `SUPABASE_ANON_KEY` | 認証用 | 公開キー（web/site-config.jsにも設定） |
| `SUPABASE_SERVICE_ROLE_KEY` | **はい** | サービスロール（秘匿） |
| `ADMIN_EMAIL` | **はい** | 管理者メールアドレス |
| `CLAUDE_API_KEY` | 予備 | Anthropic APIキー |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS許可オリジン |
| `PORT` | 任意 | 未設定時は3000 |

---

## 開発フェーズロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コア実証（写真→抽出→編集→判定） | **完了** |
| 2 | Gemini 1ステップ解析 + Supabaseキャッシュ | **完了** |
| 3 | ユーザー認証・月10回制限・管理者ページ | **完了** |
| 3.5 | ランディングページ・モード選択・法的ページ | **完了** |
| 3.6 | メール送信設定（Resend） | **⚠️ 途中** |
| 4 | テストユーザー招待・フィードバック収集 | **← 現在** |
| 5 | UIデザイン改善・集客 | 次 |
| 6 | サブスク課金（Stripe）・プラン管理 | ユーザー数を見て判断 |
| 7 | グレー確認フロー | 有料プランの核心機能 |
| 8 | 判定履歴・お気に入り商品 | ユーザー体験向上 |
| 9 | iOSアプリ化（バーコードスキャン実装時） | 将来 |
| 10 | App Store申請・リリース | 最終ゴール |

---

## 本番リリース前に必ずやること

- [ ] XserverでDNSレコード追加完了
- [ ] Resendでドメイン認証完了
- [ ] Supabase Sender emailを `noreply@daisho-kikaku.com` に変更
- [ ] Supabase「Confirm email」をONに戻す

---

## ハマりポイント・トラブルシュート

| # | 問題 | 原因 | 解決策 |
|---|---|---|---|
| 1〜14 | Gemini・デプロイ系 | 旧バージョン参照 | 旧バージョン参照 |
| 15 | Email not confirmed | 確認メール未クリック | Dashboard → Auth → URL Configuration確認 |
| 16 | Email rate limit exceeded | Supabase無料プランは1時間4通制限 | Confirm emailをOFF・本番は外部SMTP |
| 17 | 残り回数が「？」・500エラー | `user_profiles`テーブル未作成 | SQL EditorでCREATE TABLE実行 |
| 18 | 既存ユーザーにプロファイルがない | トリガー設定前に登録 | `INSERT INTO user_profiles SELECT id FROM auth.users ON CONFLICT DO NOTHING` |
| 19 | 管理リンクが複数表示 | onAuthStateChangeが複数回発火 | ユーザー設定ページ内に管理リンクを移動 |
| 20 | Resendでメール送れない | 独自ドメイン未認証 | daisho-kikaku.comのDNS設定を完了させる |
| 21 | user_settings テーブルがない | 未作成 | SQL EditorでCREATE TABLE実行 |

---

*最終更新: 2026-05-03（Phase 3完了・ランディングページ・管理者ページ・法的ページ追加・Resend設定途中）*
