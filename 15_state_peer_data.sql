-- =====================================================================================
-- HighGround database — part 15: Iowa public school finance data for peer comparisons
-- (run once, before 16). Re-running is safe.
--
-- Tables the GitHub workflow "Iowa public data" fills each month (loader/load_iowa_car.py):
--   ia_district, ia_district_year (certified enrollment, size band), ia_fin (spending, revenue,
--   fund balance by fund / function / object), ia_fin_line_def, ia_measure (per-pupil measures),
--   ia_load_run (load log), staging tables ia_stage and ia_enroll_stage.
-- Sources: Iowa DE Certified Annual Report data files (FY2019 on) and certified enrollment;
--   Iowa Data Hub for FY2017–2018. Signed-in users can read it; part 16 sets the access rules.
-- This is the same setup that was applied to the live project on 6–7 Oct 2026 as three files
-- (2026-10-06_public_data_and_register_checks.sql Part A, 2026-10-07_state_annual_reports.sql,
-- 2026-10-07b_exclude_internal_funds.sql), combined, without the parts that part 16 replaces.
-- =====================================================================================
-- Supabase keeps extensions in the 'extensions' schema; functions below search it explicitly.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;   -- Supabase already does this; harmless if so

-- =====================================================================================
-- PART A. Iowa Data Hub
-- =====================================================================================

-- One row per district, keyed by the Iowa Department of Education district number.
-- VERIFIED: both Data Hub files carry de_district ('0009' = AGWSR), dom_district and aea.
create table if not exists public.ia_district (
  de_district   text primary key,              -- 4-digit DE district number, kept as text ('0009')
  dom_district  text,
  aea           text,
  name          text not null,
  first_fy      int,
  last_fy       int,
  updated_at    timestamptz not null default now()
);

-- What each source column means. column_name is the Data Hub's own key (e.g. 'geninstr').
create table if not exists public.ia_fin_line_def (
  kind        text not null check (kind in ('exp','rev')),
  column_name text not null,
  fund        text not null,                   -- 'General', 'Management', 'Debt Service', ...
  line        text not null,                   -- function (exp) or revenue source (rev)
  primary key (kind, column_name)
);

