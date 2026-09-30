-- IALC System - helpers, access checks and business RPCs.
-- All writes from the app go through these SECURITY DEFINER functions, which enforce who may do what.

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function public.kw_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kuwait')::date $$;

create or replace function public.norm_name(s text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(s, '')), '[_./-]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = p_key), p_default)
$$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

create or replace function public.is_ho() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin', 'viewer'), false)
$$;

create or replace function public.my_sites() returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(us.site_id), '{}')
  from public.user_sites us join public.profiles p on p.user_id = us.user_id
  where us.user_id = auth.uid() and p.active
$$;

create or replace function public.can_see_site(p_site int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ho() or p_site = any(public.my_sites())
$$;

create or replace function public.can_act_for_site(p_site int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.app_role() = 'store' and p_site = any(public.my_sites()))
$$;

create or replace function public.log_action(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (user_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_details)
$$;

-- ---------------------------------------------------------------------------
-- ERP location resolution: known code, or a confident guess from the printed name.

create or replace function public.guess_location(p_name text)
returns table (site_id int, kind text)
language plpgsql stable security definer set search_path = public as $$
declare
  n text := public.norm_name(p_name);
  v_kind text;
begin
  v_kind := case
    when n ~ 'alloc' then 'allocation'
    when n ~ '(^| )dc( |$)' or n ~ 'distribution' then 'dc'
    else 'ds' end;
  return query
  with hits as (
    select s.id, s.kind as skind, a as alias
    from public.sites s, unnest(s.aliases || public.norm_name(s.name)) a
    where s.active and (n = a or n like a || ' %' or n like '% ' || a or n like '% ' || a || ' %')
  )
  select h.id, v_kind
  from hits h
  -- a DC location maps to the DC site; DS/allocation locations map to the store
  where (v_kind = 'dc') = (h.skind = 'dc')
  order by length(h.alias) desc
  limit 1;
end $$;

create or replace function public.resolve_location(p_code text, p_name text, p_allow_create boolean)
returns public.erp_locations
language plpgsql security definer set search_path = public as $$
declare
  loc public.erp_locations;
  g record;
begin
  if coalesce(p_code, '') <> '' then
    select * into loc from public.erp_locations where code = p_code;
    if found then return loc; end if;
  end if;
  -- no code printed: try by exact ERP name
  if coalesce(p_code, '') = '' then
    select * into loc from public.erp_locations where public.norm_name(erp_name) = public.norm_name(p_name) limit 1;
    if found then return loc; end if;
    raise exception 'UNKNOWN_LOCATION: ERP store "%" has no code and is not mapped yet. Ask HO to add it under Settings.', p_name;
  end if;
  select * into g from public.guess_location(p_name);
  if g.site_id is null or not p_allow_create then
    raise exception 'UNKNOWN_LOCATION: ERP store "% %" is not mapped to a store yet. Ask HO to add it under Settings -> ERP stores.', p_name, p_code;
  end if;
  insert into public.erp_locations (code, erp_name, site_id, kind, auto_created)
  values (p_code, coalesce(nullif(p_name, ''), p_code), g.site_id, g.kind, true)
  returning * into loc;
  perform public.log_action('auto_map_location', 'erp_location', p_code, jsonb_build_object('name', p_name, 'site_id', g.site_id, 'kind', g.kind));
  return loc;
end $$;

create or replace function public.classify_direction(f public.erp_locations, t public.erp_locations)
returns text language sql immutable as $$
  select case
    when f.kind in ('ds', 'dc') and t.kind = 'allocation' then 'dispatch'
    when f.kind = 'allocation' and t.kind in ('ds', 'dc') and f.site_id = t.site_id then 'receipt'
    when f.kind in ('ds', 'dc') and t.kind in ('ds', 'dc') and f.site_id <> t.site_id then 'direct'
    else 'other' end
$$;

-- ---------------------------------------------------------------------------
-- Receipt matching: receipts (X Allocation -> X DS) are matched to dispatches into the same
-- allocation store, item by item: first to the dispatches the receiver linked, then oldest first.
-- Deterministic, so it can be rebuilt whenever an STV is added or voided (handles out-of-order uploads).

create or replace function public.rebuild_matches(p_location text, p_items text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  rl record;
  d record;
  remaining numeric;
  take numeric;
begin
  delete from public.receipt_matches
  where location_code = p_location and (p_items is null or item_code = any(p_items));

  for r in
    select s.id, s.doc_no, s.stv_date from public.stvs s
    where s.from_code = p_location and s.direction = 'receipt' and s.status = 'active'
    order by s.stv_date, s.uploaded_at, s.doc_no
  loop
    for rl in
      select l.item_code, sum(l.qty) as qty from public.stv_lines l
      where l.stv_id = r.id and (p_items is null or l.item_code = any(p_items))
      group by l.item_code
    loop
      remaining := rl.qty;
      for d in
        select s.id,
               sum(l.qty) - coalesce((select sum(m.qty) from public.receipt_matches m
                                      where m.dispatch_id = s.id and m.item_code = rl.item_code), 0) as open_qty,
               exists (select 1 from public.stv_links k where k.receipt_id = r.id and k.dispatch_id = s.id) as linked
        from public.stvs s join public.stv_lines l on l.stv_id = s.id and l.item_code = rl.item_code
        where s.to_code = p_location and s.direction = 'dispatch' and s.status = 'active'
        group by s.id, s.stv_date, s.doc_no
        order by linked desc, s.stv_date, s.doc_no
      loop
        exit when remaining <= 0;
        if d.open_qty > 0 then
          take := least(d.open_qty, remaining);
          insert into public.receipt_matches (location_code, item_code, dispatch_id, receipt_id, receipt_date, receipt_doc_no, qty)
          values (p_location, rl.item_code, d.id, r.id, r.stv_date, r.doc_no, take);
          remaining := remaining - take;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Allocation plans

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

  perform public.log_action('create_allocation', 'allocation', v_id::text, jsonb_build_object('ref', v_ref));
  return jsonb_build_object('id', v_id, 'ref', v_ref);
end $$;

create or replace function public.cancel_allocation(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.allocations set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
  where id = p_id and status = 'active';
  if not found then raise exception 'Allocation not found or already cancelled'; end if;
  perform public.log_action('cancel_allocation', 'allocation', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- STV upload: preview (classification + suggestions) and submit.

-- Look up (or guess, for a not-yet-mapped code) an ERP location without raising.
create or replace function public.peek_location(p_code text, p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  loc public.erp_locations;
  g record;
begin
  if coalesce(p_code, '') <> '' then
    select * into loc from public.erp_locations where code = p_code;
  else
    select * into loc from public.erp_locations where public.norm_name(erp_name) = public.norm_name(p_name) limit 1;
  end if;
  if loc.code is not null then
    return jsonb_build_object('code', loc.code, 'name', loc.erp_name, 'site_id', loc.site_id, 'kind', loc.kind, 'is_new', false);
  end if;
  select * into g from public.guess_location(p_name);
  if coalesce(p_code, '') = '' or g.site_id is null then
    return jsonb_build_object('code', p_code, 'name', p_name, 'site_id', null, 'kind', null, 'is_new', true,
      'error', format('ERP store "%s %s" is not mapped to a store. Ask HO to add it under Settings -> ERP stores.', p_name, coalesce(p_code, '')));
  end if;
  return jsonb_build_object('code', p_code, 'name', p_name, 'site_id', g.site_id, 'kind', g.kind, 'is_new', true);
end $$;

create or replace function public.stv_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  fj jsonb := public.peek_location(p->>'from_code', p->>'from_name');
  tj jsonb := public.peek_location(p->>'to_code', p->>'to_name');
  f public.erp_locations;
  t public.erp_locations;
  v_dir text;
  v_items text[] := array(select distinct x->>'item_code' from jsonb_array_elements(coalesce(p->'lines', '[]')) x);
  v_dup jsonb;
  v_legs jsonb := '[]';
  v_disp jsonb := '[]';
  v_unknown text[];
  v_act_site int;
  v_errors text[] := '{}';
begin
  if public.app_role() is null then raise exception 'NOT_ALLOWED'; end if;
  if fj ? 'error' then v_errors := v_errors || (fj->>'error'); end if;
  if tj ? 'error' then v_errors := v_errors || (tj->>'error'); end if;
  f.code := fj->>'code'; f.erp_name := fj->>'name'; f.site_id := (fj->>'site_id')::int; f.kind := fj->>'kind';
  t.code := tj->>'code'; t.erp_name := tj->>'name'; t.site_id := (tj->>'site_id')::int; t.kind := tj->>'kind';

  if f.site_id is not null and t.site_id is not null then
    v_dir := public.classify_direction(f, t);
    v_act_site := case when v_dir = 'receipt' then t.site_id else f.site_id end;
  end if;

  select jsonb_build_object('id', s.id, 'doc_no', s.doc_no, 'uploaded_at', s.uploaded_at, 'direction', s.direction)
  into v_dup from public.stvs s where s.doc_no = btrim(p->>'doc_no') and s.status = 'active';

  v_unknown := array(select i from unnest(v_items) i where not exists (select 1 from public.items it where it.item_code = i));

  if v_dir in ('dispatch', 'direct') and public.can_act_for_site(v_act_site) then
    -- open plan legs from the sending store to the receiving store, best item overlap first
    select coalesce(jsonb_agg(q.x order by (q.x->>'overlap')::int desc, q.x->>'plan_date' desc), '[]') into v_legs from (
      select jsonb_build_object(
        'leg_id', l.id, 'allocation_id', a.id, 'ref', a.ref, 'plan_date', a.plan_date, 'title', a.title,
        'planned_items', (select count(*) from public.allocation_lines al where al.leg_id = l.id),
        'overlap', (select count(*) from public.allocation_lines al where al.leg_id = l.id and al.item_code = any(v_items)),
        'already_dispatched', exists (select 1 from public.stvs s where s.leg_id = l.id and s.status = 'active')
      ) x
      from public.allocation_legs l join public.allocations a on a.id = l.allocation_id
      where a.status = 'active' and a.from_site_id = f.site_id and l.to_site_id = t.site_id
        and a.plan_date >= public.kw_today() - 120
    ) q where (q.x->>'overlap')::int > 0;
  elsif v_dir = 'receipt' and public.can_act_for_site(v_act_site) then
    -- dispatches into this allocation store that still have open quantities, best overlap first
    select coalesce(jsonb_agg(q.x order by (q.x->>'overlap')::int desc, q.x->>'stv_date'), '[]') into v_disp from (
      select jsonb_build_object(
        'stv_id', di.stv_id, 'doc_no', di.doc_no, 'stv_date', di.stv_date, 'from_site_id', di.from_site_id,
        'items', count(*),
        'overlap', count(*) filter (where di.item_code = any(v_items)),
        'open_qty', sum(di.raw_open_qty)
      ) x
      from public.v_dispatch_items di
      where di.to_code = f.code and di.direction = 'dispatch'
      group by di.stv_id, di.doc_no, di.stv_date, di.from_site_id
      having sum(di.raw_open_qty) > 0
    ) q where (q.x->>'overlap')::int > 0;
  end if;

  return jsonb_build_object(
    'from', fj, 'to', tj,
    'direction', v_dir,
    'acting_site_id', v_act_site,
    'can_submit', v_act_site is not null and public.can_act_for_site(v_act_site) and cardinality(v_errors) = 0,
    'duplicate', v_dup,
    'unknown_items', to_jsonb(v_unknown),
    'leg_suggestions', v_legs,
    'dispatch_suggestions', v_disp,
    'errors', to_jsonb(v_errors)
  );
end $$;

create or replace function public.submit_stv(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f public.erp_locations;
  t public.erp_locations;
  v_dir text;
  v_id uuid;
  v_leg uuid := nullif(p->>'leg_id', '')::uuid;
  v_act_site int;
  v_items text[];
  v_lines int;
  v_total numeric;
  v_date date := (p->>'stv_date')::date;
begin
  if public.app_role() is null then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(btrim(p->>'doc_no'), '') = '' then raise exception 'STV number is required'; end if;
  if v_date is null then raise exception 'STV date is required'; end if;
  if v_date > public.kw_today() + 1 then raise exception 'STV date % is in the future', v_date; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'The STV has no lines'; end if;

  if exists (select 1 from public.stvs where doc_no = btrim(p->>'doc_no') and status = 'active') then
    raise exception 'DUPLICATE: STV % was already uploaded', p->>'doc_no';
  end if;

  f := public.resolve_location(p->>'from_code', p->>'from_name', true);
  t := public.resolve_location(p->>'to_code', p->>'to_name', true);
  v_dir := public.classify_direction(f, t);
  v_act_site := case when v_dir = 'receipt' then t.site_id else f.site_id end;
  if not public.can_act_for_site(v_act_site) then
    raise exception 'NOT_ALLOWED: this STV must be uploaded by % (or head office)',
      (select name from public.sites where id = v_act_site);
  end if;

  if v_leg is not null then
    if v_dir not in ('dispatch', 'direct') then raise exception 'Only a sending STV can be linked to an allocation plan'; end if;
    if not exists (
      select 1 from public.allocation_legs l join public.allocations a on a.id = l.allocation_id
      where l.id = v_leg and a.status = 'active' and a.from_site_id = f.site_id and l.to_site_id = t.site_id
    ) then raise exception 'The selected allocation does not match this STV (sender/receiver differ or it is cancelled)'; end if;
  end if;

  insert into public.stvs (doc_no, stv_date, from_code, to_code, from_site_id, to_site_id, from_kind, to_kind, direction,
                           leg_id, post_ref, source, file_path, file_name, parse_warnings, uploaded_by)
  values (btrim(p->>'doc_no'), v_date, f.code, t.code, f.site_id, t.site_id, f.kind, t.kind, v_dir,
          v_leg, nullif(p->>'post_ref', ''), coalesce(nullif(p->>'source', ''), 'pdf'), nullif(p->>'file_path', ''),
          nullif(p->>'file_name', ''),
          coalesce(array(select jsonb_array_elements_text(p->'warnings')), '{}'), auth.uid())
  returning id into v_id;

  insert into public.stv_lines (stv_id, line_no, item_code, barcode, item_name, pack_qty, unit, qty, exp_date)
  select v_id, coalesce((x->>'line_no')::int, ord::int), btrim(x->>'item_code'), nullif(x->>'barcode', ''), nullif(x->>'item_name', ''),
         coalesce((x->>'pack_qty')::numeric, 1), nullif(x->>'unit', ''), (x->>'qty')::numeric, nullif(x->>'exp_date', '')
  from jsonb_array_elements(p->'lines') with ordinality as e(x, ord);

  select count(*), sum(qty), array_agg(distinct item_code) into v_lines, v_total, v_items
  from public.stv_lines where stv_id = v_id;
  update public.stvs set line_count = v_lines, total_qty = v_total where id = v_id;

  if v_dir = 'receipt' then
    insert into public.stv_links (receipt_id, dispatch_id)
    select v_id, d.id from public.stvs d
    where d.id in (select (jsonb_array_elements_text(coalesce(p->'link_dispatch_ids', '[]')))::uuid)
      and d.to_code = f.code and d.direction = 'dispatch' and d.status = 'active';
    perform public.rebuild_matches(f.code, v_items);
  elsif v_dir = 'dispatch' then
    perform public.rebuild_matches(t.code, v_items);
  end if;

  perform public.log_action('upload_stv', 'stv', v_id::text,
    jsonb_build_object('doc_no', p->>'doc_no', 'direction', v_dir, 'lines', v_lines, 'qty', v_total, 'leg_id', v_leg));
  return jsonb_build_object('id', v_id, 'direction', v_dir, 'lines', v_lines, 'qty', v_total);
end $$;

create or replace function public.void_stv(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.stvs;
  v_items text[];
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only head office can void an STV'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.stvs set status = 'void', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
  where id = p_id and status = 'active' returning * into s;
  if not found then raise exception 'STV not found or already void'; end if;
  select array_agg(distinct item_code) into v_items from public.stv_lines where stv_id = p_id;
  delete from public.stv_links where receipt_id = p_id or dispatch_id = p_id;
  if s.direction = 'receipt' then perform public.rebuild_matches(s.from_code, v_items);
  elsif s.direction = 'dispatch' then perform public.rebuild_matches(s.to_code, v_items);
  end if;
  perform public.log_action('void_stv', 'stv', p_id::text, jsonb_build_object('doc_no', s.doc_no, 'reason', p_reason));
end $$;

create or replace function public.set_stv_leg(p_stv uuid, p_leg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.stvs;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.stvs where id = p_stv and status = 'active';
  if not found or s.direction not in ('dispatch', 'direct') then raise exception 'Only an active sending STV can be linked to a plan'; end if;
  if p_leg is not null and not exists (
    select 1 from public.allocation_legs l join public.allocations a on a.id = l.allocation_id
    where l.id = p_leg and a.from_site_id = s.from_site_id and l.to_site_id = s.to_site_id and a.status = 'active'
  ) then raise exception 'That allocation does not match this STV'; end if;
  update public.stvs set leg_id = p_leg where id = p_stv;
  perform public.log_action('link_stv_plan', 'stv', p_stv::text, jsonb_build_object('leg_id', p_leg));
end $$;

-- ---------------------------------------------------------------------------
-- Discrepancy resolutions

create or replace function public.request_resolution(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_leg uuid := nullif(p->>'leg_id', '')::uuid;
  v_stv uuid := nullif(p->>'stv_id', '')::uuid;
  v_item text := coalesce(nullif(p->>'item_code', ''), '*');
  v_site int;
  v_id uuid;
begin
  if v_kind in ('dispatch_short', 'dispatch_over', 'unplanned_item') then
    select a.from_site_id into v_site from public.allocation_legs l join public.allocations a on a.id = l.allocation_id where l.id = v_leg;
  elsif v_kind = 'unplanned_stv' then
    select from_site_id into v_site from public.stvs where id = v_stv;
  elsif v_kind in ('receipt_short', 'receipt_over') then
    select to_site_id into v_site from public.stvs where id = v_stv;
  else
    raise exception 'Unknown discrepancy type %', v_kind;
  end if;
  if v_site is null then raise exception 'Discrepancy not found'; end if;
  if not public.can_act_for_site(v_site) then raise exception 'NOT_ALLOWED: only % (or head office) can explain this', (select name from public.sites where id = v_site); end if;
  if nullif(p->>'reason_code', '') is null then raise exception 'Please choose a reason'; end if;
  if exists (select 1 from public.resolutions r where r.kind = v_kind and r.leg_id is not distinct from v_leg
             and r.stv_id is not distinct from v_stv and r.item_code = v_item and r.status = 'approved') then
    raise exception 'This line is already closed';
  end if;

  delete from public.resolutions r where r.kind = v_kind and r.leg_id is not distinct from v_leg
    and r.stv_id is not distinct from v_stv and r.item_code = v_item and r.status = 'pending';
  insert into public.resolutions (kind, leg_id, stv_id, item_code, gap_qty, reason_code, note, requested_by)
  values (v_kind, v_leg, v_stv, v_item, nullif(p->>'gap_qty', '')::numeric, p->>'reason_code', nullif(p->>'note', ''), auth.uid())
  returning id into v_id;
  perform public.log_action('request_resolution', 'resolution', v_id::text, p);
  return v_id;
end $$;

create or replace function public.decide_resolution(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only head office can approve'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Please write why it is rejected'; end if;
  update public.resolutions
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(p_note, '')
  where id = p_id and status = 'pending';
  if not found then raise exception 'Request not found or already decided'; end if;
  perform public.log_action(case when p_approve then 'approve_resolution' else 'reject_resolution' end, 'resolution', p_id::text,
                            jsonb_build_object('note', p_note));
end $$;

-- HO can close a discrepancy directly (reason + approval in one step).
create or replace function public.close_discrepancy(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  v_id := public.request_resolution(p);
  perform public.decide_resolution(v_id, true, coalesce(nullif(p->>'decision_note', ''), 'Closed by head office'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Items masterlist import (upsert; items not in the file are left untouched)

create or replace function public.import_items(p_items jsonb, p_file_name text, p_final boolean default true, p_import_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ins int;
  v_total int;
  v_id bigint := p_import_id;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  create temp table if not exists _imp (like public.items including defaults) on commit drop;
  truncate _imp;
  insert into _imp (item_code, barcode, name, category, brand, uom, cost, shelf_life_days, active)
  select distinct on (x->>'item_code') btrim(x->>'item_code'), nullif(x->>'barcode', ''), nullif(x->>'name', ''), nullif(x->>'category', ''),
         nullif(x->>'brand', ''), nullif(x->>'uom', ''), nullif(x->>'cost', '')::numeric, nullif(x->>'shelf_life_days', '')::int,
         coalesce((x->>'active')::boolean, true)
  from jsonb_array_elements(p_items) x where coalesce(btrim(x->>'item_code'), '') <> '';
  get diagnostics v_total = row_count;
  select count(*) into v_ins from _imp i where not exists (select 1 from public.items t where t.item_code = i.item_code);

  insert into public.items as t (item_code, barcode, name, category, brand, uom, cost, shelf_life_days, active, updated_at)
  select item_code, barcode, name, category, brand, uom, cost, shelf_life_days, active, now() from _imp
  on conflict (item_code) do update set
    barcode = coalesce(excluded.barcode, t.barcode),
    name = coalesce(excluded.name, t.name),
    category = coalesce(excluded.category, t.category),
    brand = coalesce(excluded.brand, t.brand),
    uom = coalesce(excluded.uom, t.uom),
    cost = coalesce(excluded.cost, t.cost),
    shelf_life_days = coalesce(excluded.shelf_life_days, t.shelf_life_days),
    active = excluded.active,
    updated_at = now();

  if v_id is null then
    insert into public.item_imports (file_name, total_rows, inserted, updated, uploaded_by)
    values (p_file_name, v_total, v_ins, v_total - v_ins, auth.uid()) returning id into v_id;
  else
    update public.item_imports set total_rows = total_rows + v_total, inserted = inserted + v_ins, updated = updated + (v_total - v_ins)
    where id = v_id;
  end if;
  if p_final then
    perform public.log_action('import_items', 'item_import', v_id::text, jsonb_build_object('file', p_file_name));
  end if;
  return jsonb_build_object('import_id', v_id, 'rows', v_total, 'inserted', v_ins, 'updated', v_total - v_ins);
end $$;

-- ---------------------------------------------------------------------------
-- Virtual Store Watch snapshot upload (replaces an existing snapshot of the same store+date)

create or replace function public.upload_snapshot(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  loc public.erp_locations;
  v_id uuid;
  v_n int;
  v_q numeric;
begin
  select * into loc from public.erp_locations where code = p->>'location_code';
  if not found then raise exception 'Unknown ERP store %', p->>'location_code'; end if;
  if loc.kind <> 'allocation' then raise exception '% is not an Allocation (virtual) store', loc.erp_name; end if;
  if not public.can_act_for_site(loc.site_id) then raise exception 'NOT_ALLOWED'; end if;

  delete from public.vs_snapshots where location_code = loc.code and snapshot_date = (p->>'snapshot_date')::date;
  insert into public.vs_snapshots (location_code, snapshot_date, file_name, file_path, uploaded_by)
  values (loc.code, (p->>'snapshot_date')::date, nullif(p->>'file_name', ''), nullif(p->>'file_path', ''), auth.uid())
  returning id into v_id;
  insert into public.vs_snapshot_lines (snapshot_id, item_code, item_name, qty, value, since_date)
  select v_id, x->>'item_code', max(nullif(x->>'item_name', '')), sum((x->>'qty')::numeric),
         sum(nullif(x->>'value', '')::numeric), min(nullif(x->>'since_date', '')::date)
  from jsonb_array_elements(p->'rows') x
  where coalesce(x->>'item_code', '') <> ''
  group by x->>'item_code';
  select count(*), coalesce(sum(qty), 0) into v_n, v_q from public.vs_snapshot_lines where snapshot_id = v_id;
  update public.vs_snapshots set line_count = v_n, total_qty = v_q where id = v_id;
  perform public.log_action('upload_snapshot', 'vs_snapshot', v_id::text, jsonb_build_object('location', loc.code, 'lines', v_n));
  return jsonb_build_object('id', v_id, 'lines', v_n, 'qty', v_q);
end $$;
