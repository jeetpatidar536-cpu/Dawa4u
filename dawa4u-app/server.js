// dawa4u server: one backend for the Customer, Pharmacy, Rider and Admin apps.
// Run: node server.js   (no packages to install; needs Node.js 20 or newer)
const fs = require('fs');
const path = require('path');
const http = require('http');

// ---- load .env (simple KEY=value lines) before anything reads process.env ----
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const db = require('./lib/db');
const auth = require('./lib/auth');
const sms = require('./lib/sms');
const ai = require('./lib/ai');
const pay = require('./lib/payments');
const pos = require('./lib/pos');
const { seed, newPharmacy } = require('./lib/seed');

if (db.load()) seed();
const D = () => db.data;

// ======================= helpers =======================
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const product = id => D().products.find(p => p.id === id);
const pharmacyOf = id => D().pharmacies.find(p => p.id === id);
const userOf = id => D().users.find(u => u.id === id);
const priceAt = (ph, p) => ph.price[p.id] || p.mrp;
const hasPass = u => !!(u && u.passUntil && u.passUntil > Date.now());
const ACTIVE = ['placed', 'accepted', 'packed', 'picked'];
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, phone: u.phone, username: u.username, address: u.address || '', pin: u.pin || '',
    pharmacyId: u.pharmacyId, online: !!u.online, passUntil: hasPass(u) ? u.passUntil : null, passTest: !!u.passTest };
}
function settingsOut() {
  const s = D().settings;
  return { ...s, paymentsLive: pay.LIVE, razorpayKey: pay.KEY_ID || null, aiReady: !!process.env.ANTHROPIC_API_KEY, devMode: sms.DEV };
}
// What each role may see of an order
function orderOut(o, role) {
  const ph = pharmacyOf(o.pharmacyId), rider = o.riderId && userOf(o.riderId), cust = userOf(o.customerId);
  const out = { id: o.id, status: o.status, items: o.items, sub: o.sub, disc: o.disc, del: o.del, total: o.total, pass: o.pass,
    payMethod: o.pay.method, payStatus: o.pay.status, payTest: !!o.pay.test, address: o.address, pin: o.pin, ts: o.ts,
    rx: o.rxId ? { id: o.rxId } : null, pharmacy: ph ? { id: ph.id, name: ph.name, address: ph.address } : null,
    rider: rider ? { name: rider.name, phone: role === 'rider' ? undefined : rider.phone } : null, reason: o.reason || '' };
  if (role === 'customer') out.otp = o.otp;
  if (role !== 'customer') out.customer = cust ? { name: cust.name || 'Customer', phone: cust.phone } : null;
  if (role === 'admin') out.riderPaid = !!o.riderPaid;
  return out;
}
function restoreStock(o) {
  const ph = pharmacyOf(o.pharmacyId);
  if (ph) o.items.forEach(i => { ph.stock[i.productId] = (ph.stock[i.productId] || 0) + i.qty; });
}
function setStatus(o, status) { o.status = status; o.ts[status] = Date.now(); db.save(); }

// Pharmacy that serves a PIN code: open, serves the PIN, most items in stock first
function pharmacyFor(pin) {
  return D().pharmacies.filter(p => p.open && p.pins.includes(pin))
    .sort((a, b) => Object.values(b.stock).filter(n => n > 0).length - Object.values(a.stock).filter(n => n > 0).length)[0] || null;
}

// ======================= request plumbing =======================
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'That file is too big.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function jsonBody(req) {
  const b = await readBody(req, 200e3);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { fail(400, 'Bad request.'); }
}
function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Simple rate limit for login endpoints: 20 requests per minute per IP
const hits = new Map();
function rateLimit(req) {
  const ip = req.socket.remoteAddress, now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60e3);
  h.push(now); hits.set(ip, h);
  if (h.length > 20) fail(429, 'Too many tries. Wait a minute.');
}
setInterval(() => hits.clear(), 10 * 60e3).unref();

// ======================= routes =======================
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), role, fn });

