// =====================================================================
// dawa4u RIDER app (phone; English + हिंदी). Login by mobile OTP.
// Go online → accept a nearby order → pick up at pharmacy → enter customer's OTP → delivered.
// =====================================================================
import { auth, rider as api, rupee, esc, when, toast, ICON, LOGO, live, ding, installable, errText, store } from '../common/api.js';

import { makeMap, pinIcon, shareLocation, km } from '../common/map.js';
const $ = s => document.querySelector(s);
installable();
const T = {
  en: { login: 'Log in', mobile: 'Mobile number', send: 'Send OTP', code: 'Enter the 6-digit code', verify: 'Verify', online: 'You are online', offline: 'You are offline',
    goOnline: 'Go online to get orders', current: 'Current delivery', available: 'New orders near you', none: 'No orders right now. Stay online — we will ring when one comes.',
    accept: 'Accept order', pickup: 'Picked up from pharmacy', waitPack: 'Pharmacy is packing…', deliver: 'Delivered — enter OTP', otpAsk: 'Ask the customer for the 4-digit OTP',
    collect: 'Collect cash', paid: 'Already paid online', pickupAt: 'Pick up from', dropAt: 'Deliver to', call: 'Call', map: 'Map', items: 'items', earn: 'Earnings', home: 'Orders', me: 'Profile',
    today: 'Today', week: 'This week', trips: 'Trips', perTrip: 'per delivery', lang: 'Language', logout: 'Log out', release: 'Can\'t take it', name: 'Full name', vehicle: 'Vehicle (e.g. Bike MP09 AB 1234)',
    city: 'City', register: 'Register as rider', pending: 'Waiting for approval', pendingTxt: 'Thanks! dawa4u will verify your details and switch you on. Keep this app installed.', check: 'Check again',
    done: 'Delivered! Good job.', confirmCash: 'Did you collect', otpWrong: 'Wrong OTP' },
  hi: { login: 'लॉग इन', mobile: 'मोबाइल नंबर', send: 'OTP भेजें', code: '6 अंकों का कोड डालें', verify: 'जाँचें', online: 'आप ऑनलाइन हैं', offline: 'आप ऑफ़लाइन हैं',
    goOnline: 'ऑर्डर पाने के लिए ऑनलाइन हों', current: 'अभी की डिलीवरी', available: 'आपके पास नए ऑर्डर', none: 'अभी कोई ऑर्डर नहीं। ऑनलाइन रहें — ऑर्डर आने पर घंटी बजेगी।',
    accept: 'ऑर्डर लें', pickup: 'फार्मेसी से ले लिया', waitPack: 'फार्मेसी पैक कर रही है…', deliver: 'डिलीवर किया — OTP डालें', otpAsk: 'ग्राहक से 4 अंकों का OTP पूछें',
    collect: 'नकद लें', paid: 'ऑनलाइन भुगतान हो चुका', pickupAt: 'यहाँ से लें', dropAt: 'यहाँ पहुँचाएँ', call: 'कॉल', map: 'नक्शा', items: 'सामान', earn: 'कमाई', home: 'ऑर्डर', me: 'प्रोफ़ाइल',
    today: 'आज', week: 'इस हफ़्ते', trips: 'डिलीवरी', perTrip: 'प्रति डिलीवरी', lang: 'भाषा', logout: 'लॉग आउट', release: 'नहीं ले सकता', name: 'पूरा नाम', vehicle: 'वाहन (जैसे बाइक MP09 AB 1234)',
    city: 'शहर', register: 'राइडर के रूप में जुड़ें', pending: 'मंज़ूरी का इंतज़ार', pendingTxt: 'धन्यवाद! dawa4u आपकी जानकारी जाँचकर आपको चालू करेगा। ऐप इंस्टॉल रखें।', check: 'फिर से देखें',
    done: 'डिलीवर हो गया! शाबाश।', confirmCash: 'क्या आपने नकद लिया', otpWrong: 'गलत OTP' }
};
const S = { user: null, r: null, cur: [], avail: [], trips: [], tab: 'home', lang: store.get('riderLang', 'en'), seen: new Set(), phone: '' };
const t = k => (T[S.lang] || T.en)[k] || T.en[k];
const maps = (q, lat, lng) => lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler` : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
let gpsStop = null, myPos = null, gpsErr = '';
// Share GPS while online (customers see the rider only while carrying their order)
function syncGps() {
  const want = S.r && S.r.status === 'active' && (S.r.online || S.cur.length);
  if (want && !gpsStop) {
    gpsStop = shareLocation(e => { gpsErr = e.message; const b = document.getElementById('gpswarn'); if (b) { b.textContent = '⚠ ' + gpsErr; b.style.display = 'block'; } });
    try { navigator.geolocation.watchPosition(p => { myPos = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { enableHighAccuracy: true }); } catch {}
  }
  if (!want && gpsStop) { gpsStop(); gpsStop = null; }
}
async function jobMap(o) {
  const el = document.getElementById('jobmap'); if (!el) return;
  try {
    const { L, map } = await makeMap(el, { zoom: 14 });
    const pts = [];
    if (o.pickup_lat != null) { L.marker([o.pickup_lat, o.pickup_lng], { icon: pinIcon(L, 'pharmacy') }).addTo(map); pts.push([o.pickup_lat, o.pickup_lng]); }
    if (o.drop_lat != null) { L.marker([o.drop_lat, o.drop_lng], { icon: pinIcon(L, 'home') }).addTo(map); pts.push([o.drop_lat, o.drop_lng]); }
    if (myPos) { L.marker([myPos.lat, myPos.lng], { icon: pinIcon(L, 'rider') }).addTo(map); pts.push([myPos.lat, myPos.lng]); }
    if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 }); else if (pts.length) map.setView(pts[0], 15); else el.style.display = 'none';
  } catch { el.style.display = 'none'; }
}

async function boot() {
  $('#app').innerHTML = '<div class="spin"></div>';
  S.user = await auth.user();
  if (!S.user) return loginScreen();
  S.r = await api.mine();
  if (S.r) { S.lang = S.r.lang; store.set('riderLang', S.lang); }
  if (!S.r) return registerScreen();
  if (S.r.status !== 'active') return waitScreen();
  await refresh(true);
  live('orders', () => refresh(), { poll: 7000 });
  render();
}
async function refresh(first) {
  try {
    const [cur, avail] = await Promise.all([api.current(), S.r.online ? api.available() : Promise.resolve([])]);
    const fresh = avail.filter(o => !S.seen.has(o.id));
    if (!first && fresh.length && S.r.online && !cur.length) { ding(); toast(t('available')); }
    avail.forEach(o => S.seen.add(o.id));
    const changed = JSON.stringify([cur, avail].map(l => l.map(o => o.id + o.status))) !== JSON.stringify([S.cur, S.avail].map(l => l.map(o => o.id + o.status)));
    S.cur = cur; S.avail = avail;
    if (!first && changed && !(document.activeElement && document.activeElement.matches('input'))) render();
  } catch (e) { if (first) throw e; }
}

function frame(body, title) {
  $('#app').innerHTML = `<header class="rtop"><span class="logo" style="color:var(--ink);font-size:19px">${LOGO('#FFFBEA', '#E5CD82', 24)}<span>dawa<span style="color:var(--gold)">4u</span></span><span class="s12" style="opacity:.8;margin-left:6px;letter-spacing:0">Rider</span></span>
    ${title || ''}</header><main class="rmain">${body}</main>
    ${S.r && S.r.status === 'active' ? `<nav class="rtabs">${[['home', ICON.orders, t('home')], ['earn', ICON.rupee, t('earn')], ['me', ICON.user, t('me')]].map(([id, ic, l]) => `<button class="${S.tab === id ? 'on' : ''}" data-tab="${id}">${ic}<span>${l}</span></button>`).join('')}</nav>` : ''}`;
}
function loginScreen() {
  frame(`<div class="stack" style="padding:28px 20px;gap:18px">
    <div class="row" style="justify-content:flex-end"><button class="pill grey" data-lang="${S.lang === 'en' ? 'hi' : 'en'}">${S.lang === 'en' ? 'हिंदी' : 'English'}</button></div>
    ${!S.phone ? `<h1 class="serif" style="margin:0;font-size:26px;font-weight:600">${t('login')}</h1>
      <label class="field">${t('mobile')}<div class="row" style="gap:8px"><span class="b" style="padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--card)">+91</span><input id="ph" type="tel" inputmode="numeric" maxlength="10" class="inp" style="flex:1;font-size:18px"></div></label>
      <button class="btn lg" id="send">${t('send')}</button>`
    : `<h1 class="serif" style="margin:0;font-size:26px;font-weight:600">${t('code')}</h1><span class="mute">+91 ${esc(S.phone)} · <a href="#" id="chg">✎</a></span>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="inp" style="font-size:28px;letter-spacing:.4em;text-align:center;font-weight:800">
      <button class="btn lg" id="ver">${t('verify')}</button>`}</div>`);
  ($('#ph') || $('#code')).focus();
}
function registerScreen() {
  frame(`<div class="stack" style="padding:24px 20px">
    <h1 class="serif" style="margin:0;font-size:24px;font-weight:600">${t('register')}</h1>
    <label class="field">${t('name')}<input id="rn" class="inp"></label><label class="field">${t('vehicle')}<input id="rv" class="inp"></label><label class="field">${t('city')}<input id="rc" class="inp"></label>
    <button class="btn lg" id="reg">${t('register')}</button><button class="s13 mute" id="out">${t('logout')}</button></div>`);
}
function waitScreen() {
  frame(`<div class="stack" style="padding:32px 20px;align-items:flex-start"><span style="color:var(--em-text)">${ICON.clock}</span><h1 class="serif" style="margin:0;font-size:24px;font-weight:600">${t('pending')}</h1><span class="mute" style="line-height:1.6">${t('pendingTxt')}</span>
    <button class="btn" id="again">${t('check')}</button><button class="s13 mute" id="out">${t('logout')}</button></div>`);
}

const jobCard = o => {
  const step = o.status === 'picked' ? 'deliver' : o.status === 'packed' ? 'pickup' : 'wait';
  return `<div class="card stack" style="padding:18px;gap:14px;border:2px solid var(--em-text)">
    <div class="row between"><span class="b s15">${o.id}</span><span class="pill ${o.pay_method === 'cod' ? 'warn' : ''}">${o.pay_method === 'cod' ? t('collect') + ' ' + rupee(o.total) : t('paid')}</span></div>
    ${o.pickup_lat != null || o.drop_lat != null ? '<div id="jobmap" style="height:200px;border-radius:12px;overflow:hidden;background:var(--sand)"></div>' : ''}
    <div class="leg ${o.status === 'picked' ? 'done' : ''}"><span class="s11 b mute">${t('pickupAt')}</span><b>${esc(o.pharmacy_name)}</b><span class="s13 mute">${esc(o.pharmacy_address)}</span>
      ${o.status !== 'picked' ? `<a class="btn sm ghost" href="${maps(o.pharmacy_name + ' ' + o.pharmacy_address, o.pickup_lat, o.pickup_lng)}" target="_blank" rel="noopener">${ICON.pin} ${t('map')}</a>` : ''}</div>
    <div class="leg"><span class="s11 b mute">${t('dropAt')}</span><b>${esc(o.customer_name || 'Customer')} · ${esc(o.address_label)}</b><span class="s13 mute">${esc(o.address_line)} · ${esc(o.pin)}</span>
      <div class="row"><a class="btn sm ghost" href="tel:+${esc(o.customer_phone)}">${ICON.phone} ${t('call')}</a><a class="btn sm ghost" href="${maps(o.address_line + ' ' + o.pin, o.drop_lat, o.drop_lng)}" target="_blank" rel="noopener">${ICON.pin} ${t('map')}</a></div></div>
    <details><summary class="s13 b">${o.order_items.reduce((a, i) => a + i.qty, 0)} ${t('items')}</summary><div class="s13" style="margin-top:6px">${o.order_items.map(i => `${i.qty} × ${esc(i.name)}`).join('<br>')}</div></details>
    ${step === 'wait' ? `<button class="btn lg" disabled>${t('waitPack')}</button>` : step === 'pickup' ? `<button class="btn lg" data-do="pickup" data-id="${o.id}">${t('pickup')}</button>`
      : `<span class="s13 b">${t('otpAsk')}</span><input id="otp" inputmode="numeric" maxlength="4" class="inp" style="font-size:28px;letter-spacing:.5em;text-align:center;font-weight:800"><button class="btn lg" data-do="deliver" data-id="${o.id}" data-cod="${o.pay_method === 'cod' ? o.total : ''}">${t('deliver')}</button>`}
    ${o.status !== 'picked' ? `<button class="s13 mute" data-do="release" data-id="${o.id}">${t('release')}</button>` : ''}
  </div>`;
};
function render() {
  if (S.tab === 'home') {
    frame(`<div class="stack" style="padding:16px">
      <div id="gpswarn" class="pill warn" style="display:${gpsErr ? 'block' : 'none'};white-space:normal;font-size:13px;padding:10px 12px">⚠ ${esc(gpsErr)}</div>
      <div class="card row" style="padding:16px"><div class="stack grow" style="gap:2px"><b class="s15">${S.r.online ? t('online') : t('offline')}</b><span class="s12 mute">${esc(S.r.city)}</span></div><button class="switch ${S.r.online ? 'on' : ''}" id="online" aria-label="Online"></button></div>
      ${S.cur.length ? `<span class="b">${t('current')}</span>${S.cur.map(jobCard).join('')}` : ''}
      ${!S.cur.length ? (S.r.online ? `<span class="b">${t('available')}</span>${S.avail.map(o => `<div class="card stack" style="padding:16px;gap:8px">
          <div class="row between"><b>${esc(o.pharmacy_name)}</b><span class="pill gold">+ ${rupee(o.rider_pay)}</span></div>
          <span class="s13 mute">→ ${esc(o.address_line)} · ${esc(o.pin)}${myPos && o.pickup_lat != null ? ' · pharmacy ' + km(myPos, { lat: o.pickup_lat, lng: o.pickup_lng }).toFixed(1) + ' km away' : ''}</span>
          <span class="s12">${o.order_items.reduce((a, i) => a + i.qty, 0)} ${t('items')} · ${o.pay_method === 'cod' ? t('collect') + ' ' + rupee(o.total) : t('paid')} · ${o.status === 'packed' ? '✓ packed' : t('waitPack')}</span>
          <button class="btn" data-do="accept" data-id="${o.id}">${t('accept')}</button></div>`).join('') || `<div class="card empty">${t('none')}</div>`}`
        : `<div class="card empty">${t('goOnline')}</div>`) : ''}
    </div>`);
    syncGps();
    if (S.cur[0]) jobMap(S.cur[0]);
  } else if (S.tab === 'earn') {
    frame('<div class="spin"></div>');
    const wk = new Date(Date.now() - 6 * 864e5); wk.setHours(0, 0, 0, 0);
    api.trips(wk.toISOString()).then(tr => {
      const day = new Date(); day.setHours(0, 0, 0, 0);
      const td = tr.filter(o => new Date(o.delivered_at) >= day), sum = l => l.reduce((a, o) => a + o.rider_pay, 0);
      frame(`<div class="stack" style="padding:16px">
        <div class="row" style="gap:12px"><div class="card tile grow"><span class="k">${t('today')}</span><span class="v">${rupee(sum(td))}</span><span class="s12 mute">${td.length} ${t('trips')}</span></div>
          <div class="card tile grow"><span class="k">${t('week')}</span><span class="v">${rupee(sum(tr))}</span><span class="s12 mute">${tr.length} ${t('trips')}</span></div></div>
        <div class="card">${tr.map(o => `<div class="row between" style="padding:12px 16px;border-bottom:1px solid var(--line)"><span class="stack" style="gap:2px"><b class="s13">${o.id}</b><span class="s12 mute">${when(o.delivered_at)}</span></span><span class="stack" style="gap:2px;align-items:flex-end"><b>${rupee(o.rider_pay)}</b>${o.rider_paid ? '<span class="pill">paid</span>' : '<span class="pill grey">due</span>'}</span></div>`).join('') || `<div class="empty">—</div>`}</div></div>`);
    }).catch(e => toast(errText(e)));
  } else {
    frame(`<div class="stack" style="padding:16px">
      <div class="card stack" style="padding:18px;gap:6px"><b class="s18">${esc(S.r.name)}</b><span class="mute">+${esc(S.user.phone || '')}</span><span class="s13">${esc(S.r.vehicle)} · ${esc(S.r.city)}</span></div>
      <div class="card row between" style="padding:16px"><b>${t('lang')}</b><div class="row" style="gap:6px"><button class="pill ${S.lang === 'en' ? '' : 'grey'}" data-lang="en">English</button><button class="pill ${S.lang === 'hi' ? '' : 'grey'}" data-lang="hi">हिंदी</button></div></div>
      <button class="btn ghost" id="out">${t('logout')}</button></div>`);
  }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('button,a#chg'); if (!el) return;
  const run = fn => { el.disabled = true; Promise.resolve(fn()).catch(err => toast(errText(err), 3500)).finally(() => { if (el.isConnected) el.disabled = false; }); };
  if (el.dataset.tab) { S.tab = el.dataset.tab; return render(); }
  if (el.dataset.lang) { S.lang = el.dataset.lang; store.set('riderLang', S.lang); if (S.r) { api.update({ lang: S.lang }).catch(() => {}); S.r.lang = S.lang; return render(); } return S.user ? registerScreen() : loginScreen(); }
  if (el.id === 'chg') { e.preventDefault(); S.phone = ''; return loginScreen(); }
  if (el.id === 'send') return run(async () => { const p = $('#ph').value.replace(/\D/g, ''); await auth.sendOtp(p); S.phone = p; loginScreen(); });
  if (el.id === 'ver') return run(async () => { await auth.verifyOtp(S.phone, $('#code').value.trim()); boot(); });
  if (el.id === 'reg') return run(async () => { const n = $('#rn').value.trim(), v = $('#rv').value.trim(), c = $('#rc').value.trim(); if (!n || !c) throw new Error(t('name') + ' / ' + t('city')); S.r = await api.register(n, v, c); await api.update({ lang: S.lang }); boot(); });
  if (el.id === 'again') return boot();
  if (el.id === 'out') { await auth.signOut(); S.user = null; S.r = null; S.phone = ''; S.tab = 'home'; return boot(); }
  if (el.id === 'online') return run(async () => { await api.update({ online: !S.r.online }); S.r.online = !S.r.online; await refresh(); render(); });
  if (el.dataset.do) {
    const { do: act, id, cod } = el.dataset;
    if (act === 'deliver') {
      const otp = ($('#otp').value || '').trim(); if (otp.length !== 4) return toast(t('otpAsk'));
      if (cod && !confirm(`${t('confirmCash')} ${rupee(cod)}?`)) return;
      return run(async () => { await api.action(id, 'deliver', otp); toast(t('done')); await refresh(); render(); });
    }
    if (act === 'release' && !confirm(t('release') + '?')) return;
    return run(async () => { await api.action(id, act); await refresh(); render(); if (act === 'accept') try { navigator.vibrate(100); } catch {} });
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.target.id === 'ph') $('#send').click(); if (e.target.id === 'code') $('#ver').click(); } });
document.addEventListener('input', e => { if (e.target.id === 'code' && e.target.value.replace(/\D/g, '').length === 6) $('#ver').click(); });

boot().catch(e => { $('#app').innerHTML = `<div class="empty"><b>${esc(errText(e))}</b><button class="btn" onclick="location.reload()">Retry</button></div>`; });
