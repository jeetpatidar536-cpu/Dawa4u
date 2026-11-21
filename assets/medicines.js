/* dawa4u Medicines on the WordPress site.
 * Reads the same catalogue as the apps (Supabase shop_catalog): with a PIN it shows the price and stock
 * at the partner pharmacy that delivers there. "Add" writes into the dawa4u shop cart in this browser
 * (dawa4u.in/shop uses the same storage), so "Go to cart" continues straight to checkout. */
(function () {
  var roots = document.querySelectorAll('[data-d4u-meds]');
  if (!roots.length) return;
  var cfg = window.D4U_CONFIG || {};

  function read(k, d) { try { var v = localStorage.getItem('dawa4u.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem('dawa4u.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rupee(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function cart() { var c = read('cart', null); if (!c || typeof c !== 'object') c = { items: {}, rxId: null, buyPass: false, addressId: null, pay: 'upi' }; if (!c.items) c.items = {}; return c; }

  var cache = {};
  function catalog(pin) {
    var key = pin || '-';
    if (cache[key]) return cache[key];
    cache[key] = fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/shop_catalog', {
      method: 'POST',
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_pin: pin || '' })
    }).then(function (r) { if (!r.ok) throw new Error('Could not load medicines'); return r.json(); })
      .catch(function (e) { delete cache[key]; throw e; });
    return cache[key];
  }

  roots.forEach(function (root) {
    var cats = JSON.parse(root.getAttribute('data-cats') || '{}');
    var shop = root.getAttribute('data-shop');
    var limit = +root.getAttribute('data-limit') || 0;
    var cat = root.getAttribute('data-cat') || '';
    var q = '';
    var rows = [];
    var pin = read('pin', '');
    var grid = root.querySelector('[data-grid]'), status = root.querySelector('[data-status]'), bar = root.querySelector('[data-cartbar]');
    var pinInput = root.querySelector('[data-pin]');
    if (pinInput && pin) pinInput.value = pin;

    function pharmacy() { for (var i = 0; i < rows.length; i++) if (rows[i].pharmacy_id) return rows[i].pharmacy_name; return null; }

    function card(m) {
      var ph = pharmacy(), qty = cart().items[m.id] || 0;
      var mark = cats[m.category] ? cats[m.category][0] : '+';
      var price = ph ? m.price : m.mrp, inStock = ph && m.stock > 0;
      var stock = !pin ? '' : !ph ? '' : m.stock > 3 ? '<span class="d4m-stock ok">In stock</span>' : m.stock > 0 ? '<span class="d4m-stock low">Only ' + m.stock + ' left</span>' : '<span class="d4m-stock out">Out of stock</span>';
      var priceHtml = ph ? '<span class="d4m-price">' + rupee(price) + (m.mrp > price ? ' <s>' + rupee(m.mrp) + '</s>' : '') + '</span>' : '<span class="d4m-price">MRP ' + rupee(m.mrp) + '</span>';
      var action = !pin ? '<button type="button" class="d4m-add ghost" data-askpin>Check price</button>'
        : !inStock ? '<button type="button" class="d4m-add" disabled>' + (ph ? 'Out of stock' : 'Not here yet') + '</button>'
        : qty ? '<span class="d4m-step"><button type="button" data-dec="' + esc(m.id) + '" aria-label="One less">−</button><b>' + qty + '</b><button type="button" data-inc="' + esc(m.id) + '" aria-label="One more">+</button></span>'
        : '<button type="button" class="d4m-add" data-inc="' + esc(m.id) + '">Add</button>';
      return '<article class="d4m-card"><div class="d4m-ph">' + esc(mark) + '</div><div class="d4m-body"><h3>' + esc(m.name) + '</h3><p class="d4m-salt">' +
        esc([m.salt, m.pack].filter(Boolean).join(' · ')) + '</p>' + (m.rx ? '<span class="d4m-rx">Needs prescription</span>' : '') + stock +
        '</div><div class="d4m-foot">' + priceHtml + action + '</div></article>';
    }

    function paint() {
      var ph = pharmacy();
      if (!pin) status.innerHTML = 'Enter your PIN code to see the price and stock at the pharmacy nearest you.';
      else if (ph) status.innerHTML = '✓ Prices and stock from <b>' + esc(ph) + '</b>, delivering to PIN <b>' + esc(pin) + '</b> in 10–15 minutes.';
      else status.innerHTML = 'We don’t deliver to PIN <b>' + esc(pin) + '</b> yet — new pharmacies are joining every week. Prices shown are MRP.';
      status.className = 'd4m-status' + (pin && !ph ? ' warn' : pin ? ' ok' : '');
      var list = rows.filter(function (m) {
        if (cat && m.category !== cat) return false;
        if (q) { var t = (m.name + ' ' + m.salt + ' ' + m.pack).toLowerCase(); if (t.indexOf(q) < 0) return false; }
        return true;
      });
      if (limit) list = list.slice(0, limit);
      grid.innerHTML = list.length ? list.map(card).join('') : '<p class="d4m-empty">No medicines match that.</p>';
      var n = 0, items = cart().items; for (var k in items) n += items[k];
      if (bar) { bar.hidden = !n; bar.innerHTML = '<span>' + n + ' item' + (n === 1 ? '' : 's') + ' in your cart</span><b>Go to cart →</b>'; }
    }

    function load() {
      status.textContent = 'Loading medicines…';
      catalog(pin).then(function (r) { rows = r || []; paint(); })
        .catch(function () { status.textContent = 'Could not load live prices right now. Please try again in a moment.'; });
    }

    root.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-chip')) {
        cat = t.getAttribute('data-chip');
        root.querySelectorAll('[data-chip]').forEach(function (b) { b.classList.toggle('on', b === t); });
        paint(); return;
      }
      if (t.hasAttribute('data-askpin')) { if (pinInput) { pinInput.focus(); pinInput.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
      var id = t.getAttribute('data-inc') || t.getAttribute('data-dec');
      if (id) {
        var c = cart(), cur = c.items[id] || 0, next = cur + (t.hasAttribute('data-inc') ? 1 : -1);
        var m = rows.find(function (x) { return x.id === id; });
        if (m && next > m.stock) next = m.stock;
        if (next <= 0) delete c.items[id]; else c.items[id] = next;
        write('cart', c); paint();
      }
    });
    var search = root.querySelector('[data-q]');
    if (search) search.addEventListener('input', function () { q = search.value.trim().toLowerCase(); paint(); });
    var form = root.querySelector('[data-pinform]');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (pinInput.value || '').replace(/\D/g, '');
      if (!/^[1-9]\d{5}$/.test(v)) { status.textContent = 'Please enter a valid 6-digit PIN code.'; status.className = 'd4m-status warn'; return; }
      if (v !== pin) {
        pin = v; write('pin', v);
      }
      load();
    });
    window.addEventListener('storage', function (e) { if (e.key === 'dawa4u.cart') paint(); });
    load();
  });
})();
