// Checks Razorpay's payment signature, then marks the order paid.
import { admin, caller, cors, fail, hmacHex, json, razorpayKeys, safeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await caller(req);
    if (!user) return fail("Please log in", 401);
    const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    const expected = await hmacHex(razorpayKeys().secret, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (!razorpay_signature || !safeEqual(expected, razorpay_signature)) return fail("Payment could not be verified", 400);

    const db = admin();
    const { data: o } = await db.from("orders").select("id,total,customer_id,razorpay_order_id").eq("id", order_id).maybeSingle();
    if (!o || o.customer_id !== user.id || o.razorpay_order_id !== razorpay_order_id) return fail("Order not found", 404);
    const { data, error } = await db.rpc("mark_paid", {
      p_order_id: o.id, p_rz_order: razorpay_order_id, p_rz_payment: razorpay_payment_id, p_amount_paise: o.total * 100,
    });
    if (error) return fail(error.message, 400);
    return json({ ok: true, order: data });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
