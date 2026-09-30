-- IALC System - reconciliation views (security_invoker => callers only see rows RLS allows).

-- One row per (active STV, item) - duplicate item lines on an STV are summed.
create view public.v_stv_items with (security_invoker = on) as
select s.id as stv_id, s.doc_no, s.stv_date, s.direction, s.from_code, s.to_code, s.from_site_id, s.to_site_id, s.leg_id,
       l.item_code, max(l.item_name) as item_name, sum(l.qty) as qty
from public.stvs s
join public.stv_lines l on l.stv_id = s.id
where s.status = 'active'
group by s.id, l.item_code;

-- Dispatch side: every dispatched item, how much was received, how much is still sitting in the Allocation store.
create view public.v_dispatch_items with (security_invoker = on) as
with m as (
  select dispatch_id, item_code, sum(qty) as received, max(receipt_date) as last_receipt_date,
         string_agg(distinct receipt_doc_no, ', ') as receipt_docs
  from public.receipt_matches group by dispatch_id, item_code
)
select d.stv_id, d.doc_no, d.stv_date, d.direction, d.from_code, d.to_code, d.from_site_id, d.to_site_id, d.leg_id,
       d.item_code, coalesce(i.name, d.item_name) as item_name, i.cost,
       d.qty as dispatched_qty,
       case when d.direction = 'direct' then d.qty else coalesce(m.received, 0) end as received_qty,
       greatest(d.qty - case when d.direction = 'direct' then d.qty else coalesce(m.received, 0) end, 0) as raw_open_qty,
       case when r.status = 'approved' then 0
            else greatest(d.qty - case when d.direction = 'direct' then d.qty else coalesce(m.received, 0) end, 0) end as open_qty,
       case when d.direction = 'direct' then d.stv_date else m.last_receipt_date end as last_receipt_date,
       case when d.direction = 'direct' then d.doc_no else m.receipt_docs end as receipt_docs,
       public.kw_today() - d.stv_date as age_days,
       r.id as resolution_id, r.status as resolution_status, r.reason_code, r.note as resolution_note
from public.v_stv_items d
left join m on m.dispatch_id = d.stv_id and m.item_code = d.item_code
left join public.items i on i.item_code = d.item_code
left join lateral (
  select * from public.resolutions r
  where r.kind = 'receipt_short' and r.stv_id = d.stv_id and r.item_code = d.item_code
  order by r.requested_at desc limit 1
) r on true
where d.direction in ('dispatch', 'direct');

-- Plan side: planned vs dispatched vs received per leg and item (planned items and unplanned extras).
create view public.v_leg_items with (security_invoker = on) as
with disp as (
  select leg_id, item_code, max(item_name) as item_name, sum(dispatched_qty) as dispatched_qty, sum(received_qty) as received_qty,
         sum(open_qty) as open_qty, sum(raw_open_qty) as raw_open_qty, min(stv_date) as first_dispatch, max(last_receipt_date) as last_receipt_date,
         string_agg(distinct doc_no, ', ') as dispatch_docs
  from public.v_dispatch_items where leg_id is not null group by leg_id, item_code
),
sent as (select distinct leg_id from public.stvs where status = 'active' and leg_id is not null),
base as (
  select coalesce(p.leg_id, d.leg_id) as leg_id, coalesce(p.item_code, d.item_code) as item_code,
         coalesce(p.item_name, d.item_name) as plan_item_name, p.planned_qty,
         coalesce(d.dispatched_qty, 0) as dispatched_qty, coalesce(d.received_qty, 0) as received_qty,
         coalesce(d.open_qty, 0) as open_qty, coalesce(d.raw_open_qty, 0) as raw_open_qty,
         d.first_dispatch, d.last_receipt_date, d.dispatch_docs
  from public.allocation_lines p
  full join disp d on d.leg_id = p.leg_id and d.item_code = p.item_code
)
select b.leg_id, b.item_code, coalesce(i.name, b.plan_item_name) as item_name, i.cost, b.planned_qty,
       b.dispatched_qty, b.received_qty, b.open_qty, b.raw_open_qty, b.first_dispatch, b.last_receipt_date, b.dispatch_docs,
       (s.leg_id is not null) as leg_dispatched,
       case
         when s.leg_id is null then 'awaiting_dispatch'
         when b.planned_qty is null then 'unplanned'
         when b.dispatched_qty = 0 then 'not_sent'
         when b.dispatched_qty < b.planned_qty then 'short'
         when b.dispatched_qty > b.planned_qty then 'over'
         else 'ok' end as dispatch_status,
       coalesce(b.dispatched_qty, 0) - coalesce(b.planned_qty, 0) as dispatch_gap,
       r.id as resolution_id, r.kind as resolution_kind, r.status as resolution_status, r.reason_code, r.note as resolution_note