// ---------- auth ----------
route('POST', '/api/auth/otp', null, async ({ req }) => {
  rateLimit(req);
  const phone = auth.cleanPhone((await jsonBody(req)).phone) || fail(400, 'Enter a 10-digit mobile number.');
  const r = auth.createOtp(phone);
  if (r.error) fail(429, r.error);
  const sent = await sms.sendOtp(phone, r.code);
  return { ok: true, devCode: sent.devCode };
});
route('POST', '/api/auth/verify', null, async ({ req }) => {
  rateLimit(req);
  const b = await jsonBody(req);
  const phone = auth.cleanPhone(b.phone) || fail(400, 'Enter a 10-digit mobile number.');
  const err = auth.verifyOtp(phone, str(b.code, 6));
  if (err) fail(400, err);
  let u = D().users.find(x => x.role === 'customer' && x.phone === phone);
  if (!u) { u = { id: db.id('u_'), role: 'customer', phone, name: '', createdAt: Date.now() }; D().users.push(u); }
  if (u.disabled) fail(403, 'This account is blocked. Contact dawa4u support.');
  return { token: auth.newSession(u), user: publicUser(u) };
});
route('POST', '/api/auth/login', null, async ({ req }) => {
  rateLimit(req);
  const b = await jsonBody(req);
  const u = D().users.find(x => x.role === b.role && x.role !== 'customer' && x.username === str(b.username, 40).toLowerCase());
  if (!u || u.disabled || !auth.checkPassword(String(b.password || ''), u.passHash)) fail(401, 'Wrong username or password.');
  return { token: auth.newSession(u), user: publicUser(u) };
});
route('POST', '/api/auth/logout', 'any', ({ req }) => { auth.endSession(req); return { ok: true }; });
route('GET', '/api/me', 'any', ({ user }) => ({ user: publicUser(user) }));
route('POST', '/api/me/password', 'staff', async ({ req, user }) => {
  const b = await jsonBody(req);
  if (!auth.checkPassword(String(b.old || ''), user.passHash)) fail(400, 'Your current password is wrong.');
  if (String(b.new || '').length < 8) fail(400, 'Use at least 8 characters for the new password.');
  user.passHash = auth.hashPassword(String(b.new)); db.save();
  return { ok: true };
});
route('GET', '/api/settings', null, () => settingsOut());

// ---------- customer ----------
route('GET', '/api/shop', null, ({ url }) => {
  const pin = str(url.searchParams.get('pin'), 6);
  const ph = /^\d{6}$/.test(pin) ? pharmacyFor(pin) : null;
  return {
    pharmacy: ph ? { id: ph.id, name: ph.name, address: ph.address } : null,
    products: D().products.filter(p => p.active).map(p => ({ id: p.id, name: p.name, pack: p.pack, cat: p.cat, icon: p.icon, rx: p.rx,
      price: ph ? priceAt(ph, p) : p.mrp, inStock: ph ? (ph.stock[p.id] || 0) > 0 : false, left: ph ? Math.min(ph.stock[p.id] || 0, 10) : 0 })),
  };
});
route('POST', '/api/me/profile', 'customer', async ({ req, user }) => {
  const b = await jsonBody(req);
  if (b.name !== undefined) user.name = str(b.name, 60);
  if (b.address !== undefined) user.address = str(b.address, 300);
  if (b.pin !== undefined) { const pin = str(b.pin, 6); if (pin && !/^\d{6}$/.test(pin)) fail(400, 'Enter a 6-digit PIN code.'); user.pin = pin; }
  db.save();
  return { user: publicUser(user) };
});

// Prescription scan: the app sends the photo as raw image bytes
route('POST', '/api/scan', 'customer', async ({ req, user }) => {
  const type = (req.headers['content-type'] || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) fail(400, 'Send a JPEG, PNG or WebP photo.');
  const img = await readBody(req, 8e6);
  if (img.length < 1000) fail(400, 'That photo is empty.');
  const rxId = db.id('rx_');
  const aiOn = !!process.env.ANTHROPIC_API_KEY;
  fs.writeFileSync(path.join(db.dir, 'rx', rxId + '.' + type.split('/')[1]), img);
  const rec = { id: rxId, customerId: user.id, type, at: Date.now(), result: null };
  D().rx = D().rx || []; D().rx.push(rec); db.save();
  // Without an AI key the photo is still attached and the pharmacist reads it by hand
  if (!aiOn) return { rxId, aiOff: true, doctor: null, date: null, meds: [] };
  const result = await ai.readPrescription(img, type, D().products.filter(p => p.active));
  rec.result = result; db.save();
  if (!result.isPrescription) fail(422, 'That photo does not look like a prescription. Try a clearer photo.');
  if (!result.meds.length) fail(422, 'No medicine could be read. Try a sharper, well-lit photo.');
  return { rxId, ...result };
});

