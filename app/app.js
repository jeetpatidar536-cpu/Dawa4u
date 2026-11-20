// =====================================================================
// dawa4u customer PHONE APP (installable; wrap with Capacitor for Play Store / App Store)
// Screens: home · search · rx · cart · track · orders · account · login · location · pass · help
// =====================================================================
import { auth, rupee, esc, when, toast, CATS, RX_RULES, PAYS, payLabel, STATUS, LOGO, ICON, readImages, installable, shop } from '../common/api.js';
import { C } from '../common/customer.js';

const $ = s => document.querySelector(s);
const SUPPORT = (window.D4U_CONFIG || {}).SUPPORT_PHONE || '';
const nav = { depth: 0 };
const go = h => { nav.depth++; location.hash = h; };
const back = h => { if (nav.depth > 0) { nav.depth--; history.back(); } else location.hash = h; };
const busy = async (btn, fn) => { if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.innerHTML = '…'; } try { return await fn(); } catch (e) { toast(C.errText(e), 3200); throw e; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.t; } } };
C._warn = m => toast(m);
installable();

// ------------------------------------------------ pieces
const stepper = p => p.stock <= 0 && !C.qty(p.id) ? `<span class="oos">Out of stock</span>` : C.qty(p.id)
  ? `<div class="stepper"><button data-dec="${p.id}" aria-label="Decrease">−</button><span>${C.qty(p.id)}</span><button data-inc="${p.id}" aria-label="Increase">+</button></div>`
  : `<button class="add" data-inc="${p.id}">ADD</button>`;
const prodCard = p => `<div class="card prod">
  <div class="ph">${esc(p.name[0])}</div>${p.rx ? '<span class="rxpill">Rx needed</span>' : ''}
  <span class="s13 b" style="line-height:1.3">${esc(p.name)}</span><span class="s11 mute">${esc(p.pack)}</span>
  <div class="row" style="justify-content:space-between"><span class="stack" style="gap:0"><span class="s14 xb">${rupee(p.price)}</span>${p.price < p.mrp ? `<s class="s11 mute">${rupee(p.mrp)}</s>` : ''}</span>${stepper(p)}</div></div>`;
const topBar = (title, sub, fallback = '#/') => `<header class="topbar"><button class="icon-btn" data-back="${fallback}" aria-label="Back">${ICON.back}</button>
  <div style="display:flex;flex-direction:column"><h1 class="serif">${esc(title)}</h1>${sub ? `<span class="s12 mute">${sub}</span>` : ''}</div></header>`;
const tabbar = on => {
  const n = C.count(), t = (id, href, icon, label) => `<a class="tab ${on === id ? 'on' : ''}" href="${href}" style="text-decoration:none">${icon}${label}${id === 'cart' && n ? `<span class="badge">${n}</span>` : ''}</a>`;
  return `<nav class="tabbar">${t('home', '#/', ICON.home, 'Home')}${t('rx', '#/rx', ICON.rx, 'Prescription')}${t('orders', '#/orders', ICON.orders, 'Orders')}${t('cart', '#/cart', ICON.cart, 'Cart')}</nav>`;
};
const passCard = () => C.hasPass()
  ? `<div class="pass"><div class="stack" style="gap:4px"><span class="tag">DAWAPASS · ACTIVE</span><span class="serif" style="font-size:18px;font-weight:600">You save ${C.settings.pass_off}% on every order</span><span class="s12" style="opacity:.85">Free delivery · till ${new Date(C.profile.pass_until).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span></div></div>`
  : `<div class="pass"><div class="stack" style="gap:4px"><span class="tag">DAWAPASS</span><span class="serif" style="font-size:18px;font-weight:600">dawaPass — ${rupee(C.settings.pass_price)}/month</span><span class="s12" style="opacity:.85">15–20% off · free delivery · priority</span></div><button class="gold" data-go="#/pass">Join</button></div>`;
const needLogin = (title, next) => `${topBar(title)}<div class="scroll"><div class="empty"><span style="color:var(--em)">${ICON.user}</span><span class="serif" style="font-size:20px">Log in to continue</span><span class="s13 mute">Use your mobile number — we will send you a code.</span><button class="btn" data-go="#/login?next=${encodeURIComponent(next)}" style="width:auto;padding:0 24px">Log in</button></div></div>`;
const pinGate = () => `<div class="card stack" style="padding:18px;gap:12px"><span class="serif" style="font-size:18px;font-weight:600">Where should we deliver?</span>
  <span class="s13 mute">Enter your PIN code to see medicines from the pharmacy nearest you.</span>
  <div class="row"><input id="pinin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN" style="flex:1;font:inherit;font-size:16px;border:1px solid var(--line);border-radius:12px;padding:12px 14px"><button class="btn" id="setpin" style="width:auto;padding:0 20px">Go</button></div></div>`;