from base b
left join sent s on s.leg_id = b.leg_id
left join public.items i on i.item_code = b.item_code
left join lateral (
  select * from public.resolutions r
  where r.leg_id = b.leg_id and r.item_code = b.item_code
    and r.kind in ('dispatch_short', 'dispatch_over', 'unplanned_item')
  order by r.requested_at desc limit 1
) r on true;

-- One row per leg (allocation x destination) - drives allocation screens and the legacy tracker.
create view public.v_legs with (security_invoker = on) as
with li as (
  select leg_id,
         count(*) filter (where planned_qty > 0) as planned_skus,
         coalesce(sum(planned_qty), 0) as planned_qty,
         count(*) filter (where dispatched_qty > 0) as dispatched_skus,
         coalesce(sum(dispatched_qty), 0) as dispatched_qty,
         count(*) filter (where received_qty > 0) as received_skus,
         coalesce(sum(received_qty), 0) as received_qty,
         coalesce(sum(open_qty), 0) as open_qty,
         coalesce(sum(open_qty * cost), 0) as open_value,
         count(*) filter (where dispatch_status in ('short', 'not_sent', 'over', 'unplanned')
                          and coalesce(resolution_status, '') <> 'approved') as open_issues,
         count(*) filter (where dispatch_status in ('short', 'not_sent', 'over', 'unplanned')
                          and resolution_status = 'pending') as pending_issues,
         max(last_receipt_date) as last_receipt_date
  from public.v_leg_items group by leg_id
),
st as (
  select leg_id, min(stv_date) as first_dispatch_date, string_agg(doc_no, ', ' order by stv_date) as dispatch_docs, count(*) as stv_count
  from public.stvs where status = 'active' and leg_id is not null group by leg_id
)
select l.id as leg_id, a.id as allocation_id, a.ref, a.kind, a.title, a.from_site_id, l.to_site_id, a.plan_date,
       a.status as allocation_status, a.created_at,
       coalesce(li.planned_skus, 0) as planned_skus, coalesce(li.planned_qty, 0) as planned_qty,
       coalesce(li.dispatched_skus, 0) as dispatched_skus, coalesce(li.dispatched_qty, 0) as dispatched_qty,
       coalesce(li.received_skus, 0) as received_skus, coalesce(li.received_qty, 0) as received_qty,
       coalesce(li.open_qty, 0) as open_qty, coalesce(li.open_value, 0) as open_value,
       coalesce(li.open_issues, 0) as open_issues, coalesce(li.pending_issues, 0) as pending_issues,
       st.first_dispatch_date, st.dispatch_docs, coalesce(st.stv_count, 0) as stv_count,
       case when coalesce(li.open_qty, 0) = 0 and st.leg_id is not null then li.last_receipt_date end as completed_date,
       li.last_receipt_date,
       case
         when a.status = 'cancelled' then 'cancelled'
         when st.leg_id is null then 'awaiting_dispatch'
         when coalesce(li.open_qty, 0) > 0 and coalesce(li.received_qty, 0) > 0 then 'partially_received'
         when coalesce(li.open_qty, 0) > 0 then 'in_transit'
         when coalesce(li.open_issues, 0) > 0 then 'discrepancy'
         else 'completed' end as status,
       case when st.leg_id is null and a.status = 'active'
            then public.kw_today() - a.plan_date end as days_waiting_dispatch
from public.allocation_legs l
join public.allocations a on a.id = l.allocation_id
left join li on li.leg_id = l.id
left join st on st.leg_id = l.id;

