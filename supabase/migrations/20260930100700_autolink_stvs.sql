-- Link STVs that were uploaded before their plan existed.
-- When a plan is created, any not-yet-linked sending STV on the same route (same sender -> same receiver),
-- dated from 30 days before the plan date, whose items are mostly in that plan, is attached to the plan.

create or replace function public.autolink_stvs(p_alloc uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  r record;
begin
  for r in
    select s.id as stv_id, l.id as leg_id
    from public.allocations a
    join public.allocation_legs l on l.allocation_id = a.id
    join public.stvs s on s.from_site_id = a.from_site_id and s.to_site_id = l.to_site_id
    where a.id = p_alloc and a.status = 'active'
      and s.status = 'active' and s.leg_id is null and s.direction in ('dispatch', 'direct')
      and s.stv_date >= a.plan_date - 30
      -- at least half of the STV's items are in this plan
      and (select count(distinct sl.item_code) from public.stv_lines sl
           where sl.stv_id = s.id and exists (select 1 from public.allocation_lines al where al.leg_id = l.id and al.item_code = sl.item_code)) * 2
          >= (select count(distinct sl.item_code) from public.stv_lines sl where sl.stv_id = s.id)
  loop
    update public.stvs set leg_id = r.leg_id where id = r.stv_id and leg_id is null;
    if found then
      n := n + 1;
      perform public.log_action('auto_link_stv_plan', 'stv', r.stv_id::text, jsonb_build_object('leg_id', r.leg_id));
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.autolink_stvs(uuid) from public, anon, authenticated;

create or replace function public.create_allocation(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from int := (p->>'from_site_id')::int;
  v_kind text;
  v_id uuid;
  v_ref text;
  leg jsonb;
  v_leg uuid;
  v_lines int := 0;
  v_linked int;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only head office can create allocation plans'; end if;
  select case when kind = 'dc' then 'dc' else 'internal' end into v_kind from public.sites where id = v_from;
  if v_kind is null then raise exception 'Unknown sending store'; end if;
  if jsonb_array_length(coalesce(p->'legs', '[]')) = 0 then raise exception 'The plan has no destination stores'; end if;

  insert into public.allocations (kind, from_site_id, plan_date, title, notes, source_file, created_by)
  values (v_kind, v_from, coalesce((p->>'plan_date')::date, public.kw_today()), nullif(p->>'title', ''),
          nullif(p->>'notes', ''), nullif(p->>'source_file', ''), auth.uid())
  returning id, ref into v_id, v_ref;

  for leg in select * from jsonb_array_elements(p->'legs') loop
    if (leg->>'to_site_id')::int = v_from then raise exception 'A store cannot allocate to itself'; end if;
    insert into public.allocation_legs (allocation_id, to_site_id) values (v_id, (leg->>'to_site_id')::int)
    returning id into v_leg;
    insert into public.allocation_lines (leg_id, item_code, item_name, barcode, planned_qty)
    select v_leg, x->>'item_code', nullif(x->>'item_name', ''), nullif(x->>'barcode', ''), sum((x->>'qty')::numeric)
    from jsonb_array_elements(leg->'lines') x
    where (x->>'qty')::numeric > 0
    group by x->>'item_code', nullif(x->>'item_name', ''), nullif(x->>'barcode', '');
    get diagnostics v_lines = row_count;
    if v_lines = 0 then raise exception 'Destination % has no lines', leg->>'to_site_id'; end if;
  end loop;

  v_linked := public.autolink_stvs(v_id);
  perform public.log_action('create_allocation', 'allocation', v_id::text, jsonb_build_object('ref', v_ref, 'linked_stvs', v_linked));
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'linked_stvs', v_linked);
end $$;

-- One-time: attach STVs already uploaded before their plans.
do $$
declare a record;
begin
  for a in select id from public.allocations where status = 'active' order by created_at loop
    perform public.autolink_stvs(a.id);
  end loop;
end $$;
