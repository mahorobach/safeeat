<?php
/**
 * SafeEat — ユーザー認証 API
 * Phase 3: Xserver MySQL 連携
 *
 * エンドポイント:
 *   POST ?action=register   新規登録
 *   POST ?action=login      ログイン → JWT返却
 *   GET  ?action=me         ユーザー情報取得（Authorization: Bearer <token>）
 */

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

$db_host = getenv("SAFEAT_DB_HOST") ?: "localhost";
$db_name = getenv("SAFEAT_DB_NAME") ?: "safeat_db";
$db_user = getenv("SAFEAT_DB_USER") ?: "safeat_user";
$db_pass = getenv("SAFEAT_DB_PASS") ?: "";
$jwt_secret = getenv("SAFEAT_JWT_SECRET") ?: "change-this-secret";

function get_pdo(): PDO {
    global $db_host, $db_name, $db_user, $db_pass;
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4",
            $db_user, $db_pass,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
    }
    return $pdo;
}

function json_response(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** シンプルなHS256 JWTの生成（依存ライブラリなし） */
function create_jwt(int $user_id, string $secret): string {
    $header  = base64url_encode(json_encode(["alg" => "HS256", "typ" => "JWT"]));
    $payload = base64url_encode(json_encode([
        "sub" => $user_id,
        "iat" => time(),
        "exp" => time() + 86400 * 30, // 30日有効
    ]));
    $sig = base64url_encode(hash_hmac("sha256", "{$header}.{$payload}", $secret, true));
    return "{$header}.{$payload}.{$sig}";
}

function verify_jwt(string $token, string $secret): ?array {
    $parts = explode(".", $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = base64url_encode(hash_hmac("sha256", "{$header}.{$payload}", $secret, true));
    if (!hash_equals($expected, $sig)) return null;
    $claims = json_decode(base64url_decode($payload), true);
    if (!$claims || $claims["exp"] < time()) return null;
    return $claims;
}

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), "+/", "-_"), "=");
}
function base64url_decode(string $data): string {
    return base64_decode(strtr($data, "-_", "+/") . str_repeat("=", (4 - strlen($data) % 4) % 4));
}

function get_auth_user(): ?array {
    global $jwt_secret;
    $authHeader = $_SERVER["HTTP_AUTHORIZATION"] ?? "";
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) return null;
    $claims = verify_jwt($m[1], $jwt_secret);
    if (!$claims) return null;
    $stmt = get_pdo()->prepare("SELECT id, email, plan FROM users WHERE id = ?");
    $stmt->execute([$claims["sub"]]);
    return $stmt->fetch() ?: null;
}

$action = $_GET["action"] ?? "";
$body   = json_decode(file_get_contents("php://input"), true) ?? [];

try {
    switch ($action) {
        case "register":
            $email    = strtolower(trim($body["email"] ?? ""));
            $password = $body["password"] ?? "";

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                json_response(["ok" => false, "error" => "メールアドレスが不正です"], 400);
            }
            if (strlen($password) < 8) {
                json_response(["ok" => false, "error" => "パスワードは8文字以上必要です"], 400);
            }

            $hash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = get_pdo()->prepare(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)"
            );
            try {
                $stmt->execute([$email, $hash]);
            } catch (PDOException $e) {
                if ($e->getCode() === "23000") {
                    json_response(["ok" => false, "error" => "このメールアドレスは既に登録済みです"], 409);
                }
                throw $e;
            }
            $user_id = (int)get_pdo()->lastInsertId();
            json_response(["ok" => true, "token" => create_jwt($user_id, $jwt_secret)]);

        case "login":
            $email    = strtolower(trim($body["email"] ?? ""));
            $password = $body["password"] ?? "";

            $stmt = get_pdo()->prepare("SELECT id, password_hash FROM users WHERE email = ?");
            $stmt->execute([$email]);
            $user = $stmt->fetch();

            if (!$user || !password_verify($password, $user["password_hash"])) {
                json_response(["ok" => false, "error" => "メールアドレスまたはパスワードが正しくありません"], 401);
            }
            json_response(["ok" => true, "token" => create_jwt($user["id"], $jwt_secret)]);

        case "me":
            $user = get_auth_user();
            if (!$user) {
                json_response(["ok" => false, "error" => "認証が必要です"], 401);
            }
            json_response(["ok" => true, "user" => $user]);

        default:
            json_response(["ok" => false, "error" => "不明なアクションです"], 400);
    }
} catch (PDOException $e) {
    json_response(["ok" => false, "error" => "DBエラー: " . $e->getMessage()], 500);
}
