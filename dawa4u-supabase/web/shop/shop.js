// =====================================================================
// dawa4u customer WEBSITE
// Pages: home · search · rx · cart · track · orders · account · login · location · join · about · help
// =====================================================================
import { auth, me, shop, rupee, esc, when, toast, CATS, RX_RULES, PAYS, payLabel, STATUS, LOGO, ICON, readImages } from '../common/api.js';
import { C } from '../common/customer.js';

const $ = s => document.querySelector(s);
const SUPPORT = (window.D4U_CONFIG || {}).SUPPORT_PHONE || '';
const APP_URL = (window.D4U_CONFIG || {}).APP_URL || '../app/';
const go = h => { location.hash = h; };
const busy = async (btn, fn) => { if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.innerHTML = 'Please wait…'; } try { return await fn(); } catch (e) { toast(C.errText(e), 3500); throw e; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.t; } } };
C._warn = m => toast(m);
$('#flogo').innerHTML = LOGO('#FAF7F2', '#C9A96E', 32) + '<span>dawa<span style="color:var(--gold)">4u</span></span>';
const route = () => { const [p, qs] = (location.hash.slice(1) || '/').split('?'); const parts = p.split('/').filter(Boolean); return { name: parts[0] || 'home', id: parts[1], q: new URLSearchParams(qs || '') }; };

function header() {
  const r = route(), n = C.count(), term = r.name === 'search' ? (r.q.get('q') || '') : '', a = C.address();
  const qi = $('#q'), keep = qi && document.activeElement === qi;
  if (keep) return; // don't steal focus while typing
  $('#hdr').innerHTML = `
    <a href="#/" class="logo" aria-label="dawa4u home">${LOGO()}<span>dawa<span style="color:var(--gold-d)">4u</span></span></a>
    <button class="loc hide-sm" data-go="#/location"><span style="font-size:11px;font-weight:700;color:var(--em)">${C.serviceable() ? 'DELIVERY IN 10–15 MIN' : 'DELIVER TO'}</span><span class="s13 b">${a ? esc(a.label) + ' · ' + esc(a.pin) : C.pin ? 'PIN ' + esc(C.pin) : 'Choose location'} ▾</span></button>
    <label class="searchbar">${ICON.search}<input id="q" placeholder="Search medicines, brands, health products" value="${esc(term)}" autocomplete="off"></label>
    <nav class="top">
      <a href="#/orders" class="${r.name === 'orders' || r.name === 'track' ? 'on' : ''}">Orders</a>
      ${C.user ? `<a href="#/account" class="${r.name === 'account' ? 'on' : ''}">Account</a>` : `<a href="#/login" class="${r.name === 'login' ? 'on' : ''}">Login</a>`}
      <a href="#/cart" class="cartbtn">${ICON.cart}Cart${n ? ' · ' + n : ''}</a>
    </nav>`;
}
const stepper = p => p.stock <= 0 && !C.qty(p.id) ? `<span class="oos">Out of stock</span>` : C.qty(p.id)
  ? `<div class="stepper"><button data-dec="${p.id}" aria-label="Decrease">−</button><span>${C.qty(p.id)}</span><button data-inc="${p.id}" aria-label="Increase">+</button></div>`
  : `<button class="add" data-inc="${p.id}">ADD</button>`;
const prodCard = p => `<div class="card prod"><div class="ph">${esc(p.name[0])}</div>
  ${p.rx ? '<span class="rxpill">Prescription needed</span>' : '<span style="height:21px"></span>'}
  <span class="b s15">${esc(p.name)}</span><span class="s13 mute">${esc(p.salt)} · ${esc(p.pack)}</span>
  <div class="row" style="justify-content:space-between;margin-top:auto"><span class="stack" style="gap:0"><span class="xb" style="font-size:17px">${rupee(p.price)}</span>${p.price < p.mrp ? `<s class="s12 mute">MRP ${rupee(p.mrp)}</s>` : ''}</span>${stepper(p)}</div></div>`;
const passPanel = (big = true) => C.hasPass()
  ? `<div style="background:var(--em);color:#fff;border-radius:${big ? 28 : 20}px;padding:${big ? 36 : 24}px;display:flex;flex-direction:column;gap:12px;justify-content:center;flex:1">
      <span class="s13 b" style="letter-spacing:.08em;color:var(--gold)">DAWAPASS · ACTIVE</span><span class="serif" style="font-size:26px">You save ${C.settings.pass_off}% on every order</span>
      <span class="s14" style="color:#CDE4D7">Free delivery and priority · till ${new Date(C.profile.pass_until).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span></div>`
  : `<div style="background:var(--em);color:#fff;border-radius:${big ? 28 : 20}px;padding:${big ? 36 : 24}px;display:flex;flex-direction:column;gap:14px;justify-content:space-between;flex:1">
      <div class="stack" style="gap:10px"><span class="s13 b" style="letter-spacing:.08em;color:var(--gold)">DAWAPASS</span><span style="font-size:44px;font-weight:800;letter-spacing:-.02em">${rupee(C.settings.pass_price)}<span style="font-size:18px;font-weight:600;opacity:.8">/month</span></span></div>
      <div class="stack s15" style="gap:10px"><span>✓ 15–20% off medicines</span><span>✓ Free delivery on every order</span><span>✓ Priority fulfilment</span></div>
      <button class="btn gold full" data-pass>${C.cart.buyPass ? 'Added to your cart ✓' : 'Join dawaPass'}</button></div>`;
const pageHead = (t, sub) => `<div class="stack" style="gap:6px"><h1 class="serif big" style="font-size:40px">${t}</h1>${sub ? `<span class="s15 mute">${sub}</span>` : ''}</div>`;
const pinBox = () => `<div class="card stack" style="padding:24px;gap:12px;max-width:560px"><span class="serif" style="font-size:22px">Where should we deliver?</span><span class="s14 mute">Enter your PIN code to see medicines and prices from the pharmacy nearest you.</span>
  <div class="row"><input id="pinin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN code" style="flex:1;font:inherit;font-size:16px;border:1px solid var(--line);border-radius:12px;padding:12px 14px"><button class="btn" id="setpin">Show medicines</button></div></div>`;
