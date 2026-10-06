-- HighGround: Iowa public finance data, peer benchmarks, monthly register checks.
-- Supabase project "horizon". Paste into SQL Editor and Run. Safe to run twice.
-- Written 2026-10-06. Uses cip_member / cip_can_write / cip_is_admin from supabase_setup_horizon.sql
-- and re-creates them below if missing.
--
-- PART A  Iowa Data Hub (public): districts, expenditures, revenues. Anyone can read. Only the
--         loader (service role key, GitHub Action) writes, through ia_stage + ia_publish().
-- PART B  District link + peer benchmarks: ia_benchmark() returns every measure with peer
--         average/median/rank and a callout sentence when the number is unusual.
-- PART C  Monthly check registers (private to the district): imports, lines, vendor notes,
--         rules, flags. register_check() raises questions for the board.
--
-- Labels used in comments: VERIFIED = checked against the live Data Hub on 2026-10-06;
-- ASSUMED = reasonable default, confirm before relying on it.

-- Supabase keeps extensions in the 'extensions' schema; functions below search it explicitly.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;   -- Supabase already does this; harmless if so

-- =====================================================================================
-- PREREQUISITES. Membership table and the two access checks from supabase_setup_horizon.sql.
-- Re-created here (same definitions) so this file runs even if that setup was only partly run.
-- No member rows are added; existing ones are untouched.
-- =====================================================================================
create table if not exists public.cip_member (
  tenant_id  text not null,
  email      text not null,
  role       text not null default 'editor' check (role in ('admin','editor')),
  primary key (tenant_id, email)
);
alter table public.cip_member enable row level security;

create or replace function public.cip_can_write(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cip_member m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (m.tenant_id = t or m.tenant_id = '*')
  );
$$;
revoke all on function public.cip_can_write(text) from public;
grant execute on function public.cip_can_write(text) to anon, authenticated;

create or replace function public.cip_is_admin(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cip_member m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and m.role = 'admin' and (m.tenant_id = t or m.tenant_id = '*')
  );
$$;
revoke all on function public.cip_is_admin(text) from public;
grant execute on function public.cip_is_admin(text) to authenticated;

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
create policy "ia read" on public.ia_district      for select to anon, authenticated using (true);
create policy "ia read" on public.ia_fin_line_def  for select to anon, authenticated using (true);
create policy "ia read" on public.ia_district_year for select to anon, authenticated using (true);
create policy "ia read" on public.ia_fin           for select to anon, authenticated using (true);
create policy "ia read" on public.ia_load_run      for select to anon, authenticated using (true);
grant select on public.ia_district, public.ia_fin_line_def, public.ia_district_year,
                public.ia_fin, public.ia_load_run to anon, authenticated;

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
grant select on public.ia_measure_v to anon, authenticated;

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
create policy "ia read" on public.ia_measure for select to anon, authenticated using (true);
grant select on public.ia_measure to anon, authenticated;

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
grant execute on function public.ia_district_search(text) to anon, authenticated;

-- =====================================================================================
-- PART B. District link and peer benchmarks
-- =====================================================================================

-- Which state district a HighGround tenant is. Matching is by ID, never by name.
create table if not exists public.district_state_link (
  tenant_id   text primary key,                -- cip_tenant.id today; district.id after the schema move
  de_district text not null references public.ia_district(de_district),
  linked_by   text,
  linked_at   timestamptz not null default now()
);
-- Optional hand-picked peers. If a tenant has none, peers = same enrollment band that year.
create table if not exists public.district_peer (
  tenant_id   text not null,
  de_district text not null references public.ia_district(de_district),
  primary key (tenant_id, de_district)
);
-- Callout thresholds. tenant_id '*' is the default row; a district can have its own.
create table if not exists public.benchmark_rule (
  tenant_id         text primary key,
  min_peers         int     not null default 8,
  high_rank         numeric not null default 0.90,   -- at or above the 90th percentile -> high
  low_rank          numeric not null default 0.10,   -- at or below the 10th percentile -> low
  min_gap_per_pupil numeric not null default 25,     -- ignore gaps smaller than $25/pupil
  min_gap_pct       numeric not null default 2,      -- ignore gaps smaller than 2 points (balance %)
  yoy_jump_pct      numeric not null default 25,     -- own change beats peers' median change by 25 points
  yoy_min_per_pupil numeric not null default 50
);
insert into public.benchmark_rule (tenant_id) values ('*') on conflict do nothing;

