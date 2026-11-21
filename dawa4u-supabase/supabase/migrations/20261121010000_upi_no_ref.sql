-- UPI without asking the customer for a reference number.
--  • With Cashfree set up, UPI goes through Cashfree and is confirmed automatically (cashfree-* functions).
--  • Before that, the customer pays to settings.upi_id and taps "I have paid"; an admin matches it
--    in the UPI app by amount and the note "dawa4u <order id>" and confirms it (admin_upi_review).
create or replace function public.upi_mark_sent(p_order_id text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order_id and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.pay_method <> 'upi' then raise exception 'This order is not a UPI order'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled. If you paid, write to support.'; end if;
  if o.pay_status <> 'pending' then return o; end if;
  update orders set pay_status = 'verifying', upi_submitted_at = now() where id = o.id returning * into o;
  return o;
end $$;
revoke execute on function public.upi_mark_sent(text) from public, anon;
grant execute on function public.upi_mark_sent(text) to authenticated;
