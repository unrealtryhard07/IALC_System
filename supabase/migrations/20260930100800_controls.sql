-- Controls: month-end lock, old-stock clean-up, receiving counts, STV duplicate / number-gap checks,
-- global search, notifications and the monthly accuracy trend.

-- ===========================================================================
-- Month-end lock: once head office closes a month, nothing dated in it can be added, voided or changed.

create table public.period_locks (
  month      date primary key check (month = date_trunc('month', month)::date),
  locked_by  uuid references public.profiles(user_id),
  locked_at  timestamptz not null default now(),
  note       text,
  summary    jsonb
);
alter table public.period_locks enable row level security;
create policy period_locks_read on public.period_locks for select to authenticated using (public.app_role() is not null);

create or replace function public.is_locked(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_date is not null and exists (select 1 from public.period_locks where month = date_trunc('month', p_date)::date)
$$;

create or replace function public.locked_error(p_date date) returns void
language plpgsql as $$
begin
  raise exception 'LOCKED: % is closed (month-end). Ask head office to reopen the month first.', to_char(p_date, 'FMMonth YYYY');
end $$;

create or replace function public.guard_stvs_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.is_locked(new.stv_date) then perform public.locked_error(new.stv_date); end if;
  elsif tg_op = 'UPDATE' then
    -- linking an STV to a plan is allowed; anything that changes quantities or dates is not
    if (new.status is distinct from old.status or new.stv_date is distinct from old.stv_date
        or new.direction is distinct from old.direction or new.from_code is distinct from old.from_code or new.to_code is distinct from old.to_code)
       and (public.is_locked(old.stv_date) or public.is_locked(new.stv_date)) then
      perform public.locked_error(old.stv_date);
    end if;
  elsif public.is_locked(old.stv_date) then
    perform public.locked_error(old.stv_date);
  end if;
  return coalesce(new, old);
end $$;
create trigger stvs_lock before insert or update or delete on public.stvs
  for each row execute function public.guard_stvs_lock();

create or replace function public.guard_allocations_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.is_locked(new.plan_date) then perform public.locked_error(new.plan_date); end if;
  elsif tg_op = 'UPDATE' then
    if (new.status is distinct from old.status or new.plan_date is distinct from old.plan_date)
       and (public.is_locked(old.plan_date) or public.is_locked(new.plan_date)) then
      perform public.locked_error(old.plan_date);
    end if;
  elsif public.is_locked(old.plan_date) then
    perform public.locked_error(old.plan_date);
  end if;
  return coalesce(new, old);
end $$;
create trigger allocations_lock before insert or update or delete on public.allocations
  for each row execute function public.guard_allocations_lock();

create or replace function public.guard_snapshots_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.is_locked(new.snapshot_date) then perform public.locked_error(new.snapshot_date); end if;
  elsif public.is_locked(old.snapshot_date) then
    perform public.locked_error(old.snapshot_date);
  end if;
  return coalesce(new, old);
end $$;
create trigger vs_snapshots_lock before insert or delete on public.vs_snapshots
  for each row execute function public.guard_snapshots_lock();

-- Figures for one month (used live on the month-end page and frozen into period_locks.summary).
create or replace function public.month_summary(p_month date)
returns jsonb language sql stable set search_path = public as $$
  with b as (select date_trunc('month', p_month)::date as m0, (date_trunc('month', p_month) + interval '1 month')::date as m1),
  legs as (select l.* from public.v_legs l, b where l.plan_date >= b.m0 and l.plan_date < b.m1 and l.allocation_status = 'active'),
  st as (select s.* from public.stvs s, b where s.status = 'active' and s.stv_date >= b.m0 and s.stv_date < b.m1),
  di as (select d.* from public.v_dispatch_items d, b where d.stv_date >= b.m0 and d.stv_date < b.m1),
  dc as (select x.* from public.v_discrepancies x, b where x.event_date >= b.m0 and x.event_date < b.m1
           and not (x.kind = 'receipt_short' and coalesce(x.actual_qty, 0) = 0 and x.resolution_status is null)),
  vs as (
    select distinct on (v.location_code) v.location_code, v.id
    from public.vs_snapshots v, b where v.snapshot_date < b.m1 order by v.location_code, v.snapshot_date desc
  )
  select jsonb_build_object(
    'month', (select m0 from b),
    'plans', (select count(distinct allocation_id) from legs),
    'legs', (select count(*) from legs),
    'planned_qty', (select coalesce(sum(planned_qty), 0) from legs),
    'legs_not_sent', (select count(*) from legs where status = 'awaiting_dispatch'),
    'stvs', (select count(*) from st),
    'sent_qty', (select coalesce(sum(total_qty), 0) from st where direction in ('dispatch', 'direct')),
    'received_qty', (select coalesce(sum(total_qty), 0) from st where direction in ('receipt', 'direct')),
    'open_qty', (select coalesce(sum(open_qty), 0) from di),
    'open_value', (select coalesce(sum(open_qty * coalesce(cost, 0)), 0) from di),
    'problems', (select count(*) from dc),
    'problems_open', (select count(*) from dc where coalesce(resolution_status, '') <> 'approved'),
    'problems_approved', (select count(*) from dc where resolution_status = 'approved'),
    'approved_loss_value', (select coalesce(sum(abs(coalesce(gap_qty, 0)) * coalesce(cost, 0)), 0) from dc
                             where resolution_status = 'approved' and kind in ('dispatch_short', 'receipt_short')),
    'stuck_qty', (select coalesce(sum(l.qty), 0) from vs join public.vs_snapshot_lines l on l.snapshot_id = vs.id),
    'stuck_value', (select coalesce(sum(coalesce(l.value, l.qty * i.cost, 0)), 0) from vs join public.vs_snapshot_lines l on l.snapshot_id = vs.id
                     left join public.items i on i.item_code = l.item_code),
    'stores', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'site_id', s.id,
        'sent_qty', (select coalesce(sum(total_qty), 0) from st where from_site_id = s.id and direction in ('dispatch', 'direct')),
        'received_qty', (select coalesce(sum(total_qty), 0) from st where to_site_id = s.id and direction in ('receipt', 'direct')),
        'open_qty', (select coalesce(sum(open_qty), 0) from di where to_site_id = s.id),
        'problems_open', (select count(*) from dc where responsible_site_id = s.id and coalesce(resolution_status, '') <> 'approved')
      ) order by s.sort_order), '[]')
      from public.sites s where s.active
    )
  )
