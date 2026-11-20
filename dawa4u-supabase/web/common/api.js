// =====================================================================
// dawa4u shared client — used by ALL apps (customer app + website,
// pharmacy, rider, admin). Talks to Supabase. No build step needed.
// =====================================================================
import { createClient } from './vendor/supabase.js'; // @supabase/supabase-js 2.45.4, bundled (MIT licence)

const cfg = window.D4U_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="font:16px system-ui;padding:40px;max-width:560px;margin:auto"><h2>dawa4u is not connected yet</h2><p>Open <b>web/common/config.js</b> and paste your Supabase project URL and anon key. See README → "Set up Supabase".</p></div>';
  });
}
export const sb = createClient(cfg.SUPABASE_URL || 'http://localhost', cfg.SUPABASE_ANON_KEY || 'x', cfg.CLIENT_OPTIONS || {});

// ---------------------------------------------------------------- small helpers
export const rupee = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const when = t => t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const timeAgo = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : when(t); };
export const store = {
  get(k, d) { try { const v = localStorage.getItem('dawa4u.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dawa4u.' + k, JSON.stringify(v)); } catch {} }
};
/** Turn Supabase/Postgres errors into a sentence people can read */
export function errText(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/JWT|token/i.test(m)) return 'Your login has expired. Please log in again.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No internet connection. Please try again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}
async function must(p) { const { data, error } = await p; if (error) throw new Error(errText(error)); return data; }

