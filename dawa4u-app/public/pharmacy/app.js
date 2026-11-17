// dawa4u Pharmacy app (phone): new orders, packing, stock, POS link (Marg ERP and others).
const P = { user: null, data: null, tab: 'orders', q: '', pos: null, rxUrls: {}, seen: new Set(), first: true };
const TABS = [['orders', 'Orders', ICON.orders], ['stock', 'Stock', ICON.box], ['pos', 'POS link', ICON.link], ['me', 'Store', ICON.user]];

function shell(body) {
  const d = P.data, n = d.stats.new;
  document.title = (n ? `(${n}) ` : '') + 'dawa4u Pharmacy';
  $('#root').innerHTML = `<div class="app">
    <header class="appbar"><a class="brand" href="#orders" style="font-size:1.2rem"><i>+</i><span>dawa<b>4u</b></span></a>
      <span class="small muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.pharmacy.name)}</span>
      <label class="row small" for="open-sw" style="gap:6px;flex-wrap:nowrap"><b>${d.pharmacy.open ? 'Open' : 'Closed'}</b><span class="switch"><input type="checkbox" id="open-sw" ${d.pharmacy.open ? 'checked' : ''} aria-label="Store open for orders"><span></span></span></label>
    </header>
    <main class="appmain">${body}</main>
    <nav class="tabs" aria-label="Sections">${TABS.map(([k, l, i]) => `<a href="#${k}" class="${P.tab === k ? 'on' : ''}">${i}${l}${k === 'orders' && n ? `<span class="dot">${n}</span>` : ''}</a>`).join('')}</nav>
  </div>`;
}

// ---------- orders ----------
function orderCard(o) {
  const btns = o.status === 'placed' ? `<button class="btn" data-act="accept" data-id="${o.id}">${o.rx ? 'Prescription checked, accept' : 'Accept order'}</button><button class="btn danger" data-act="reject" data-id="${o.id}">Reject</button>`
    : o.status === 'accepted' ? `<button class="btn big" data-act="packed" data-id="${o.id}">Mark packed</button>`
    : o.status === 'packed' ? `<span class="pill grey">${o.rider ? esc(o.rider.name) + ' is coming to pick up' : 'Waiting for a rider'}</span>` : `<span class="pill grey">Out for delivery with ${esc(o.rider?.name || 'rider')}</span>`;
  return `<div class="card stack">
    <div class="row spread"><span><b>${o.id}</b> · <span class="muted small">${when(o.ts.placed)}</span></span>${statusPill(o.status)}</div>
    <div class="row">${o.pass ? '<span class="pill sun">dawaPass priority</span>' : ''}${o.rx ? '<span class="pill rx">Prescription</span>' : ''}<span class="pill grey">${o.payMethod === 'cod' ? 'Cash on delivery' : 'Paid online' + (o.payTest ? ' (test)' : '')}</span></div>
    <div>${o.items.map(i => `<div class="line"><span>${esc(i.name)} ${i.rx ? '<span class="pill rx">Rx</span>' : ''}<br><span class="small muted">${esc(i.pack)}</span></span><b class="num">× ${i.qty}</b></div>`).join('')}</div>
    <div class="row spread"><span class="muted small">${esc(o.customer?.name || 'Customer')} · PIN ${esc(o.pin)}</span><b class="num">${rs(o.total)}</b></div>
    ${o.rx ? (P.rxUrls[o.rx.id] ? `<img src="${P.rxUrls[o.rx.id]}" alt="Customer's prescription for ${o.id}" style="max-width:100%;border-radius:10px;border:1px solid var(--line)">`
      : `<button class="btn ghost sm" data-act="rx" data-id="${o.rx.id}" style="justify-self:start">View prescription photo</button>`) : ''}
    <div class="row">${btns}</div>
  </div>`;
}
function vOrders() {
  const d = P.data;
  return `<div class="stats">
    <div class="card stat"><span class="muted small">New</span><b class="num">${d.stats.new}</b></div>
    <div class="card stat"><span class="muted small">To pack</span><b class="num">${d.stats.toPack}</b></div>
    <div class="card stat"><span class="muted small">Orders today</span><b class="num">${d.stats.today}</b></div>
    <div class="card stat"><span class="muted small">Sales today</span><b class="num">${rs(d.stats.sales)}</b></div>
  </div>
  ${!d.pharmacy.open ? '<div class="note rx"><b>Your store is closed.</b> Customers cannot order from you. Switch Open on at the top.</div>' : ''}
  <h2>Open orders</h2>
  ${d.open.length ? d.open.map(orderCard).join('') : '<div class="card empty">No open orders. New orders appear here by themselves.</div>'}
  ${d.recent.length ? `<h2>Earlier</h2><div class="card">${d.recent.map(o => `<div class="line"><span><b>${o.id}</b> ${statusPill(o.status)}<br><span class="small muted">${itemsText(o)}</span></span><span class="num small">${rs(o.total)}<br>${when(o.ts.placed)}</span></div>`).join('')}</div>` : ''}`;
}

