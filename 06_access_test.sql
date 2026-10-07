-- =====================================================================================
-- HighGround — access test. Run after setting up (01–16) in the SQL editor.
-- Creates two test districts and six test accounts (@example.test), acts as each one,
-- records what was allowed or refused, then deletes everything it created.
-- Every row of the result should say PASS. If the script stops with an error instead,
-- nothing was saved; send the error message to Claude.
-- =====================================================================================

drop table if exists hg_test_results;
create temp table hg_test_results (n int, test text, result text, detail text);

do $$
declare
  ua uuid := gen_random_uuid();  -- admin, district 1
  ue uuid := gen_random_uuid();  -- editor, district 1
  ub uuid := gen_random_uuid();  -- business manager, district 1
  uv uuid := gen_random_uuid();  -- viewer, district 1
  ux uuid := gen_random_uuid();  -- admin, district 2 (a stranger to district 1)
  uu uuid := gen_random_uuid();  -- invited to district 1 but email never confirmed
  d1 uuid := gen_random_uuid();
  d2 uuid := gen_random_uuid();
  s_locked uuid; s_open uuid; b uuid; acct uuid; r text; cnt int; ok boolean; msg text; j jsonb; amt numeric;
  b_aug uuid; b_sep uuid; fid bigint; cnt2 int;
  zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- ---------- setup (as the database owner) ----------
  insert into public.district (id, slug, name, is_demo) values
    (d1, 'zz-access-test-1', 'Access Test District One', true),
    (d2, 'zz-access-test-2', 'Access Test District Two', true);

  insert into public.invitation (district_id, email, role) values
    (d1, 'hg.admin@example.test', 'admin'), (d1, 'hg.editor@example.test', 'editor'),
    (d1, 'hg.bm@example.test', 'business_manager'), (d1, 'hg.viewer@example.test', 'viewer'),
    (d1, 'hg.unconfirmed@example.test', 'editor');

  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
    (zero, ua, 'authenticated', 'authenticated', 'hg.admin@example.test', now()),
    (zero, ue, 'authenticated', 'authenticated', 'hg.editor@example.test', now()),
    (zero, ub, 'authenticated', 'authenticated', 'hg.bm@example.test', now()),
    (zero, uv, 'authenticated', 'authenticated', 'hg.viewer@example.test', now()),
    (zero, ux, 'authenticated', 'authenticated', 'hg.stranger@example.test', now()),
    (zero, uu, 'authenticated', 'authenticated', 'hg.unconfirmed@example.test', null);

  -- invitation created AFTER the account exists: should apply immediately
  insert into public.invitation (district_id, email, role) values (d2, 'hg.stranger@example.test', 'admin');

  insert into public.initiative (district_id, name) values (d1, 'Test roof, district 1'), (d2, 'Test roof, district 2');
  insert into public.scenario (district_id, name, is_locked) values (d1, 'Locked baseline', true) returning id into s_locked;
  insert into public.scenario (district_id, name) values (d1, 'Working draft') returning id into s_open;

  -- ---------- 1–2 invitations ----------
  select role into r from public.district_member where district_id = d1 and user_id = ua;
  insert into hg_test_results values (1, 'Confirmed invitee becomes a member with the invited role',
    case when r = 'admin' then 'PASS' else 'FAIL' end, coalesce(r, 'no membership'));
  select count(*) into cnt from public.district_member where user_id = uu;
  insert into hg_test_results values (2, 'Unconfirmed email gets no access',
    case when cnt = 0 then 'PASS' else 'FAIL' end, cnt || ' memberships');
  select count(*) into cnt from public.district_member where user_id = ux and district_id = d2;
  insert into hg_test_results values (3, 'Invitation to an existing confirmed account applies at once',
    case when cnt = 1 then 'PASS' else 'FAIL' end, cnt || ' memberships');

  -- ---------- 4–6 editor ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.initiative;
  execute 'reset role';
  insert into hg_test_results values (4, 'Editor sees only their own district''s initiatives',
    case when cnt = 1 then 'PASS' else 'FAIL' end, cnt || ' visible (expected 1)');

  execute 'set local role authenticated';
  begin
    insert into public.initiative (district_id, name) values (d2, 'Sneaky insert');
    ok := false; msg := 'insert into district 2 was allowed';
  exception when insufficient_privilege then ok := true; msg := 'refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (5, 'Editor cannot write to another district',
    case when ok then 'PASS' else 'FAIL' end, msg);

  execute 'set local role authenticated';
  update public.scenario set name = 'Edited' where id = s_locked;
  get diagnostics cnt = row_count;
  begin
    insert into public.phase (district_id, scenario_id, initiative_id, fy, cost)
    select d1, s_locked, id, 2028, 1000 from public.initiative where district_id = d1 limit 1;
    ok := false; msg := 'phase added to locked scenario';
  exception when insufficient_privilege then ok := true; msg := 'refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (6, 'Editor cannot change a locked scenario',
    case when cnt = 0 and ok then 'PASS' else 'FAIL' end, cnt || ' rows renamed; phase: ' || msg);

  execute 'set local role authenticated';
  begin
    update public.scenario set is_board_version = true where id = s_open;
    ok := false; msg := 'editor set the board version';
  exception when insufficient_privilege then ok := true; msg := 'refused';
  end;
  begin
    insert into public.import_batch (district_id, kind, period_end) values (d1, 'gl_monthly', '2026-09-30');
    ok := ok and false; msg := msg || '; editor started a GL import';
  exception when insufficient_privilege then msg := msg || '; GL import refused';
  end;
  begin
    perform public.claim_invitations(ue, 'hg.stranger@example.test');
    ok := ok and false; msg := msg || '; claim_invitations was callable';
  exception when insufficient_privilege then msg := msg || '; claim_invitations refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (7, 'Editor cannot pick the board version, import GL data, or claim others'' invitations',
    case when ok then 'PASS' else 'FAIL' end, msg);

  -- ---------- 8 viewer ----------
  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.initiative;
  begin
    insert into public.initiative (district_id, name) values (d1, 'Viewer insert');
    ok := false; msg := 'viewer insert allowed';
  exception when insufficient_privilege then ok := true; msg := 'insert refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (8, 'Viewer can read but not write',
    case when ok and cnt = 1 then 'PASS' else 'FAIL' end, cnt || ' visible; ' || msg);

  -- ---------- 9 business manager: monthly GL import end to end ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.import_batch (district_id, kind, period_end, fiscal_year, file_name, status)
    values (d1, 'gl_monthly', '2026-09-30', 2027, 'september.csv', 'review') returning id into b;
  insert into public.gl_account (district_id, code, description, account_type, maps_to, mapped_fund, sign, needs_review)
    values (d1, '33-000-0000-000-760', 'SAVE fund balance (test)', 'balance_sheet', 'fund_balance', 'save', -1, false)
    returning id into acct;
  insert into public.gl_amount (district_id, batch_id, account_id, fiscal_year, period_end, ytd_amount)
    values (d1, b, acct, 2027, '2026-09-30', -1234567.89);
  perform public.apply_import(b);
  select amount into amt from public.fund_balance
   where district_id = d1 and fund = 'save' and as_of = '2026-09-30';
  select count(*) into cnt from public.gl_current where district_id = d1;
  execute 'reset role';
  insert into hg_test_results values (9, 'Business manager uploads and applies a monthly GL import; SAVE balance refreshes',
    case when amt = 1234567.89 and cnt = 1 then 'PASS' else 'FAIL' end,
    'SAVE balance ' || coalesce(amt::text, 'missing') || '; ' || cnt || ' current GL rows');

  -- ---------- 10–11 admin: unlock, publish ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.scenario set is_locked = false where id = s_locked;
  get diagnostics cnt = row_count;
  update public.scenario set is_board_version = true where id = s_open;
  insert into public.publication (district_id, kind, title, scenario_id, payload)
    values (d1, 'board_plan', 'Test board plan', s_open, '{"note":"frozen copy"}');
  ok := exists (select 1 from public.audit_log where district_id = d1);
  execute 'reset role';
  insert into hg_test_results values (10, 'Admin can unlock, set the board version, publish, and read the audit log',
    case when cnt = 1 and ok then 'PASS' else 'FAIL' end, cnt || ' unlocked; audit visible: ' || ok);

  -- ---------- 11 stranger ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.district_member where district_id = d1;
  select cnt + count(*) into cnt from public.gl_amount where district_id = d1;
  select cnt + count(*) into cnt from public.audit_log where district_id = d1;
  execute 'reset role';
  insert into hg_test_results values (11, 'Admin of another district sees nothing of district 1',
    case when cnt = 0 then 'PASS' else 'FAIL' end, cnt || ' rows visible');

  -- ---------- 12 anonymous visitor ----------
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    select count(*) into cnt from public.initiative;
    ok := false; msg := 'anonymous read the initiative table';
  exception when insufficient_privilege then ok := true; msg := 'tables refused';
  end;
  j := public.public_publication('zz-access-test-1');
  ok := ok and j is not null and j -> 'payload' ->> 'note' = 'frozen copy';
  ok := ok and public.public_publication('zz-access-test-2') is null;
  execute 'reset role';
  insert into hg_test_results values (12, 'Anonymous visitor sees only the published page',
    case when ok then 'PASS' else 'FAIL' end, msg || '; published page ' || case when j is null then 'missing' else 'returned' end);

  -- ---------- 14–18 check registers and state peer data (part 16) ----------
  -- 14 business manager uploads two register months; September's questions are raised and one is answered
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.import_batch (district_id, kind, period_end, file_name, status)
    values (d1, 'check_register', '2026-08-31', 'august.csv', 'review') returning id into b_aug;
  insert into public.register_line (batch_id, district_id, pay_date, vendor_no, vendor_name, invoice_no, amount, fund, func, obj)
    values (b_aug, d1, '2026-08-12', '1001', 'Hawkeye Builders Supply Inc', 'A-1', 2500, '10', '2600', '611'),
           (b_aug, d1, '2026-08-12', '1002', 'Prairie Energy Coop', 'E-8', 9000, '10', '2600', '622');
  insert into public.import_batch (district_id, kind, period_end, file_name, status)
    values (d1, 'check_register', '2026-09-30', 'september.csv', 'review') returning id into b_sep;
  insert into public.register_line (batch_id, district_id, pay_date, vendor_no, vendor_name, invoice_no, amount, fund, func, obj)
    values (b_sep, d1, '2026-09-10', '1002', 'Prairie Energy Co-op Payments LLC', 'E-9', 9100, '10', '2600', '622'),
           (b_sep, d1, '2026-09-11', '1001', 'Hawkeye Builders Supply Inc', 'A-1', 2500, '10', '2600', '611'),
           (b_sep, d1, '2026-09-14', '1099', 'Quickfix Services', 'Q1', 3000, '10', '2600', '430');
  j := public.register_check(b_sep);
  select id into fid from public.register_flag where batch_id = b_sep and rule = 'duplicate_payment' limit 1;
  update public.register_flag set status = 'explained', response = 'Paid twice; refund requested', resolved_by = ub, resolved_at = now()
   where id = fid;
  get diagnostics cnt = row_count;
  select count(*) into cnt2 from public.register_flag where batch_id = b_sep;
  ok := (j -> 'by_rule' ? 'vendor_name_change') and (j -> 'by_rule' ? 'duplicate_payment') and (j -> 'by_rule' ? 'new_vendor');
  execute 'reset role';
  insert into hg_test_results values (14, 'Business manager uploads registers; questions raised (name change, duplicate, new vendor) and answered',
    case when ok and cnt = 1 and cnt2 >= 3 then 'PASS' else 'FAIL' end, cnt2 || ' questions; ' || coalesce(j ->> 'by_rule', 'none'));

  -- 15 viewer reads the questions but cannot answer, upload, or run the check
  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.register_flag where batch_id = b_sep;
  update public.register_flag set response = 'viewer edit' where batch_id = b_sep;
  get diagnostics cnt2 = row_count;
  ok := true; msg := '';
  begin
    insert into public.register_line (batch_id, district_id, vendor_name, amount) values (b_sep, d1, 'Viewer Co', 1);
    ok := false; msg := 'viewer added a register line';
  exception when insufficient_privilege then msg := 'upload refused';
  end;
  begin
    perform public.register_check(b_sep);
    ok := false; msg := msg || '; viewer ran the check';
  exception when insufficient_privilege then msg := msg || '; check refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (15, 'Viewer reads register questions but cannot answer, upload or run checks',
    case when ok and cnt >= 3 and cnt2 = 0 then 'PASS' else 'FAIL' end, cnt || ' visible; ' || cnt2 || ' answered; ' || msg);

  -- 16 editor cannot start a register upload (financial uploads are business manager / admin)
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.import_batch (district_id, kind, period_end) values (d1, 'check_register', '2026-10-31');
    ok := false; msg := 'editor started a register upload';
  exception when insufficient_privilege then ok := true; msg := 'refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (16, 'Editor cannot upload a check register',
    case when ok then 'PASS' else 'FAIL' end, msg);

  -- 17 stranger and anonymous visitor see no registers and no state data
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.register_line where district_id = d1;
  select cnt + count(*) into cnt from public.register_flag where district_id = d1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  ok := true;
  begin
    select count(*) into cnt2 from public.ia_district; ok := false;
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.ia_benchmark('0009', 2025); ok := false;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  insert into hg_test_results values (17, 'Other districts see no registers; anonymous visitors get no state data',
    case when cnt = 0 and ok then 'PASS' else 'FAIL' end, cnt || ' register rows visible to a stranger; anonymous ' || case when ok then 'refused' else 'allowed' end);

  -- 18 admin links the district to a state district number and picks a peer; members get peer comparisons
  insert into public.ia_district (de_district, name) values ('zz01', 'Access Test State District One'), ('zz02', 'Access Test Peer')
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.district set state_district_id = 'zz01' where id = d1;
  get diagnostics cnt = row_count;
  insert into public.district_peer (district_id, de_district) values (d1, 'zz02');
  perform * from public.ia_benchmark('zz01', 2025, 'Actual', 'custom', d1);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.district_peer (district_id, de_district) values (d1, 'zz01');
    ok := false; msg := 'editor changed peers';
  exception when insufficient_privilege then ok := true; msg := 'editor refused';
  end;
  execute 'reset role';
  insert into hg_test_results values (18, 'Admin links the state district and picks peers; editors cannot change peers',
    case when cnt = 1 and ok then 'PASS' else 'FAIL' end, cnt || ' district linked; ' || msg);
  update public.district set state_district_id = null where id = d1;
  delete from public.district_peer where district_id = d1;
  delete from public.ia_district where de_district in ('zz01', 'zz02');

  -- ---------- clean up ----------
  perform set_config('request.jwt.claims', '', true);
  delete from public.district where id in (d1, d2);
  delete from auth.users where id in (ua, ue, ub, uv, ux, uu);
  delete from public.audit_log where district_id in (d1, d2);
  select count(*) into cnt from public.district where slug like 'zz-access-test-%';
  insert into hg_test_results values (13, 'Test data removed',
    case when cnt = 0 then 'PASS' else 'FAIL' end, cnt || ' test districts left');
end $$;

select n, test, result, detail from hg_test_results order by n;