$$;

create or replace function public.lock_month(p_month date, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_sum jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only head office can close a month'; end if;
  if v_m >= date_trunc('month', public.kw_today())::date then raise exception 'Only a month that has ended can be closed'; end if;
  if exists (select 1 from public.period_locks where month = v_m) then raise exception 'This month is already closed'; end if;
  v_sum := public.month_summary(v_m);
  insert into public.period_locks (month, locked_by, note, summary) values (v_m, auth.uid(), nullif(btrim(p_note), ''), v_sum);
  perform public.log_action('lock_month', 'period', v_m::text, jsonb_build_object('note', p_note));
  return v_sum;
end $$;

create or replace function public.unlock_month(p_month date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reopen a month'; end if;
  delete from public.period_locks where month = date_trunc('month', p_month)::date;
  if not found then raise exception 'This month is not closed'; end if;
  perform public.log_action('unlock_month', 'period', date_trunc('month', p_month)::date::text, jsonb_build_object('reason', p_reason));
end $$;

-- ===========================================================================
-- Old stock clean-up (stock stuck in the Allocation virtual stores).
-- The store (or HO) decides what to do with each item, HO approves, the ERP transfer clears it.

create table public.backlog_actions (
  id              uuid primary key default gen_random_uuid(),
  location_code   text not null references public.erp_locations(code),
  item_code       text not null,
  action          text not null check (action in ('to_store', 'to_dc', 'write_off', 'investigate')),
  qty             numeric(14, 3) not null check (qty > 0),
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid references public.profiles(user_id),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.profiles(user_id),
  decided_at      timestamptz,
  decision_note   text
);
create unique index backlog_actions_live_uq on public.backlog_actions (location_code, item_code) where status in ('pending', 'approved');
create index backlog_actions_status_idx on public.backlog_actions (status);
alter table public.backlog_actions enable row level security;
create policy backlog_read on public.backlog_actions for select to authenticated using (
  exists (select 1 from public.erp_locations l where l.code = location_code and public.can_see_site(l.site_id))
);

create or replace function public.propose_backlog(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  loc public.erp_locations;
  v_action text := p->>'action';
  x jsonb;
  v_saved int := 0;
  v_skipped int := 0;
  v_admin boolean := public.is_admin();
begin
  select * into loc from public.erp_locations where code = p->>'location_code';
  if not found or loc.kind <> 'allocation' then raise exception 'Unknown Allocation store'; end if;
  if not public.can_act_for_site(loc.site_id) then raise exception 'NOT_ALLOWED: only % (or head office) can decide this', (select name from public.sites where id = loc.site_id); end if;
  if v_action not in ('to_store', 'to_dc', 'write_off', 'investigate') then raise exception 'Choose what to do with the stock'; end if;
  if v_action in ('write_off', 'investigate') and coalesce(btrim(p->>'note'), '') = '' then raise exception 'Please add a note for this decision'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    if exists (select 1 from public.backlog_actions b where b.location_code = loc.code and b.item_code = x->>'item_code' and b.status = 'approved') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    delete from public.backlog_actions b where b.location_code = loc.code and b.item_code = x->>'item_code' and b.status = 'pending';
    insert into public.backlog_actions (location_code, item_code, action, qty, note, status, requested_by, decided_by, decided_at)
    values (loc.code, x->>'item_code', v_action, (x->>'qty')::numeric, nullif(btrim(p->>'note'), ''),
            case when v_admin then 'approved' else 'pending' end, auth.uid(),
            case when v_admin then auth.uid() end, case when v_admin then now() end);
    v_saved := v_saved + 1;
  end loop;
  if v_saved = 0 and v_skipped = 0 then raise exception 'No items selected'; end if;
  perform public.log_action('propose_backlog', 'erp_location', loc.code,
    jsonb_build_object('action', v_action, 'items', v_saved, 'skipped', v_skipped, 'note', p->>'note'));
  return jsonb_build_object('saved', v_saved, 'skipped', v_skipped, 'approved', v_admin);
end $$;

create or replace function public.decide_backlog(p_ids uuid[], p_approve boolean, p_note text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only head office can approve'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Please write why it is rejected'; end if;
  update public.backlog_actions
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(btrim(p_note), '')
  where id = any(p_ids) and status = 'pending';
  get diagnostics n = row_count;
  perform public.log_action(case when p_approve then 'approve_backlog' else 'reject_backlog' end, 'backlog', null,
    jsonb_build_object('count', n, 'note', p_note));
  return n;
end $$;

-- Every decision with the item's quantity in the latest ERP report: approved + gone from the report = cleared.
create view public.v_backlog_actions with (security_invoker = on) as
with latest as (
  select distinct on (location_code) id, location_code, snapshot_date
  from public.vs_snapshots order by location_code, snapshot_date desc
)
select b.*, loc.site_id, loc.erp_name, coalesce(i.name, sl.item_name) as item_name, i.cost,
       lt.snapshot_date as latest_snapshot_date, coalesce(sl.qty, 0) as latest_erp_qty,
       (b.status = 'approved' and lt.snapshot_date >= b.decided_at::date and coalesce(sl.qty, 0) <= 0) as cleared
from public.backlog_actions b
join public.erp_locations loc on loc.code = b.location_code
left join latest lt on lt.location_code = b.location_code
left join public.vs_snapshot_lines sl on sl.snapshot_id = lt.id and sl.item_code = b.item_code
left join public.items i on i.item_code = b.item_code;

-- Size of each Allocation store over time (one row per uploaded ERP report).
create view public.v_vs_history with (security_invoker = on) as
select s.location_code, loc.site_id, loc.erp_name, s.snapshot_date,
       count(l.item_code) filter (where l.qty > 0) as skus,
       coalesce(sum(l.qty) filter (where l.qty > 0), 0) as qty,
       coalesce(sum(coalesce(l.value, l.qty * i.cost)) filter (where l.qty > 0), 0) as value
from public.vs_snapshots s
join public.erp_locations loc on loc.code = s.location_code
left join public.vs_snapshot_lines l on l.snapshot_id = s.id
left join public.items i on i.item_code = l.item_code
group by s.id, s.location_code, loc.site_id, loc.erp_name, s.snapshot_date;

-- ===========================================================================
-- Receiving counts: what the receiving store physically counted when the goods arrived.

create table public.receive_counts (
  id             uuid primary key default gen_random_uuid(),
  dispatch_id    uuid not null unique references public.stvs(id) on delete cascade,
  site_id        int not null references public.sites(id),
  expected_qty   numeric(14, 3) not null default 0,
  counted_qty    numeric(14, 3) not null default 0,
  short_lines    int not null default 0,
  over_lines     int not null default 0,
  note           text,
  counted_by     uuid references public.profiles(user_id),
  counted_at     timestamptz not null default now()
);
create table public.receive_count_lines (
  count_id      uuid not null references public.receive_counts(id) on delete cascade,
  item_code     text not null,
  expected_qty  numeric(14, 3) not null,
  counted_qty   numeric(14, 3) not null check (counted_qty >= 0),
  primary key (count_id, item_code)
);
alter table public.receive_counts enable row level security;
alter table public.receive_count_lines enable row level security;
create policy receive_counts_read on public.receive_counts for select to authenticated using (
  exists (select 1 from public.stvs s where s.id = dispatch_id)
);
create policy receive_count_lines_read on public.receive_count_lines for select to authenticated using (
  exists (select 1 from public.receive_counts c where c.id = count_id)
);

create or replace function public.save_receive_count(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.stvs;
  v_id uuid;
  r record;
begin
  select * into s from public.stvs where id = (p->>'dispatch_id')::uuid and status = 'active';
  if not found or s.direction <> 'dispatch' then raise exception 'Transfer not found'; end if;
  if not public.can_act_for_site(s.to_site_id) then raise exception 'NOT_ALLOWED: only % (or head office) can count this', (select name from public.sites where id = s.to_site_id); end if;

  delete from public.receive_counts where dispatch_id = s.id;
  insert into public.receive_counts (dispatch_id, site_id, note, counted_by)
  values (s.id, s.to_site_id, nullif(btrim(p->>'note'), ''), auth.uid()) returning id into v_id;

  insert into public.receive_count_lines (count_id, item_code, expected_qty, counted_qty)
  select v_id, e.item_code, e.qty, coalesce(c.counted, 0)
  from (select item_code, sum(qty) as qty from public.stv_lines where stv_id = s.id group by item_code) e
  left join (select x->>'item_code' as item_code, sum((x->>'counted_qty')::numeric) as counted
             from jsonb_array_elements(coalesce(p->'lines', '[]')) x group by 1) c on c.item_code = e.item_code;
  -- items that arrived but were not on the voucher
  insert into public.receive_count_lines (count_id, item_code, expected_qty, counted_qty)
  select v_id, x->>'item_code', 0, sum((x->>'counted_qty')::numeric)
  from jsonb_array_elements(coalesce(p->'lines', '[]')) x
  where not exists (select 1 from public.stv_lines l where l.stv_id = s.id and l.item_code = x->>'item_code')
    and (x->>'counted_qty')::numeric > 0
  group by x->>'item_code';

  select coalesce(sum(expected_qty), 0) as e, coalesce(sum(counted_qty), 0) as c,
         count(*) filter (where counted_qty < expected_qty) as short, count(*) filter (where counted_qty > expected_qty) as over
  into r from public.receive_count_lines where count_id = v_id;
  update public.receive_counts set expected_qty = r.e, counted_qty = r.c, short_lines = r.short, over_lines = r.over where id = v_id;
  perform public.log_action('receive_count', 'stv', s.id::text, jsonb_build_object('doc_no', s.doc_no, 'short_lines', r.short, 'over_lines', r.over));
  return jsonb_build_object('id', v_id, 'expected_qty', r.e, 'counted_qty', r.c, 'short_lines', r.short, 'over_lines', r.over);
end $$;

-- ===========================================================================
-- STV checks: the same transfer uploaded twice under different numbers, and missing STV numbers.

create table public.stv_check_dismissals (
  kind          text not null check (kind in ('duplicate', 'gap')),
  key           text not null,
  note          text,
  dismissed_by  uuid references public.profiles(user_id),
  dismissed_at  timestamptz not null default now(),
  primary key (kind, key)
);
alter table public.stv_check_dismissals enable row level security;
create policy stv_dismissals_read on public.stv_check_dismissals for select to authenticated using (public.is_ho());

insert into public.settings (key, value) values
  ('stv_numbering', '"global"'),  -- 'global' = one STV number series for the whole company, 'per_store' = each sending ERP store has its own
  ('stv_gap_max', '30')           -- a jump bigger than this is treated as a different number series, not missing STVs
on conflict (key) do nothing;

-- Before upload: active STVs on the same route, within 3 days, with (almost) the same lines.
create or replace function public.stv_similar(p jsonb)
returns jsonb language sql stable set search_path = public as $$
  with inp as (
    select btrim(x->>'item_code') as item_code, sum((x->>'qty')::numeric) as qty
    from jsonb_array_elements(coalesce(p->'lines', '[]')) x group by 1
  ),
  cand as (
    select s.id, s.doc_no, s.stv_date, s.direction, s.line_count, s.total_qty
    from public.stvs s
    where s.status = 'active' and s.from_code = p->>'from_code' and s.to_code = p->>'to_code'
      and abs(s.stv_date - (p->>'stv_date')::date) <= 3 and s.doc_no <> btrim(coalesce(p->>'doc_no', ''))
  ),
  scored as (
    select c.*,
      (select count(*) from inp i join public.v_stv_items v on v.stv_id = c.id and v.item_code = i.item_code and v.qty = i.qty) as same_lines,
      greatest((select count(*) from inp), (select count(*) from public.v_stv_items v where v.stv_id = c.id)) as all_lines
    from cand c
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'doc_no', doc_no, 'stv_date', stv_date, 'direction', direction,
           'same_lines', same_lines, 'all_lines', all_lines, 'identical', same_lines = all_lines) order by same_lines desc), '[]')
  from scored where all_lines > 0 and same_lines * 10 >= all_lines * 9
$$;

-- Already uploaded: pairs of active STVs that look like the same transfer (same route, within 3 days, identical lines).
create or replace function public.stv_duplicate_pairs()
returns table (key text, a_id uuid, a_doc text, a_date date, b_id uuid, b_doc text, b_date date,
               direction text, from_site_id int, to_site_id int, lines int, qty numeric)
language sql stable set search_path = public as $$
  with sig as (
    select s.id, s.doc_no, s.stv_date, s.direction, s.from_code, s.to_code, s.from_site_id, s.to_site_id, s.line_count, s.total_qty,
           md5(string_agg(v.item_code || ':' || v.qty::text, ',' order by v.item_code)) as h
    from public.stvs s join public.v_stv_items v on v.stv_id = s.id
    where s.status = 'active' and public.is_ho()
    group by s.id
  )
  select a.doc_no || '/' || b.doc_no, a.id, a.doc_no, a.stv_date, b.id, b.doc_no, b.stv_date,
         a.direction, a.from_site_id, a.to_site_id, a.line_count, a.total_qty
  from sig a join sig b on a.h = b.h and a.from_code = b.from_code and a.to_code = b.to_code and a.doc_no < b.doc_no
   and abs(a.stv_date - b.stv_date) <= 3
  where not exists (select 1 from public.stv_check_dismissals d where d.kind = 'duplicate' and d.key = a.doc_no || '/' || b.doc_no)
  order by greatest(a.stv_date, b.stv_date) desc
$$;

-- Missing STV numbers between uploaded ones (numeric STV numbers, last p_days days).
create or replace function public.stv_number_gaps(p_days int default 60)
returns table (key text, series text, first_missing bigint, last_missing bigint, missing int,
               before_doc text, before_date date, before_id uuid, after_doc text, after_date date, after_id uuid)
language sql stable set search_path = public as $$
  with cfg as (
    select coalesce((select value #>> '{}' from public.settings where key = 'stv_numbering'), 'global') as mode,
           public.setting_int('stv_gap_max', 30) as max_gap
  ),
  nums as (
    select s.id, s.doc_no, s.doc_no::bigint as n, s.stv_date,
           case when cfg.mode = 'per_store' then s.from_code else 'all' end as series
    from public.stvs s, cfg
    where s.doc_no ~ '^\d{1,15}$' and s.stv_date >= public.kw_today() - p_days and public.is_ho()
  ),
  seq as (
    select *, lead(n) over w as next_n, lead(doc_no) over w as next_doc, lead(stv_date) over w as next_date, lead(id) over w as next_id
    from nums window w as (partition by series order by n)
  )
  select q.series || ':' || (q.n + 1) || '-' || (q.next_n - 1), q.series, q.n + 1, q.next_n - 1, (q.next_n - q.n - 1)::int,
         q.doc_no, q.stv_date, q.id, q.next_doc, q.next_date, q.next_id
  from seq q, cfg
  where q.next_n is not null and q.next_n - q.n > 1 and q.next_n - q.n - 1 <= cfg.max_gap
    and not exists (select 1 from public.stv_check_dismissals d
                    where d.kind = 'gap' and d.key = q.series || ':' || (q.n + 1) || '-' || (q.next_n - 1))
  order by q.next_date desc, q.n desc
$$;

create or replace function public.dismiss_stv_check(p_kind text, p_key text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Please write why this is fine'; end if;
  insert into public.stv_check_dismissals (kind, key, note, dismissed_by) values (p_kind, p_key, btrim(p_note), auth.uid())
  on conflict (kind, key) do update set note = excluded.note, dismissed_by = excluded.dismissed_by, dismissed_at = now();
  perform public.log_action('dismiss_stv_check', p_kind, p_key, jsonb_build_object('note', p_note));
end $$;

-- ===========================================================================
-- Search box: STVs, allocation plans and items the caller is allowed to see.

create or replace function public.global_search(p_q text)
returns jsonb language sql stable set search_path = public as $$
  with t as (select replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') as q)
  select case when length((select q from t)) < 2 then jsonb_build_object('stvs', '[]'::jsonb, 'allocations', '[]'::jsonb, 'items', '[]'::jsonb)
  else jsonb_build_object(
    'stvs', (select coalesce(jsonb_agg(x), '[]') from (
      select s.id, s.doc_no, s.stv_date, s.direction, s.from_site_id, s.to_site_id, s.status, s.total_qty
      from public.stvs s, t where s.doc_no ilike t.q || '%' order by s.status, s.stv_date desc limit 6) x),
    'allocations', (select coalesce(jsonb_agg(x), '[]') from (
      select a.id, a.ref, a.title, a.plan_date, a.from_site_id, a.status
      from public.allocations a, t where a.ref ilike '%' || t.q || '%' or a.title ilike '%' || t.q || '%'
      order by a.plan_date desc limit 6) x),
    'items', (select coalesce(jsonb_agg(x), '[]') from (
      select i.item_code, i.name, i.barcode
      from public.items i, t where i.item_code ilike t.q || '%' or i.barcode = btrim(p_q) or i.name ilike '%' || t.q || '%'
      order by (i.item_code = btrim(p_q) or i.barcode = btrim(p_q)) desc, i.item_code limit 8) x)
  ) end
$$;

-- ===========================================================================
-- Notification bell: open tasks for the signed-in user (runs with the caller's permissions).

create or replace function public.my_notifications()
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_out jsonb := '[]';
  v_sites int[] := public.my_sites();
  v_rsla int := public.setting_int('receipt_sla_days', 1);
  v_dsla int := public.setting_int('dispatch_sla_days', 2);
  n int;
  prev_month date := (date_trunc('month', public.kw_today()) - interval '1 month')::date;
begin
  if public.app_role() is null then return v_out; end if;
  if public.is_ho() then
    select count(*) into n from public.resolutions where status = 'pending';
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'approvals', 'n', n, 'label', 'explanations waiting for approval', 'to', '/discrepancies?tab=pending', 'tone', 'warn'); end if;
    select count(*) into n from public.backlog_actions where status = 'pending';
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'backlog', 'n', n, 'label', 'old-stock decisions waiting for approval', 'to', '/virtual-stores?tab=cleanup', 'tone', 'warn'); end if;
    select count(distinct stv_id) into n from public.v_dispatch_items where open_qty > 0 and age_days > v_rsla;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'late', 'n', n, 'label', 'transfers received late', 'to', '/in-transit?overdue=1', 'tone', 'bad'); end if;
    select count(*) into n from public.v_legs where status = 'awaiting_dispatch' and days_waiting_dispatch > v_dsla;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'not_sent', 'n', n, 'label', 'plans not sent on time', 'to', '/allocations?status=awaiting_dispatch', 'tone', 'bad'); end if;
    select count(*) into n from public.stv_number_gaps(30);
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'gaps', 'n', n, 'label', 'gaps in STV numbers to check', 'to', '/stv-checks', 'tone', 'warn'); end if;
    select count(*) into n from public.stv_duplicate_pairs();
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'dups', 'n', n, 'label', 'possible duplicate STVs', 'to', '/stv-checks', 'tone', 'bad'); end if;
    select count(*) into n from public.erp_locations where auto_created;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'locations', 'n', n, 'label', 'new ERP store codes to confirm', 'to', '/settings?tab=locations', 'tone', 'info'); end if;
    if extract(day from public.kw_today()) >= 3 and not exists (select 1 from public.period_locks where month = prev_month)
       and exists (select 1 from public.stvs where stv_date >= prev_month and stv_date < prev_month + interval '1 month') then
      v_out := v_out || jsonb_build_object('key', 'month', 'n', 1, 'label', to_char(prev_month, 'FMMonth') || ' is not closed yet', 'to', '/month-end', 'tone', 'info');
    end if;
  else
    select count(*) into n from public.v_legs where from_site_id = any(v_sites) and status = 'awaiting_dispatch';
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'to_send', 'n', n, 'label', 'allocations to send', 'to', '/allocations', 'tone', 'warn'); end if;
    select count(distinct stv_id) into n from public.v_dispatch_items where to_site_id = any(v_sites) and direction = 'dispatch' and open_qty > 0;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'to_receive', 'n', n, 'label', 'transfers to receive', 'to', '/receive', 'tone', 'warn'); end if;
    select count(distinct stv_id) into n from public.v_dispatch_items where to_site_id = any(v_sites) and direction = 'dispatch' and open_qty > 0 and age_days > v_rsla;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'late', 'n', n, 'label', 'of them are late', 'to', '/receive', 'tone', 'bad'); end if;
    select count(*) into n from public.v_discrepancies where responsible_site_id = any(v_sites) and resolution_status is null
      and not (kind = 'receipt_short' and coalesce(actual_qty, 0) = 0);
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'explain', 'n', n, 'label', 'problems to explain', 'to', '/discrepancies', 'tone', 'warn'); end if;
    select count(*) into n from public.v_discrepancies where responsible_site_id = any(v_sites) and resolution_status = 'rejected';
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'rejected', 'n', n, 'label', 'explanations rejected by head office', 'to', '/discrepancies', 'tone', 'bad'); end if;
    select count(*) into n from public.backlog_actions b join public.erp_locations l on l.code = b.location_code
      where l.site_id = any(v_sites) and b.status = 'rejected' and b.decided_at > now() - interval '14 days';
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'backlog_rejected', 'n', n, 'label', 'old-stock decisions rejected', 'to', '/virtual-stores?tab=cleanup', 'tone', 'bad'); end if;
  end if;
  return v_out;
