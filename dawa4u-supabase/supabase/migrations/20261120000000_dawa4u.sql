-- =====================================================================
-- dawa4u — full database (Supabase / Postgres)
-- Customer app + website, Pharmacy dashboard, Rider app, Admin dashboard
-- all share this one database. Money is whole rupees (INR).
-- Every write that matters (placing an order, accepting it, delivering it)
-- goes through a SECURITY DEFINER function below, so prices, stock and
-- status changes are always checked on the server, never trusted from apps.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
do $$ begin
  create type public.user_role as enum ('customer', 'pharmacist', 'rider', 'admin');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
create table public.settings (
  id int primary key default 1 check (id = 1),
  delivery_fee int not null default 25,
  handling_fee int not null default 5,
  pass_price int not null default 100,          -- dawaPass: ₹100 / month
  pass_off int not null default 15,             -- % off for dawaPass members
  rider_pay int not null default 30,            -- paid to rider per delivery
  payment_minutes int not null default 15,      -- unpaid online orders auto-cancel after this
  payments_test_mode boolean not null default true, -- true = "Pay" works without Razorpay (turn OFF at launch)
  announcement text not null default ''
);
insert into public.settings (id) values (1);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  name text not null default '',
  phone text,
  email text,
  pass_until timestamptz,                       -- dawaPass active while this is in the future
  created_at timestamptz not null default now()
);

create table public.products (
  id text primary key default 'p' || substr(md5(random()::text), 1, 8),
  name text not null,
  salt text not null default '',
  pack text not null default '',
  category text not null default 'other',
  mrp int not null check (mrp > 0),
  rx boolean not null default false,            -- prescription medicine
  pos_code text,                                -- item code in billing software (Marg etc.)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null,
  licence_no text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  pins text[] not null default '{}',            -- PIN codes this pharmacy delivers to
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  open boolean not null default false,
  created_at timestamptz not null default now()
);

-- Secret key the pharmacy's billing software uses for automatic stock sync.
create table public.pharmacy_keys (
  pharmacy_id uuid primary key references public.pharmacies (id) on delete cascade,
  pos_key text not null unique default encode(gen_random_bytes(18), 'hex')
);

create table public.inventory (
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  stock int not null default 0 check (stock >= 0),
  price int check (price is null or price > 0),  -- null = sell at MRP
  updated_at timestamptz not null default now(),
  primary key (pharmacy_id, product_id)
);

create table public.riders (
  id uuid primary key references public.profiles (id) on delete cascade,
  name text not null,
  phone text not null default '',
  vehicle text not null default '',
  city text not null default '',
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  online boolean not null default false,
  lang text not null default 'en' check (lang in ('en', 'hi')),
  created_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label text not null,
  line text not null,
  pin text not null check (pin ~ '^[1-9][0-9]{5}$'),
  created_at timestamptz not null default now()
);

-- A prescription is read by a licensed pharmacist (no AI). They add the medicines.
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pin text not null,
  photos text[] not null default '{}',          -- storage paths in bucket "prescriptions"
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'reading', 'done', 'rejected')),
  pharmacy_id uuid references public.pharmacies (id),
  items jsonb not null default '[]',            -- [{product_id, qty}] added by the pharmacist
  pharmacist_note text not null default '',
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create sequence public.order_seq start 100001;
create table public.orders (
  id text primary key default 'D4U' || nextval('public.order_seq'),
  customer_id uuid not null references public.profiles (id),
  customer_name text not null default '',
  customer_phone text not null default '',
  pharmacy_id uuid not null references public.pharmacies (id),
  pharmacy_name text not null default '',
  pharmacy_address text not null default '',
  rider_id uuid references public.riders (id),
  rider_name text,
  rider_phone text,
  prescription_id uuid references public.prescriptions (id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'placed', 'accepted', 'packed', 'picked', 'delivered', 'cancelled')),
  pay_method text not null check (pay_method in ('upi', 'card', 'netbanking', 'cod')),
  pay_status text not null default 'pending' check (pay_status in ('pending', 'paid', 'cod', 'refund_due', 'refunded')),
  pay_test boolean not null default false,      -- marked paid in test mode (no money moved)
  razorpay_order_id text unique,
  razorpay_payment_id text,
  address_label text not null,
  address_line text not null,
  pin text not null,
  sub int not null,                              -- items at selling price
  mrp_total int not null,
  disc int not null default 0,
  delivery int not null default 0,
  handling int not null default 0,
  pass_fee int not null default 0,
  total int not null,
  with_pass boolean not null default false,      -- dawaPass discount applied
  buys_pass boolean not null default false,      -- customer is buying dawaPass with this order
  rider_pay int not null default 0,
  rider_paid boolean not null default false,
  cancel_reason text,
  created_at timestamptz not null default now(),
  placed_at timestamptz, accepted_at timestamptz, packed_at timestamptz,
  picked_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz
);
create index on public.orders (customer_id, created_at desc);
create index on public.orders (pharmacy_id, status);
create index on public.orders (rider_id, status);
create index on public.orders (status);