let toastT;
export function toast(msg, ms = 2200) {
  let t = document.getElementById('d4u-toast');
  if (!t) { t = document.createElement('div'); t.id = 'd4u-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

export const CATS = [
  { id: 'fever', mark: 'Rx', label: 'Fever & pain' }, { id: 'bp', mark: 'BP', label: 'Diabetes & BP' },
  { id: 'vit', mark: 'Vit', label: 'Vitamins' }, { id: 'baby', mark: 'Baby', label: 'Baby care' },
  { id: 'skin', mark: 'Skin', label: 'Skin care' }, { id: 'kit', mark: 'Kit', label: 'First aid' },
  { id: 'ors', mark: 'ORS', label: 'Stomach care' }, { id: 'dev', mark: 'Dev', label: 'Health devices' }
];
export const RX_RULES = ['Doctor name and registration number', 'Patient name and date', 'Medicine names with dosage', 'Doctor signature or stamp'];
export const PAYS = [{ id: 'upi', label: 'UPI' }, { id: 'card', label: 'Debit / credit card' }, { id: 'netbanking', label: 'Netbanking' }, { id: 'cod', label: 'Cash on delivery' }];
export const payLabel = id => (PAYS.find(p => p.id === id) || PAYS[0]).label;
export const STATUS = {
  pending_payment: 'Waiting for payment', placed: 'Order placed', accepted: 'Pharmacy is packing', packed: 'Packed, waiting for rider',
  picked: 'Rider on the way', delivered: 'Delivered', cancelled: 'Cancelled'
};
export const ACTIVE = ['placed', 'accepted', 'packed', 'picked'];

// Capsule logo: bright green + bright gold. The white edge keeps it visible on the dark green headers.
export const LOGO_GREEN = '#22C55E', LOGO_GOLD = '#FFC72C';
export const LOGO = (_fg, _accent, size = 36) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(45 64 58)" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"><path d="M39 58 V38 A25 25 0 0 1 89 38 V58 Z" fill="${LOGO_GREEN}"/><path d="M39 58 H89 V78 A25 25 0 0 1 39 78 Z" fill="${LOGO_GOLD}"/></g></svg>`;
const sv = (d, w = 22, sw = 2) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  back: sv('<path d="m15 6-6 6 6 6"/>', 22, 2.2), search: sv('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 18),
  user: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  rx: sv('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 14h6M9 17h4"/>'),
  home: sv('<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  orders: sv('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/>'),
  cart: sv('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  check: sv('<path d="m5 12 4.5 4.5L19 7"/>', 18, 2.4),
  pin: sv('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  phone: sv('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 20),
  cam: sv('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 18),
  img: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>', 18),
  clock: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 20),
  bike: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h3l3-7h4l2 7M12 10 10 6H7"/></svg>',
  plus: sv('<path d="M12 5v14M5 12h14"/>', 16, 2.4),
  house: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 4l9 7v9H3z"/></svg>',
  box: sv('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  store: sv('<path d="M3 9 5 4h14l2 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>'),
  rupee: sv('<path d="M6 4h12M6 9h12M14 20 7 13h2a4 4 0 0 0 0-9"/>'),
  chart: sv('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  users: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20c-.6-2.5-2-4.2-4-5"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  link: sv('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  help: sv('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>'),
  logout: sv('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>')
};

// ---------------------------------------------------------------- auth
export const auth = {
  async session() { const { data } = await sb.auth.getSession(); return data.session; },
  async user() { const s = await this.session(); return s ? s.user : null; },
  onChange(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)); },
  /** Phone OTP (customers and riders). phone10 = 10-digit Indian mobile */
  async sendOtp(phone10) {
    if (!/^[6-9]\d{9}$/.test(phone10)) throw new Error('Enter a valid 10-digit mobile number');
    await must(sb.auth.signInWithOtp({ phone: '+91' + phone10 }));
  },
  async verifyOtp(phone10, code) {
    const d = await must(sb.auth.verifyOtp({ phone: '+91' + phone10, token: code, type: 'sms' }));
    return d.session;
  },
  /** Email + password (pharmacies and admin) */
  async signIn(email, password) { return (await must(sb.auth.signInWithPassword({ email, password }))).session; },
  async signUp(email, password, name) {
    const d = await must(sb.auth.signUp({ email, password, options: { data: { name } } }));
    if (!d.session) throw new Error('Check your email and click the confirmation link, then log in.');
    return d.session;
  },
  async resetPassword(email) { await must(sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); },
  async signOut() { await sb.auth.signOut(); }
};

export const me = {
  async profile() { const u = await auth.user(); if (!u) return null; return must(sb.from('profiles').select('*').eq('id', u.id).maybeSingle()); },
  async setName(name) { const u = await auth.user(); await must(sb.from('profiles').update({ name }).eq('id', u.id)); }
};

export async function getSettings() { return must(sb.from('settings').select('*').eq('id', 1).single()); }

// ---------------------------------------------------------------- customer
export const shop = {
  catalog: pin => must(sb.rpc('shop_catalog', { p_pin: pin })),
  addresses: () => must(sb.from('addresses').select('*').order('created_at')),
  addAddress: (label, line, pin, lat = null, lng = null) => {
    if (!label || !line) throw new Error('Fill in the label and full address');
    if (!/^[1-9]\d{5}$/.test(pin)) throw new Error('Enter a valid 6-digit PIN code');
    return must(sb.from('addresses').insert({ label, line, pin, lat, lng }).select().single());
  },
  deleteAddress: id => must(sb.from('addresses').delete().eq('id', id)),
  orders: () => must(sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(50)),
  order: id => must(sb.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle()),
  otp: id => must(sb.rpc('order_otp', { p_order_id: id })),
  cancel: (id, reason) => must(sb.rpc('customer_cancel', { p_order_id: id, p_reason: reason || 'Cancelled by customer' })),
  passHistory: () => must(sb.from('pass_subscriptions').select('*').order('created_at', { ascending: false })),
  ticket: (subject, message, order_id = null) => must(sb.from('support_tickets').insert({ subject, message, order_id })),
  tickets: () => must(sb.from('support_tickets').select('*').order('created_at', { ascending: false })),
  apply: (kind, name, phone, detail, city) => must(sb.from('partner_applications').insert({ kind, name, phone, detail, city })),

  /** Place the order. Returns the order row. Prices are worked out on the server. */
  place: (items, addressId, payMethod, prescriptionId, buyPass) => must(sb.rpc('place_order', {
    p_items: items, p_address_id: addressId, p_pay_method: payMethod, p_prescription_id: prescriptionId || null, p_buy_pass: !!buyPass
  })),

  /** Take payment for an unpaid online order: Razorpay if set up, else test mode. */
  async pay(order, settings) {
    if (order.pay_method === 'cod' || order.status !== 'pending_payment') return order;
    const r = await sb.functions.invoke('razorpay-order', { body: { order_id: order.id } });
    let rz = r.data;
    if (r.error || !rz || rz.error) {
      const msg = rz?.error || (await r.error?.context?.json?.().then(j => j.error).catch(() => null)) || r.error?.message || '';
      if (settings && settings.payments_test_mode && (/not set up/i.test(msg) || /Failed to send|FunctionsFetchError|404/i.test(msg + (r.error?.name || '')))) {
        return must(sb.rpc('test_pay', { p_order_id: order.id }));
      }
      throw new Error(msg || 'Could not start payment');
    }
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    const resp = await new Promise((resolve, reject) => {
      const rp = new window.Razorpay({
        key: rz.key_id, order_id: rz.razorpay_order_id, amount: rz.amount, currency: 'INR', name: 'dawa4u',
        description: 'Order ' + order.id, prefill: { contact: rz.phone || '', name: rz.name || '' },
        theme: { color: '#064E3B' }, handler: resolve,
        modal: { ondismiss: () => reject(new Error('Payment cancelled. Your order is saved — tap Pay to try again.')) }
      });
      rp.on('payment.failed', e => reject(new Error(e.error?.description || 'Payment failed')));
      rp.open();
    });
    const v = await sb.functions.invoke('razorpay-verify', { body: { order_id: order.id, ...resp } });
    if (v.error || v.data?.error) throw new Error(v.data?.error || 'Payment received but not verified yet. It will update in a minute.');
    return v.data.order;
  }
};

export const rx = {
  /** Upload prescription photos (Blobs) to the private bucket and create the request */
  async upload(blobs, pin, note) {
    const u = await auth.user(); if (!u) throw new Error('Please log in first');
    if (!blobs.length) throw new Error('Add a photo of your prescription');
    const paths = [];
    for (const b of blobs) {
      const path = `${u.id}/${crypto.randomUUID()}.jpg`;
      await must(sb.storage.from('prescriptions').upload(path, b, { contentType: 'image/jpeg' }));
      paths.push(path);
    }
    return must(sb.from('prescriptions').insert({ pin, photos: paths, note: note || '' }).select().single());
  },
  mine: () => must(sb.from('prescriptions').select('*').order('created_at', { ascending: false }).limit(20)),
  async photoUrl(path) { const d = await must(sb.storage.from('prescriptions').createSignedUrl(path, 3600)); return d.signedUrl; }
};

// Shrink camera photos before upload (saves data on slow connections)
export function readImages(files, max = 1600) {
  return Promise.all([...files].slice(0, 4).map(f => new Promise(res => {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => res(b ? { blob: b, preview: c.toDataURL('image/jpeg', 0.5) } : null), 'image/jpeg', 0.8);
    };
    img.onerror = () => res(null);
    img.src = url;
  }))).then(a => a.filter(Boolean));
}

// ---------------------------------------------------------------- pharmacy
export const pharmacy = {
  mine: async () => { const u = await auth.user(); return must(sb.from('pharmacies').select('*').eq('owner_id', u.id).maybeSingle()); },
  register: f => must(sb.rpc('register_pharmacy', { p_name: f.name, p_licence: f.licence, p_phone: f.phone, p_address: f.address, p_city: f.city, p_pins: f.pins })),
  setOpen: (id, open) => must(sb.from('pharmacies').update({ open }).eq('id', id)),
  update: (id, patch) => must(sb.from('pharmacies').update(patch).eq('id', id)),
  orders: (id, statuses) => must(sb.from('orders').select('*, order_items(*)').eq('pharmacy_id', id).in('status', statuses).order('created_at', { ascending: false }).limit(100)),
  history: (id, from) => must(sb.from('orders').select('*, order_items(*)').eq('pharmacy_id', id).in('status', ['delivered', 'cancelled']).gte('created_at', from).order('created_at', { ascending: false }).limit(500)),
  action: (orderId, action, reason) => must(sb.rpc('pharmacy_order_action', { p_order_id: orderId, p_action: action, p_reason: reason || null })),
  rxQueue: () => must(sb.from('prescriptions').select('*').in('status', ['pending', 'reading']).order('created_at')),
  rxDone: () => must(sb.from('prescriptions').select('*').in('status', ['done', 'rejected']).order('reviewed_at', { ascending: false }).limit(30)),
  rxGet: id => must(sb.from('prescriptions').select('*').eq('id', id).maybeSingle()),
  rxClaim: id => must(sb.rpc('rx_claim', { p_rx_id: id })),
  rxReview: (id, items, note, reject) => must(sb.rpc('rx_review', { p_rx_id: id, p_items: items, p_note: note, p_reject: !!reject })),
  products: () => must(sb.from('products').select('*').eq('active', true).order('category').order('name')),
  inventory: id => must(sb.from('inventory').select('*').eq('pharmacy_id', id)),
  setStock: items => must(sb.rpc('pharmacy_set_stock', { p_items: items })),
  posKey: id => must(sb.from('pharmacy_keys').select('pos_key').eq('pharmacy_id', id).maybeSingle())
};

// ---------------------------------------------------------------- rider
export const rider = {
  mine: async () => { const u = await auth.user(); return must(sb.from('riders').select('*').eq('id', u.id).maybeSingle()); },
  register: (name, vehicle, city) => must(sb.rpc('register_rider', { p_name: name, p_vehicle: vehicle, p_city: city })),
  update: async patch => { const u = await auth.user(); return must(sb.from('riders').update(patch).eq('id', u.id)); },
  available: () => must(sb.from('orders').select('*, order_items(*)').is('rider_id', null).in('status', ['accepted', 'packed']).order('created_at')),
  current: async () => { const u = await auth.user(); return must(sb.from('orders').select('*, order_items(*)').eq('rider_id', u.id).in('status', ['accepted', 'packed', 'picked']).order('created_at')); },
  trips: async from => { const u = await auth.user(); return must(sb.from('orders').select('*').eq('rider_id', u.id).eq('status', 'delivered').gte('delivered_at', from).order('delivered_at', { ascending: false })); },
  action: (orderId, action, otp) => must(sb.rpc('rider_action', { p_order_id: orderId, p_action: action, p_otp: otp || null }))
};

// ---------------------------------------------------------------- admin
export const adminApi = {
  stats: () => must(sb.rpc('admin_stats')),
  orders: (status, q) => {
    let r = sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(200);
    if (status) r = r.in('status', status.split(','));
    if (q) r = r.or(`id.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`);
    return must(r);
  },
  refunds: () => must(sb.from('orders').select('*').eq('pay_status', 'refund_due').order('cancelled_at', { ascending: false })),
  cancel: (id, reason) => must(sb.rpc('admin_cancel_order', { p_order_id: id, p_reason: reason })),
  update: (table, id, patch) => must(sb.rpc('admin_update', { p_table: table, p_id: String(id), p_patch: patch })),
  setPartner: (kind, id, status) => must(sb.rpc('admin_set_partner', { p_kind: kind, p_id: id, p_status: status })),
  pharmacies: () => must(sb.from('pharmacies').select('*').order('created_at', { ascending: false })),
  riders: () => must(sb.from('riders').select('*').order('created_at', { ascending: false })),
  customers: q => { let r = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(200); if (q) r = r.or(`phone.ilike.%${q}%,name.ilike.%${q}%,email.ilike.%${q}%`); return must(r); },
  products: () => must(sb.from('products').select('*').order('category').order('name')),
  saveProduct: p => must(sb.from('products').upsert(p).select().single()),
  passes: () => must(sb.from('pass_subscriptions').select('*').order('created_at', { ascending: false }).limit(200)),
  applications: () => must(sb.from('partner_applications').select('*').order('created_at', { ascending: false })),
  markApplication: (id, handled) => must(sb.from('partner_applications').update({ handled }).eq('id', id)),
  tickets: () => must(sb.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(200)),
  replyTicket: (id, reply) => must(sb.from('support_tickets').update({ reply, status: 'closed' }).eq('id', id)),
  saveSettings: s => must(sb.from('settings').update(s).eq('id', 1)),
  riderPayouts: () => must(sb.from('orders').select('rider_id,rider_name,rider_pay,id,delivered_at').eq('status', 'delivered').eq('rider_paid', false).order('delivered_at'))
};

// ---------------------------------------------------------------- live updates
/** Calls cb whenever rows in `table` change (Supabase Realtime), plus a safety poll. Returns a stop() function. */
export function live(table, cb, { filter, poll = 10000 } = {}) {
  let ch = null, stopped = false;
  try {
    ch = sb.channel('d4u-' + table + '-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => !stopped && cb())
      .subscribe();
  } catch { ch = null; }
  const t = setInterval(() => !stopped && !document.hidden && cb(), poll);
  return () => { stopped = true; clearInterval(t); if (ch) sb.removeChannel(ch); };
}

/** Ring + vibrate for new orders (pharmacy / rider) */
export function ding() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start();
    setTimeout(() => { o.frequency.value = 1320; }, 160); setTimeout(() => { o.stop(); a.close(); }, 380);
  } catch {}
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load payment page. Check your internet.'));
    document.head.appendChild(s);
  });
}

/** Register the service worker so the app installs on phones (skipped when not on https/localhost) */
export function installable(swPath = './sw.js') {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register(swPath).catch(() => {});
  }
}
