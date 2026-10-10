-- HighGround part 25: fixes from the 10 Oct 2026 validation (see the HighGround Validation Record)
-- Run after part 24. Safe to run more than once. No data is changed or deleted.
--
-- 1. debt_obligation.first_year_timing: when a mid-year balance date is used, whether this year's payment on existing
--    debt is still to come ('after'), already paid ('before'), or spread across the year ('spread', the old behaviour).
-- 2. recurring_cost: SAVE, PPEL and V-PPEL can't pay salaries, benefits, supplies or activities
--    (Iowa Code 298.3(4); 423F.3). New and changed rows are checked; existing rows are left alone (NOT VALID) so
--    nothing already saved breaks. The app lists any existing ones under "Fund rules" on the capital plan.

alter table public.debt_obligation add column if not exists first_year_timing text not null default 'spread';
do $$ begin
  alter table public.debt_obligation add constraint debt_first_year_timing_ok check (first_year_timing in ('spread', 'after', 'before'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.recurring_cost add constraint recurring_cost_fund_legal check (
    not (fund in ('save', 'ppel', 'vppel') and kind in ('salary', 'benefits', 'supplies', 'activities'))) not valid;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

select 1 as n, 'Debt can say when this year''s payment falls' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'debt_obligation' and column_name = 'first_year_timing')
            then 'PASS' else 'FAIL' end as result
union all
select 2, 'SAVE, PPEL and V-PPEL can''t be set to pay salaries, benefits, supplies or activities',
       case when exists (select 1 from pg_constraint where conname = 'recurring_cost_fund_legal') then 'PASS' else 'FAIL' end
union all
select 3, 'Existing yearly costs that break the fund rules (fix them on the capital plan): ' ||
          (select count(*) from public.recurring_cost where fund in ('save', 'ppel', 'vppel') and kind in ('salary', 'benefits', 'supplies', 'activities'))::text,
       'INFO';
