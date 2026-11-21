// Cashfree -> dawa4u payment webhook. Set in Cashfree dashboard:
//   https://<project>.supabase.co/functions/v1/cashfree-webhook   (Payment success / failed events)
// Signature = base64(HMAC-SHA256(x-webhook-timestamp + raw body, CASHFREE_SECRET_KEY)).
// Even with a valid signature we re-check the payment with Cashfree before marking anything paid.
import { cashfree, cfSettle, hmacB64, safeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const ts = req.headers.get("x-webhook-timestamp") ?? "";
  const sig = req.headers.get("x-webhook-signature") ?? "";
  const secret = cashfree().secret;
  if (!secret || !ts || !sig) return new Response("bad request", { status: 400 });
  const expected = await hmacB64(secret, ts + raw);
  if (!safeEqual(expected, sig)) return new Response("bad signature", { status: 401 });

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const orderId = evt?.data?.order?.order_id;
  if (orderId && /SUCCESS/i.test(String(evt?.type ?? "") + String(evt?.data?.payment?.payment_status ?? ""))) {
    const r = await cfSettle(String(orderId));
    if (r.error) return new Response(r.error, { status: 500 }); // Cashfree retries
  }
  return new Response("ok");
});
