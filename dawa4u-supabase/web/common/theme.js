/* dawa4u light / dark mode — loaded as a plain <script> in <head> so the right colours show before anything paints.
 * Modes: 'auto' (follows the phone / computer setting, the default), 'light', 'dark'. Saved per device.
 * window.d4uTheme.toggle()  -> cycles auto → light → dark
 * window.d4uTheme.set(mode) -> 'auto' | 'light' | 'dark'
 * Fires a 'd4u-theme' event on window when the shown theme changes (maps use it to swap tiles). */
(function () {
  var KEY = 'd4u-theme';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function saved() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function resolve(mode) { return mode === 'light' || mode === 'dark' ? mode : (media && media.matches ? 'light' : 'dark'); }
  function apply() {
    var mode = saved(), shown = resolve(mode), root = document.documentElement;
    var changed = root.getAttribute('data-theme') !== shown;
    root.setAttribute('data-theme', shown);
    root.setAttribute('data-theme-mode', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', shown === 'light' ? '#15370D' : '#0B1708');
    if (changed) { try { window.dispatchEvent(new CustomEvent('d4u-theme', { detail: { theme: shown, mode: mode } })); } catch (e) {} }
    return shown;
  }
  window.d4uTheme = {
    mode: saved,
    current: function () { return resolve(saved()); },
    set: function (mode) { try { localStorage.setItem(KEY, mode); } catch (e) {} apply(); window.dispatchEvent(new CustomEvent('d4u-theme-mode', { detail: { mode: mode } })); },
    toggle: function () { var order = ['auto', 'light', 'dark']; var next = order[(order.indexOf(saved()) + 1) % 3]; this.set(next); return next; },
    label: function () { var m = saved(); return m === 'auto' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'; },
    /* small sun / moon / half-circle icon for the current mode */
    icon: function (size) {
      var s = size || 20, m = saved(), a = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
      if (m === 'light') return a + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
      if (m === 'dark') return a + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
      return a + '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>';
    }
  };
  /* Any element with data-theme-toggle switches the mode (add data-theme-label to also show the word). */
  window.d4uTheme.button = function (cls, withLabel, size) {
    return '<button type="button" data-theme-toggle' + (withLabel ? ' data-theme-label' : '') + ' class="' + (cls || '') + '" title="Light / dark mode" aria-label="Light or dark mode">' +
      window.d4uTheme.icon(size) + (withLabel ? '<span>' + window.d4uTheme.label() + '</span>' : '') + '</button>';
  };
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    window.d4uTheme.toggle();
    var all = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < all.length; i++) all[i].innerHTML = window.d4uTheme.icon() + (all[i].hasAttribute('data-theme-label') ? '<span>' + window.d4uTheme.label() + '</span>' : '');
  }, true);
  apply();
  if (media) { if (media.addEventListener) media.addEventListener('change', apply); else if (media.addListener) media.addListener(apply); }
})();
