# dawa4u core (WordPress plugin)

Runs dawa4u on WooCommerce:

- **Medicines** — the 40 medicines are added as WooCommerce products on first run (dawa4u.in/medicines/). Medicines marked "Needs prescription" ask for a photo of the prescription at checkout.
- **Prescriptions** — checked by the partner pharmacy's pharmacist before packing. Customers can also send a prescription first (Upload prescription); the pharmacist adds the medicines and the customer gets an email to pay.
- **dawaPass** — ₹100 for 30 days: 15% off medicines, free delivery.
- **Charges** — delivery ₹25 (free with dawaPass) + handling ₹5. Change them in WooCommerce → dawa4u partners.
- **Pharmacy dashboard** (/pharmacy-dashboard/) and **Rider dashboard** (/rider-dashboard/) — sign up with email verification; the dawa4u team approves them in WooCommerce → dawa4u partners.
- **Delivery code** — the customer tells the rider a 4-digit code; the rider enters it to finish the delivery.

Order statuses: Prescription request → Prescription check → Processing (packing) → Ready for pickup → Out for delivery → Completed.

Prescription files are stored in `wp-content/uploads/dawa4u-rx/` (closed to the web); only the customer, their pharmacy and the dawa4u team can open them.
