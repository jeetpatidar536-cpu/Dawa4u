/* dawa4u — prescription upload on the checkout page (files go up one by one; the form only carries their tokens). */
(function () {
  var cfg = window.d4uRx || {};
  function el(id) { return document.getElementById(id); }
  function tokens() { var v = el('d4u-rx-tokens'); return v && v.value ? v.value.split(',').filter(Boolean) : []; }
  function setTokens(t) { var v = el('d4u-rx-tokens'); if (v) v.value = t.join(','); }
  function msg(text, bad) { var m = el('d4u-rx-msg'); if (m) { m.textContent = text || ''; m.className = 'd4u-rx-msg' + (bad ? ' bad' : ''); } }
  function addItem(token, name) {
    var li = document.createElement('li');
    li.setAttribute('data-token', token);
    var s = document.createElement('span'); s.textContent = name; li.appendChild(s);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'd4u-rx-del'; b.textContent = 'Remove'; li.appendChild(b);
    el('d4u-rx-list').appendChild(li);
  }
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'd4u-rx-file') return;
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    var i = 0;
    (function next() {
      if (i >= files.length) { if (files.length) msg('Added. A pharmacist will check it after you place the order.'); return; }
      var f = files[i++];
      if (f.size > 10 * 1024 * 1024) { msg(f.name + ' is too big (max 10 MB).', true); return next(); }
      msg('Uploading ' + f.name + '…');
      var fd = new FormData();
      fd.append('nonce', cfg.nonce);
      fd.append('file', f);
      fetch(cfg.up, { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.success) { var t = tokens(); t.push(res.data.token); setTokens(t); addItem(res.data.token, res.data.name); next(); }
          else { msg((res && res.data && res.data.message) || 'Upload failed. Please try again.', true); }
        })
        .catch(function () { msg('Upload failed. Check your internet and try again.', true); });
    })();
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.d4u-rx-del') : null;
    if (!b) return;
    var li = b.closest('li'), tok = li.getAttribute('data-token');
    setTokens(tokens().filter(function (x) { return x !== tok; }));
    li.parentNode.removeChild(li);
    var fd = new FormData(); fd.append('nonce', cfg.nonce); fd.append('token', tok);
    fetch(cfg.del, { method: 'POST', body: fd, credentials: 'same-origin' });
    msg('');
  });
})();
