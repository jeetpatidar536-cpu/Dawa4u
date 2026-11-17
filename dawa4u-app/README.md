# dawa4u

Medicines from a local pharmacy, delivered by a local rider in 10 to 15 minutes.

One server, four separate apps:

| App | Who uses it | Kind | Address |
|---|---|---|---|
| Customer | People ordering medicines | Website | `/shop/` |
| Pharmacy | Partner pharmacists | Phone app (installable) | `/pharmacy/` |
| Rider | Delivery riders | Phone app (installable) | `/rider/` |
| Admin | You, the owner | Website | `/admin/` |

They all share one database through the server, so an order placed on the website shows up on the pharmacy's phone, then the rider's phone, then in admin, live.

## Run it on your computer

1. Install Node.js 20 or newer from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   node server.js
   ```
   Nothing else to install: the server uses no outside packages.
3. The first run prints the **admin, demo pharmacy and demo rider logins** and saves them in `data/first-run-logins.txt`. Write them down, then delete that file.
4. Open http://localhost:3000/shop/ and enter PIN code **452001** (the demo pharmacy's area).

To test the whole flow on one computer, open the four apps in four browser tabs.

## Settings (.env file)

Copy `.env.example` to `.env` and fill in what you have. Restart the server after changing it.

| Setting | What it does | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Turns on the vision AI prescription scanner (key from https://platform.claude.com) | The photo is still attached to the order and the pharmacist reads it |
| `ANTHROPIC_MODEL` | Which Claude model reads prescriptions | `claude-sonnet-5-5` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Real UPI, card and netbanking payments, and dawaPass payments | **Test mode**: online payments are marked paid with no money moving |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | First admin login | `admin` and a random password |
| `DEMO_DATA=0` | Skip the demo pharmacy and rider | Demo partners are created |
| `NODE_ENV=production` | Real mode: OTPs go by SMS | Login codes are shown on screen |
| `ALLOWED_ORIGINS` | Lets apps hosted on other domains call the server | Apps must be on the same address as the server |

## Put the phone apps on phones

The Pharmacy and Rider apps are installable web apps (PWAs).

- **Quickest:** open `https://your-domain/pharmacy/` in Chrome on the phone, tap ⋮ then **Install app**. It gets its own icon and opens full screen like any app.
- **Real Android APK / Play Store:** go to https://www.pwabuilder.com, enter `https://your-domain/pharmacy/`, choose Android and download the package. Do the same for `/rider/`. Installing as an app needs the site on **https** (any host below gives you that).

## Put it online

Any host that runs Node.js works. Simple options: Render, Railway, or a small VPS (DigitalOcean, Hostinger, AWS Lightsail).

- Start command: `node server.js`
- Set the `.env` values in the host's environment settings.
- Keep the `data/` folder on a **persistent disk**: it holds the database (`data/db.json`) and prescription photos (`data/rx/`). Back it up daily.

## Before real customers: checklist

- [ ] **SMS login codes:** add your SMS provider (MSG91, Twilio, Fast2SMS...) in `lib/sms.js`. India needs a DLT-registered sender ID and OTP template.
- [ ] **Razorpay keys** in `.env`, and test a real ₹1 payment.
- [ ] **AI key** in `.env`, and test with real prescriptions.
- [ ] **Change every password** (admin Settings; pharmacists and riders from their Store/Account tab).
- [ ] **Licences:** each partner pharmacy needs a valid drug licence, and selling prescription medicines online in India has legal rules. Check with a lawyer before launch.
- [ ] **Bigger database:** the built-in JSON database suits a pilot with a few pharmacies. Move to PostgreSQL or MongoDB (only `lib/db.js` talks to storage) before you grow.

## Connecting pharmacy billing software (Marg ERP and others)

In the Pharmacy app, the **POS link** tab offers two ways:

1. **Stock file:** export the item list or stock report from Marg as CSV (item name, stock, MRP columns) and upload it.
2. **Automatic sync by API:** the pharmacy gives its POS key to their Marg dealer, whose software calls:

```
POST /api/pos/stock          header X-POS-Key: <key>
     {"items":[{"name":"PARACETAMOL 650 TAB","code":"","stock":120,"mrp":34}]}   (or CSV)
GET  /api/pos/orders?since=0 header X-POS-Key: <key>
```

Items are matched by the POS item code (set it per medicine in Admin → Medicines) or by name. Marg's own API format may need a small adapter: share their API document with your developer.

## How the code is laid out

```
server.js            all API routes (customer, pharmacy, rider, admin, POS)
lib/db.js            JSON-file database
lib/auth.js          OTP and password logins, sessions
lib/ai.js            vision AI prescription reading (Claude API)
lib/payments.js      Razorpay orders and signature check
lib/pos.js           stock file and POS matching
lib/seed.js          medicine catalogue and first logins
lib/sms.js           where to plug in your SMS provider
public/shop/         customer website
public/pharmacy/     pharmacy phone app
public/rider/        rider phone app
public/admin/        admin website
public/common/       shared styles and helpers
```