// Place an order
route('POST', '/api/orders', 'customer', async ({ req, user }) => {
  const b = await jsonBody(req), s = D().settings;
  const pin = str(b.pin, 6), address = str(b.address, 300);
  if (!/^\d{6}$/.test(pin)) fail(400, 'Enter your 6-digit PIN code.');
  if (address.length < 8) fail(400, 'Enter your full delivery address.');
  const ph = pharmacyFor(pin) || fail(400, 'Sorry, dawa4u does not deliver to this PIN code yet.');
  if (!Array.isArray(b.items) || !b.items.length) fail(400, 'Your cart is empty.');
  const items = [];
  for (const it of b.items.slice(0, 40)) {
    const p = product(it.productId); const qty = int(it.qty, 1, 20);
    if (!p || !p.active || !qty) fail(400, 'An item in your cart is no longer sold. Remove it and try again.');
    if ((ph.stock[p.id] || 0) < qty) fail(409, `${p.name}: only ${ph.stock[p.id] || 0} left at ${ph.name}. Lower the quantity.`);
    items.push({ productId: p.id, name: p.name, pack: p.pack, qty, price: priceAt(ph, p), rx: p.rx });
  }
  let rxId = null;
  if (items.some(i => i.rx)) {
    const rec = (D().rx || []).find(r => r.id === b.rxId && r.customerId === user.id);
    if (!rec) fail(400, 'Your cart has prescription medicines. Scan your prescription first.');
    rxId = rec.id;
  }
  const member = hasPass(user);
  const sub = items.reduce((a, i) => a + i.price * i.qty, 0);
  const disc = member ? Math.round(sub * s.passOff / 100) : 0;
  const del = member ? 0 : s.deliveryFee;
  const method = b.payMethod === 'online' ? 'online' : 'cod';
  const o = { id: db.nextOrderId(), customerId: user.id, pharmacyId: ph.id, riderId: null, items, sub, disc, del, total: sub - disc + del, pass: member,
    address, pin, rxId, otp: String(require('crypto').randomInt(1000, 10000)), status: 'placed', ts: { created: Date.now() },
    pay: { method, status: method === 'cod' ? 'cod' : 'pending' } };
  items.forEach(i => { ph.stock[i.productId] -= i.qty; });
  user.address = address; user.pin = pin;
  D().orders.unshift(o);
  let razorpay = null;
  if (method === 'online' && pay.LIVE) {
    o.status = 'awaiting_payment';
    o.pay.rzpOrderId = await pay.createOrder(o.total, o.id).catch(e => { D().orders.shift(); restoreStock(o); throw e; });
    razorpay = { key: pay.KEY_ID, orderId: o.pay.rzpOrderId, amount: o.total * 100 };
  } else if (method === 'online') { o.pay.status = 'paid'; o.pay.test = true; }
  if (o.status === 'placed') o.ts.placed = Date.now();
  db.save();
  return { order: orderOut(o, 'customer'), razorpay };
});
route('POST', '/api/orders/:id/verify-payment', 'customer', async ({ req, user, p }) => {
  const b = await jsonBody(req);
  const o = D().orders.find(x => x.id === p.id && x.customerId === user.id) || fail(404, 'Order not found.');
  if (o.status !== 'awaiting_payment') return { order: orderOut(o, 'customer') };
  if (b.razorpay_order_id !== o.pay.rzpOrderId || !pay.verify(o.pay.rzpOrderId, b.razorpay_payment_id, b.razorpay_signature)) fail(400, 'Payment could not be confirmed. If money was taken, it will be refunded by Razorpay.');
  o.pay.status = 'paid'; o.pay.paymentId = b.razorpay_payment_id;
  setStatus(o, 'placed');
  return { order: orderOut(o, 'customer') };
});
route('POST', '/api/orders/:id/cancel', 'customer', ({ user, p }) => {
  const o = D().orders.find(x => x.id === p.id && x.customerId === user.id) || fail(404, 'Order not found.');
  if (!['placed', 'awaiting_payment'].includes(o.status)) fail(409, 'The pharmacy has already started on this order, so it cannot be cancelled here. Call support.');
  restoreStock(o); o.reason = 'Cancelled by customer'; setStatus(o, 'cancelled');
  return { order: orderOut(o, 'customer') };
});
route('GET', '/api/my/orders', 'customer', ({ user }) => ({ orders: D().orders.filter(o => o.customerId === user.id).slice(0, 50).map(o => orderOut(o, 'customer')) }));

