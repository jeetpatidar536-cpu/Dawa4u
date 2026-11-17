// Tiny JSON-file database. Good for a pilot with a few pharmacies.
// When dawa4u grows, swap this file for PostgreSQL or MongoDB: the rest of the
// server only uses db.data and db.save().
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(path.join(DIR, 'rx'), { recursive: true });

const db = {
  data: null,
  dir: DIR,
  load() {
    if (fs.existsSync(FILE)) { this.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); return false; }
    this.data = { users: [], sessions: {}, otps: {}, products: [], pharmacies: [], orders: [], seq: 1000,
      settings: { deliveryFee: 25, passOff: 15, passPrice: 100, riderPay: 30, announcement: '' } };
    return true; // brand new database
  },
  // Write to a temp file then rename, so a crash never leaves a half-written database
  _timer: null,
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 50);
  },
  flush() {
    clearTimeout(this._timer);
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, FILE);
  },
  id(prefix) { return prefix + crypto.randomBytes(6).toString('hex'); },
  nextOrderId() { this.data.seq += 1; return 'D4U' + this.data.seq; },
};

module.exports = db;
