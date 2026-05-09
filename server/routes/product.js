import { Router } from "express";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/product/lookup?jan=<JANコード>
router.get("/lookup", async (req, res, next) => {
  try {
    const { jan } = req.query;
    if (!jan) return res.status(400).json({ ok: false, error: "janパラメータが必要です" });

    const appId = process.env.RAKUTEN_APP_ID;
    if (!appId) return res.status(500).json({ ok: false, error: "RAKUTEN_APP_ID が未設定です" });

    const url = new URL("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601");
    url.searchParams.set("applicationId", appId);
    url.searchParams.set("keyword", jan);
    url.searchParams.set("hits", "1");
    url.searchParams.set("formatVersion", "2");

    const r = await fetch(url.toString());
    const data = await r.json();

    const item = data.Items?.[0];
    if (!item) return res.json({ ok: false, error: "商品が見つかりませんでした" });

    res.json({
      ok: true,
      data: {
        product_name: item.itemName,
        image_url: item.mediumImageUrls?.[0] || "",
        shop_url: item.itemUrl,
        jan_code: jan,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/product/save
router.post("/save", async (req, res, next) => {
  try {
    const {
      jan_code,
      product_name,
      image_url,
      shop_url,
      amazon_url,
      diet_mode       = "oriental",
      ingredient_text,
      is_safe         = true,
    } = req.body;

    // ① saved_products に保存（個人マイリスト）
    const { error: saveError } = await supabaseAdmin.from("saved_products").insert({
      user_id:         req.user.id,
      jan_code:        jan_code        ?? null,
      product_name:    product_name    ?? null,
      image_url:       image_url       ?? null,
      shop_url:        shop_url        ?? null,
      amazon_url:      amazon_url      ?? null,
      diet_mode,
      ingredient_text: ingredient_text ?? null,
      is_safe,
    });

    if (saveError) {
      if (saveError.code === "23505") return res.status(409).json({ ok: false, error: "すでに保存済みです" });
      throw saveError;
    }

    // ② JANコードがある場合のみ product_catalog へ upsert
    if (jan_code) {
      const { error: catalogError } = await supabaseAdmin
        .from("product_catalog")
        .upsert(
          {
            jan_code,
            diet_mode,
            product_name:    product_name    ?? null,
            ingredient_text: ingredient_text ?? null,
            is_safe,
            image_url:       image_url       ?? null,
            shop_url:        shop_url        ?? null,
            amazon_url:      amazon_url      ?? null,
            scan_count:      1,
            last_scanned_at: new Date().toISOString(),
          },
          { onConflict: "jan_code,diet_mode", ignoreDuplicates: false }
        );

      if (catalogError) {
        console.error("product_catalog upsert failed:", catalogError.message);
      } else {
        await supabaseAdmin.rpc("increment_catalog_scan_count", {
          p_jan_code:  jan_code,
          p_diet_mode: diet_mode,
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/product/mylist
router.get("/mylist", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("saved_products")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/product/mylist/:id
router.delete("/mylist/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("saved_products")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchError || !item) return res.status(404).json({ ok: false, error: "見つかりません" });
    if (item.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "削除できません" });

    const { error } = await supabaseAdmin.from("saved_products").delete().eq("id", id);
    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