// dawaPass subscription: ₹100 a month
route('POST', '/api/pass/join', 'customer', async ({ user }) => {
  const price = D().settings.passPrice;
  if (pay.LIVE) {
    const id = await pay.createOrder(price, 'pass-' + user.id.slice(-8));
    user.passPending = id; db.save();
    return { razorpay: { key: pay.KEY_ID, orderId: id, amount: price * 100 } };
  }
  user.passUntil = Math.max(Date.now(), user.passUntil || 0) + 30 * 864e5; user.passTest = true; db.save();
  return { user: publicUser(user) };
});
route('POST', '/api/pass/verify', 'customer', async ({ req, user }) => {
  const b = await jsonBody(req);
  if (!user.passPending || b.razorpay_order_id !== user.passPending || !pay.verify(user.passPending, b.razorpay_payment_id, b.razorpay_signature)) fail(400, 'Payment could not be confirmed.');
  user.passUntil = Math.max(Date.now(), user.passUntil || 0) + 30 * 864e5; user.passTest = false; delete user.passPending; db.save();
  return { user: publicUser(user) };
});
route('POST', '/api/pass/cancel', 'customer', ({ user }) => { user.passUntil = null; db.save(); return { user: publicUser(user) }; });

// Prescription photo: the customer who sent it, the pharmacy filling it, or admin
route('GET', '/api/rx/:id', 'any', ({ user, p, res }) => {
  const rec = (D().rx || []).find(r => r.id === p.id) || fail(404, 'Not found.');
  const ok = user.role === 'admin' || rec.customerId === user.id ||
    (user.role === 'pharmacy' && D().orders.some(o => o.rxId === rec.id && o.pharmacyId === user.pharmacyId));
  if (!ok) fail(403, 'Not allowed.');
  res.writeHead(200, { 'content-type': rec.type, 'cache-control': 'private, max-age=3600' });
  res.end(fs.readFileSync(path.join(db.dir, 'rx', rec.id + '.' + rec.type.split('/')[1])));
  return null;
});

// ---------- pharmacy ----------
const myPharmacy = user => pharmacyOf(user.pharmacyId) || fail(404, 'Your pharmacy was not found. Contact dawa4u.');
route('GET', '/api/pharmacy', 'pharmacy', ({ user }) => {
  const ph = myPharmacy(user), today = startOfDay();
  const mine = D().orders.filter(o => o.pharmacyId === ph.id && o.status !== 'awaiting_payment');
  const todays = mine.filter(o => (o.ts.placed || 0) >= today && !['rejected', 'cancelled'].includes(o.status));
  const open = mine.filter(o => ['placed', 'accepted', 'packed', 'picked'].includes(o.status))
    .sort((a, b) => (b.pass - a.pass) || (a.ts.placed - b.ts.placed)); // dawaPass orders first
  return {
    pharmacy: { id: ph.id, name: ph.name, address: ph.address, pins: ph.pins, open: ph.open, posType: ph.posType, posOpts: ph.posOpts, posLast: ph.posLast },
    stats: { new: open.filter(o => o.status === 'placed').length, toPack: open.filter(o => o.status === 'accepted').length, today: todays.length, sales: todays.reduce((a, o) => a + o.sub - o.disc, 0) },
    open: open.map(o => orderOut(o, 'pharmacy')),
    recent: mine.filter(o => !open.includes(o)).slice(0, 20).map(o => orderOut(o, 'pharmacy')),
    inventory: D().products.filter(p => p.active).map(p => ({ id: p.id, name: p.name, pack: p.pack, rx: p.rx, mrp: p.mrp, price: priceAt(ph, p), stock: ph.stock[p.id] || 0, posCode: p.posCode })),
  };
});
route('POST', '/api/pharmacy/open', 'pharmacy', async ({ req, user }) => { myPharmacy(user).open = !!(await jsonBody(req)).open; db.save(); return { ok: true }; });
route('POST', '/api/pharmacy/orders/:id/:action', 'pharmacy', async ({ req, user, p }) => {
  const ph = myPharmacy(user), b = await jsonBody(req);
  const o = D().orders.find(x => x.id === p.id && x.pharmacyId === ph.id) || fail(404, 'Order not found.');
  const next = { accept: ['placed', 'accepted'], packed: ['accepted', 'packed'], reject: ['placed', 'rejected'] }[p.action] || fail(404, 'Unknown action.');
  if (o.status !== next[0]) fail(409, `This order is already "${o.status}".`);
  if (p.action === 'reject') { restoreStock(o); o.reason = str(b.reason, 120) || 'Rejected by pharmacy'; if (o.pay.status === 'paid') o.pay.status = 'refund_due'; }
  setStatus(o, next[1]);
  return { order: orderOut(o, 'pharmacy') };
});
route('POST', '/api/pharmacy/stock/:productId', 'pharmacy', async ({ req, user, p }) => {
  const ph = myPharmacy(user), b = await jsonBody(req), pr = product(p.productId) || fail(404, 'Product not found.');
  if (b.stock !== undefined) ph.stock[pr.id] = int(b.stock, 0, 99999) ?? fail(400, 'Enter a stock number.');
  if (b.price !== undefined) { const v = int(b.price, 0, 100000); if (v) ph.price[pr.id] = v; else delete ph.price[pr.id]; }
  db.save(); return { ok: true };
});
route('GET', '/api/pharmacy/pos', 'pharmacy', ({ user }) => { const ph = myPharmacy(user); return { posKey: ph.posKey, posType: ph.posType, posOpts: ph.posOpts, posLast: ph.posLast }; });
route('POST', '/api/pharmacy/pos/settings', 'pharmacy', async ({ req, user }) => {
  const ph = myPharmacy(user), b = await jsonBody(req);
  ph.posType = str(b.posType, 40) || ph.posType; ph.posOpts = { stock: b.stock !== false, price: b.price !== false };
  db.save(); return { ok: true };
});
route('POST', '/api/pharmacy/pos/new-key', 'pharmacy', ({ user }) => { const ph = myPharmacy(user); ph.posKey = db.id('pos_') + db.id(''); db.save(); return { posKey: ph.posKey }; });
route('POST', '/api/pharmacy/pos/import', 'pharmacy', async ({ req, user }) => {
  const ph = myPharmacy(user), r = pos.rowsFromCsv((await readBody(req, 5e6)).toString('utf8'));
  if (r.error) fail(400, r.error);
  const last = pos.apply(ph, r.items, D().products, ph.posOpts); db.save();
  return { posLast: last };
});