create table public.order_items (
  order_id text not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id),
  name text not null,
  pack text not null default '',
  qty int not null check (qty between 1 and 20),
  price int not null,
  mrp int not null,
  rx boolean not null default false,
  primary key (order_id, product_id)
);

-- Delivery OTP: only the customer can read it; the rider must type it at the door.
create table public.order_secrets (
  order_id text primary key references public.orders (id) on delete cascade,
  otp text not null
);

create table public.pass_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id text references public.orders (id),
  amount int not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pharmacy', 'rider')),
  name text not null,
  phone text not null,
  detail text not null default '',
  city text not null default '',
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  order_id text references public.orders (id),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  reply text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

create or replace function public.my_pharmacy() returns uuid
language sql stable security definer set search_path = public as
$$ select id from pharmacies where owner_id = auth.uid() and status = 'active' $$;

create or replace function public.my_pharmacy_pins() returns text[]
language sql stable security definer set search_path = public as
$$ select coalesce((select pins from pharmacies where owner_id = auth.uid() and status = 'active'), '{}') $$;

create or replace function public.is_active_rider() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from riders where id = auth.uid() and status = 'active') $$;

create or replace function public.my_rider_city() returns text
language sql stable security definer set search_path = public as
$$ select city from riders where id = auth.uid() and status = 'active' $$;

-- New sign-up (phone OTP or email) -> profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone, email, name)
  values (new.id, new.phone, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.has_pass(uid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select pass_until > now() from profiles where id = uid), false) $$;

-- Give dawaPass for 30 days (extends an active pass)
create or replace function public._grant_pass(o public.orders) returns void
language plpgsql security definer set search_path = public as $$
declare s timestamptz; e timestamptz;
begin
  if not o.buys_pass then return; end if;
  if exists (select 1 from pass_subscriptions where order_id = o.id) then return; end if;
  select greatest(now(), coalesce(pass_until, now())) into s from profiles where id = o.customer_id;
  e := s + interval '30 days';
  update profiles set pass_until = e where id = o.customer_id;
  insert into pass_subscriptions (user_id, order_id, amount, starts_at, ends_at) values (o.customer_id, o.id, o.pass_fee, s, e);
end $$;

create or replace function public._restore_stock(oid text) returns void
language sql security definer set search_path = public as $$
  update inventory i set stock = i.stock + oi.qty, updated_at = now()
  from order_items oi, orders o
  where oi.order_id = oid and o.id = oid and i.pharmacy_id = o.pharmacy_id and i.product_id = oi.product_id
$$;

-- Unpaid online orders release their stock after settings.payment_minutes
create or replace function public.expire_unpaid_orders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; mins int;
begin
  select payment_minutes into mins from settings where id = 1;
  for r in select id from orders where status = 'pending_payment' and created_at < now() - make_interval(mins => mins) for update skip locked loop
    perform _restore_stock(r.id);
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- customer functions
-- Which pharmacy serves this PIN and what it has. Used by the shop to show stock and prices.
create or replace function public.shop_catalog(p_pin text)
returns table (id text, name text, salt text, pack text, category text, mrp int, rx boolean, price int, stock int, pharmacy_id uuid, pharmacy_name text)
language sql stable security definer set search_path = public as $$
  with ph as (
    select p.id, p.name from pharmacies p
    where p.status = 'active' and p.open and p_pin = any (p.pins)
    order by (select count(*) from inventory i where i.pharmacy_id = p.id and i.stock > 0) desc
    limit 1
  )
  select pr.id, pr.name, pr.salt, pr.pack, pr.category, pr.mrp, pr.rx,
         coalesce(i.price, pr.mrp), coalesce(i.stock, 0), ph.id, ph.name
  from products pr
  left join ph on true
  left join inventory i on i.pharmacy_id = ph.id and i.product_id = pr.id
  where pr.active
  order by pr.category, pr.name
