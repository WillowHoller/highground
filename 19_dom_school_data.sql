-- HighGround part 19: more of the state's numbers for setup (Iowa Department of Management + the annual reports)
-- Run after part 18. Safe to run more than once.
--
--   ia_valuation    property valuations by district and fiscal year (taxable and 100%, with TIF and gas & electric
--                   utilities; farmland and homes on their own), from "School District Assessed & Taxable Valuations by Class".
--   ia_aid_levy     each district's Aid and Levy worksheet lines (L101 budget enrollment, L203 district cost per pupil,
--                   L519 combined district cost ...), as one jsonb per district-year, from "Aid and Levy, Tax Certification,
--                   and Program Summary".
--   ia_unspent      the Unspent Authorized Budget report: spending authority, miscellaneous income and the unspent balance.
--   ia_prefill_more(de)  everything the setup screens can fill in beyond part 16's ia_prefill: valuations and growth,
--                   General Fund formula figures, the unspent balance, SAVE trend, ongoing SAVE/PPEL spending, debt
--                   payments, grants by year, General Fund salaries and benefits, and when the V-PPEL started.
--   ia_home_value   median value of owner-occupied homes by school district (Census Bureau, American Community Survey
--                   5-year estimates), for the tax example.
--   ia_reference    statewide or national reference figures, one row each: 'construction_inflation' (the Bureau of Labor
--                   Statistics producer price index for new school building construction).
-- Filled by loader/load_iowa_dom.py and loader/load_reference.py (the same monthly GitHub workflow). Nothing here is saved to a district by itself:
-- the app shows the figures and fills the form only when someone asks.

create table if not exists public.ia_valuation (
  de_district   text not null,
  fiscal_year   int  not null,                   -- the budget year the valuation is for (January 1 two years before)
  taxable       numeric(16,0),                   -- taxable, non-TIF, with gas & electric utilities
  taxable_tif   numeric(16,0),                   -- taxable TIF increment (debt service and PPEL are levied on it too)
  assessed      numeric(16,0),                   -- 100% (before rollback), non-TIF, with gas & electric utilities
  assessed_tif  numeric(16,0),
  ag_assessed   numeric(16,0),                   -- farmland (ag land), non-TIF + TIF
  ag_taxable    numeric(16,0),
  res_assessed  numeric(16,0),                   -- residential, non-TIF + TIF
  res_taxable   numeric(16,0),
  source_file   text,
  loaded_at     timestamptz not null default now(),
  primary key (de_district, fiscal_year)
);

create table if not exists public.ia_aid_levy (
  de_district   text not null,
  fiscal_year   int  not null,
  lines         jsonb not null,                  -- {"L101": 692.6, "L203": 8218, ...}
  source_file   text,
  loaded_at     timestamptz not null default now(),
  primary key (de_district, fiscal_year)
);

create table if not exists public.ia_unspent (
  de_district        text not null,
  fiscal_year        int  not null,
  max_district_cost  numeric(16,0),
  misc_income        numeric(16,0),              -- "Other Miscellaneous Income"
  expenditures       numeric(16,0),              -- 0 until the year has closed
  max_authorized     numeric(16,0),
  unspent            numeric(16,0),              -- "Unspent Authorized Budget"
  source_file        text,
  loaded_at          timestamptz not null default now(),
  primary key (de_district, fiscal_year)
);

create table if not exists public.ia_home_value (
  de_district   text not null primary key,
  acs_year      int  not null,                   -- the last year of the 5-year estimate (2024 = 2020-2024)
  median_value  numeric(12,0),
  margin        numeric(12,0),                   -- the Census Bureau's margin of error (90%)
  census_name   text,
  source        text,
  loaded_at     timestamptz not null default now()
);

create table if not exists public.ia_reference (
  key        text primary key,                   -- 'construction_inflation'
  value      numeric,                            -- a rate as a fraction (0.031 = 3.1% a year)
  detail     jsonb,
  source     text,
  loaded_at  timestamptz not null default now()
);

-- one district's annual-report rows, fast (the setup pre-fill reads them)
create index if not exists ia_fin_district on public.ia_fin (de_district, status, fiscal_year);

