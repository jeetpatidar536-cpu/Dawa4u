// Direct UPI payment box, shared by the customer app and the shop website.
// The customer pays to our UPI ID (QR on desktop, "Pay with UPI app" on phones),
// then types the 12-digit UPI reference (UTR). An admin confirms it in Admin → UPI payments.
import qrcode from './vendor/qrcode.js';
import { rupee, esc } from './api.js';

const qrCache = {};
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** upi://pay link understood by all UPI apps (GPay, PhonePe, Paytm, BHIM…) */
export function upiUri(o, s) {
  const p = [
    'pa=' + encodeURIComponent(s.upi_id).replace(/%40/g, '@'),
    'pn=' + encodeURIComponent(s.upi_name || 'dawa4u'),
    'am=' + Number(o.total).toFixed(2),
    'cu=INR',
    'tn=' + encodeURIComponent('dawa4u ' + o.id),
  ];
  return 'upi://pay?' + p.join('&');
}

function qrSvg(text) {
  if (!qrCache[text]) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    qrCache[text] = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }).replace('<svg ', '<svg width="100%" height="100%" ');
  }
  return qrCache[text];
}

/** HTML for an unpaid UPI order. Buttons: #upisubmit (data-id), #upicopy. Input: #upiref */
export function upiBox(o, s) {
  if (o.pay_status === 'verifying') {
    return `<div class="card stack" style="padding:20px;gap:8px;border:1.5px solid var(--gold)">
      <span class="b" style="font-size:17px">Checking your UPI payment</span>
      <span class="s14 mute">We got your UPI reference ending <b>${esc(String(o.upi_ref || '').slice(-4))}</b>. Your order goes to the pharmacy as soon as we see ${rupee(o.total)} in our account — usually within a few minutes.</span></div>`;
  }
  if (!s.upi_id) {
    return `<div class="card stack" style="padding:20px;gap:8px"><span class="b">UPI payments are not set up yet</span>
      <span class="s14 mute">Please cancel this order and choose Cash on delivery.</span></div>`;
  }
  const uri = upiUri(o, s);
  return `<div class="card stack" style="padding:20px;gap:14px">
    <div class="stack" style="gap:2px"><span class="b" style="font-size:18px">Pay ${rupee(o.total)} by UPI</span>
      <span class="s13 mute">To <b>${esc(s.upi_name || 'dawa4u')}</b> · UPI ID <b>${esc(s.upi_id)}</b> <button id="upicopy" type="button" style="background:none;border:0;color:var(--em-text);font:inherit;font-weight:700;cursor:pointer;padding:0 4px;display:inline">Copy</button></span></div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center">
      <div style="width:184px;height:184px;background:#fff;border-radius:14px;padding:6px;flex:none" aria-label="UPI QR code">${qrSvg(uri)}</div>
      <div class="stack" style="gap:8px;flex:1 1 200px">
        ${isPhone() ? `<a class="btn" href="${esc(uri)}" style="text-decoration:none">Pay with UPI app</a>` : ''}
        <span class="s13 mute">${isPhone() ? 'Or scan' : 'Scan'} the QR code with Google Pay, PhonePe, Paytm, BHIM or any UPI app. Pay exactly <b>${rupee(o.total)}</b>.</span>
      </div>
    </div>
    <label class="field">After paying, enter the 12-digit UPI reference number (UTR)
      <input id="upiref" inputmode="numeric" maxlength="14" placeholder="e.g. 431234567890" autocomplete="off"></label>
    <span class="s12 mute">Find it in your UPI app under the payment details (called UTR, UPI Ref No. or Transaction ID).</span>
    <button class="btn" id="upisubmit" data-id="${esc(o.id)}">I have paid ${rupee(o.total)}</button>
  </div>`;
}
