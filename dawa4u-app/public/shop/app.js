// dawa4u customer website: browse, scan prescription, cart & checkout, order tracking, dawaPass.

// ---------- state ----------
const S = {
  settings: null,          // fees, dawaPass price and discount, payment mode
  user: null,              // logged-in customer, or null
  shop: null,              // { pharmacy, products } for the current PIN
  orders: [],
  cart: JSON.parse(store.get('dawa4u-cart') || '{}'),   // productId -> qty
  rxId: store.get('dawa4u-rx') || null,                 // prescription attached to the next order
  pin: store.get('dawa4u-pin') || '',
  q: '', cat: 'All',
  // scan state: idle -> uploading -> done (or back to idle with an error)
  scan: { stage: 'idle', url: '', result: null, err: '' },
  login: { phone: '', sent: false, devCode: '', err: '', next: '' },
  formErr: '',
};
const saveCart = () => { store.set('dawa4u-cart', JSON.stringify(S.cart)); store.set('dawa4u-rx', S.rxId); };
const byId = id => S.shop?.products.find(p => p.id === id);
const cartIds = () => Object.keys(S.cart).filter(byId);
const cartCount = () => cartIds().reduce((a, id) => a + S.cart[id], 0);
const member = () => !!S.user?.passUntil;
const cartHasRx = () => cartIds().some(id => byId(id).rx);
const live = () => S.orders.filter(o => ['awaiting_payment', 'placed', 'accepted', 'packed', 'picked'].includes(o.status));

// Bill follows the dawaPass state: member = discount + free delivery
function bill() {
  const s = S.settings, sub = cartIds().reduce((a, id) => a + byId(id).price * S.cart[id], 0);
  const disc = member() ? Math.round(sub * s.passOff / 100) : 0;
  const del = !sub ? 0 : member() ? 0 : s.deliveryFee;
  return { sub, disc, del, total: sub - disc + del };
}

// ---------- data ----------
async function loadShop() {
  S.shop = await api('/api/shop?pin=' + encodeURIComponent(S.pin));
  // drop cart items that are no longer sold
  for (const id of Object.keys(S.cart)) if (!byId(id)) delete S.cart[id];
  saveCart();
}
async function loadOrders() { if (S.user) S.orders = (await api('/api/my/orders')).orders; }
async function setPin(pin) {
  S.pin = pin; store.set('dawa4u-pin', pin);
  if (S.user && S.user.pin !== pin) post('/api/me/profile', { pin }).catch(() => {});
  await loadShop(); render();
}

// ---------- routing ----------
const VIEWS = { home: vHome, scan: vScan, cart: vCart, orders: vOrders, pass: vPass, account: vAccount };
const NEEDS_LOGIN = ['orders', 'account'];
const route = () => { const h = location.hash.slice(1); return VIEWS[h] ? h : 'home'; };
function render() {
  const r = route();
  if (r === 'orders' && !S.user) S.login.next = r;   // come back here after logging in
  const n = cartCount(), a = live().length;
  $('#nav').innerHTML = [['home', 'Medicines'], ['scan', 'Scan prescription'], ['orders', 'My orders' + (a ? `<span class="count">${a}</span>` : '')],
    ['pass', 'dawaPass'], ['cart', 'Cart' + (n ? `<span class="count num">${n}</span>` : '')], ['account', S.user ? 'Account' : 'Log in']]
    .map(([k, l]) => `<a href="#${k}" class="${r === k ? 'on' : ''}">${l}</a>`).join('');
  $('#pin').value = S.pin;
  $('#app').innerHTML = (NEEDS_LOGIN.includes(r) && !S.user) ? vLogin() : VIEWS[r]();
  tick();
}

