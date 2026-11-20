// Billing-software (POS) link for partner pharmacies — Marg ERP, GoFrugal, Busy, or any software that can call an API.
// Each pharmacy finds its key in the Pharmacy dashboard -> POS link. Deploy with --no-verify-jwt.
//
//   POST /functions/v1/pos-sync          header X-POS-Key: <key>
//        JSON {"items":[{"code":"PCM650","name":"PARACETAMOL 650 TAB","stock":120,"mrp":34}]}
//        or a CSV body with columns: code,name,stock,mrp   (Marg "Stock Report" export works)
//   GET  /functions/v1/pos-sync?since=2026-11-20T00:00:00Z   -> new orders for this pharmacy (to bill them in the POS)
import { admin, cors, fail, json } from "../_shared/util.ts";

const norm = (s: string) => s.toLowerCase().replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup)\b/g, "").replace(/[^a-z0-9]/g, "");

function parseCsv(text: string) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  const head = rows.shift()!.map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const [ci, ni, si, mi] = [col("code"), col("name", "item", "product"), col("stock", "qty", "closing"), col("mrp", "rate", "price")];
  return rows.map((r) => ({ code: ci >= 0 ? r[ci] : "", name: ni >= 0 ? r[ni] : "", stock: Number(r[si]) || 0, mrp: mi >= 0 ? Number(r[mi]) || 0 : 0 }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = req.headers.get("X-POS-Key") ?? "";
  const db = admin();
  const { data: k } = await db.from("pharmacy_keys").select("pharmacy_id").eq("pos_key", key).maybeSingle();
  if (!key || !k) return fail("Invalid POS key", 401);
  const pharmacy = k.pharmacy_id;

  if (req.method === "GET") {
    const since = new URL(req.url).searchParams.get("since") ?? new Date(Date.now() - 864e5).toISOString();
    const { data } = await db.from("orders")
      .select("id,status,created_at,placed_at,customer_name,address_line,pin,total,pay_method,pay_status,order_items(product_id,name,qty,price,mrp)")
      .eq("pharmacy_id", pharmacy).gte("created_at", since).neq("status", "pending_payment").order("created_at");
    return json({ orders: data ?? [] });
  }

  const type = req.headers.get("Content-Type") ?? "";
  const items: { code?: string; name?: string; stock: number; mrp?: number }[] =
    type.includes("json") ? (await req.json()).items ?? [] : parseCsv(await req.text());
  const { data: products } = await db.from("products").select("id,name,pos_code");
  const byCode = new Map((products ?? []).filter((p) => p.pos_code).map((p) => [String(p.pos_code).toLowerCase(), p.id]));
  const byName = new Map((products ?? []).map((p) => [norm(p.name), p.id]));

  const rows: { pharmacy_id: string; product_id: string; stock: number; updated_at: string }[] = []; // price is left as the pharmacy set it
  const unmatched: string[] = [];
  for (const it of items) {
    const id = (it.code && byCode.get(String(it.code).toLowerCase())) || byName.get(norm(it.name ?? ""));
    if (!id) { unmatched.push(it.name || it.code || "?"); continue; }
    rows.push({ pharmacy_id: pharmacy, product_id: id, stock: Math.max(0, Math.round(it.stock || 0)), updated_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error } = await db.from("inventory").upsert(rows, { onConflict: "pharmacy_id,product_id", ignoreDuplicates: false });
    if (error) return fail(error.message, 500);
  }
  return json({ updated: rows.length, unmatched: unmatched.slice(0, 200), unmatched_count: unmatched.length });
});