alter table public.district_state_link enable row level security;
alter table public.district_peer       enable row level security;
alter table public.benchmark_rule      enable row level security;
drop policy if exists "link read"   on public.district_state_link;
drop policy if exists "link write"  on public.district_state_link;
drop policy if exists "link change" on public.district_state_link;
drop policy if exists "link remove" on public.district_state_link;
create policy "link read"   on public.district_state_link for select to anon, authenticated using (true);
create policy "link write"  on public.district_state_link for insert to authenticated with check (public.cip_is_admin(tenant_id));
create policy "link change" on public.district_state_link for update to authenticated
  using (public.cip_is_admin(tenant_id)) with check (public.cip_is_admin(tenant_id));
create policy "link remove" on public.district_state_link for delete to authenticated using (public.cip_is_admin(tenant_id));
drop policy if exists "peer read"  on public.district_peer;
drop policy if exists "peer write" on public.district_peer;
drop policy if exists "peer remove" on public.district_peer;
create policy "peer read"   on public.district_peer for select to anon, authenticated using (true);
create policy "peer write"  on public.district_peer for insert to authenticated with check (public.cip_can_write(tenant_id));
create policy "peer remove" on public.district_peer for delete to authenticated using (public.cip_can_write(tenant_id));
drop policy if exists "rule read"  on public.benchmark_rule;
drop policy if exists "rule write" on public.benchmark_rule;
drop policy if exists "rule change" on public.benchmark_rule;
create policy "rule read"   on public.benchmark_rule for select to anon, authenticated using (true);
create policy "rule write"  on public.benchmark_rule for insert to authenticated with check (tenant_id <> '*' and public.cip_is_admin(tenant_id));
create policy "rule change" on public.benchmark_rule for update to authenticated
  using (tenant_id <> '*' and public.cip_is_admin(tenant_id)) with check (tenant_id <> '*' and public.cip_is_admin(tenant_id));
grant select on public.district_state_link, public.district_peer, public.benchmark_rule to anon, authenticated;
grant insert, update, delete on public.district_state_link to authenticated;
grant insert, delete on public.district_peer to authenticated;
grant insert, update on public.benchmark_rule to authenticated;

-- Benchmarks for one district and year. Works for any district (prospects and demos too),
-- because the inputs are public. p_peer: 'size' (same enrollment band), 'aea', 'state',
-- or 'custom' (district_peer rows for p_tenant). The district itself is never its own peer.
-- Zeros count: a peer with no transportation spending is a $0 peer, not a missing one.
create or replace function public.ia_benchmark(
  p_de text, p_fy int, p_status text default 'Actual', p_peer text default 'size', p_tenant text default null)
returns table (
  measure_key text, grp text, fund text, line text, unit text,
  amount numeric, value numeric,
  peer_group text, peer_n int, peer_mean numeric, peer_median numeric, peer_p25 numeric, peer_p75 numeric,
  pct_rank numeric, vs_mean_pct numeric,
  prior_value numeric, change_pct numeric, peer_change_median_pct numeric,
  flag text, callout text)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare r benchmark_rule; v_band int; v_aea text; v_label text;