// ---------- home ----------
function stepper(p) {
  const n = S.cart[p.id] || 0;
  if (!S.shop.pharmacy) return '';
  if (!p.inStock) return '<button class="btn sm ghost" disabled>Out of stock</button>';
  return n ? `<div class="step"><button data-act="dec" data-id="${p.id}" aria-label="Remove one ${esc(p.name)}">−</button><span class="num">${n}</span><button data-act="inc" data-id="${p.id}" aria-label="Add one ${esc(p.name)}">+</button></div>`
    : `<button class="btn sm" data-act="inc" data-id="${p.id}">Add</button>`;
}
const priceHTML = p => member() ? `${rs(p.price * (1 - S.settings.passOff / 100))}<s>${rs(p.price)}</s>` : rs(p.price);
function gridHTML() {
  const list = S.shop.products.filter(p => (S.cat === 'All' || p.cat === S.cat) && (p.name + ' ' + p.cat).toLowerCase().includes(S.q.toLowerCase()));
  if (!list.length) return `<p class="muted">No medicine matches “${esc(S.q)}”. Try the salt name, like paracetamol, or scan your prescription.</p>`;
  return list.map(p => `<div class="prod">
    <div class="tile">${ICON[p.icon] || ICON.pill}${p.rx ? '<span class="pill rx">Rx needed</span>' : ''}</div>
    <div class="name">${esc(p.name)}</div><div class="muted small">${esc(p.pack)}</div>
    <div class="row spread"><span class="price num">${priceHTML(p)}</span>${stepper(p)}</div></div>`).join('');
}
function areaNote() {
  if (!/^\d{6}$/.test(S.pin)) return `<div class="note"><b>Enter your PIN code</b> at the top to see medicines from the pharmacy near you.</div>`;
  if (!S.shop.pharmacy) return `<div class="note rx"><b>We don't deliver to ${esc(S.pin)} yet.</b> dawa4u is adding partner pharmacies every week. Try a nearby PIN code.</div>`;
  return `<p class="small muted">Delivering to ${esc(S.pin)} from <b>${esc(S.shop.pharmacy.name)}</b>, ${esc(S.shop.pharmacy.address)}</p>`;
}
function vHome() {
  const o = live()[0], cats = ['All', ...new Set(S.shop.products.map(p => p.cat))];
  return `<section class="hero">
    <div><h1>Medicines at your door in 10 to 15 minutes</h1><p class="hi">दवा, सिर्फ़ 15 मिनट में। आपके पास की दुकान से।</p></div>
    <p>Packed by a partner pharmacy near you and brought by a local rider, in cities and villages alike.</p>
    <div class="row"><a class="btn" href="#scan">Scan a prescription</a><a class="btn ghost" href="#pass">${member() ? 'dawaPass is active' : `Get dawaPass for ₹${S.settings.passPrice} a month`}</a></div>
  </section>
  ${S.settings.announcement ? `<div class="note ok"><b>${esc(S.settings.announcement)}</b></div>` : ''}
  ${o ? `<a class="card row spread" href="#orders" style="text-decoration:none;color:inherit"><span><b>${o.id}</b> · ${STATUS[o.status][0]}</span><span class="pill sun num" data-cd="${o.id}"></span></a>` : ''}
  ${areaNote()}
  <section class="stack">
    <input class="search" id="search" type="search" placeholder="Search medicines and health products" value="${esc(S.q)}" aria-label="Search medicines">
    <div class="chips">${cats.map(c => `<button class="chip ${c === S.cat ? 'on' : ''}" data-act="cat" data-id="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="products" id="grid">${gridHTML()}</div>
  </section>`;
}

// ---------- prescription scanner (vision AI on the server) ----------
function shrink(file) {   // resize to max 1600 px JPEG so it uploads fast on mobile data
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      c.toBlob(b => res(b || file), 'image/jpeg', .85); };
    im.onerror = () => res(file); im.src = URL.createObjectURL(file);
  });
}
async function startScan(file) {
  if (!S.user) { S.login.next = 'scan'; location.hash = 'account'; return; }
  S.scan = { stage: 'uploading', url: URL.createObjectURL(file), result: null, err: '' }; render();
  try {
    const blob = await shrink(file);
    const r = await api('/api/scan', { method: 'POST', raw: true, type: blob.type || 'image/jpeg', body: blob });
    S.scan.stage = 'done'; S.scan.result = r; S.rxId = r.rxId; saveCart();
  } catch (e) { S.scan = { stage: 'idle', url: '', result: null, err: e.message }; }
  if (route() === 'scan') render();
}
function vScan() {
  const sc = S.scan, r = sc.result;
  let body;
  if (sc.stage === 'idle') body = `<div class="drop">
      <h3>Add a photo of your prescription</h3>
      <p class="muted">Handwritten is fine. Keep the doctor's name, date and every medicine line in the frame.</p>
      <label class="btn" for="rxfile">${S.user ? 'Take or choose photo' : 'Log in to scan'}</label>
      <input id="rxfile" type="file" accept="image/*" capture="environment" hidden ${S.user ? '' : 'disabled'}>
      ${!S.user ? '<a class="small" href="#account">Log in with your mobile number</a>' : ''}
      ${sc.err ? `<p class="err" role="alert">${esc(sc.err)}</p>` : ''}
    </div>`;
  else {
    const found = r ? r.meds.filter(m => m.productId && byId(m.productId)?.inStock) : [];
    body = `<div class="stack">
      <div class="drop" style="padding:12px"><img src="${sc.url}" alt="Your prescription photo"></div>
      <div class="bar"><i style="width:${sc.stage === 'uploading' ? 55 : 100}%"></i></div>
      ${sc.stage === 'uploading' ? '<p><b>Reading your prescription…</b></p>' :
      r.aiOff ? `<div class="note ok"><b>Prescription attached.</b> The pharmacist will read it when you order. Add the medicines to your cart yourself.</div>` :
      `<p><b>Read by vision AI</b>${r.doctor || r.date ? `<br><span class="muted small">${esc([r.doctor, r.date].filter(Boolean).join(' · '))}</span>` : ''}</p>
      <div>${r.meds.map(m => { const p = m.productId && byId(m.productId); return `<div class="line"><span><b>${esc(m.name)}</b> ${esc(m.strength)} ${m.confident ? '' : '<span class="pill sun">Unclear, pharmacist will check</span>'}<br>
        <span class="muted small">${esc(m.dosage)}${m.dosage ? ' · ' : ''}qty ${m.qty}</span></span>
        <span class="num">${p ? (p.inStock ? rs(p.price * m.qty) : '<span class="pill grey">Out of stock</span>') : '<span class="pill grey">Not available here</span>'}</span></div>`; }).join('')}</div>
      <div class="row">${found.length ? `<button class="btn" data-act="scan-add">Add ${found.length} to cart</button>` : ''}<button class="btn ghost" data-act="scan-reset">Scan another</button></div>`}
    </div>`;
  }
  return `<section class="stack"><h1>Scan prescription</h1>
    <p class="muted" style="max-width:60ch">Vision AI reads your doctor's handwriting and lists the medicines. The pharmacist checks the prescription before anything is packed.</p></section>
  <div class="grid2"><div class="card">${body}</div>
    <div class="stack">
      <div class="note">AI can misread handwriting. Check the list against your paper prescription. Your photo is stored securely and shown only to the pharmacy filling your order.</div>
      ${S.rxId ? `<div class="note ok"><b>Prescription attached</b> to your next order. <button class="btn sm ghost" data-act="rx-clear">Remove</button></div>` : ''}
    </div></div>`;
}

// ---------- cart & checkout ----------
function vCart() {
  const ids = cartIds(), b = bill(), s = S.settings;
  if (!ids.length) return `<section class="card stack" style="justify-items:start"><h1>Your cart is empty</h1><p class="muted">Add medicines from the shop, or scan a prescription.</p><div class="row"><a class="btn" href="#home">Browse medicines</a><a class="btn ghost" href="#scan">Scan prescription</a></div></section>`;
  const needRx = cartHasRx(), addr = S.user?.address || '';
  return `<h1>Cart and checkout</h1><div class="grid2">
  <div class="stack">
    <div class="card">${ids.map(id => { const p = byId(id); return `<div class="line"><span><b>${esc(p.name)}</b> ${p.rx ? '<span class="pill rx">Rx</span>' : ''}<br><span class="muted small">${esc(p.pack)} · ${rs(p.price)} each</span></span><span class="row"><span class="num">${rs(p.price * S.cart[id])}</span>${stepper(p)}</span></div>`; }).join('')}</div>
    ${needRx ? (S.rxId ? `<div class="note ok"><b>Prescription attached.</b> The pharmacist checks it before packing.</div>`
      : `<div class="note rx"><b>Prescription needed.</b> Your cart has prescription-only medicines. <a href="#scan">Scan your prescription</a> to continue.</div>`) : ''}
    <div class="card stack"><h3>Deliver to</h3>
      <label class="field" for="addr">Full address<textarea id="addr" rows="2" placeholder="House no., street, area, village or city">${esc(addr)}</textarea></label>
      <p class="small muted">PIN code ${esc(S.pin) || 'not set'} · change it at the top of the page</p></div>
    <div class="card stack"><h3>Pay with</h3>
      <label class="opt" for="pay-online"><input type="radio" name="pay" id="pay-online" value="online" checked> UPI, card or netbanking ${s.paymentsLive ? '(Razorpay)' : '<span class="pill grey">Test mode</span>'}</label>
      <label class="opt" for="pay-cod"><input type="radio" name="pay" id="pay-cod" value="cod"> Cash or UPI on delivery</label></div>
  </div>
  <div class="card stack">
    <h3>Bill</h3>
    <div class="bill num">
      <div><span>Item total</span><span>${rs(b.sub)}</span></div>
      ${member() ? `<div><span>dawaPass ${s.passOff}% off</span><span>− ${rs(b.disc)}</span></div>` : ''}
      <div><span>Delivery by local rider</span><span>${b.del ? rs(b.del) : 'Free'}</span></div>
      <div class="tot"><span>To pay</span><span>${rs(b.total)}</span></div>
    </div>
    ${member() ? '<span class="pill sun">dawaPass member · priority packing</span>' : `<div class="note">With dawaPass you would pay <b>${rs(b.sub - Math.round(b.sub * s.passOff / 100))}</b>. <a href="#pass">See dawaPass</a></div>`}
    ${S.formErr ? `<p class="err" role="alert">${esc(S.formErr)}</p>` : ''}
    <button class="btn big num" data-act="pay">${S.user ? `Pay ${rs(b.total)}` : 'Log in to order'}</button>
    ${s.paymentsLive ? '' : '<p class="muted small">Online payments are in test mode on this server. No money is taken.</p>'}
  </div></div>`;
}
function loadRazorpay() {
  return new Promise((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = res; s.onerror = () => rej(new Error('Could not open Razorpay. Check your internet.')); document.head.appendChild(s);
  });
}
async function razorpay(rz, description) {
  await loadRazorpay();
  return new Promise((res, rej) => {
    const r = new window.Razorpay({ key: rz.key, order_id: rz.orderId, amount: rz.amount, currency: 'INR', name: 'dawa4u', description,
      prefill: { contact: S.user.phone, name: S.user.name }, theme: { color: '#0b7a53' },
      handler: res, modal: { ondismiss: () => rej(new Error('Payment was not completed.')) } });
    r.on('payment.failed', e => rej(new Error(e.error?.description || 'Payment failed.')));
    r.open();
  });
}
async function placeOrder(btn) {
  if (!S.user) { S.login.next = 'cart'; location.hash = 'account'; return; }
  S.formErr = '';
  const address = $('#addr').value.trim(), payMethod = document.querySelector('input[name=pay]:checked').value;
  if (cartHasRx() && !S.rxId) { S.formErr = 'Attach your prescription first.'; return render(); }
  btn.disabled = true;
  try {
    const r = await post('/api/orders', { items: cartIds().map(id => ({ productId: id, qty: S.cart[id] })), address, pin: S.pin, payMethod, rxId: S.rxId });
    let order = r.order;
    if (r.razorpay) {
      try { const pr = await razorpay(r.razorpay, 'Order ' + order.id); order = (await post(`/api/orders/${order.id}/verify-payment`, pr)).order; }
      catch (e) { toast(e.message + ' Your order is saved: pay again or cancel it in My orders.'); }
    }
    S.cart = {}; S.rxId = null; S.scan = { stage: 'idle', url: '', result: null, err: '' }; saveCart();
    S.user.address = address;
    await Promise.all([loadOrders(), loadShop()]);
    toast(`Order ${order.id} placed`); location.hash = 'orders';
  } catch (e) { S.formErr = e.message; btn.disabled = false; render(); }
}

// ---------- my orders + live tracker ----------
const STAGES = [['placed', 'Order placed'], ['accepted', 'Pharmacy accepted'], ['packed', 'Packed'], ['picked', 'Rider on the way'], ['delivered', 'Delivered']];
function tracker(o) {
  const i = STAGES.findIndex(s => s[0] === o.status);
  return `<div class="card stack">
    <div class="row spread"><div><span class="muted small">Order ${o.id} · ${when(o.ts.placed || o.ts.created)}</span><h2>${STATUS[o.status][0]}</h2></div>
      ${o.status !== 'awaiting_payment' ? `<div style="text-align:right"><div class="clock num" data-cd="${o.id}"></div><span class="muted small" data-cdl="${o.id}"></span></div>` : ''}</div>
    ${o.status === 'awaiting_payment' ? `<div class="note">This order is waiting for payment. Unpaid orders are cancelled after 30 minutes.</div>` : `
    <ol class="steps">${STAGES.map(([s, l], k) => `<li class="${k < i || o.status === 'delivered' ? 'done' : k === i ? 'now' : ''}"><span>${l}</span><span class="num small">${time(o.ts[s])}</span></li>`).join('')}</ol>`}
    ${o.rider ? `<p><b>${esc(o.rider.name)}</b> <span class="muted">· your rider${o.rider.phone ? ', ' + esc(o.rider.phone) : ''}</span></p>` : ''}
    ${o.status !== 'awaiting_payment' ? `<div class="row spread note"><span>Tell the rider this code at your door</span><span class="otp num">${o.otp}</span></div>` : ''}
    <p class="muted small">${itemsText(o)} · ${rs(o.total)} · ${PAY[o.payStatus] || ''}${o.payTest ? ' (test)' : ''} · from ${esc(o.pharmacy?.name || '')}</p>
    ${['placed', 'awaiting_payment'].includes(o.status) ? `<button class="btn sm danger" data-act="cancel" data-id="${o.id}" style="justify-self:start">Cancel order</button>` : ''}
  </div>`;
}
function vOrders() {
  const act = live(), past = S.orders.filter(o => !act.includes(o));
  return `<h1>My orders</h1>
  ${act.length ? act.map(tracker).join('') : `<div class="card stack" style="justify-items:start"><p>No order is on the way.</p><a class="btn" href="#home">Order medicines</a></div>`}
  ${past.length ? `<section class="stack"><h2>Earlier orders</h2><div class="card">${past.map(o => `<div class="line"><span><b>${o.id}</b> ${statusPill(o.status)} <span class="muted small">${when(o.ts.placed || o.ts.created)}</span><br>
    <span class="muted small">${itemsText(o)}${o.reason ? ' · ' + esc(o.reason) : ''}${o.payStatus === 'refund_due' ? ' · refund on the way' : ''}</span></span>
    <span class="row"><span class="num">${rs(o.total)}</span><button class="btn sm ghost" data-act="reorder" data-id="${o.id}">Reorder</button></span></div>`).join('')}</div></section>` : ''}`;
}

// ---------- dawaPass ----------
function vPass() {
  const s = S.settings, b = bill(), saving = Math.round(b.sub * s.passOff / 100) + (b.sub ? s.deliveryFee : 0);
  return `<div class="grid2"><div class="card stack">
    <span class="pill sun" style="justify-self:start">${member() ? 'Active until ' + day(S.user.passUntil) + (S.user.passTest ? ' (test)' : '') : 'Subscription'}</span>
    <h1>dawaPass</h1>
    <p><span class="clock num">₹${s.passPrice}</span> <span class="muted">per month</span></p>
    <div class="stack">
      <p><b>${s.passOff}% off medicines</b> <span class="muted">on every order.</span></p>
      <p><b>Free delivery,</b> <span class="muted">instead of ${rs(s.deliveryFee)} per order.</span></p>
      <p><b>Priority fulfilment.</b> <span class="muted">The pharmacy packs member orders first.</span></p>
    </div>
    ${member() ? `<button class="btn danger" data-act="pass-cancel">Cancel dawaPass</button>`
      : `<button class="btn big" data-act="pass-join">${S.user ? `Join dawaPass for ₹${s.passPrice} a month` : 'Log in to join dawaPass'}</button>`}
    ${s.paymentsLive ? '' : '<p class="muted small">Payments are in test mode on this server. Joining takes no money.</p>'}
  </div>
  <div class="card stack"><h3>On your current cart</h3>
    ${b.sub ? `<div class="bill num"><div><span>Item total</span><span>${rs(b.sub)}</span></div><div><span>Member discount</span><span>− ${rs(Math.round(b.sub * s.passOff / 100))}</span></div><div><span>Delivery saved</span><span>− ${rs(s.deliveryFee)}</span></div><div class="tot"><span>You save</span><span>${rs(saving)}</span></div></div>
    <p class="muted small">${saving >= s.passPrice ? 'This one order already covers the monthly fee.' : `About ${Math.ceil(s.passPrice / saving)} orders like this cover the monthly fee.`}</p>`
    : '<p class="muted">Add medicines to the cart to see what you would save.</p>'}
  </div></div>`;
}
async function joinPass(btn) {
  if (!S.user) { S.login.next = 'pass'; location.hash = 'account'; return; }
  await act(btn, async () => {
    const r = await post('/api/pass/join');
    if (r.razorpay) { const pr = await razorpay(r.razorpay, 'dawaPass, 1 month'); S.user = (await post('/api/pass/verify', pr)).user; }
    else S.user = r.user;
    toast('dawaPass is on. Member prices applied.'); render();
  });
}

// ---------- login (mobile number + OTP) and account ----------
function vLogin() {
  const L = S.login;
  return `<div class="login" style="margin-top:2vh"><form class="card" id="otp-form">
    <h2>Log in with your mobile number</h2>
    <label class="field" for="phone">Mobile number<input type="tel" id="phone" inputmode="numeric" maxlength="14" placeholder="98765 43210" value="${esc(L.phone)}" autocomplete="tel" ${L.sent ? 'readonly' : ''}></label>
    ${L.sent ? `<label class="field" for="code">6-digit code sent by SMS<input type="text" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" value="${esc(L.devCode)}"></label>
      ${L.devCode ? '<p class="small muted">Development server: the code is filled in for you. Real customers get it by SMS.</p>' : ''}` : ''}
    <p class="err" role="alert">${esc(L.err)}</p>
    <button class="btn big" type="submit">${L.sent ? 'Log in' : 'Send code'}</button>
    ${L.sent ? '<button class="btn ghost" type="button" data-act="otp-reset">Use another number</button>' : ''}
  </form></div>`;
}
async function submitOtp(btn) {
  const L = S.login; L.err = ''; btn.disabled = true;
  try {
    if (!L.sent) { L.phone = $('#phone').value; const r = await post('/api/auth/otp', { phone: L.phone }); L.sent = true; L.devCode = r.devCode || ''; }
    else {
      const r = await post('/api/auth/verify', { phone: L.phone, code: $('#code').value.trim() });
      store.set(TOKEN_KEY, r.token); S.user = r.user;
      if (S.user.pin && !S.pin) { S.pin = S.user.pin; store.set('dawa4u-pin', S.pin); }
      await Promise.all([loadShop(), loadOrders()]);
      S.login = { phone: '', sent: false, devCode: '', err: '', next: '' };
      toast('Logged in'); location.hash = L.next && L.next !== 'account' ? L.next : 'home'; return render();
    }
  } catch (e) { L.err = e.message; }
  render();
}
function vAccount() {
  const u = S.user;
  return `<h1>Account</h1><div class="grid2"><form class="card stack" id="profile-form">
    <label class="field" for="pf-name">Your name<input type="text" id="pf-name" value="${esc(u.name)}" maxlength="60"></label>
    <label class="field">Mobile number<input type="text" value="${esc(u.phone)}" readonly></label>
    <label class="field" for="pf-addr">Delivery address<textarea id="pf-addr" rows="2">${esc(u.address)}</textarea></label>
    <label class="field" for="pf-pin">PIN code<input type="text" id="pf-pin" inputmode="numeric" maxlength="6" value="${esc(u.pin || S.pin)}"></label>
    <button class="btn" type="submit" style="justify-self:start">Save</button>
  </form><div class="card stack"><p>dawaPass: <b>${member() ? 'active until ' + day(u.passUntil) : 'not active'}</b></p><button class="btn ghost" data-act="logout" style="justify-self:start">Log out</button></div></div>`;
}

// ---------- events ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  const run = {
    inc: () => { S.cart[id] = (S.cart[id] || 0) + 1; const p = byId(id); if (S.cart[id] > p.left) { S.cart[id] = p.left; toast(`Only ${p.left} left at this pharmacy`); } },
    dec: () => { S.cart[id]--; if (S.cart[id] <= 0) delete S.cart[id]; },
    cat: () => { S.cat = id; },
    pay: () => placeOrder(b),
    'scan-add': () => { S.scan.result.meds.forEach(m => { const p = m.productId && byId(m.productId); if (p?.inStock) S.cart[p.id] = Math.min(p.left, (S.cart[p.id] || 0) + m.qty); }); toast('Added to cart'); location.hash = 'cart'; },
    'scan-reset': () => { S.scan = { stage: 'idle', url: '', result: null, err: '' }; },
    'rx-clear': () => { S.rxId = null; },
    reorder: () => { const o = S.orders.find(x => x.id === id); o.items.forEach(i => { const p = byId(i.productId); if (p?.inStock) S.cart[p.id] = Math.min(p.left, (S.cart[p.id] || 0) + i.qty); }); location.hash = 'cart'; },
    cancel: () => act(b, async () => { await post(`/api/orders/${id}/cancel`); await Promise.all([loadOrders(), loadShop()]); toast('Order cancelled'); render(); }),
    'pass-join': () => joinPass(b),
    'pass-cancel': () => act(b, async () => { S.user = (await post('/api/pass/cancel')).user; toast('dawaPass cancelled'); render(); }),
    'otp-reset': () => { S.login = { ...S.login, sent: false, devCode: '', err: '' }; },
    logout: () => logout(),
  }[b.dataset.act];
  const r = run && run();
  if (!(r instanceof Promise) && !['pay', 'pass-join', 'logout'].includes(b.dataset.act)) { saveCart(); render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'search') { S.q = e.target.value; $('#grid').innerHTML = gridHTML(); }
});
document.addEventListener('change', e => { if (e.target.id === 'rxfile' && e.target.files[0]) startScan(e.target.files[0]); });
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'pinform') { const v = $('#pin').value.trim(); if (/^\d{6}$/.test(v)) setPin(v); else toast('Enter a 6-digit PIN code'); }
  if (e.target.id === 'otp-form') submitOtp(e.submitter);
  if (e.target.id === 'profile-form') act(e.submitter, async () => {
    S.user = (await post('/api/me/profile', { name: $('#pf-name').value, address: $('#pf-addr').value, pin: $('#pf-pin').value.trim() })).user;
    if (S.user.pin && S.user.pin !== S.pin) await setPin(S.user.pin);
    toast('Saved');
  });
});
$('#pin').addEventListener('change', e => { const v = e.target.value.trim(); if (/^\d{6}$/.test(v) && v !== S.pin) setPin(v); });
window.addEventListener('hashchange', () => { S.formErr = ''; render(); window.scrollTo(0, 0); });

// ---------- 15-minute countdown + live status polling ----------
function tick() {
  const now = Date.now();
  for (const o of S.orders) {
    const start = o.ts.placed || o.ts.created, left = 15 * 60 - (now - start) / 1000, done = o.status === 'delivered';
    const txt = done ? mmss((o.ts.delivered - start) / 1000) : left > 0 ? mmss(left) : 'Soon';
    document.querySelectorAll(`[data-cd="${o.id}"]`).forEach(n => { n.textContent = txt; });
    document.querySelectorAll(`[data-cdl="${o.id}"]`).forEach(n => { n.textContent = done ? 'delivered in' : left > 0 ? 'minutes left of 15' : 'running a little late'; });
  }
}
setInterval(tick, 1000);
setInterval(async () => {
  if (!S.user || !live().length || document.hidden) return;
  const before = JSON.stringify(live().map(o => o.status + o.rider?.name));
  await loadOrders().catch(() => {});
  if (JSON.stringify(live().map(o => o.status + o.rider?.name)) !== before && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) render();
}, 5000);

// ---------- start ----------
onLoggedOut = () => { S.user = null; render(); };
(async () => {
  try {
    S.settings = await api('/api/settings');
    if (store.get(TOKEN_KEY)) {
      S.user = (await api('/api/me').catch(() => ({}))).user || null;
      if (S.user && S.user.role !== 'customer') { S.user = null; store.set(TOKEN_KEY, null); }
      if (S.user?.pin && !S.pin) { S.pin = S.user.pin; store.set('dawa4u-pin', S.pin); }
    }
    await Promise.all([loadShop(), loadOrders()]);
    render();
  } catch (e) { $('#app').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><p class="muted">The dawa4u server could not be reached.</p></div>`; }
})();