// ---------- POS machine API (called by the pharmacy's billing software, not by people) ----------
const posPharmacy = req => D().pharmacies.find(p => p.posKey && p.posKey === req.headers['x-pos-key']) || fail(401, 'Wrong or missing X-POS-Key header.');
route('POST', '/api/pos/stock', null, async ({ req }) => {
  const ph = posPharmacy(req), raw = (await readBody(req, 5e6)).toString('utf8');
  let items;
  if ((req.headers['content-type'] || '').includes('json')) {
    try { const j = JSON.parse(raw); items = Array.isArray(j) ? j : j.items; } catch { fail(400, 'Body is not valid JSON.'); }
    if (!Array.isArray(items)) fail(400, 'Send {"items":[{"name","code","stock","mrp"}]}');
  } else { const r = pos.rowsFromCsv(raw); if (r.error) fail(400, r.error); items = r.items; }
  const last = pos.apply(ph, items, D().products, ph.posOpts); db.save();
  return { ok: true, ...last };
});
route('GET', '/api/pos/orders', null, ({ req, url }) => {
  const ph = posPharmacy(req), since = Number(url.searchParams.get('since')) || 0;
  return { orders: D().orders.filter(o => o.pharmacyId === ph.id && (o.ts.placed || 0) > since && o.status !== 'awaiting_payment')
    .map(o => ({ order_id: o.id, status: o.status, placed_at: new Date(o.ts.placed).toISOString(), payment: o.pay.method === 'cod' ? 'cash' : 'online',
      items: o.items.map(i => ({ code: product(i.productId)?.posCode || '', name: i.name, qty: i.qty, mrp: i.price })), discount: o.disc, delivery: o.del, total: o.total })) };
});

