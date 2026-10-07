-- HighGround part 17: property tax levy rates by district (Iowa Department of Management)
-- Run after part 16. Safe to run more than once.
--
--   ia_levy_rate   one row per district number and fiscal year: the rates per $1,000 of taxable valuation
--                  for each levy, from the Department of Management's "School Tax Rates, FY ____" files.
--                  Filled by loader/load_iowa_levy.py (the same monthly GitHub workflow as the annual reports).
--   ia_levy(de)    the latest year for one district, for the Starting numbers screen: whether it has a
--                  voter-approved PPEL, and its regular PPEL, debt service and management rates.

create table if not exists public.ia_levy_rate (
  de_district     text not null,                 -- the Department of Education's 4-digit number
  fiscal_year     int  not null,
  district_name   text,                           -- as the file spells it
  general_rate    numeric(10,5),                  -- total General Fund levy
  instr_support   numeric(10,5),
  management      numeric(10,5),
  voted_ppel      numeric(10,5),                  -- voter-approved PPEL (up to $1.34)
  regular_ppel    numeric(10,5),                  -- board-approved PPEL (up to $0.33)
  debt_service    numeric(10,5),
  playground      numeric(10,5),
  total_rate      numeric(10,5),
  total_levy      numeric(16,2),                  -- dollars levied, all levies
  source_file     text,
  loaded_at       timestamptz not null default now(),
  primary key (de_district, fiscal_year)
);

alter table public.ia_levy_rate enable row level security;
drop policy if exists "signed in read" on public.ia_levy_rate;
create policy "signed in read" on public.ia_levy_rate for select to authenticated using (true);
revoke all on public.ia_levy_rate from anon;
grant select on public.ia_levy_rate to authenticated;

create or replace function public.ia_levy(p_de text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'de_district', de_district, 'fiscal_year', fiscal_year,
    'voted_ppel', voted_ppel, 'regular_ppel', regular_ppel, 'debt_service', debt_service,
    'management', management, 'total_rate', total_rate,
    'source', 'Iowa Department of Management, School Tax Rates, FY' || fiscal_year)
  from ia_levy_rate where de_district = p_de
  order by fiscal_year desc limit 1
$$;
revoke all on function public.ia_levy(text) from public, anon;
grant execute on function public.ia_levy(text) to authenticated;

notify pgrst, 'reload schema';

-- checks (both rows should say PASS)
select 1 as n, 'Levy rates table is in place, signed-in read only' as test,
       case when to_regclass('public.ia_levy_rate') is not null
             and not has_table_privilege('anon', 'public.ia_levy_rate', 'select') then 'PASS' else 'FAIL' end as result
union all
select 2, 'Anonymous visitors cannot call ia_levy',
       case when not has_function_privilege('anon', 'public.ia_levy(text)', 'execute') then 'PASS' else 'FAIL' end;