// ---------- stock ----------
function vStock() {
  const list = P.data.inventory.filter(p => p.name.toLowerCase().includes(P.q.toLowerCase()));
  const out = P.data.inventory.filter(p => !p.stock).length;
  return `<h2>Stock</h2>
  <p class="small muted">${out} item${out === 1 ? '' : 's'} out of stock. Customers only see items with stock above 0.</p>
  <input type="search" id="stock-q" placeholder="Search your stock" value="${esc(P.q)}" aria-label="Search stock">
  <div class="card" id="stock-list">${list.map(p => `<div class="line"><span style="min-width:0"><b>${esc(p.name)}</b> ${p.rx ? '<span class="pill rx">Rx</span>' : ''}<br>
      <span class="small muted">${esc(p.pack)} · MRP ${rs(p.mrp)}${p.price !== p.mrp ? ` · your price ${rs(p.price)}` : ''}</span></span>
      <span class="row" style="flex-wrap:nowrap"><input type="number" min="0" max="99999" value="${p.stock}" data-stock="${p.id}" aria-label="Stock of ${esc(p.name)}" style="width:80px;text-align:right">
      ${p.stock ? '' : '<span class="pill grey">Out</span>'}</span></div>`).join('') || '<p class="empty">No match.</p>'}</div>`;
}

