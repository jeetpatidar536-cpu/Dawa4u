// =====================================================================
// Customer state shared by the phone app (web/app) and website (web/shop).
// Cart lives on the device; everything else comes from Supabase.
// =====================================================================
import { auth, me, shop, rx, getSettings, live, store, errText } from './api.js';

const subs = new Set();
const emit = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });

export const C = {
  ready: false,
  settings: { delivery_fee: 25, handling_fee: 5, pass_price: 100, pass_off: 15, payments_test_mode: true, announcement: '' },
  user: null, profile: null,
  pin: store.get('pin', ''),
  catalog: [], byId: {}, pharmacyName: '',
  addresses: [], orders: [], prescriptions: [],
  cart: store.get('cart', { items: {}, rxId: null, buyPass: false, addressId: null, pay: 'upi' }),
  on(f) { subs.add(f); return () => subs.delete(f); },
  emit,

  async init() {
    try { this.settings = await getSettings(); } catch (e) { console.warn(e); }
    const s = await auth.session();
    await this.setUser(s ? s.user : null, true);
    auth.onChange(async session => { const u = session ? session.user : null; if ((u && u.id) !== (this.user && this.user.id)) { await this.setUser(u); } });
    if (this.pin) await this.loadCatalog();
    this.ready = true; emit();
    // live: order status + pharmacist replies
    live('orders', () => this.user && this.loadOrders(), { poll: 8000 });
    live('prescriptions', () => this.user && this.loadRx(), { poll: 6000 });
  },

  async setUser(u, quiet) {
    this.user = u;
    if (u) {
      [this.profile, this.addresses] = await Promise.all([me.profile(), shop.addresses()]);
      if (!this.cart.addressId || !this.addresses.find(a => a.id === this.cart.addressId)) this.cart.addressId = this.addresses[0] ? this.addresses[0].id : null;
      const a = this.address(); if (a && a.pin !== this.pin) { this.pin = a.pin; store.set('pin', a.pin); await this.loadCatalog(); }
      await Promise.all([this.loadOrders(true), this.loadRx(true)]);
      this.save();
    } else { this.profile = null; this.addresses = []; this.orders = []; this.prescriptions = []; }
    if (!quiet) emit();
  },

  async loadCatalog() {
    if (!this.pin) return;
    const rows = await shop.catalog(this.pin);
    this.catalog = rows; this.byId = Object.fromEntries(rows.map(r => [r.id, r]));
    this.pharmacyName = (rows.find(r => r.pharmacy_name) || {}).pharmacy_name || '';
    emit();
  },
  async setPin(pin) {
    if (!/^[1-9]\d{5}$/.test(pin)) throw new Error('Enter a valid 6-digit PIN code');
    this.pin = pin; store.set('pin', pin); await this.loadCatalog();
  },
  serviceable() { return !!this.pharmacyName; },

  async loadOrders(quiet) { if (!this.user) return; try { this.orders = await shop.orders(); } catch (e) { console.warn(e); } if (!quiet) emit(); },
  async loadRx(quiet) {
    if (!this.user) return;
    try {
      const before = Object.fromEntries(this.prescriptions.map(p => [p.id, p.status]));
      this.prescriptions = await rx.mine();
      // A pharmacist just finished: put their medicines in the cart (once per prescription)
      const applied = store.get('rxApplied', []);
      for (const p of this.prescriptions) {
        if (p.status === 'done' && !applied.includes(p.id) && (before[p.id] || p.id === this.cart.rxId)) {
          p.items.forEach(i => { this.cart.items[i.product_id] = Math.max(this.cart.items[i.product_id] || 0, i.qty); });
          this.cart.rxId = p.id; applied.push(p.id); store.set('rxApplied', applied); this.save();
          this.justVerified = p.id;
        }
      }
    } catch (e) { console.warn(e); }
    if (!quiet) emit();
  },
  activeRx() { return this.prescriptions.find(p => p.id === this.cart.rxId) || this.prescriptions.find(p => p.status === 'pending' || p.status === 'reading'); },
  async sendRx(blobs, note) {
    if (!this.pin) throw new Error('Choose your delivery PIN code first');
    const r = await rx.upload(blobs, this.pin, note);
    this.cart.rxId = r.id; this.save(); await this.loadRx();
    return r;
  },

  // ------------------------------------------------ cart
  save() { store.set('cart', this.cart); },
  qty(id) { return this.cart.items[id] || 0; },
  setQty(id, q) {
    const p = this.byId[id]; const max = p ? Math.min(p.stock, 20) : 20;
    if (q > max) { q = max; if (this._warn) this._warn(p && p.stock ? `Only ${p.stock} in stock` : 'Out of stock'); }
    if (q <= 0) delete this.cart.items[id]; else this.cart.items[id] = q;
    this.save(); emit();
  },
  add(id) { this.setQty(id, this.qty(id) + 1); },
  lines() { return Object.entries(this.cart.items).map(([id, qty]) => ({ ...(this.byId[id] || { id, name: 'Unavailable item', pack: '', price: 0, mrp: 0, stock: 0 }), qty })); },
  count() { return this.lines().reduce((a, l) => a + l.qty, 0); },
  clearCart() { this.cart.items = {}; this.cart.rxId = null; this.cart.buyPass = false; this.save(); emit(); },

  hasPass() { return !!(this.profile && this.profile.pass_until && new Date(this.profile.pass_until) > new Date()); },
  passOn() { return this.hasPass() || this.cart.buyPass; },
  togglePass(v) { if (this.hasPass()) return; this.cart.buyPass = v === undefined ? !this.cart.buyPass : !!v; this.save(); emit(); },

  rxNeeded() {
    const r = this.prescriptions.find(p => p.id === this.cart.rxId && p.status === 'done');
    const ok = new Set(r ? r.items.map(i => i.product_id) : []);
    return this.lines().filter(l => l.rx && !ok.has(l.id));
  },
  /** Bill preview — the server recalculates the real numbers when the order is placed */
  bill() {
    const s = this.settings, L = this.lines();
    const sub = L.reduce((a, l) => a + l.price * l.qty, 0), mrp = L.reduce((a, l) => a + l.mrp * l.qty, 0);
    const on = this.passOn();
    const disc = on ? Math.round(sub * s.pass_off / 100) : 0, delivery = !L.length ? 0 : on ? 0 : s.delivery_fee;
    const handling = L.length ? s.handling_fee : 0, passFee = this.cart.buyPass && !this.hasPass() ? s.pass_price : 0;
    return { sub, mrp, saved: mrp - sub, disc, delivery, handling, passFee, total: sub - disc + delivery + handling + passFee };
  },
  address() { return this.addresses.find(a => a.id === this.cart.addressId) || null; },
  async addAddress(label, line, pin) {
    const a = await shop.addAddress(label, line, pin);
    this.addresses.push(a); this.cart.addressId = a.id; this.save();
    if (a.pin !== this.pin) await this.setPin(a.pin);
    emit(); return a;
  },
  async chooseAddress(id) {
    this.cart.addressId = id; this.save();
    const a = this.address(); if (a && a.pin !== this.pin) await this.setPin(a.pin);
    emit();
  },

  /** Place + pay. Returns the order (paid, or COD placed). */
  async checkout() {
    if (!this.user) throw Object.assign(new Error('Log in to place your order'), { code: 'login' });
    if (!this.address()) throw Object.assign(new Error('Add a delivery address'), { code: 'address' });
    if (this.rxNeeded().length) throw Object.assign(new Error('Some medicines need a verified prescription'), { code: 'rx' });
    const items = this.lines().map(l => ({ product_id: l.id, qty: l.qty }));
    let o = await shop.place(items, this.cart.addressId, this.cart.pay, this.cart.rxId, this.cart.buyPass && !this.hasPass());
    this.clearCart(); await this.loadCatalog();
    try { o = await shop.pay(o, this.settings); }
    catch (e) { await this.loadOrders(); e.order = o; throw e; }
    await Promise.all([this.loadOrders(true), me.profile().then(p => { this.profile = p; })]);
    emit(); return o;
  },
  async payAgain(order) { const o = await shop.pay(order, this.settings); await this.loadOrders(); return o; },
  async cancel(id, reason) { await shop.cancel(id, reason); await this.loadOrders(); await this.loadCatalog(); },
  liveOrder() { return this.orders.find(o => ['placed', 'accepted', 'packed', 'picked'].includes(o.status)); },

  /** Tracking view-model: minutes left (target = settings ETA 15 min from placed) and steps */
  track(o) {
    const placed = new Date(o.placed_at || o.created_at).getTime(), total = 15 * 60;
    const el = (Date.now() - placed) / 1000, left = Math.max(0, total - el);
    const idx = { pending_payment: -1, placed: 0, accepted: 1, packed: 1, picked: 2, delivered: 3, cancelled: -2 }[o.status];
    const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(Math.floor(left % 60)).padStart(2, '0');
    const steps = [
      { title: 'Order confirmed', sub: o.pay_method === 'cod' ? 'Pay cash to the rider' : 'Paid online' },
      { title: o.status === 'packed' ? 'Packed at ' + o.pharmacy_name : 'Packing at ' + o.pharmacy_name, sub: 'Pharmacist checks all medicines' },
      { title: 'Rider on the way', sub: o.rider_name ? o.rider_name + ' is bringing your order' : (idx >= 1 ? 'Finding a nearby rider' : 'A local rider will pick it up') },
      { title: 'Delivered', sub: o.status === 'delivered' ? 'Delivered at ' + new Date(o.delivered_at).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : 'Share the OTP with your rider' }
    ].map((s, i) => ({ ...s, state: i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'now' : 'next' }));
    return { clock: mm + ':' + ss, late: left === 0 && idx < 3, pct: Math.min(100, el / total * 100), idx, steps, delivered: o.status === 'delivered', cancelled: o.status === 'cancelled' };
  },
  errText
};
