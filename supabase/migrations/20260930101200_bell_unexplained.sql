-- Head office bell / Needs attention also lists problems no store has explained yet (chase the store).
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
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'late', 'n', n, 'label', 'transfers late - not received yet', 'to', '/in-transit?overdue=1', 'tone', 'bad'); end if;
    select count(*) into n from public.v_legs where status = 'awaiting_dispatch' and days_waiting_dispatch > v_dsla;
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'not_sent', 'n', n, 'label', 'plans not sent on time', 'to', '/allocations?status=awaiting_dispatch', 'tone', 'bad'); end if;
    select count(*) into n from public.stv_number_gaps(30);
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'gaps', 'n', n, 'label', 'gaps in STV numbers to check', 'to', '/stv-checks', 'tone', 'warn'); end if;
    select count(*) into n from public.stv_duplicate_pairs();
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'dups', 'n', n, 'label', 'possible duplicate STVs', 'to', '/stv-checks', 'tone', 'bad'); end if;
    select count(*) into n from public.v_discrepancies where coalesce(resolution_status, 'rejected') = 'rejected'
      and not (kind = 'receipt_short' and coalesce(actual_qty, 0) = 0);
    if n > 0 then v_out := v_out || jsonb_build_object('key', 'unexplained', 'n', n, 'label', 'problems the stores have not explained yet', 'to', '/discrepancies', 'tone', 'info'); end if;
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
