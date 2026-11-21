// =====================================================================
// dawa4u ADMIN dashboard (owner, desktop). Everything in one place:
// Overview · Orders · UPI payments · Refunds · Pharmacies · Riders & payouts · Customers · Medicines · dawaPass · Leads · Support · Settings
// =====================================================================
import { auth, me, adminApi as api, rupee, esc, when, timeAgo, toast, ICON, CATS, STATUS, payLabel, live, getSettings, errText } from '../common/api.js';
import { $, $$, busy, authScreen, shell, toCsv, download } from '../common/partner.js';
import { makeMap, pinIcon, INDIA } from '../common/map.js';
import { sb } from '../common/api.js';

const root = $('#root');
const S = { user: null, profile: null, stats: null, cache: {}, q: '', status: '' };

async function boot() {
  root.innerHTML = '<div class="spin"></div>';
  S.user = await auth.user();
  if (!S.user) return authScreen(root, { title: 'Admin login', subtitle: 'dawa4u owner dashboard', allowSignup: false, onDone: boot });
  S.profile = await me.profile();
  if (!S.profile || S.profile.role !== 'admin') {
    root.innerHTML = `<div class="auth"><div class="card"><b class="s18">This account is not an admin</b><span class="mute">Logged in as ${esc(S.user.email || S.user.phone)}. Make an account admin once in Supabase → SQL editor:<br><code style="font-size:12px">update profiles set role='admin' where email='${esc(S.user.email || '')}';</code></span><button class="btn ghost" id="lo">Log out</button></div></div>`;
    $('#lo').onclick = async () => { await auth.signOut(); boot(); }; return;
  }
  S.stats = await api.stats();
  live('orders', async () => { S.stats = await api.stats().catch(() => S.stats); const p = page(); if (['overview', 'orders', 'upi'].includes(p) && !typing()) render(); }, { poll: 15000 });
  addEventListener('hashchange', render);
  render();
}
const typing = () => document.activeElement && document.activeElement.matches('input,textarea,select') || $('.modal');
const page = () => (location.hash.split('/')[1] || 'overview');
const pill = s => `<span class="pill ${s === 'cancelled' || s === 'suspended' ? 'bad' : s === 'pending_payment' || s === 'pending' || s === 'placed' ? 'warn' : s === 'delivered' || s === 'active' ? '' : 'grey'}">${esc(STATUS[s] || s)}</span>`;