// ---------- rider ----------
route('POST', '/api/rider/online', 'rider', async ({ req, user }) => { user.online = !!(await jsonBody(req)).online; db.save(); return { user: publicUser(user) }; });
route('GET', '/api/rider', 'rider', ({ user }) => {
  const today = startOfDay(), s = D().settings;
  const done = D().orders.filter(o => o.riderId === user.id && o.status === 'delivered');
  return {
    user: publicUser(user),
    stats: { today: done.filter(o => o.ts.delivered >= today).length, earnedToday: done.filter(o => o.ts.delivered >= today).length * s.riderPay,
      unpaid: done.filter(o => !o.riderPaid).length * s.riderPay, perDelivery: s.riderPay,
      cashToDeposit: done.filter(o => o.pay.method === 'cod' && !o.cashDeposited).reduce((a, o) => a + o.total, 0) },
    mine: D().orders.filter(o => o.riderId === user.id && ['packed', 'picked'].includes(o.status)).map(o => orderOut(o, 'rider')),
    available: user.online ? D().orders.filter(o => o.status === 'packed' && !o.riderId && (!user.pins || !user.pins.length || user.pins.includes(o.pin))).map(o => orderOut(o, 'rider')) : [],
    history: done.slice(0, 15).map(o => orderOut(o, 'rider')),
  };
});
route('POST', '/api/rider/jobs/:id/:action', 'rider', async ({ req, user, p }) => {
  const o = D().orders.find(x => x.id === p.id) || fail(404, 'Order not found.'), b = await jsonBody(req);
  if (p.action === 'take') {
    if (!user.online) fail(409, 'Go online first.');
    if (o.status !== 'packed' || o.riderId) fail(409, 'Another rider has already taken this order.');
    o.riderId = user.id; o.ts.assigned = Date.now(); db.save();
  } else if (p.action === 'pickup') {
    if (o.riderId !== user.id || o.status !== 'packed') fail(409, 'You cannot pick up this order.');
    setStatus(o, 'picked');
  } else if (p.action === 'deliver') {
    if (o.riderId !== user.id || o.status !== 'picked') fail(409, 'You cannot deliver this order.');
    if (str(b.otp, 4) !== o.otp) fail(400, 'Wrong code. Ask the customer for the 4 digits on their order screen.');
    if (o.pay.method === 'cod') o.pay.status = 'collected';
    setStatus(o, 'delivered');
  } else fail(404, 'Unknown action.');
  return { order: orderOut(o, 'rider') };
});

