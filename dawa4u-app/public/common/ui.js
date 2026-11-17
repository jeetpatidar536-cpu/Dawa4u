// Shared helpers for all dawa4u apps: API calls, login token, formatting, toasts, icons.
const APP = document.documentElement.dataset.app;          // shop | pharmacy | rider | admin
const TOKEN_KEY = 'dawa4u-' + APP + '-token';
// Set window.DAWA4U_API in config.js to host the apps on a different domain from the server
const API_BASE = window.DAWA4U_API || '';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let onLoggedOut = () => location.reload();

async function api(path, opts = {}) {
  const headers = {};
  const token = store.get(TOKEN_KEY);
  if (token) headers.authorization = 'Bearer ' + token;
  let body = opts.body;
  if (opts.raw) { headers['content-type'] = opts.type; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
  let res;
  try { res = await fetch(API_BASE + path, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body }); }
  catch { throw new Error('No internet connection. Check your network and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { store.set(TOKEN_KEY, null); onLoggedOut(); }
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
  return data;
}
const post = (path, body = {}) => api(path, { body });

const rs = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = t => t ? new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
const day = t => t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
const when = t => { if (!t) return ''; const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? time(t) : day(t) + ', ' + time(t); };
const mmss = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const $ = (sel, el = document) => el.querySelector(sel);

const STATUS = {
  awaiting_payment: ['Waiting for payment', 'grey'], placed: ['New order', 'sun'], accepted: ['Accepted, packing', 'sun'],
  packed: ['Packed, waiting for rider', 'sun'], picked: ['Rider on the way', 'sun'], delivered: ['Delivered', ''],
  rejected: ['Rejected', 'rx'], cancelled: ['Cancelled', 'grey'],
};
const statusPill = s => `<span class="pill ${STATUS[s]?.[1] ?? 'grey'}">${STATUS[s]?.[0] ?? esc(s)}</span>`;
const PAY = { cod: 'Cash on delivery', collected: 'Cash collected', pending: 'Payment pending', paid: 'Paid online', refund_due: 'Refund due', refunded: 'Refunded' };
const itemsText = o => o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ');

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
// Run an async action from a button, showing errors as a toast
async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

const ICON = {
  pill: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><rect x="5" y="14" width="30" height="12" rx="6" transform="rotate(-35 20 20)"/><path d="M16.5 12.5l7 15"/></svg>',
  bottle: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><rect x="15" y="4" width="10" height="6" rx="1.5"/><path d="M13 14c0-2 2-4 4-4h6c2 0 4 2 4 4v18a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3z"/><path d="M17 23h6M20 20v6"/></svg>',
  device: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="8" width="26" height="24" rx="4"/><path d="M11 21h5l2-5 4 9 2-4h5"/></svg>',
  care: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="11" width="28" height="20" rx="4"/><path d="M15 11V8h10v3M20 16v10M15 21h10"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-7h5l4 7M12 10l-2-4H7M15 6h3"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/></svg>',
};

// Username + password login for pharmacy, rider and admin
function staffLogin(root, role, title, onDone) {
  root.innerHTML = `<div class="login"><form class="card" id="login-form">
    <a class="brand" href="#"><i>+</i><span>dawa<b>4u</b></span><small>${esc(title)}</small></a>
    <h2>Log in</h2>
    <label class="field" for="lg-user">Username<input type="text" id="lg-user" autocomplete="username" autocapitalize="none" required></label>
    <label class="field" for="lg-pass">Password<input type="password" id="lg-pass" autocomplete="current-password" required></label>
    <p class="err" id="lg-err" role="alert"></p>
    <button class="btn big" type="submit">Log in</button>
    <p class="small muted">Your login is given to you by dawa4u. Forgot it? Ask the dawa4u admin to reset your password.</p>
  </form></div>`;
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; $('#lg-err').textContent = '';
    try {
      const r = await post('/api/auth/login', { role, username: $('#lg-user').value.trim(), password: $('#lg-pass').value });
      store.set(TOKEN_KEY, r.token); onDone(r.user);
    } catch (err) { $('#lg-err').textContent = err.message; btn.disabled = false; }
  });
}
async function logout() { await post('/api/auth/logout').catch(() => {}); store.set(TOKEN_KEY, null); location.reload(); }

// Register the service worker so the phone apps install and open offline
function registerApp() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
