# dawa4u — full version on Supabase

Medicines from a licensed local pharmacy, delivered by a local rider in 10–15 minutes.
Five apps share **one Supabase backend** (database, logins, file storage, live updates):

| App | Folder | Who | Runs as |
|---|---|---|---|
| Customer website | `web/shop/` | Customers on a computer | Website |
| Customer app | `web/app/` | Customers on a phone | Installable app + native Android/iPhone (`mobile/customer`) |
| Pharmacy dashboard | `web/pharmacy/` | Partner pharmacists | Desktop / tablet (installable) |
| Rider app (English + हिंदी) | `web/rider/` | Delivery riders | Installable app + native Android/iPhone (`mobile/rider`) |
| Admin dashboard | `web/admin/` | You, the owner | Desktop |

An order placed on the website or app rings on the pharmacy dashboard, then appears in nearby riders' apps, and shows up in admin. Every step updates live.

```
supabase/migrations/   database: tables, security rules, order/prescription/rider functions
supabase/seed.sql      40 starter medicines (check MRPs before launch)
supabase/functions/    razorpay-order, razorpay-verify, razorpay-webhook, pos-sync (Marg), sms-hook (MSG91)
web/common/            shared code: api.js (all backend calls), customer.js, config.js, styles
web/<app>/             the five apps — plain HTML/JS, no build step
mobile/                Capacitor projects that turn the customer and rider apps into Play Store / App Store apps
```

---

## 1. Set up Supabase (about 20 minutes)

1. Create a project at https://supabase.com → **New project**. Choose region **Mumbai (ap-south-1)**.
2. **Database:** open **SQL Editor**, paste all of `supabase/migrations/20261120000000_dawa4u.sql`, press **Run**. Then do the same with `supabase/seed.sql`.
   *(Or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, then run `seed.sql` once.)*
3. **Auto-cancel unpaid orders:** Database → Extensions → enable **pg_cron**, then run in SQL Editor:
   ```sql
   select cron.schedule('dawa4u-expire-unpaid', '*/5 * * * *', 'select public.expire_unpaid_orders()');
   ```
4. **Logins**
   - Authentication → Providers → **Phone**: turn on. For India, the simplest is MSG91 (step 6). You can also pick Twilio/Vonage/Textlocal here.
   - While testing, add **test numbers** (Authentication → Phone → *Test phone numbers and OTPs*), e.g. `919999999999=123456`. No SMS is sent for these. Keep one for Play Store / App Store reviewers.
   - Authentication → Providers → **Email**: on (pharmacies and admin log in with email + password).
   - Authentication → URL configuration → **Site URL**: your website address, e.g. `https://dawa4u.in/shop/`. Add `https://dawa4u.in/pharmacy/` and `https://dawa4u.in/admin/` under Redirect URLs (for password-reset emails).
5. **Payments (Razorpay)** — get keys from https://dashboard.razorpay.com → Settings → API keys. Then:
   ```bash
   npm i -g supabase
   supabase login && supabase link --project-ref <your-project-ref>
   supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=<choose-one>
   supabase functions deploy razorpay-order
   supabase functions deploy razorpay-verify
   supabase functions deploy razorpay-webhook --no-verify-jwt
   supabase functions deploy pos-sync --no-verify-jwt
   ```
   In Razorpay → Webhooks, add `https://<ref>.supabase.co/functions/v1/razorpay-webhook`, event **payment.captured**, with the same secret.
   *Until Razorpay is set up, admin **Settings → Test mode** (on by default) lets "Pay" work with no money moving.*
6. **SMS through MSG91 (recommended for India):** register a DLT template like `##otp## is your dawa4u login code. Do not share it.` Then:
   ```bash
   supabase secrets set MSG91_AUTH_KEY=xxx MSG91_TEMPLATE_ID=xxx SEND_SMS_HOOK_SECRET="v1,whsec_..."
   supabase functions deploy sms-hook --no-verify-jwt
   ```
   Authentication → Hooks → **Send SMS hook** → HTTPS → `https://<ref>.supabase.co/functions/v1/sms-hook`, and copy its secret into `SEND_SMS_HOOK_SECRET`.
7. **Make yourself admin:** Authentication → Users → **Add user** (your email + a strong password). Then in SQL Editor:
   ```sql
   update profiles set role = 'admin', name = 'Your name' where email = 'you@example.com';
   ```

## 2. Connect the apps

Open `web/common/config.js` and paste **Project URL** and **anon public key** (Project Settings → API). The anon key is meant to be public; the database security rules decide what each person may see and do. **Never** put the `service_role` key in the apps.

## 3. Put it online

The `web` folder is plain files — host it anywhere with HTTPS: **Netlify** (drag the `web` folder onto app.netlify.com/drop), **Vercel**, **Cloudflare Pages**, or Hostinger.

| Address | App |
|---|---|
| `https://your-domain/` or `/shop/` | Customer website |
| `/app/` | Customer phone app (Chrome → ⋮ → *Install app*) |
| `/pharmacy/` | Pharmacy dashboard |
| `/rider/` | Rider app |
| `/admin/` | Admin |

