// =====================================================================
// dawa4u PHARMACY dashboard (desktop/tablet; installable)
// Orders board · Prescriptions (pharmacist reads + adds medicines) · Stock · Sales · POS link · Settings
// =====================================================================
import { auth, me, pharmacy as api, rx as rxApi, rupee, esc, when, timeAgo, toast, ICON, CATS, STATUS, payLabel, live, ding, installable, errText } from '../common/api.js';
import { $, $$, busy, authScreen, shell, copy, toCsv, download } from '../common/partner.js';
import { locationPicker } from '../common/map.js';

const root = $('#root');
const S = { user: null, ph: null, products: [], inv: {}, orders: [], rxq: [], rxDone: [], seen: new Set(), firstLoad: true, stockFilter: '', stockCat: '' };
const FN_URL = () => ((window.D4U_CONFIG || {}).SUPABASE_URL || '') + '/functions/v1/pos-sync';
installable();

async function boot() {
  root.innerHTML = '<div class="spin"></div>';
  S.user = await auth.user();
  if (!S.user) return authScreen(root, { title: 'Pharmacy login', subtitle: 'For dawa4u partner pharmacies', allowSignup: true, onDone: boot });
  S.ph = await api.mine();
  if (!S.ph) return registerScreen();
  if (S.ph.status !== 'active') return waitScreen();
  [S.products, S.orders, S.rxq] = await Promise.all([api.products(), api.orders(S.ph.id, ['placed', 'accepted', 'packed', 'picked']), api.rxQueue()]);
  await loadInv();
  S.orders.forEach(o => S.seen.add(o.id)); S.rxq.forEach(r => S.seen.add(r.id));
  live('orders', refreshOrders, { filter: 'pharmacy_id=eq.' + S.ph.id, poll: 8000 });
  live('prescriptions', refreshRx, { poll: 8000 });
  addEventListener('hashchange', render);
  render();
}
async function loadInv() { S.inv = Object.fromEntries((await api.inventory(S.ph.id)).map(i => [i.product_id, i])); }
async function refreshOrders() {
  const o = await api.orders(S.ph.id, ['placed', 'accepted', 'packed', 'picked']).catch(() => null); if (!o) return;
  const fresh = o.filter(x => x.status === 'placed' && !S.seen.has(x.id));
  if (fresh.length) { ding(); toast(`New order ${fresh[0].id} · ${rupee(fresh[0].total)}`); fresh.forEach(x => S.seen.add(x.id)); notify('New dawa4u order', `${fresh[0].id} · ${rupee(fresh[0].total)}`); }
  const changed = JSON.stringify(o.map(x => x.id + x.status + x.rider_id)) !== JSON.stringify(S.orders.map(x => x.id + x.status + x.rider_id));
  S.orders = o; if (changed && !typing()) render();
}
async function refreshRx() {
  const q = await api.rxQueue().catch(() => null); if (!q) return;
  const fresh = q.filter(r => r.status === 'pending' && !S.seen.has(r.id));
  if (fresh.length) { ding(); toast('New prescription to read'); fresh.forEach(r => S.seen.add(r.id)); notify('New prescription', 'A customer is waiting for a pharmacist'); }
  const changed = JSON.stringify(q.map(r => r.id + r.status)) !== JSON.stringify(S.rxq.map(r => r.id + r.status));
  S.rxq = q; if (changed && !typing() && !location.hash.startsWith('#/rx/')) render();
}
const typing = () => document.activeElement && document.activeElement.matches('input,textarea,select');
function notify(t, b) { try { if (Notification.permission === 'granted' && document.hidden) new Notification(t, { body: b, icon: '../common/icon-192.png' }); } catch {} }