$$;

-- Place an order. Prices, discounts, stock and prescription checks all happen here.
-- p_items: [{"product_id":"p1","qty":2}, ...]
create or replace function public.place_order(
  p_items jsonb, p_address_id uuid, p_pay_method text,
  p_prescription_id uuid default null, p_buy_pass boolean default false
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  me profiles; a addresses; ph pharmacies; st settings; rx prescriptions; o orders;
  it record; n_items int := 0;
  v_sub int := 0; v_mrp int := 0; v_disc int; v_del int; v_hand int; v_passfee int := 0; v_with_pass boolean;
begin
  if uid is null then raise exception 'Please log in first' using errcode = '28000'; end if;
  if p_pay_method not in ('upi', 'card', 'netbanking', 'cod') then raise exception 'Choose a payment method'; end if;
  perform expire_unpaid_orders();
  select * into me from profiles where id = uid;
  select * into st from settings where id = 1;
  select * into a from addresses where id = p_address_id and user_id = uid;
  if a.id is null then raise exception 'Choose a delivery address'; end if;

  select * into ph from pharmacies p
   where p.status = 'active' and p.open and a.pin = any (p.pins)
   order by (select count(*) from inventory i where i.pharmacy_id = p.id and i.stock > 0) desc limit 1;
  if ph.id is null then raise exception 'Sorry, no partner pharmacy delivers to PIN % yet', a.pin; end if;

  if p_prescription_id is not null then
    select * into rx from prescriptions where id = p_prescription_id and customer_id = uid;
    if rx.id is null then raise exception 'Prescription not found'; end if;
  end if;

  insert into orders (customer_id, customer_name, customer_phone, pharmacy_id, pharmacy_name, pharmacy_address,
                      prescription_id, pay_method, address_label, address_line, pin, sub, mrp_total, total)
  values (uid, me.name, coalesce(me.phone, ''), ph.id, ph.name, ph.address, rx.id, p_pay_method, a.label, a.line, a.pin, 0, 0, 0)
  returning * into o;

  for it in
    select x.product_id, least(greatest(x.qty, 1), 20) as qty, pr.name, pr.pack, pr.mrp, pr.rx, pr.active,
           coalesce(i.price, pr.mrp) as price, coalesce(i.stock, 0) as stock
    from jsonb_to_recordset(p_items) as x (product_id text, qty int)
    join products pr on pr.id = x.product_id
    left join inventory i on i.pharmacy_id = ph.id and i.product_id = x.product_id
  loop
    if not it.active then raise exception '% is no longer sold', it.name; end if;
    if it.stock < it.qty then raise exception 'Only % of % left at %', it.stock, it.name, ph.name; end if;
    if it.rx then
      if rx.id is null or rx.status <> 'done'
         or not exists (select 1 from jsonb_array_elements(rx.items) e where e ->> 'product_id' = it.product_id) then
        raise exception '% needs a prescription verified by our pharmacist', it.name;
      end if;
    end if;
    update inventory set stock = stock - it.qty, updated_at = now() where pharmacy_id = ph.id and product_id = it.product_id;
    insert into order_items values (o.id, it.product_id, it.name, it.pack, it.qty, it.price, it.mrp, it.rx);
    v_sub := v_sub + it.price * it.qty; v_mrp := v_mrp + it.mrp * it.qty; n_items := n_items + 1;
  end loop;
  if n_items = 0 then raise exception 'Your cart is empty'; end if;

  v_with_pass := has_pass(uid) or p_buy_pass;
  if p_buy_pass and not has_pass(uid) then v_passfee := st.pass_price; end if;
  v_disc := case when v_with_pass then round(v_sub * st.pass_off / 100.0) else 0 end;
  v_del := case when v_with_pass then 0 else st.delivery_fee end;
  v_hand := st.handling_fee;

  update orders set sub = v_sub, mrp_total = v_mrp, disc = v_disc, delivery = v_del, handling = v_hand,
         pass_fee = v_passfee, with_pass = v_with_pass, buys_pass = v_passfee > 0,
         total = v_sub - v_disc + v_del + v_hand + v_passfee, rider_pay = st.rider_pay,
         status = case when p_pay_method = 'cod' then 'placed' else 'pending_payment' end,
         pay_status = case when p_pay_method = 'cod' then 'cod' else 'pending' end,
         placed_at = case when p_pay_method = 'cod' then now() end
   where id = o.id returning * into o;

  insert into order_secrets values (o.id, lpad((floor(random() * 10000))::int::text, 4, '0'));
  return o;
end $$;

-- Called ONLY by the Razorpay edge function (service role) after the signature is verified.
create or replace function public.mark_paid(p_order_id text, p_rz_order text, p_rz_payment text, p_amount_paise int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.pay_status = 'paid' then return o; end if;                       -- webhook + verify may both arrive
  if p_amount_paise <> o.total * 100 then raise exception 'Amount mismatch'; end if;
  if o.status = 'cancelled' then                                          -- paid after it expired: refund it
    update orders set pay_status = 'refund_due', razorpay_payment_id = p_rz_payment where id = o.id returning * into o;
    return o;
  end if;
  update orders set pay_status = 'paid', status = 'placed', placed_at = now(),
         razorpay_order_id = coalesce(razorpay_order_id, p_rz_order), razorpay_payment_id = p_rz_payment
   where id = o.id returning * into o;
  perform _grant_pass(o);
  return o;
end $$;

-- Test mode only (settings.payments_test_mode = true): lets "Pay" work before Razorpay is set up.
create or replace function public.test_pay(p_order_id text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not (select payments_test_mode from settings where id = 1) then raise exception 'Test payments are switched off'; end if;
  select * into o from orders where id = p_order_id and customer_id = auth.uid() and status = 'pending_payment' for update;
  if o.id is null then raise exception 'Order not found or already paid'; end if;
  update orders set pay_status = 'paid', pay_test = true, status = 'placed', placed_at = now() where id = o.id returning * into o;
  perform _grant_pass(o);
  return o;
end $$;

create or replace function public.customer_cancel(p_order_id text, p_reason text default 'Cancelled by customer')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order_id and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status not in ('pending_payment', 'placed') then raise exception 'The pharmacy has already started packing this order. Please call support.'; end if;
  perform _restore_stock(o.id);
  update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 200),
         pay_status = case when pay_status = 'paid' and not pay_test then 'refund_due' else pay_status end
   where id = o.id returning * into o;
  return o;
end $$;

create or replace function public.order_otp(p_order_id text) returns text
language sql stable security definer set search_path = public as $$
  select s.otp from order_secrets s join orders o on o.id = s.order_id
  where s.order_id = p_order_id and o.customer_id = auth.uid()
$$;

-- ---------------------------------------------------------------- pharmacy functions
create or replace function public.register_pharmacy(p_name text, p_licence text, p_phone text, p_address text, p_city text, p_pins text[])
returns public.pharmacies language plpgsql security definer set search_path = public as $$
declare ph pharmacies;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if exists (select 1 from pharmacies where owner_id = auth.uid()) then raise exception 'You have already registered a pharmacy'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_licence), '') = '' then raise exception 'Pharmacy name and drug licence number are required'; end if;
  insert into pharmacies (owner_id, name, licence_no, phone, address, city, pins)
  values (auth.uid(), trim(p_name), trim(p_licence), trim(p_phone), trim(p_address), trim(p_city),
          array(select distinct trim(x) from unnest(p_pins) x where trim(x) ~ '^[1-9][0-9]{5}$'))
  returning * into ph;
  insert into pharmacy_keys (pharmacy_id) values (ph.id);
  return ph;
