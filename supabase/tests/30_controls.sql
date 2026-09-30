-- Controls: month-end lock, old-stock clean-up, receiving counts, STV checks, search, notifications, accuracy.
-- Runs after 20_scenario.sql (same database). Sites: 1 Jahra, 2 Egaila, 3 Salmiya, 4 Hawally, 5 Jahra DC

-- ============ Month-end lock ============
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_expect_error($$select public.lock_month('2026-08-01', 'x')$$, 'NOT_ALLOWED');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.t_expect_error($$select public.lock_month(public.kw_today(), 'x')$$, 'has ended');
select public.lock_month('2026-08-10', 'August checked');
select public.t_assert((select month from public.period_locks) = '2026-08-01', 'month stored as first day');
select public.t_assert((select summary ? 'stores' from public.period_locks), 'summary frozen');
select public.t_expect_error($$select public.lock_month('2026-08-01', 'again')$$, 'already closed');
reset role;
-- a store cannot post into the closed month
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_expect_error($$select public.submit_stv(jsonb_build_object('doc_no', 'AUG-1', 'stv_date', '2026-08-20', 'from_code', '303',
  'from_name', 'Jahraa D.S', 'to_code', '502', 'to_name', 'Hawally Allocation',
  'lines', jsonb_build_array(jsonb_build_object('item_code', '5555555', 'qty', 1))))$$, 'LOCKED');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.t_expect_error($$select public.create_allocation(jsonb_build_object('from_site_id', 1, 'plan_date', '2026-08-05',
  'legs', jsonb_build_array(jsonb_build_object('to_site_id', 2, 'lines', jsonb_build_array(jsonb_build_object('item_code', '1', 'qty', 1))))))$$, 'LOCKED');
select public.t_expect_error($$select public.unlock_month('2026-08-01', '')$$, 'reason');
select public.unlock_month('2026-08-01', 'late STV found');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.submit_stv(jsonb_build_object('doc_no', 'AUG-1', 'stv_date', '2026-08-20', 'from_code', '303',
  'from_name', 'Jahraa D.S', 'to_code', '502', 'to_name', 'Hawally Allocation',
  'lines', jsonb_build_array(jsonb_build_object('item_code', '5555555', 'qty', 1))));
reset role;
-- voiding an STV of a closed month is blocked, linking it to a plan is not
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.lock_month('2026-08-01', null);
select public.t_expect_error($$select public.void_stv((select id from public.stvs where doc_no = 'AUG-1'), 'wrong')$$, 'LOCKED');
select public.t_assert(public.month_summary('2026-08-01')->>'stvs' = '1', 'august summary counts the STV');
select public.unlock_month('2026-08-01', 'test cleanup');
reset role;

-- ============ Old stock clean-up ============
-- Egaila decides what to do with the old backlog item at Egaila Allocation (505)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false); -- Hawally cannot
set role authenticated;
select public.t_expect_error($$select public.propose_backlog(jsonb_build_object('location_code', '505', 'action', 'to_store',
  'items', jsonb_build_array(jsonb_build_object('item_code', '7777777', 'qty', 40))))$$, 'NOT_ALLOWED');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_expect_error($$select public.propose_backlog(jsonb_build_object('location_code', '505', 'action', 'write_off',
  'items', jsonb_build_array(jsonb_build_object('item_code', '7777777', 'qty', 40))))$$, 'note');
select public.t_assert((public.propose_backlog(jsonb_build_object('location_code', '505', 'action', 'to_store',
  'items', jsonb_build_array(jsonb_build_object('item_code', '7777777', 'qty', 40))))->>'saved')::int = 1, 'store proposes');
select public.t_assert((select status from public.backlog_actions where item_code = '7777777') = 'pending', 'store proposal pending');
-- proposing again replaces the pending one
select public.propose_backlog(jsonb_build_object('location_code', '505', 'action', 'to_dc', 'items', jsonb_build_array(jsonb_build_object('item_code', '7777777', 'qty', 40))));
select public.t_assert((select count(*) from public.backlog_actions where item_code = '7777777') = 1, 'one live decision');
select public.t_assert((select 'backlog' <> all(array(select jsonb_array_elements(public.my_notifications())->>'key'))), 'store bell has no HO items');
select public.t_expect_error($$select public.decide_backlog(array(select id from public.backlog_actions), true, null)$$, 'NOT_ALLOWED');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.t_assert(exists (select 1 from jsonb_array_elements(public.my_notifications()) x where x->>'key' = 'backlog'), 'HO bell shows backlog approvals');
select public.t_expect_error($$select public.decide_backlog(array(select id from public.backlog_actions), false, '')$$, 'why');
select public.t_assert(public.decide_backlog(array(select id from public.backlog_actions), true, 'ok') = 1, 'HO approves');
select public.t_assert((select cleared from public.v_backlog_actions where item_code = '7777777') = false, 'not cleared while still in the ERP');
-- admin decisions are approved immediately
select public.t_assert((public.propose_backlog(jsonb_build_object('location_code', '505', 'action', 'investigate', 'note', 'check with DC',
  'items', jsonb_build_array(jsonb_build_object('item_code', '1011248', 'qty', 10))))->>'approved')::boolean, 'admin decision approved');
-- next ERP report no longer has the item -> cleared
select public.upload_snapshot(jsonb_build_object('location_code', '505', 'snapshot_date', public.kw_today(), 'rows', jsonb_build_array(
  jsonb_build_object('item_code', '1000987', 'qty', 160))));
select public.t_assert((select cleared from public.v_backlog_actions where item_code = '7777777'), 'cleared after ERP report');
select public.t_assert((select count(*) from public.v_vs_history where location_code = '505') = 2, 'history per report');
select public.t_assert((select qty from public.v_vs_history where location_code = '505' and snapshot_date = '2026-09-28') = 210, 'history qty');
reset role;