// ------------------------------------------------ onboarding
function registerScreen() {
  root.innerHTML = `<div class="auth"><div class="card" style="max-width:560px">
    <h1 class="serif" style="margin:0;font-size:26px;font-weight:600">Register your pharmacy</h1>
    <span class="mute">dawa4u will check your drug licence and approve your shop, usually within 2 working days.</span>
    <label class="field">Pharmacy name<input id="r-name"></label>
    <label class="field">Drug licence number<input id="r-lic" placeholder="e.g. 20B / 21B number"></label>
    <div class="row"><label class="field grow">Phone<input id="r-phone" inputmode="numeric" maxlength="10"></label><label class="field grow">City<input id="r-city"></label></div>
    <label class="field">Shop address<input id="r-addr"></label>
    <label class="field">PIN codes you deliver to<input id="r-pins" placeholder="452001, 452010"></label>
    <button class="btn lg" id="r-go">Submit for approval</button>
    <a href="#" id="r-out" class="s13">Log out</a></div></div>`;
  $('#r-out').onclick = async e => { e.preventDefault(); await auth.signOut(); boot(); };
  $('#r-go').onclick = e => busy(e.currentTarget, async () => {
    await api.register({ name: $('#r-name').value, licence: $('#r-lic').value, phone: $('#r-phone').value, address: $('#r-addr').value, city: $('#r-city').value, pins: $('#r-pins').value.split(/[\s,]+/).filter(Boolean) });
    toast('Submitted! We will review it soon.'); boot();
  });
}
function waitScreen() {
  root.innerHTML = `<div class="auth"><div class="card"><span style="color:var(--em)">${ICON.clock}</span>
    <h1 class="serif" style="margin:0;font-size:24px;font-weight:600">${S.ph.status === 'pending' ? 'Waiting for approval' : 'Account paused'}</h1>
    <span class="mute">${S.ph.status === 'pending' ? `Thanks for registering <b>${esc(S.ph.name)}</b>. Our team will verify licence ${esc(S.ph.licence_no)} and switch you on.` : 'Your pharmacy is paused. Please contact dawa4u support.'}</span>
    <button class="btn ghost" id="w-re">Check again</button><a href="#" id="w-out" class="s13">Log out</a></div></div>`;
  $('#w-re').onclick = boot; $('#w-out').onclick = async e => { e.preventDefault(); await auth.signOut(); boot(); };
}

