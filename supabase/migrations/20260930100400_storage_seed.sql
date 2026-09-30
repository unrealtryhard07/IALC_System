-- IALC System - document storage + reference data.

-- Private bucket keeping every original STV / plan / snapshot file for audit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;

create policy documents_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.app_role() is not null
  and (storage.foldername(name))[1] in ('stv', 'plans', 'snapshots', 'masterlist')
);
create policy documents_read on storage.objects for select to authenticated
using (
  bucket_id = 'documents' and (
    public.is_ho()
    or owner = auth.uid()
    or exists (select 1 from public.stvs s where s.file_path = name)
    or exists (select 1 from public.allocations a where a.source_file = name)
    or exists (select 1 from public.vs_snapshots v where v.file_path = name)
  )
);

-- ---------------------------------------------------------------------------
-- Stores. Aliases are normalised (lower case, punctuation -> space).
insert into public.sites (name, kind, aliases, sort_order) values
  ('Jahra',    'ds', array['jahra', 'jahraa', 'jahra ds', 'jahraa ds', 'jahra d s', 'jahraa d s', 'from jahra ds'], 1),
  ('Egaila',   'ds', array['egaila', 'egaila ds', 'egaila d s', 'eqaila'], 2),
  ('Salmiya',  'ds', array['salmiya', 'salmiya ds', 'salmiya d s', 'salmiyah'], 3),
  ('Hawally',  'ds', array['hawally', 'hawally ds', 'hawally d s', 'hawalli'], 4),
  ('Jahra DC', 'dc', array['jahra dc', 'jahraa dc', 'dc', 'jahra d c'], 5);

-- ERP store codes seen on the sample STVs; others are auto-mapped from the STV name the first time they appear.
insert into public.erp_locations (code, erp_name, site_id, kind) values
  ('303', 'Jahraa D.S',         (select id from public.sites where name = 'Jahra'),    'ds'),
  ('603', 'Jahra DC',           (select id from public.sites where name = 'Jahra DC'), 'dc'),
  ('502', 'Hawally Allocation', (select id from public.sites where name = 'Hawally'),  'allocation'),
  ('505', 'Egaila Allocation',  (select id from public.sites where name = 'Egaila'),   'allocation');

insert into public.settings (key, value) values
  ('dispatch_sla_days', '2'),   -- sender must dispatch within N days of the plan date
  ('receipt_sla_days',  '1'),   -- receiver must post the Allocation -> DS STV within N days of dispatch
  ('company_name', '"Circle United General Trading Co"');

insert into public.reason_codes (code, label, applies_to, sort_order) values
  ('NO_STOCK',        'No stock at sending store',             array['dispatch_short'], 10),
  ('NEAR_EXPIRY',     'Near expiry / expired - not sent',      array['dispatch_short'], 20),
  ('DAMAGED_SENDER',  'Damaged at sending store',              array['dispatch_short'], 30),
  ('NOT_FOUND',       'Could not find item in location',       array['dispatch_short'], 40),
  ('HO_CHANGED',      'Quantity changed by head office',       array['dispatch_short', 'dispatch_over', 'unplanned_item', 'unplanned_stv'], 50),
  ('SENT_LATER',      'Balance sent on another STV',           array['dispatch_short'], 60),
  ('CASE_PACK',       'Rounded to full case / pack',           array['dispatch_over', 'dispatch_short'], 70),
  ('SUBSTITUTE',      'Substitute item sent',                  array['unplanned_item', 'dispatch_short'], 80),
  ('PICKING_ERROR',   'Picking error at sending store',        array['dispatch_over', 'unplanned_item', 'unplanned_stv'], 90),
  ('URGENT_REQUEST',  'Urgent request from receiving store',   array['unplanned_stv', 'unplanned_item'], 100),
  ('NOT_ARRIVED',     'Goods did not arrive',                  array['receipt_short'], 110),
  ('TRANSIT_DAMAGE',  'Damaged in transit',                    array['receipt_short'], 120),
  ('EXPIRED_ARRIVAL', 'Expired on arrival',                    array['receipt_short'], 130),
  ('COUNT_DIFF',      'Count difference on receipt',           array['receipt_short', 'receipt_over'], 140),
  ('WRONG_ITEM',      'Wrong item received',                   array['receipt_short', 'receipt_over'], 150),
  ('OLD_BACKLOG',     'Old stock in allocation store (before system)', array['receipt_over'], 160),
  ('OTHER',           'Other (explain in note)',               array['dispatch_short', 'dispatch_over', 'unplanned_item', 'unplanned_stv', 'receipt_short', 'receipt_over'], 999);

-- One-time code to create the first admin account (read only by the admin-users edge function).
insert into public.app_secrets (key, value)
values ('bootstrap_code', upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12)));