-- ============ Receiving counts ============
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false); -- Jahra is the sender, cannot count
set role authenticated;
select public.t_expect_error($$select public.save_receive_count(jsonb_build_object('dispatch_id', (select id from public.stvs where doc_no = '39109'), 'lines', '[]'::jsonb))$$, 'NOT_ALLOWED');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare r jsonb;
begin
  -- everything arrived except 1000987 (4 short), plus an item that was not on the voucher
  r := public.save_receive_count(jsonb_build_object('dispatch_id', (select id from public.stvs where doc_no = '39109'), 'note', 'box torn',
    'lines', (select jsonb_agg(jsonb_build_object('item_code', item_code, 'counted_qty', case when item_code = '1000987' then qty - 4 else qty end))
              from public.v_stv_items where doc_no = '39109') || jsonb_build_array(jsonb_build_object('item_code', '9999999', 'counted_qty', 2))));
  perform public.t_assert((r->>'short_lines')::int = 1 and (r->>'over_lines')::int = 1, 'count result ' || r::text);
  perform public.t_assert((r->>'expected_qty')::numeric - (r->>'counted_qty')::numeric = 2, 'count totals');
end $$;
-- counting again replaces the earlier count
select public.save_receive_count(jsonb_build_object('dispatch_id', (select id from public.stvs where doc_no = '39109'),
  'lines', (select jsonb_agg(jsonb_build_object('item_code', item_code, 'counted_qty', qty)) from public.v_stv_items where doc_no = '39109')));
select public.t_assert((select count(*) from public.receive_counts) = 1 and (select short_lines + over_lines from public.receive_counts) = 0, 'recount replaces');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false); -- Salmiya cannot see Egaila's count
set role authenticated;
select public.t_assert((select count(*) from public.receive_counts) = 0, 'count hidden from other stores');
reset role;

-- ============ STV checks ============
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
-- the same lines as 39109 under another number, one day later -> flagged before upload
select public.t_assert((select (x->>'identical')::boolean from jsonb_array_elements(public.stv_similar(
  (select data from public.test_fx where name = 'stv_39109') || jsonb_build_object('doc_no', '39110', 'stv_date', '2026-09-17'))) x limit 1),
  'identical STV found before upload');
select public.t_assert(jsonb_array_length(public.stv_similar(
  (select data from public.test_fx where name = 'stv_39109') || jsonb_build_object('doc_no', '39110', 'stv_date', '2026-09-25'))) = 0,
  'not similar when far apart in time');
select public.submit_stv((select data from public.test_fx where name = 'stv_39109') || jsonb_build_object('doc_no', '39110', 'stv_date', '2026-09-17'));
select public.t_assert((select count(*) from public.stv_duplicate_pairs()) = 0, 'stores do not run the checks');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.t_assert((select count(*) from public.stv_duplicate_pairs() where a_doc = '39109' and b_doc = '39110') = 1, 'duplicate pair listed');
-- numbers 39109, 39110, 39126 (and 40493 = far away, a jump bigger than the limit) -> 39111-39125 missing
select public.t_assert((select missing from public.stv_number_gaps(60) where first_missing = 39111) = 15, 'gap found');
select public.t_assert((select count(*) from public.stv_number_gaps(60) where last_missing >= 40000) = 0, 'big jump is another series');
select public.t_expect_error($$select public.dismiss_stv_check('gap', 'all:39111-39125', '')$$, 'why');
select public.dismiss_stv_check('gap', 'all:39111-39125', 'used for supplier returns');
select public.t_assert((select count(*) from public.stv_number_gaps(60) where first_missing = 39111) = 0, 'dismissed gap hidden');
select public.dismiss_stv_check('duplicate', '39109/39110', 'two real transfers');
select public.t_assert((select count(*) from public.stv_duplicate_pairs()) = 0, 'dismissed duplicate hidden');
select public.void_stv((select id from public.stvs where doc_no = '39110'), 'test duplicate');
reset role;

-- ============ Search ============
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false); -- Salmiya
set role authenticated;
select public.t_assert(jsonb_array_length(public.global_search('3910')->'stvs') = 0, 'search respects store visibility');
select public.t_assert(jsonb_array_length(public.global_search('x')->'items') = 0, 'one letter is not searched');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false); -- Egaila
set role authenticated;
select public.t_assert((public.global_search('3910')->'stvs'->0->>'doc_no') = '39109', 'search finds own STV');
select public.t_assert(jsonb_array_length(public.global_search('AL-0')->'allocations') >= 1, 'search finds plans');
select public.t_assert(jsonb_array_length(public.global_search('%')->'stvs') = 0, 'wildcards are literal');
-- the receiving store sees what to receive in its bell
select public.t_assert(exists (select 1 from jsonb_array_elements(public.my_notifications()) x where x->>'key' = 'to_receive'), 'store bell: to receive');
reset role;

-- ============ Accuracy trend ============
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.t_assert((select lines from public.v_accuracy_monthly where site_id = 1 and role = 'sender' and month = '2026-09-01') > 0, 'sender accuracy rows');
select public.t_assert((select exact_lines <= lines from public.v_accuracy_monthly where site_id = 2 and role = 'receiver' and month = '2026-09-01'), 'receiver accuracy rows');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select public.t_assert((select count(*) from public.v_accuracy_monthly where site_id = 1) = 0, 'accuracy limited to own data');
reset role;

-- anon gets nothing
set role anon;
select public.t_expect_error($$select public.my_notifications()$$, 'permission denied');
select public.t_expect_error($$select count(*) from public.backlog_actions$$, 'permission denied');
reset role;
