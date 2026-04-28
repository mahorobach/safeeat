<?php
/**
 * SafeEat — サブスクリプション管理 API
 * Phase 4: Stripe Webhook + Xserver MySQL
 *
 * エンドポイント:
 *   POST ?action=webhook        Stripe Webhook受信
 *   GET  ?action=status         サブスク状態確認（要認証）
 *   POST ?action=cancel         解約（要認証）
 */

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, Stripe-Signature");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

$db_host         = getenv("SAFEAT_DB_HOST")          ?: "localhost";
$db_name         = getenv("SAFEAT_DB_NAME")          ?: "safeat_db";
$db_user         = getenv("SAFEAT_DB_USER")          ?: "safeat_user";
$db_pass         = getenv("SAFEAT_DB_PASS")          ?: "";
$stripe_secret   = getenv("STRIPE_SECRET_KEY")       ?: "";
$webhook_secret  = getenv("STRIPE_WEBHOOK_SECRET")   ?: "";
$jwt_secret      = getenv("SAFEAT_JWT_SECRET")       ?: "change-this-secret";

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

/** Stripe Webhook 署名検証 */
function verify_stripe_signature(string $payload, string $sig_header, string $secret): bool {
    if (!$sig_header || !$secret) return false;
    foreach (explode(",", $sig_header) as $part) {
        [$k, $v] = explode("=", $part, 2);
        if ($k === "t") $timestamp = $v;
        if ($k === "v1") $received_sig = $v;
    }
    if (empty($timestamp) || empty($received_sig)) return false;
    $expected = hash_hmac("sha256", "{$timestamp}.{$payload}", $secret);
    return hash_equals($expected, $received_sig);
}

/** JWT検証してユーザーIDを返す */
function get_user_id_from_jwt(): ?int {
    global $jwt_secret;
    $authHeader = $_SERVER["HTTP_AUTHORIZATION"] ?? "";
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) return null;
    // 簡易検証（本番ではsafeat-auth.phpのverify_jwtを共有すること）
    $parts = explode(".", $m[1]);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = rtrim(strtr(base64_encode(hash_hmac("sha256", "{$header}.{$payload}", $jwt_secret, true)), "+/", "-_"), "=");
    if (!hash_equals($expected, $sig)) return null;
    $claims = json_decode(base64_decode(strtr($payload, "-_", "+/")), true);
    if (!$claims || $claims["exp"] < time()) return null;
    return (int)$claims["sub"];
}

$action = $_GET["action"] ?? "";

try {
    switch ($action) {

        case "webhook":
            $payload    = file_get_contents("php://input");
            $sig_header = $_SERVER["HTTP_STRIPE_SIGNATURE"] ?? "";

            if (!verify_stripe_signature($payload, $sig_header, $webhook_secret)) {
                json_response(["ok" => false, "error" => "署名検証失敗"], 400);
            }

            $event = json_decode($payload, true);
            $type  = $event["type"] ?? "";
            $obj   = $event["data"]["object"] ?? [];

            $pdo = get_pdo();

            switch ($type) {
                case "customer.subscription.created":
                case "customer.subscription.updated":
                    $stripe_sub_id    = $obj["id"];
                    $stripe_cus_id    = $obj["customer"];
                    $status           = $obj["status"];    // active / past_due / canceled 等
                    $period_end       = date("Y-m-d H:i:s", $obj["current_period_end"]);
                    $safeat_status    = in_array($status, ["active", "trialing"]) ? "active" : "cancelled";

                    // customer に紐づく user を検索
                    $stmt = $pdo->prepare(
                        "SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1"
                    );
                    $stmt->execute([$stripe_cus_id]);
                    $row = $stmt->fetch();

                    if ($row) {
                        $pdo->prepare(
                            "UPDATE subscriptions
                             SET stripe_subscription_id = ?, status = ?, current_period_end = ?
                             WHERE stripe_customer_id = ?"
                        )->execute([$stripe_sub_id, $safeat_status, $period_end, $stripe_cus_id]);

                        // plan を更新
                        $plan = $safeat_status === "active" ? "premium" : "free";
                        $pdo->prepare("UPDATE users SET plan = ? WHERE id = ?")
                            ->execute([$plan, $row["user_id"]]);
                    }
                    break;

                case "customer.subscription.deleted":
                    $stripe_cus_id = $obj["customer"];
                    $pdo->prepare(
                        "UPDATE subscriptions SET status = 'cancelled' WHERE stripe_customer_id = ?"
                    )->execute([$stripe_cus_id]);
                    // ユーザーを free プランに戻す
                    $stmt = $pdo->prepare(
                        "SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?"
                    );
                    $stmt->execute([$stripe_cus_id]);
                    $row = $stmt->fetch();
                    if ($row) {
                        $pdo->prepare("UPDATE users SET plan = 'free' WHERE id = ?")
                            ->execute([$row["user_id"]]);
                    }
                    break;

                case "invoice.payment_failed":
                    $stripe_cus_id = $obj["customer"];
                    $pdo->prepare(
                        "UPDATE subscriptions SET status = 'past_due' WHERE stripe_customer_id = ?"
                    )->execute([$stripe_cus_id]);
                    break;
            }

            json_response(["ok" => true]);

        case "status":
            $user_id = get_user_id_from_jwt();
            if (!$user_id) json_response(["ok" => false, "error" => "認証が必要です"], 401);

            $stmt = get_pdo()->prepare(
                "SELECT s.status, s.current_period_end, u.plan
                 FROM users u
                 LEFT JOIN subscriptions s ON s.user_id = u.id
                 WHERE u.id = ?"
            );
            $stmt->execute([$user_id]);
            $row = $stmt->fetch();
            json_response(["ok" => true, "data" => $row ?: ["plan" => "free", "status" => null]]);

        case "cancel":
            $user_id = get_user_id_from_jwt();
            if (!$user_id) json_response(["ok" => false, "error" => "認証が必要です"], 401);

            $stmt = get_pdo()->prepare(
                "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = ? AND status = 'active'"
            );
            $stmt->execute([$user_id]);
            $row = $stmt->fetch();

            if (!$row) json_response(["ok" => false, "error" => "有効なサブスクが見つかりません"], 404);

            // Stripe API でキャンセル（期間終了時に解約）
            $ch = curl_init("https://api.stripe.com/v1/subscriptions/{$row["stripe_subscription_id"]}");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST  => "POST",
                CURLOPT_POSTFIELDS     => "cancel_at_period_end=true",
                CURLOPT_USERPWD        => "{$stripe_secret}:",
            ]);
            $res = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($code !== 200) {
                json_response(["ok" => false, "error" => "Stripe APIエラー"], 500);
            }
            json_response(["ok" => true, "message" => "解約申請を受け付けました。現在の期間終了後に解約されます。"]);

        default:
            json_response(["ok" => false, "error" => "不明なアクションです"], 400);
    }
} catch (PDOException $e) {
    json_response(["ok" => false, "error" => "DBエラー: " . $e->getMessage()], 500);
}
