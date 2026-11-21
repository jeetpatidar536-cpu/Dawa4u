// After the Cashfree popup closes: ask Cashfree (server to server) if the order was paid.
import { admin, caller, cfSettle, cors, fail, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await caller(req);
    if (!user) return fail("Please log in", 401);
    const { order_id } = await req.json();
    const { data: o } = await admin().from("orders").select("*").eq("id", order_id).eq("customer_id", user.id).maybeSingle();
    if (!o) return fail("Order not found", 404);
    if (o.pay_status === "paid") return json({ paid: true, order: o });
    const r = await cfSettle(o.id);
    if (r.error) return fail(r.error, 502);
    return json(r.paid ? { paid: true, order: r.order } : { paid: false, order: o });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