-- Receipt items that could not be matched to any dispatch (over-receipt or stock with no dispatch in the system).
create view public.v_unmatched_receipts with (security_invoker = on) as
select r.stv_id, r.doc_no, r.stv_date, r.from_code, r.to_site_id, r.item_code, coalesce(i.name, r.item_name) as item_name, i.cost,
       r.qty, coalesce(m.matched, 0) as matched_qty, r.qty - coalesce(m.matched, 0) as unmatched_qty,
       rs.id as resolution_id, rs.status as resolution_status, rs.reason_code, rs.note as resolution_note
from public.v_stv_items r
left join (select receipt_id, item_code, sum(qty) as matched from public.receipt_matches group by receipt_id, item_code) m
  on m.receipt_id = r.stv_id and m.item_code = r.item_code
left join public.items i on i.item_code = r.item_code
left join lateral (
  select * from public.resolutions x where x.kind = 'receipt_over' and x.stv_id = r.stv_id and x.item_code = r.item_code
    order by x.requested_at desc limit 1
) rs on true
where r.direction = 'receipt' and r.qty > coalesce(m.matched, 0);

-- Unified discrepancy list (Approvals page). responsible_site_id = the store that must explain it.
create view public.v_discrepancies with (security_invoker = on) as
select 'dispatch_' || case when li.dispatch_status in ('short', 'not_sent') then 'short' else 'over' end as kind,
       li.leg_id, null::uuid as stv_id, li.item_code, li.item_name, li.cost,
       lg.from_site_id, lg.to_site_id, lg.from_site_id as responsible_site_id, lg.ref, lg.allocation_id,
       null::text as doc_no, li.dispatch_docs as docs, coalesce(li.first_dispatch, lg.plan_date) as event_date,
       li.planned_qty, li.dispatched_qty as actual_qty, li.dispatch_gap as gap_qty,
       li.resolution_id, li.resolution_status, li.reason_code, li.resolution_note
from public.v_leg_items li join public.v_legs lg on lg.leg_id = li.leg_id
where li.dispatch_status in ('short', 'not_sent', 'over') and lg.allocation_status = 'active'
union all
select 'unplanned_item', li.leg_id, null, li.item_code, li.item_name, li.cost,
       lg.from_site_id, lg.to_site_id, lg.from_site_id, lg.ref, lg.allocation_id,
       null, li.dispatch_docs, li.first_dispatch, null, li.dispatched_qty, li.dispatched_qty,
       li.resolution_id, li.resolution_status, li.reason_code, li.resolution_note
from public.v_leg_items li join public.v_legs lg on lg.leg_id = li.leg_id
where li.dispatch_status = 'unplanned' and lg.allocation_status = 'active'
union all
select 'unplanned_stv', null, s.id, '*', null, null,
       s.from_site_id, s.to_site_id, s.from_site_id, null, null,
       s.doc_no, s.doc_no, s.stv_date, null, s.total_qty, s.total_qty,
       r.id, r.status, r.reason_code, r.note
from public.stvs s
left join lateral (
  select * from public.resolutions r where r.kind = 'unplanned_stv' and r.stv_id = s.id
  order by r.requested_at desc limit 1
) r on true
where s.status = 'active' and s.direction in ('dispatch', 'direct') and s.leg_id is null
union all
-- dispatched but not (fully) received: once partly received, or past the receiving SLA
select 'receipt_short', d.leg_id, d.stv_id, d.item_code, d.item_name, d.cost,
       d.from_site_id, d.to_site_id, d.to_site_id, lg.ref, lg.allocation_id,
       d.doc_no, d.receipt_docs, d.stv_date, d.dispatched_qty, d.received_qty, d.received_qty - d.dispatched_qty,
       d.resolution_id, d.resolution_status, d.reason_code, d.resolution_note
from public.v_dispatch_items d
left join public.v_legs lg on lg.leg_id = d.leg_id
where d.raw_open_qty > 0
  and (d.age_days > public.setting_int('receipt_sla_days', 1)
       or exists (select 1 from public.receipt_matches m where m.dispatch_id = d.stv_id))
