// Reads stock files and API pushes from pharmacy billing software (Marg ERP, Tally, Busy, GoFrugal...)
// and matches item names to the dawa4u catalogue.

const IGNORE = new Set(['mg', 'ml', 'g', 'cm', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'syp', 'syrup', 'strip', 'of']);
const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !IGNORE.has(w));

function parseCsv(text) {
  return String(text).split(/\r?\n/).filter(l => l.trim()).map(line => {
    const out = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

// CSV with a header row -> [{name, code, stock, mrp}]
function rowsFromCsv(text) {
  const rows = parseCsv(text);
  const head = (rows[0] || []).map(h => h.toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const cn = col(/name|item|product|medicine/), cc = col(/^code$|sku|barcode|item ?code/), cs = col(/stock|qty|quantity|balance|closing/), cp = col(/mrp|price|rate/);
  if (cn < 0 || (cs < 0 && cp < 0)) return { error: 'The file needs a header row with an item name column and a stock or MRP column.' };
  return { items: rows.slice(1).map(r => ({ name: r[cn], code: cc >= 0 ? r[cc] : '', stock: cs >= 0 ? r[cs] : undefined, mrp: cp >= 0 ? r[cp] : undefined })) };
}

// Find the catalogue product for a POS line: by product code first, then by the first two name words
function match(item, products) {
  if (item.code) { const p = products.find(x => x.posCode && x.posCode.toLowerCase() === String(item.code).toLowerCase()); if (p) return p; }
  const w = words(item.name);
  return products.find(p => { const need = words(p.name).slice(0, 2); return need.length && need.every(k => w.includes(k)); });
}

// Apply items to one pharmacy's stock and prices
function apply(pharmacy, items, products, opts = {}) {
  let matched = 0; const missed = [];
  for (const it of items) {
    const p = match(it, products);
    if (!p) { if (it.name) missed.push(String(it.name).slice(0, 60)); continue; }
    matched++;
    const s = parseFloat(it.stock);
    if (!isNaN(s) && opts.stock !== false) pharmacy.stock[p.id] = Math.max(0, Math.floor(s));
    const m = parseFloat(it.mrp);
    if (m > 0 && opts.price !== false) pharmacy.price[p.id] = Math.round(m);
  }
  pharmacy.posLast = { at: Date.now(), matched, missed: missed.slice(0, 20), missedCount: missed.length };
  return pharmacy.posLast;
}

module.exports = { rowsFromCsv, apply };
