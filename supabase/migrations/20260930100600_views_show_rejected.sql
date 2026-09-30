-- Views show the latest explanation per discrepancy including rejected ones,
-- so stores see that head office rejected their reason (only approved closes a line).

-- Dispatch side: every dispatched item, how much was received, how much is still sitting in the Allocation store.
create or replace view public.v_dispatch_items with (security_invoker = on) as
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
create or replace view public.v_leg_items with (security_invoker = on) as
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

-- Receipt items that could not be matched to any dispatch (over-receipt or stock with no dispatch in the system).
create or replace view public.v_unmatched_receipts with (security_invoker = on) as
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
create or replace view public.v_discrepancies with (security_invoker = on) as
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
