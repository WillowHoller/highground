-- =====================================================================================
-- HighGround database — part 14: the General Fund forecast (run once, before the matching app files)
-- Each district's General Fund starting figures (enrollment, cost per pupil, staff by group, balances),
-- and the Iowa figures the forecast uses, recorded with their sources. Re-running is safe.
-- =====================================================================================
alter table public.district_settings add column if not exists gf_inputs jsonb;

insert into public.rule_value (state, key, fy, value, unit, status, source_note, checked_on) values
  ('IA','state_cost_per_pupil',2026,7988,'dollars','verified','LSA fiscal note SF 2201 (FY2026 base)','2026-10-01'),
  ('IA','state_cost_per_pupil',2027,8148,'dollars','verified','2026 Iowa Acts SF 2201, signed 26 Feb 2026','2026-10-01'),
  ('IA','state_supplemental_aid',2027,0.02,'share','verified','2026 Iowa Acts SF 2201 (2% SSA)','2026-10-01'),
  ('IA','budget_guarantee',null,1.01,'share of prior year','verified','Regular program budget adjustment (101%); state paid it in FY2027 under SF 2201','2026-10-01')
on conflict (state, key, fy) do update
  set value = excluded.value, unit = excluded.unit, status = excluded.status, source_note = excluded.source_note, checked_on = excluded.checked_on;
notify pgrst, 'reload schema';

-- check (should say PASS)
select 'General Fund figures and rules are in place' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district_settings' and column_name = 'gf_inputs')
             and exists (select 1 from public.rule_value where key = 'state_cost_per_pupil' and fy = 2027)
            then 'PASS' else 'FAIL' end as result;