begin
  select * into r from benchmark_rule where tenant_id = coalesce(p_tenant, '*');
  if not found then select * into r from benchmark_rule where tenant_id = '*'; end if;
  select enrollment_category_number into v_band from ia_district_year
   where de_district = p_de and fiscal_year = p_fy and status = p_status;
  select aea into v_aea from ia_district where de_district = p_de;
  v_label := case p_peer when 'size' then 'districts your size'
                         when 'aea' then 'districts in your AEA'
                         when 'custom' then 'your chosen peers'
                         else 'Iowa districts' end;

  return query
  with peers as (
    select y.de_district from ia_district_year y join ia_district d using (de_district)
    where y.fiscal_year = p_fy and y.status = p_status and y.de_district <> p_de
      and y.enrollment > 0
      and case p_peer
            when 'size'   then y.enrollment_category_number = v_band
            when 'aea'    then d.aea = v_aea
            when 'custom' then exists (select 1 from district_peer dp
                                       where dp.tenant_id = p_tenant and dp.de_district = y.de_district)
            else true end
  ),
  me as (select * from ia_measure m where m.de_district = p_de and m.fiscal_year = p_fy and m.status = p_status),
  me_prior as (select m.measure_key, m.value from ia_measure m
               where m.de_district = p_de and m.fiscal_year = p_fy - 1 and m.status = 'Actual'),
  pv as (   -- every peer x every measure the district has; per-pupil zeros filled in
    select me.measure_key, p.de_district,
           case when me.unit = 'pct' then pm.value else coalesce(pm.value, 0) end as v
    from me cross join peers p
    left join ia_measure pm on pm.de_district = p.de_district and pm.fiscal_year = p_fy
                           and pm.status = p_status and pm.measure_key = me.measure_key
  ),
  pchg as (  -- peers' change from last year's Actual
    select me.measure_key,
           percentile_cont(0.5) within group (order by 100.0 * (c.value - o.value) / abs(o.value)) as med
    from me join peers p on true
    join ia_measure c on c.de_district = p.de_district and c.fiscal_year = p_fy and c.status = p_status and c.measure_key = me.measure_key
    join ia_measure o on o.de_district = p.de_district and o.fiscal_year = p_fy - 1 and o.status = 'Actual' and o.measure_key = me.measure_key
    where o.value <> 0
    group by me.measure_key
  ),
  st as (
    select pv.measure_key, count(v)::int n, avg(v) mean,
           percentile_cont(0.5)  within group (order by v) med,
           percentile_cont(0.25) within group (order by v) p25,
           percentile_cont(0.75) within group (order by v) p75
    from pv where v is not null group by pv.measure_key
  ),
  rk as (
    select me.measure_key,
           (count(*) filter (where pv.v < me.value) + 0.5 * count(*) filter (where pv.v = me.value))
             / nullif(count(pv.v), 0)::numeric as pr
    from me join pv using (measure_key) group by me.measure_key, me.value
  ),
  j as (
    select me.*, st.n, st.mean, st.med, st.p25, st.p75, rk.pr,
           round(100 * (me.value - st.mean) / nullif(abs(st.mean), 0), 1) as vsm,
           mp.value as prior,
           round(100 * (me.value - mp.value) / nullif(abs(mp.value), 0), 1) as chg,
           round(pchg.med::numeric, 1) as pchg_med
    from me left join st using (measure_key) left join rk using (measure_key)
    left join me_prior mp using (measure_key) left join pchg using (measure_key)
  ),
  fl as (
    select j.*,
      case
        when coalesce(j.n, 0) < r.min_peers then null
        when j.pr >= r.high_rank and abs(j.value - j.med) >= case when j.unit = 'pct' then r.min_gap_pct else r.min_gap_per_pupil end then 'high'
        when j.pr <= r.low_rank  and abs(j.value - j.med) >= case when j.unit = 'pct' then r.min_gap_pct else r.min_gap_per_pupil end then 'low'
        when j.unit = 'per_pupil' and j.chg is not null and j.pchg_med is not null
             and abs(j.chg - j.pchg_med) >= r.yoy_jump_pct
             and abs(j.value - j.prior) >= r.yoy_min_per_pupil
             and abs(j.prior) >= r.yoy_min_per_pupil then 'jump'      -- no "+700%" off a tiny base
        else null end as flag
    from j
  )
  , dd as (   -- one callout per number: when General|Transportation and ALL|Transportation are the same
             -- dollars, keep the broader one (ALL, then TOTAL) and blank the flag on the rest
    select fl.*, row_number() over (partition by fl.grp, fl.flag, round(fl.value) order by (fl.fund = 'ALL') desc,
                                    (fl.line = 'TOTAL') desc, fl.measure_key) as rn
    from fl
  )
  select fl.measure_key, fl.grp, fl.fund, fl.line, fl.unit, fl.amount, fl.value,
         v_label, fl.n, round(fl.mean, 2), round(fl.med::numeric, 2), round(fl.p25::numeric, 2), round(fl.p75::numeric, 2),
         round(fl.pr, 3), fl.vsm, fl.prior, fl.chg, fl.pchg_med, fl.flag,
         case fl.flag
           when 'high' then
             case when fl.unit = 'pct'
               then fl.value || '% — above ' || round(100 * fl.pr) || '% of ' || fl.n || ' ' || v_label || ' (median ' || round(fl.med::numeric, 1) || '%)'
               else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || abs(fl.vsm) || '% above the average of ' || fl.n || ' ' || v_label || ' (higher than ' || round(100 * fl.pr) || '% of them)' end
           when 'low' then
             case when fl.unit = 'pct'
               then fl.value || '% — below ' || round(100 * (1 - fl.pr)) || '% of ' || fl.n || ' ' || v_label || ' (median ' || round(fl.med::numeric, 1) || '%)'
               else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || abs(fl.vsm) || '% below the average of ' || fl.n || ' ' || v_label || ' (lower than ' || round(100 * (1 - fl.pr)) || '% of them)' end
           when 'jump' then
             (case when fl.chg >= 0 then 'Up ' else 'Down ' end) || abs(fl.chg) || '% from last year; ' || v_label || ' moved ' || fl.pchg_med || '% (median)'
         end
  from (select dd.measure_key, dd.grp, dd.fund, dd.line, dd.unit, dd.amount, dd.value, dd.n, dd.mean, dd.med,
               dd.p25, dd.p75, dd.pr, dd.vsm, dd.prior, dd.chg, dd.pchg_med,
               case when dd.rn = 1 then dd.flag end as flag
        from dd) fl
  order by (fl.flag is null),
           case when fl.flag = 'jump' then abs(fl.chg - fl.pchg_med) else abs(fl.vsm) end desc nulls last,
           fl.grp, fl.fund, fl.line;