end $$;

-- ===========================================================================
-- Accuracy per store per month.
-- sender:   plan lines sent exactly as planned (plans that were sent)
-- receiver: sent lines received in full (only transfers that are received or past the receiving deadline)

create view public.v_accuracy_monthly with (security_invoker = on) as
select date_trunc('month', a.plan_date)::date as month, a.from_site_id as site_id, 'sender'::text as role,
       count(*) filter (where li.planned_qty is not null) as lines,
       count(*) filter (where li.planned_qty is not null and li.dispatched_qty = li.planned_qty) as exact_lines,
       coalesce(sum(li.planned_qty), 0) as expected_qty,
       coalesce(sum(least(li.dispatched_qty, li.planned_qty)) filter (where li.planned_qty is not null), 0) as matched_qty,
       count(*) filter (where li.planned_qty is null) as extra_lines
from public.v_leg_items li
join public.allocation_legs l on l.id = li.leg_id
join public.allocations a on a.id = l.allocation_id
where li.leg_dispatched and a.status = 'active'
group by 1, 2
union all
select date_trunc('month', d.stv_date)::date, d.to_site_id, 'receiver',
       count(*), count(*) filter (where d.received_qty >= d.dispatched_qty),
       coalesce(sum(d.dispatched_qty), 0), coalesce(sum(least(d.received_qty, d.dispatched_qty)), 0), 0
