import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import analyzeRouter from "./routes/analyze.js";
import ingredientsRouter from "./routes/ingredients.js";
import userRouter from "./routes/user.js";
import subscriptionRouter, { webhookHandler } from "./routes/subscription.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** cwd に依存しない（リポジトリルートから node server/index.js でも server/.env を読む） */
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS ---
/** ブラウザの Origin は末尾スラッシュなし。環境変数に / 付き・.env 風のクォートが付いても一致させる */
function normalizeOrigin(o) {
  let s = String(o || "").trim().replace(/\/+$/, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim().replace(/\/+$/, "");
  }
  return s;
}

const allowedOriginSet = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean),
);

if (allowedOriginSet.size > 0) {
  console.log(`CORS: ${allowedOriginSet.size} origin(s) → ${[...allowedOriginSet].join(", ")}`);
} else {
  console.warn("CORS: ALLOWED_ORIGINS が空です。GitHub Pages 等からは API をブロックします。");
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOriginSet.has(normalizeOrigin(origin))) return callback(null, true);
      console.warn(`CORS blocked: ${origin}`);
      callback(null, false);
    },
    credentials: true,
  })
);

// --- Stripe Webhook は raw body が必要なので JSON パース前に登録 ---
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);

// --- 通常のルート ---
// Base64画像は JSON で膨らむため 10MB 上限（フロントで縮小・切り取り推奨）
app.use(express.json({ limit: "10mb" }));

/** Railway 等: プロキシ経由で届くよう 0.0.0.0 で待ち受ける */
const LISTEN_HOST = process.env.LISTEN_HOST || "0.0.0.0";

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "SafeEat API", health: "/api/health" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "SafeEat API", ts: new Date().toISOString() });
});

app.use("/api/analyze",      analyzeRouter);
app.use("/api/ingredients",  ingredientsRouter);
app.use("/api/user",         userRouter);
app.use("/api/subscription", subscriptionRouter);

// --- 404 ---
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not Found" }));

// --- 413: ボディ過大（CORS付きで返す） ---
app.use((err, req, res, next) => {
  if (err.status === 413 || err.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error: "リクエストが大きすぎます。画像を切り取るか、もう少し小さい写真で試してください。",
    });
  }
  next(err);
});

// --- エラーハンドラ ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "Internal Server Error" });
});

const server = app.listen(PORT, LISTEN_HOST, () =>
  console.log(`SafeEat API listening on http://${LISTEN_HOST}:${PORT}`)
);
// 長い Vision / Claude 処理向け（Node 既定 requestTimeout は 5 分のことがあり先に切れる）
server.requestTimeout = 900_000;
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
