-- A plan Excel's "name" column can be wrong (e.g. the supplier name). The items masterlist is the source of
-- truth: plan lines take the masterlist name whenever the item is in it.
create or replace function public.plan_line_item_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.item_name := coalesce((select nullif(btrim(i.name), '') from public.items i where i.item_code = new.item_code), new.item_name);
  return new;
end $$;
revoke all on function public.plan_line_item_name() from public, anon, authenticated;
create trigger allocation_lines_item_name before insert on public.allocation_lines
  for each row execute function public.plan_line_item_name();

-- fix plans already uploaded
update public.allocation_lines l set item_name = nullif(btrim(i.name), '')
from public.items i
where i.item_code = l.item_code and nullif(btrim(i.name), '') is not null and l.item_name is distinct from nullif(btrim(i.name), '');
