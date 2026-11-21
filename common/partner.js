// Shared bits for the desktop partner apps (pharmacy + admin): email login screen and the sidebar shell.
import { auth, esc, LOGO, ICON, toast, errText, authLinkState } from './api.js';

if (authLinkState === 'verified') setTimeout(() => toast('✓ Email verified — welcome to dawa4u!', 3500), 900);

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

/** Run an async action with the button showing a busy state; shows errors as a toast */
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.innerHTML = 'Please wait…'; }
  try { return await fn(); } catch (e) { toast(errText(e), 4000); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.t; } }
}

/** Email + password login / sign-up / reset screen, with email verification for new accounts */
export function authScreen(root, { title, subtitle, allowSignup, onDone }) {
  let mode = authLinkState === 'expired' ? 'verify' : 'login', vEmail = '', note = authLinkState === 'expired' ? 'expired' : '', cooldown = 0, timer;
  const verifyCard = () => `
      <div class="stack" style="gap:6px"><h1 class="serif" style="margin:0;font-size:26px;font-weight:600">${note === 'expired' ? 'That link has expired' : 'Check your inbox'}</h1>
        <span class="mute">${note === 'expired' ? 'Verification links work once and only for a while. Enter your email and we\'ll send a fresh one.'
          : `We sent a verification link to <b>${esc(vEmail)}</b>. Open it on this device to confirm your email — you'll come straight back here, logged in.`}</span></div>
      <label class="field">Email<input id="a-email" type="email" autocomplete="username" value="${esc(vEmail)}"></label>
      <button class="btn lg" id="a-resend" ${cooldown ? 'disabled' : ''}>${cooldown ? `Send again in ${cooldown}s` : note === 'expired' ? 'Send a new link' : 'Resend the email'}</button>
      <span class="s12 mute">Can't find it? Check Spam / Promotions, and make sure the email address is right. The email comes from dawa4u.</span>
      <div class="row between s13"><a href="#" data-mode="login">I've verified — log in</a>${allowSignup ? '<a href="#" data-mode="signup">Use a different email</a>' : ''}</div>`;
  const draw = () => {
    root.innerHTML = `<div class="auth"><div style="position:fixed;top:16px;right:16px">${window.d4uTheme.button('theme-btn', true)}</div><div class="card">
      <span class="logo">${LOGO()}<span>dawa<span style="color:var(--gold-d)">4u</span></span></span>
      ${mode === 'verify' ? verifyCard() : `
      <div class="stack" style="gap:4px"><h1 class="serif" style="margin:0;font-size:26px;font-weight:600">${mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset password' : esc(title)}</h1><span class="mute">${mode === 'signup' ? 'We\'ll email you a link to verify your address.' : esc(subtitle)}</span></div>
      ${mode === 'signup' ? '<label class="field">Your name<input id="a-name" autocomplete="name"></label>' : ''}
      <label class="field">Email<input id="a-email" type="email" autocomplete="username" value="${esc(vEmail)}"></label>
      ${mode !== 'reset' ? `<label class="field">Password<input id="a-pass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8"></label>` : ''}
      <button class="btn lg" id="a-go">${mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Log in'}</button>
      <div class="row between s13">
        ${mode === 'login' ? `<a href="#" data-mode="reset">Forgot password?</a>${allowSignup ? '<a href="#" data-mode="signup" class="b">New pharmacy? Sign up</a>' : ''}` : '<a href="#" data-mode="login">Back to log in</a>'}
      </div>`}</div></div>`;
    root.querySelectorAll('[data-mode]').forEach(a => a.onclick = e => { e.preventDefault(); const em = $('#a-email'); if (em) vEmail = em.value.trim(); mode = a.dataset.mode; note = ''; draw(); });
    const startCooldown = () => {
      cooldown = 60; clearInterval(timer);
      timer = setInterval(() => {
        cooldown = Math.max(0, cooldown - 1);
        const b = $('#a-resend');
        if (!b) { if (!cooldown) clearInterval(timer); return; }
        b.disabled = cooldown > 0; b.textContent = cooldown ? `Send again in ${cooldown}s` : 'Resend the email';
        if (!cooldown) clearInterval(timer);
      }, 1000);
    };
    const resend = $('#a-resend');
    if (resend) {
      resend.onclick = () => busy(resend, async () => {
        const email = $('#a-email').value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
        await auth.resendVerify(email); vEmail = email; note = ''; startCooldown();
        toast('Verification email sent to ' + email, 3000); draw();
      });
      return ($('#a-email') || {}).focus && $('#a-email').focus();
    }
    const go = $('#a-go');
    const submit = () => busy(go, async () => {
      const email = $('#a-email').value.trim(), pass = $('#a-pass') ? $('#a-pass').value : '';
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
      if (mode === 'reset') { await auth.resetPassword(email); toast('Check your email for the reset link'); mode = 'login'; return draw(); }
      if (pass.length < 8) throw new Error('Password must be at least 8 characters');
      if (mode === 'signup') {
        let r;
        try { r = await auth.signUp(email, pass, $('#a-name').value.trim()); }
        catch (e) { if (e.exists) { vEmail = email; mode = 'login'; note = ''; draw(); toast(e.message, 5000); return; } throw e; }
        if (r.needsVerify) { vEmail = email; mode = 'verify'; note = ''; startCooldown(); return draw(); }
        return onDone();
      }
      try { await auth.signIn(email, pass); }
      catch (e) { if (e.unverified) { vEmail = email; mode = 'verify'; note = ''; draw(); toast(e.message, 4000); return; } throw e; }
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
    <aside class="side"><a class="logo" href="#/">${LOGO('#FFFBEA', '#E5CD82', 30)}<span>dawa<span style="color:var(--gold)">4u</span></span></a>
      ${nav.map(n => `<a href="#/${n.id}" class="${n.id === active ? 'on' : ''}">${n.icon}${esc(n.label)}${n.count ? `<span class="n">${n.count}</span>` : ''}</a>`).join('')}
      <a href="#" id="signout" style="margin-top:auto">${ICON.logout}Log out</a><div class="foot">${esc(who)}</div></aside>
    <div class="main">
      <div class="topbar"><h1 class="serif">${esc(title)}</h1><div class="row" style="margin-left:auto;gap:12px">${right}${window.d4uTheme.button('theme-btn', true)}</div></div>
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
