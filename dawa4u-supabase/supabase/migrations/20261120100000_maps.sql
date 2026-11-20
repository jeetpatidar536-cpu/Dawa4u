-- =====================================================================
-- dawa4u — maps: map pins for addresses & pharmacies, live rider GPS.
-- Safe to run once on top of 20261120000000_dawa4u.sql.
-- =====================================================================

alter table public.addresses  add column if not exists lat double precision, add column if not exists lng double precision;
alter table public.pharmacies add column if not exists lat double precision, add column if not exists lng double precision;
alter table public.orders
  add column if not exists pickup_lat double precision, add column if not exists pickup_lng double precision,
  add column if not exists drop_lat double precision,   add column if not exists drop_lng double precision;

-- Pharmacies may set their own map pin
grant update (lat, lng) on public.pharmacies to authenticated;

-- Every new order copies the pharmacy pin and the customer's address pin
create or replace function public._order_coords() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select lat, lng into new.pickup_lat, new.pickup_lng from pharmacies where id = new.pharmacy_id;
  select lat, lng into new.drop_lat, new.drop_lng from addresses
   where user_id = new.customer_id and line = new.address_line and pin = new.pin and lat is not null
   order by created_at desc limit 1;
  return new;
end $$;
drop trigger if exists order_coords on public.orders;
create trigger order_coords before insert on public.orders for each row execute function public._order_coords();

-- Latest position of each rider (one row per rider, updated every few seconds while online)
create table if not exists public.rider_locations (
  rider_id uuid primary key references public.riders (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy real,
  heading real,
  updated_at timestamptz not null default now()
);
alter table public.rider_locations enable row level security;

-- Who may see a rider's position: the rider, admin, and the customer / pharmacy of the order the rider is carrying now
drop policy if exists "rider location visible" on public.rider_locations;
create policy "rider location visible" on public.rider_locations for select using (
  rider_id = auth.uid() or is_admin()
  or exists (select 1 from orders o where o.rider_id = rider_locations.rider_id
             and o.status in ('accepted', 'packed', 'picked')
             and (o.customer_id = auth.uid() or o.pharmacy_id = my_pharmacy())));

-- Rider app calls this with the phone's GPS
create or replace function public.rider_ping(p_lat double precision, p_lng double precision, p_accuracy real default null, p_heading real default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_rider() then raise exception 'Your rider account is not active yet'; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad location'; end if;
  insert into rider_locations (rider_id, lat, lng, accuracy, heading, updated_at)
  values (auth.uid(), p_lat, p_lng, p_accuracy, p_heading, now())
  on conflict (rider_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, heading = excluded.heading, updated_at = now();
end $$;
revoke execute on function public.rider_ping(double precision, double precision, real, real) from public, anon;
grant execute on function public.rider_ping(double precision, double precision, real, real) to authenticated;
revoke execute on function public._order_coords() from public, anon, authenticated;

-- Admin may also correct a pharmacy's pin
create or replace function public.admin_set_pin(p_pharmacy uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update pharmacies set lat = p_lat, lng = p_lng where id = p_pharmacy;
end $$;
revoke execute on function public.admin_set_pin(uuid, double precision, double precision) from public, anon;
grant execute on function public.admin_set_pin(uuid, double precision, double precision) to authenticated;

-- live updates for the tracking map
do $$ begin
  alter publication supabase_realtime add table public.rider_locations;
exception when duplicate_object then null; end $$;
