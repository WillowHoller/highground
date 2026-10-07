-- HighGround part 20: daily health checks
-- Run after part 19. Safe to run more than once.
--
--   hg_health_check()  one row per check: area, check, status ('ok' | 'warn' | 'fail'), detail. Read-only. Called once a
--                      day by the "Daily health check" GitHub workflow (loader/health_check.py) over DATABASE_URL; nobody
--                      signed in to the app can call it.
--   hg_health_run      one row per daily run: overall status and every check, so Willow Holler staff can see the latest
--                      result in the app (Willow Holler page → System health). Only staff can read it.
--
-- What "ok" means:
--   structure  every table has its access rules on; signed-out visitors can read nothing; the functions the app needs exist
--   data       the monthly public-data workflow finished in the last 35 days and nothing in it failed; each source has
--              the years it should have by now
--   ties       numbers from different state files agree (regular and voted PPEL dollars = rate × valuation; the valuation
--              file = the Aid and Levy worksheet, lines 6.1 and 15.18), and every district's own plan data is consistent
--   people     there is at least one Willow Holler staff member, and no district is left without an admin

create table if not exists public.hg_health_run (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  status      text not null check (status in ('ok', 'warn', 'fail')),
  n_ok        int, n_warn int, n_fail int,
  checks      jsonb,                         -- [{area, check, status, detail}]
  emailed     boolean not null default false
);
alter table public.hg_health_run enable row level security;
drop policy if exists "staff read" on public.hg_health_run;
create policy "staff read" on public.hg_health_run for select to authenticated using (public.is_platform_admin());
revoke all on public.hg_health_run from anon;
grant select on public.hg_health_run to authenticated;

