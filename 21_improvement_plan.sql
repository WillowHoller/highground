-- HighGround part 21: the improvement plan reports (full plan, academic goals for the CSIP, capital improvement plan)
-- Run after part 20. Safe to run more than once. Changes no data.
--
--   priority.csip_goal          a priority that is one of the district's state CSIP goals (Iowa Administrative Code 281-12.8)
--   district_settings.plan_name the district's own name for its full plan ("District improvement plan" when blank)
--   report_snapshot kind        adds 'improvement_plan': a plan version the board adopted, kept exactly as it was

alter table public.priority add column if not exists csip_goal boolean not null default false;

alter table public.district_settings add column if not exists plan_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'district_settings_plan_name_check') then
    alter table public.district_settings add constraint district_settings_plan_name_check check (length(plan_name) <= 80);
  end if;
end $$;

alter table public.report_snapshot drop constraint if exists report_snapshot_kind_check;
alter table public.report_snapshot add constraint report_snapshot_kind_check
  check (kind in ('board_monthly', 'capital_summary', 'decision_packet', 'strategic_progress', 'improvement_plan'));

-- checks: three rows saying PASS
select 'priorities can be tagged as CSIP goals' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'priority' and column_name = 'csip_goal') then 'PASS' else 'FAIL' end as result
union all
select 'the district can name its plan',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district_settings' and column_name = 'plan_name') then 'PASS' else 'FAIL' end
union all
select 'adopted plan versions can be saved',
       case when pg_get_constraintdef((select oid from pg_constraint where conname = 'report_snapshot_kind_check')) like '%improvement_plan%' then 'PASS' else 'FAIL' end;