// ------------------------------------------------ pages
const orderCard = o => {
  const next = { placed: ['accept', 'Accept order'], accepted: ['pack', 'Mark packed'] }[o.status];
  return `<div class="card ocard ${o.status === 'placed' ? 'new' : ''}">
    <div class="row between"><span class="b s15">${o.id}</span><span class="pill ${o.status === 'placed' ? 'warn' : ''}">${STATUS[o.status]}</span></div>
    <span class="s12 mute">${timeAgo(o.placed_at || o.created_at)} · ${esc(o.customer_name || 'Customer')} · ${esc(o.pin)}${o.prescription_id ? ' · <b>Rx verified</b>' : ''}</span>
    <div class="stack" style="gap:4px">${o.order_items.map(i => `<div class="row between"><span><b>${i.qty} ×</b> ${esc(i.name)} <span class="mute s12">${esc(i.pack)}</span>${i.rx ? ' <span class="pill gold">Rx</span>' : ''}</span><span>${rupee(i.price * i.qty)}</span></div>`).join('')}</div>
    <div class="row between"><span class="s13">${payLabel(o.pay_method)} · <b>${rupee(o.total)}</b>${o.pay_method === 'cod' ? ' <span class="pill warn">Cash</span>' : ''}</span>
      <span class="s12 mute">${o.rider_name ? 'Rider: ' + esc(o.rider_name) : o.status === 'picked' ? '' : 'Rider not assigned yet'}</span></div>
    ${next || o.status !== 'picked' ? `<div class="row">${next ? `<button class="btn sm" data-act="${next[0]}" data-id="${o.id}">${next[1]}</button>` : ''}${['placed', 'accepted', 'packed'].includes(o.status) ? `<button class="btn sm danger" data-act="cancel" data-id="${o.id}">Can't fulfil</button>` : ''}${o.prescription_id ? `<a class="btn sm ghost" href="#/rx/${o.prescription_id}">View prescription</a>` : ''}</div>` : ''}
  </div>`;
};
const pages = {
  orders() {
    const col = (title, list, hint) => `<div class="stack" style="gap:12px"><div class="row between"><span class="b s15">${title}</span><span class="pill grey">${list.length}</span></div>${list.map(orderCard).join('') || `<div class="card empty s13">${hint}</div>`}</div>`;
    const by = s => S.orders.filter(o => s.includes(o.status));
    return `${S.ph.lat == null ? `<a href="#/settings" class="card pad row" style="text-decoration:none;color:inherit;border-color:var(--gold)"><span style="color:var(--gold-d)">${ICON.pin}</span><b>Set your shop location on the map</b><span class="mute s13">so riders can find you</span><span class="btn sm gold" style="margin-left:auto">Set pin</span></a>` : ''}${!S.ph.open ? `<div class="card pad row" style="background:#FEF3C7;border-color:#FDE68A"><b>Your shop is closed</b><span class="mute">Customers can't order from you.</span><button class="btn sm" id="openshop" style="margin-left:auto">Open shop</button></div>` : ''}
      ${S.rxq.filter(r => r.status === 'pending').length ? `<a href="#/rx" class="card pad row" style="text-decoration:none;color:inherit;border-color:var(--gold)"><span style="color:var(--gold-d)">${ICON.rx}</span><b>${S.rxq.filter(r => r.status === 'pending').length} prescription(s) waiting to be read</b><span class="btn sm gold" style="margin-left:auto">Read now</span></a>` : ''}
      <div class="cols">${col('New', by(['placed']), 'New orders appear here with a sound.')}${col('Packing', by(['accepted']), 'Accepted orders you are packing.')}${col('Ready for rider', by(['packed']), 'Packed orders waiting for pickup.')}${col('Out for delivery', by(['picked']), 'Picked up by the rider.')}</div>`;
  },
  rx(id) {
    if (id) return rxDetail(id);
    const list = S.rxq;
    return `<div class="card"><table><thead><tr><th>Received</th><th>PIN</th><th>Pages</th><th>Customer note</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(r => `<tr><td>${timeAgo(r.created_at)}</td><td>${esc(r.pin)}</td><td>${r.photos.length}</td><td>${esc(r.note) || '<span class="mute">—</span>'}</td>
        <td>${r.status === 'pending' ? '<span class="pill warn">Waiting</span>' : '<span class="pill">You are reading</span>'}</td>
        <td style="text-align:right"><button class="btn sm" data-openrx="${r.id}">${r.status === 'pending' ? 'Open & read' : 'Continue'}</button></td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">No prescriptions waiting. New ones ring like orders.</div></td></tr>`}
      </tbody></table></div>
      <details class="card pad" id="rxdone"><summary class="b" style="cursor:pointer">Recently finished</summary><div id="rxdonelist" class="stack" style="margin-top:12px">Loading…</div></details>`;
  },
  stock() {
    const f = S.stockFilter.toLowerCase();
    const rows = S.products.filter(p => (!S.stockCat || p.category === S.stockCat) && (!f || (p.name + p.salt).toLowerCase().includes(f)));
    const low = S.products.filter(p => (S.inv[p.id]?.stock || 0) <= 3).length;
    return `<div class="row wrap"><input class="inp" id="sf" placeholder="Search medicines" value="${esc(S.stockFilter)}" style="width:260px">
        <select class="inp" id="sc"><option value="">All categories</option>${CATS.map(c => `<option value="${c.id}" ${S.stockCat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
        <span class="pill ${low ? 'warn' : ''}">${low} low or out of stock</span>
        <label class="btn ghost sm" style="margin-left:auto">${ICON.box} Upload stock file (CSV)<input type="file" accept=".csv,text/csv" hidden id="csv"></label>
        <button class="btn sm" id="savestock">Save changes</button></div>
      <div class="card" style="max-height:70vh;overflow:auto"><table><thead><tr><th>Medicine</th><th>Pack</th><th>MRP</th><th style="width:130px">Your price</th><th style="width:110px">In stock</th></tr></thead><tbody>
      ${rows.map(p => { const i = S.inv[p.id] || {}; return `<tr><td><b>${esc(p.name)}</b>${p.rx ? ' <span class="pill gold">Rx</span>' : ''}<div class="s12 mute">${esc(p.salt)}</div></td><td class="s13">${esc(p.pack)}</td><td>${rupee(p.mrp)}</td>
        <td><input class="inp" style="width:100px" type="number" min="1" max="${p.mrp}" data-price="${p.id}" value="${i.price || ''}" placeholder="${p.mrp}"></td>
        <td><input class="inp" style="width:80px;${(i.stock || 0) <= 3 ? 'border-color:#F59E0B' : ''}" type="number" min="0" data-stock="${p.id}" value="${i.stock || 0}"></td></tr>`; }).join('')}
      </tbody></table></div><span class="s12 mute">Leave "Your price" empty to sell at MRP. Prices above MRP are not allowed. Need a medicine that isn't listed? Ask dawa4u support to add it.</span>`;
  },
  sales() {
    return `<div class="row wrap"><select class="inp" id="range"><option value="1">Today</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option></select><button class="btn ghost sm" id="exportsales" style="margin-left:auto">Download CSV</button></div><div id="salesbody"><div class="spin"></div></div>`;
  },
  pos() {
    return `<div class="cols">
      <div class="card pad stack"><span class="serif s18">Your POS key</span><span class="mute s13">Give this key only to your billing-software dealer. It lets their software update your stock automatically and download your dawa4u orders for billing.</span>
        <div class="row"><code id="poskey" style="background:var(--sand);padding:10px 12px;border-radius:10px;font-size:13px;flex:1;word-break:break-all">Loading…</code><button class="btn sm ghost" id="copykey">Copy</button></div></div>
      <div class="card pad stack"><span class="serif s18">Easiest: upload a stock file</span><span class="mute s13">From Marg ERP: <b>Reports → Stock → Stock Status</b>, export to Excel/CSV, then use <b>Stock → Upload stock file</b> here. Columns we read: item code, item name, stock/closing qty, MRP.</span><a href="#/stock" class="btn sm" style="align-self:flex-start">Go to Stock</a></div>
    </div>
    <div class="card pad stack"><span class="serif s18">Automatic sync (for your software dealer)</span>
<pre style="background:#111827;color:#E5E7EB;padding:16px;border-radius:12px;overflow:auto;font-size:12px;line-height:1.6">
# Update stock (JSON or CSV body)
POST ${esc(FN_URL())}
X-POS-Key: &lt;your key&gt;
Content-Type: application/json

{"items":[{"code":"PCM650","name":"PARACETAMOL 650 TAB","stock":120,"mrp":34}]}

# Download new dawa4u orders to bill them in your POS
GET ${esc(FN_URL())}?since=2026-11-20T00:00:00Z
X-POS-Key: &lt;your key&gt;</pre>
      <span class="s12 mute">Items are matched by POS item code (dawa4u admin can set codes) or by name. Unmatched names are listed in the reply.</span></div>`;
  },
  settings() {
    const p = S.ph;
    return `<div class="cols"><div class="card pad stack"><span class="serif s18">Shop details</span>
      <div class="row between"><div class="stack" style="gap:2px"><b>Shop is ${p.open ? 'open' : 'closed'}</b><span class="s12 mute">Closed shops get no new orders</span></div><button class="switch ${p.open ? 'on' : ''}" id="opentoggle" aria-label="Open or close shop"></button></div>
      <label class="field">Phone<input id="s-phone" value="${esc(p.phone)}"></label>
      <label class="field">Address<input id="s-addr" value="${esc(p.address)}"></label>
      <button class="btn" id="s-save" style="align-self:flex-start">Save</button></div>
      <div class="card pad stack"><span class="serif s18">Registered details</span>
        <div class="stack s13" style="gap:6px"><span><b>Name:</b> ${esc(p.name)}</span><span><b>Licence:</b> ${esc(p.licence_no)}</span><span><b>City:</b> ${esc(p.city)}</span><span><b>Delivers to PIN:</b> ${p.pins.map(esc).join(', ') || '—'}</span></div>
        <span class="s12 mute">To change these, contact dawa4u support.</span>
        <button class="btn ghost sm" id="notif" style="align-self:flex-start">Turn on desktop alerts</button></div></div>
      <div class="card pad stack"><span class="serif s18">Shop location on the map</span>
        <span class="mute s13">Riders use this pin to find you, and customers see it on their tracking map. Drag the pin to your shop door.</span>
        <div id="shopmap" style="height:340px;border-radius:14px;overflow:hidden;background:var(--sand)"></div>
        <div class="row"><button class="btn" id="savepin" disabled>Save shop location</button><span class="s12 mute" id="pinstate">${p.lat != null ? 'Saved: ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : 'Not set yet'}</span></div></div>`;
  }
};

function rxDetail(id) {
  const r = S.rxq.find(x => x.id === id) || S.rxDone.find(x => x.id === id) || S.openRx;
  if (!r || r.id !== id) { api.rxGet(id).then(x => { if (x) { S.openRx = x; render(); } else { toast('Prescription not found'); location.hash = '#/rx'; } }).catch(e => toast(errText(e))); return '<div class="spin"></div>'; }
  const editable = r.status === 'reading' && r.pharmacy_id === S.ph.id;
  S.pick = S.pick && S.pick.id === id ? S.pick : { id, items: (r.items || []).map(i => ({ ...i })) };
  const q = (S.rxSearch || '').toLowerCase();
  const matches = q ? S.products.filter(p => (p.name + ' ' + p.salt).toLowerCase().includes(q)).slice(0, 8) : [];
  return `<div class="row"><a href="#/rx" class="btn ghost sm">${ICON.back} All prescriptions</a><span class="mute s13">Received ${when(r.created_at)} · PIN ${esc(r.pin)}</span></div>
    <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,1fr);gap:20px;align-items:start">
      <div class="card pad stack">${r.photos.map((p, i) => `<img class="rxphoto" data-path="${esc(p)}" alt="Prescription page ${i + 1}">`).join('')}
        ${r.note ? `<div class="pill warn" style="font-size:13px;padding:8px 12px;white-space:normal">Customer note: ${esc(r.note)}</div>` : ''}</div>
      <div class="card pad stack" style="position:sticky;top:90px">
        <span class="serif s18">Medicines on this prescription</span>
        ${editable ? `<input class="inp" id="rxs" placeholder="Search to add a medicine…" value="${esc(S.rxSearch || '')}" autocomplete="off">
          ${matches.map(p => `<button class="row between card" data-addrx="${p.id}" style="padding:10px 12px;text-align:left"><span><b>${esc(p.name)}</b> <span class="s12 mute">${esc(p.pack)}</span></span><span class="s12">${(S.inv[p.id]?.stock || 0)} in stock</span></button>`).join('')}` : ''}
        <div class="stack" style="gap:8px">${S.pick.items.map((it, n) => { const p = S.products.find(x => x.id === it.product_id) || { name: it.product_id }; return `<div class="row between"><span class="grow"><b>${esc(p.name)}</b> <span class="s12 mute">${esc(p.pack || '')}</span></span>
          ${editable ? `<input class="inp" type="number" min="1" max="20" value="${it.qty}" data-rxqty="${n}" style="width:70px"><button class="btn sm danger" data-rxdel="${n}">✕</button>` : `<b>× ${it.qty}</b>`}</div>`; }).join('') || '<span class="mute s13">No medicines added yet.</span>'}</div>
        ${editable ? `<label class="field">Note for customer (optional)<textarea id="rxnote" placeholder="e.g. Take after food. Generic substitute given.">${esc(r.pharmacist_note || '')}</textarea></label>
          <div class="row"><button class="btn grow" id="rxdone-btn">Done — add to customer's cart</button><button class="btn danger" id="rxreject">Reject</button></div>
          <span class="s12 mute">Only add what the doctor prescribed. Reject unclear, expired or unsigned prescriptions with a reason.</span>`
        : `<span class="pill ${r.status === 'done' ? '' : r.status === 'rejected' ? 'bad' : 'warn'}">${r.status === 'done' ? 'Finished' : r.status === 'rejected' ? 'Rejected' : 'Open it to read'}</span>${r.pharmacist_note ? `<span class="s13">Note: ${esc(r.pharmacist_note)}</span>` : ''}`}
      </div></div>`;
}

// ------------------------------------------------ render
function render() {
  const [, p1, p2] = (location.hash || '#/orders').split('/');
  const page = pages[p1] ? p1 : 'orders';
  const pendingRx = S.rxq.filter(r => r.status === 'pending').length, newO = S.orders.filter(o => o.status === 'placed').length;
  shell(root, {
    nav: [{ id: 'orders', label: 'Orders', icon: ICON.orders, count: newO }, { id: 'rx', label: 'Prescriptions', icon: ICON.rx, count: pendingRx },
      { id: 'stock', label: 'Stock & prices', icon: ICON.box }, { id: 'sales', label: 'Sales', icon: ICON.chart }, { id: 'pos', label: 'POS link', icon: ICON.link }, { id: 'settings', label: 'Settings', icon: ICON.gear }],
    active: page, who: S.ph.name + ' · ' + (S.user.email || ''),
    title: { orders: 'Orders', rx: 'Prescriptions', stock: 'Stock & prices', sales: 'Sales & earnings', pos: 'Billing software link', settings: 'Settings' }[page],
    right: `<span class="s13 b">${S.ph.open ? 'Open' : 'Closed'}</span><button class="switch ${S.ph.open ? 'on' : ''}" id="opentop" aria-label="Open or close shop"></button>`,
    body: pages[page](p2)
  });
  after(page, p2);
}
async function after(page, id) {
  if (page === 'rx' && id) {
    for (const img of $$('img[data-path]')) rxApi.photoUrl(img.dataset.path).then(u => { img.src = u; }).catch(() => { img.alt = 'Photo could not load'; });
    const s = $('#rxs'); if (s && S.rxSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  if (page === 'rx' && !id) $('#rxdone').addEventListener('toggle', async () => { S.rxDone = await api.rxDone(); $('#rxdonelist').innerHTML = S.rxDone.map(r => `<a href="#/rx/${r.id}" class="row between" style="text-decoration:none;color:inherit"><span>${when(r.reviewed_at)} · PIN ${esc(r.pin)}</span><span class="pill ${r.status === 'done' ? '' : 'bad'}">${r.status === 'done' ? r.items.length + ' medicines' : 'Rejected'}</span></a>`).join('') || '<span class="mute">None yet</span>'; }, { once: true });
  if (page === 'pos') { const k = await api.posKey(S.ph.id).catch(() => null); $('#poskey').textContent = k ? k.pos_key : 'Not available'; }
  if (page === 'sales') loadSales();
  if (page === 'settings') {
    S.newPin = null;
    locationPicker($('#shopmap'), { lat: S.ph.lat, lng: S.ph.lng, search: true, onChange: p => { S.newPin = p; const b = $('#savepin'); if (b) b.disabled = false; $('#pinstate').textContent = 'New pin: ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + ' — press Save'; } }).catch(() => { $('#shopmap').innerHTML = '<div class="empty">Map could not load</div>'; });
  }
}
async function loadSales() {
  const days = +($('#range')?.value || 7), from = new Date(Date.now() - (days - 1) * 864e5); from.setHours(0, 0, 0, 0);
  const rows = await api.history(S.ph.id, from.toISOString()).catch(e => { toast(errText(e)); return []; });
  S.sales = rows;
  const del = rows.filter(o => o.status === 'delivered'), can = rows.filter(o => o.status === 'cancelled');
  const items = del.reduce((a, o) => a + o.sub - o.disc, 0), cash = del.filter(o => o.pay_method === 'cod').reduce((a, o) => a + o.total, 0);
  $('#salesbody').innerHTML = `<div class="tiles">
      <div class="card tile"><span class="k">Delivered orders</span><span class="v">${del.length}</span></div>
      <div class="card tile"><span class="k">Medicine sales</span><span class="v">${rupee(items)}</span></div>
      <div class="card tile"><span class="k">Cash collected by riders</span><span class="v">${rupee(cash)}</span></div>
      <div class="card tile"><span class="k">Cancelled</span><span class="v">${can.length}</span></div></div>
    <div class="card" style="margin-top:16px"><table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Payment</th><th>Status</th><th style="text-align:right">Amount</th></tr></thead><tbody>
    ${rows.map(o => `<tr><td><b>${o.id}</b></td><td class="s13">${when(o.created_at)}</td><td class="s13">${o.order_items.map(i => i.qty + '× ' + esc(i.name)).join(', ')}</td><td>${payLabel(o.pay_method)}</td><td><span class="pill ${o.status === 'cancelled' ? 'bad' : ''}">${STATUS[o.status]}</span></td><td style="text-align:right">${rupee(o.sub - o.disc)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No orders in this period</div></td></tr>'}
    </tbody></table></div>`;
}

// ------------------------------------------------ events
document.addEventListener('click', async e => {
  const el = e.target.closest('button,[data-openrx]'); if (!el) return;
  if (el.id === 'opentop' || el.id === 'opentoggle' || el.id === 'openshop') return busy(null, async () => { await api.setOpen(S.ph.id, !S.ph.open); S.ph.open = !S.ph.open; toast(S.ph.open ? 'Shop is open — you will get orders' : 'Shop closed'); render(); });
  if (el.dataset.act) {
    const { act, id } = el.dataset; let reason = null;
    if (act === 'cancel') { reason = prompt('Why can\'t you fulfil this order? (the customer will see this)', 'Medicine out of stock'); if (reason === null) return; }
    return busy(el, async () => { await api.action(id, act, reason); toast(act === 'accept' ? 'Accepted — start packing' : act === 'pack' ? 'Marked packed — rider will pick up' : 'Order cancelled'); await refreshOrders(); render(); });
  }
  if (el.dataset.openrx) return busy(el, async () => { const r = await api.rxClaim(el.dataset.openrx); S.openRx = r; S.rxq = await api.rxQueue(); S.pick = null; S.rxSearch = ''; location.hash = '#/rx/' + r.id; });
  if (el.dataset.addrx) { const pid = el.dataset.addrx; if (!S.pick.items.find(i => i.product_id === pid)) S.pick.items.push({ product_id: pid, qty: 1 }); S.rxSearch = ''; return render(); }
  if (el.dataset.rxdel) { S.pick.items.splice(+el.dataset.rxdel, 1); return render(); }
  if (el.id === 'rxdone-btn' || el.id === 'rxreject') {
    const reject = el.id === 'rxreject', note = $('#rxnote').value.trim();
    if (reject && !note) return toast('Write the reason in the note box first');
    return busy(el, async () => { await api.rxReview(S.pick.id, S.pick.items, note, reject); toast(reject ? 'Prescription rejected' : 'Medicines sent to the customer\'s cart'); S.pick = null; S.rxq = await api.rxQueue(); location.hash = '#/rx'; });
  }
  if (el.id === 'savestock') {
    const items = $$('[data-stock]').map(i => { const id = i.dataset.stock, pr = $(`[data-price="${id}"]`).value; return { product_id: id, stock: Math.max(0, +i.value || 0), price: pr ? +pr : 0 }; });
    const bad = items.find(i => { const p = S.products.find(x => x.id === i.product_id); return i.price && i.price > p.mrp; });
    if (bad) return toast('Price cannot be above MRP: ' + S.products.find(x => x.id === bad.product_id).name);
    return busy(el, async () => { await api.setStock(items); await loadInv(); toast('Stock saved'); render(); });
  }
  if (el.id === 's-save') return busy(el, async () => { const patch = { phone: $('#s-phone').value.trim(), address: $('#s-addr').value.trim() }; await api.update(S.ph.id, patch); Object.assign(S.ph, patch); toast('Saved'); });
  if (el.id === 'savepin' && S.newPin) return busy(el, async () => { await api.update(S.ph.id, { lat: S.newPin.lat, lng: S.newPin.lng }); S.ph.lat = S.newPin.lat; S.ph.lng = S.newPin.lng; toast('Shop location saved'); $('#pinstate').textContent = 'Saved'; el.disabled = true; });
  if (el.id === 'copykey') return copy($('#poskey').textContent, 'POS key copied');
  if (el.id === 'notif') { const p = await Notification.requestPermission().catch(() => 'denied'); return toast(p === 'granted' ? 'Desktop alerts on' : 'Alerts blocked in browser settings'); }
  if (el.id === 'exportsales') return download('dawa4u-sales.csv', toCsv(S.sales || [], [['Order', o => o.id], ['Date', o => when(o.created_at)], ['Status', o => o.status], ['Payment', o => o.pay_method], ['Medicines', o => o.order_items.map(i => i.qty + 'x ' + i.name).join('; ')], ['Amount', o => o.sub - o.disc]]));
});
document.addEventListener('input', e => {
  if (e.target.id === 'rxs') { S.rxSearch = e.target.value; clearTimeout(S.t); S.t = setTimeout(render, 150); }
  if (e.target.dataset.rxqty !== undefined) S.pick.items[+e.target.dataset.rxqty].qty = Math.max(1, Math.min(20, +e.target.value || 1));
  if (e.target.id === 'sf') { S.stockFilter = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { render(); const f = $('#sf'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 200); }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'sc') { S.stockCat = e.target.value; render(); }
  if (e.target.id === 'range') loadSales();
  if (e.target.id === 'csv' && e.target.files[0]) {
    const text = await e.target.files[0].text();
    const lines = text.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    const head = lines.shift().map(h => h.toLowerCase()), col = (...n) => head.findIndex(h => n.some(x => h.includes(x)));
    const ci = col('code'), ni = col('name', 'item', 'product'), si = col('stock', 'qty', 'closing');
    if (ni < 0 || si < 0) return toast('The file needs an item name column and a stock/quantity column');
    const norm = s => s.toLowerCase().replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup)\b/g, '').replace(/[^a-z0-9]/g, '');
    const byName = Object.fromEntries(S.products.map(p => [norm(p.name), p])), byCode = Object.fromEntries(S.products.filter(p => p.pos_code).map(p => [p.pos_code.toLowerCase(), p]));
    if (S.stockFilter || S.stockCat) { S.stockFilter = ''; S.stockCat = ''; render(); }
    let n = 0; const miss = [];
    for (const l of lines) { const p = (ci >= 0 && byCode[(l[ci] || '').toLowerCase()]) || byName[norm(l[ni] || '')]; if (!p) { miss.push(l[ni]); continue; } const inp = $(`[data-stock="${p.id}"]`); if (inp) { inp.value = Math.max(0, Math.round(+l[si] || 0)); inp.style.background = '#ECFDF5'; } n++; }
    toast(`Matched ${n} items${miss.length ? `, ${miss.length} not found` : ''}. Check and press Save changes.`, 5000);
  }
});
document.addEventListener('click', e => { const img = e.target.closest('.rxphoto'); if (img) img.classList.toggle('zoom'); });

boot().catch(e => { root.innerHTML = `<div class="auth"><div class="card"><b>Something went wrong</b><span class="mute">${esc(errText(e))}</span><button class="btn" onclick="location.reload()">Try again</button></div></div>`; });
