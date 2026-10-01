-- Every dark store has its own DC (Jahra DC already existed). Create a DC site for each store that does not
-- have one yet, move the store's DC-type ERP codes (602 Hawally DC, 604 Salmiya DC, 605 Egaila DC) to it,
-- and let each store's users work for their own DC too.

insert into public.sites (name, kind, aliases, sort_order)
select ds.name || ' DC', 'dc',
       array(select distinct a || ' dc' from unnest(ds.aliases || public.norm_name(ds.name)) a where a !~ '( ds| d s)$' and a not like 'from %'),
       10 + ds.sort_order
from public.sites ds
where ds.kind = 'ds' and ds.active
  and not exists (select 1 from public.sites x where x.name = ds.name || ' DC')
on conflict (name) do nothing;

-- the bare alias "dc" would match every DC now
update public.sites set aliases = array_remove(aliases, 'dc') where kind = 'dc';

update public.erp_locations l
set site_id = dc.id
from public.sites ds, public.sites dc
where l.site_id = ds.id and ds.kind = 'ds' and l.kind = 'dc' and dc.name = ds.name || ' DC';

insert into public.user_sites (user_id, site_id)
select us.user_id, dc.id
from public.user_sites us
join public.profiles p on p.user_id = us.user_id and p.role = 'store'
join public.sites ds on ds.id = us.site_id and ds.kind = 'ds'
join public.sites dc on dc.name = ds.name || ' DC'
on conflict do nothing;