const activeBanner = () => { const o = C.liveOrder(); if (!o) return ''; const t = C.track(o);
  return `<button class="card row" data-go="#/track/${o.id}" style="padding:14px 16px;text-align:left;background:#FEF3C7;border-color:#FDE68A">
    <span style="width:40px;height:40px;border-radius:20px;background:var(--gold);display:flex;align-items:center;justify-content:center;flex-shrink:0">${ICON.bike}</span>
    <span class="stack" style="gap:2px;flex:1"><span class="s14 b" style="color:#92400E">${STATUS[o.status]} · ${t.late ? 'any minute' : t.clock}</span><span class="s12" style="color:#92400E">Tap to track ${o.id}</span></span><span style="color:#92400E">›</span></button>`; };

// ------------------------------------------------ screens
const screens = {
  home() {
    const a = C.address();
    const pop = C.orders.length ? [...new Set(C.orders.flatMap(o => o.order_items.map(i => i.product_id)))].map(id => C.byId[id]).filter(Boolean).slice(0, 4)
      : ['p1', 'p31', 'p13', 'p36'].map(id => C.byId[id]).filter(Boolean);
    return `<div class="scroll">
      <div class="hero">
        <div class="row" style="justify-content:space-between">
          <div class="stack" style="gap:2px">
            <span class="row" style="gap:4px;font-size:18px;font-weight:800;letter-spacing:-.05em;color:var(--ivory)">${LOGO('#FAF7F2', '#C9A96E', 24)}<span>dawa<span style="color:var(--gold)">4u</span></span><span style="font-size:12px;font-weight:600;letter-spacing:0;opacity:.9;margin-left:6px">${C.serviceable() ? '· delivering in 15 min' : ''}</span></span>
            <button data-go="#/location" style="color:#fff;font-size:16px;font-weight:700;min-height:32px;text-align:left">${a ? esc(a.label) + ' · ' + esc(a.pin) : C.pin ? 'PIN ' + esc(C.pin) : 'Choose location'} ▾</button>
          </div>
          <button class="icon-btn" data-go="#/account" aria-label="Account" style="background:rgba(255,255,255,.16);color:#fff">${ICON.user}</button>
        </div>
        <button class="searchbox" data-go="#/search">${ICON.search} Search medicines, brands, health products</button>
      </div>
      <div class="pad stack">
        ${C.settings.announcement ? `<div class="ok">${esc(C.settings.announcement)}</div>` : ''}
        ${!C.pin ? pinGate() : !C.serviceable() ? `<div class="ok warn">We don't deliver to PIN ${esc(C.pin)} yet — we're adding pharmacies fast. <a href="#/location" class="b">Change PIN</a></div>` : ''}
        ${activeBanner()}
        <button class="card row" data-go="#/rx" style="padding:16px;text-align:left;gap:14px">
          <span style="width:52px;height:52px;border-radius:14px;background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--em);flex-shrink:0">${ICON.rx}</span>
          <span class="stack" style="gap:3px;flex:1"><span class="b" style="font-size:15px">Order with prescription</span><span class="s12 mute" style="line-height:1.4">Upload a photo — a licensed pharmacist adds your medicines</span></span><span style="color:var(--em)">›</span></button>
        ${passCard()}
        <div class="stack" style="gap:12px"><span class="serif" style="font-size:20px;font-weight:600">Shop by need</span>
          <div class="cats">${CATS.map(c => `<button class="cat" data-go="#/search?cat=${c.id}"><span>${c.mark}</span><span>${c.label}</span></button>`).join('')}</div></div>
        ${pop.length ? `<div class="stack" style="gap:12px"><div class="row" style="justify-content:space-between"><span class="serif" style="font-size:20px;font-weight:600">${C.orders.length ? 'Order again' : 'Popular near you'}</span><a href="#/search" class="s13 b" style="text-decoration:none">See all</a></div>
          <div class="grid2">${pop.map(prodCard).join('')}</div></div>` : ''}
      </div></div>${tabbar('home')}`;
  },
  search(q) {
    const cat = q.get('cat') || '', term = (q.get('q') || '').toLowerCase();
    const res = C.catalog.filter(p => (!cat || p.category === cat) && (!term || (p.name + ' ' + p.salt).toLowerCase().includes(term)));
    return `<header class="topbar" style="gap:8px"><button class="icon-btn" data-back="#/" aria-label="Back">${ICON.back}</button>
        <label class="searchbox" style="background:var(--ivory);border:1px solid var(--line)">${ICON.search}<input id="q" placeholder="Search medicines" value="${esc(q.get('q') || '')}" autocomplete="off"></label></header>
      <div class="scroll"><div class="pad stack">
        ${!C.pin ? pinGate() : ''}
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">${[{ id: '', label: 'All' }, ...CATS].map(c => `<button data-cat="${c.id}" class="chip ${c.id === cat ? 'on' : ''}">${c.label}</button>`).join('')}</div>
        <span class="s12 mute">${res.length} result${res.length === 1 ? '' : 's'}${C.pharmacyName ? ' · from ' + esc(C.pharmacyName) : ''}</span>
        ${res.length ? `<div class="grid2">${res.map(prodCard).join('')}</div>` : C.pin ? `<div class="empty"><span class="b">No medicines found</span><span class="s13 mute">Upload your prescription and a pharmacist will find it.</span><button class="btn" data-go="#/rx" style="width:auto;padding:0 20px">Upload prescription</button></div>` : ''}
      </div></div>${tabbar('home')}`;
  },
  rx() {
    if (!C.user) return needLogin('Upload prescription', '#/rx');
    const r = C.activeRx(), stage = !r ? 1 : r.status === 'done' ? 3 : 2;
    const done = r && r.status === 'done', rej = r && r.status === 'rejected';
    return `${topBar('Upload prescription')}
      <div class="scroll"><div class="pad stack">
        <div class="progress">${[1, 2, 3].map(i => `<span class="${i <= stage ? 'on' : ''}"></span>`).join('')}</div>
        <div class="row s11 b mute" style="justify-content:space-between;margin-top:-10px"><span style="color:var(--em)">1 Upload</span><span style="${stage >= 2 ? 'color:var(--em)' : ''}">2 Pharmacist reads</span><span style="${stage >= 3 ? 'color:var(--em)' : ''}">3 Confirm &amp; pay</span></div>
        ${r && !rej ? `<div class="card row" style="padding:16px;align-items:flex-start">
            <span style="width:40px;height:40px;border-radius:20px;background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--em);flex-shrink:0">${done ? ICON.check : ICON.clock}</span>
            <span class="stack" style="gap:4px"><span class="s14 b">${done ? 'Pharmacist added your medicines' : r.status === 'reading' ? 'A pharmacist is reading it now' : 'Waiting for a pharmacist'}</span>
            <span class="s12 mute" style="line-height:1.5">${done ? `${r.items.length} medicine${r.items.length === 1 ? '' : 's'} added to your cart.${r.pharmacist_note ? ' Note: ' + esc(r.pharmacist_note) : ''}` : 'A licensed pharmacist checks your prescription and adds the medicines to your cart. Usually about 3 minutes — keep this app open or come back.'}</span></span></div>`
        : `${rej ? `<div class="ok warn">The pharmacist could not use your last prescription: ${esc(r.pharmacist_note || 'unclear photo')}. Please upload a clearer photo.</div>` : ''}
          <div class="card stack" style="padding:16px;gap:12px"><span class="serif" style="font-size:18px;font-weight:600">Your prescription</span>
            <div style="display:flex;gap:10px;overflow-x:auto">${pending.map((p, i) => `<div class="thumb" style="background-image:url(${p.preview})" aria-label="Page ${i + 1}"></div>`).join('')}
              ${pending.length < 4 ? `<label class="addpage">${ICON.plus}Add page<input type="file" accept="image/*" multiple hidden data-file></label>` : ''}</div>
            <div class="grid2"><label class="btn soft">${ICON.cam}Camera<input type="file" accept="image/*" capture="environment" hidden data-file></label><label class="btn soft">${ICON.img}Gallery<input type="file" accept="image/*" multiple hidden data-file></label></div></div>
          <div class="stack" style="gap:8px"><span class="s13 b">A valid prescription shows</span>${RX_RULES.map(x => `<div class="row s13" style="gap:10px"><span style="color:var(--em)">${ICON.check}</span>${x}</div>`).join('')}</div>
          <label class="field">Note for pharmacist (optional)<textarea id="note" placeholder="e.g. Need only 10 days of medicine"></textarea></label>`}
      </div></div>
      <div class="foot">${r && !rej ? (done ? `<button class="btn" data-go="#/cart">Go to cart</button>` : `<button class="btn ghost" data-go="#/">Keep shopping while you wait</button>`)
        : `<button class="btn" id="sendrx" ${pending.length ? '' : 'disabled'}>Send to pharmacist</button>`}</div>`;
  },
  cart() {
    const L = C.lines(), b = C.bill();
    if (!L.length) return `${topBar('Cart')}<div class="scroll"><div class="empty"><span style="color:var(--em)">${ICON.cart}</span><span class="serif" style="font-size:20px">Your cart is empty</span><span class="s13 mute">Search for medicines or upload a prescription.</span><button class="btn" data-go="#/search" style="width:auto;padding:0 22px">Browse medicines</button><button class="btn ghost" data-go="#/rx" style="width:auto;padding:0 22px">Upload prescription</button></div></div>${tabbar('cart')}`;
    const need = C.rxNeeded(), a = C.address(), rxv = C.prescriptions.find(p => p.id === C.cart.rxId && p.status === 'done');
    return `${topBar('Cart', `${C.count()} items · ${esc(C.pharmacyName || '')}`)}
      <div class="scroll"><div class="pad stack" style="gap:14px">
        ${need.length ? `<button class="ok warn" data-go="#/rx" style="text-align:left">⚠ ${need.map(l => esc(l.name)).join(', ')} need${need.length === 1 ? 's' : ''} a prescription. Tap to upload it — a pharmacist will verify it.</button>`
          : rxv ? `<div class="ok">${ICON.check} Prescription verified by pharmacist</div>` : ''}
        <div class="card" style="padding:4px 14px">${L.map((l, n) => `<div class="row" style="padding:12px 0;${n < L.length - 1 ? 'border-bottom:1px solid var(--line)' : ''}">
            <div class="ph" style="width:48px;height:48px;font-size:14px;flex-shrink:0">${esc(l.name[0])}</div>
            <div class="stack" style="gap:2px;flex:1;min-width:0"><span class="s13 b">${esc(l.name)}</span><span class="s11 mute">${esc(l.pack)}${l.rx ? ' · Rx' : ''}</span><span class="s13 xb">${rupee(l.price * l.qty)}</span></div>${stepper(l)}</div>`).join('')}</div>
        ${C.hasPass() ? `<div class="ok">${ICON.check} dawaPass applied — ${C.settings.pass_off}% off and free delivery</div>`
          : `<label class="pass" style="cursor:pointer"><div class="stack" style="gap:2px"><span class="s13 b">Add dawaPass · ${rupee(C.settings.pass_price)}/month</span><span class="s11" style="opacity:.8">Save ${rupee(Math.round(b.sub * C.settings.pass_off / 100) + C.settings.delivery_fee)} and free delivery on this order</span></div><input type="checkbox" id="passbox" ${C.cart.buyPass ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--gold)"></label>`}
        <div class="card stack" style="padding:14px 16px;gap:8px"><span class="serif" style="font-size:18px;font-weight:600">Bill details</span>
          <div class="billrow"><span class="mute">Item total (MRP)</span><span>${rupee(b.mrp)}</span></div>
          ${b.saved ? `<div class="billrow"><span class="mute">Pharmacy discount</span><span style="color:var(--em);font-weight:600">− ${rupee(b.saved)}</span></div>` : ''}
          ${b.disc ? `<div class="billrow"><span class="mute">dawaPass discount</span><span style="color:var(--em);font-weight:600">− ${rupee(b.disc)}</span></div>` : ''}
          <div class="billrow"><span class="mute">Delivery fee</span><span>${b.delivery ? rupee(b.delivery) : `<s class="mute">${rupee(C.settings.delivery_fee)}</s> FREE`}</span></div>
          <div class="billrow"><span class="mute">Handling</span><span>${rupee(b.handling)}</span></div>
          ${b.passFee ? `<div class="billrow"><span class="mute">dawaPass (1 month)</span><span>${rupee(b.passFee)}</span></div>` : ''}
          <div class="hr"></div><div class="billrow xb" style="font-size:15px"><span>To pay</span><span>${rupee(b.total)}</span></div></div>
        <button class="card row" data-go="#/location" style="padding:12px 14px;text-align:left"><span style="color:var(--em)">${ICON.pin}</span>
          <span class="stack" style="gap:2px;flex:1">${a ? `<span class="s13 b">Deliver to ${esc(a.label)}</span><span class="s11 mute">${esc(a.line)} · ${esc(a.pin)}</span>` : `<span class="s13 b">Add delivery address</span>`}</span><span class="s13 b" style="color:var(--em)">${a ? 'Change' : 'Add'}</span></button>
        <div class="stack" style="gap:8px"><span class="s13 b">Pay using</span>
          <div class="grid2">${PAYS.map(p => `<label class="opt ${C.cart.pay === p.id ? 'on' : ''}"><input type="radio" name="pay" value="${p.id}" ${C.cart.pay === p.id ? 'checked' : ''}>${p.label}</label>`).join('')}</div>
          <span class="s11 mute">Secure payments by Razorpay · UPI, cards and netbanking${C.settings.payments_test_mode ? ' · <b>test mode</b>' : ''}</span></div>
      </div></div>
      <div class="foot row"><div class="stack" style="gap:2px"><span class="s11 mute b">PAY USING</span><span class="s13 b">${payLabel(C.cart.pay)}</span></div>
        <button class="btn" id="pay" style="flex:1" ${need.length ? 'disabled' : ''}>${need.length ? 'Prescription needed' : !C.user ? 'Log in to order' : !a ? 'Add address' : (C.cart.pay === 'cod' ? 'Place order · ' : 'Pay ') + rupee(b.total)}</button></div>`;
  },
  track(q, id) {
    const o = C.orders.find(x => x.id === id);
    if (!o) return `${topBar('Track order', '', '#/orders')}<div class="spin"></div>`;
    const t = C.track(o), k = t.idx < 2 ? 0 : t.delivered ? 1 : Math.min(0.92, t.pct / 100);
    if (o.status === 'pending_payment' || o.status === 'cancelled') return `${topBar('Order ' + o.id, '', '#/orders')}<div class="scroll"><div class="pad stack">
      <div class="card stack" style="padding:18px;gap:8px"><span class="status ${o.status}" style="align-self:flex-start">${STATUS[o.status]}</span>
      <span class="s13 mute">${o.status === 'cancelled' ? esc(o.cancel_reason || '') + (o.pay_status === 'refund_due' ? ' · Your refund is being processed (3–5 days).' : '') : 'Complete the payment to send this order to the pharmacy. Unpaid orders are cancelled after ' + C.settings.payment_minutes + ' minutes.'}</span></div>
      ${orderCard(o)}</div></div>${o.status === 'pending_payment' ? `<div class="foot row"><button class="btn ghost" id="cancelorder" data-id="${o.id}" style="flex:1">Cancel</button><button class="btn" id="payagain" data-id="${o.id}" style="flex:2">Pay ${rupee(o.total)}</button></div>` : ''}`;
    return `<div class="scroll" style="display:flex;flex-direction:column">
      <div class="map">
        <div class="road" style="left:-20px;top:150px;width:440px;height:22px;transform:rotate(-8deg)"></div>
        <div class="road" style="left:210px;top:-20px;width:22px;height:440px;transform:rotate(6deg)"></div>
        <div class="road" style="left:40px;top:260px;width:360px;height:16px;transform:rotate(4deg)"></div>
        <div style="position:absolute;left:70px;top:120px;width:160px;height:140px;border:4px dashed var(--em);border-right:none;border-top:none;border-radius:0 0 0 40px"></div>
        <div class="dot" style="left:52px;top:100px;width:36px;height:36px;background:var(--em);color:#fff">${ICON.plus}</div>
        <div class="dot" style="left:220px;top:252px;width:36px;height:36px;background:var(--ink)">${ICON.house}</div>
        ${t.delivered || !o.rider_id ? '' : `<div class="dot" style="left:${70 + k * 150}px;top:${130 + k * 120}px;width:40px;height:40px;background:var(--gold)">${ICON.bike}</div>`}
        <button class="icon-btn" data-back="#/orders" aria-label="Back" style="position:absolute;left:16px;top:calc(env(safe-area-inset-top) + 16px);background:#fff">${ICON.back}</button>
      </div>
      <div class="sheet" style="flex:1">
        <div class="row" style="justify-content:space-between">
          <div class="stack" style="gap:2px"><span class="s13 mute b">${t.delivered ? 'Order ' + o.id : 'Arriving in'}</span><span class="clock" style="${t.delivered ? 'color:var(--em)' : ''}">${t.delivered ? 'Delivered' : t.late ? 'Any minute' : t.clock}</span></div>
          <div class="ring" style="background:conic-gradient(${t.delivered ? 'var(--em)' : 'var(--amber)'} 0 ${t.delivered ? 100 : t.pct}%, #FEF3C7 0 100%)"><div><span style="font-size:15px;font-weight:800;color:var(--ink)">15</span>min</div></div>
        </div>
        <div>${t.steps.map((s, i) => `<div class="tl"><div class="rail"><span class="d" style="background:${s.state === 'done' ? 'var(--em)' : '#fff'};border-color:${s.state === 'next' ? '#D1D5DB' : 'var(--em)'}"></span><span class="l" style="background:${i === 3 ? 'transparent' : s.state === 'done' ? 'var(--em)' : 'var(--line)'}"></span></div>
          <div class="stack" style="gap:1px;padding-bottom:12px"><span class="s13 b" style="color:${s.state === 'next' ? 'var(--mute)' : 'var(--ink)'}">${s.title}</span><span class="s11 mute">${esc(s.sub)}</span></div></div>`).join('')}</div>
        ${t.delivered ? '' : `<div class="row" style="border:1px solid var(--line);border-radius:16px;padding:12px">
          <div style="width:44px;height:44px;border-radius:22px;background:var(--sand);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--em)">${esc((o.rider_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2))}</div>
          <div class="stack" style="gap:2px;flex:1"><span class="serif" style="font-size:16px;font-weight:600">${o.rider_name ? esc(o.rider_name) + ' · your rider' : 'Rider not assigned yet'}</span><span class="s11 mute">Delivery OTP: <strong id="otp" style="color:var(--ink);letter-spacing:.15em">${otpCache[o.id] || '····'}</strong>${o.rider_phone ? ' · ' + esc(o.rider_phone) : ''}</span></div>
          ${o.rider_phone ? `<a class="icon-btn" href="tel:${esc(o.rider_phone)}" aria-label="Call rider" style="background:var(--mint);color:var(--em)">${ICON.phone}</a>` : ''}</div>`}
        ${orderCard(o)}
        ${o.status === 'placed' ? `<button class="btn ghost" id="cancelorder" data-id="${o.id}">Cancel order</button>` : ''}
        <button class="btn soft" data-go="#/help?order=${o.id}">Need help with this order?</button>
      </div></div>`;
  },
  orders() {
    if (!C.user) return needLogin('Your orders', '#/orders');
    return `${topBar('Your orders')}<div class="scroll"><div class="pad stack">
      ${C.orders.length ? C.orders.map(o => { const t = C.track(o); return `<button class="card stack" data-go="#/track/${o.id}" style="padding:14px 16px;gap:6px;text-align:left">
        <div class="row" style="justify-content:space-between"><span class="s14 b">${o.id}</span><span class="status ${o.status}">${['placed', 'accepted', 'packed', 'picked'].includes(o.status) ? (t.late ? 'Arriving' : 'Arriving in ' + t.clock) : STATUS[o.status]}</span></div>
        <span class="s12 mute">${o.order_items.map(i => esc(i.name)).join(', ')}</span>
        <div class="row" style="justify-content:space-between"><span class="s12 mute">${when(o.created_at)}</span><span class="s14 xb">${rupee(o.total)}</span></div></button>`; }).join('')
      : `<div class="empty"><span style="color:var(--em)">${ICON.orders}</span><span class="b">No orders yet</span><button class="btn" data-go="#/" style="width:auto;padding:0 20px">Start shopping</button></div>`}
      </div></div>${tabbar('orders')}`;
  },
  account() {
    const p = C.profile;
    return `${topBar('Account')}<div class="scroll"><div class="pad stack">
      <div class="card row" style="padding:16px"><div style="width:52px;height:52px;border-radius:26px;background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--em)">${ICON.user}</div>
        <div class="stack" style="gap:4px;flex:1">${p ? `<input id="myname" value="${esc(p.name)}" placeholder="Your name" style="font:inherit;font-weight:700;border:0;border-bottom:1px dashed var(--line);padding:2px 0;background:none"><span class="s12 mute">${esc(p.phone ? '+' + p.phone : p.email || '')}</span>` : `<span class="b">You are not logged in</span><span class="s12 mute">Log in with your mobile number</span>`}</div>
        ${p ? '' : `<button class="add" data-go="#/login?next=%23%2Faccount">Log in</button>`}</div>
      ${passCard()}
      <div class="card list">
        <button class="li" data-go="#/orders">${ICON.orders} Your orders</button>
        <button class="li" data-go="#/location">${ICON.pin} Saved addresses</button>
        <button class="li" data-go="#/rx">${ICON.rx} Prescriptions</button>
        <button class="li" data-go="#/help">${ICON.help} Help &amp; support</button>
      </div>
      ${p ? `<button class="btn ghost" id="logout">Log out</button>` : ''}
      <p class="demo">dawa4u · Medicines from licensed partner pharmacies${SUPPORT ? ' · Support ' + esc(SUPPORT) : ''}</p>
      </div></div>${tabbar('')}`;
  },
  login(q) {
    const phone = q.get('phone');
    return `${topBar(phone ? 'Enter OTP' : 'Log in', '', '#/')}<div class="scroll"><div class="pad stack" style="gap:20px">
      <div class="row" style="gap:6px;font-size:26px;font-weight:800;letter-spacing:-.05em;color:var(--em);margin-top:12px">${LOGO()}<span>dawa<span style="color:#9A7B3F">4u</span></span></div>
      ${phone ? `<span class="serif" style="font-size:24px;font-weight:600">Enter the 6-digit code</span><span class="s13 mute" style="margin-top:-12px">Sent by SMS to +91 ${esc(phone)}</span>
        <div class="otp">${[0, 1, 2, 3, 4, 5].map(i => `<input inputmode="numeric" autocomplete="one-time-code" data-otp="${i}" aria-label="Digit ${i + 1}">`).join('')}</div>
        <button class="btn" id="verify">Verify &amp; continue</button><button class="add" id="resend" style="align-self:center">Resend code</button>`
      : `<span class="serif" style="font-size:24px;font-weight:600">Log in with your mobile number</span>
        <label class="field">Mobile number<div class="row" style="gap:8px"><span class="b" style="padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff">+91</span><input id="phone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number" style="flex:1"></div></label>
        <button class="btn" id="sendotp">Send OTP</button><span class="s11 mute">By continuing you agree to the Terms and Privacy policy.</span>`}
      </div></div>`;
  },
  location() {
    return `${topBar('Delivery address', '', '#/')}<div class="scroll"><div class="pad stack">
      ${C.user ? `<div class="stack" style="gap:10px">${C.addresses.map(a => `<label class="opt ${C.cart.addressId === a.id ? 'on' : ''}" style="align-items:flex-start"><input type="radio" name="addr" value="${a.id}" ${C.cart.addressId === a.id ? 'checked' : ''}><span class="stack" style="gap:3px"><span class="s14 b">${esc(a.label)}</span><span class="s12 mute" style="font-weight:500">${esc(a.line)} · ${esc(a.pin)}</span></span></label>`).join('') || '<span class="s13 mute">No saved addresses yet.</span>'}</div>
      <div class="card stack" style="padding:16px;gap:12px"><span class="s14 b">Add a new address</span>
        <label class="field">Label<input id="alabel" placeholder="Home, Office, Parents…"></label>
        <label class="field">Full address<input id="aline" placeholder="House no., street, area, landmark"></label>
        <label class="field">PIN code<input id="apin" inputmode="numeric" maxlength="6" placeholder="6 digits"></label>
        <button class="btn ghost" id="addaddr">Save address</button></div>`
      : `${pinGate()}<button class="btn ghost" data-go="#/login?next=%23%2Flocation">Log in to save addresses</button>`}
      </div></div><div class="foot"><button class="btn" data-back="#/">Done</button></div>`;
  },
  pass() {
    const on = C.hasPass();
    return `${topBar('dawaPass')}<div class="scroll"><div class="pad stack">
      <div class="pass" style="flex-direction:column;align-items:flex-start;padding:24px;gap:14px">
        <span class="tag">DAWAPASS</span><span style="font-size:44px;font-weight:800;letter-spacing:-.02em">${rupee(C.settings.pass_price)}<span style="font-size:18px;font-weight:600;opacity:.8">/month</span></span>
        <div class="stack" style="gap:8px;font-size:15px"><span>✓ ${C.settings.pass_off}% off medicines (up to 20% on select brands)</span><span>✓ Free delivery on every order</span><span>✓ Priority fulfilment</span></div></div>
      ${on ? `<div class="ok">${ICON.check} Active till ${new Date(C.profile.pass_until).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>`
        : `<span class="s13 mute" style="line-height:1.6">dawaPass is added to your next order and paid with it. It runs for 30 days; buy again any time to extend.</span>`}
      </div></div><div class="foot">${on ? `<button class="btn ghost" data-back="#/">Back to shopping</button>` : `<button class="btn" id="joinpass">${C.cart.buyPass ? 'Added — go to cart' : 'Add dawaPass to my cart'}</button>`}</div>`;
  },
  help(q) {
    const oid = q.get('order') || '';
    return `${topBar('Help & support')}<div class="scroll"><div class="pad stack">
      ${SUPPORT ? `<a class="btn soft" href="tel:${esc(SUPPORT)}">${ICON.phone} Call ${esc(SUPPORT)}</a>` : ''}
      ${C.user ? `<div class="card stack" style="padding:16px;gap:12px"><span class="s14 b">Write to us</span>
        <label class="field">Topic<input id="tsub" value="${oid ? 'Order ' + esc(oid) : ''}" placeholder="e.g. Wrong item, refund"></label>
        <label class="field">Message<textarea id="tmsg" placeholder="Tell us what happened"></textarea></label>
        <button class="btn" id="ticket" data-order="${esc(oid)}">Send</button></div>
        ${tickets.map(t => `<div class="card stack" style="padding:14px 16px;gap:4px"><span class="s13 b">${esc(t.subject)}</span><span class="s12 mute">${esc(t.message)}</span>${t.reply ? `<span class="s12" style="color:var(--em)"><b>dawa4u:</b> ${esc(t.reply)}</span>` : '<span class="s11 mute">We will reply soon</span>'}</div>`).join('')}`
      : `<button class="btn" data-go="#/login?next=%23%2Fhelp">Log in to write to us</button>`}
      </div></div>`;
  }
};
const orderCard = o => `<div class="card stack" style="padding:14px 16px;gap:6px"><span class="s13 b">Order ${o.id} · ${esc(o.pharmacy_name)}</span>
  ${o.order_items.map(l => `<div class="billrow"><span class="mute">${l.qty} × ${esc(l.name)}</span><span>${rupee(l.price * l.qty)}</span></div>`).join('')}
  <div class="hr"></div>${o.disc ? `<div class="billrow"><span class="mute">dawaPass discount</span><span style="color:var(--em)">− ${rupee(o.disc)}</span></div>` : ''}
  <div class="billrow"><span class="mute">Delivery + handling</span><span>${rupee(o.delivery + o.handling)}</span></div>
  ${o.pass_fee ? `<div class="billrow"><span class="mute">dawaPass</span><span>${rupee(o.pass_fee)}</span></div>` : ''}
  <div class="billrow b"><span>${o.pay_status === 'paid' ? 'Paid' : o.pay_method === 'cod' ? 'Pay cash' : 'Total'} · ${payLabel(o.pay_method)}</span><span>${rupee(o.total)}</span></div></div>`;

// ------------------------------------------------ router
let pending = [], ticker, tickets = [];
const otpCache = {};
function render() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean), name = parts[0] || 'home', q = new URLSearchParams(qs || '');
  const v = $('#view');
  if (!C.ready) { v.innerHTML = '<div class="spin"></div>'; return; }
  const sc = v.querySelector('.scroll'), y = v.dataset.route === location.hash && sc ? sc.scrollTop : 0;
  v.innerHTML = (screens[name] || screens.home)(q, parts[1]);
  v.dataset.route = location.hash;
  const sc2 = v.querySelector('.scroll'); if (sc2 && y) sc2.scrollTop = y;
  clearInterval(ticker);
  if (name === 'track' || (name === 'home' && C.liveOrder())) ticker = setInterval(() => { if (!document.activeElement || !document.activeElement.matches('input,textarea')) render(); }, 1000);
  if (name === 'track' && parts[1] && !otpCache[parts[1]]) shop.otp(parts[1]).then(x => { if (x) { otpCache[parts[1]] = x; const el = $('#otp'); if (el) el.textContent = x; } }).catch(() => {});
  if (name === 'help' && C.user) shop.tickets().then(t => { if (JSON.stringify(t) !== JSON.stringify(tickets)) { tickets = t; render(); } }).catch(() => {});
  const f = $('input#phone') || $('[data-otp="0"]'); if (f) f.focus();
}
C.on(() => {
  if (C.justVerified) { C.justVerified = null; toast('Pharmacist added your medicines to the cart'); }
  const a = document.activeElement; if (!a || !a.matches('input:not([type=checkbox]):not([type=radio]),textarea')) render();
});
addEventListener('hashchange', () => { pending = []; render(); });

// ------------------------------------------------ events
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-go],[data-back],[data-inc],[data-dec],[data-cat],button[id]');
  if (!el) return;
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.back) return back(el.dataset.back);
  if (el.dataset.inc) { const n = C.qty(el.dataset.inc); C.add(el.dataset.inc); if (!n && C.qty(el.dataset.inc)) toast('Added to cart'); return; }
  if (el.dataset.dec) return C.setQty(el.dataset.dec, C.qty(el.dataset.dec) - 1);
  if (el.dataset.cat !== undefined) { const t = ($('#q') || {}).value || ''; return history.replaceState(null, '', '#/search?' + new URLSearchParams({ ...(el.dataset.cat ? { cat: el.dataset.cat } : {}), ...(t ? { q: t } : {}) })) || render(); }
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  switch (el.id) {
    case 'setpin': return busy(el, async () => { await C.setPin($('#pinin').value.trim()); toast(C.serviceable() ? 'Showing medicines from ' + C.pharmacyName : 'We do not deliver here yet'); });
    case 'sendrx': return busy(el, async () => { await C.sendRx(pending.map(p => p.blob), ($('#note') || {}).value); pending = []; toast('Sent to pharmacist'); render(); });
    case 'pay': {
      if (!C.user) return go('#/login?next=' + encodeURIComponent('#/cart'));
      if (!C.address()) return go('#/location');
      return busy(el, async () => {
        try { const o = await C.checkout(); toast(o.pay_method === 'cod' ? 'Order placed' : 'Payment successful'); location.replace('#/track/' + o.id); }
        catch (err) { if (err.order) location.replace('#/track/' + err.order.id); throw err; }
      }).catch(() => {});
    }
    case 'payagain': return busy(el, async () => { const o = C.orders.find(x => x.id === el.dataset.id); await C.payAgain(o); toast('Payment successful'); render(); }).catch(() => {});
    case 'cancelorder': if (!confirm('Cancel this order?')) return; return busy(el, async () => { await C.cancel(el.dataset.id); toast('Order cancelled'); render(); }).catch(() => {});
    case 'logout': await auth.signOut(); toast('Logged out'); return location.replace('#/');
    case 'sendotp': { const p = $('#phone').value.replace(/\D/g, ''); return busy(el, async () => { await auth.sendOtp(p); go('#/login?' + new URLSearchParams({ phone: p, next: qp.get('next') || '#/' })); }).catch(() => {}); }
    case 'resend': return busy(el, async () => { await auth.sendOtp(qp.get('phone')); toast('New code sent'); }).catch(() => {});
    case 'verify': {
      const code = [...document.querySelectorAll('[data-otp]')].map(i => i.value).join('');
      if (code.length < 6) return toast('Enter all 6 digits');
      return busy(el, async () => { await auth.verifyOtp(qp.get('phone'), code); await C.setUser((await auth.user())); toast('Logged in'); location.replace(qp.get('next') || '#/'); }).catch(() => {});
    }
    case 'addaddr': return busy(el, async () => { await C.addAddress($('#alabel').value.trim(), $('#aline').value.trim(), $('#apin').value.trim()); toast('Address saved'); }).catch(() => {});
    case 'joinpass': C.togglePass(true); return go('#/cart');
    case 'ticket': return busy(el, async () => { const s = $('#tsub').value.trim(), m = $('#tmsg').value.trim(); if (!s || !m) throw new Error('Write a topic and message'); await shop.ticket(s, m, el.dataset.order || null); toast('Sent — we will reply soon'); tickets = await shop.tickets(); render(); }).catch(() => {});
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('[data-file]')) { pending = pending.concat(await readImages(t.files)).slice(0, 4); render(); }
  if (t.id === 'passbox') C.togglePass(t.checked);
  if (t.name === 'pay') { C.cart.pay = t.value; C.save(); render(); }
  if (t.name === 'addr') C.chooseAddress(t.value).catch(err => toast(C.errText(err)));
  if (t.id === 'myname' && t.value.trim()) { const { me } = await import('../common/api.js'); me.setName(t.value.trim()).then(() => toast('Name saved')).catch(err => toast(C.errText(err))); }
});
let qT;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { clearTimeout(qT); qT = setTimeout(() => { const cat = new URLSearchParams(location.hash.split('?')[1] || '').get('cat'); history.replaceState(null, '', '#/search?' + new URLSearchParams({ ...(cat ? { cat } : {}), ...(t.value ? { q: t.value } : {}) })); render(); const qi = $('#q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }, 200); }
  if (t.dataset.otp !== undefined) {
    const digits = t.value.replace(/\D/g, '');
    if (digits.length > 1) { [...document.querySelectorAll('[data-otp]')].forEach((inp, i) => { inp.value = digits[i] || ''; }); $('#verify').click(); return; }  // pasted / autofilled code
    t.value = digits; if (digits) { const n = document.querySelector(`[data-otp="${+t.dataset.otp + 1}"]`); n ? n.focus() : $('#verify').click(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.target.dataset && e.target.dataset.otp !== undefined && e.key === 'Backspace' && !e.target.value) { const p = document.querySelector(`[data-otp="${+e.target.dataset.otp - 1}"]`); if (p) p.focus(); }
  if (e.key === 'Enter' && e.target.id === 'phone') $('#sendotp').click();
  if (e.key === 'Enter' && e.target.id === 'pinin') $('#setpin').click();
});

render();
C.init().catch(err => { toast(C.errText(err), 5000); C.ready = true; render(); });
