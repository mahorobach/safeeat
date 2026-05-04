/**
 * 設定テンプレート（コピーして使う例）
 *
 * 推奨: 本番・フォークでは `site-config.js` の API_BASE を直接編集する。
 *
 * 以前の `config.js` に API キーを置く運用は廃止しました。
 * ブラウザに Claude キーを置くと漏洩リスクが高いため、必ずサーバー側（.env / Railway）で管理してください。
 * 漏洩したキーは Anthropic コンソールで無効化し、新しいキーを発行してください。
 *
 * 例（別名でローカル試験したい場合）:
 *   1. このファイルを `site-config.local.js` などにコピー（.gitignore 推奨）
 *   2. index.html で site-config.js の直後に読み込む
 *   3. 次のように API_BASE だけ上書き
 */
window.SAFEAT_CONFIG = Object.assign(window.SAFEAT_CONFIG || {}, {
  API_BASE: "https://YOUR-SERVICE.onrender.com",
});