union all
select 'receipt_over', null, u.stv_id, u.item_code, u.item_name, u.cost,
       null, u.to_site_id, u.to_site_id, null, null,
       u.doc_no, u.doc_no, u.stv_date, u.matched_qty, u.qty, u.unmatched_qty,
       u.resolution_id, u.resolution_status, u.reason_code, u.resolution_note
from public.v_unmatched_receipts u;

-- Virtual Store Watch: latest ERP snapshot per allocation store compared to what the system expects.
create view public.v_vs_latest with (security_invoker = on) as
with latest as (
  select distinct on (location_code) id, location_code, snapshot_date
  from public.vs_snapshots order by location_code, snapshot_date desc
),
-- system view as of the snapshot date: dispatched on/before it and not received on/before it
sys as (
  select d.to_code as location_code, d.item_code,
         sum(greatest(d.dispatched_qty - coalesce((
               select sum(m.qty) from public.receipt_matches m
               where m.dispatch_id = d.stv_id and m.item_code = d.item_code and m.receipt_date <= lt.snapshot_date), 0), 0))
           filter (where coalesce(d.resolution_status, '') <> 'approved') as system_open_qty,
         min(d.stv_date) filter (where d.open_qty > 0) as oldest_open_dispatch
  from public.v_dispatch_items d
  join latest lt on lt.location_code = d.to_code
  where d.direction = 'dispatch' and d.stv_date <= lt.snapshot_date
  group by d.to_code, d.item_code
),
erp as (
  select lt.location_code, lt.snapshot_date, sl.item_code, sl.item_name, sl.qty as erp_qty, sl.value as erp_value, sl.since_date,
         -- first snapshot of the current continuous run in which this item was present
         (select min(s2.snapshot_date) from public.vs_snapshots s2
          where s2.location_code = lt.location_code and s2.snapshot_date <= lt.snapshot_date
            and s2.snapshot_date > coalesce((
              select max(s3.snapshot_date) from public.vs_snapshots s3
              where s3.location_code = lt.location_code and s3.snapshot_date < lt.snapshot_date
                and not exists (select 1 from public.vs_snapshot_lines x where x.snapshot_id = s3.id and x.item_code = sl.item_code and x.qty > 0)
            ), '-infinity'::date)) as first_seen
  from latest lt join public.vs_snapshot_lines sl on sl.snapshot_id = lt.id
  where sl.qty <> 0
)
select coalesce(e.location_code, s.location_code) as location_code, loc.site_id, loc.erp_name,
       (select snapshot_date from latest where latest.location_code = coalesce(e.location_code, s.location_code)) as snapshot_date,
       coalesce(e.item_code, s.item_code) as item_code, coalesce(i.name, e.item_name) as item_name, i.cost,
       coalesce(e.erp_qty, 0) as erp_qty,
       coalesce(e.erp_value, coalesce(e.erp_qty, 0) * i.cost) as erp_value,
       coalesce(s.system_open_qty, 0) as system_open_qty,
       coalesce(e.erp_qty, 0) - coalesce(s.system_open_qty, 0) as diff_qty,
       least(e.since_date, e.first_seen, s.oldest_open_dispatch) as since_date,
       public.kw_today() - least(e.since_date, e.first_seen, s.oldest_open_dispatch) as age_days,
       case
         when coalesce(e.erp_qty, 0) > 0 and coalesce(s.system_open_qty, 0) = 0 then 'not_in_system'
         when coalesce(e.erp_qty, 0) > coalesce(s.system_open_qty, 0) then 'partly_explained'
         when coalesce(e.erp_qty, 0) < coalesce(s.system_open_qty, 0) then 'receipt_not_uploaded'
         else 'explained' end as match_status
from erp e
full join sys s on s.location_code = e.location_code and s.item_code = e.item_code and s.system_open_qty > 0
join public.erp_locations loc on loc.code = coalesce(e.location_code, s.location_code)
left join public.items i on i.item_code = coalesce(e.item_code, s.item_code)
where coalesce(e.erp_qty, 0) <> 0 or coalesce(s.system_open_qty, 0) > 0;