const needLogin = next => `<div class="wrap"><div class="card empty" style="margin-top:40px"><span class="serif" style="font-size:28px">Log in to continue</span><span class="mute">Use your mobile number — we will send you a one-time code.</span><a class="btn" href="#/login?next=${encodeURIComponent(next)}">Log in</a></div></div>`;

const pages = {
  home() {
    const o = C.liveOrder();
    const pop = (C.orders.length ? [...new Set(C.orders.flatMap(x => x.order_items.map(i => i.product_id)))] : ['p1', 'p31', 'p13', 'p36', 'p26']).map(id => C.byId[id]).filter(Boolean).slice(0, 5);
    return `
    ${C.settings.announcement ? `<div style="background:var(--mint)"><div class="wrap s14 b" style="padding-top:10px;padding-bottom:10px;color:var(--em-d)">${esc(C.settings.announcement)}</div></div>` : ''}
    ${o ? `<div style="background:#FEF3C7"><div class="wrap row" style="padding-top:12px;padding-bottom:12px;justify-content:space-between;flex-wrap:wrap"><span class="b s14" style="color:#92400E">Order ${o.id}: ${STATUS[o.status]} — arriving in <span data-clock="${o.id}">${C.track(o).clock}</span></span><a href="#/track/${o.id}" class="b s14">Track order →</a></div></div>` : ''}
    <section class="wrap" style="padding-top:48px;padding-bottom:48px;display:flex;flex-wrap:wrap;gap:32px;align-items:stretch">
      <div class="card lift hero-l" style="flex:999 1 520px;border-radius:28px;padding:48px;display:flex;flex-direction:column;gap:20px;justify-content:center">
        <span class="s13 b" style="letter-spacing:.08em;color:var(--em)">REGULATED APOTHECARY NETWORK</span>
        <h1 class="serif big" style="font-size:52px;line-height:1.05">Medicines at your door in <em style="color:var(--em)">15 minutes.</em></h1>
        <p style="margin:0;font-size:17px;line-height:1.6;max-width:520px" class="mute">Order from licensed partner pharmacies near you, in cities and villages. Every prescription is read by a licensed pharmacist.</p>
        <div class="row" style="flex-wrap:wrap"><a href="#/rx" class="btn">Upload prescription</a><a href="#/search" class="btn ghost">Browse medicines</a><a href="${esc(APP_URL)}" class="btn ghost">Get the app</a></div>
      </div>
      <div style="flex:1 1 320px;display:flex">${passPanel()}</div>
    </section>
    ${!C.pin ? `<section class="wrap" style="padding-bottom:40px">${pinBox()}</section>` : !C.serviceable() ? `<section class="wrap" style="padding-bottom:32px"><div class="warn">We don't deliver to PIN ${esc(C.pin)} yet — new pharmacies are joining every week. <a href="#/location">Try another PIN</a></div></section>` : ''}
    <section class="wrap stack" style="gap:20px;padding-bottom:48px">
      <h2 class="serif" style="font-size:28px">Shop by need</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px">${CATS.map(c => `<a class="catcard" href="#/search?cat=${c.id}"><span class="catmark">${c.mark}</span><span class="b s15">${c.label}</span></a>`).join('')}</div>
    </section>
    ${pop.length ? `<section class="wrap stack" style="gap:20px;padding-bottom:48px">
      <div class="row" style="justify-content:space-between"><h2 class="serif" style="font-size:28px">${C.orders.length ? 'Order again' : 'Popular near you'}</h2><a href="#/search" class="b">See all →</a></div>
      <div class="pgrid">${pop.map(prodCard).join('')}</div></section>` : ''}
    <section style="background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)"><div class="wrap stack" style="padding-top:56px;padding-bottom:56px;gap:28px">
      <h2 class="serif" style="font-size:28px">How dawa4u works</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px">${[
        ['1', 'Search or upload', 'Find medicines by name, or upload a photo of your prescription.'],
        ['2', 'Pharmacist checks', 'A licensed pharmacist reads your prescription and packs your order.'],
        ['3', 'Rider delivers', 'A local rider brings it to you in 10–15 minutes. Track it live.']
      ].map(([n, t, b]) => `<div class="stack" style="gap:10px;padding:24px;border-radius:20px;background:var(--ivory)"><span style="width:40px;height:40px;border-radius:20px;background:var(--em);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">${n}</span><span class="b" style="font-size:18px">${t}</span><span class="s14 mute" style="line-height:1.6">${b}</span></div>`).join('')}</div>
    </div></section>
    <section class="wrap" style="padding-top:48px;display:flex;flex-wrap:wrap;gap:20px">
      ${[['Own a pharmacy?', 'Get orders from customers near you. Works with your existing billing software.', 'Become a partner →', 'pharmacy'], ['Ride with dawa4u', 'Deliver medicines in your area and earn on every trip.', 'Join as a rider →', 'rider']].map(([t, b, l, as]) =>
        `<div class="card" style="flex:1 1 360px;border-radius:24px;padding:32px;display:flex;flex-direction:column;gap:12px"><span class="xb" style="font-size:22px">${t}</span><span class="s15 mute" style="line-height:1.6">${b}</span><a href="#/join?as=${as}" class="b s15">${l}</a></div>`).join('')}
    </section>`;
  },
  search(r) {
    const cat = r.q.get('cat') || '', term = (r.q.get('q') || '').toLowerCase(), c = CATS.find(x => x.id === cat);
    const res = C.catalog.filter(p => (!cat || p.category === cat) && (!term || (p.name + ' ' + p.salt).toLowerCase().includes(term)));
    const link = id => '#/search?' + new URLSearchParams({ ...(id ? { cat: id } : {}), ...(r.q.get('q') ? { q: r.q.get('q') } : {}) });
    return `<div class="wrap" style="padding-top:40px;display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start">
      <aside class="side card hide-sm" style="flex:0 0 220px;padding:10px;position:sticky;top:96px"><a href="${link('')}" class="${!cat ? 'on' : ''}">All medicines</a>${CATS.map(x => `<a href="${link(x.id)}" class="${cat === x.id ? 'on' : ''}">${x.label}</a>`).join('')}</aside>
      <div class="stack" style="flex:1 1 500px;gap:24px">
        ${pageHead(term ? `Results for “${esc(r.q.get('q'))}”` : c ? c.label : 'All medicines', C.pharmacyName ? `${res.length} product${res.length === 1 ? '' : 's'} · from ${esc(C.pharmacyName)}` : '')}
        ${!C.pin ? pinBox() : res.length ? `<div class="pgrid">${res.map(prodCard).join('')}</div>`
          : `<div class="card empty"><span class="b" style="font-size:18px">No medicines found</span><span class="mute">Upload your prescription and a pharmacist will find it for you.</span><a href="#/rx" class="btn">Upload prescription</a></div>`}
      </div></div>`;
  },
  rx() {
    if (!C.user) return needLogin('#/rx');
    const x = C.activeRx(), stage = !x ? 1 : x.status === 'done' ? 3 : 2, done = x && x.status === 'done', rej = x && x.status === 'rejected';
    return `<div class="wrap" style="padding-top:40px;display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start">
      <div class="stack" style="flex:3 1 520px;gap:24px">
        ${pageHead('Upload prescription', 'A licensed pharmacist reads it and adds your medicines — no guesswork.')}
        <div><div class="progress">${[1, 2, 3].map(i => `<span class="${i <= stage ? 'on' : ''}"></span>`).join('')}</div>
          <div class="row s13 b mute" style="justify-content:space-between;margin-top:8px"><span style="color:var(--em)">1 Upload</span><span style="${stage >= 2 ? 'color:var(--em)' : ''}">2 Pharmacist reads</span><span style="${stage >= 3 ? 'color:var(--em)' : ''}">3 Confirm &amp; pay</span></div></div>
        ${x && !rej ? `<div class="card row" style="padding:20px;align-items:flex-start;gap:14px"><span style="width:44px;height:44px;border-radius:22px;background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--em);flex-shrink:0">${done ? ICON.check : ICON.clock}</span>
            <span class="stack" style="gap:4px"><span class="b s15">${done ? 'Pharmacist added your medicines' : x.status === 'reading' ? 'A pharmacist is reading it now' : 'Waiting for a pharmacist'}</span><span class="s14 mute" style="line-height:1.6">${done ? `${x.items.length} medicine${x.items.length === 1 ? '' : 's'} added to your cart.${x.pharmacist_note ? ' Note: ' + esc(x.pharmacist_note) : ''}` : 'Usually about 3 minutes. Keep browsing — we will add the medicines to your cart.'}</span></span></div>
            ${done ? `<a href="#/cart" class="btn" style="align-self:flex-start">Go to cart</a>` : `<a href="#/search" class="btn ghost" style="align-self:flex-start">Keep shopping while you wait</a>`}`
        : `${rej ? `<div class="warn">The pharmacist could not use your last prescription: ${esc(x.pharmacist_note || 'unclear photo')}. Please upload a clearer photo.</div>` : ''}
          <div class="card stack" style="padding:24px"><span class="serif" style="font-size:20px">Your prescription</span>
          ${pending.length ? `<div class="row" style="flex-wrap:wrap;gap:12px">${pending.map((p, i) => `<div class="thumb" style="background-image:url(${p.preview})" aria-label="Page ${i + 1}"></div>`).join('')}${pending.length < 4 ? `<label class="drop">${ICON.plus}Add page<input type="file" accept="image/*" multiple hidden data-file></label>` : ''}</div>`
            : `<label class="drop big" id="dropzone">${ICON.img}<span class="s15">Drag your prescription photo here, or <u>choose a file</u></span><span class="s12 mute" style="font-weight:500">JPG or PNG · up to 4 pages</span><input type="file" accept="image/*" multiple hidden data-file></label>`}</div>
          <label class="field">Note for pharmacist (optional)<textarea id="note" placeholder="e.g. Need only 10 days of medicine"></textarea></label>
          <button class="btn" id="sendrx" style="align-self:flex-start" ${pending.length ? '' : 'disabled'}>Send to pharmacist</button>`}
      </div>
      <aside class="card stack" style="flex:1 1 300px;padding:24px;gap:12px"><span class="b s15">A valid prescription shows</span>${RX_RULES.map(t => `<div class="row s14" style="gap:10px"><span style="color:var(--em)">${ICON.check}</span>${t}</div>`).join('')}
        <div class="hr"></div><span class="s13 mute" style="line-height:1.6">Prescription medicines are dispensed only after a licensed pharmacist verifies your prescription.</span></aside>
    </div>`;
  },
  cart() {
    const L = C.lines(), b = C.bill();
    if (!L.length) return `<div class="wrap"><div class="empty"><span class="serif" style="font-size:32px">Your cart is empty</span><span class="mute">Search for medicines or upload a prescription.</span><div class="row"><a href="#/search" class="btn">Browse medicines</a><a href="#/rx" class="btn ghost">Upload prescription</a></div></div></div>`;
    const need = C.rxNeeded(), rxv = C.prescriptions.find(p => p.id === C.cart.rxId && p.status === 'done');
    return `<div class="wrap stack" style="padding-top:40px;gap:24px">
      <div class="row" style="flex-wrap:wrap;justify-content:space-between;align-items:flex-end">${pageHead('Your cart', `${C.count()} items · from ${esc(C.pharmacyName)} · arrives in about 15 minutes`)}
        ${rxv && !need.length ? `<span class="ok">${ICON.check} Prescription verified by pharmacist</span>` : ''}</div>
      ${need.length ? `<button class="warn" data-go="#/rx">⚠ ${need.map(l => esc(l.name)).join(', ')} need${need.length === 1 ? 's' : ''} a prescription. Upload it here — a pharmacist verifies it before you pay.</button>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
        <div class="stack" style="flex:3 1 560px;gap:20px;min-width:0">
          <section class="card" style="padding:8px 24px">${L.map((l, n) => `<div class="row" style="flex-wrap:wrap;gap:16px;padding:18px 0;${n < L.length - 1 ? 'border-bottom:1px solid rgba(6,78,59,.08)' : ''}">
            <div class="ph" style="width:72px;height:72px;font-size:24px;flex-shrink:0">${esc(l.name[0])}</div>
            <div class="stack" style="flex:1 1 220px;gap:3px;min-width:0"><span class="b" style="font-size:16px">${esc(l.name)}</span><span class="s13 mute">${esc(l.salt || '')}${l.rx ? ' · prescription medicine' : ''}</span><span class="s13 mute">${esc(l.pack)}</span></div>
            ${stepper(l)}<span class="b" style="width:96px;text-align:right;font-size:16px;font-variant-numeric:tabular-nums">${rupee(l.price * l.qty)}</span></div>`).join('')}</section>
          <section class="card stack" style="padding:24px;gap:14px">
            <div class="row" style="justify-content:space-between"><span class="serif" style="font-size:20px">Delivery address</span><a href="#/location" class="b s14">+ Add new</a></div>
            ${C.user ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">${C.addresses.map(a => `<label class="opt ${C.cart.addressId === a.id ? 'on' : ''}"><input type="radio" name="addr" value="${a.id}" ${C.cart.addressId === a.id ? 'checked' : ''}><span class="stack" style="gap:3px"><span class="b s15">${esc(a.label)}</span><span class="s13 mute" style="line-height:1.5">${esc(a.line)} · ${esc(a.pin)}</span></span></label>`).join('') || '<span class="mute s14">No address yet — add one.</span>'}</div>` : `<span class="mute s14"><a href="#/login?next=%23%2Fcart">Log in</a> to choose an address.</span>`}
          </section>
          <section class="card stack" style="padding:24px;gap:14px"><span class="serif" style="font-size:20px">Payment</span>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${PAYS.map(p => `<label class="opt ${C.cart.pay === p.id ? 'on' : ''}" style="align-items:center;font-size:14px;font-weight:700"><input type="radio" name="pay" value="${p.id}" ${C.cart.pay === p.id ? 'checked' : ''} style="margin:0">${p.label}</label>`).join('')}</div>
            <span class="s12 mute">Secure payments by Razorpay · UPI, cards and netbanking${C.settings.payments_test_mode ? ' · <b>test mode — no money moves</b>' : ''}</span></section>
        </div>
        <aside class="stack" style="flex:2 1 340px;gap:16px;position:sticky;top:96px">
          ${C.hasPass() ? `<span class="ok" style="border-radius:16px;padding:14px 18px">${ICON.check} dawaPass applied — ${C.settings.pass_off}% off and free delivery</span>`
            : `<div style="background:var(--em);color:#fff;border-radius:20px;padding:22px 24px;display:flex;gap:14px;align-items:center">
              <div class="stack" style="flex:1;gap:4px"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--gold)">DAWAPASS</span><span class="serif" style="font-size:20px">Save ${rupee(Math.round(b.sub * C.settings.pass_off / 100) + C.settings.delivery_fee)} on this order</span><span class="s13" style="color:#CDE4D7">15–20% off + free delivery · ${rupee(C.settings.pass_price)}/month</span></div>
              <button class="btn gold" data-pass style="height:44px;padding:0 18px;font-size:14px">${C.cart.buyPass ? 'Remove' : 'Add'}</button></div>`}
          <div class="card lift stack" style="padding:24px;gap:12px">
            <span class="serif" style="font-size:20px">Bill summary</span>
            <div class="billrow"><span class="mute">Item total (MRP)</span><span>${rupee(b.mrp)}</span></div>
            ${b.saved ? `<div class="billrow"><span class="mute">Pharmacy discount</span><span style="color:var(--em);font-weight:600">− ${rupee(b.saved)}</span></div>` : ''}
            <div class="billrow"><span class="mute">dawaPass discount</span><span style="color:var(--em);font-weight:600">− ${rupee(b.disc)}</span></div>
            <div class="billrow"><span class="mute">Delivery fee</span><span>${b.delivery ? rupee(b.delivery) : `<s class="mute">${rupee(C.settings.delivery_fee)}</s> FREE`}</span></div>
            <div class="billrow"><span class="mute">Handling</span><span>${rupee(b.handling)}</span></div>
            ${b.passFee ? `<div class="billrow"><span class="mute">dawaPass (1 month)</span><span>${rupee(b.passFee)}</span></div>` : ''}
            <div class="hr"></div>
            <div class="billrow" style="align-items:baseline"><span class="b" style="font-size:16px">To pay</span><span class="xb" style="font-size:24px;font-variant-numeric:tabular-nums">${rupee(b.total)}</span></div>
            <button class="btn full" id="pay" style="margin-top:6px;height:54px;font-size:16px" ${need.length ? 'disabled' : ''}>${need.length ? 'Prescription needed' : !C.user ? 'Log in to order' : !C.address() ? 'Add a delivery address' : (C.cart.pay === 'cod' ? 'Place order · ' : 'Pay ') + rupee(b.total)}</button>
            <span class="s12 mute" style="text-align:center">Medicines are sealed in a tamper-proof pouch</span>
          </div>
        </aside>
      </div></div>`;
  },
  track(r) {
    if (!C.user) return needLogin(location.hash);
    const o = C.orders.find(x => x.id === r.id);
    if (!o) return '<div class="spin"></div>';
    const t = C.track(o), k = t.idx < 2 ? 0 : t.delivered ? 1 : Math.min(0.92, t.pct / 100);
    const items = `<div class="card stack" style="padding:24px;gap:10px;flex:1 1 360px"><span class="serif" style="font-size:20px">Items</span>
        ${o.order_items.map(l => `<div class="billrow"><span>${l.qty} × ${esc(l.name)}</span><span>${rupee(l.price * l.qty)}</span></div>`).join('')}
        <div class="hr"></div>
        ${o.disc ? `<div class="billrow"><span class="mute">dawaPass discount</span><span style="color:var(--em)">− ${rupee(o.disc)}</span></div>` : ''}
        <div class="billrow"><span class="mute">Delivery + handling</span><span>${rupee(o.delivery + o.handling)}</span></div>
        ${o.pass_fee ? `<div class="billrow"><span class="mute">dawaPass</span><span>${rupee(o.pass_fee)}</span></div>` : ''}
        <div class="billrow b"><span>${o.pay_status === 'paid' ? 'Paid' : o.pay_method === 'cod' ? 'Pay cash to rider' : 'Total'} · ${payLabel(o.pay_method)}</span><span>${rupee(o.total)}</span></div>
        ${o.status === 'placed' || o.status === 'pending_payment' ? `<button class="btn ghost" id="cancelorder" data-id="${o.id}" style="align-self:flex-start;margin-top:8px">Cancel order</button>` : ''}</div>`;
    const head = pageHead('Order ' + o.id, `${when(o.created_at)} · to ${esc(o.address_label)}, ${esc(o.address_line)} · <span class="status ${o.status}">${STATUS[o.status]}</span>`);
    if (o.status === 'pending_payment' || o.status === 'cancelled') return `<div class="wrap stack" style="padding-top:40px;gap:24px">${head}
      <div class="${o.status === 'cancelled' ? 'warn' : 'card'}" style="padding:20px 24px">${o.status === 'cancelled' ? esc(o.cancel_reason || 'Cancelled') + (o.pay_status === 'refund_due' ? ' · Your refund is on its way (3–5 working days).' : '') : `Complete the payment to send this order to the pharmacy. <button class="btn" id="payagain" data-id="${o.id}" style="margin-left:12px">Pay ${rupee(o.total)}</button>`}</div>
      <div style="display:flex;flex-wrap:wrap;gap:24px">${items}</div></div>`;
    return `<div class="wrap stack" style="padding-top:40px;gap:24px">${head}
      <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:stretch">
        <div class="map" style="flex:3 1 520px">
          <div class="road" style="left:-5%;top:36%;width:110%;height:26px;transform:rotate(-6deg)"></div>
          <div class="road" style="left:52%;top:-10%;width:26px;height:120%;transform:rotate(6deg)"></div>
          <div class="road" style="left:8%;top:68%;width:90%;height:18px;transform:rotate(3deg)"></div>
          <div class="dot" style="left:14%;top:22%;width:44px;height:44px;background:var(--em);color:#fff">${ICON.plus}</div>
          <div class="dot" style="left:70%;top:70%;width:44px;height:44px;background:var(--ink)">${ICON.house}</div>
          ${t.delivered || !o.rider_id ? '' : `<div class="dot" style="left:${16 + k * 54}%;top:${26 + k * 44}%;width:48px;height:48px;background:var(--gold)">${ICON.bike}</div>`}
          <span class="card s13 b" style="position:absolute;left:16px;bottom:16px;padding:8px 14px;border-radius:12px">${esc(o.pharmacy_name)} → ${esc(o.address_label)}</span>
        </div>
        <div class="card lift stack" style="flex:2 1 360px;padding:28px;gap:22px">
          <div class="row" style="justify-content:space-between">
            <div class="stack" style="gap:2px"><span class="s14 mute b">${t.delivered ? 'Order' : 'Arriving in'}</span><span class="clock" style="${t.delivered ? 'color:var(--em);font-size:40px' : ''}">${t.delivered ? 'Delivered' : t.late ? 'Any minute' : t.clock}</span></div>
            <div class="ring" style="background:conic-gradient(${t.delivered ? 'var(--em)' : 'var(--amber)'} 0 ${t.delivered ? 100 : t.pct}%, #FEF3C7 0 100%)"><div><span style="font-size:18px;font-weight:800;color:var(--ink)">15</span>min</div></div>
          </div>
          <div>${t.steps.map((s, i) => `<div class="tl"><div class="rail"><span class="d" style="background:${s.state === 'done' ? 'var(--em)' : '#fff'};border-color:${s.state === 'next' ? '#D1D5DB' : 'var(--em)'}"></span><span class="l" style="background:${i === 3 ? 'transparent' : s.state === 'done' ? 'var(--em)' : 'var(--line)'}"></span></div>
            <div class="stack" style="gap:2px;padding-bottom:14px"><span class="b s15" style="color:${s.state === 'next' ? 'var(--mute)' : 'var(--ink)'}">${s.title}</span><span class="s13 mute">${esc(s.sub)}</span></div></div>`).join('')}</div>
          ${t.delivered ? '' : `<div class="row" style="border:1px solid var(--line);border-radius:16px;padding:14px">
            <div style="width:48px;height:48px;border-radius:24px;background:var(--sand);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--em)">${esc((o.rider_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2))}</div>
            <div class="stack" style="gap:2px;flex:1"><span class="serif" style="font-size:17px">${o.rider_name ? esc(o.rider_name) + ' · your rider' : 'Rider not assigned yet'}</span><span class="s13 mute">Delivery OTP: <strong id="otp" style="color:var(--ink);letter-spacing:.15em">${otpCache[o.id] || '····'}</strong></span></div>
            ${o.rider_phone ? `<a href="tel:${esc(o.rider_phone)}" class="btn soft" style="height:44px;padding:0 14px">${ICON.phone} ${esc(o.rider_phone)}</a>` : ''}</div>`}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:24px">${items}<div class="card stack" style="padding:24px;gap:10px;flex:1 1 300px"><span class="serif" style="font-size:20px">Need help?</span><span class="s14 mute">Wrong item, delay or refund — write to us and we'll sort it out.</span><a class="btn ghost" href="#/help?order=${o.id}" style="align-self:flex-start">Contact support</a></div></div>
    </div>`;
  },
  orders() {
    if (!C.user) return needLogin('#/orders');
    return `<div class="wrap stack" style="padding-top:40px;gap:24px">${pageHead('Your orders')}
      ${C.orders.length ? `<div class="stack" style="gap:12px;max-width:860px">${C.orders.map(o => { const t = C.track(o); return `<a href="#/track/${o.id}" class="card row" style="padding:20px 24px;text-decoration:none;color:inherit;flex-wrap:wrap;justify-content:space-between">
        <div class="stack" style="gap:4px;flex:1 1 300px"><span class="b s15">${o.id} · ${when(o.created_at)}</span><span class="s13 mute">${o.order_items.map(l => esc(l.name)).join(', ')}</span></div>
        <span class="status ${o.status}">${['placed', 'accepted', 'packed', 'picked'].includes(o.status) ? (t.late ? 'Arriving' : 'Arriving in ' + t.clock) : STATUS[o.status]}</span><span class="xb" style="font-size:17px;width:90px;text-align:right">${rupee(o.total)}</span></a>`; }).join('')}</div>`
        : `<div class="card empty"><span class="b" style="font-size:18px">No orders yet</span><a href="#/search" class="btn">Start shopping</a></div>`}</div>`;
  },
  account() {
    if (!C.user) return needLogin('#/account');
    const p = C.profile || {};
    return `<div class="wrap stack" style="padding-top:40px;gap:24px">${pageHead('Your account', esc(p.phone ? '+' + p.phone : p.email || ''))}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;align-items:start">
        <div style="display:flex">${passPanel(false)}</div>
        <div class="card stack" style="padding:24px;gap:12px"><span class="serif" style="font-size:20px">Your details</span>
          <label class="field">Name<input id="myname" value="${esc(p.name || '')}" placeholder="Your name"></label>
          <span class="serif" style="font-size:20px;margin-top:8px">Saved addresses</span>
          ${C.addresses.map(a => `<div class="stack" style="gap:2px"><span class="b s14">${esc(a.label)}${a.id === C.cart.addressId ? ' · default' : ''}</span><span class="s13 mute">${esc(a.line)} · ${esc(a.pin)}</span></div>`).join('') || '<span class="s14 mute">None yet</span>'}
          <a href="#/location" class="b s14">Manage addresses →</a></div>
        <div class="card stack" style="padding:24px;gap:12px"><span class="serif" style="font-size:20px">Orders &amp; help</span><span class="s14 mute">${C.orders.length} order${C.orders.length === 1 ? '' : 's'}</span><a href="#/orders" class="b s14">View orders →</a><a href="#/rx" class="b s14">Prescriptions →</a><a href="#/help" class="b s14">Help &amp; support →</a>
          <div class="hr"></div><button class="btn ghost" id="logout" style="align-self:flex-start">Log out</button></div>
      </div></div>`;
  },
  login(r) {
    const phone = r.q.get('phone');
    return `<div class="wrap" style="padding-top:56px;display:flex;justify-content:center"><div class="card lift stack" style="width:100%;max-width:440px;padding:40px;gap:20px">
      <span class="logo" style="font-size:26px">${LOGO()}<span>dawa<span style="color:var(--gold-d)">4u</span></span></span>
      ${phone ? `<h1 class="serif" style="font-size:28px">Enter the 6-digit code</h1><span class="s14 mute" style="margin-top:-12px">Sent by SMS to +91 ${esc(phone)} · <a href="#/login">Change</a></span>
        <div class="otp">${[0, 1, 2, 3, 4, 5].map(i => `<input inputmode="numeric" autocomplete="one-time-code" data-otp="${i}" aria-label="Digit ${i + 1}">`).join('')}</div>
        <button class="btn full" id="verify">Verify &amp; continue</button><button class="add" id="resend" style="align-self:center">Resend code</button>`
      : `<h1 class="serif" style="font-size:28px">Log in with your mobile number</h1>
        <label class="field">Mobile number<div class="row" style="gap:8px"><span class="b" style="padding:12px 14px;border:1px solid var(--line);border-radius:12px">+91</span><input id="phone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number" style="flex:1"></div></label>
        <button class="btn full" id="sendotp">Send OTP</button><span class="s12 mute">By continuing you agree to the Terms and Privacy policy.</span>`}
    </div></div>`;
  },
  location() {
    return `<div class="wrap stack" style="padding-top:40px;gap:24px;max-width:860px">${pageHead('Delivery address', 'Choose where your medicines should go.')}
      ${C.user ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">${C.addresses.map(a => `<label class="opt ${C.cart.addressId === a.id ? 'on' : ''}"><input type="radio" name="addr" value="${a.id}" ${C.cart.addressId === a.id ? 'checked' : ''}><span class="stack" style="gap:3px"><span class="b s15">${esc(a.label)}</span><span class="s13 mute">${esc(a.line)} · ${esc(a.pin)}</span></span></label>`).join('')}</div>
      <div class="card stack" style="padding:24px"><span class="serif" style="font-size:20px">Add a new address</span>
        <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px"><label class="field">Label<input id="alabel" placeholder="Home, Office…"></label><label class="field">Full address<input id="aline" placeholder="House no., street, area, landmark"></label><label class="field">PIN code<input id="apin" inputmode="numeric" maxlength="6"></label></div>
        <div class="row"><button class="btn" id="addaddr">Save address</button>${C.count() ? '<a href="#/cart" class="btn ghost">Back to cart</a>' : ''}</div></div>`
      : `${pinBox()}<a class="btn ghost" href="#/login?next=%23%2Flocation" style="align-self:flex-start">Log in to save addresses</a>`}</div>`;
  },
  join(r) {
    const ph = r.q.get('as') !== 'rider';
    return `<div class="wrap" style="padding-top:48px;display:flex;flex-wrap:wrap;gap:32px">
      <div class="stack" style="flex:1 1 360px;gap:16px">${pageHead(ph ? 'Partner with dawa4u' : 'Ride with dawa4u', ph ? 'Get orders from customers near you. Works with your existing billing software (Marg and others).' : 'Deliver medicines in your area and earn on every trip.')}
        ${(ph ? ['Orders from your neighbourhood, every day', 'Dashboard to read prescriptions and pack orders', 'Stock syncs with your billing / POS software', 'Weekly payouts to your bank account'] : ['Earn on every delivery', 'Short trips near your area', 'Log in with your mobile number — app in English and Hindi', 'Weekly payouts']).map(x => `<div class="row s15" style="gap:10px"><span style="color:var(--em)">${ICON.check}</span>${x}</div>`).join('')}
        <a href="${ph ? '../pharmacy/' : '../rider/'}" class="btn ghost" style="align-self:flex-start;margin-top:8px">${ph ? 'Already approved? Open the pharmacy dashboard' : 'Open the rider app'}</a></div>
      <div class="card lift stack" style="flex:1 1 360px;padding:32px;gap:14px" id="joinform">
        <span class="serif" style="font-size:22px">${ph ? 'Register your interest' : 'Sign up to ride'}</span>
        <label class="field">${ph ? 'Pharmacy name' : 'Full name'}<input id="j1"></label>
        <label class="field">Mobile number<input id="j2" inputmode="numeric" maxlength="10"></label>
        <label class="field">${ph ? 'Drug licence number' : 'Vehicle (e.g. bike)'}<input id="j3"></label>
        <label class="field">City<input id="j4"></label>
        <button class="btn full" id="joinbtn" data-as="${ph ? 'pharmacy' : 'rider'}">Submit</button>
        <span class="s12 mute">Our team will call you within 2 working days.</span></div></div>`;
  },
  about() { return `<div class="wrap stack" style="padding-top:48px;max-width:820px">${pageHead('About dawa4u')}<p class="s15 mute" style="line-height:1.8">dawa4u connects people in cities and villages across India with licensed partner pharmacies nearby, and a local rider delivers in 10–15 minutes. Every prescription is read by a licensed pharmacist. dawaPass members pay ${rupee(C.settings.pass_price)} a month for 15–20% off medicines, free delivery and priority fulfilment.</p><a href="#/" class="btn" style="align-self:flex-start">Start shopping</a></div>`; },
  help(r) {
    const oid = r.q.get('order') || '';
    return `<div class="wrap stack" style="padding-top:48px;max-width:860px">${pageHead('Help & support')}
      ${[['Where is my order?', 'Open Orders to see the live tracker and call your rider.'], ['My medicine needs a prescription', 'Upload a photo of it. A licensed pharmacist verifies it before you pay.'], ['How does dawaPass work?', `${rupee(C.settings.pass_price)}/month for 15–20% off, free delivery and priority fulfilment. It lasts 30 days.`], ['Refunds', 'If an order is cancelled after you paid online, the money goes back to your original payment method in 3–5 working days.']].map(([q, a]) => `<div class="card stack" style="padding:20px 24px;gap:6px"><span class="b s15">${q}</span><span class="s14 mute">${a}</span></div>`).join('')}
      ${SUPPORT ? `<span class="s15">Call us: <b>${esc(SUPPORT)}</b></span>` : ''}
      ${C.user ? `<div class="card stack" style="padding:24px"><span class="serif" style="font-size:20px">Write to us</span>
        <label class="field">Topic<input id="tsub" value="${oid ? 'Order ' + esc(oid) : ''}"></label><label class="field">Message<textarea id="tmsg"></textarea></label>
        <button class="btn" id="ticket" data-order="${esc(oid)}" style="align-self:flex-start">Send</button></div>
        ${tickets.map(t => `<div class="card stack" style="padding:16px 20px;gap:4px"><span class="b s14">${esc(t.subject)} · <span class="mute">${when(t.created_at)}</span></span><span class="s14 mute">${esc(t.message)}</span>${t.reply ? `<span class="s14" style="color:var(--em)"><b>dawa4u:</b> ${esc(t.reply)}</span>` : '<span class="s12 mute">We will reply soon</span>'}</div>`).join('')}`
      : `<a href="#/login?next=%23%2Fhelp" class="btn" style="align-self:flex-start">Log in to write to us</a>`}</div>`;
  }
};

