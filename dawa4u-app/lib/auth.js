// Logins: customers sign in with phone + OTP, staff (pharmacy, rider, admin) with username + password.
const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 30;
const OTP_MINUTES = 5;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function randomPassword() { return crypto.randomBytes(6).toString('base64url'); }

function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.data.sessions[token] = { userId: user.id, exp: Date.now() + SESSION_DAYS * 864e5 };
  db.save();
  return token;
}
function userFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = token && db.data.sessions[token];
  if (!s || s.exp < Date.now()) return null;
  const u = db.data.users.find(x => x.id === s.userId);
  return u && !u.disabled ? u : null;
}
function endSession(req) {
  const h = req.headers.authorization || '';
  delete db.data.sessions[h.slice(7)];
  db.save();
}

// Indian mobile number: 10 digits starting 6-9 (a +91 prefix is accepted)
function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

function createOtp(phone) {
  const prev = db.data.otps[phone];
  if (prev && Date.now() - prev.sent < 30e3) return { error: 'Wait 30 seconds before asking for a new code.' };
  const code = String(crypto.randomInt(100000, 1000000));
  db.data.otps[phone] = { code, exp: Date.now() + OTP_MINUTES * 60e3, tries: 0, sent: Date.now() };
  db.save();
  return { code };
}
function verifyOtp(phone, code) {
  const o = db.data.otps[phone];
  if (!o || o.exp < Date.now()) return 'The code has expired. Ask for a new one.';
  if (o.tries >= 5) return 'Too many wrong tries. Ask for a new code.';
  if (String(code) !== o.code) { o.tries++; db.save(); return 'Wrong code. Check the SMS and try again.'; }
  delete db.data.otps[phone];
  db.save();
  return null;
}

// Clean up expired sessions and codes once an hour
setInterval(() => {
  if (!db.data) return;
  const now = Date.now();
  for (const [k, s] of Object.entries(db.data.sessions)) if (s.exp < now) delete db.data.sessions[k];
  for (const [k, o] of Object.entries(db.data.otps)) if (o.exp < now) delete db.data.otps[k];
  db.save();
}, 3600e3).unref();

module.exports = { hashPassword, checkPassword, randomPassword, newSession, userFromRequest, endSession, cleanPhone, createOtp, verifyOtp };