end $$;

-- accept -> pack -> (rider picks up) ; or cancel with a reason
create or replace function public.pharmacy_order_action(p_order_id text, p_action text, p_reason text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders; mine uuid := my_pharmacy();
begin
  if mine is null then raise exception 'Not a pharmacy account'; end if;
  select * into o from orders where id = p_order_id and pharmacy_id = mine for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if p_action = 'accept' and o.status = 'placed' then
    update orders set status = 'accepted', accepted_at = now() where id = o.id returning * into o;
  elsif p_action = 'pack' and o.status = 'accepted' then
    update orders set status = 'packed', packed_at = now() where id = o.id returning * into o;
  elsif p_action = 'cancel' and o.status in ('placed', 'accepted', 'packed') then
    perform _restore_stock(o.id);
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled by pharmacy'),
           pay_status = case when pay_status = 'paid' and not pay_test then 'refund_due' else pay_status end
     where id = o.id returning * into o;
  else
    raise exception 'Cannot % an order that is %', p_action, o.status;
  end if;
  return o;
end $$;

-- Pharmacist opens a prescription from their area
create or replace function public.rx_claim(p_rx_id uuid) returns public.prescriptions
language plpgsql security definer set search_path = public as $$
declare r prescriptions; mine uuid := my_pharmacy();
begin
  if mine is null then raise exception 'Not a pharmacy account'; end if;
  update prescriptions set status = 'reading', pharmacy_id = mine
   where id = p_rx_id and (status = 'pending' or (status = 'reading' and pharmacy_id = mine)) and pin = any (my_pharmacy_pins())
  returning * into r;
  if r.id is null then raise exception 'Another pharmacist has already picked this prescription'; end if;
  return r;
end $$;

-- Pharmacist finishes: adds the medicines (or rejects with a reason)
create or replace function public.rx_review(p_rx_id uuid, p_items jsonb, p_note text, p_reject boolean default false)
returns public.prescriptions language plpgsql security definer set search_path = public as $$
declare r prescriptions; mine uuid := my_pharmacy(); clean jsonb;
begin
  if mine is null then raise exception 'Not a pharmacy account'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'qty', least(greatest((x ->> 'qty')::int, 1), 20))), '[]')
    into clean
    from jsonb_array_elements(coalesce(p_items, '[]')) x join products p on p.id = x ->> 'product_id';
  if not p_reject and jsonb_array_length(clean) = 0 then raise exception 'Add at least one medicine, or reject with a reason'; end if;
  update prescriptions set status = case when p_reject then 'rejected' else 'done' end,
         items = case when p_reject then '[]' else clean end,
         pharmacist_note = coalesce(p_note, ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_rx_id and pharmacy_id = mine and status = 'reading'
  returning * into r;
  if r.id is null then raise exception 'Open the prescription first'; end if;
  return r;
end $$;

create or replace function public.pharmacy_set_stock(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare mine uuid := my_pharmacy(); n int;
begin
  if mine is null then raise exception 'Not a pharmacy account'; end if;
  insert into inventory (pharmacy_id, product_id, stock, price, updated_at)
  select mine, x.product_id, greatest(x.stock, 0), nullif(x.price, 0), now()
  from jsonb_to_recordset(p_items) as x (product_id text, stock int, price int)
  where exists (select 1 from products p where p.id = x.product_id)
  on conflict (pharmacy_id, product_id) do update set stock = excluded.stock, price = excluded.price, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- rider functions
create or replace function public.register_rider(p_name text, p_vehicle text, p_city text)
returns public.riders language plpgsql security definer set search_path = public as $$
declare r riders;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  insert into riders (id, name, phone, vehicle, city)
  values (auth.uid(), trim(p_name), coalesce((select phone from profiles where id = auth.uid()), ''), trim(p_vehicle), trim(p_city))
  on conflict (id) do update set name = excluded.name, vehicle = excluded.vehicle, city = excluded.city
  returning * into r;
  return r;
end $$;

create or replace function public.rider_action(p_order_id text, p_action text, p_otp text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders; me riders;
begin
  select * into me from riders where id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'Your rider account is not active yet'; end if;
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;

  if p_action = 'accept' then
    if not me.online then raise exception 'Go online to take orders'; end if;
    if o.rider_id is not null then raise exception 'Another rider has taken this order'; end if;
    if o.status not in ('accepted', 'packed') then raise exception 'This order is not ready for a rider'; end if;
    if exists (select 1 from orders where rider_id = me.id and status in ('accepted', 'packed', 'picked')) then
      raise exception 'Finish your current delivery first';
    end if;
    update orders set rider_id = me.id, rider_name = me.name, rider_phone = me.phone where id = o.id returning * into o;
  elsif o.rider_id is distinct from me.id then
    raise exception 'This is not your order';
  elsif p_action = 'pickup' then
    if o.status <> 'packed' then raise exception 'Wait until the pharmacy marks it packed'; end if;
    update orders set status = 'picked', picked_at = now() where id = o.id returning * into o;
  elsif p_action = 'deliver' then
    if o.status <> 'picked' then raise exception 'Pick up the order first'; end if;
    if p_otp is distinct from (select otp from order_secrets where order_id = o.id) then raise exception 'Wrong OTP. Ask the customer again.'; end if;
    update orders set status = 'delivered', delivered_at = now(),
           pay_status = case when pay_method = 'cod' then 'paid' else pay_status end
     where id = o.id returning * into o;
    if o.pay_method = 'cod' then perform _grant_pass(o); end if;
  elsif p_action = 'release' then
    if o.status = 'picked' then raise exception 'You already have the parcel. Call support.'; end if;
    update orders set rider_id = null, rider_name = null, rider_phone = null where id = o.id returning * into o;
  else
    raise exception 'Unknown action';
  end if;
  return o;
end $$;

-- ---------------------------------------------------------------- admin functions
create or replace function public.admin_set_partner(p_kind text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('pending', 'active', 'suspended') then raise exception 'Bad status'; end if;
  if p_kind = 'pharmacy' then
    update pharmacies set status = p_status, open = case when p_status = 'active' then open else false end
     where id = p_id returning owner_id into owner;
    if owner is null then raise exception 'Pharmacy not found'; end if;
    update profiles set role = case when p_status = 'active' then 'pharmacist'::user_role else 'customer'::user_role end
     where id = owner and role <> 'admin';
  elsif p_kind = 'rider' then
    update riders set status = p_status, online = case when p_status = 'active' then online else false end where id = p_id;
    if not found then raise exception 'Rider not found'; end if;
    update profiles set role = case when p_status = 'active' then 'rider'::user_role else 'customer'::user_role end
     where id = p_id and role <> 'admin';
  else
    raise exception 'Unknown kind';
  end if;
end $$;

create or replace function public.admin_cancel_order(p_order_id text, p_reason text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into o from orders where id = p_order_id for update;
  if o.status in ('delivered', 'cancelled') then raise exception 'Order is already %', o.status; end if;
  perform _restore_stock(o.id);
  update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled by dawa4u'),
         pay_status = case when pay_status = 'paid' and not pay_test then 'refund_due' else pay_status end
   where id = o.id returning * into o;
  return o;
end $$;

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
    'rider_unpaid', (select coalesce(sum(rider_pay), 0) from orders where status = 'delivered' and not rider_paid),
    'week', (select coalesce(jsonb_agg(d order by d ->> 'day'), '[]') from (
        select jsonb_build_object('day', to_char(g at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'orders', (select count(*) from orders where status not in ('cancelled', 'pending_payment') and created_at >= g and created_at < g + interval '1 day'),
          'gmv', (select coalesce(sum(total), 0) from orders where status not in ('cancelled', 'pending_payment') and created_at >= g and created_at < g + interval '1 day')) d
        from generate_series(day - interval '6 days', day, interval '1 day') g) w)
  );
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.pharmacies enable row level security;
alter table public.pharmacy_keys enable row level security;
alter table public.inventory enable row level security;
alter table public.riders enable row level security;
alter table public.addresses enable row level security;
alter table public.prescriptions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_secrets enable row level security;
alter table public.pass_subscriptions enable row level security;
alter table public.partner_applications enable row level security;
alter table public.support_tickets enable row level security;

create policy "settings readable" on public.settings for select using (true);
create policy "settings admin" on public.settings for update using (is_admin());

create policy "own profile" on public.profiles for select using (id = auth.uid() or is_admin());
create policy "edit own profile" on public.profiles for update using (id = auth.uid() or is_admin());

create policy "products readable" on public.products for select using (active or is_admin() or my_pharmacy() is not null);
create policy "products admin" on public.products for all using (is_admin()) with check (is_admin());

create policy "pharmacies visible" on public.pharmacies for select using (status = 'active' or owner_id = auth.uid() or is_admin());
create policy "pharmacy edits own" on public.pharmacies for update using (owner_id = auth.uid() or is_admin());
create policy "pos key owner" on public.pharmacy_keys for select using (pharmacy_id = my_pharmacy() or is_admin());

create policy "inventory readable" on public.inventory for select using (true);
create policy "inventory own" on public.inventory for all using (pharmacy_id = my_pharmacy() or is_admin()) with check (pharmacy_id = my_pharmacy() or is_admin());

create policy "rider self" on public.riders for select using (id = auth.uid() or is_admin());
create policy "rider edits self" on public.riders for update using (id = auth.uid() or is_admin());

create policy "own addresses" on public.addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "rx customer" on public.prescriptions for select using (
  customer_id = auth.uid() or is_admin()
  or pharmacy_id = my_pharmacy()
  or (status = 'pending' and pin = any (my_pharmacy_pins())));
create policy "rx upload" on public.prescriptions for insert with check (customer_id = auth.uid() and status = 'pending' and pharmacy_id is null);

create policy "orders by role" on public.orders for select using (
  customer_id = auth.uid() or is_admin()
  or pharmacy_id = my_pharmacy()
  or rider_id = auth.uid()
  or (rider_id is null and status in ('accepted', 'packed') and is_active_rider()
      and exists (select 1 from pharmacies p where p.id = pharmacy_id and lower(p.city) = lower(my_rider_city()))));
create policy "orders admin" on public.orders for update using (is_admin());

create policy "items follow order" on public.order_items for select using (exists (select 1 from orders o where o.id = order_id));
-- order_secrets: no policies at all = nobody reads it directly (only through order_otp()).

create policy "own pass" on public.pass_subscriptions for select using (user_id = auth.uid() or is_admin());

create policy "apply" on public.partner_applications for insert with check (not handled);
create policy "applications admin" on public.partner_applications for select using (is_admin());
create policy "applications admin edit" on public.partner_applications for update using (is_admin());

create policy "tickets own" on public.support_tickets for select using (user_id = auth.uid() or is_admin());
create policy "tickets create" on public.support_tickets for insert with check (user_id = auth.uid() and status = 'open' and reply = '');
create policy "tickets admin" on public.support_tickets for update using (is_admin());

-- Column-level limits: people may only change harmless fields on their own rows.
revoke update on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;
revoke update on public.riders from anon, authenticated;
grant update (online, lang, vehicle) on public.riders to authenticated;
revoke update on public.pharmacies from anon, authenticated;
grant update (open, phone, address) on public.pharmacies to authenticated;
-- admins change everything through the service role or admin functions:
grant update on public.profiles, public.riders, public.pharmacies to service_role;

-- Admin-only column changes go through this function (status / pins / pass etc.)
create or replace function public.admin_update(p_table text, p_id text, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_table = 'pharmacies' then
    update pharmacies set name = coalesce(p_patch ->> 'name', name), city = coalesce(p_patch ->> 'city', city),
      licence_no = coalesce(p_patch ->> 'licence_no', licence_no),
      pins = coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch -> 'pins') x where x ~ '^[1-9][0-9]{5}$'), pins)
     where id = p_id::uuid;
  elsif p_table = 'riders' then
    update riders set city = coalesce(p_patch ->> 'city', city), name = coalesce(p_patch ->> 'name', name) where id = p_id::uuid;
  elsif p_table = 'profiles' then
    update profiles set pass_until = case when p_patch ? 'pass_until' then (p_patch ->> 'pass_until')::timestamptz else pass_until end,
      name = coalesce(p_patch ->> 'name', name) where id = p_id::uuid;
  elsif p_table = 'orders' then
    update orders set rider_paid = coalesce((p_patch ->> 'rider_paid')::boolean, rider_paid),
      pay_status = coalesce(p_patch ->> 'pay_status', pay_status) where id = p_id;
  else raise exception 'Not allowed'; end if;
end $$;

-- Functions: only signed-in users (mark_paid only for the server)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.shop_catalog(text) to anon, authenticated;
-- helper functions used inside security policies must be callable by everyone (they return nothing for visitors)
grant execute on function public.my_role(), public.is_admin(), public.my_pharmacy(), public.my_pharmacy_pins(),
  public.is_active_rider(), public.my_rider_city(), public.has_pass(uuid) to anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.mark_paid(text, text, text, int) from authenticated;
revoke execute on function public._grant_pass(public.orders) from authenticated;
revoke execute on function public._restore_stock(text) from authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------- live updates
alter publication supabase_realtime add table public.orders, public.prescriptions;

-- ---------------------------------------------------------------- prescription photos (private bucket)
insert into storage.buckets (id, name, public) values ('prescriptions', 'prescriptions', false) on conflict (id) do nothing;

create policy "rx photo upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'prescriptions' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "rx photo read" on storage.objects for select to authenticated
  using (bucket_id = 'prescriptions' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or is_admin()
    or exists (select 1 from public.prescriptions r where name = any (r.photos))  -- RLS on prescriptions decides
  ));

-- Run expire_unpaid_orders every 5 minutes (needs the pg_cron extension, on by default in Supabase):
-- select cron.schedule('dawa4u-expire-unpaid', '*/5 * * * *', 'select public.expire_unpaid_orders()');