from public.v_dispatch_items d
where d.direction = 'dispatch' and (d.received_qty >= d.dispatched_qty or d.age_days > public.setting_int('receipt_sla_days', 1))
group by 1, 2;

-- ===========================================================================
-- Grants: nothing for anon; clients read (RLS filters) and call the RPCs.

revoke all on function
  public.is_locked(date), public.locked_error(date), public.guard_stvs_lock(), public.guard_allocations_lock(),
  public.guard_snapshots_lock(), public.month_summary(date), public.lock_month(date, text), public.unlock_month(date, text),
  public.propose_backlog(jsonb), public.decide_backlog(uuid[], boolean, text), public.save_receive_count(jsonb),
  public.stv_similar(jsonb), public.stv_duplicate_pairs(), public.stv_number_gaps(int), public.dismiss_stv_check(text, text, text),
  public.global_search(text), public.my_notifications()
from public, anon;
grant execute on function
  public.is_locked(date), public.month_summary(date), public.lock_month(date, text), public.unlock_month(date, text),
  public.propose_backlog(jsonb), public.decide_backlog(uuid[], boolean, text), public.save_receive_count(jsonb),
  public.stv_similar(jsonb), public.stv_duplicate_pairs(), public.stv_number_gaps(int), public.dismiss_stv_check(text, text, text),
  public.global_search(text), public.my_notifications()
to authenticated;
revoke all on public.period_locks, public.backlog_actions, public.receive_counts, public.receive_count_lines,
  public.stv_check_dismissals, public.v_backlog_actions, public.v_vs_history, public.v_accuracy_monthly from anon, authenticated;
grant select on public.period_locks, public.backlog_actions, public.receive_counts, public.receive_count_lines,
  public.stv_check_dismissals, public.v_backlog_actions, public.v_vs_history, public.v_accuracy_monthly to authenticated;
alter function public.locked_error(date) set search_path = public;
