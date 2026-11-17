// Sends the login OTP by SMS.
// Development: the code is printed in the server console and shown on the login screen.
// Production: plug in your SMS provider here (MSG91, Twilio, Fast2SMS, ...). India needs a
// DLT-registered sender ID and template for OTP messages.
const DEV = process.env.NODE_ENV !== 'production';

async function sendOtp(phone, code) {
  if (DEV) {
    console.log(`[dev] OTP for ${phone}: ${code}`);
    return { devCode: code };
  }
  // Example shape for a provider call:
  // await fetch('https://your-sms-provider/api/send', { method: 'POST', headers: {...}, body: JSON.stringify({ to: '91' + phone, text: `${code} is your dawa4u login code` }) });
  throw new Error('No SMS provider is set up. Add one in lib/sms.js before running in production.');
}

module.exports = { sendOtp, DEV };
