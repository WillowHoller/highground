-- =====================================================================================
-- HighGround database — part 10: tax impact (run once, before uploading the matching app files)
-- Two district settings for the "what it means for taxpayers" figures, and the Iowa rules they use,
-- recorded with their sources. Re-running is safe.
-- =====================================================================================

alter table public.district_settings add column if not exists tax_home_value numeric(14,2) not null default 150000;
alter table public.district_settings add column if not exists ag_value_per_acre numeric(14,2);
do $$ begin
  alter table public.district_settings add constraint tax_home_value_pos check (tax_home_value > 0);
exception when duplicate_object then null; end $$;

insert into public.rule_value (state, key, fy, value, unit, status, source_note, checked_on) values
  ('IA','residential_rollback',2026,0.474316,'share','verified','IDR assessment limitation (AY2024); LSA Fiscal Topics 7 Jan 2026','2026-10-01'),
  ('IA','residential_rollback',2027,0.445345,'share','verified','IDR assessment limitation order Nov 2025 (AY2025), per Iowa League of Cities','2026-10-01'),
  ('IA','ag_rollback',2026,0.738575,'share','verified','IDR assessment limitation (AY2024)','2026-10-01'),
  ('IA','ag_rollback',2027,0.594401,'share','verified','IDR assessment limitation order Nov 2025 (AY2025), per Iowa League of Cities','2026-10-01'),
  ('IA','homestead_credit_value',2027,4850,'dollars of value','verified','Homestead credit equal to tax on $4,850 of value; replaced from AY2026 (IDR)','2026-10-01'),
  ('IA','homestead_exemption_pct',2028,0.10,'share of taxable value','verified','2026 Iowa Acts SF 2472 Div. XX; from AY2026 (FY2028)','2026-10-01'),
  ('IA','homestead_exemption_min',2028,5500,'dollars','verified','SF 2472; IDR guidance','2026-10-01'),
  ('IA','homestead_exemption_max',2028,20000,'dollars','verified','SF 2472; inflation-adjusted after AY2026','2026-10-01'),
  ('IA','senior_homestead_exemption',null,6500,'dollars','verified','65+ exemption, AY2024 and later (Iowa State Association of Assessors)','2026-10-01')
on conflict (state, key, fy) do update
  set value = excluded.value, unit = excluded.unit, status = excluded.status, source_note = excluded.source_note, checked_on = excluded.checked_on;

notify pgrst, 'reload schema';

-- check (should say PASS)
select 'Tax settings and rules are in place' as test,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'district_settings'
                  and column_name in ('tax_home_value', 'ag_value_per_acre')) = 2
             and (select count(*) from public.rule_value where key in ('residential_rollback','ag_rollback') and fy = 2027) = 2
            then 'PASS' else 'FAIL' end as result;
