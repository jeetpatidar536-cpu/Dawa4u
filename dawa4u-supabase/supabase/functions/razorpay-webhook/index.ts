// Razorpay webhook (backup in case the app closes before razorpay-verify runs).
// Razorpay Dashboard -> Webhooks -> URL: https://<project>.supabase.co/functions/v1/razorpay-webhook
// Events: payment.captured. Secret: same as RAZORPAY_WEBHOOK_SECRET. Deploy with --no-verify-jwt.
import { admin, fail, hmacHex, json, safeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const raw = await req.text();
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
  const sig = req.headers.get("X-Razorpay-Signature") ?? "";
  if (!secret || !safeEqual(await hmacHex(secret, raw), sig)) return fail("Bad signature", 401);

  const event = JSON.parse(raw);
  if (event.event !== "payment.captured") return json({ ignored: event.event });
  const p = event.payload?.payment?.entity;
  const db = admin();
  const { data: o } = await db.from("orders").select("id").eq("razorpay_order_id", p?.order_id).maybeSingle();
  if (!o) return json({ ignored: "unknown order" });
  const { error } = await db.rpc("mark_paid", { p_order_id: o.id, p_rz_order: p.order_id, p_rz_payment: p.id, p_amount_paise: p.amount });
  if (error) return fail(error.message, 400);
  return json({ ok: true });
});
