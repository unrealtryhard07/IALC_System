-- IALC System - row level security.
-- HO (admin/viewer) sees everything. Store users see only allocations/STVs where one of their
-- stores is the sender or the receiver. All writes go through the SECURITY DEFINER RPCs, except
-- admin maintenance of reference tables.

alter table public.sites enable row level security;
alter table public.erp_locations enable row level security;
alter table public.settings enable row level security;
alter table public.reason_codes enable row level security;
alter table public.app_secrets enable row level security;
alter table public.profiles enable row level security;
alter table public.user_sites enable row level security;
alter table public.items enable row level security;
alter table public.item_imports enable row level security;
alter table public.allocations enable row level security;
alter table public.allocation_legs enable row level security;
alter table public.allocation_lines enable row level security;
alter table public.stvs enable row level security;
alter table public.stv_lines enable row level security;
alter table public.stv_links enable row level security;
alter table public.receipt_matches enable row level security;
alter table public.resolutions enable row level security;
alter table public.vs_snapshots enable row level security;
alter table public.vs_snapshot_lines enable row level security;
alter table public.audit_log enable row level security;

-- Reference data: readable by any active user; admin maintains it.
create policy sites_read on public.sites for select to authenticated using (public.app_role() is not null);
create policy sites_admin on public.sites for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy locations_read on public.erp_locations for select to authenticated using (public.app_role() is not null);
create policy locations_admin on public.erp_locations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_read on public.settings for select to authenticated using (public.app_role() is not null);
create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy reasons_read on public.reason_codes for select to authenticated using (public.app_role() is not null);
create policy reasons_admin on public.reason_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy items_read on public.items for select to authenticated using (public.app_role() is not null);
create policy items_admin on public.items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy item_imports_read on public.item_imports for select to authenticated using (public.is_ho());
-- app_secrets: no policies (service role only).

-- Users: everybody sees their own profile; HO sees all. Changes go through the admin-users edge function.
create policy profiles_read on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_ho());
create policy user_sites_read on public.user_sites for select to authenticated using (user_id = auth.uid() or public.is_ho());

-- Allocations (visibility helpers are SECURITY DEFINER to avoid policy recursion between allocations and legs)
create or replace function public.can_see_allocation(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ho()
    or exists (select 1 from public.allocations a where a.id = p_id and a.from_site_id = any(public.my_sites()))
    or exists (select 1 from public.allocation_legs l where l.allocation_id = p_id and l.to_site_id = any(public.my_sites()))
$$;
create or replace function public.can_see_leg(p_leg uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ho()
    or exists (select 1 from public.allocation_legs l join public.allocations a on a.id = l.allocation_id
               where l.id = p_leg and (l.to_site_id = any(public.my_sites()) or a.from_site_id = any(public.my_sites())))
$$;
create policy allocations_read on public.allocations for select to authenticated using (public.can_see_allocation(id));
create policy legs_read on public.allocation_legs for select to authenticated using (public.can_see_leg(id));
create policy lines_read on public.allocation_lines for select to authenticated using (public.can_see_leg(leg_id));

-- STVs
create policy stvs_read on public.stvs for select to authenticated using (
  public.can_see_site(from_site_id) or public.can_see_site(to_site_id)
);
create policy stv_lines_read on public.stv_lines for select to authenticated using (
  exists (select 1 from public.stvs s where s.id = stv_id)
);
create policy stv_links_read on public.stv_links for select to authenticated using (
  exists (select 1 from public.stvs s where s.id = receipt_id) or exists (select 1 from public.stvs s where s.id = dispatch_id)
);
-- The sender must see that its dispatch was received even though it cannot see the receiver's receipt STV.
create policy matches_read on public.receipt_matches for select to authenticated using (
  exists (select 1 from public.stvs s where s.id = dispatch_id) or exists (select 1 from public.stvs s where s.id = receipt_id)
);

create policy resolutions_read on public.resolutions for select to authenticated using (
  public.is_ho()
  or (stv_id is not null and exists (select 1 from public.stvs s where s.id = stv_id))
  or (leg_id is not null and public.can_see_leg(leg_id))
);

create policy snapshots_read on public.vs_snapshots for select to authenticated using (
  exists (select 1 from public.erp_locations l where l.code = location_code and public.can_see_site(l.site_id))
);
create policy snapshot_lines_read on public.vs_snapshot_lines for select to authenticated using (
  exists (select 1 from public.vs_snapshots s where s.id = snapshot_id)
);

create policy audit_read on public.audit_log for select to authenticated using (public.is_ho());

-- ---------------------------------------------------------------------------
-- Grants: clients may read tables/views (RLS filters) and call the RPCs. Nothing for anon.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.sites, public.erp_locations, public.settings, public.reason_codes, public.items
  to authenticated;  -- still limited to admins by RLS
revoke all on public.app_secrets from authenticated;
grant execute on function
  public.kw_today(), public.norm_name(text), public.app_role(), public.is_admin(), public.is_ho(), public.my_sites(),
  public.can_see_site(int), public.can_act_for_site(int), public.can_see_allocation(uuid), public.can_see_leg(uuid), public.setting_int(text, int),
  public.stv_preview(jsonb), public.submit_stv(jsonb), public.void_stv(uuid, text), public.set_stv_leg(uuid, uuid),
  public.create_allocation(jsonb), public.cancel_allocation(uuid, text),
  public.request_resolution(jsonb), public.decide_resolution(uuid, boolean, text), public.close_discrepancy(jsonb),
  public.import_items(jsonb, text, boolean, bigint), public.upload_snapshot(jsonb), public.peek_location(text, text)
to authenticated;
-- internal helpers are not callable by clients
revoke execute on function public.rebuild_matches(text, text[]), public.resolve_location(text, text, boolean),
  public.log_action(text, text, text, jsonb), public.guess_location(text) from authenticated;
