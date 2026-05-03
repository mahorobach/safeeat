import { Router } from "express";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function requireAdmin(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || req.user?.email !== adminEmail) {
    return res.status(403).json({ ok: false, error: "管理者のみアクセス可能です" });
  }
  next();
}

// GET /api/admin/check
router.get("/check", requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, isAdmin: true });
});

// GET /api/admin/stats
router.get("/stats", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);

    const { count: total_users } = await supabaseAdmin
      .from("user_profiles")
      .select("*", { count: "exact", head: true });

    const { count: tester_count } = await supabaseAdmin
      .from("user_profiles")
      .select("*", { count: "exact", head: true })
      .eq("plan", "tester");

    const { data: scanData } = await supabaseAdmin
      .from("user_profiles")
      .select("scan_count, scan_month")
      .eq("scan_month", month);

    const total_scans_this_month = scanData?.reduce(
      (sum, u) => sum + (u.scan_count || 0), 0
    ) || 0;

    res.json({ ok: true, stats: { total_users, tester_count, total_scans_this_month } });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/users
router.get("/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { email } = req.query;

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (authError) throw authError;

    let users = authData.users;
    if (email) {
      users = users.filter(u => u.email?.toLowerCase().includes(email.toLowerCase()));
    }

    const ids = users.map(u => u.id);
    const { data: profiles } = await supabaseAdmin
      .from("user_profiles")
      .select("id, plan, scan_count, scan_month")
      .in("id", ids);

    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    const month = new Date().toISOString().slice(0, 7);

    const result = users.map(u => {
      const p = profileMap[u.id] || {};
      return {
        id:         u.id,
        email:      u.email,
        plan:       p.plan || "free",
        scan_count: p.scan_month === month ? (p.scan_count || 0) : 0,
      };
    });

    res.json({ ok: true, users: result });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/users/:userId/plan
router.put("/users/:userId/plan", requireAuth, requireAdmin, async (req, res, next) => {
  const { userId } = req.params;
  const { plan } = req.body;

  const validPlans = ["free", "tester", "pro", "business"];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ ok: false, error: "プランが不正です" });
  }

  try {
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ plan })
      .eq("id", userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
