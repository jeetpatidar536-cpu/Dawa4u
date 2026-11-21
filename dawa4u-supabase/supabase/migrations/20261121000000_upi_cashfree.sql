-- =====================================================================
-- Payments without Razorpay
--   • Direct UPI: customer pays to the business UPI ID (QR / UPI app link),
--     types the 12-digit UPI reference (UTR); an admin confirms it.
--   • Cards & netbanking: Cashfree (edge functions cashfree-order /
--     cashfree-verify / cashfree-webhook call mark_paid()).
-- =====================================================================

-- Business UPI details (shown to customers; not secret)
alter table public.settings
  add column if not exists upi_id text not null default '',
  add column if not exists upi_name text not null default 'dawa4u';

-- UPI reference typed by the customer, and who/when it was checked
alter table public.orders
  add column if not exists upi_ref text,
  add column if not exists upi_submitted_at timestamptz,
  add column if not exists upi_checked_by uuid references public.profiles (id),
  add column if not exists pay_gateway text;   -- 'cashfree' for card / netbanking
comment on column public.orders.razorpay_order_id is 'Gateway order id (Cashfree order id = our order id)';
comment on column public.orders.razorpay_payment_id is 'Gateway payment id (Cashfree cf_payment_id)';

create unique index if not exists orders_upi_ref_key on public.orders (upi_ref) where upi_ref is not null;

-- new pay status: 'verifying' = customer says they paid by UPI, waiting for an admin to check
alter table public.orders drop constraint if exists orders_pay_status_check;
alter table public.orders add constraint orders_pay_status_check
  check (pay_status in ('pending', 'verifying', 'paid', 'cod', 'refund_due', 'refunded'));

-- Unpaid orders still expire, but not while a UPI payment is being checked
create or replace function public.expire_unpaid_orders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; mins int;
begin
  select payment_minutes into mins from settings where id = 1;
  for r in select id from orders
           where status = 'pending_payment' and pay_status = 'pending'
             and created_at < now() - make_interval(mins => mins)
           for update skip locked loop
    perform _restore_stock(r.id);
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Customer: "I have paid" with the 12-digit UPI reference number
create or replace function public.submit_upi_ref(p_order_id text, p_ref text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders; ref text := regexp_replace(coalesce(p_ref, ''), '\D', '', 'g');
begin
  if length(ref) <> 12 then raise exception 'Enter the 12-digit UPI reference number (UTR) from your UPI app'; end if;
  select * into o from orders where id = p_order_id and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.pay_method <> 'upi' then raise exception 'This order is not a UPI order'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled. If you paid, write to support with your UPI reference.'; end if;
  if o.pay_status not in ('pending', 'verifying') then return o; end if;
  if exists (select 1 from orders where upi_ref = ref and id <> o.id) then
    raise exception 'This UPI reference was already used for another order';
  end if;
  update orders set upi_ref = ref, upi_submitted_at = now(), pay_status = 'verifying' where id = o.id returning * into o;
  return o;
end $$;

-- Admin: confirm the money arrived (order goes to the pharmacy) or reject it
create or replace function public.admin_upi_review(p_order_id text, p_ok boolean, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.pay_method <> 'upi' then raise exception 'Not a UPI order'; end if;
  if p_ok then
    if o.pay_status = 'paid' then return o; end if;
    if o.status = 'cancelled' then
      update orders set pay_status = 'refund_due', upi_checked_by = auth.uid() where id = o.id returning * into o;
      return o;
    end if;
    update orders set pay_status = 'paid', status = 'placed', placed_at = now(), upi_checked_by = auth.uid()
     where id = o.id returning * into o;
    perform _grant_pass(o);
  else
    if o.status <> 'pending_payment' then raise exception 'Order is already %', o.status; end if;
    perform _restore_stock(o.id);
    update orders set status = 'cancelled', cancelled_at = now(), pay_status = 'pending', upi_checked_by = auth.uid(),
           cancel_reason = left(coalesce(nullif(trim(p_note), ''), 'We could not find your UPI payment. If money left your account, write to support with your UPI reference.'), 200)
     where id = o.id returning * into o;
  end if;
  return o;
end $$;

-- Customer cancel: if a UPI payment was already reported, mark it for refund
create or replace function public.customer_cancel(p_order_id text, p_reason text default 'Cancelled by customer')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order_id and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status not in ('pending_payment', 'placed') then raise exception 'The pharmacy has already started packing this order. Please call support.'; end if;
  perform _restore_stock(o.id);
  update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 200),
         pay_status = case when (pay_status = 'paid' and not pay_test) or pay_status = 'verifying' then 'refund_due' else pay_status end
   where id = o.id returning * into o;
  return o;
end $$;

-- Admin stats: add UPI payments waiting for a check
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare day timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'orders_today', (select count(*) from orders where created_at >= day and status <> 'cancelled'),
    'gmv_today', (select coalesce(sum(total), 0) from orders where created_at >= day and status not in ('cancelled', 'pending_payment')),
    'live', (select count(*) from orders where status in ('placed', 'accepted', 'packed', 'picked')),
    'delivered_today', (select count(*) from orders where delivered_at >= day),
    'avg_minutes', (select round(avg(extract(epoch from delivered_at - placed_at) / 60)) from orders where delivered_at >= now() - interval '7 days'),
    'customers', (select count(*) from profiles where role = 'customer'),
    'pass_members', (select count(*) from profiles where pass_until > now()),
    'pharmacies_active', (select count(*) from pharmacies where status = 'active'),
    'pharmacies_pending', (select count(*) from pharmacies where status = 'pending'),
    'riders_online', (select count(*) from riders where status = 'active' and online),
    'riders_pending', (select count(*) from riders where status = 'pending'),
    'rx_waiting', (select count(*) from prescriptions where status in ('pending', 'reading')),
    'refunds_due', (select count(*) from orders where pay_status = 'refund_due'),
    'upi_to_check', (select count(*) from orders where pay_status = 'verifying' and status = 'pending_payment'),
    'rider_unpaid', (select coalesce(sum(rider_pay), 0) from orders where status = 'delivered' and not rider_paid),
    'week', (select coalesce(jsonb_agg(d order by d ->> 'day'), '[]') from (
        select jsonb_build_object('day', to_char(g at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'orders', (select count(*) from orders where status not in ('cancelled', 'pending_payment') and created_at >= g and created_at < g + interval '1 day'),
          'gmv', (select coalesce(sum(total), 0) from orders where status not in ('cancelled', 'pending_payment') and created_at >= g and created_at < g + interval '1 day')) d
        from generate_series(day - interval '6 days', day, interval '1 day') g) w)
  );
end $$;

revoke execute on function public.submit_upi_ref(text, text), public.admin_upi_review(text, boolean, text) from public, anon;
grant execute on function public.submit_upi_ref(text, text), public.admin_upi_review(text, boolean, text) to authenticated;
revoke execute on function public.expire_unpaid_orders() from public, anon, authenticated;
