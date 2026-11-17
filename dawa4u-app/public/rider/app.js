// dawa4u Rider app (phone): go online, take a delivery, pick up, deliver with the customer's code.
const R = { data: null, tab: 'jobs', seen: new Set(), first: true };
const TABS = [['jobs', 'Deliveries', ICON.bike], ['money', 'Earnings', ICON.wallet], ['me', 'Account', ICON.user]];
const maps = q => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

function shell(body) {
  const d = R.data, on = d.user.online, n = d.available.length;
  document.title = (n ? `(${n}) ` : '') + 'dawa4u Rider';
  $('#root').innerHTML = `<div class="app">
    <header class="appbar"><a class="brand" href="#jobs" style="font-size:1.2rem"><i style="background:var(--sun)">+</i><span>dawa<b>4u</b></span></a>
      <span class="small muted" style="flex:1">${esc(d.user.name)}</span>
      <label class="row small" for="online-sw" style="gap:6px;flex-wrap:nowrap"><b>${on ? 'Online' : 'Offline'}</b><span class="switch"><input type="checkbox" id="online-sw" ${on ? 'checked' : ''} aria-label="Online for deliveries"><span></span></span></label>
    </header>
    <main class="appmain">${body}</main>
    <nav class="tabs" aria-label="Sections">${TABS.map(([k, l, i]) => `<a href="#${k}" class="${R.tab === k ? 'on' : ''}">${i}${l}${k === 'jobs' && n ? `<span class="dot">${n}</span>` : ''}</a>`).join('')}</nav>
  </div>`;
}

function jobCard(o, mine) {
  const ph = o.pharmacy, cod = o.payMethod === 'cod';
  const step = !mine ? `<button class="btn big" data-act="take" data-id="${o.id}">Accept delivery</button>`
    : o.status === 'packed' ? `<button class="btn big" data-act="pickup" data-id="${o.id}">Picked up from pharmacy</button>`
    : `<form class="stack" data-deliver="${o.id}"><label class="field" for="otp-${o.id}">Customer's 4-digit code<input type="text" id="otp-${o.id}" inputmode="numeric" maxlength="4" autocomplete="off" required></label>
        <button class="btn big" type="submit">${cod ? `Collected ${rs(o.total)}, confirm delivery` : 'Confirm delivery'}</button></form>`;
  const goPharmacy = !mine || o.status === 'packed';
  return `<div class="card stack">
    <div class="row spread"><b>${o.id}</b>${mine ? `<span class="pill sun">${o.status === 'packed' ? 'Go to pharmacy' : 'Deliver now'}</span>` : `<span class="pill">${rs(R.data.stats.perDelivery)} for this trip</span>`}</div>
    <div class="stack" style="gap:8px">
      <div class="${goPharmacy ? '' : 'muted'}"><span class="small muted">1. Pick up</span><br><b>${esc(ph?.name)}</b><br><span class="small">${esc(ph?.address)}</span>
        ${goPharmacy && mine ? `<br><a class="small" href="${maps(ph.name + ', ' + ph.address)}" target="_blank" rel="noopener">Directions to pharmacy</a>` : ''}</div>
      <div><span class="small muted">2. Drop</span><br><b>${esc(o.customer?.name || 'Customer')}</b><br><span class="small">${esc(o.address)}, ${esc(o.pin)}</span>
        ${mine && o.status === 'picked' ? `<br><span class="row small"><a href="${maps(o.address + ' ' + o.pin)}" target="_blank" rel="noopener">Directions</a>${o.customer?.phone ? `<a href="tel:+91${esc(o.customer.phone)}">Call ${esc(o.customer.phone)}</a>` : ''}</span>` : ''}</div>
    </div>
    <p class="small"><span class="muted">${o.items.reduce((a, i) => a + i.qty, 0)} items ·</span> ${cod ? `<b>Collect ${rs(o.total)} cash or UPI</b>` : 'Already paid, collect nothing'}</p>
    ${step}
  </div>`;
}
function vJobs() {
  const d = R.data;
  return `${d.mine.length ? `<h2>Your delivery</h2>${d.mine.map(o => jobCard(o, true)).join('')}` : ''}
  <h2>New deliveries near you</h2>
  ${!d.user.online ? '<div class="card empty">You are offline. Switch Online at the top to get deliveries.</div>'
    : d.available.length ? d.available.map(o => jobCard(o, false)).join('') : '<div class="card empty">No deliveries right now. Packed orders appear here by themselves.</div>'}`;
}
function vMoney() {
  const s = R.data.stats;
  return `<h2>Earnings</h2>
  <div class="stats">
    <div class="card stat"><span class="muted small">Deliveries today</span><b class="num">${s.today}</b></div>
    <div class="card stat"><span class="muted small">Earned today</span><b class="num">${rs(s.earnedToday)}</b></div>
    <div class="card stat"><span class="muted small">Not yet paid to you</span><b class="num">${rs(s.unpaid)}</b></div>
    <div class="card stat"><span class="muted small">Cash to hand over</span><b class="num">${rs(s.cashToDeposit)}</b></div>
  </div>
  <p class="small muted">You earn ${rs(s.perDelivery)} per delivery. dawa4u settles your pay and the cash you collected together.</p>
  <h2>Recent deliveries</h2>
  <div class="card">${R.data.history.map(o => `<div class="line"><span><b>${o.id}</b><br><span class="small muted">${when(o.ts.delivered)} · ${o.payMethod === 'cod' ? 'cash ' + rs(o.total) : 'prepaid'}</span></span><span class="num">${rs(s.perDelivery)}</span></div>`).join('') || '<p class="empty">No deliveries yet.</p>'}</div>`;
}
function vMe() {
  const u = R.data.user;
  return `<h2>${esc(u.name)}</h2>
  <div class="card"><p class="small muted">Username ${esc(u.username)} · ${esc(u.phone || '')}</p></div>
  <form class="card stack" id="pw-form"><h3>Change password</h3>
    <label class="field" for="pw-old">Current password<input type="password" id="pw-old" autocomplete="current-password" required></label>
    <label class="field" for="pw-new">New password, at least 8 characters<input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit" style="justify-self:start">Change password</button></form>
  <button class="btn ghost" data-act="logout">Log out</button>
  <p class="small muted">Install this app: in Chrome tap ⋮ then "Install app" or "Add to Home screen".</p>`;
}

