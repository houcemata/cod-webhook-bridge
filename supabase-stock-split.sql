-- ARCO stock split migration
-- Run this in Supabase SQL editor to persist the new stock category field.

alter table public.stock_items
  add column if not exists stock_kind text;

update public.stock_items
set stock_kind = case
  when stock_kind is not null and stock_kind <> '' then stock_kind
  when lower(coalesce(name, '') || ' ' || coalesce(size, '')) ~ '(board|wood|ply|mdf|panel|sheet|material|production|raw)' then 'production_material'
  else 'ready_to_ship'
end;

-- Optional hardening:
-- if your stock_usage_log table should always clear with production_logs deletes,
-- add a foreign key with on delete cascade in Supabase after checking the existing constraint name.
