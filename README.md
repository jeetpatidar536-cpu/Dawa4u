# dawa4u apps

All three apps open the live dawa4u website (WordPress + WooCommerce on dawa4u.in), so they always show the latest
version and use the same accounts, orders, payments and stock as the website. No separate backend to keep in sync.

| App | Platform | Opens | Adds on top of the website |
|---|---|---|---|
| **dawa4u** (customer) | Android (`in.dawa4u.app`) | https://dawa4u.in/ | App layout with a bottom tab bar (Home, Medicines, Prescription, Orders, Account). The camera opens for prescription photos. UPI payment links open the customer's UPI app (GPay, PhonePe, Paytm), and Cashfree and bank pages stay inside the app so the customer comes back after paying. Back button works like a browser. |
| **dawa4u Rider** | Android (`in.dawa4u.rider`) | https://dawa4u.in/rider-dashboard/ | Screen stays on while delivering. Live location goes to the customer when the services stack is on. "Call" opens the dialer and "Map" opens Google Maps. The rider is kept on the rider screens. |
| **dawa4u Pharmacy** | Windows (`.exe`) | https://dawa4u.in/pharmacy-dashboard/ | Windows notification and flashing taskbar button when an order or prescription comes in. Keeps running in the tray when the window is closed. Starts with Windows. Downloads (orders CSV, stock template) open in their folder. |

The website notices the apps (`dawa4uApp/<name>` in the user agent) and switches to the app layout. See
`wp-content/plugins/dawa4u-core/inc/app-mode.php` on the `wp-core` branch.

## Building

GitHub Actions builds everything on every push to this branch. The files appear on the `app-builds` branch:
- Android: an `.aab` for the Play Store and a `-test.apk` to install directly.
- Windows: `dawa4u-Pharmacy-Setup-<version>.exe`. Files over 100 MB are split into parts; join them with `cat file.part-* > file`.

The Play Store upload key is **not** in this repository. Sign the `.aab` with it before uploading:

```bash
jarsigner -keystore dawa4u-upload.jks -signedjar dawa4u-customer-1.1.0.aab dawa4u-customer-1.1.0-unsigned.aab dawa4u-upload
```

Version numbers: `versionCode` / `versionName` in `mobile/<app>/android/app/build.gradle`, and `version` in
`desktop/pharmacy/package.json`. Raise them for every Play Store upload.
