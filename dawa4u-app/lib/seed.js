// Fills a brand-new database with the medicine catalogue, the first admin login and (optionally) demo partners.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const PRODUCTS = [
  ['pcm', 'Paracetamol 650 mg', 'Strip of 15 tablets', 32, 'Fever & pain', 'pill'],
  ['ibu', 'Ibuprofen 400 mg', 'Strip of 10 tablets', 18, 'Fever & pain', 'pill'],
  ['gel', 'Pain relief gel', '30 g tube', 115, 'Fever & pain', 'bottle'],
  ['cet', 'Cetirizine 10 mg', 'Strip of 10 tablets', 19, 'Cold & cough', 'pill'],
  ['csy', 'Cough syrup', '100 ml bottle', 98, 'Cold & cough', 'bottle'],
  ['vap', 'Vapour rub', '25 ml jar', 85, 'Cold & cough', 'bottle'],
  ['ors', 'ORS powder, orange', 'Pack of 4 sachets', 88, 'Stomach', 'care'],
  ['ant', 'Antacid liquid, mint', '170 ml bottle', 132, 'Stomach', 'bottle'],
  ['amx', 'Amoxicillin 500 mg', 'Strip of 10 capsules', 74, 'Prescription', 'pill', true],
  ['azi', 'Azithromycin 500 mg', 'Strip of 3 tablets', 71, 'Prescription', 'pill', true],
  ['pan', 'Pantoprazole 40 mg', 'Strip of 15 tablets', 118, 'Prescription', 'pill', true],
  ['met', 'Metformin 500 mg', 'Strip of 20 tablets', 36, 'Prescription', 'pill', true],
  ['aml', 'Amlodipine 5 mg', 'Strip of 15 tablets', 42, 'Prescription', 'pill', true],
  ['ban', 'Crepe bandage 10 cm', '1 roll', 140, 'First aid', 'care'],
  ['asp', 'Antiseptic liquid', '100 ml bottle', 64, 'First aid', 'bottle'],
  ['cot', 'Cotton roll', '100 g', 55, 'First aid', 'care'],
  ['thm', 'Digital thermometer', '1 unit', 199, 'Devices', 'device'],
  ['bpm', 'BP monitor, upper arm', '1 unit', 1499, 'Devices', 'device'],
  ['vtc', 'Vitamin C chewable 500 mg', 'Strip of 15 tablets', 28, 'Wellness', 'pill'],
  ['mlt', 'Multivitamin tablets', 'Bottle of 30', 245, 'Wellness', 'bottle'],
  ['pad', 'Sanitary pads XL', 'Pack of 8', 89, 'Baby & hygiene', 'care'],
  ['dia', 'Baby diapers, small', 'Pack of 22', 299, 'Baby & hygiene', 'care'],
];

function newPharmacy({ name, address, pins }) {
  return { id: db.id('ph_'), name, address: address || '', pins: pins || [], open: true, stock: {}, price: {},
    posKey: db.id('pos_') + db.id(''), posType: 'Marg ERP', posOpts: { stock: true, price: true }, posLast: null, createdAt: Date.now() };
}

function seed() {
  const d = db.data;
  d.products = PRODUCTS.map(([id, name, pack, mrp, cat, icon, rx]) => ({ id, name, pack, mrp, cat, icon, rx: !!rx, posCode: '', active: true }));
  const logins = [];

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || auth.randomPassword();
  d.users.push({ id: db.id('u_'), role: 'admin', username: adminUser, name: 'dawa4u owner', passHash: auth.hashPassword(adminPass), createdAt: Date.now() });
  logins.push(['Admin', adminUser, process.env.ADMIN_PASSWORD ? '(the ADMIN_PASSWORD in your .env)' : adminPass]);

  if (process.env.DEMO_DATA !== '0') {
    const ph = newPharmacy({ name: 'Shree Medical Store', address: 'Vijay Nagar, Indore', pins: ['452001', '452010', '452016'] });
    d.products.forEach(p => { ph.stock[p.id] = p.id === 'vap' ? 0 : 25; });
    d.pharmacies.push(ph);
    const pp = auth.randomPassword(), rp = auth.randomPassword();
    d.users.push({ id: db.id('u_'), role: 'pharmacy', username: 'shree', name: 'Shree Medical Store', pharmacyId: ph.id, passHash: auth.hashPassword(pp), createdAt: Date.now() });
    d.users.push({ id: db.id('u_'), role: 'rider', username: 'ravi', name: 'Ravi K.', phone: '9800000001', online: true, passHash: auth.hashPassword(rp), createdAt: Date.now() });
    logins.push(['Pharmacy (demo)', 'shree', pp], ['Rider (demo)', 'ravi', rp]);
  }
  db.flush();

  const text = logins.map(([r, u, p]) => `${r.padEnd(16)} username: ${u.padEnd(8)} password: ${p}`).join('\n');
  console.log('\n=== First run: logins created ===\n' + text + '\nChange these in the Admin app. They are not shown again.\n');
  if (process.env.NODE_ENV !== 'production') {
    fs.writeFileSync(path.join(db.dir, 'first-run-logins.txt'), text + '\n\nDelete this file once you have saved the passwords.\n');
  }
}

module.exports = { seed, newPharmacy };
