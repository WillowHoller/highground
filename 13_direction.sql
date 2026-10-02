-- =====================================================================================
-- HighGround database — part 13: automatic measures (run once, before the matching app files)
-- A measure can update itself from HighGround's own data; auto_metric says which.
-- Re-running is safe.
-- =====================================================================================
alter table public.measure add column if not exists auto_metric text;
do $$ begin
  alter table public.measure add constraint measure_auto_metric_chk check (auto_metric is null or auto_metric in
    ('phases_on_budget', 'phases_on_schedule', 'capital_gap', 'save_balance', 'ppel_balance', 'general_balance'));
exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';

-- check (should say PASS)
select 'Measures can update themselves' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'measure' and column_name = 'auto_metric')
            then 'PASS' else 'FAIL' end as result;
