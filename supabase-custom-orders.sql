-- Custom order numbering for ARCO custom design orders.
-- Run once in Supabase SQL Editor before taking live custom orders.

create table if not exists public.custom_order_sequence (
  id boolean primary key default true,
  next_value bigint not null default 1,
  constraint custom_order_sequence_singleton check (id)
);

insert into public.custom_order_sequence (id, next_value)
values (true, 1)
on conflict (id) do nothing;

create or replace function public.next_custom_order_number()
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_number bigint;
begin
  update public.custom_order_sequence
  set next_value = next_value + 1
  where id = true
  returning next_value - 1 into current_number;

  return current_number;
end;
$$;

revoke execute on function public.next_custom_order_number() from public;
revoke execute on function public.next_custom_order_number() from anon;
revoke execute on function public.next_custom_order_number() from authenticated;
grant execute on function public.next_custom_order_number() to service_role;