const pages = {
  async overview() {
    const s = S.stats, live = await api.orders('placed,accepted,packed,picked');
    const max = Math.max(1, ...s.week.map(d => d.gmv));
    return `<div class="tiles">
      ${[['Orders today', s.orders_today], ['Sales today', rupee(s.gmv_today)], ['Live orders', s.live], ['Delivered today', s.delivered_today], ['Avg delivery (7d)', s.avg_minutes == null ? '—' : s.avg_minutes + ' min'],
        ['dawaPass members', s.pass_members], ['Customers', s.customers], ['Riders online', s.riders_online]].map(([k, v]) => `<div class="card tile"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
      ${s.upi_to_check || s.pharmacies_pending || s.riders_pending || s.refunds_due || s.rx_waiting ? `<div class="row wrap">
        ${s.upi_to_check ? `<a href="#/upi" class="pill bad" style="font-size:13px;padding:8px 14px">${s.upi_to_check} UPI payment to check</a>` : ''}
        ${s.pharmacies_pending ? `<a href="#/pharmacies" class="pill warn" style="font-size:13px;padding:8px 14px">${s.pharmacies_pending} pharmacy waiting for approval</a>` : ''}
        ${s.riders_pending ? `<a href="#/riders" class="pill warn" style="font-size:13px;padding:8px 14px">${s.riders_pending} rider waiting for approval</a>` : ''}
        ${s.refunds_due ? `<a href="#/refunds" class="pill bad" style="font-size:13px;padding:8px 14px">${s.refunds_due} refund to send</a>` : ''}
        ${s.rx_waiting ? `<span class="pill gold" style="font-size:13px;padding:8px 14px">${s.rx_waiting} prescriptions with pharmacists</span>` : ''}</div>` : ''}
      <div class="card pad stack"><div class="row between"><span class="serif s18">Live map</span><span class="s12 mute">Riders (gold) · pharmacies (green) · live order drops (cream) · updates every 15 s</span></div>
        <div id="livemap" style="height:420px;border-radius:14px;overflow:hidden;background:var(--sand)"></div></div>
      <div class="cols">
        <div class="card pad stack"><span class="serif s18">Last 7 days</span>
          <div class="bars">${s.week.map(d => `<div><span class="s11 b">${d.gmv ? rupee(d.gmv) : ''}</span><span class="bar" style="height:${Math.round(d.gmv / max * 100)}%"></span><span class="s11 mute">${new Date(d.day).toLocaleDateString('en-IN', { weekday: 'short' })} · ${d.orders}</span></div>`).join('')}</div></div>
        <div class="card pad stack"><span class="serif s18">Live orders</span>
          ${live.map(o => `<a href="#/orders/${o.id}" class="row between" style="text-decoration:none;color:inherit"><span><b>${o.id}</b> <span class="s12 mute">${esc(o.pharmacy_name)} · ${timeAgo(o.placed_at || o.created_at)}</span></span>${pill(o.status)}</a>`).join('') || '<span class="mute">Nothing live right now</span>'}</div>
        <div class="card pad stack"><span class="serif s18">Money</span>
          <div class="row between"><span class="mute">Rider pay owed</span><b>${rupee(s.rider_unpaid)}</b></div>
          <div class="row between"><span class="mute">Refunds to send</span><b>${s.refunds_due}</b></div>
          <a href="#/riders" class="s13 b">Rider payouts →</a></div>
      </div>`;
  },
  async orders(id) {
    if (id) return orderDetail(id);
    const rows = await api.orders(S.status, S.q);
    S.cache.orders = rows;
    return `<div class="row wrap"><input class="inp" id="oq" placeholder="Search order no., phone or name" value="${esc(S.q)}" style="width:300px">
        <select class="inp" id="ost"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn ghost sm" id="oexp" style="margin-left:auto">Download CSV</button></div>
      <div class="card" style="overflow:auto"><table><thead><tr><th>Order</th><th>When</th><th>Customer</th><th>Pharmacy</th><th>Rider</th><th>Payment</th><th>Status</th><th style="text-align:right">Total</th></tr></thead><tbody>
      ${rows.map(o => `<tr style="cursor:pointer" data-href="#/orders/${o.id}"><td><b>${o.id}</b></td><td class="s13">${when(o.created_at)}</td><td class="s13">${esc(o.customer_name || '—')}<div class="s12 mute">${esc(o.customer_phone)}</div></td><td class="s13">${esc(o.pharmacy_name)}</td><td class="s13">${esc(o.rider_name || '—')}</td>
        <td class="s13">${payLabel(o.pay_method)}<div class="s12 mute">${o.pay_status}${o.pay_test ? ' (test)' : ''}</div></td><td>${pill(o.status)}</td><td style="text-align:right"><b>${rupee(o.total)}</b></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">No orders</div></td></tr>'}
      </tbody></table></div>`;
  },
  async refunds() {
    const rows = await api.refunds();
    return `<span class="mute">Orders cancelled after the customer paid. UPI: send the money back from your UPI / bank app to the customer's UPI. Card / netbanking: refund in the Cashfree dashboard (Transactions → find the payment → Refund). Then mark it refunded here.</span>
      <div class="card"><table><thead><tr><th>Order</th><th>Cancelled</th><th>Reason</th><th>Customer</th><th>Payment ref</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>
      ${rows.map(o => `<tr><td><b>${o.id}</b></td><td class="s13">${when(o.cancelled_at)}</td><td class="s13">${esc(o.cancel_reason)}</td><td class="s13">${esc(o.customer_phone)}</td><td class="s12">${o.upi_ref ? 'UPI <code>' + esc(o.upi_ref) + '</code>' : `<code>${esc(o.razorpay_payment_id || '—')}</code>`}</td><td style="text-align:right"><b>${rupee(o.total)}</b></td>
        <td><button class="btn sm" data-refunded="${o.id}">Mark refunded</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No refunds pending 🎉</div></td></tr>'}</tbody></table></div>`;
  },
  async pharmacies() {
    const rows = await api.pharmacies(); S.cache.ph = rows;
    return `<div class="card" style="overflow:auto"><table><thead><tr><th>Pharmacy</th><th>Licence</th><th>City · PIN codes</th><th>Phone</th><th>Open</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><b>${esc(p.name)}</b><div class="s12 mute">${esc(p.address)}</div></td><td class="s13">${esc(p.licence_no)}</td>
        <td class="s13">${esc(p.city)}<div><input class="inp" style="width:220px;padding:6px 8px;font-size:12px" data-pins="${p.id}" value="${esc(p.pins.join(', '))}"></div></td><td class="s13">${esc(p.phone)}</td>
        <td>${p.open ? '<span class="pill">Open</span>' : '<span class="pill grey">Closed</span>'}</td><td>${pill(p.status)}</td>
        <td class="row" style="gap:6px">${p.status !== 'active' ? `<button class="btn sm" data-partner="pharmacy" data-id="${p.id}" data-st="active">Approve</button>` : `<button class="btn sm danger" data-partner="pharmacy" data-id="${p.id}" data-st="suspended">Suspend</button>`}
          <button class="btn sm ghost" data-savepins="${p.id}">Save PINs</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No pharmacies yet. Partners sign up at /pharmacy/</div></td></tr>'}</tbody></table></div>`;
  },
  async riders() {
    const [rows, unpaid] = await Promise.all([api.riders(), api.riderPayouts()]);
    const owed = {}; unpaid.forEach(o => { (owed[o.rider_id] = owed[o.rider_id] || { name: o.rider_name, total: 0, ids: [] }); owed[o.rider_id].total += o.rider_pay; owed[o.rider_id].ids.push(o.id); });
    S.cache.owed = owed;
    return `<div class="card" style="overflow:auto"><table><thead><tr><th>Rider</th><th>Phone</th><th>Vehicle</th><th>City</th><th>Online</th><th>Status</th><th>Pay owed</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b><div class="s12 mute">joined ${when(r.created_at)}</div></td><td class="s13">+${esc(r.phone)}</td><td class="s13">${esc(r.vehicle)}</td><td class="s13">${esc(r.city)}</td>
        <td>${r.online ? '<span class="pill">Online</span>' : '<span class="pill grey">Off</span>'}</td><td>${pill(r.status)}</td>
        <td>${owed[r.id] ? `<b>${rupee(owed[r.id].total)}</b> <span class="s12 mute">(${owed[r.id].ids.length} trips)</span>` : '—'}</td>
        <td class="row" style="gap:6px">${r.status !== 'active' ? `<button class="btn sm" data-partner="rider" data-id="${r.id}" data-st="active">Approve</button>` : `<button class="btn sm danger" data-partner="rider" data-id="${r.id}" data-st="suspended">Suspend</button>`}
          ${owed[r.id] ? `<button class="btn sm gold" data-payrider="${r.id}">Mark paid</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">No riders yet. Riders sign up in the rider app.</div></td></tr>'}</tbody></table></div>
      <span class="s12 mute">Pay riders by UPI/bank, then press "Mark paid". Pay per delivery is set in Settings.</span>`;
  },
  async customers() {
    const rows = await api.customers(S.cq);
    return `<input class="inp" id="cq" placeholder="Search phone, name or email" value="${esc(S.cq || '')}" style="width:300px">
      <div class="card" style="overflow:auto"><table><thead><tr><th>Name</th><th>Phone / email</th><th>Role</th><th>Joined</th><th>dawaPass</th><th></th></tr></thead><tbody>
      ${rows.map(c => { const on = c.pass_until && new Date(c.pass_until) > new Date(); return `<tr><td><b>${esc(c.name || '—')}</b></td><td class="s13">${esc(c.phone ? '+' + c.phone : c.email || '')}</td><td><span class="pill grey">${c.role}</span></td><td class="s13">${when(c.created_at)}</td>
        <td>${on ? `<span class="pill gold">till ${new Date(c.pass_until).toLocaleDateString('en-IN')}</span>` : '—'}</td>
        <td><button class="btn sm ghost" data-givepass="${c.id}">${on ? '+30 days' : 'Give 30 days'}</button></td></tr>`; }).join('')}</tbody></table></div>`;
  },
  async medicines() {
    const rows = await api.products(); S.cache.products = rows;
    return `<div class="row"><button class="btn" data-editprod="">+ Add medicine</button><span class="mute s13">Prescription (Rx) medicines can only be ordered after a pharmacist verifies the prescription.</span></div>
      <div class="card" style="overflow:auto;max-height:72vh"><table><thead><tr><th>Medicine</th><th>Category</th><th>Pack</th><th>MRP</th><th>Rx</th><th>POS code</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><b>${esc(p.name)}</b><div class="s12 mute">${esc(p.salt)}</div></td><td class="s13">${esc((CATS.find(c => c.id === p.category) || {}).label || p.category)}</td><td class="s13">${esc(p.pack)}</td><td>${rupee(p.mrp)}</td>
        <td>${p.rx ? '<span class="pill gold">Rx</span>' : ''}</td><td class="s12"><code>${esc(p.pos_code || '')}</code></td><td>${p.active ? '<span class="pill">Selling</span>' : '<span class="pill grey">Hidden</span>'}</td>
        <td><button class="btn sm ghost" data-editprod="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  },
  async dawapass() {
    const rows = await api.passes();
    const month = rows.filter(r => new Date(r.created_at) > new Date(Date.now() - 30 * 864e5));
    return `<div class="tiles"><div class="card tile"><span class="k">Active members</span><span class="v">${S.stats.pass_members}</span></div>
      <div class="card tile"><span class="k">Sold in last 30 days</span><span class="v">${month.length}</span></div>
      <div class="card tile"><span class="k">Revenue (30 days)</span><span class="v">${rupee(month.reduce((a, r) => a + r.amount, 0))}</span></div></div>
      <div class="card"><table><thead><tr><th>Bought</th><th>Customer id</th><th>Order</th><th>Valid</th><th style="text-align:right">Paid</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="s13">${when(r.created_at)}</td><td class="s12"><code>${esc(r.user_id.slice(0, 8))}</code></td><td><a href="#/orders/${esc(r.order_id || '')}">${esc(r.order_id || '—')}</a></td><td class="s13">${new Date(r.starts_at).toLocaleDateString('en-IN')} → ${new Date(r.ends_at).toLocaleDateString('en-IN')}</td><td style="text-align:right">${rupee(r.amount)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No dawaPass sales yet</div></td></tr>'}</tbody></table></div>`;
  },
  async leads() {
    const rows = await api.applications();
    return `<span class="mute">People who filled "Become a partner" or "Join as a rider" on the website. Call them, then tick done.</span>
      <div class="card"><table><thead><tr><th>When</th><th>Type</th><th>Name</th><th>Phone</th><th>Detail</th><th>City</th><th>Done</th></tr></thead><tbody>
      ${rows.map(a => `<tr style="${a.handled ? 'opacity:.5' : ''}"><td class="s13">${when(a.created_at)}</td><td><span class="pill ${a.kind === 'pharmacy' ? '' : 'gold'}">${a.kind}</span></td><td><b>${esc(a.name)}</b></td><td class="s13">${esc(a.phone)}</td><td class="s13">${esc(a.detail)}</td><td class="s13">${esc(a.city)}</td>
        <td><input type="checkbox" data-lead="${a.id}" ${a.handled ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--em-text)"></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No leads yet</div></td></tr>'}</tbody></table></div>`;
  },
  async upi() {
    const rows = await api.upiToCheck(), set = await getSettings();
    return `<div class="card pad stack" style="gap:6px"><span class="serif s18">UPI payments to check</span>
        <span class="s13 mute">These customers paid ${set.upi_id ? 'to <b>' + esc(set.upi_id) + '</b>' : 'by UPI'} with the QR code and tapped "I have paid". Open your UPI app, find a payment of the same amount (its note says <b>dawa4u</b> and the order number), then confirm it. Confirmed orders go straight to the pharmacy. Once Cashfree is set up, UPI payments are confirmed automatically and this list stays empty.</span></div>
      <div class="card" style="overflow:auto"><table><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Look for (note in UPI app)</th><th>Paid at</th><th></th></tr></thead><tbody>
      ${rows.map(o => `<tr><td><a href="#/orders/${o.id}"><b>${o.id}</b></a>${o.status === 'cancelled' ? ' <span class="pill bad">cancelled</span>' : ''}</td><td>${esc(o.customer_name || '—')}<br><span class="s12 mute">+${esc(o.customer_phone)}</span></td>
        <td><b>${rupee(o.total)}</b></td><td><code style="font-size:13px">dawa4u ${esc(o.id)}</code>${o.upi_ref ? `<br><span class="s12 mute">ref ${esc(o.upi_ref)}</span>` : ''}</td><td class="s13">${timeAgo(o.upi_submitted_at || o.created_at)}</td>
        <td><div class="row" style="gap:8px;justify-content:flex-end"><button class="btn sm" data-upiok="${o.id}">Money received</button><button class="btn ghost sm" data-upino="${o.id}">Not received</button></div></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No UPI payments waiting</div></td></tr>'}</tbody></table></div>`;
  },
  async support() {
    const rows = await api.tickets();
    return `<div class="stack">${rows.map(t => `<div class="card pad stack" style="gap:8px"><div class="row between"><b>${esc(t.subject)}</b><span class="row" style="gap:8px">${t.order_id ? `<a href="#/orders/${esc(t.order_id)}" class="s13">${esc(t.order_id)}</a>` : ''}<span class="pill ${t.status === 'open' ? 'warn' : ''}">${t.status}</span><span class="s12 mute">${timeAgo(t.created_at)}</span></span></div>
      <span>${esc(t.message)}</span>${t.reply ? `<span class="s13" style="color:var(--em-text)"><b>Reply:</b> ${esc(t.reply)}</span>` : `<div class="row"><input class="inp grow" data-replybox="${t.id}" placeholder="Write a reply…"><button class="btn sm" data-reply="${t.id}">Send & close</button></div>`}</div>`).join('') || '<div class="card empty">No support messages</div>'}</div>`;
  },
  async settings() {
    const s = await getSettings();
    const f = (k, l, h) => `<label class="field">${l}<input class="inp" type="number" min="0" data-set="${k}" value="${s[k]}">${h ? `<span class="s12 mute" style="font-weight:500">${h}</span>` : ''}</label>`;
    return `<div class="cols"><div class="card pad stack"><span class="serif s18">Fees & dawaPass</span>
        ${f('delivery_fee', 'Delivery fee (₹)', 'Free for dawaPass members')}${f('handling_fee', 'Handling fee (₹)')}${f('pass_price', 'dawaPass price (₹ / 30 days)')}${f('pass_off', 'dawaPass discount (%)')}
        ${f('rider_pay', 'Rider pay per delivery (₹)')}${f('payment_minutes', 'Cancel unpaid online orders after (minutes)')}</div>
      <div class="card pad stack"><span class="serif s18">Payments</span>
        <label class="field">Your UPI ID (customers pay here)<input class="inp" data-settext="upi_id" value="${esc(s.upi_id || '')}" placeholder="e.g. dawa4u@okaxis or 98xxxxxxxx@ybl"><span class="s12 mute" style="font-weight:500">Used only until Cashfree is set up: customers scan a QR for this ID and you confirm each payment in Admin → UPI payments. With Cashfree, UPI is confirmed automatically.</span></label>
        <label class="field">Name shown in the UPI app<input class="inp" data-settext="upi_name" value="${esc(s.upi_name || 'dawa4u')}"></label>
        <span class="s13 mute">UPI, cards &amp; netbanking go through Cashfree (confirmed automatically) once its keys are added in Supabase → Edge Functions → Secrets.</span>
        <div class="row between"><div class="stack" style="gap:2px"><b>Test mode</b><span class="s12 mute">ON = orders go through without real payment while UPI ID / Cashfree are not set up. Turn OFF before launch.</span></div><button class="switch ${s.payments_test_mode ? 'on' : ''}" data-toggle="payments_test_mode"></button></div>
        <span class="serif s18" style="margin-top:8px">Banner on the shop</span>
        <label class="field">Announcement (leave empty to hide)<input class="inp" data-settext="announcement" value="${esc(s.announcement)}" placeholder="e.g. Diwali: dawaPass at ₹49 this week"></label>
        <button class="btn" id="saveset" style="align-self:flex-start">Save settings</button></div></div>`;
  }
};

async function orderDetail(id) {
  const o = (await api.orders('', id)).find(x => x.id === id);
  if (!o) return '<div class="empty">Order not found</div>';
  const steps = [['Created', o.created_at], ['Placed', o.placed_at], ['Accepted', o.accepted_at], ['Packed', o.packed_at], ['Picked up', o.picked_at], ['Delivered', o.delivered_at], ['Cancelled', o.cancelled_at]].filter(x => x[1]);
  return `<a href="#/orders" class="btn ghost sm" style="align-self:flex-start">${ICON.back} All orders</a>
    <div class="cols">
      <div class="card pad stack"><div class="row between"><span class="serif s18">${o.id}</span>${pill(o.status)}</div>
        ${o.order_items.map(i => `<div class="row between"><span>${i.qty} × ${esc(i.name)} ${i.rx ? '<span class="pill gold">Rx</span>' : ''}</span><span>${rupee(i.price * i.qty)}</span></div>`).join('')}
        <div class="hr"></div>
        ${[['MRP total', o.mrp_total], ['Items', o.sub], ['dawaPass discount', -o.disc], ['Delivery', o.delivery], ['Handling', o.handling], ['dawaPass fee', o.pass_fee]].filter(x => x[1]).map(([k, v]) => `<div class="row between s13"><span class="mute">${k}</span><span>${v < 0 ? '− ' + rupee(-v) : rupee(v)}</span></div>`).join('')}
        <div class="row between"><b>Total</b><b>${rupee(o.total)}</b></div>
        <span class="s13">${payLabel(o.pay_method)} · ${o.pay_status}${o.pay_test ? ' (test mode)' : ''}${o.upi_ref ? ' · UPI ref <code>' + esc(o.upi_ref) + '</code>' : ''}${o.razorpay_payment_id ? ' · ' + esc(o.pay_gateway || 'gateway') + ' <code>' + esc(o.razorpay_payment_id) + '</code>' : ''}</span>
        ${o.pay_status === 'verifying' ? `<div class="row"><button class="btn sm" data-upiok="${o.id}">UPI money received</button><button class="btn ghost sm" data-upino="${o.id}">Not received</button></div>` : ''}
        ${o.cancel_reason ? `<span class="pill bad" style="white-space:normal">${esc(o.cancel_reason)}</span>` : ''}</div>
      <div class="card pad stack"><span class="serif s18">People</span>
        <div class="stack s13" style="gap:6px"><span><b>Customer:</b> ${esc(o.customer_name || '—')} · +${esc(o.customer_phone)}</span><span><b>Deliver to:</b> ${esc(o.address_label)}, ${esc(o.address_line)} · ${esc(o.pin)}</span>
          <span><b>Pharmacy:</b> ${esc(o.pharmacy_name)} · ${esc(o.pharmacy_address)}</span><span><b>Rider:</b> ${esc(o.rider_name || '—')} ${o.rider_phone ? '· +' + esc(o.rider_phone) : ''} · pay ${rupee(o.rider_pay)} ${o.rider_paid ? '(paid)' : ''}</span></div>
        <span class="serif s18">Timeline</span>${steps.map(([k, v]) => `<div class="row between s13"><span>${k}</span><span class="mute">${when(v)}</span></div>`).join('')}
        ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn danger" data-cancel="${o.id}" style="align-self:flex-start">Cancel order</button>` : ''}</div>
    </div>`;
}

async function render() {
  const [, p, id] = (location.hash || '#/overview').split('/');
  const pg = pages[p] ? p : 'overview';
  S.stats = await api.stats().catch(() => S.stats);
  const s = S.stats || {};
  const nav = [
    { id: 'overview', label: 'Overview', icon: ICON.chart }, { id: 'orders', label: 'Orders', icon: ICON.orders, count: s.live },
    { id: 'upi', label: 'UPI payments', icon: ICON.rupee, count: s.upi_to_check }, { id: 'refunds', label: 'Refunds', icon: ICON.rupee, count: s.refunds_due }, { id: 'pharmacies', label: 'Pharmacies', icon: ICON.store, count: s.pharmacies_pending },
    { id: 'riders', label: 'Riders & payouts', icon: ICON.bike.replace('stroke="#111827"', 'stroke="currentColor"'), count: s.riders_pending },
    { id: 'customers', label: 'Customers', icon: ICON.users }, { id: 'medicines', label: 'Medicines', icon: ICON.box }, { id: 'dawapass', label: 'dawaPass', icon: ICON.check },
    { id: 'leads', label: 'Partner leads', icon: ICON.link }, { id: 'support', label: 'Support', icon: ICON.help }, { id: 'settings', label: 'Settings', icon: ICON.gear }];
  const title = (nav.find(n => n.id === pg) || {}).label;
  shell(root, { nav, active: pg, title, who: S.profile.name || S.user.email, right: `<span class="s13 mute">${esc(S.user.email || '')}</span>`, body: '<div class="spin"></div>' });
  try { $('#content').innerHTML = await pages[pg](id); } catch (e) { $('#content').innerHTML = `<div class="card empty"><b>${esc(errText(e))}</b></div>`; }
  if (pg === 'overview') liveMap().catch(() => { const m = $('#livemap'); if (m) m.innerHTML = '<div class="empty">Map could not load</div>'; });
  const f = $('#oq') || $('#cq'); if (f && (S.q || S.cq) && S.refocus) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); S.refocus = false; }
}

async function liveMap() {
  const el = $('#livemap'); if (!el) return;
  const [{ data: locs }, { data: riders }, { data: phs }, live] = await Promise.all([
    sb.from('rider_locations').select('*'), sb.from('riders').select('id,name,online,status'), sb.from('pharmacies').select('id,name,lat,lng,status,open'), api.orders('placed,accepted,packed,picked')]);
  const { L, map } = await makeMap(el, { center: INDIA, zoom: 5 });
  const pts = [], fresh = Date.now() - 10 * 60000;
  (phs || []).filter(p => p.lat != null && p.status === 'active').forEach(p => { L.marker([p.lat, p.lng], { icon: pinIcon(L, 'pharmacy') }).addTo(map).bindTooltip(`${esc(p.name)} · ${p.open ? 'open' : 'closed'}`); pts.push([p.lat, p.lng]); });
  (live || []).filter(o => o.drop_lat != null).forEach(o => { L.marker([o.drop_lat, o.drop_lng], { icon: pinIcon(L, 'home') }).addTo(map).bindTooltip(`${o.id} · ${esc(STATUS[o.status])}`).on('click', () => { location.hash = '#/orders/' + o.id; }); pts.push([o.drop_lat, o.drop_lng]); });
  const name = Object.fromEntries((riders || []).map(r => [r.id, r]));
  (locs || []).filter(l => new Date(l.updated_at).getTime() > fresh).forEach(l => { L.marker([l.lat, l.lng], { icon: pinIcon(L, 'rider') }).addTo(map).bindTooltip(`${esc((name[l.rider_id] || {}).name || 'Rider')} · ${timeAgo(l.updated_at)}`); pts.push([l.lat, l.lng]); });
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
}

function productModal(p) {
  p = p || { name: '', salt: '', pack: '', category: 'fever', mrp: '', rx: false, pos_code: '', active: true };
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card stack" style="max-width:560px"><span class="serif s18">${p.id ? 'Edit medicine' : 'Add medicine'}</span>
    <label class="field">Name<input id="m-name" value="${esc(p.name)}"></label><label class="field">Salt / composition<input id="m-salt" value="${esc(p.salt)}"></label>
    <div class="row"><label class="field grow">Pack<input id="m-pack" value="${esc(p.pack)}" placeholder="Strip of 10 tablets"></label><label class="field" style="width:120px">MRP ₹<input id="m-mrp" type="number" min="1" value="${esc(p.mrp)}"></label></div>
    <div class="row"><label class="field grow">Category<select id="m-cat" class="inp">${CATS.map(c => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label><label class="field grow">POS item code (Marg)<input id="m-pos" value="${esc(p.pos_code || '')}"></label></div>
    <label class="row"><input type="checkbox" id="m-rx" ${p.rx ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--em-text)"> Prescription medicine (Rx)</label>
    <label class="row"><input type="checkbox" id="m-act" ${p.active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--em-text)"> Show in shop</label>
    <div class="row"><button class="btn" id="m-save">Save</button><button class="btn ghost" id="m-close">Close</button></div></div>`;
  document.body.appendChild(m);
  $('#m-close').onclick = () => m.remove();
  $('#m-save').onclick = e => busy(e.currentTarget, async () => {
    const row = { name: $('#m-name').value.trim(), salt: $('#m-salt').value.trim(), pack: $('#m-pack').value.trim(), mrp: +$('#m-mrp').value, category: $('#m-cat').value, pos_code: $('#m-pos').value.trim() || null, rx: $('#m-rx').checked, active: $('#m-act').checked };
    if (!row.name || !(row.mrp > 0)) throw new Error('Name and MRP are required');
    if (p.id) row.id = p.id;
    await api.saveProduct(row); m.remove(); toast('Saved'); render();
  });
}

document.addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('button,input,a')) { location.hash = tr.dataset.href; return; }
  const el = e.target.closest('button'); if (!el) return;
  if (el.dataset.partner) { const { partner, id, st } = el.dataset; if (st === 'suspended' && !confirm('Suspend this ' + partner + '? They will stop getting orders.')) return; return busy(el, async () => { await api.setPartner(partner, id, st); S.stats = await api.stats(); toast(st === 'active' ? 'Approved' : 'Suspended'); render(); }); }
  if (el.dataset.savepins) return busy(el, async () => { const pins = $(`[data-pins="${el.dataset.savepins}"]`).value.split(/[\s,]+/).filter(Boolean); if (pins.some(x => !/^[1-9]\d{5}$/.test(x))) throw new Error('PIN codes must be 6 digits'); await api.update('pharmacies', el.dataset.savepins, { pins }); toast('PIN codes saved'); });
  if (el.dataset.payrider) { const o = S.cache.owed[el.dataset.payrider]; if (!confirm(`Mark ${rupee(o.total)} paid to ${o.name}?`)) return; return busy(el, async () => { for (const id of o.ids) await api.update('orders', id, { rider_paid: true }); S.stats = await api.stats(); toast('Marked paid'); render(); }); }
  if (el.dataset.upiok) { if (!confirm('Did you see this exact amount for this order in your UPI app?')) return; return busy(el, async () => { const o = await api.upiReview(el.dataset.upiok, true); S.stats = await api.stats(); toast(o.status === 'placed' ? 'Confirmed — sent to the pharmacy' : 'Marked for refund (order was cancelled)'); render(); }); }
  if (el.dataset.upino) { const r = prompt('Message for the customer (order will be cancelled):', 'We could not find your UPI payment. If money left your account, write to support with your UPI reference.'); if (r === null) return; return busy(el, async () => { await api.upiReview(el.dataset.upino, false, r); S.stats = await api.stats(); toast('Order cancelled'); render(); }); }
  if (el.dataset.refunded) return busy(el, async () => { await api.update('orders', el.dataset.refunded, { pay_status: 'refunded' }); S.stats = await api.stats(); toast('Marked refunded'); render(); });
  if (el.dataset.givepass) return busy(el, async () => { const c = (await api.customers()).find(x => x.id === el.dataset.givepass); const base = c.pass_until && new Date(c.pass_until) > new Date() ? new Date(c.pass_until) : new Date(); await api.update('profiles', c.id, { pass_until: new Date(base.getTime() + 30 * 864e5).toISOString() }); toast('dawaPass given'); render(); });
  if (el.dataset.editprod !== undefined) return productModal((S.cache.products || []).find(p => p.id === el.dataset.editprod));
  if (el.dataset.cancel) { const r = prompt('Reason for cancelling (customer will see it):', 'Cancelled by dawa4u support'); if (r === null) return; return busy(el, async () => { await api.cancel(el.dataset.cancel, r); toast('Cancelled'); S.stats = await api.stats(); render(); }); }
  if (el.dataset.reply) return busy(el, async () => { const v = $(`[data-replybox="${el.dataset.reply}"]`).value.trim(); if (!v) throw new Error('Write a reply'); await api.replyTicket(el.dataset.reply, v); toast('Reply sent'); render(); });
  if (el.dataset.toggle) { el.classList.toggle('on'); return; }
  if (el.id === 'saveset') return busy(el, async () => { const s = {}; $$('[data-set]').forEach(i => { s[i.dataset.set] = Math.max(0, Math.round(+i.value || 0)); }); $$('[data-toggle]').forEach(b => { s[b.dataset.toggle] = b.classList.contains('on'); }); s.announcement = $('[data-settext="announcement"]').value.trim(); s.upi_id = $('[data-settext="upi_id"]').value.trim().toLowerCase(); s.upi_name = $('[data-settext="upi_name"]').value.trim() || 'dawa4u';
    if (s.upi_id && !/^[a-z0-9._-]{2,}@[a-z][a-z0-9.]{1,}$/.test(s.upi_id)) throw new Error('That does not look like a UPI ID (name@bank)'); await api.saveSettings(s); toast('Settings saved'); });
  if (el.id === 'oexp') return download('dawa4u-orders.csv', toCsv(S.cache.orders || [], [['Order', o => o.id], ['Created', o => o.created_at], ['Status', o => o.status], ['Customer', o => o.customer_name], ['Phone', o => o.customer_phone], ['Pharmacy', o => o.pharmacy_name], ['Rider', o => o.rider_name], ['Payment', o => o.pay_method], ['Pay status', o => o.pay_status], ['Items', o => o.sub], ['Discount', o => o.disc], ['Delivery', o => o.delivery], ['dawaPass fee', o => o.pass_fee], ['Total', o => o.total]]));
});
let qt;
document.addEventListener('input', e => {
  if (e.target.id === 'oq') { S.q = e.target.value; S.refocus = true; clearTimeout(qt); qt = setTimeout(render, 350); }
  if (e.target.id === 'cq') { S.cq = e.target.value; S.refocus = true; clearTimeout(qt); qt = setTimeout(render, 350); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'ost') { S.status = e.target.value; render(); }
  if (e.target.dataset.lead) api.markApplication(e.target.dataset.lead, e.target.checked).then(() => toast('Updated')).catch(err => toast(errText(err)));
});

boot().catch(e => { root.innerHTML = `<div class="auth"><div class="card"><b>Something went wrong</b><span class="mute">${esc(errText(e))}</span><button class="btn" onclick="location.reload()">Try again</button></div></div>`; });
