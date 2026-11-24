/* dawa4u pharmacy dashboard: light/dark switch, live order counts, a chime for new orders. */
(function () {
  var cfg = window.d4uPh || {};
  var root = document.documentElement;

  /* ---------- light / dark (same setting as the website) ---------- */
  var KEY = 'd4u-theme', ORDER = ['auto', 'light', 'dark'];
  function applyTheme(m) {
    var light = m === 'light' || (m === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    root.setAttribute('data-theme', light ? 'light' : 'dark');
    root.setAttribute('data-theme-mode', m);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.d4p-theme');
    if (!b) return;
    var m = 'auto';
    try { m = localStorage.getItem(KEY) || 'auto'; } catch (x) {}
    m = ORDER[(ORDER.indexOf(m) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, m); } catch (x) {}
    applyTheme(m);
  });

  if (!cfg.poll || !cfg.counts) return;

  /* ---------- typing protection: never reload over a half-filled form ---------- */
  var lastInput = 0;
  document.addEventListener('input', function (e) {
    lastInput = Date.now();
    var f = e.target.closest && e.target.closest('form');
    if (f) f.classList.add('d4u-dirty');
  });
  function busy() {
    var a = document.activeElement;
    return Date.now() - lastInput < 60000 ||
      document.querySelector('form.d4u-dirty, details[open]') ||
      (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  /* ---------- chime (sound starts working after the first tap on the page) ---------- */
  var ctx = null;
  function unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (x) {}
  }
  document.addEventListener('pointerdown', unlock, { once: false, passive: true });
  function chime() {
    unlock();
    if (!ctx) return;
    [[880, 0], [1320, 0.18]].forEach(function (n) {
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + n[1];
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.4);
    });
  }

  /* ---------- live counts ---------- */
  var seen = cfg.counts, banner = document.getElementById('d4p-new'), text = document.getElementById('d4p-new-text'), go = document.getElementById('d4p-new-go'), target = location.href;
  function setBadges(c) {
    ['rx', 'pack', 'requests', 'rider'].forEach(function (k) {
      document.querySelectorAll('[data-count="' + k + '"]').forEach(function (b) {
        b.textContent = c[k]; b.hidden = !c[k];
      });
      document.querySelectorAll('[data-count="' + k + '-tile"]').forEach(function (b) { b.textContent = c[k]; });
    });
    document.title = (c.action ? '(' + c.action + ') ' : '') + 'Pharmacy · dawa4u';
  }
  function check() {
    fetch(cfg.poll, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.success) return;
        var c = res.data, grew = null;
        ['rx', 'requests', 'pack'].forEach(function (k) { if (c[k] > seen[k] && !grew) grew = k; });
        var changed = ['rx', 'pack', 'requests', 'rider'].some(function (k) { return c[k] !== seen[k]; });
        setBadges(c);
        if (grew) {
          chime();
          var words = { rx: 'New prescription to check', requests: 'New prescription request', pack: 'New order to pack' };
          text.textContent = words[grew];
          target = cfg.urls[grew] || location.href;
          banner.hidden = false;
        }
        seen = c;
        if (changed && !busy()) setTimeout(function () { if (busy()) return; if (grew) location.href = target; else location.reload(); }, grew ? 4000 : 0);
      })
      .catch(function () {});
  }
  if (go) go.addEventListener('click', function () { location.href = target; });
  setInterval(check, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
})();