// ------------------------------------------------ router
let pending = [], ticker, tickets = [];
const otpCache = {};
function render() {
  const r = route(); header();
  const v = $('#view');
  if (!C.ready) { v.innerHTML = '<div class="spin"></div>'; return; }
  v.innerHTML = (pages[r.name] || pages.home)(r);
  clearInterval(ticker);
  if (r.name === 'track') ticker = setInterval(() => { const y = scrollY; if (!document.activeElement.matches('input,textarea')) { v.innerHTML = pages.track(route()); scrollTo(0, y); } }, 1000);
  if (r.name === 'home' && v.querySelector('[data-clock]')) ticker = setInterval(() => v.querySelectorAll('[data-clock]').forEach(s => { const o = C.orders.find(x => x.id === s.dataset.clock); if (o) s.textContent = C.track(o).clock; }), 1000);
  if (r.name === 'track' && r.id && C.user && !otpCache[r.id]) shop.otp(r.id).then(x => { if (x) { otpCache[r.id] = x; const el = $('#otp'); if (el) el.textContent = x; } }).catch(() => {});
  if (r.name === 'help' && C.user) shop.tickets().then(t => { if (JSON.stringify(t) !== JSON.stringify(tickets)) { tickets = t; render(); } }).catch(() => {});
  const f = $('#phone') || $('[data-otp="0"]'); if (f) f.focus();
}
let lastName = '';
addEventListener('hashchange', () => { pending = []; const n = route().name; if (n !== lastName) scrollTo(0, 0); lastName = n; render(); });
C.on(() => {
  if (C.justVerified) { C.justVerified = null; toast('Pharmacist added your medicines to your cart'); }
  const a = document.activeElement;
  if (!a || !a.matches('input:not([type=checkbox]):not([type=radio]),textarea')) { const y = scrollY; render(); scrollTo(0, y); } else header();
});

