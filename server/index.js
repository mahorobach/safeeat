import "dotenv/config";
import express from "express";
import cors from "cors";
import analyzeRouter from "./routes/analyze.js";
import ingredientsRouter from "./routes/ingredients.js";
import userRouter from "./routes/user.js";
import subscriptionRouter, { webhookHandler } from "./routes/subscription.js";

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
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
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "SafeEat API", ts: new Date().toISOString() });
});

app.use("/api/analyze",      analyzeRouter);
app.use("/api/ingredients",  ingredientsRouter);
app.use("/api/user",         userRouter);
app.use("/api/subscription", subscriptionRouter);

// --- 404 ---
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not Found" }));

// --- エラーハンドラ ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "Internal Server Error" });
});

app.listen(PORT, () => console.log(`SafeEat API listening on port ${PORT}`));