## 4. Try the whole flow

1. **Pharmacy:** open `/pharmacy/` → *Sign up* → fill shop details and the PIN codes it delivers to.
2. **Admin:** `/admin/` → Pharmacies → **Approve**. (Riders: Riders → Approve.)
3. **Pharmacy:** switch **Open** on, go to **Stock & prices**, enter stock (or upload a Marg stock CSV) → Save.
4. **Customer:** `/shop/` or `/app/` → enter a PIN the pharmacy serves → add medicines → log in with phone OTP → pay.
   - For prescription (Rx) medicines: upload a photo → the pharmacist opens it under **Prescriptions**, adds the medicines → they appear in the customer's cart.
5. **Pharmacy:** order rings → **Accept** → **Mark packed**.
6. **Rider:** `/rider/` → log in → register → (admin approves) → go **online** → **Accept** → **Picked up** → type the customer's 4-digit OTP → delivered.
7. **Admin** sees it all: sales, live orders, refunds, rider payouts, dawaPass, leads, support.

## 5. Native Android / iPhone apps

Needs Node 20+, **Android Studio** (for Android) and a **Mac with Xcode** (for iPhone).
```bash
cd mobile
npm install
npx cap add android --cwd customer      # first time only (also: rider, and ios)
npm run customer:android                # copies the app in and opens Android Studio → Build → Generate Signed Bundle
npm run rider:android
```
App IDs are `in.dawa4u.app` and `in.dawa4u.rider` (change them in `mobile/*/capacitor.config.json` before your first upload — they can't be changed later). For Play Store review, give Google a test phone number + OTP from step 1.4.

## 6. Maps (live rider tracking)

Maps use **Leaflet + OpenStreetMap** — free, no API key. Run `supabase/migrations/20261120100000_maps.sql` once (after the main migration).
- Customers drop a pin at their door when adding an address ("Use my location", search, or tap the map).
- Pharmacies set their shop pin in **Settings**.
- The rider app shares the phone's GPS every ~10 seconds while the rider is online. A customer sees the rider only while that rider is carrying their order; once the parcel is picked up the ETA is worked out from the rider's real position.
- Admin → Overview shows a live map of riders, pharmacies and live orders.
- For heavy traffic, switch map tiles to a provider with a free tier (MapTiler, Carto): set `MAP_TILES` and `MAP_ATTRIBUTION` in `web/common/config.js`. Address search uses OpenStreetMap Nominatim, which is for light use only.
- Rider GPS in a browser pauses when the phone screen is off; the native app build (`mobile/`) with a background-location plugin is the fix for full-day tracking.

## 7. Billing software (Marg ERP and others)

- **Upload a file:** Pharmacy → Stock & prices → *Upload stock file (CSV)*. Marg: Reports → Stock → Stock Status → export.
- **Automatic sync:** Pharmacy → POS link shows the pharmacy's secret key and the API for their software dealer:
  `POST /functions/v1/pos-sync` (stock, JSON or CSV) and `GET /functions/v1/pos-sync?since=…` (new orders), header `X-POS-Key`.
  Medicines match by **POS item code** (Admin → Medicines → Edit) or by name.

## How it's kept safe

- **Row-level security** on every table: customers see only their own orders, addresses and prescriptions; a pharmacy sees only its orders and prescriptions from its PIN codes; riders see only open jobs in their city and their own trips; admin sees everything.
- **Prices are worked out on the server** (`place_order`) from the pharmacy's stock — the app's numbers are only a preview.
- **Prescription medicines** can't be ordered unless a pharmacist has verified a prescription that lists them.
- **Delivery OTP** is visible only to the customer; the order completes only when the rider types it.
- **Prescription photos** are in a private bucket; only the customer, the pharmacist handling it and admin can open them (temporary links).
- **Payments** are confirmed only after the Razorpay signature is checked on the server; a payment that arrives after an order was cancelled is flagged for refund.

## Before real customers — checklist

- [ ] Turn **Test mode OFF** (Admin → Settings) once Razorpay live keys work. Test a real ₹1 payment and a refund.
- [ ] SMS: DLT sender ID + OTP template approved; remove test phone numbers you don't need.
- [ ] Check every MRP in Admin → Medicines (the seed prices are typical, not official).
- [ ] Each partner pharmacy has a valid drug licence; online sale of prescription medicines in India has legal requirements — confirm with a lawyer.
- [ ] Privacy policy and terms pages (the footer links currently go to About).
- [ ] Supabase **Pro** plan for daily backups and no project pausing.
- [ ] Set `ALLOWED_ORIGIN` secret to your website address for the edge functions.

## Not built yet (good next steps)

- Background GPS when the rider's screen is off (needs the native app + a background-location plugin).
- Push notifications when the app is closed (Firebase Cloud Messaging) — today alerts ring while the app/dashboard is open.
- Automatic refunds through the Razorpay API (today admin refunds in Razorpay and taps *Mark refunded*).
- Product photos (cards show the first letter of the medicine).
