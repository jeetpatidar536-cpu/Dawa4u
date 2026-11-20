-- =====================================================================
-- dawa4u — security tightening after Supabase's security advisor.
-- * Internal helpers are no longer callable from the public API.
-- * Logged-out visitors get no helper functions; the policies that use them
--   now apply to signed-in users only (visitors still see the shop catalogue).
-- =====================================================================

-- Only the database itself (triggers, cron, other functions) runs these
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.expire_unpaid_orders() from public, anon, authenticated;
revoke execute on function public.has_pass(uuid) from public, anon, authenticated;

-- Helper functions used inside security policies: signed-in users only
revoke execute on function public.my_role(), public.is_admin(), public.my_pharmacy(), public.my_pharmacy_pins(),
  public.is_active_rider(), public.my_rider_city() from public, anon;
grant execute on function public.my_role(), public.is_admin(), public.my_pharmacy(), public.my_pharmacy_pins(),
  public.is_active_rider(), public.my_rider_city() to authenticated;

-- Policies that call those helpers now apply to signed-in users only
alter policy "settings admin" on public.settings to authenticated;
alter policy "own profile" on public.profiles to authenticated;
alter policy "edit own profile" on public.profiles to authenticated;
alter policy "products admin" on public.products to authenticated;
alter policy "pharmacy edits own" on public.pharmacies to authenticated;
alter policy "pos key owner" on public.pharmacy_keys to authenticated;
alter policy "inventory own" on public.inventory to authenticated;
alter policy "rider self" on public.riders to authenticated;
alter policy "rider edits self" on public.riders to authenticated;
alter policy "own addresses" on public.addresses to authenticated;
alter policy "rx customer" on public.prescriptions to authenticated;
alter policy "rx upload" on public.prescriptions to authenticated;
alter policy "orders by role" on public.orders to authenticated;
alter policy "orders admin" on public.orders to authenticated;
alter policy "items follow order" on public.order_items to authenticated;
alter policy "own pass" on public.pass_subscriptions to authenticated;
alter policy "applications admin" on public.partner_applications to authenticated;
alter policy "applications admin edit" on public.partner_applications to authenticated;
alter policy "tickets own" on public.support_tickets to authenticated;
alter policy "tickets create" on public.support_tickets to authenticated;
alter policy "tickets admin" on public.support_tickets to authenticated;
alter policy "rider location visible" on public.rider_locations to authenticated;

-- Policies visitors still need, rewritten so they don't call the helpers
drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products for select using (active);
create policy "products readable staff" on public.products for select to authenticated using (is_admin() or my_pharmacy() is not null);

drop policy if exists "pharmacies visible" on public.pharmacies;
create policy "pharmacies visible" on public.pharmacies for select using (status = 'active');
create policy "pharmacies visible own" on public.pharmacies for select to authenticated using (owner_id = auth.uid() or is_admin());

-- order_secrets intentionally has no policies: only order_otp() and rider_action() read it.
comment on table public.order_secrets is 'Delivery OTPs. No RLS policies on purpose: read only through order_otp() (customer) and rider_action() (rider).';
