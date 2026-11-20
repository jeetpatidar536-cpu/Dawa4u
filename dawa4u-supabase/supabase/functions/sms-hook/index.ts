// Sends login OTPs through MSG91 (India, DLT-registered template).
// Supabase Dashboard -> Authentication -> Hooks -> "Send SMS hook" -> HTTPS -> this function's URL.
// Secrets: SEND_SMS_HOOK_SECRET (from that screen, starts with v1,whsec_), MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
// Your DLT template must contain the variable ##otp##, e.g. "##otp## is your dawa4u login code. Do not share it."
import { Webhook } from "npm:standardwebhooks@1.0.0";

Deno.serve(async (req) => {
  const payload = await req.text();
  const secret = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
  let data: { user: { phone: string }; sms: { otp: string } };
  try {
    data = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)) as typeof data;
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 401, message: "Bad signature" } }), { status: 401 });
  }
  const res = await fetch("https://control.msg91.com/api/v5/flow", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: Deno.env.get("MSG91_AUTH_KEY") ?? "" },
    body: JSON.stringify({
      template_id: Deno.env.get("MSG91_TEMPLATE_ID"),
      short_url: "0",
      recipients: [{ mobiles: data.user.phone.replace(/^\+/, ""), otp: data.sms.otp }],
    }),
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: { http_code: 500, message: "SMS failed: " + (await res.text()) } }), { status: 500 });
  }
  return new Response("{}", { headers: { "Content-Type": "application/json" } });
});