const VIEWS = { jobs: vJobs, money: vMoney, me: vMe };
function render() { R.tab = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'jobs'; shell(VIEWS[R.tab]()); }
async function load() {
  R.data = await api('/api/rider');
  const fresh = R.data.available.filter(o => !R.seen.has(o.id)); fresh.forEach(o => R.seen.add(o.id));
  if (fresh.length && !R.first) { toast('New delivery available'); try { navigator.vibrate?.([200, 100, 200]); } catch {} }
  R.first = false;
}
async function refresh() {
  if (document.hidden) return;
  const before = JSON.stringify([R.data?.available.map(o => o.id), R.data?.mine.map(o => o.status)]);
  await load().catch(() => {});
  if (!/INPUT/.test(document.activeElement?.tagName) && JSON.stringify([R.data.available.map(o => o.id), R.data.mine.map(o => o.status)]) !== before) render();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  const job = (a, msg) => act(b, async () => { await post(`/api/rider/jobs/${id}/${a}`); await load(); toast(msg); render(); });
  ({ take: () => job('take', 'Delivery is yours. Go to the pharmacy.'), pickup: () => job('pickup', 'Picked up. Deliver within the 15 minutes.'), logout: () => logout() })[b.dataset.act]?.();
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.deliver) act(e.submitter, async () => {
    const id = f.dataset.deliver;
    await post(`/api/rider/jobs/${id}/deliver`, { otp: $('#otp-' + id).value.trim() });
    await load(); toast(`Delivered. ${rs(R.data.stats.perDelivery)} added to your earnings.`); render();
  });
  if (f.id === 'pw-form') act(e.submitter, async () => { await post('/api/me/password', { old: $('#pw-old').value, new: $('#pw-new').value }); f.reset(); toast('Password changed'); });
});
document.addEventListener('change', e => {
  if (e.target.id === 'online-sw') act(null, async () => { await post('/api/rider/online', { online: e.target.checked }); await load(); render(); toast(e.target.checked ? 'You are online' : 'You are offline'); });
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

async function start() {
  try { await load(); render(); setInterval(refresh, 4000); }
  catch (e) { $('#root').innerHTML = `<div class="login"><div class="card"><p class="err">${esc(e.message)}</p></div></div>`; }
}
registerApp();
(async () => {
  const me = store.get(TOKEN_KEY) && (await api('/api/me').catch(() => ({}))).user;
  if (me?.role === 'rider') start();
  else staffLogin($('#root'), 'rider', 'Rider', () => start());
})();