// ---------- POS link ----------
const POS_TYPES = ['Marg ERP', 'Tally', 'Busy', 'GoFrugal', 'Other software'];
function vPos() {
  const s = P.pos, l = s?.posLast, base = (window.DAWA4U_API || location.origin);
  if (!s) return '<div class="card empty">Loading…</div>';
  return `<h2>Connect your billing software</h2>
  <div class="card stack">
    <label class="field" for="pos-type">Your POS software<select id="pos-type">${POS_TYPES.map(t => `<option ${t === s.posType ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="check" for="pos-stock"><input type="checkbox" id="pos-stock" ${s.posOpts.stock ? 'checked' : ''}> Take stock levels from POS</label>
    <label class="check" for="pos-price"><input type="checkbox" id="pos-price" ${s.posOpts.price ? 'checked' : ''}> Take MRP from POS</label>
  </div>
  <div class="card stack">
    <h3>Option 1: upload a stock file</h3>
    <p class="small muted">In ${esc(s.posType)}, export your item list or stock report as CSV with item name, stock and MRP columns, then upload it here.</p>
    <label class="btn" for="posfile" style="justify-self:start">Upload CSV file</label><input id="posfile" type="file" accept=".csv,.txt,text/csv" hidden>
    ${l ? `<div class="note ok"><b>${l.matched} items updated</b> ${when(l.at)}.${l.missedCount ? `<br><span class="small">${l.missedCount} not in the dawa4u catalogue: ${esc(l.missed.slice(0, 6).join(', '))}${l.missedCount > 6 ? '…' : ''}</span>` : ''}</div>` : ''}
  </div>
  <div class="card stack">
    <h3>Option 2: automatic sync by API</h3>
    <p class="small muted">Give these details to your ${esc(s.posType)} dealer or technician. Their software sends stock to dawa4u and reads new dawa4u orders for billing.</p>
    <label class="field">POS key (keep it secret)<input type="text" value="${esc(s.posKey)}" readonly id="pos-key"></label>
    <div class="row"><button class="btn sm ghost" data-act="copy-key">Copy key</button><button class="btn sm danger" data-act="new-key">Make a new key</button></div>
    <div class="tablebox"><pre class="small" style="margin:0;white-space:pre">Send stock:   POST ${esc(base)}/api/pos/stock
Header:       X-POS-Key: your key
Body (JSON):  {"items":[{"name":"PARACETAMOL 650 TAB","code":"","stock":120,"mrp":34}]}
              or the same CSV file as option 1

Read orders:  GET ${esc(base)}/api/pos/orders?since=0
Header:       X-POS-Key: your key</pre></div>
  </div>`;
}

// ---------- store / account ----------
function vMe() {
  const ph = P.data.pharmacy;
  return `<h2>${esc(ph.name)}</h2>
  <div class="card stack"><p class="small muted">${esc(ph.address)}</p><p>Delivers to PIN codes: <b>${ph.pins.map(esc).join(', ') || 'none set'}</b></p><p class="small muted">To change your PIN codes or address, contact the dawa4u admin.</p></div>
  <form class="card stack" id="pw-form"><h3>Change password</h3>
    <label class="field" for="pw-old">Current password<input type="password" id="pw-old" autocomplete="current-password" required></label>
    <label class="field" for="pw-new">New password, at least 8 characters<input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit" style="justify-self:start">Change password</button></form>
  <button class="btn ghost" data-act="logout">Log out</button>
  <p class="small muted">Install this app: in Chrome tap ⋮ then "Install app" or "Add to Home screen".</p>`;
}

// ---------- render + data ----------
const VIEWS = { orders: vOrders, stock: vStock, pos: vPos, me: vMe };
function render() { P.tab = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'orders'; shell(VIEWS[P.tab]()); }
async function load() {
  P.data = await api('/api/pharmacy');
  const fresh = P.data.open.filter(o => o.status === 'placed' && !P.seen.has(o.id));
  fresh.forEach(o => P.seen.add(o.id));
  if (fresh.length && !P.first) { toast(`New order ${fresh[0].id}`); try { navigator.vibrate?.([200, 100, 200]); } catch {} }
  P.first = false;
}
async function refresh() {
  if (document.hidden) return;
  const busy = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  const before = JSON.stringify(P.data?.open);
  await load().catch(() => {});
  if (!busy && JSON.stringify(P.data.open) !== before) render();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  const orderAct = a => act(b, async () => { await post(`/api/pharmacy/orders/${id}/${a}`, a === 'reject' ? { reason: 'Medicine not available' } : {}); await load(); render(); });
  ({
    accept: () => orderAct('accept'),
    packed: () => orderAct('packed').then(() => toast('Packed. A rider will be assigned.')),
    reject: () => { if (b.dataset.sure) orderAct('reject'); else { b.dataset.sure = 1; b.textContent = 'Tap again to reject'; } },
    rx: () => act(b, async () => {
      const res = await fetch((window.DAWA4U_API || '') + '/api/rx/' + id, { headers: { authorization: 'Bearer ' + store.get(TOKEN_KEY) } });
      if (!res.ok) throw new Error('Could not load the prescription photo.');
      P.rxUrls[id] = URL.createObjectURL(await res.blob()); render();
    }),
    'copy-key': () => navigator.clipboard.writeText(P.pos.posKey).then(() => toast('Key copied'), () => { $('#pos-key').select(); toast('Select and copy the key'); }),
    'new-key': () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again: the old key stops working'; return; }
      act(b, async () => { P.pos.posKey = (await post('/api/pharmacy/pos/new-key')).posKey; toast('New key made. Update it in your POS.'); render(); }); },
    logout: () => logout(),
  })[b.dataset.act]?.();
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'open-sw') act(null, async () => { await post('/api/pharmacy/open', { open: t.checked }); await load(); render(); toast(t.checked ? 'Store is open for orders' : 'Store closed'); });
  if (t.dataset.stock) act(null, async () => { await post('/api/pharmacy/stock/' + t.dataset.stock, { stock: t.value }); await load(); toast('Stock saved'); });
  if (['pos-type', 'pos-stock', 'pos-price'].includes(t.id)) act(null, async () => {
    await post('/api/pharmacy/pos/settings', { posType: $('#pos-type').value, stock: $('#pos-stock').checked, price: $('#pos-price').checked });
    P.pos = await api('/api/pharmacy/pos'); render();
  });
  if (t.id === 'posfile' && t.files[0]) act(null, async () => {
    const r = await api('/api/pharmacy/pos/import', { method: 'POST', raw: true, type: 'text/csv', body: await t.files[0].text() });
    P.pos.posLast = r.posLast; await load(); toast(`${r.posLast.matched} items updated`); render();
  });
});
document.addEventListener('input', e => { if (e.target.id === 'stock-q') { P.q = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#stock-q'); s.focus(); s.setSelectionRange(pos, pos); } });
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'pw-form') act(e.submitter, async () => { await post('/api/me/password', { old: $('#pw-old').value, new: $('#pw-new').value }); e.target.reset(); toast('Password changed'); });
});
window.addEventListener('hashchange', async () => { if (location.hash === '#pos' && !P.pos) P.pos = await api('/api/pharmacy/pos').catch(() => null); render(); window.scrollTo(0, 0); });

async function start() {
  try {
    await load();
    if (location.hash === '#pos') P.pos = await api('/api/pharmacy/pos');
    render(); setInterval(refresh, 4000);
  } catch (e) { $('#root').innerHTML = `<div class="login"><div class="card"><p class="err">${esc(e.message)}</p></div></div>`; }
}
registerApp();
(async () => {
  const me = store.get(TOKEN_KEY) && (await api('/api/me').catch(() => ({}))).user;
  if (me?.role === 'pharmacy') { P.user = me; start(); }
  else staffLogin($('#root'), 'pharmacy', 'Pharmacy', u => { P.user = u; start(); });
})();