// ------------------------------------------------ events
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-go],[data-inc],[data-dec],[data-pass],button[id]');
  if (!el) return;
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.inc) { const n = C.qty(el.dataset.inc); C.add(el.dataset.inc); if (!n && C.qty(el.dataset.inc)) toast('Added to cart'); return; }
  if (el.dataset.dec) return C.setQty(el.dataset.dec, C.qty(el.dataset.dec) - 1);
  if (el.hasAttribute('data-pass')) { C.togglePass(); return toast(C.cart.buyPass ? 'dawaPass added to your cart' : 'dawaPass removed'); }
  const q = route().q;
  switch (el.id) {
    case 'setpin': return busy(el, async () => { await C.setPin($('#pinin').value.trim()); toast(C.serviceable() ? 'Showing medicines from ' + C.pharmacyName : 'We do not deliver here yet'); }).catch(() => {});
    case 'sendrx': return busy(el, async () => { await C.sendRx(pending.map(p => p.blob), ($('#note') || {}).value); pending = []; toast('Sent to pharmacist'); render(); }).catch(() => {});
    case 'pay':
      if (!C.user) return go('#/login?next=' + encodeURIComponent('#/cart'));
      if (!C.address()) return go('#/location');
      return busy(el, async () => {
        try { const o = await C.checkout(); toast(o.pay_method === 'cod' ? 'Order placed' : 'Payment successful'); location.replace('#/track/' + o.id); }
        catch (err) { if (err.order) location.replace('#/track/' + err.order.id); throw err; }
      }).catch(() => {});
    case 'payagain': return busy(el, async () => { await C.payAgain(C.orders.find(x => x.id === el.dataset.id)); toast('Payment successful'); render(); }).catch(() => {});
    case 'cancelorder': if (!confirm('Cancel this order?')) return; return busy(el, async () => { await C.cancel(el.dataset.id); toast('Order cancelled'); render(); }).catch(() => {});
    case 'logout': await auth.signOut(); toast('Logged out'); return go('#/');
    case 'sendotp': { const p = $('#phone').value.replace(/\D/g, ''); return busy(el, async () => { await auth.sendOtp(p); go('#/login?' + new URLSearchParams({ phone: p, next: q.get('next') || '#/' })); }).catch(() => {}); }
    case 'resend': return busy(el, async () => { await auth.sendOtp(q.get('phone')); toast('New code sent'); }).catch(() => {});
    case 'verify': {
      const code = [...document.querySelectorAll('[data-otp]')].map(i => i.value).join('');
      if (code.length < 6) return toast('Enter all 6 digits');
      return busy(el, async () => { await auth.verifyOtp(q.get('phone'), code); await C.setUser(await auth.user()); toast('Logged in'); location.replace(q.get('next') || '#/'); }).catch(() => {});
    }
    case 'addaddr': return busy(el, async () => { await C.addAddress($('#alabel').value.trim(), $('#aline').value.trim(), $('#apin').value.trim()); toast('Address saved'); }).catch(() => {});
    case 'joinbtn': return busy(el, async () => {
      const name = $('#j1').value.trim(), phone = $('#j2').value.trim();
      if (!name || !/^[6-9]\d{9}$/.test(phone)) throw new Error('Enter your name and a valid mobile number');
      await shop.apply(el.dataset.as, name, phone, $('#j3').value.trim(), $('#j4').value.trim());
      $('#joinform').innerHTML = `<span style="color:var(--em)">${ICON.check}</span><span class="serif" style="font-size:22px">Thank you!</span><span class="s15 mute">We have your details. Our team will call you within 2 working days.</span><a href="#/" class="btn" style="align-self:flex-start">Back to home</a>`;
    }).catch(() => {});
    case 'ticket': return busy(el, async () => { const s = $('#tsub').value.trim(), m = $('#tmsg').value.trim(); if (!s || !m) throw new Error('Write a topic and message'); await shop.ticket(s, m, el.dataset.order || null); toast('Sent — we will reply soon'); tickets = await shop.tickets(); render(); }).catch(() => {});
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('[data-file]')) { pending = pending.concat(await readImages(t.files)).slice(0, 4); render(); }
  if (t.name === 'pay') { C.cart.pay = t.value; C.save(); render(); }
  if (t.name === 'addr') C.chooseAddress(t.value).catch(err => toast(C.errText(err)));
  if (t.id === 'myname' && t.value.trim()) me.setName(t.value.trim()).then(() => toast('Name saved')).catch(err => toast(C.errText(err)));
});
document.addEventListener('dragover', e => { const d = e.target.closest('#dropzone'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest('#dropzone'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', async e => { const d = e.target.closest('#dropzone'); if (d) { e.preventDefault(); pending = pending.concat(await readImages(e.dataTransfer.files)).slice(0, 4); render(); } });
let qT;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { clearTimeout(qT); qT = setTimeout(() => { const r = route(); const cat = r.name === 'search' ? r.q.get('cat') : null; const h = '#/search?' + new URLSearchParams({ ...(cat ? { cat } : {}), ...(t.value ? { q: t.value } : {}) }); if (r.name === 'search') { history.replaceState(null, '', h); $('#view').innerHTML = pages.search(route()); } else go(h); }, 250); }
  if (t.dataset.otp !== undefined) {
    const digits = t.value.replace(/\D/g, '');
    if (digits.length > 1) { [...document.querySelectorAll('[data-otp]')].forEach((inp, i) => { inp.value = digits[i] || ''; }); $('#verify').click(); return; }
    t.value = digits; if (digits) { const n = document.querySelector(`[data-otp="${+t.dataset.otp + 1}"]`); n ? n.focus() : $('#verify').click(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.target.dataset && e.target.dataset.otp !== undefined && e.key === 'Backspace' && !e.target.value) { const p = document.querySelector(`[data-otp="${+e.target.dataset.otp - 1}"]`); if (p) p.focus(); }
  if (e.key === 'Enter' && e.target.id === 'phone') $('#sendotp').click();
  if (e.key === 'Enter' && e.target.id === 'pinin') $('#setpin').click();
  if (e.key === 'Enter' && e.target.id === 'q') { clearTimeout(qT); go('#/search?q=' + encodeURIComponent(e.target.value)); }
});
lastName = route().name;
render();
C.init().catch(err => { toast(C.errText(err), 5000); C.ready = true; render(); });
