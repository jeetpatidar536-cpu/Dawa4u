// Shared bits for the desktop partner apps (pharmacy + admin): email login screen and the sidebar shell.
import { auth, esc, LOGO, ICON, toast, errText } from './api.js';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

/** Run an async action with the button showing a busy state; shows errors as a toast */
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.innerHTML = 'Please wait…'; }
  try { return await fn(); } catch (e) { toast(errText(e), 4000); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.t; } }
}

/** Email + password login / sign-up / reset screen */
export function authScreen(root, { title, subtitle, allowSignup, onDone }) {
  let mode = 'login';
  const draw = () => {
    root.innerHTML = `<div class="auth"><div class="card">
      <span class="logo">${LOGO()}<span>dawa<span style="color:var(--gold-d)">4u</span></span></span>
      <div class="stack" style="gap:4px"><h1 class="serif" style="margin:0;font-size:26px;font-weight:600">${mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset password' : esc(title)}</h1><span class="mute">${esc(subtitle)}</span></div>
      ${mode === 'signup' ? '<label class="field">Your name<input id="a-name" autocomplete="name"></label>' : ''}
      <label class="field">Email<input id="a-email" type="email" autocomplete="username"></label>
      ${mode !== 'reset' ? `<label class="field">Password<input id="a-pass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8"></label>` : ''}
      <button class="btn lg" id="a-go">${mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Log in'}</button>
      <div class="row between s13">
        ${mode === 'login' ? `<a href="#" data-mode="reset">Forgot password?</a>${allowSignup ? '<a href="#" data-mode="signup" class="b">New pharmacy? Sign up</a>' : ''}` : '<a href="#" data-mode="login">Back to log in</a>'}
      </div></div></div>`;
    root.querySelectorAll('[data-mode]').forEach(a => a.onclick = e => { e.preventDefault(); mode = a.dataset.mode; draw(); });
    const go = $('#a-go');
    const submit = () => busy(go, async () => {
      const email = $('#a-email').value.trim(), pass = $('#a-pass') ? $('#a-pass').value : '';
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
      if (mode === 'reset') { await auth.resetPassword(email); toast('Check your email for the reset link'); mode = 'login'; return draw(); }
      if (pass.length < 8) throw new Error('Password must be at least 8 characters');
      if (mode === 'signup') await auth.signUp(email, pass, $('#a-name').value.trim()); else await auth.signIn(email, pass);
      onDone();
    });
    go.onclick = submit;
    root.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') submit(); });
    ($('#a-name') || $('#a-email')).focus();
  };
  draw();
}

/** Sidebar layout. nav = [{id, label, icon, count}] */
export function shell(root, { nav, active, title, right = '', body, who = '' }) {
  root.innerHTML = `<div class="shell">
    <aside class="side"><a class="logo" href="#/">${LOGO('#FAF7F2', '#C9A96E', 30)}<span>dawa<span style="color:var(--gold)">4u</span></span></a>
      ${nav.map(n => `<a href="#/${n.id}" class="${n.id === active ? 'on' : ''}">${n.icon}${esc(n.label)}${n.count ? `<span class="n">${n.count}</span>` : ''}</a>`).join('')}
      <a href="#" id="signout" style="margin-top:auto">${ICON.logout}Log out</a><div class="foot">${esc(who)}</div></aside>
    <div class="main">
      <div class="topbar"><h1 class="serif">${esc(title)}</h1><div class="row" style="margin-left:auto;gap:12px">${right}</div></div>
      <nav class="mnav">${nav.map(n => `<a href="#/${n.id}" class="${n.id === active ? 'on' : ''}">${esc(n.label)}${n.count ? ' · ' + n.count : ''}</a>`).join('')}<a href="#" id="signout2">Log out</a></nav>
      <div class="content" id="content">${body}</div>
    </div></div>`;
  const out = async e => { e.preventDefault(); await auth.signOut(); location.hash = '#/'; location.reload(); };
  $('#signout').onclick = out; $('#signout2').onclick = out;
}

/** Copy text to clipboard with a toast */
export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { prompt('Copy this:', text); }
}

/** Turn rows into CSV text */
export const toCsv = (rows, cols) => [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(c => `"${String(c[1](r) ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
export function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
