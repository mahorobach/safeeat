<?php
/**
 * SafeEat — 成分DB 読み書き API
 * Phase 2: Xserver MySQL 連携
 *
 * エンドポイント:
 *   GET  ?action=list              全成分一覧
 *   GET  ?action=search&q=成分名   成分名で検索
 *   POST ?action=add               新規成分登録（JSON body）
 *   POST ?action=verify&id=1       成分をverified=trueに更新
 */

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

// --- DB接続設定（Xserver 環境変数または直接設定） ---
$db_host = getenv("SAFEAT_DB_HOST") ?: "localhost";
$db_name = getenv("SAFEAT_DB_NAME") ?: "safeat_db";
$db_user = getenv("SAFEAT_DB_USER") ?: "safeat_user";
$db_pass = getenv("SAFEAT_DB_PASS") ?: "";

function get_pdo(): PDO {
    global $db_host, $db_name, $db_user, $db_pass;
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4";
        $pdo = new PDO($dsn, $db_user, $db_pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}

function json_response(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$action = $_GET["action"] ?? "";

try {
    switch ($action) {
        case "list":
            $stmt = get_pdo()->query(
                "SELECT id, name, category, reason, confidence, verified, created_at
                 FROM ingredients ORDER BY category, name LIMIT 1000"
            );
            json_response(["ok" => true, "data" => $stmt->fetchAll()]);

        case "search":
            $q = "%" . ($_GET["q"] ?? "") . "%";
            $stmt = get_pdo()->prepare(
                "SELECT id, name, category, reason, confidence, verified
                 FROM ingredients WHERE name LIKE ? LIMIT 50"
            );
            $stmt->execute([$q]);
            json_response(["ok" => true, "data" => $stmt->fetchAll()]);

        case "add":
            $body = json_decode(file_get_contents("php://input"), true);
            $name       = trim($body["name"]       ?? "");
            $category   = $body["category"]         ?? "gray";
            $reason     = trim($body["reason"]     ?? "");
            $confidence = $body["confidence"]       ?? "low";
            $verified   = isset($body["verified"]) && $body["verified"] ? 1 : 0;

            if (empty($name)) {
                json_response(["ok" => false, "error" => "name は必須です"], 400);
            }
            if (!in_array($category, ["ok", "gray", "ng"])) {
                json_response(["ok" => false, "error" => "category は ok/gray/ng のいずれか"], 400);
            }

            $stmt = get_pdo()->prepare(
                "INSERT INTO ingredients (name, category, reason, confidence, verified)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   category = VALUES(category),
                   reason   = VALUES(reason),
                   confidence = VALUES(confidence),
                   verified = VALUES(verified)"
            );
            $stmt->execute([$name, $category, $reason, $confidence, $verified]);
            json_response(["ok" => true, "id" => get_pdo()->lastInsertId()]);

        case "verify":
            $id = (int)($_GET["id"] ?? 0);
            if ($id <= 0) {
                json_response(["ok" => false, "error" => "id が不正です"], 400);
            }
            $stmt = get_pdo()->prepare(
                "UPDATE ingredients SET verified = 1 WHERE id = ?"
            );
            $stmt->execute([$id]);
            json_response(["ok" => true]);

        default:
            json_response(["ok" => false, "error" => "不明なアクションです"], 400);
    }
} catch (PDOException $e) {
    json_response(["ok" => false, "error" => "DBエラー: " . $e->getMessage()], 500);
}
