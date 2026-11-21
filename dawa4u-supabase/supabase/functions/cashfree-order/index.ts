// Starts a Cashfree payment (UPI / card / netbanking) for one of the caller's unpaid dawa4u orders.
// App flow: place_order() -> this function -> Cashfree checkout popup -> cashfree-verify
import { admin, caller, cashfree, cfApi, cors, fail, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await caller(req);
    if (!user) return fail("Please log in", 401);
    const { order_id } = await req.json();
    const db = admin();
    const { data: o } = await db.from("orders").select("*").eq("id", order_id).eq("customer_id", user.id).maybeSingle();
    if (!o) return fail("Order not found", 404);
    if (o.status !== "pending_payment") return fail("This order is already paid or cancelled");
    if (!["upi", "card", "netbanking"].includes(o.pay_method)) return fail("Cash orders are paid to the rider");

    const cf = cashfree();
    if (!cf.id || !cf.secret) return fail("Online payments are not set up yet. Choose Cash on delivery.", 503);

    const phone = String(o.customer_phone || user.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) return fail("Add your mobile number to pay online");

    let [ok, body] = await cfApi("/orders", {
      method: "POST",
      body: {
        order_id: o.id,
        order_amount: o.total,
        order_currency: "INR",
        order_note: `dawa4u order ${o.id}`,
        customer_details: { customer_id: user.id.replace(/-/g, ""), customer_phone: phone, customer_name: o.customer_name || undefined },
        order_meta: { payment_methods: ({ upi: "upi", card: "cc,dc", netbanking: "nb" } as Record<string, string>)[o.pay_method] },
      },
    });
    if (!ok) {
      // Same order tried again (e.g. the popup was closed): reuse the existing Cashfree order
      const [ok2, existing] = await cfApi(`/orders/${encodeURIComponent(o.id)}`);
      if (!ok2 || !existing?.payment_session_id) return fail(body?.message ?? "Could not start payment", 502);
      if (existing.order_status === "PAID") return json({ already_paid: true });
      body = existing;
    }
    await db.from("orders").update({ pay_gateway: "cashfree", razorpay_order_id: o.id }).eq("id", o.id);
    return json({ payment_session_id: body.payment_session_id, mode: cf.env, order_id: o.id, amount: o.total });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