end $$;
grant execute on function public.ia_benchmark(text, int, text, text, text) to anon, authenticated;

-- Onboarding pre-fill: the latest Actual year's ending balances and revenue by fund, and the
-- enrollment estimate, for a district. The app shows these for confirmation; nothing is saved.
-- SAVE and PPEL are matched by fund name; the 'match' field says how (ASSUMED name patterns).
create or replace function public.ia_prefill(p_de text)
returns jsonb language sql stable set search_path = public as $$
  with yr as (select max(fiscal_year) fy from ia_district_year where de_district = p_de and status = 'Actual'),
  bal as (select m.fund, m.amount from ia_measure m, yr
          where m.de_district = p_de and m.fiscal_year = yr.fy and m.status = 'Actual' and m.measure_key like 'bal|%|ENDING'),
  rev as (select m.fund, m.amount from ia_measure m, yr
          where m.de_district = p_de and m.fiscal_year = yr.fy and m.status = 'Actual' and m.measure_key like 'rev|%|TOTAL' and m.fund <> 'ALL')
  select jsonb_build_object(
    'de_district', p_de,
    'name', (select name from ia_district where de_district = p_de),
    'as_of_fy', (select fy from yr),
    'as_of_note', 'Year-end Actual from the Certified Annual Report (June 30). Confirm against your books.',
    'enrollment_estimate', (select enrollment from ia_district_year, yr where de_district = p_de and fiscal_year = yr.fy and status = 'Actual'),
    'ending_balance_by_fund', (select coalesce(jsonb_object_agg(fund, amount), '{}') from bal),
    'revenue_by_fund', (select coalesce(jsonb_object_agg(fund, amount), '{}') from rev),
    'save_fund_guess', (select jsonb_build_object('fund', fund, 'ending_balance', amount, 'match', 'name contains SAVE / Sales Tax / Capital Projects')
                        from bal where fund ~* '(save|sales|capital proj)' order by fund limit 1),
    'ppel_fund_guess', (select jsonb_build_object('fund', fund, 'ending_balance', amount, 'match', 'name contains PPEL / Physical Plant')
                        from bal where fund ~* '(ppel|physical plant)' order by fund limit 1),
    'budget_years', (select jsonb_agg(distinct fiscal_year || ' ' || status) from ia_district_year
                     where de_district = p_de and status <> 'Actual')
  )
$$;
grant execute on function public.ia_prefill(text) to anon, authenticated;

-- =====================================================================================
-- PART C. Monthly check registers (private to each district)
-- =====================================================================================

-- 'ACME Supply, Inc.' and 'ACME SUPPLY INC' are the same vendor key.
create or replace function public.hg_vendor_key(p text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9 ]', ' ', 'g'),
             '\m(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LP|LLP|PC|THE)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

create table if not exists public.register_import (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  period_start date not null,
  period_end   date not null,
  file_name    text,
  source       text,                           -- accounting system / board packet / newspaper list
  row_count    int,
  total        numeric,
  uploaded_by  text,
  uploaded_at  timestamptz not null default now(),
  checked_at   timestamptz,
  check (period_end >= period_start)
);
create index if not exists register_import_tenant on public.register_import (tenant_id, period_start);

create table if not exists public.register_line (
  id          bigserial primary key,
  import_id   uuid not null references public.register_import(id) on delete cascade,
  tenant_id   text not null,
  line_no     int,
  pay_date    date,
  check_no    text,
  vendor_no   text,                            -- vendor number, if the export has one
  vendor_name text not null,
  vendor_key  text generated always as (public.hg_vendor_key(vendor_name)) stored,
  invoice_no  text,
  description text,
  account     text,                            -- as exported
  fund        text,                            -- Iowa fund code, e.g. '10' General, '33' SAVE, '36' PPEL
  func        text,                            -- function code, e.g. '2600' operations & maintenance
  obj         text,                            -- object code, e.g. '611' supplies
  amount      numeric not null,
  method      text                             -- check / ACH / card / manual
);
create index if not exists register_line_import on public.register_line (import_id);
create index if not exists register_line_vendor on public.register_line (tenant_id, vendor_key);
create index if not exists register_line_date   on public.register_line (tenant_id, pay_date);
create index if not exists register_line_trgm   on public.register_line using gin (vendor_key gin_trgm_ops);

-- The vendor dictionary: decode a cryptic name once, keep it for every later month.
create table if not exists public.vendor_note (
  tenant_id   text not null,
  vendor_key  text not null,
  plain_label text,                            -- 'custodial and building supplies'
  category    text,
  expected    boolean,                         -- reviewed and normal for this district
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, vendor_key)
);

