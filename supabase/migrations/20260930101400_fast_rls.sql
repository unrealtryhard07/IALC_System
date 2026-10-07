-- Speed: row-level security used to call permission functions for EVERY row (thousands per page).
-- Now each request works out once which sites / plans / legs / STVs the user may see, and rows are
-- compared against that list. The visibility rules themselves are unchanged.

create or replace function public.visible_site_ids() returns int[]
language sql stable security definer set search_path = public as $$
  select case when public.is_ho() then array(select id from public.sites) else public.my_sites() end
$$;

create or replace function public.visible_leg_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(
    select l.id from public.allocation_legs l join public.allocations a on a.id = l.allocation_id
    where l.to_site_id = any(public.my_sites()) or a.from_site_id = any(public.my_sites()))
$$;

create or replace function public.visible_allocation_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(
    select a.id from public.allocations a where a.from_site_id = any(public.my_sites())
    union
    select l.allocation_id from public.allocation_legs l where l.to_site_id = any(public.my_sites()))
$$;

create or replace function public.visible_stv_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select s.id from public.stvs s where s.from_site_id = any(public.my_sites()) or s.to_site_id = any(public.my_sites()))
$$;

create or replace function public.visible_location_codes() returns text[]
language sql stable security definer set search_path = public as $$
  select array(select l.code from public.erp_locations l where l.site_id = any(public.visible_site_ids()))
$$;

revoke all on function public.visible_site_ids(), public.visible_leg_ids(), public.visible_allocation_ids(),
  public.visible_stv_ids(), public.visible_location_codes() from public, anon;
grant execute on function public.visible_site_ids(), public.visible_leg_ids(), public.visible_allocation_ids(),
  public.visible_stv_ids(), public.visible_location_codes() to authenticated;

-- "(select f())" makes Postgres evaluate f() once per query instead of once per row.

-- reference data
alter policy sites_read on public.sites using ((select public.app_role()) is not null);
alter policy sites_admin on public.sites using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy locations_read on public.erp_locations using ((select public.app_role()) is not null);
alter policy locations_admin on public.erp_locations using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy settings_read on public.settings using ((select public.app_role()) is not null);
alter policy settings_admin on public.settings using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy reasons_read on public.reason_codes using ((select public.app_role()) is not null);
alter policy reasons_admin on public.reason_codes using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy items_read on public.items using ((select public.app_role()) is not null);
alter policy items_admin on public.items using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy item_imports_read on public.item_imports using ((select public.is_ho()));
alter policy period_locks_read on public.period_locks using ((select public.app_role()) is not null);
alter policy audit_read on public.audit_log using ((select public.is_ho()));
alter policy stv_dismissals_read on public.stv_check_dismissals using ((select public.is_ho()));
alter policy profiles_read on public.profiles using (user_id = (select auth.uid()) or (select public.is_ho()));
alter policy user_sites_read on public.user_sites using (user_id = (select auth.uid()) or (select public.is_ho()));

-- plans
alter policy allocations_read on public.allocations using ((select public.is_ho()) or id = any((select public.visible_allocation_ids())::uuid[]));
alter policy legs_read on public.allocation_legs using ((select public.is_ho()) or id = any((select public.visible_leg_ids())::uuid[]));
alter policy lines_read on public.allocation_lines using ((select public.is_ho()) or leg_id = any((select public.visible_leg_ids())::uuid[]));

-- STVs and everything hanging off them
alter policy stvs_read on public.stvs using (
  (select public.is_ho()) or from_site_id = any((select public.my_sites())::int[]) or to_site_id = any((select public.my_sites())::int[]));
alter policy stv_lines_read on public.stv_lines using ((select public.is_ho()) or stv_id = any((select public.visible_stv_ids())::uuid[]));
alter policy stv_links_read on public.stv_links using (
  (select public.is_ho()) or receipt_id = any((select public.visible_stv_ids())::uuid[]) or dispatch_id = any((select public.visible_stv_ids())::uuid[]));
alter policy matches_read on public.receipt_matches using (
  (select public.is_ho()) or dispatch_id = any((select public.visible_stv_ids())::uuid[]) or receipt_id = any((select public.visible_stv_ids())::uuid[]));
alter policy receive_counts_read on public.receive_counts using ((select public.is_ho()) or dispatch_id = any((select public.visible_stv_ids())::uuid[]));
alter policy receive_count_lines_read on public.receive_count_lines using (
  (select public.is_ho()) or count_id in (select c.id from public.receive_counts c where c.dispatch_id = any((select public.visible_stv_ids())::uuid[])));
alter policy resolutions_read on public.resolutions using (
  (select public.is_ho()) or stv_id = any((select public.visible_stv_ids())::uuid[]) or leg_id = any((select public.visible_leg_ids())::uuid[]));

-- virtual stores
alter policy snapshots_read on public.vs_snapshots using (location_code = any((select public.visible_location_codes())::text[]));
alter policy snapshot_lines_read on public.vs_snapshot_lines using (
  snapshot_id in (select s.id from public.vs_snapshots s where s.location_code = any((select public.visible_location_codes())::text[])));
alter policy backlog_read on public.backlog_actions using (location_code = any((select public.visible_location_codes())::text[]));

-- helpful indexes for the joins the views do
create index if not exists resolutions_stv_item_idx on public.resolutions (stv_id, item_code);
create index if not exists resolutions_leg_item_idx on public.resolutions (leg_id, item_code);
create index if not exists stv_links_receipt_idx on public.stv_links (receipt_id);
create index if not exists allocation_lines_item_idx on public.allocation_lines (item_code);
