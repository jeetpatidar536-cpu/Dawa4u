-- =====================================================================
-- Pharmacy email verification
--  • Supabase Auth "Confirm email" is on: a new pharmacy account can't log in until the link in the email is clicked.
--  • register_pharmacy() also refuses an unverified email (in case that setting is ever switched off).
--  • Admins see the owner's email and whether it is verified, and can't approve an unverified pharmacy.
-- =====================================================================
alter table public.pharmacies
  add column if not exists owner_email text,
  add column if not exists email_verified_at timestamptz;

update public.pharmacies p
   set owner_email = u.email, email_verified_at = u.email_confirmed_at
  from auth.users u
 where u.id = p.owner_id;

-- keep it in sync when the owner clicks the link (or changes email)
create or replace function public._sync_email_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pharmacies set email_verified_at = new.email_confirmed_at, owner_email = new.email where owner_id = new.id;
  if new.email is not null then
    update profiles set email = new.email where id = new.id and email is distinct from new.email;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_verified on auth.users;
create trigger on_auth_user_email_verified after update of email_confirmed_at, email on auth.users
  for each row execute function public._sync_email_verified();
revoke execute on function public._sync_email_verified() from public, anon, authenticated;

create or replace function public.register_pharmacy(p_name text, p_licence text, p_phone text, p_address text, p_city text, p_pins text[])
returns public.pharmacies language plpgsql security definer set search_path = public as $$
declare ph pharmacies; u auth.users;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into u from auth.users where id = auth.uid();
  if u.email is null or u.email_confirmed_at is null then
    raise exception 'Please verify your email first: open the link we sent to your inbox, then try again.';
  end if;
  if exists (select 1 from pharmacies where owner_id = auth.uid()) then raise exception 'You have already registered a pharmacy'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_licence), '') = '' then raise exception 'Pharmacy name and drug licence number are required'; end if;
  insert into pharmacies (owner_id, name, licence_no, phone, address, city, pins, owner_email, email_verified_at)
  values (auth.uid(), trim(p_name), trim(p_licence), trim(p_phone), trim(p_address), trim(p_city),
          array(select distinct trim(x) from unnest(p_pins) x where trim(x) ~ '^[1-9][0-9]{5}$'),
          u.email, u.email_confirmed_at)
  returning * into ph;
  insert into pharmacy_keys (pharmacy_id) values (ph.id);
  return ph;
end $$;

create or replace function public.admin_set_partner(p_kind text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid; verified timestamptz;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('pending', 'active', 'suspended') then raise exception 'Bad status'; end if;
  if p_kind = 'pharmacy' then
    if p_status = 'active' then
      select coalesce(u.email_confirmed_at, ph.email_verified_at) into verified
        from pharmacies ph left join auth.users u on u.id = ph.owner_id where ph.id = p_id;
      if verified is null then raise exception 'This pharmacy has not verified its email yet. Ask them to click the link in the email we sent.'; end if;
    end if;
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