-- Rule switches and thresholds. tenant_id '*' is the default; a district row overrides it.
create table if not exists public.register_rule (
  tenant_id text not null,
  rule      text not null,
  enabled   boolean not null default true,
  params    jsonb not null default '{}',
  primary key (tenant_id, rule)
);
insert into public.register_rule (tenant_id, rule, params) values
  ('*', 'new_vendor',          '{}'),
  ('*', 'vendor_name_change',  '{}'),
  ('*', 'lookalike_vendor',    '{"similarity": 0.6}'),
  ('*', 'duplicate_payment',   '{"days": 45}'),
  -- ASSUMED: no default bid threshold. Set it from the district's purchasing policy (705.1).
  ('*', 'near_threshold',      '{"threshold": null, "within_pct": 10}'),
  ('*', 'split_purchase',      '{"threshold": null, "days": 14}'),
  ('*', 'vendor_spike',        '{"multiple": 3, "min_gap": 5000, "min_months": 3}'),
  ('*', 'account_spike',       '{"pct": 50, "min_gap": 10000}'),
  -- ASSUMED: salary (1xx) and benefit (2xx) objects charged to SAVE (33) or PPEL (36) deserve a
  -- question. Some are legitimate; the flag asks, it doesn't accuse. Confirm with the business office.
  ('*', 'restricted_fund_use', '{"funds": ["33","36"], "object_prefixes": ["1","2"]}'),
  ('*', 'round_amount',        '{"min": 5000, "multiple": 1000}'),
  ('*', 'weekend_date',        '{}'),
  ('*', 'missing_info',        '{}')
on conflict do nothing;

