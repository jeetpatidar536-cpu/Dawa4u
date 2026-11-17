// dawa4u Admin website: the owner's view of everything, plus a simple CRM for customers.
const A = { d: null, view: 'overview', filter: 'live', q: '', rx: {} };
const NAV = [['overview', 'Overview'], ['orders', 'Orders'], ['pharmacies', 'Pharmacies'], ['riders', 'Riders'], ['customers', 'Customers'], ['medicines', 'Medicines'], ['settings', 'Settings']];

function shell(body) {
  const s = A.d.stats;
  $('#root').innerHTML = `<div class="layout">
    <aside><a class="brand" href="#overview" style="padding:0"><i>+</i><span>dawa<b>4u</b></span><small>admin</small></a>
      ${NAV.map(([k, l]) => `<a href="#${k}" class="${A.view === k ? 'on' : ''}">${l}${k === 'orders' && s.live ? `<span class="count">${s.live}</span>` : ''}</a>`).join('')}
      <div class="foot"><a href="../shop/" target="_blank" rel="noopener">Open customer site</a><button class="btn sm ghost" data-act="logout">Log out</button></div>
    </aside>
    <main class="content">${body}</main></div>`;
}
const modeNotes = () => {
  const st = A.d.settings, n = [];
  if (!st.paymentsLive) n.push('Payments are in <b>test mode</b>: add Razorpay keys to the server .env before taking real orders.');
  if (!st.aiReady) n.push('The <b>AI prescription scanner is off</b>: add ANTHROPIC_API_KEY to the server .env. Until then customers upload photos and pharmacists read them.');
  if (st.devMode) n.push('<b>Development mode</b>: login codes are shown on screen instead of sent by SMS.');
  return n.length ? `<div class="note">${n.join('<br>')}</div>` : '';
};

// ---------- overview ----------
function vOverview() {
  const s = A.d.stats, top = [...A.d.products].sort((a, b) => b.sold - a.sold).filter(p => p.sold).slice(0, 8), max = top[0]?.sold || 1;
  const live = A.d.orders.filter(o => ['placed', 'accepted', 'packed', 'picked'].includes(o.status));
  return `<div class="row spread"><h1>Overview</h1><span class="small muted">Updates every 10 seconds</span></div>
  ${modeNotes()}
  <div class="stats">
    <div class="card stat"><span class="muted small">Orders today</span><b class="num">${s.ordersToday}</b><span class="small muted">${s.orders} all time</span></div>
    <div class="card stat"><span class="muted small">Order value today</span><b class="num">${rs(s.gmvToday)}</b><span class="small muted">${rs(s.gmv)} all time</span></div>
    <div class="card stat"><span class="muted small">Average delivery</span><b class="num">${s.delivered ? mmss(s.avgSecs) : '0:00'}</b><span class="small muted">minutes</span></div>
    <div class="card stat"><span class="muted small">Within 15 minutes</span><b class="num">${s.onTime}%</b><span class="small muted">of ${s.delivered} delivered</span></div>
    <div class="card stat"><span class="muted small">dawaPass members</span><b class="num">${s.members}</b><span class="small muted">${rs(s.members * A.d.settings.passPrice)} a month · ${s.customers} customers</span></div>
    <div class="card stat"><span class="muted small">Rider pay due</span><b class="num">${rs(s.riderDue)}</b><span class="small muted">${s.refundsDue ? `<b style="color:var(--rx)">${s.refundsDue} refund${s.refundsDue > 1 ? 's' : ''} due</b>` : 'no refunds due'}</span></div>
  </div>
  <div class="grid2">
    <section class="stack"><h2>Live orders</h2>${live.length ? `<div class="card">${live.map(o => `<div class="line"><span><b>${o.id}</b> ${statusPill(o.status)}<br><span class="small muted">${esc(o.pharmacy?.name)} → PIN ${esc(o.pin)}${o.rider ? ' · ' + esc(o.rider.name) : ''}</span></span><span class="num small" data-age="${o.ts.placed}"></span></div>`).join('')}</div>` : '<div class="card empty">No orders on the way right now.</div>'}</section>
    <section class="stack"><h2>Top medicines</h2><div class="card stack">${top.length ? top.map(p => `<div class="hbar"><span>${esc(p.name)}</span><div class="bar"><i style="width:${Math.round(100 * p.sold / max)}%"></i></div><span class="num">${p.sold}</span></div>`).join('') : '<p class="muted">No sales yet.</p>'}</div></section>
  </div>`;
}

