// Creates a Razorpay order for one of the caller's unpaid dawa4u orders.
// App flow: place_order() -> this function -> Razorpay Checkout (UPI/card/netbanking) -> razorpay-verify
import { admin, caller, cors, fail, json, razorpayKeys } from "../_shared/util.ts";

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

    const rz = razorpayKeys();
    if (!rz.id || !rz.secret) return fail("Online payments are not set up yet. Choose Cash on delivery.", 503);

    let rzOrderId = o.razorpay_order_id as string | null;
    if (!rzOrderId) {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${rz.id}:${rz.secret}`) },
        body: JSON.stringify({ amount: o.total * 100, currency: "INR", receipt: o.id, notes: { order_id: o.id } }),
      });
      const body = await res.json();
      if (!res.ok) return fail(body?.error?.description ?? "Could not start payment", 502);
      rzOrderId = body.id;
      await db.from("orders").update({ razorpay_order_id: rzOrderId }).eq("id", o.id);
    }
    return json({ key_id: rz.id, razorpay_order_id: rzOrderId, amount: o.total * 100, currency: "INR",
      order_id: o.id, name: o.customer_name, phone: o.customer_phone });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
