// Razorpay online payments (UPI, cards, netbanking).
// With no keys in .env the server runs in TEST MODE: online payments are marked paid without
// any money moving. Never run a real shop in test mode.
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const LIVE = !!(KEY_ID && SECRET);

// Create a Razorpay order. amount is in rupees; Razorpay wants paise.
async function createOrder(amountRupees, receipt) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(KEY_ID + ':' + SECRET).toString('base64') },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt }),
  });
  if (!res.ok) { console.error('[pay] Razorpay error', res.status, await res.text()); throw Object.assign(new Error('Payment could not be started. Try again or choose cash on delivery.'), { status: 502 }); }
  return (await res.json()).id;
}

// Razorpay signs order_id|payment_id with your secret. Only a matching signature proves payment.
function verify(rzpOrderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', SECRET).update(rzpOrderId + '|' + paymentId).digest('hex');
  return typeof signature === 'string' && signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = { LIVE, KEY_ID, createOrder, verify };