// ---------- orders ----------
const FILTERS = [['live', 'Live', o => ['placed', 'accepted', 'packed', 'picked'].includes(o.status)], ['delivered', 'Delivered', o => o.status === 'delivered'],
  ['problems', 'Cancelled & rejected', o => ['cancelled', 'rejected'].includes(o.status)], ['refunds', 'Refund due', o => o.payStatus === 'refund_due'], ['all', 'All', () => true]];
function vOrders() {
  const f = FILTERS.find(x => x[0] === A.filter)[2];
  const list = A.d.orders.filter(f).filter(o => !A.q || (o.id + ' ' + (o.customer?.phone || '') + ' ' + (o.customer?.name || '')).toLowerCase().includes(A.q.toLowerCase()));
  return `<h1>Orders</h1>
  <div class="row spread"><div class="filters">${FILTERS.map(([k, l, fn]) => `<button class="chip ${A.filter === k ? 'on' : ''}" data-act="filter" data-id="${k}">${l} <span class="num">${A.d.orders.filter(fn).length}</span></button>`).join('')}</div>
    <input type="search" id="order-q" placeholder="Order ID, phone or name" value="${esc(A.q)}" style="max-width:260px" aria-label="Search orders"></div>
  <div class="card tablebox"><table>
    <tr><th>Order</th><th>Placed</th><th>Customer</th><th>Items</th><th>Pharmacy · Rider</th><th>Total</th><th>Status</th><th></th></tr>
    ${list.map(o => `<tr><td><b>${o.id}</b>${o.pass ? ' <span class="pill sun">Pass</span>' : ''}</td><td class="num small">${when(o.ts.placed || o.ts.created)}</td>
      <td class="small">${esc(o.customer?.name || '')}<br>${esc(o.customer?.phone || '')}<br><span class="muted">PIN ${esc(o.pin)}</span></td>
      <td class="small">${itemsText(o)}${o.rx ? `<br><button class="btn sm ghost" data-act="rx" data-id="${o.rx.id}">Prescription</button>${A.rx[o.rx.id] ? `<br><img src="${A.rx[o.rx.id]}" alt="Prescription for ${o.id}" style="max-width:220px;border-radius:8px">` : ''}` : ''}</td>
      <td class="small">${esc(o.pharmacy?.name || '')}<br><span class="muted">${esc(o.rider?.name || 'no rider yet')}</span></td>
      <td class="num">${rs(o.total)}<br><span class="small muted">${PAY[o.payStatus] || ''}${o.payTest ? ' (test)' : ''}</span></td>
      <td>${statusPill(o.status)}${o.reason ? `<br><span class="small muted">${esc(o.reason)}</span>` : ''}</td>
      <td>${['placed', 'accepted', 'packed', 'picked', 'awaiting_payment'].includes(o.status) ? `<button class="btn sm danger" data-act="cancel" data-id="${o.id}">Cancel</button>` : ''}
        ${o.payStatus === 'refund_due' ? `<button class="btn sm" data-act="refunded" data-id="${o.id}">Mark refunded</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No orders here.</td></tr>'}
  </table></div>
  ${A.filter === 'refunds' ? '<p class="small muted">Refund the money in your Razorpay dashboard (Payments → Refund), then mark it here.</p>' : ''}`;
}

// ---------- pharmacies ----------
function vPharmacies() {
  return `<h1>Pharmacies</h1>
  <div class="card tablebox"><table>
    <tr><th>Pharmacy</th><th>Delivers to PIN codes</th><th>Status</th><th>Orders · Sales</th><th>POS</th><th>Login</th></tr>
    ${A.d.pharmacies.map(p => `<tr><td><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.address)}</span></td>
      <td><details class="inline"><summary>${p.pins.map(esc).join(', ') || 'none'} · edit</summary><form data-form="ph-pins" data-id="${p.id}">
        <input type="text" name="pins" value="${esc(p.pins.join(', '))}" aria-label="PIN codes for ${esc(p.name)}"><button class="btn sm" type="submit">Save PIN codes</button></form></details></td>
      <td>${p.open ? '<span class="pill">Open</span>' : '<span class="pill grey">Closed</span>'}${p.outOfStock ? ` <span class="pill grey">${p.outOfStock} out of stock</span>` : ''}<br>
        <button class="btn sm ghost" data-act="ph-open" data-id="${p.id}" data-open="${p.open ? 0 : 1}" style="margin-top:4px">${p.open ? 'Close store' : 'Open store'}</button></td>
      <td class="num">${p.orders}<br>${rs(p.sales)}</td>
      <td class="small">${esc(p.posType)}<br><span class="muted">${p.posLast ? 'synced ' + when(p.posLast.at) : 'never synced'}</span></td>
      <td class="small">${esc(p.username || '')}${p.disabled ? ' <span class="pill rx">Blocked</span>' : ''}${userTools(p.loginId, p)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No pharmacies yet.</td></tr>'}
  </table></div>
  <form class="card stack" data-form="ph-new"><h2>Add a partner pharmacy</h2><div class="formgrid">
    <label class="field">Pharmacy name<input type="text" name="name" required maxlength="80"></label>
    <label class="field">Address<input type="text" name="address" maxlength="200"></label>
    <label class="field">PIN codes it delivers to<input type="text" name="pins" placeholder="452001, 452010"></label>
    <label class="field">Login username<input type="text" name="username" required autocapitalize="none"></label>
    <label class="field">Login password, 8+ characters<input type="text" name="password" required minlength="8"></label>
    <button class="btn" type="submit">Add pharmacy</button></div>
    <p class="small muted">Give the pharmacist the username and password. They install the Pharmacy app from ${esc(location.origin)}/pharmacy/</p></form>`;
}
function userTools(userId, row) {
  if (!userId) return '';
  return `<details class="inline"><summary>Manage login</summary>
    <form data-form="reset-pw" data-id="${userId}"><input type="text" name="password" placeholder="New password, 8+ characters" minlength="8" required aria-label="New password"><button class="btn sm" type="submit">Set new password</button></form>
    <button class="btn sm ${row.disabled ? '' : 'danger'}" data-act="block" data-id="${userId}" data-block="${row.disabled ? 0 : 1}" style="margin-top:8px">${row.disabled ? 'Unblock' : 'Block login'}</button></details>`;
}

// ---------- riders ----------
function vRiders() {
  return `<h1>Riders</h1>
  <div class="card tablebox"><table>
    <tr><th>Rider</th><th>Status</th><th>Areas</th><th>Delivered</th><th>Pay due</th><th>Cash held</th><th></th></tr>
    ${A.d.riders.map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="small muted">${esc(r.phone)} · ${esc(r.username)}</span>${r.disabled ? ' <span class="pill rx">Blocked</span>' : ''}</td>
      <td>${r.online ? '<span class="pill">Online</span>' : '<span class="pill grey">Offline</span>'}</td>
      <td class="small"><details class="inline"><summary>${r.pins.length ? r.pins.map(esc).join(', ') : 'All areas'} · edit</summary><form data-form="rider-pins" data-id="${r.id}"><input type="text" name="pins" value="${esc(r.pins.join(', '))}" placeholder="Empty = all areas" aria-label="PIN codes"><button class="btn sm" type="submit">Save</button></form></details></td>
      <td class="num">${r.delivered}</td><td class="num">${rs(r.due)}</td><td class="num">${rs(r.cash)}</td>
      <td>${r.due || r.cash ? `<button class="btn sm" data-act="paid" data-id="${r.id}">Settled: paid ${rs(r.due)}, got ${rs(r.cash)}</button>` : ''}${userTools(r.id, r)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No riders yet.</td></tr>'}
  </table></div>
  <form class="card stack" data-form="rider-new"><h2>Add a rider</h2><div class="formgrid">
    <label class="field">Name<input type="text" name="name" required maxlength="60"></label>
    <label class="field">Mobile number<input type="tel" name="phone" required inputmode="numeric"></label>
    <label class="field">PIN codes (empty = all)<input type="text" name="pins"></label>
    <label class="field">Login username<input type="text" name="username" required autocapitalize="none"></label>
    <label class="field">Login password, 8+ characters<input type="text" name="password" required minlength="8"></label>
    <button class="btn" type="submit">Add rider</button></div>
    <p class="small muted">The rider installs the Rider app from ${esc(location.origin)}/rider/</p></form>`;
}

// ---------- customers (CRM) ----------
function vCustomers() {
  const list = A.d.customers.filter(c => !A.q || (c.name + ' ' + c.phone + ' ' + (c.pin || '')).toLowerCase().includes(A.q.toLowerCase()));
  return `<div class="row spread"><h1>Customers</h1><input type="search" id="cust-q" placeholder="Name, phone or PIN" value="${esc(A.q)}" style="max-width:260px" aria-label="Search customers"></div>
  <div class="card tablebox"><table>
    <tr><th>Customer</th><th>Area</th><th>dawaPass</th><th>Orders · Spent</th><th>Last order</th><th>Support notes</th></tr>
    ${list.map(c => `<tr><td><b>${esc(c.name || 'No name')}</b>${c.disabled ? ' <span class="pill rx">Blocked</span>' : ''}<br><span class="small">${esc(c.phone)}</span></td>
      <td class="small">${esc(c.pin || '')}<br><span class="muted">${esc(c.address || '')}</span></td>
      <td>${c.member ? '<span class="pill sun">Member</span>' : '<span class="pill grey">No</span>'}</td>
      <td class="num">${c.orders} · ${rs(c.spent)}</td><td class="small">${when(c.last)}</td>
      <td><textarea rows="2" data-note="${c.id}" placeholder="e.g. Called about late order" aria-label="Notes for ${esc(c.phone)}" style="min-width:200px">${esc(c.note)}</textarea>
        <button class="btn sm ${c.disabled ? '' : 'danger'}" data-act="block" data-id="${c.id}" data-block="${c.disabled ? 0 : 1}">${c.disabled ? 'Unblock' : 'Block'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No customers yet.</td></tr>'}
  </table></div>`;
}

// ---------- medicines ----------
const ICONS = ['pill', 'bottle', 'device', 'care'];
function productForm(p = {}) {
  return `<form data-form="product" data-id="${p.id || ''}" class="formgrid">
    <label class="field">Name<input type="text" name="name" value="${esc(p.name || '')}" required></label>
    <label class="field">Pack<input type="text" name="pack" value="${esc(p.pack || '')}" placeholder="Strip of 10 tablets"></label>
    <label class="field">MRP ₹<input type="number" name="mrp" value="${p.mrp || ''}" min="1" required></label>
    <label class="field">Category<input type="text" name="cat" value="${esc(p.cat || '')}" list="cats"></label>
    <label class="field">Picture<select name="icon">${ICONS.map(i => `<option ${i === p.icon ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
    <label class="field">POS item code<input type="text" name="posCode" value="${esc(p.posCode || '')}" placeholder="optional"></label>
    <label class="check"><input type="checkbox" name="rx" ${p.rx ? 'checked' : ''}> Needs prescription</label>
    ${p.id ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> On sale</label>` : ''}
    <button class="btn" type="submit">${p.id ? 'Save' : 'Add medicine'}</button></form>`;
}
function vMedicines() {
  const cats = [...new Set(A.d.products.map(p => p.cat))];
  return `<h1>Medicines</h1>
  <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
  <div class="card stack"><h2>Add a medicine</h2>${productForm()}</div>
  <div class="card tablebox"><table><tr><th>Medicine</th><th>Category</th><th>MRP</th><th>Sold</th><th></th></tr>
    ${A.d.products.map(p => `<tr><td><b>${esc(p.name)}</b> ${p.rx ? '<span class="pill rx">Rx</span>' : ''} ${p.active ? '' : '<span class="pill grey">Not on sale</span>'}<br><span class="small muted">${esc(p.pack)}${p.posCode ? ' · POS ' + esc(p.posCode) : ''}</span></td>
      <td class="small">${esc(p.cat)}</td><td class="num">${rs(p.mrp)}</td><td class="num">${p.sold}</td>
      <td><details class="inline"><summary>Edit</summary>${productForm(p)}</details></td></tr>`).join('')}
  </table></div>`;
}

// ---------- settings ----------
function vSettings() {
  const s = A.d.settings;
  return `<h1>Settings</h1>${modeNotes()}
  <form class="card stack" data-form="settings" style="max-width:560px">
    <label class="field">Delivery fee for non-members (₹)<input type="number" name="deliveryFee" min="0" max="200" value="${s.deliveryFee}"></label>
    <label class="field">dawaPass discount<select name="passOff">${[15, 16, 17, 18, 19, 20].map(n => `<option value="${n}" ${s.passOff === n ? 'selected' : ''}>${n}% off</option>`).join('')}</select></label>
    <label class="field">Rider pay per delivery (₹)<input type="number" name="riderPay" min="0" max="500" value="${s.riderPay}"></label>
    <label class="field">Announcement on the customer site<input type="text" name="announcement" maxlength="140" value="${esc(s.announcement)}" placeholder="e.g. Free delivery this Sunday"></label>
    <p class="small muted">dawaPass price is fixed at ₹${s.passPrice} a month.</p>
    <button class="btn" type="submit" style="justify-self:start">Save settings</button></form>
  <form class="card stack" id="pw-form" style="max-width:560px"><h2>Your admin password</h2>
    <label class="field" for="pw-old">Current password<input type="password" id="pw-old" autocomplete="current-password" required></label>
    <label class="field" for="pw-new">New password, 8+ characters<input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit" style="justify-self:start">Change password</button></form>`;
}

// ---------- render + data ----------
const VIEWS = { overview: vOverview, orders: vOrders, pharmacies: vPharmacies, riders: vRiders, customers: vCustomers, medicines: vMedicines, settings: vSettings };
async function load() {
  A.d = await api('/api/admin');
}
function render() { const v = location.hash.slice(1); A.view = VIEWS[v] ? v : 'overview'; shell(VIEWS[A.view]()); ages(); }
function ages() { document.querySelectorAll('[data-age]').forEach(n => { n.textContent = mmss((Date.now() - n.dataset.age) / 1000) + ' min'; }); }
const reload = async msg => { await load(); render(); if (msg) toast(msg); };

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  const confirmTap = label => { if (b.dataset.sure) return true; b.dataset.sure = 1; b.textContent = label; return false; };
  ({
    filter: () => { A.filter = id; render(); },
    cancel: () => confirmTap('Tap again to cancel') && act(b, async () => { await post(`/api/admin/orders/${id}/cancel`, { reason: 'Cancelled by dawa4u support' }); await reload('Order cancelled'); }),
    refunded: () => act(b, async () => { await post(`/api/admin/orders/${id}/refunded`); await reload('Marked refunded'); }),
    'ph-open': () => act(b, async () => { await post('/api/admin/pharmacies/' + id, { open: b.dataset.open === '1' }); await reload(); }),
    block: () => (b.dataset.block === '0' || confirmTap('Tap again to block')) && act(b, async () => { await post('/api/admin/users/' + id, { disabled: b.dataset.block === '1' }); await reload(b.dataset.block === '1' ? 'Blocked' : 'Unblocked'); }),
    paid: () => confirmTap('Tap again to confirm settlement') && act(b, async () => { await post(`/api/admin/riders/${id}/paid`); await reload('Rider settled'); }),
    rx: () => act(b, async () => {
      const res = await fetch((window.DAWA4U_API || '') + '/api/rx/' + id, { headers: { authorization: 'Bearer ' + store.get(TOKEN_KEY) } });
      if (!res.ok) throw new Error('Could not load the photo.');
      A.rx[id] = URL.createObjectURL(await res.blob()); render();
    }),
    logout: () => logout(),
  })[b.dataset.act]?.();
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, id = f.dataset.id, v = Object.fromEntries(new FormData(f));
  if (f.id === 'pw-form') return act(e.submitter, async () => { await post('/api/me/password', { old: $('#pw-old').value, new: $('#pw-new').value }); f.reset(); toast('Password changed'); });
  const run = {
    'ph-new': () => post('/api/admin/pharmacies', v).then(() => 'Pharmacy added'),
    'ph-pins': () => post('/api/admin/pharmacies/' + id, { pins: v.pins }).then(() => 'PIN codes saved'),
    'rider-new': () => post('/api/admin/riders', v).then(() => 'Rider added'),
    'rider-pins': () => post('/api/admin/users/' + id, { pins: v.pins }).then(() => 'Areas saved'),
    'reset-pw': () => post('/api/admin/users/' + id, { password: v.password }).then(() => 'New password set. Tell the person.'),
    product: () => post('/api/admin/products', { ...v, id: id || undefined, rx: !!v.rx, active: id ? !!v.active : true }).then(() => id ? 'Medicine saved' : 'Medicine added'),
    settings: () => post('/api/admin/settings', v).then(() => 'Settings saved'),
  }[f.dataset.form];
  if (run) act(e.submitter, async () => { const msg = await run(); await reload(msg); });
});
document.addEventListener('change', e => {
  if (e.target.dataset.note) act(null, async () => { await post('/api/admin/users/' + e.target.dataset.note, { note: e.target.value }); toast('Note saved'); });
});
document.addEventListener('input', e => {
  if (e.target.id === 'order-q' || e.target.id === 'cust-q') { A.q = e.target.value; const i = e.target.id, p = e.target.selectionStart; render(); const s = $('#' + i); s.focus(); s.setSelectionRange(p, p); }
});
window.addEventListener('hashchange', () => { A.q = ''; render(); window.scrollTo(0, 0); });

async function start() {
  try { await load(); render(); }
  catch (e) { $('#root').innerHTML = `<div class="login"><div class="card"><p class="err">${esc(e.message)}</p></div></div>`; return; }
  setInterval(ages, 1000);
  setInterval(async () => {
    // refresh quietly unless the owner is typing or has an edit box open
    if (document.hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || document.querySelector('details[open]')) return;
    await load().catch(() => {}); render();
  }, 10000);
}
(async () => {
  const me = store.get(TOKEN_KEY) && (await api('/api/me').catch(() => ({}))).user;
  if (me?.role === 'admin') start();
  else staffLogin($('#root'), 'admin', 'Admin', () => start());
})();
