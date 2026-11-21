// Shared helpers for dawa4u edge functions
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pos-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const fail = (msg: string, status = 400) => json({ error: msg }, status);

/** Service-role client: bypasses row level security. Server-side only. */
export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/** The logged-in user who called this function (from their Authorization header). */
export async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin().auth.getUser(token);
  return data.user ?? null;
}

const enc = new TextEncoder();
export async function hmacHex(secret: string, message: string | Uint8Array) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, typeof message === "string" ? enc.encode(message) : message);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Constant-time string compare */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const razorpayKeys = () => ({ id: Deno.env.get("RAZORPAY_KEY_ID") ?? "", secret: Deno.env.get("RAZORPAY_KEY_SECRET") ?? "" });

// ---------------------------------------------------------------- Cashfree (cards & netbanking)
// Secrets: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV ("sandbox" or "production")
export const cashfree = () => {
  const env = (Deno.env.get("CASHFREE_ENV") ?? "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
  return {
    id: Deno.env.get("CASHFREE_APP_ID") ?? "",
    secret: Deno.env.get("CASHFREE_SECRET_KEY") ?? "",
    env,
    base: env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
  };
};

/** Call the Cashfree PG API. Returns [ok, body]. */
export async function cfApi(path: string, init: { method?: string; body?: unknown } = {}): Promise<[boolean, any]> {
  const cf = cashfree();
  const res = await fetch(cf.base + path, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2025-01-01",
      "x-client-id": cf.id,
      "x-client-secret": cf.secret,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return [res.ok, body];
}

/** Ask Cashfree whether an order has a successful payment; if so, mark it paid. Never trusts the browser. */
export async function cfSettle(orderId: string) {
  const [ok, payments] = await cfApi(`/orders/${encodeURIComponent(orderId)}/payments`);
  if (!ok || !Array.isArray(payments)) return { paid: false, error: payments?.message ?? "Could not check payment" };
  const p = payments.find((x: any) => x.payment_status === "SUCCESS");
  if (!p) return { paid: false };
  const { data, error } = await admin().rpc("mark_paid", {
    p_order_id: orderId, p_rz_order: orderId, p_rz_payment: String(p.cf_payment_id),
    p_amount_paise: Math.round(Number(p.payment_amount) * 100),
  });
  if (error) return { paid: false, error: error.message };
  return { paid: true, order: data };
}

/** Base64 HMAC-SHA256, as used by Cashfree webhook signatures (timestamp + raw body). */
export async function hmacB64(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let s = ""; for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