create or replace function public.hg_health_check()
returns table (area text, check_name text, status text, detail text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  cur_fy int := extract(year from now())::int + case when extract(month from now()) >= 7 then 1 else 0 end;
  m int := extract(month from now())::int;
  n int; n2 int; t text; fy int;
begin
  -- ------------------------------------------------------------ structure
  select count(*), string_agg(c.relname, ', ') into n, t from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  return query select 'structure', 'Every table has its access rules on', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'all tables' else 'no access rules: ' || t end;

  select count(*), string_agg(c.relname, ', ') into n, t from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select');
  return query select 'structure', 'Signed-out visitors can read no table', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'none readable' else 'readable without signing in: ' || t end;

  select count(*), string_agg(f, ', ') into n, t from unnest(array['ia_prefill', 'ia_levy', 'ia_prefill_more', 'ia_district_search',
      'is_member', 'is_platform_admin', 'copy_scenario', 'ia_refresh_measures']) f
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = f);
  return query select 'structure', 'The functions the app needs exist', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'all present' else 'missing: ' || t end;

  -- ------------------------------------------------------------ data pulls
  select max(loaded_at) into t from ia_load_run where kind = 'workflow_ok';
  return query select 'data', 'The monthly public-data workflow finished recently',
    case when t is null then 'warn' when t::timestamptz > now() - interval '35 days' then 'ok' else 'fail' end,
    coalesce('last finished ' || to_char(t::timestamptz, 'YYYY-MM-DD'), 'no finished run recorded yet (it records one from this update on)');

  select count(*), string_agg(kind || ' (' || coalesce(message, status) || ')', '; ') into n, t from ia_load_run
   where loaded_at > now() - interval '35 days' and status <> 'ok';
  return query select 'data', 'No data load failed in the last 35 days', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'none failed' else t end;

  select count(*) into n from ia_district;
  return query select 'data', 'Iowa districts loaded', case when n >= 300 then 'ok' else 'fail' end, n || ' districts (Iowa has about 325)';

  select max(fiscal_year) into fy from ia_fin where status = 'Actual';
  return query select 'data', 'State annual reports are current',
    case when fy is null then 'fail' when fy >= cur_fy - 2 then 'ok' else 'warn' end,
    coalesce('latest year FY' || fy, 'none loaded') || ' (expected FY' || (cur_fy - 2) || ' or later)';

  select count(*) into n from ia_measure;
  select count(distinct fiscal_year) into n2 from ia_measure where fiscal_year = fy;
  return query select 'data', 'Peer comparison numbers are refreshed', case when n > 0 and n2 = 1 then 'ok' else 'fail' end,
    n || ' figures; latest year ' || case when n2 = 1 then 'included' else 'missing' end;

  select max(fiscal_year) into fy from ia_levy_rate;
  return query select 'data', 'Tax rates are current',
    case when fy is null then 'fail' when fy >= cur_fy or (fy = cur_fy - 1 and m between 7 and 8) then 'ok' else 'warn' end,
    coalesce('latest FY' || fy, 'none loaded') || ' (the state publishes each year''s in early summer)';

  select max(fiscal_year) into fy from ia_valuation;
  return query select 'data', 'Property valuations are current',
    case when fy is null then 'warn' when fy >= cur_fy or (fy = cur_fy - 1 and m between 7 and 8) then 'ok' else 'warn' end,
    coalesce('latest FY' || fy, 'none loaded yet');

  select max(fiscal_year) into fy from ia_aid_levy;
  return query select 'data', 'Aid and Levy worksheets are current',
    case when fy is null then 'warn' when fy >= cur_fy or (fy = cur_fy - 1 and m between 7 and 8) then 'ok' else 'warn' end,
    coalesce('latest FY' || fy, 'none loaded yet');

  select max(fiscal_year) into fy from ia_unspent where coalesce(expenditures, 0) > 0;
  return query select 'data', 'Unspent balance report is current',
    case when fy is null then 'warn' when fy >= cur_fy - 2 then 'ok' else 'warn' end, coalesce('latest closed year FY' || fy, 'none loaded yet');

  select count(*) into n from ia_home_value;
  return query select 'data', 'Median home values loaded', case when n >= 250 then 'ok' else 'warn' end,
    n || ' districts' || case when n = 0 then ' (needs the CENSUS_API_KEY secret)' else '' end;

  select max(loaded_at) into t from ia_reference where key = 'construction_inflation';
  return query select 'data', 'Construction prices refreshed',
    case when t is null then 'warn' when t::timestamptz > now() - interval '40 days' then 'ok' else 'warn' end,
    coalesce('last refreshed ' || to_char(t::timestamptz, 'YYYY-MM-DD'), 'not loaded yet');

  -- ------------------------------------------------------------ ties between independent sources
  select max(fiscal_year) into fy from ia_aid_levy;
  if fy is not null then
    -- voted PPEL: the levy file's rate × the valuation file's taxable valuation (with TIF) = the Aid and Levy worksheet's voted PPEL levy
    with x as (
      select r.de_district, r.voted_ppel * (v.taxable + coalesce(v.taxable_tif, 0)) / 1000 calc, (a.lines->>'L1909')::numeric stated
      from ia_levy_rate r join ia_valuation v using (de_district, fiscal_year) join ia_aid_levy a using (de_district, fiscal_year)
      where r.fiscal_year = fy and r.voted_ppel > 0 and a.lines ? 'L1909')
    select count(*), count(*) filter (where abs(calc - stated) > greatest(0.03 * stated, 1000)),
           string_agg(de_district, ', ') filter (where abs(calc - stated) > greatest(0.03 * stated, 1000))
      into n, n2, t from x;
    return query select 'ties', 'Voted PPEL: rate × valuation = the levy on the Aid and Levy worksheet (FY' || fy || ')',
      case when n = 0 then 'warn' when n2 <= greatest(2, n / 50) then 'ok' else 'fail' end,
      case when n = 0 then 'nothing to compare yet' else n2 || ' of ' || n || ' districts off by more than 3%' || coalesce(': ' || left(t, 120), '') end;

    -- regular PPEL the same way (worksheet line 21.3, dollars)
    with x as (
      select r.de_district, r.regular_ppel * (v.taxable + coalesce(v.taxable_tif, 0)) / 1000 calc, (a.lines->>'L2103')::numeric stated
      from ia_levy_rate r join ia_valuation v using (de_district, fiscal_year) join ia_aid_levy a using (de_district, fiscal_year)
      where r.fiscal_year = fy and r.regular_ppel > 0 and a.lines ? 'L2103')
    select count(*), count(*) filter (where abs(calc - stated) > greatest(0.03 * stated, 1000)),
           string_agg(de_district, ', ') filter (where abs(calc - stated) > greatest(0.03 * stated, 1000))
      into n, n2, t from x;
    return query select 'ties', 'Regular PPEL: rate × valuation = the levy on the Aid and Levy worksheet (FY' || fy || ')',
      case when n = 0 then 'warn' when n2 <= greatest(2, n / 50) then 'ok' else 'fail' end,
      case when n = 0 then 'nothing to compare yet' else n2 || ' of ' || n || ' districts off by more than 3%' || coalesce(': ' || left(t, 120), '') end;

    -- valuation: the valuation file's taxable (with utilities) = the worksheet's line 6.1 (non-TIF) and 15.18 (with TIF)
    with x as (
      select v.de_district, v.taxable a, (al.lines->>'L601')::numeric b
      from ia_valuation v join ia_aid_levy al using (de_district, fiscal_year) where v.fiscal_year = fy and al.lines ? 'L601'
      union all
      select v.de_district, v.taxable + coalesce(v.taxable_tif, 0), (al.lines->>'L1518')::numeric
      from ia_valuation v join ia_aid_levy al using (de_district, fiscal_year) where v.fiscal_year = fy and al.lines ? 'L1518')
    select count(*), count(*) filter (where abs(a - b) > 0.005 * b), string_agg(de_district, ', ') filter (where abs(a - b) > 0.005 * b)
      into n, n2, t from x;
    return query select 'ties', 'Taxable valuation: the valuation file = the Aid and Levy worksheet (FY' || fy || ')',
      case when n = 0 then 'warn' when n2 <= greatest(2, n / 50) then 'ok' else 'fail' end,
      case when n = 0 then 'nothing to compare yet' else n2 || ' of ' || n || ' comparisons differ by more than 0.5%' || coalesce(': ' || left(t, 120), '') end;
  end if;

  -- SAVE reaches every district: a district with no SAVE revenue in the latest annual report usually means a parsing problem
  select max(fiscal_year) into fy from ia_fin where status = 'Actual';
  if fy is not null then
    select count(*), count(*) filter (where s.amount is null or s.amount <= 0) into n, n2
      from (select distinct de_district from ia_fin where status = 'Actual' and fiscal_year = fy) d
      left join ia_measure s on s.de_district = d.de_district and s.fiscal_year = fy and s.status = 'Actual' and s.measure_key = 'rev|SAVE|TOTAL';
    return query select 'ties', 'Every district has SAVE revenue in the latest annual report (FY' || fy || ')',
      case when n2 <= greatest(3, n / 100) then 'ok' else 'fail' end, n2 || ' of ' || n || ' without';
  end if;

  -- each district's own plan
  select count(*), string_agg(distinct d.name, ', ') into n, t from (
    select f.phase_id, f.district_id, sum(f.pct) s from phase_funding f group by 1, 2 having abs(sum(f.pct) - 100) > 0.5) b
    join district d on d.id = b.district_id;
  return query select 'ties', 'Every project phase’s funding adds to 100%', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'all phases' else n || ' phases, in ' || left(t, 160) end;

  select count(*), string_agg(d.name, ', ') into n, t from (select district_id from scenario where is_board_version
    group by 1 having count(*) > 1) b join district d on d.id = b.district_id;
  return query select 'ties', 'At most one board version per district', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'ok' else t end;

  select count(*), string_agg(distinct d.name, ', ') into n, t from phase p join scenario s on s.id = p.scenario_id
    join district d on d.id = p.district_id where s.district_id <> p.district_id;
  return query select 'ties', 'Every phase belongs to its own district’s scenario', case when n = 0 then 'ok' else 'fail' end,
    case when n = 0 then 'ok' else n || ' phases in ' || left(t, 160) end;

  select count(*), string_agg(distinct d.name, ', ') into n, t from fund_balance b join district d on d.id = b.district_id where b.amount < 0;
  return query select 'ties', 'No negative fund balances entered', case when n = 0 then 'ok' else 'warn' end,
    case when n = 0 then 'ok' else n || ' in ' || left(t, 160) end;

  select count(*), string_agg(d.name, ', ') into n, t from district_settings s join district d on d.id = s.district_id
    where s.plan_start_fy is null or s.plan_years is null;
  return query select 'ties', 'Every district with starting numbers has a plan start and length', case when n = 0 then 'ok' else 'warn' end,
    case when n = 0 then 'ok' else t end;

  select count(*), string_agg(d.name, ', ') into n, t from district d
    where not d.is_demo and d.state_district_id is not null and not exists (select 1 from ia_district i where i.de_district = d.state_district_id);
  return query select 'ties', 'Every district’s Iowa number is in the state’s data', case when n = 0 then 'ok' else 'warn' end,
    case when n = 0 then 'ok' else t end;

  -- the setup pre-fill answers, and quickly
  select de_district into t from ia_district order by de_district limit 1;
  if t is not null then
    declare t0 timestamptz := clock_timestamp(); j jsonb; ms int;
    begin
      j := ia_prefill_more(t) || coalesce(ia_prefill(t), '{}'::jsonb);
      ms := extract(milliseconds from clock_timestamp() - t0)::int;
      return query select 'ties', 'The setup pre-fill answers', case when j ? 'de_district' and ms < 3000 then 'ok' when j ? 'de_district' then 'warn' else 'fail' end,
        'district ' || t || ' in ' || ms || ' ms';
    exception when others then
      return query select 'ties', 'The setup pre-fill answers', 'fail', sqlerrm;
    end;
  end if;

  -- ------------------------------------------------------------ people
  select count(*) into n from platform_admin;
  return query select 'people', 'At least one Willow Holler staff member', case when n > 0 then 'ok' else 'fail' end, n || ' staff';

  select count(*), string_agg(d.name, ', ') into n, t from district d
    where not d.is_demo and not exists (select 1 from district_member m where m.district_id = d.id and m.role = 'admin');
  return query select 'people', 'Every district has an admin', case when n = 0 then 'ok' else 'warn' end, case when n = 0 then 'ok' else t end;
end $$;
revoke all on function public.hg_health_check() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- checks (both rows should say PASS)
select 1 as n, 'Health check function and run log are in place; the app can''t call the check' as test,
       case when to_regprocedure('public.hg_health_check()') is not null and to_regclass('public.hg_health_run') is not null
             and not has_function_privilege('authenticated', 'public.hg_health_check()', 'execute')
             and not has_function_privilege('anon', 'public.hg_health_check()', 'execute')
             and not has_table_privilege('anon', 'public.hg_health_run', 'select') then 'PASS' else 'FAIL' end as result
union all
select 2, 'The health check runs', case when (select count(*) from public.hg_health_check()) >= 20 then 'PASS' else 'FAIL' end;