do $$ declare t text; begin
  foreach t in array array['ia_valuation','ia_aid_levy','ia_unspent','ia_home_value','ia_reference'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "signed in read" on public.%I', t);
    execute format('create policy "signed in read" on public.%I for select to authenticated using (true)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ the extra pre-fill
create or replace function public.ia_prefill_more(p_de text)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  out jsonb := jsonb_build_object('de_district', p_de);
  v record; v0 record; al record; un record; un0 record; n int;
  car_fy int; x jsonb;
begin
  -- valuations: latest year, growth over up to four years, and this district's own rollbacks
  select * into v from ia_valuation where de_district = p_de order by fiscal_year desc limit 1;
  if found then
    select * into v0 from ia_valuation where de_district = p_de and fiscal_year >= v.fiscal_year - 4
      order by fiscal_year limit 1;
    n := v.fiscal_year - v0.fiscal_year;
    out := out || jsonb_build_object('valuation', jsonb_build_object(
      'fiscal_year', v.fiscal_year,
      'taxable', coalesce(v.taxable, 0) + coalesce(v.taxable_tif, 0),
      'actual', coalesce(v.assessed, 0) + coalesce(v.assessed_tif, 0),
      'growth', case when n > 0 and coalesce(v0.taxable, 0) + coalesce(v0.taxable_tif, 0) > 0
                     then round((power((coalesce(v.taxable, 0) + coalesce(v.taxable_tif, 0))
                                / (coalesce(v0.taxable, 0) + coalesce(v0.taxable_tif, 0)), 1.0 / n) - 1)::numeric, 4) end,
      'growth_years', n,
      'ag_rollback', case when v.ag_assessed > 0 then round(v.ag_taxable / v.ag_assessed, 6) end,
      'res_rollback', case when v.res_assessed > 0 then round(v.res_taxable / v.res_assessed, 6) end,
      'source', 'Iowa Department of Management, School District Assessed & Taxable Valuations by Class, FY' || v.fiscal_year));
  end if;

  -- the Aid and Levy worksheet: General Fund formula figures for the budget year
  select * into al from ia_aid_levy where de_district = p_de order by fiscal_year desc limit 1;
  if found then
    out := out || jsonb_build_object('aid_levy', jsonb_build_object(
      'fiscal_year', al.fiscal_year,
      'budget_enrollment', (al.lines->>'L101')::numeric,
      'dcpp', (al.lines->>'L203')::numeric,
      'regular_cost', (al.lines->>'L403')::numeric,
      'combined_cost', (al.lines->>'L519')::numeric,
      'other_formula', round((al.lines->>'L519')::numeric - (al.lines->>'L101')::numeric * (al.lines->>'L203')::numeric),
      'vppel_max', (al.lines->>'L1903')::numeric,
      'source', 'Iowa Department of Management, Aid and Levy worksheet, FY' || al.fiscal_year));
  end if;

  -- unspent balance and miscellaneous income: the latest year that has closed
  select * into un from ia_unspent where de_district = p_de and coalesce(expenditures, 0) > 0
    order by fiscal_year desc limit 1;
  if found then
    select * into un0 from ia_unspent where de_district = p_de and coalesce(expenditures, 0) > 0
      and fiscal_year = un.fiscal_year - 3;
    out := out || jsonb_build_object('unspent', jsonb_build_object(
      'fiscal_year', un.fiscal_year, 'unspent', un.unspent, 'max_authorized', un.max_authorized,
      'misc_income', un.misc_income,
      'misc_growth', case when un0.misc_income > 0 and un.misc_income > 0
                          then round((power(un.misc_income / un0.misc_income, 1.0 / 3) - 1)::numeric, 4) end,
      'source', 'Iowa Department of Management, Unspent Authorized Budget report, FY' || un.fiscal_year));
  end if;

  -- the annual reports (Actual): capital funds, debt, grants, SAVE history, General Fund salaries
  select max(fiscal_year) into car_fy from ia_fin where de_district = p_de and status = 'Actual';
  if car_fy is not null then
    with f as (
      select x.kind, x.fiscal_year fy, d.fund, d.line, x.column_name cn, x.amount,
             case when d.fund ilike '%SAVE%' then 'save'
                  when d.fund ilike '%PPEL%' or d.fund ilike '%physical plant%' then 'ppel'
                  when d.fund ilike '%debt service%' then 'debt'
                  when d.fund ilike '%capital%' then 'capital'
                  when d.fund ilike 'general%' then 'general' end as grp,
             ia_line_role(x.kind, d.line) as role
      from ia_fin x join ia_fin_line_def d on d.kind = x.kind and d.column_name = x.column_name
      where x.de_district = p_de and x.status = 'Actual'
    ),
    cap as (   -- SAVE and PPEL spending by year, split into what recurs and what doesn't
      select grp, fy,
             sum(amount) total,
             sum(amount) filter (where line ilike 'Facilities Acquisition%') construction,
             sum(amount) filter (where line ilike 'Debt Service%') debt,
             sum(amount) filter (where line ilike 'Transfers Out%') transfers
      from f where kind = 'exp' and role <> 'balance' and grp in ('save', 'ppel', 'debt')
      group by grp, fy
    ),
    rec as (
      select grp, count(*) years, min(fy) from_fy, max(fy) to_fy,
             round(avg(total - coalesce(construction, 0) - coalesce(debt, 0) - coalesce(transfers, 0))) recurring,
             round(avg(coalesce(construction, 0))) construction
      from cap where grp in ('save', 'ppel') and fy > car_fy - 3 group by grp
    ),
    debt as (
      select grp, round(coalesce(sum(case when grp = 'debt' then total - coalesce(transfers, 0) else debt end), 0)) amount
      from cap where fy = car_fy group by grp
    ),
    gr as (
      select fy, round(sum(amount)) amount from f
      where kind = 'rev' and grp in ('save', 'ppel', 'capital')
        and line in ('Other Revenues from Local Sources', 'Federal Sources', 'Other State Sources', 'Revenue from Intermediary Sources')
      group by fy
    ),
    sv as (
      select fy, round(sum(amount)) amount from f
      where kind = 'rev' and grp = 'save' and line ilike 'Statewide Sales%' group by fy
    ),
    gf as (
      select
        round(sum(amount) filter (where cn like 'car:General:%:Salaries')) salaries,
        round(sum(amount) filter (where cn like 'car:General:%:Benefits')) benefits,
        round(sum(amount) filter (where cn like 'car:General:Instruction:Salaries')) sal_instruction,
        round(sum(amount) filter (where cn like 'car:General:%:Salaries' and line in
          ('General Administration', 'School/Building Administration', 'Business & Central Administration'))) sal_admin,
        round(sum(amount) filter (where kind = 'exp' and role = 'flow')) spending,
        round(sum(amount) filter (where kind = 'exp' and line ilike 'Transfers Out%')) transfers,
        round(sum(amount) filter (where kind = 'exp' and line ilike 'AEA Support%')) aea
      from f where grp = 'general' and fy = car_fy
    )
    select jsonb_build_object(
      'fiscal_year', car_fy,
      'source', 'Iowa Department of Education, Certified Annual Report (Actual), FY2017 on',
      'ongoing', (select coalesce(jsonb_object_agg(grp, jsonb_build_object('recurring', recurring, 'construction', construction,
                    'years', years, 'from_fy', from_fy, 'to_fy', to_fy)), '{}') from rec),
      'debt_payments', (select coalesce(jsonb_object_agg(grp, amount), '{}') from debt where amount > 0),
      'grants', (select coalesce(jsonb_agg(jsonb_build_object('fy', fy, 'amount', amount) order by fy), '[]')
                 from (select * from gr order by fy desc limit 10) g),
      'save_receipts', (select coalesce(jsonb_agg(jsonb_build_object('fy', fy, 'amount', amount) order by fy), '[]')
                        from (select * from sv order by fy desc limit 6) s),
      'general', (select jsonb_build_object('salaries', salaries, 'benefits', benefits,
                    'benefits_pct', case when salaries > 0 then round(benefits / salaries, 4) end,
                    'sal_instruction', sal_instruction, 'sal_admin', sal_admin,
                    'sal_support', salaries - coalesce(sal_instruction, 0) - coalesce(sal_admin, 0),
                    'nonstaff', spending - coalesce(salaries, 0) - coalesce(benefits, 0) - coalesce(transfers, 0)) from gf)
    ) into x;
    out := out || jsonb_build_object('car', x);
  end if;

  -- when the voter-approved PPEL started: the first year of the current unbroken run of voted rates
  with r as (select fiscal_year fy from ia_levy_rate where de_district = p_de and voted_ppel > 0),
  run as (select fy, fy - row_number() over (order by fy) g from r),
  last_run as (select min(fy) first_fy, max(fy) last_fy from run where g = (select g from run order by fy desc limit 1))
  select jsonb_build_object('first_fy', first_fy, 'last_fy', last_fy,
           'from_start_of_data', first_fy = (select min(fiscal_year) from ia_levy_rate))
    into x from last_run where first_fy is not null;
  if x is not null then out := out || jsonb_build_object('vppel', x); end if;

  -- the tax example's home: the median value of owner-occupied homes in the district
  select jsonb_build_object('median_value', median_value, 'margin', margin, 'acs_year', acs_year,
           'source', source) into x from ia_home_value where de_district = p_de;
  if x is not null then out := out || jsonb_build_object('home_value', x); end if;

  -- construction prices (national): the same for every district
  select jsonb_build_object('value', value, 'detail', detail, 'source', source) into x
    from ia_reference where key = 'construction_inflation';
  if x is not null then out := out || jsonb_build_object('construction_inflation', x); end if;

  return out;
end $$;
revoke all on function public.ia_prefill_more(text) from public, anon;
grant execute on function public.ia_prefill_more(text) to authenticated;

notify pgrst, 'reload schema';

-- checks (all rows should say PASS)
select 1 as n, 'Valuation, Aid and Levy, unspent, home value and reference tables are in place, signed-in read only' as test,
       case when to_regclass('public.ia_valuation') is not null and to_regclass('public.ia_aid_levy') is not null
             and to_regclass('public.ia_unspent') is not null and to_regclass('public.ia_home_value') is not null
             and to_regclass('public.ia_reference') is not null
             and not has_table_privilege('anon', 'public.ia_home_value', 'select')
             and not has_table_privilege('anon', 'public.ia_reference', 'select')
             and not has_table_privilege('anon', 'public.ia_valuation', 'select')
             and not has_table_privilege('anon', 'public.ia_aid_levy', 'select')
             and not has_table_privilege('anon', 'public.ia_unspent', 'select') then 'PASS' else 'FAIL' end as result
union all
select 2, 'Anonymous visitors cannot call ia_prefill_more',
       case when not has_function_privilege('anon', 'public.ia_prefill_more(text)', 'execute') then 'PASS' else 'FAIL' end
union all
select 3, 'ia_prefill_more answers for a district with no data yet',
       case when public.ia_prefill_more('0000') ->> 'de_district' = '0000' then 'PASS' else 'FAIL' end;