-- Enrollment band and size for each district-year-version.
create table if not exists public.ia_district_year (
  de_district  text not null references public.ia_district(de_district),
  fiscal_year  int  not null,
  status       text not null check (status in ('Actual','ReEstimated','Budget')),
  enrollment_category        text,
  enrollment_category_number int,              -- 1 = smallest ... 6 = largest (state's banding)
  enrollment   numeric,                        -- INFERRED: median of amount / per-pupil on the larger lines
  primary key (de_district, fiscal_year, status)
);

-- The numbers. Zero rows are not stored (about half the file is zeros); missing = 0.
create table if not exists public.ia_fin (
  kind        text not null check (kind in ('exp','rev')),
  de_district text not null references public.ia_district(de_district),
  fiscal_year int  not null,
  status      text not null check (status in ('Actual','ReEstimated','Budget')),
  column_name text not null,
  amount      numeric not null,
  per_pupil   numeric,
  primary key (kind, de_district, fiscal_year, status, column_name)
);
create index if not exists ia_fin_year on public.ia_fin (fiscal_year, status, kind);

-- Loader writes raw rows here, then calls ia_publish() which swaps them in, in one transaction.
create table if not exists public.ia_stage (
  kind text, fiscal_year int, status text, aea text, dom_district text, de_district text,
  district_name text, column_name text, fund text, line text, amount numeric, per_pupil numeric,
  enrollment_category text, enrollment_category_number int
);

create table if not exists public.ia_load_run (
  id          bigserial primary key,
  kind        text not null,
  source_url  text,
  sha256      text,
  rows_read   int,
  rows_loaded int,
  years       text,
  status      text not null default 'ok',
  message     text,
  loaded_at   timestamptz not null default now()
);

alter table public.ia_district      enable row level security;
alter table public.ia_fin_line_def  enable row level security;
alter table public.ia_district_year enable row level security;
alter table public.ia_fin           enable row level security;
alter table public.ia_stage         enable row level security;   -- no policies: service role only
alter table public.ia_load_run      enable row level security;

drop policy if exists "ia read" on public.ia_district;
drop policy if exists "ia read" on public.ia_fin_line_def;
drop policy if exists "ia read" on public.ia_district_year;
drop policy if exists "ia read" on public.ia_fin;
drop policy if exists "ia read" on public.ia_load_run;
create policy "ia read" on public.ia_district      for select to authenticated using (true);
create policy "ia read" on public.ia_fin_line_def  for select to authenticated using (true);
create policy "ia read" on public.ia_district_year for select to authenticated using (true);
create policy "ia read" on public.ia_fin           for select to authenticated using (true);
create policy "ia read" on public.ia_load_run      for select to authenticated using (true);
grant select on public.ia_district, public.ia_fin_line_def, public.ia_district_year,
                public.ia_fin, public.ia_load_run to authenticated;

-- Swap staged rows in. Every (fiscal_year, status) present in the stage replaces what is stored
-- for that kind, so a number that went to zero or a re-estimate that changed doesn't linger.
create or replace function public.ia_publish(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows int; v_years text;
begin
  if p_kind not in ('exp','rev') then raise exception 'kind must be exp or rev'; end if;

  insert into ia_district (de_district, dom_district, aea, name, first_fy, last_fy, updated_at)
  select de_district,
         (array_agg(dom_district  order by fiscal_year desc))[1],
         (array_agg(aea           order by fiscal_year desc))[1],
         (array_agg(district_name order by fiscal_year desc))[1],
         min(fiscal_year), max(fiscal_year), now()
  from ia_stage where kind = p_kind and de_district is not null
  group by de_district
  on conflict (de_district) do update set
    dom_district = excluded.dom_district, aea = excluded.aea, name = excluded.name,
    first_fy = least(ia_district.first_fy, excluded.first_fy),
    last_fy  = greatest(ia_district.last_fy, excluded.last_fy), updated_at = now();

  insert into ia_fin_line_def (kind, column_name, fund, line)
  select distinct on (column_name) p_kind, column_name, fund, line
  from ia_stage where kind = p_kind and column_name is not null
  order by column_name, fiscal_year desc
  on conflict (kind, column_name) do update set fund = excluded.fund, line = excluded.line;

  -- size bands come from expenditures (both files carry them; exp is the reference)
  insert into ia_district_year (de_district, fiscal_year, status, enrollment_category,
                                enrollment_category_number, enrollment)
  select de_district, fiscal_year, status,
         max(enrollment_category), max(enrollment_category_number),
         round((percentile_cont(0.5) within group (order by amount / nullif(per_pupil, 0))
                filter (where abs(amount) >= 50000 and abs(per_pupil) >= 5))::numeric, 1)
  from ia_stage where kind = p_kind
  group by de_district, fiscal_year, status
  on conflict (de_district, fiscal_year, status) do update set
    enrollment_category = coalesce(excluded.enrollment_category, ia_district_year.enrollment_category),
    enrollment_category_number = coalesce(excluded.enrollment_category_number, ia_district_year.enrollment_category_number),
    enrollment = case when p_kind = 'exp' or ia_district_year.enrollment is null
                      then coalesce(excluded.enrollment, ia_district_year.enrollment)
                      else ia_district_year.enrollment end;

  delete from ia_fin f
  using (select distinct fiscal_year, status from ia_stage where kind = p_kind) s
  where f.kind = p_kind and f.fiscal_year = s.fiscal_year and f.status = s.status;

  insert into ia_fin (kind, de_district, fiscal_year, status, column_name, amount, per_pupil)
  select p_kind, de_district, fiscal_year, status, column_name, sum(amount), sum(per_pupil)
  from ia_stage
  where kind = p_kind and amount is not null and amount <> 0
  group by de_district, fiscal_year, status, column_name;
  get diagnostics v_rows = row_count;

  select string_agg(distinct fiscal_year || ' ' || status, ', ') into v_years
  from ia_stage where kind = p_kind;

  delete from ia_stage where kind = p_kind;
  return jsonb_build_object('kind', p_kind, 'rows_loaded', v_rows, 'years', v_years,
                            'measures', ia_refresh_measures());
end $$;
revoke all on function public.ia_publish(text) from public, anon, authenticated;

-- Line roles used by the rollups. Lines not listed count as ordinary spending / revenue.
-- VERIFIED names from the live files on 2026-10-06.
create or replace function public.ia_line_role(p_kind text, p_line text)
returns text language sql immutable as $$
  select case
    when p_kind = 'exp' and p_line = 'Ending Fund Balance' then 'balance'
    when p_kind = 'exp' and p_line like 'Transfers Out%'   then 'transfer'
    when p_kind = 'rev' and p_line = 'Beginning Fund Balance' then 'balance'
    when p_kind = 'rev' and p_line like 'Transfers In%'    then 'transfer'
    when p_kind = 'rev' and p_line like '%Debt Proceeds%'  then 'financing'
    else 'flow' end
$$;

-- Every measure for every district-year. Sparse (zeros are absent). Units: dollars per pupil,
-- except *:ending_pct which is the fund's ending balance as % of its spending that year.
--   exp|<fund>|<function>   raw line          exp|ALL|<function>  function across all funds
--   exp|<fund>|TOTAL        fund spending     exp|ALL|TOTAL       all spending
--   rev|<fund>|<source>     raw line          rev|ALL|<source>    source across all funds
--   rev|<fund>|TOTAL        fund revenue      rev|ALL|TOTAL       all revenue
--   bal|<fund>|ENDING       ending balance    bal|<fund>|ENDING_PCT  ending balance / fund spending
create or replace view public.ia_measure_v as
with f as (
  select x.kind, x.de_district, x.fiscal_year, x.status, d.fund, d.line, x.amount,
         ia_line_role(x.kind, d.line) as role
  from ia_fin x join ia_fin_line_def d on d.kind = x.kind and d.column_name = x.column_name
), raw as (
  select kind, de_district, fiscal_year, status, kind||'|'||fund||'|'||line as measure_key,
         kind as grp, fund, line, amount from f where role = 'flow'
  union all
  select kind, de_district, fiscal_year, status, kind||'|ALL|'||line, kind, 'ALL', line, sum(amount)
  from f where role = 'flow' group by 1,2,3,4,line,kind
  union all
  select kind, de_district, fiscal_year, status, kind||'|'||fund||'|TOTAL', kind, fund, 'TOTAL', sum(amount)
  from f where role = 'flow' group by 1,2,3,4,fund,kind
  union all
  select kind, de_district, fiscal_year, status, kind||'|ALL|TOTAL', kind, 'ALL', 'TOTAL', sum(amount)
  from f where role = 'flow' group by 1,2,3,4
  union all
  select 'bal', de_district, fiscal_year, status, 'bal|'||fund||'|ENDING', 'bal', fund, 'ENDING', amount
  from f where kind = 'exp' and role = 'balance'
)
select r.de_district, r.fiscal_year, r.status, r.measure_key, r.grp, r.fund, r.line,
       'per_pupil'::text as unit, r.amount,
       round(r.amount / nullif(y.enrollment, 0), 2) as value
from raw r join ia_district_year y using (de_district, fiscal_year, status)
union all
select b.de_district, b.fiscal_year, b.status, 'bal|'||b.fund||'|ENDING_PCT', 'bal', b.fund, 'ENDING_PCT',
       'pct', b.amount, round(100 * b.amount / nullif(t.amount, 0), 1)
from (select de_district, fiscal_year, status, fund, amount from f where kind='exp' and role='balance') b
join (select de_district, fiscal_year, status, fund, sum(amount) amount
      from f where kind='exp' and role='flow' group by 1,2,3,4) t
  using (de_district, fiscal_year, status, fund)
where t.amount > 0;
grant select on public.ia_measure_v to authenticated;

-- The view above is the definition; this table is its stored copy, refreshed by each load,
-- so benchmarks read indexed rows instead of recomputing every district's rollups.
create table if not exists public.ia_measure (
  de_district text not null, fiscal_year int not null, status text not null, measure_key text not null,
  grp text, fund text, line text, unit text, amount numeric, value numeric,
  primary key (de_district, fiscal_year, status, measure_key)
);
create index if not exists ia_measure_key on public.ia_measure (fiscal_year, status, measure_key);
alter table public.ia_measure enable row level security;
drop policy if exists "ia read" on public.ia_measure;
create policy "ia read" on public.ia_measure for select to authenticated using (true);
grant select on public.ia_measure to authenticated;

create or replace function public.ia_refresh_measures()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from ia_measure;
  insert into ia_measure (de_district, fiscal_year, status, measure_key, grp, fund, line, unit, amount, value)
  select de_district, fiscal_year, status, measure_key, grp, fund, line, unit, amount, value from ia_measure_v;
  get diagnostics n = row_count;
  -- fresh statistics matter: without them a benchmark call can take minutes instead of ~30 ms
  analyze ia_measure; analyze ia_fin; analyze ia_district_year;
  return n;
end $$;
revoke all on function public.ia_refresh_measures() from public, anon, authenticated;

-- Find a district by name for onboarding (handles 'Logan Magnolia' vs 'Logan-Magnolia').
create or replace function public.ia_district_search(q text)
returns table (de_district text, name text, aea text, last_fy int, score real)
language sql stable set search_path = public, extensions as $$
  select de_district, name, aea, last_fy,
         greatest(similarity(lower(name), lower(q)),
                  case when lower(name) like '%'||lower(q)||'%' then 0.9 else 0 end)::real
  from ia_district
  where lower(name) like '%'||lower(q)||'%' or similarity(lower(name), lower(q)) > 0.25
  order by 5 desc, name limit 10
$$;
grant execute on function public.ia_district_search(text) to authenticated;


-- ===================================================================================== state annual reports (FY2019 on)


-- ---------- schema additions ----------
alter table public.ia_fin           drop constraint if exists ia_fin_kind_check;
alter table public.ia_fin           add  constraint ia_fin_kind_check check (kind in ('exp','rev','bal'));
alter table public.ia_fin_line_def  drop constraint if exists ia_fin_line_def_kind_check;
alter table public.ia_fin_line_def  add  constraint ia_fin_line_def_kind_check check (kind in ('exp','rev','bal'));
alter table public.ia_fin_line_def  add column if not exists obj text;      -- 'Salaries', 'Benefits', ... (CAR only)
alter table public.ia_stage         add column if not exists obj text;
alter table public.ia_stage         add column if not exists source text;   -- 'datahub' | 'car'
alter table public.ia_fin           add column if not exists source text;
alter table public.ia_district_year add column if not exists certified_enrollment numeric;
alter table public.ia_district_year add column if not exists served_enrollment numeric;
alter table public.ia_district_year add column if not exists enrollment_source text;

create table if not exists public.ia_enroll_stage (
  de_district text, fiscal_year int, district_name text,
  certified_enrollment numeric, served_enrollment numeric
);
alter table public.ia_enroll_stage enable row level security;   -- no policies: loader only

-- ---------- size bands ----------
-- ASSUMED cutoffs, matching the labels the Data Hub uses ('600-999' = band 3). The CAR loader logs
-- how often these agree with the Data Hub's own bands for FY2023, so a wrong cutoff shows up.
create or replace function public.ia_band(e numeric)
returns int language sql immutable as $$
  select case when e is null then null when e < 300 then 1 when e < 600 then 2 when e < 1000 then 3
              when e < 2500 then 4 when e < 7500 then 5 else 6 end
$$;
create or replace function public.ia_band_label(b int)
returns text language sql immutable as $$
  select case b when 1 then '<300' when 2 then '300-599' when 3 then '600-999'
                when 4 then '1,000-2,499' when 5 then '2,500-7,499' when 6 then '7,500+' end
$$;

-- ---------- enrollment ----------
-- Certified enrollment for school year 2024-25 is used for FY2025, and so on (the October count of
-- resident students the district is funded for). served_enrollment (students actually taught
-- there) is kept too. Per-pupil figures use certified enrollment wherever it exists.
create or replace function public.ia_publish_enrollment()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; v_fys int[]; v_m int := 0; y int;
begin
  select array_agg(distinct fiscal_year) into v_fys from ia_enroll_stage;
  insert into ia_district (de_district, name, updated_at)
  select distinct on (de_district) de_district, district_name, now()
  from ia_enroll_stage where de_district < '8000'
  order by de_district, fiscal_year desc
  on conflict (de_district) do nothing;

  insert into ia_district_year (de_district, fiscal_year, status, certified_enrollment, served_enrollment,
                                enrollment, enrollment_category_number, enrollment_category, enrollment_source)
  select de_district, fiscal_year, 'Actual', certified_enrollment, served_enrollment,
         certified_enrollment, ia_band(certified_enrollment), ia_band_label(ia_band(certified_enrollment)), 'certified'
  from ia_enroll_stage where de_district < '8000' and certified_enrollment > 0
  on conflict (de_district, fiscal_year, status) do update set
    certified_enrollment = excluded.certified_enrollment,
    served_enrollment    = excluded.served_enrollment,
    -- certified enrollment wins for every year it exists, so per-pupil figures use one
    -- definition across years (the Data Hub's own figure is kept only for FY2017-18)
    enrollment = excluded.enrollment,
    enrollment_category_number = excluded.enrollment_category_number,
    enrollment_category = excluded.enrollment_category,
    enrollment_source = 'certified';
  get diagnostics n = row_count;
  delete from ia_enroll_stage;
  foreach y in array coalesce(v_fys, '{}') loop v_m := v_m + ia_refresh_measures(y); end loop;
  return jsonb_build_object('district_years', n, 'measures', v_m);
end $$;
revoke all on function public.ia_publish_enrollment() from public, anon, authenticated;

-- ---------- publish (now handles exp / rev / bal from either source) ----------
drop function if exists public.ia_publish(text);
create or replace function public.ia_publish(p_kind text, p_refresh boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows int; v_years text; v_src text; v_fys int[]; v_m int := 0; y int;
begin
  if p_kind not in ('exp','rev','bal') then raise exception 'kind must be exp, rev or bal'; end if;
  select max(coalesce(source, 'datahub')) into v_src from ia_stage where kind = p_kind;

  insert into ia_district (de_district, dom_district, aea, name, first_fy, last_fy, updated_at)
  select de_district,
         (array_agg(dom_district  order by fiscal_year desc))[1],
         (array_agg(aea           order by fiscal_year desc))[1],
         (array_agg(district_name order by fiscal_year desc))[1],
         min(fiscal_year), max(fiscal_year), now()
  from ia_stage where kind = p_kind and de_district is not null
  group by de_district
  on conflict (de_district) do update set
    dom_district = coalesce(excluded.dom_district, ia_district.dom_district),
    aea          = coalesce(excluded.aea, ia_district.aea),
    name         = case when excluded.last_fy >= coalesce(ia_district.last_fy, 0) then excluded.name else ia_district.name end,
    first_fy = least(ia_district.first_fy, excluded.first_fy),
    last_fy  = greatest(ia_district.last_fy, excluded.last_fy), updated_at = now();

  insert into ia_fin_line_def (kind, column_name, fund, line, obj)
  select distinct on (column_name) p_kind, column_name, fund, line, obj
  from ia_stage where kind = p_kind and column_name is not null
  order by column_name, fiscal_year desc
  on conflict (kind, column_name) do update set fund = excluded.fund, line = excluded.line, obj = excluded.obj;

  -- Data Hub rows carry their own enrollment and size band; CAR rows don't (enrollment file does)
  insert into ia_district_year (de_district, fiscal_year, status, enrollment_category,
                                enrollment_category_number, enrollment, enrollment_source)
  select de_district, fiscal_year, status,
         max(enrollment_category), max(enrollment_category_number),
         round((percentile_cont(0.5) within group (order by amount / nullif(per_pupil, 0))
                filter (where abs(amount) >= 50000 and abs(per_pupil) >= 5))::numeric, 1),
         case when bool_or(per_pupil is not null) then 'datahub' end
  from ia_stage where kind = p_kind
  group by de_district, fiscal_year, status
  on conflict (de_district, fiscal_year, status) do update set
    enrollment_category = case when ia_district_year.enrollment_source = 'certified' then ia_district_year.enrollment_category
                               else coalesce(excluded.enrollment_category, ia_district_year.enrollment_category) end,
    enrollment_category_number = case when ia_district_year.enrollment_source = 'certified' then ia_district_year.enrollment_category_number
                               else coalesce(excluded.enrollment_category_number, ia_district_year.enrollment_category_number) end,
    enrollment = case when ia_district_year.enrollment_source = 'certified' then ia_district_year.enrollment
                      when excluded.enrollment_source = 'datahub' and (p_kind = 'exp' or ia_district_year.enrollment is null)
                      then coalesce(excluded.enrollment, ia_district_year.enrollment)
                      else ia_district_year.enrollment end,
    enrollment_source = case when ia_district_year.enrollment_source = 'certified' then 'certified'
                             else coalesce(excluded.enrollment_source, ia_district_year.enrollment_source) end;

  delete from ia_fin f
  using (select distinct fiscal_year, status from ia_stage where kind = p_kind) s
  where f.kind = p_kind and f.fiscal_year = s.fiscal_year and f.status = s.status;

  insert into ia_fin (kind, de_district, fiscal_year, status, column_name, amount, per_pupil, source)
  select p_kind, de_district, fiscal_year, status, column_name, sum(amount), sum(per_pupil), max(coalesce(source, 'datahub'))
  from ia_stage
  where kind = p_kind and amount is not null and amount <> 0
  group by de_district, fiscal_year, status, column_name;
  get diagnostics v_rows = row_count;

  select string_agg(distinct fiscal_year || ' ' || status, ', '), array_agg(distinct fiscal_year)
    into v_years, v_fys from ia_stage where kind = p_kind;
  delete from ia_stage where kind = p_kind;
  if p_refresh then
    foreach y in array coalesce(v_fys, '{}') loop v_m := v_m + ia_refresh_measures(y); end loop;
  end if;
  return jsonb_build_object('kind', p_kind, 'source', v_src, 'rows_loaded', v_rows, 'years', v_years,
                            'measures', v_m);
end $$;
revoke all on function public.ia_publish(text, boolean) from public, anon, authenticated;

-- ---------- measures ----------
-- Same keys as before, plus:
--   exp|<fund>|<function>|<object>  spending detail by object (grp 'detail': shown, never flagged)
--   exp|ALL|<function>|<object>
--   bal|<fund>|<Unassigned|Assigned|Committed|Restricted|Nonspendable>   per pupil
--   bal|General|SOLVENCY   (assigned + unassigned General Fund balance) / (General Fund revenue
--                          minus AEA flow-through), the ratio Iowa boards are taught to watch
-- One year's measures (the definition). ia_measure stores the result; ia_measure_v shows all years.
create or replace function public.ia_measures_calc(p_fy int)
returns table (de_district text, fiscal_year int, status text, measure_key text, grp text, fund text,
               line text, unit text, amount numeric, value numeric)
language sql stable set search_path = public as $fn$

with f as (
  select x.kind, x.de_district, x.fiscal_year, x.status, d.fund, d.line, d.obj, x.amount,
         ia_line_role(x.kind, d.line) as role
  from ia_fin x join ia_fin_line_def d on d.kind = x.kind and d.column_name = x.column_name
  where x.de_district < '8000' and x.fiscal_year = p_fy
    -- Internal Service funds (mostly self-funded insurance) re-count money already spent in other
    -- funds; Trust and Custodial funds hold money for others. The state's Data Hub leaves them out
    -- too: with them excluded, FY2019-2023 spending matches it within ~1% by function.
    and d.fund not in ('Internal Service', 'Trust', 'Custodial')
), raw as (
  select kind, de_district, fiscal_year, status, kind||'|'||fund||'|'||line as measure_key,
         kind as grp, fund, line, sum(amount) amount
  from f where role = 'flow' and kind in ('exp','rev') group by 1,2,3,4,fund,line
  union all
  select kind, de_district, fiscal_year, status, kind||'|ALL|'||line, kind, 'ALL', line, sum(amount)
  from f where role = 'flow' and kind in ('exp','rev') group by 1,2,3,4,line
  union all
  select kind, de_district, fiscal_year, status, kind||'|'||fund||'|TOTAL', kind, fund, 'TOTAL', sum(amount)
  from f where role = 'flow' and kind in ('exp','rev') group by 1,2,3,4,fund
  union all
  select kind, de_district, fiscal_year, status, kind||'|ALL|TOTAL', kind, 'ALL', 'TOTAL', sum(amount)
  from f where role = 'flow' and kind in ('exp','rev') group by 1,2,3,4
  union all
  select 'bal', de_district, fiscal_year, status, 'bal|'||fund||'|ENDING', 'bal', fund, 'ENDING', sum(amount)
  from f where kind = 'exp' and role = 'balance' group by 1,2,3,4,fund
  union all   -- spending detail by object
  select kind, de_district, fiscal_year, status, kind||'|'||fund||'|'||line||'|'||obj, 'detail', fund, line||' · '||obj, sum(amount)
  from f where kind = 'exp' and role = 'flow' and obj is not null group by 1,2,3,4,fund,line,obj
  union all
  select kind, de_district, fiscal_year, status, kind||'|ALL|'||line||'|'||obj, 'detail', 'ALL', line||' · '||obj, sum(amount)
  from f where kind = 'exp' and role = 'flow' and obj is not null group by 1,2,3,4,line,obj
  union all   -- fund balance by class
  select 'bal', de_district, fiscal_year, status, 'bal|'||fund||'|'||line, 'bal', fund, line, sum(amount)
  from f where kind = 'bal' group by 1,2,3,4,fund,line
), solv as (
  select r.de_district, r.fiscal_year, r.status,
         sum(case when r.kind = 'bal' and r.line in ('Assigned','Unassigned') then r.amount else 0 end) as num,
         sum(case when r.kind = 'rev' and r.role = 'flow' then r.amount else 0 end)
           - sum(case when r.kind = 'exp' and r.line = 'AEA Support - Direct to AEA' then r.amount else 0 end) as den,
         bool_or(r.kind = 'bal') as has_bal
  from f r where r.fund = 'General' group by 1,2,3
)
select r.de_district, r.fiscal_year, r.status, r.measure_key, r.grp, r.fund, r.line,
       'per_pupil'::text as unit, r.amount,
       round(r.amount / nullif(y.enrollment, 0), 2) as value
from raw r join ia_district_year y using (de_district, fiscal_year, status)
union all
select b.de_district, b.fiscal_year, b.status, 'bal|'||b.fund||'|ENDING_PCT', 'bal', b.fund, 'ENDING_PCT',
       'pct', b.amount, round(100 * b.amount / nullif(t.amount, 0), 1)
from (select de_district, fiscal_year, status, fund, sum(amount) amount from f where kind='exp' and role='balance' group by 1,2,3,4) b
join (select de_district, fiscal_year, status, fund, sum(amount) amount
      from f where kind='exp' and role='flow' group by 1,2,3,4) t
  using (de_district, fiscal_year, status, fund)
where t.amount > 0
union all
select s.de_district, s.fiscal_year, s.status, 'bal|General|SOLVENCY', 'bal', 'General', 'SOLVENCY',
       'pct', s.num, round(100 * s.num / s.den, 1)
from solv s where s.has_bal and s.den > 0;
$fn$;

drop view if exists public.ia_measure_v;
create view public.ia_measure_v as
select m.* from (select distinct fiscal_year from public.ia_district_year) y,
               lateral public.ia_measures_calc(y.fiscal_year) m;
grant select on public.ia_measure_v to authenticated;


-- Refresh stored measures for one year (or every year when p_fy is null).
drop function if exists public.ia_refresh_measures();
create or replace function public.ia_refresh_measures(p_fy int default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; y int;
begin
  for y in select distinct fiscal_year from ia_district_year
           where p_fy is null or fiscal_year = p_fy order by 1 loop
    delete from ia_measure where fiscal_year = y;
    insert into ia_measure (de_district, fiscal_year, status, measure_key, grp, fund, line, unit, amount, value)
    select * from ia_measures_calc(y);
    get diagnostics k = row_count; n := n + k;
  end loop;
  analyze ia_measure;
  return n;
end $$;
revoke all on function public.ia_refresh_measures(int) from public, anon, authenticated;

-- ---------- callouts ----------
-- Only measures listed here can get a callout (LIKE patterns on measure_key). Everything still
-- returns peer figures; this only decides what is flagged, so pages stay quiet unless it matters.
create table if not exists public.benchmark_flaggable (
  pattern text primary key,
  enabled boolean not null default true,
  why     text
);
alter table public.benchmark_flaggable enable row level security;
drop policy if exists "flaggable read" on public.benchmark_flaggable;
create policy "flaggable read" on public.benchmark_flaggable for select to authenticated using (true);
grant select on public.benchmark_flaggable to authenticated;
insert into public.benchmark_flaggable (pattern, why) values
  ('exp|ALL|%',                 'spending by function, all funds'),
  ('exp|General|%',             'General Fund spending by function'),
  ('exp|SAVE|TOTAL',            'capital spending'),
  ('exp|PPEL|TOTAL',            'capital spending'),
  ('exp|Management|TOTAL',      'insurance, early retirement, judgments'),
  ('exp|Nutrition|TOTAL',       'food service'),
  ('rev|ALL|TOTAL',             'total revenue'),
  ('rev|General|TOTAL',         'General Fund revenue'),
  ('bal|General|SOLVENCY',      'the board''s main reserve measure'),
  ('bal|SAVE|ENDING',           'capital reserves'),
  ('bal|PPEL|ENDING',           'capital reserves'),
  ('bal|Management|ENDING',     'Management Fund reserve')
on conflict (pattern) do nothing;

-- (the benchmark function itself is created in part 16, on HighGround's districts)


-- ---------- compare a staged year with what's stored (used once, to check the CAR mapping) ----------
-- Statewide totals per function/source for one year: staged (CAR) vs stored (Data Hub).
create or replace function public.ia_compare_stage(p_kind text, p_fy int)
returns table (line text, staged numeric, stored numeric, diff_pct numeric, districts_off_5pct int)
language sql stable security definer set search_path = public as $$
  with s as (select de_district, line, sum(amount) a from ia_stage
             where kind = p_kind and fiscal_year = p_fy and ia_line_role(p_kind, line) = 'flow' and de_district < '8000'
             group by 1, 2),
       m as (select de_district, line, amount a from ia_measure
             where fiscal_year = p_fy and status = 'Actual' and grp = p_kind and fund = 'ALL' and line <> 'TOTAL'),
       j as (select coalesce(s.line, m.line) line, coalesce(s.de_district, m.de_district) de,
                    coalesce(s.a, 0) sa, coalesce(m.a, 0) ma
             from s full join m on s.de_district = m.de_district and s.line = m.line)
  select line, round(sum(sa)), round(sum(ma)),
         round(100 * (sum(sa) - sum(ma)) / nullif(sum(ma), 0), 1),
         (count(*) filter (where abs(sa - ma) > 0.05 * greatest(abs(ma), 1) and abs(sa - ma) > 1000))::int
  from j group by line order by abs(sum(sa) - sum(ma)) desc
$$;
revoke all on function public.ia_compare_stage(text, int) from public, anon, authenticated;



notify pgrst, 'reload schema';
select 'Iowa public data tables are in place' as test, case when to_regclass('public.ia_measure') is not null and to_regclass('public.benchmark_flaggable') is not null then 'PASS' else 'FAIL' end as result;
