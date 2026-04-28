import { Router } from "express";
import Stripe from "stripe";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// =============================================
// Stripe Webhook（raw body, index.js で登録）
// POST /api/stripe/webhook
// =============================================
export async function webhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook 署名検証失敗:", err.message);
    return res.status(400).json({ ok: false, error: "Invalid signature" });
  }

  const obj = event.data.object;

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const isActive = ["active", "trialing"].includes(obj.status);
        const status   = isActive ? "active" : "cancelled";
        const periodEnd = new Date(obj.current_period_end * 1000).toISOString();

        await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              stripe_customer_id:     obj.customer,
              stripe_subscription_id: obj.id,
              status,
              current_period_end: periodEnd,
            },
            { onConflict: "stripe_customer_id" }
          );

        // プロフィールの plan を更新
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", obj.customer)
          .single();

        if (sub?.user_id) {
          await supabaseAdmin
            .from("profiles")
            .update({ plan: isActive ? "premium" : "free" })
            .eq("id", sub.user_id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("stripe_customer_id", obj.customer);

        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", obj.customer)
          .single();

        if (sub?.user_id) {
          await supabaseAdmin
            .from("profiles")
            .update({ plan: "free" })
            .eq("id", sub.user_id);
        }
        break;
      }

      case "invoice.payment_failed": {
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_customer_id", obj.customer);
        break;
      }
    }
  } catch (err) {
    console.error("Webhook 処理エラー:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }

  res.json({ ok: true });
}

// =============================================
// 通常のサブスク API ルート（要認証）
// =============================================
router.use(requireAuth);

// GET /api/subscription/status — サブスク状態確認
router.get("/status", async (req, res, next) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", req.user.id)
      .single();

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", req.user.id)
      .maybeSingle();

    res.json({
      ok: true,
      data: {
        plan: profile?.plan || "free",
        subscription: sub || null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/subscription/cancel — 解約（期間終了後に解約）
router.post("/cancel", async (req, res, next) => {
  try {
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("user_id", req.user.id)
      .single();

    if (!sub || sub.status !== "active") {
      return res.status(404).json({ ok: false, error: "有効なサブスクが見つかりません" });
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    res.json({ ok: true, message: "解約申請を受け付けました。現在の期間終了後に解約されます。" });
  } catch (e) {
    next(e);
  }
});

export default router;