create table if not exists public.register_flag (
  id          bigserial primary key,
  tenant_id   text not null,
  import_id   uuid not null references public.register_import(id) on delete cascade,
  line_id     bigint references public.register_line(id) on delete cascade,
  vendor_key  text,
  rule        text not null,
  severity    text not null check (severity in ('info','question','concern')),
  question    text not null,                   -- phrased as a question to the business office
  detail      jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open','explained','dismissed')),
  response    text,
  resolved_by text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists register_flag_import on public.register_flag (import_id, status);

alter table public.register_import enable row level security;
alter table public.register_line   enable row level security;
alter table public.vendor_note     enable row level security;
alter table public.register_rule   enable row level security;
alter table public.register_flag   enable row level security;

do $$ declare t text; begin
  foreach t in array array['register_import','register_line','vendor_note','register_flag'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "members insert" on public.%I', t);
    execute format('drop policy if exists "members update" on public.%I', t);
    execute format('drop policy if exists "admins delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.cip_can_write(tenant_id))', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.cip_can_write(tenant_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.cip_can_write(tenant_id)) with check (public.cip_can_write(tenant_id))', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.cip_is_admin(tenant_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.register_line_id_seq, public.register_flag_id_seq to authenticated;
drop policy if exists "rules read"  on public.register_rule;
drop policy if exists "rules write" on public.register_rule;
drop policy if exists "rules change" on public.register_rule;
create policy "rules read"   on public.register_rule for select to authenticated using (tenant_id = '*' or public.cip_can_write(tenant_id));
create policy "rules write"  on public.register_rule for insert to authenticated with check (tenant_id <> '*' and public.cip_is_admin(tenant_id));
create policy "rules change" on public.register_rule for update to authenticated
  using (tenant_id <> '*' and public.cip_is_admin(tenant_id)) with check (tenant_id <> '*' and public.cip_is_admin(tenant_id));
grant select, insert, update on public.register_rule to authenticated;

-- Effective rule params for a tenant (district row wins over '*').
create or replace function public.register_rule_for(p_tenant text, p_rule text)
returns jsonb language sql stable set search_path = public as $$
  select case when enabled then params else null end
  from register_rule where rule = p_rule and tenant_id in (p_tenant, '*')
  order by (tenant_id = '*') limit 1
$$;

-- Run every rule against one import. History = all lines from this district's imports whose
-- period starts before this one. Re-running replaces the open flags; answered flags are kept.
-- For a historical backfill, call register_check_all(tenant) once after loading all months.
create or replace function public.register_check(p_import uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  imp register_import; p jsonb; v_hist int; v_n int; v_total int := 0; v_counts jsonb := '{}';
begin
  select * into imp from register_import where id = p_import;
  -- Runs with owner rights (so editors can replace open flags), so check access here:
  -- signed-in callers must be members of the district; direct database sessions (staff
  -- backfill with the database password) and the service role are allowed.
  if not found
     or (auth.jwt() ? 'role' and auth.jwt()->>'role' <> 'service_role' and not cip_can_write(imp.tenant_id)) then
    raise exception 'import % not found (or no access)', p_import;
  end if;

  delete from register_flag where import_id = p_import and status = 'open';

  create temp table if not exists _cur  (like register_line) on commit drop;
  create temp table if not exists _hist (like register_line) on commit drop;
  truncate _cur; truncate _hist;
  insert into _cur  select l.* from register_line l where l.import_id = p_import;
  insert into _hist select l.* from register_line l join register_import i on i.id = l.import_id
                    where i.tenant_id = imp.tenant_id and i.period_start < imp.period_start;
  select count(*) into v_hist from _hist;

  -- 1 new vendor (only meaningful once there is history)
  p := register_rule_for(imp.tenant_id, 'new_vendor');
  if p is not null and v_hist > 0 then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, min(c.id), c.vendor_key, 'new_vendor',
           case when sum(c.amount) >= 10000 then 'question' else 'info' end,
           'First payment to ' || max(c.vendor_name) || ' ($' || to_char(sum(c.amount), 'FM999,999,990.00') || '). What was it for, and who approved adding this vendor?',
           jsonb_build_object('total', sum(c.amount), 'payments', count(*))
    from _cur c
    where not exists (select 1 from _hist h where h.vendor_key = c.vendor_key)
      and not exists (select 1 from vendor_note n where n.tenant_id = imp.tenant_id and n.vendor_key = c.vendor_key and n.expected)
    group by c.vendor_key;
  end if;

  -- 2 same vendor number, different name
  p := register_rule_for(imp.tenant_id, 'vendor_name_change');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, min(c.id), c.vendor_key, 'vendor_name_change', 'concern',
           'Vendor #' || c.vendor_no || ' is now "' || max(c.vendor_name) || '" but was paid as "' ||
           (select h.vendor_name from _hist h where h.vendor_no = c.vendor_no and h.vendor_key <> c.vendor_key order by h.pay_date desc nulls last limit 1) ||
           '" before. Who changed the vendor record, and was the change verified with the vendor?',
           jsonb_build_object('vendor_no', c.vendor_no, 'total', sum(c.amount))
    from _cur c
    where c.vendor_no is not null and c.vendor_no <> ''
      and exists (select 1 from _hist h where h.vendor_no = c.vendor_no and h.vendor_key <> c.vendor_key)
    group by c.vendor_no, c.vendor_key;
  end if;

  -- 3 new vendor whose name looks like an existing one ('ACME SUPPLY' vs 'ACME SUPPLIES')
  p := register_rule_for(imp.tenant_id, 'lookalike_vendor');
  if p is not null and v_hist > 0 then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, x.line_id, x.vendor_key, 'lookalike_vendor', 'question',
           '"' || x.vendor_name || '" is new and looks like existing vendor "' || x.similar_to ||
           '". Is it the same company under a second vendor record?',
           jsonb_build_object('similar_to', x.similar_to, 'similarity', round(x.sim::numeric, 2))
    from (
      select distinct on (c.vendor_key) c.id line_id, c.vendor_key, c.vendor_name, h.vendor_key similar_to,
             similarity(c.vendor_key, h.vendor_key) sim
      from _cur c join (select distinct vendor_key from _hist) h
        on h.vendor_key <> c.vendor_key and similarity(c.vendor_key, h.vendor_key) >= (p->>'similarity')::numeric
      where not exists (select 1 from _hist h2 where h2.vendor_key = c.vendor_key)
      order by c.vendor_key, sim desc
    ) x;
  end if;

  -- 4 duplicate payment: same vendor and invoice number, or same vendor and amount within N days
  p := register_rule_for(imp.tenant_id, 'duplicate_payment');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select distinct on (c.id) imp.tenant_id, p_import, c.id, c.vendor_key, 'duplicate_payment',
           case when c.invoice_no is not null and c.invoice_no = o.invoice_no then 'concern' else 'question' end,
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name ||
           case when c.invoice_no is not null and c.invoice_no = o.invoice_no
                then ' for invoice ' || c.invoice_no || ' was also paid on ' || coalesce(o.pay_date::text, 'an earlier date') || '. Was this paid twice?'
                else ' matches a payment of the same amount on ' || coalesce(o.pay_date::text, '?') || '. Two separate purchases, or a double payment?' end,
           jsonb_build_object('other_line', o.id, 'other_date', o.pay_date, 'invoice', c.invoice_no)
    from _cur c
    join (select * from _hist union all select * from _cur) o
      on o.id <> c.id and o.vendor_key = c.vendor_key and c.amount > 0
     and ((c.invoice_no is not null and c.invoice_no <> '' and c.invoice_no = o.invoice_no)   -- same invoice, any amount
          or (o.amount = c.amount and abs(coalesce(c.pay_date - o.pay_date, 999)) <= (p->>'days')::int))
    where (o.import_id <> p_import or o.id < c.id)   -- within one month, flag the later line only
    order by c.id, (c.invoice_no = o.invoice_no) desc nulls last;
  end if;

  -- 5 just under the bid / quote threshold
  p := register_rule_for(imp.tenant_id, 'near_threshold');
  if p is not null and (p->>'threshold') is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, c.id, c.vendor_key, 'near_threshold', 'question',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' is just under the $' ||
           to_char((p->>'threshold')::numeric, 'FM999,999,990') || ' purchasing threshold. Were quotes or bids obtained?',
           jsonb_build_object('threshold', (p->>'threshold')::numeric)
    from _cur c
    where c.amount < (p->>'threshold')::numeric
      and c.amount >= (p->>'threshold')::numeric * (1 - (p->>'within_pct')::numeric / 100);
  end if;

  -- 6 split purchase: several payments to one vendor, each under the threshold, together over it
  p := register_rule_for(imp.tenant_id, 'split_purchase');
  if p is not null and (p->>'threshold') is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, min(c.id), c.vendor_key, 'split_purchase', 'question',
           count(*) || ' payments to ' || max(c.vendor_name) || ' within ' || (p->>'days') || ' days total $' ||
           to_char(sum(c.amount), 'FM999,999,990.00') || ', each under the $' || to_char((p->>'threshold')::numeric, 'FM999,999,990') ||
           ' threshold. One purchase split into parts?',
           jsonb_build_object('payments', count(*), 'total', sum(c.amount), 'first', min(c.pay_date), 'last', max(c.pay_date))
    from _cur c
    where c.amount < (p->>'threshold')::numeric and c.pay_date is not null
    group by c.vendor_key
    having count(*) >= 2 and sum(c.amount) >= (p->>'threshold')::numeric
       and max(c.pay_date) - min(c.pay_date) <= (p->>'days')::int;
  end if;

  -- 7 vendor spike: this month's total vs the vendor's typical month over the past year
  p := register_rule_for(imp.tenant_id, 'vendor_spike');
  if p is not null and v_hist > 0 then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, null, cur.vendor_key, 'vendor_spike', 'question',
           cur.vendor_name || ': $' || to_char(cur.total, 'FM999,999,990') || ' this period vs a typical $' ||
           to_char(h.med, 'FM999,999,990') || ' a month over the past year. What drove the increase?',
           jsonb_build_object('total', cur.total, 'typical_month', round(h.med), 'months', h.months)
    from (select vendor_key, max(vendor_name) vendor_name, sum(amount) total from _cur group by vendor_key) cur
    join (select vendor_key, count(*) months, percentile_cont(0.5) within group (order by m_total)::numeric med
          from (select h.vendor_key, h.import_id, sum(h.amount) m_total
                from _hist h join register_import i on i.id = h.import_id
                where i.period_start >= imp.period_start - interval '12 months'
                group by h.vendor_key, h.import_id) m
          group by vendor_key) h using (vendor_key)
    where h.months >= (p->>'min_months')::int
      and cur.total > h.med * (p->>'multiple')::numeric
      and cur.total - h.med >= (p->>'min_gap')::numeric;
  end if;

  -- 8 account spike: fund + function total vs the same period a year earlier
  p := register_rule_for(imp.tenant_id, 'account_spike');
  if p is not null and v_hist > 0 then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, null, null, 'account_spike', 'question',
           'Fund ' || cur.fund || ', function ' || cur.func || ': $' || to_char(cur.total, 'FM999,999,990') ||
           ' vs $' || to_char(ly.total, 'FM999,999,990') || ' in the same period last year (+' ||
           round(100 * (cur.total - ly.total) / ly.total) || '%). Planned, or something to explain?',
           jsonb_build_object('fund', cur.fund, 'func', cur.func, 'total', cur.total, 'last_year', ly.total)
    from (select fund, func, sum(amount) total from _cur where fund is not null and func is not null group by 1, 2) cur
    join (select h.fund, h.func, sum(h.amount) total
          from _hist h join register_import i on i.id = h.import_id
          where i.period_start >= imp.period_start - interval '12 months 7 days'
            and i.period_start <= imp.period_start - interval '11 months 23 days'
          group by 1, 2) ly using (fund, func)
    where ly.total > 0
      and cur.total > ly.total * (1 + (p->>'pct')::numeric / 100)
      and cur.total - ly.total >= (p->>'min_gap')::numeric;
  end if;

  -- 9 restricted fund paying for something it usually can't (ASSUMED code lists, see rule params)
  p := register_rule_for(imp.tenant_id, 'restricted_fund_use');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, c.id, c.vendor_key, 'restricted_fund_use', 'question',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' is charged to fund ' || c.fund ||
           ' with object ' || c.obj || '. Is this an allowed use of that fund?',
           jsonb_build_object('fund', c.fund, 'obj', c.obj, 'account', c.account)
    from _cur c
    where c.fund in (select jsonb_array_elements_text(p->'funds'))
      and c.obj is not null
      and left(c.obj, 1) in (select jsonb_array_elements_text(p->'object_prefixes'));
  end if;

  -- 10 large round-dollar amounts
  p := register_rule_for(imp.tenant_id, 'round_amount');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, c.id, c.vendor_key, 'round_amount', 'info',
           'Round amount: $' || to_char(c.amount, 'FM999,999,990') || ' to ' || c.vendor_name || '. Invoice, deposit or estimate?',
           '{}'::jsonb
    from _cur c
    where c.amount >= (p->>'min')::numeric and mod(c.amount, (p->>'multiple')::numeric) = 0;
  end if;

  -- 11 paid on a weekend
  p := register_rule_for(imp.tenant_id, 'weekend_date');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, c.id, c.vendor_key, 'weekend_date', 'info',
           'Dated ' || to_char(c.pay_date, 'Dy Mon DD') || ': $' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || '. Off-cycle payment?',
           '{}'::jsonb
    from _cur c where extract(isodow from c.pay_date) in (6, 7);
  end if;

  -- 12 can't tell what it is
  p := register_rule_for(imp.tenant_id, 'missing_info');
  if p is not null then
    insert into register_flag (tenant_id, import_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.tenant_id, p_import, c.id, c.vendor_key, 'missing_info', 'info',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' has no description or account code. What was it for?',
           '{}'::jsonb
    from _cur c where coalesce(c.description, '') = '' and coalesce(c.account, c.fund, '') = '';
  end if;

  -- a question already answered for this line and rule isn't asked again
  delete from register_flag n
  using register_flag a
  where n.import_id = p_import and n.status = 'open' and a.import_id = p_import and a.status <> 'open'
    and a.rule = n.rule and coalesce(a.line_id, 0) = coalesce(n.line_id, 0)
    and coalesce(a.vendor_key, '') = coalesce(n.vendor_key, '');

  update register_import set checked_at = now(),
    row_count = (select count(*) from _cur), total = (select sum(amount) from _cur)
  where id = p_import;

  select coalesce(jsonb_object_agg(rule, n), '{}'), coalesce(sum(n), 0) into v_counts, v_total
  from (select rule, count(*) n from register_flag where import_id = p_import and status = 'open' group by rule) s;
  return jsonb_build_object('import_id', p_import, 'open_flags', v_total, 'by_rule', v_counts, 'history_lines', v_hist);
end $$;
revoke all on function public.register_check(uuid) from public, anon;
grant execute on function public.register_check(uuid) to authenticated;

-- Backfill: check every import for a district in date order (use after loading past months).
create or replace function public.register_check_all(p_tenant text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare i record; out jsonb := '[]';
begin
  for i in select id, period_start from register_import where tenant_id = p_tenant order by period_start loop
    out := out || jsonb_build_array(jsonb_build_object('period_start', i.period_start) || register_check(i.id));
  end loop;
  return out;
end $$;
grant execute on function public.register_check_all(text) to authenticated;

-- (No random-sample function in the first release: it would add a manual review step.
--  Removed 2026-10-06 at Leslie's request; drop it if an earlier run created it.)
drop function if exists public.register_sample(uuid, int);

-- One-page summary for the month: totals by fund, top vendors, flags.
create or replace function public.register_summary(p_import uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', (select sum(amount) from register_line where import_id = p_import),
    'lines', (select count(*) from register_line where import_id = p_import),
    'by_fund', (select coalesce(jsonb_object_agg(coalesce(fund, '?'), t), '{}')
                from (select fund, sum(amount) t from register_line where import_id = p_import group by fund) s),
    'top_vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor', v, 'label', lbl, 'total', t) order by t desc), '[]')
                    from (select max(l.vendor_name) v, max(n.plain_label) lbl, sum(l.amount) t
                          from register_line l
                          left join vendor_note n on n.tenant_id = l.tenant_id and n.vendor_key = l.vendor_key
                          where l.import_id = p_import group by l.vendor_key order by 3 desc limit 10) s),
    'flags', (select coalesce(jsonb_object_agg(severity, n), '{}')
              from (select severity, count(*) n from register_flag where import_id = p_import and status = 'open' group by 1) s)
  )
$$;
grant execute on function public.register_summary(uuid) to authenticated;

-- Check: lists the new tables with rls_on = true.
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (c.relname like 'ia\_%' or c.relname like 'register\_%' or c.relname in ('district_state_link','district_peer','benchmark_rule','vendor_note'))
order by 1;