// ---------- admin ----------
route('GET', '/api/admin', 'admin', () => {
  const d = D(), today = startOfDay(), s = d.settings;
  const real = d.orders.filter(o => !['awaiting_payment', 'cancelled', 'rejected'].includes(o.status));
  const done = real.filter(o => o.status === 'delivered');
  const secs = done.map(o => (o.ts.delivered - o.ts.placed) / 1000);
  const sold = {}; real.forEach(o => o.items.forEach(i => { sold[i.productId] = (sold[i.productId] || 0) + i.qty; }));
  const customers = d.users.filter(u => u.role === 'customer');
  return {
    settings: settingsOut(),
    stats: {
      ordersToday: real.filter(o => o.ts.placed >= today).length, orders: real.length, live: d.orders.filter(o => ACTIVE.includes(o.status)).length,
      gmvToday: real.filter(o => o.ts.placed >= today).reduce((a, o) => a + o.total, 0), gmv: real.reduce((a, o) => a + o.total, 0),
      avgSecs: secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : 0, onTime: secs.length ? Math.round(100 * secs.filter(x => x <= 900).length / secs.length) : 0, delivered: done.length,
      members: customers.filter(hasPass).length, customers: customers.length, riderDue: done.filter(o => !o.riderPaid).length * s.riderPay,
      refundsDue: d.orders.filter(o => o.pay.status === 'refund_due').length,
    },
    orders: d.orders.slice(0, 300).map(o => orderOut(o, 'admin')),
    pharmacies: d.pharmacies.map(ph => {
      const mine = real.filter(o => o.pharmacyId === ph.id), login = d.users.find(u => u.pharmacyId === ph.id);
      return { id: ph.id, name: ph.name, address: ph.address, pins: ph.pins, open: ph.open, posType: ph.posType, posLast: ph.posLast,
        loginId: login?.id, username: login?.username, disabled: !!login?.disabled, orders: mine.length, sales: mine.reduce((a, o) => a + o.sub - o.disc, 0),
        outOfStock: d.products.filter(p => p.active && !(ph.stock[p.id] > 0)).length };
    }),
    riders: d.users.filter(u => u.role === 'rider').map(r => {
      const mine = done.filter(o => o.riderId === r.id);
      return { id: r.id, name: r.name, phone: r.phone, username: r.username, online: !!r.online, disabled: !!r.disabled, pins: r.pins || [],
        delivered: mine.length, due: mine.filter(o => !o.riderPaid).length * s.riderPay, cash: mine.filter(o => o.pay.method === 'cod' && !o.cashDeposited).reduce((a, o) => a + o.total, 0) };
    }),
    customers: customers.map(c => {
      const mine = real.filter(o => o.customerId === c.id);
      return { id: c.id, name: c.name, phone: c.phone, pin: c.pin, address: c.address, member: hasPass(c), orders: mine.length,
        spent: mine.reduce((a, o) => a + o.total, 0), last: mine[0]?.ts.placed || null, note: c.note || '', disabled: !!c.disabled };
    }).sort((a, b) => (b.last || 0) - (a.last || 0)),
    products: d.products.map(p => ({ ...p, sold: sold[p.id] || 0 })),
  };
});
route('POST', '/api/admin/settings', 'admin', async ({ req }) => {
  const b = await jsonBody(req), s = D().settings;
  if (b.deliveryFee !== undefined) s.deliveryFee = int(b.deliveryFee, 0, 200) ?? s.deliveryFee;
  if (b.passOff !== undefined) s.passOff = int(b.passOff, 15, 20) ?? s.passOff;   // dawaPass: 15 to 20% off
  if (b.riderPay !== undefined) s.riderPay = int(b.riderPay, 0, 500) ?? s.riderPay;
  if (b.announcement !== undefined) s.announcement = str(b.announcement, 140);
  db.save(); return { settings: settingsOut() };
});
const cleanPins = v => [...new Set(String(v || '').split(/[^0-9]+/).filter(x => /^\d{6}$/.test(x)))];
const cleanUsername = v => { const u = str(v, 30).toLowerCase(); if (!/^[a-z0-9._-]{3,30}$/.test(u)) fail(400, 'Username: 3 to 30 letters, numbers, dots or dashes.'); if (D().users.some(x => x.username === u)) fail(409, 'That username is taken.'); return u; };
const cleanPassword = v => { const p = String(v || ''); if (p.length < 8) fail(400, 'Password needs at least 8 characters.'); return p; };
route('POST', '/api/admin/pharmacies', 'admin', async ({ req }) => {
  const b = await jsonBody(req);
  const name = str(b.name, 80) || fail(400, 'Enter the pharmacy name.');
  const username = cleanUsername(b.username), password = cleanPassword(b.password);
  const ph = newPharmacy({ name, address: str(b.address, 200), pins: cleanPins(b.pins) });
  D().pharmacies.push(ph);
  D().users.push({ id: db.id('u_'), role: 'pharmacy', username, name, pharmacyId: ph.id, passHash: auth.hashPassword(password), createdAt: Date.now() });
  db.save(); return { ok: true };
});
route('POST', '/api/admin/pharmacies/:id', 'admin', async ({ req, p }) => {
  const ph = pharmacyOf(p.id) || fail(404, 'Pharmacy not found.'), b = await jsonBody(req);
  if (b.name !== undefined) ph.name = str(b.name, 80) || ph.name;
  if (b.address !== undefined) ph.address = str(b.address, 200);
  if (b.pins !== undefined) ph.pins = cleanPins(b.pins);
  if (b.open !== undefined) ph.open = !!b.open;
  db.save(); return { ok: true };
});
route('POST', '/api/admin/riders', 'admin', async ({ req }) => {
  const b = await jsonBody(req);
  const name = str(b.name, 60) || fail(400, 'Enter the rider name.');
  const phone = auth.cleanPhone(b.phone) || fail(400, 'Enter a 10-digit mobile number.');
  D().users.push({ id: db.id('u_'), role: 'rider', username: cleanUsername(b.username), name, phone, pins: cleanPins(b.pins), online: false,
    passHash: auth.hashPassword(cleanPassword(b.password)), createdAt: Date.now() });
  db.save(); return { ok: true };
});
route('POST', '/api/admin/riders/:id/paid', 'admin', ({ p }) => {
  D().orders.filter(o => o.riderId === p.id && o.status === 'delivered').forEach(o => { o.riderPaid = true; if (o.pay.method === 'cod') o.cashDeposited = true; });
  db.save(); return { ok: true };
});
route('POST', '/api/admin/users/:id', 'admin', async ({ req, p, user }) => {
  const u = userOf(p.id) || fail(404, 'User not found.'), b = await jsonBody(req);
  if (b.disabled !== undefined) { if (u.id === user.id) fail(400, 'You cannot block yourself.'); u.disabled = !!b.disabled; }
  if (b.password !== undefined && u.role !== 'customer') u.passHash = auth.hashPassword(cleanPassword(b.password));
  if (b.note !== undefined) u.note = str(b.note, 500);
  if (b.pins !== undefined && u.role === 'rider') u.pins = cleanPins(b.pins);
  if (u.disabled) for (const [t, s] of Object.entries(D().sessions)) if (s.userId === u.id) delete D().sessions[t];
  db.save(); return { ok: true };
});
route('POST', '/api/admin/products', 'admin', async ({ req }) => {
  const b = await jsonBody(req);
  let p = b.id ? product(b.id) : null;
  if (!p) { p = { id: db.id('p_').slice(0, 10), active: true }; D().products.push(p); }
  p.name = str(b.name, 80) || p.name || fail(400, 'Enter the medicine name.');
  p.pack = str(b.pack, 60) || p.pack || '';
  p.mrp = int(b.mrp, 1, 100000) || p.mrp || fail(400, 'Enter the MRP in rupees.');
  p.cat = str(b.cat, 40) || p.cat || 'Other';
  p.icon = ['pill', 'bottle', 'device', 'care'].includes(b.icon) ? b.icon : (p.icon || 'pill');
  p.rx = b.rx !== undefined ? !!b.rx : !!p.rx;
  if (b.posCode !== undefined) p.posCode = str(b.posCode, 40);
  if (b.active !== undefined) p.active = !!b.active;
  db.save(); return { ok: true };
});
route('POST', '/api/admin/orders/:id/cancel', 'admin', async ({ req, p }) => {
  const o = D().orders.find(x => x.id === p.id) || fail(404, 'Order not found.'), b = await jsonBody(req);
  if (['delivered', 'cancelled', 'rejected'].includes(o.status)) fail(409, 'This order is already closed.');
  restoreStock(o); o.reason = str(b.reason, 120) || 'Cancelled by dawa4u';
  if (o.pay.status === 'paid') o.pay.status = 'refund_due';
  setStatus(o, 'cancelled'); return { ok: true };
});
route('POST', '/api/admin/orders/:id/refunded', 'admin', ({ p }) => {
  const o = D().orders.find(x => x.id === p.id) || fail(404, 'Order not found.');
  if (o.pay.status !== 'refund_due') fail(409, 'No refund is due on this order.');
  o.pay.status = 'refunded'; db.save(); return { ok: true };
});

// Unpaid online orders are cancelled after 30 minutes and their stock is put back
setInterval(() => {
  const cut = Date.now() - 30 * 60e3;
  for (const o of D().orders) if (o.status === 'awaiting_payment' && o.ts.created < cut) { restoreStock(o); o.reason = 'Payment not completed'; setStatus(o, 'cancelled'); }
}, 60e3).unref();

// ======================= static files =======================
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) { res.writeHead(301, { location: pathname + '/' }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ======================= server =======================
const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  // Let apps hosted on another domain call this API (set ALLOWED_ORIGINS=https://a.com,https://b.com)
  const origin = req.headers.origin, allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-pos-key');
    res.setHeader('access-control-allow-methods', 'GET, POST');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re); if (!m) continue;
      let user = null;
      if (r.role) {
        user = auth.userFromRequest(req);
        if (!user) fail(401, 'Please log in again.');
        const okRole = r.role === 'any' || r.role === user.role || (r.role === 'staff' && user.role !== 'customer');
        if (!okRole) fail(403, 'This account cannot do that.');
      }
      const out = await r.fn({ req, res, url, user, p: m.groups || {} });
      if (out !== null) send(res, 200, out);
      return;
    }
    fail(404, 'Not found.');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on the server. Try again.' : e.message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`dawa4u is running on http://localhost:${PORT}`);
  console.log(`  Customer app  http://localhost:${PORT}/shop/`);
  console.log(`  Pharmacy app  http://localhost:${PORT}/pharmacy/`);
  console.log(`  Rider app     http://localhost:${PORT}/rider/`);
  console.log(`  Admin website http://localhost:${PORT}/admin/`);
  console.log(`  AI scanner: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off (add ANTHROPIC_API_KEY)'} · Payments: ${pay.LIVE ? 'Razorpay live' : 'TEST MODE (no money moves)'} · OTP: ${sms.DEV ? 'shown on screen (development)' : 'SMS'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { db.flush(); process.exit(0); });
