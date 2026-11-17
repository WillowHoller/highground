-- =====================================================================================
-- HighGround database — part 35: Nebraska public data (12 Nov 2026)
-- Run after part 34. Paste into Supabase → SQL Editor and Run. Safe to run twice.
--
-- (ne_lc2: NDE's statewide LC-2 budget submission totals, the adopted year)
-- (ne_budget: NDE's certified General Fund budget authority and allowable reserve percentage, "budget factors")
-- Tables (filled each month by loader/load_nebraska.py in the "Nebraska public data" GitHub workflow):
--   ne_district  NDE agency IDs (county-district number, 01-0003-000), names, county, class
--   ne_stat      NDE "Statistical Information for Public School Districts": valuation, levies (general, bond,
--                special building, QCPUF) and fall membership, by school year
--   ne_aid       NDE state aid certification (TEEOSA): "State Aid Calculated by System" + "Formula Students"
--   ne_pta       NDE property tax request authority certification (incl. prior years' unused authority)
--   ne_afr       every account of each district's Annual Financial Report (sfos.education.ne.gov), by year
--   ne_measure   per-pupil and percentage measures for peer comparisons (ne_refresh_measures)
-- Functions: ne_prefill(agency) for Starting numbers and the General Fund; ne_benchmark(...) for peer callouts;
-- ne_district_search(q) for linking a district. Fiscal years are named for the year they end (2025/26 = 2026).
-- Public reports only; no student-level data.
-- =====================================================================================
set search_path = public, extensions;

create table if not exists public.ne_district (
  agency_id  text primary key check (agency_id ~ '^\d{2}-\d{4}-\d{3}$'),
  name       text not null,
  county     text,
  class      text,
  loaded_at  timestamptz not null default now()
);
create table if not exists public.ne_stat (
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,
  valuation   numeric, gen_levy numeric, bond_levy numeric, sb_levy numeric, qcpuf_levy numeric, total_levy numeric,
  mem_pk int, mem_k12 int, mem_total int,
  source text, loaded_at timestamptz not null default now(),
  primary key (agency_id, fiscal_year)
);
create table if not exists public.ne_aid (
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,              -- the certification's school year (2026/27 = 2027)
  formula_need numeric, local_effort numeric, option_funding numeric, income_tax numeric, other_receipts numeric,
  foundation_in numeric, total_resources numeric, foundation_out numeric, eq_aid numeric, calc_aid numeric,
  formula_students numeric, adj_gfoe numeric,
  source text, loaded_at timestamptz not null default now(),
  primary key (agency_id, fiscal_year)
);
create table if not exists public.ne_pta (
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,              -- the year the authority is for (2026/27 = 2027)
  gf_ask numeric, sb_ask numeric, total_request numeric, total_revenue numeric, g_member numeric, g_lep numeric, g_poverty numeric, base_growth_rate numeric, revenue_cap numeric,
  prior_unused numeric, authority numeric, board_pct numeric, board_extra numeric, authority_with_board numeric,
  source text, loaded_at timestamptz not null default now(),
  primary key (agency_id, fiscal_year)
);
create table if not exists public.ne_budget (   -- NDE certified General Fund budget authority (79-1023), by the year it's for
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,
  authority numeric, method text, reserve_pct numeric, formula_need numeric, gfbe numeric, sgf numeric, sped numeric, gfle numeric,
  adjusted numeric, two_pct numeric, unused numeric, sga numeric, sgacorr numeric,
  source text, loaded_at timestamptz not null default now(),
  primary key (agency_id, fiscal_year)
);
create table if not exists public.ne_lc2 (   -- NDE's statewide LC-2 budget submission totals: each district's adopted budget year
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,
  budget_authority numeric, unused_access numeric, total_allowable numeric, gf_budget numeric, sgf numeric, sped numeric, gfle numeric,
  adj_budget numeric, unused_budget numeric, budget_vote numeric, override_levy numeric, override_years numeric, override_first numeric,
  override_last numeric, valuation numeric, reserve_pct numeric, gf_reserve numeric, depreciation_req numeric, eb_reserve numeric, pta numeric,
  board_extra numeric, pta_vote numeric, gf_request numeric, sb_request numeric, total_request numeric, unused_pta numeric,
  source text, loaded_at timestamptz not null default now(),
  primary key (agency_id, fiscal_year)
);
alter table public.ne_aid add column if not exists basic_funding numeric, add column if not exists sga numeric, add column if not exists sgacorr numeric,
  add column if not exists poverty_allowance numeric, add column if not exists lep_allowance numeric,
  -- NDE's "Calculation of Prior Year Correction": last year's certified aid, recalculated with final data; the difference is paid
  -- or taken back with this year's aid (79-1065)
  add column if not exists prior_cert_aid numeric, add column if not exists prior_recalc_aid numeric, add column if not exists prior_year_corr numeric;
-- the LC-2's yes/no answers and the authority a pre-2024 levy override adds (79-3405(3)); override_first / override_last are
-- HighGround fiscal years (the year a school year ends): NDE's first year 2023 with expiry 2028 is 2023/24 to 2027/28
alter table public.ne_lc2 add column if not exists override_on numeric, add column if not exists board_vote numeric,
  add column if not exists ov_authority numeric;
alter table public.ne_pta add column if not exists g_member numeric, add column if not exists g_lep numeric, add column if not exists g_poverty numeric;
create table if not exists public.ne_afr (
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,
  account     text not null,              -- NDE code, e.g. 08-0-CSHOH-END, 01-1-03110-000, 01-2-01100-100's
  description text,
  amount      numeric,
  primary key (agency_id, fiscal_year, account)
);
create index if not exists ne_afr_year on public.ne_afr (fiscal_year);
create table if not exists public.ne_measure (
  agency_id   text not null references public.ne_district(agency_id) on delete cascade,
  fiscal_year int  not null,
  measure_key text not null,              -- kind|fund|line, as Iowa's: exp|General|TOTAL, bal|General|RESERVE_PCT ...
  grp text, fund text, line text, unit text, amount numeric, value numeric,
  primary key (agency_id, fiscal_year, measure_key)
);
create table if not exists public.ne_load_run (
  id bigint generated always as identity primary key,
  kind text not null, source_url text, sha256 text, rows_read int, rows_loaded int, years text,
  status text not null default 'ok', message text, ran_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['ne_district','ne_stat','ne_aid','ne_pta','ne_budget','ne_lc2','ne_afr','ne_measure','ne_load_run'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ne read" on public.%I', t);
    execute format('create policy "ne read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- a district's AFR, summed (cash = on hand + at the county treasurer) ----------
create or replace function public.ne_afr_amt(p_agency text, p_fy int, p_pattern text)
returns numeric language sql stable set search_path = public as $$
  select sum(amount) from ne_afr where agency_id = p_agency and fiscal_year = p_fy and account like p_pattern
$$;

-- ---------- measures for peer comparisons ----------
create or replace function public.ne_refresh_measures(p_fy int)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  delete from ne_measure where fiscal_year = p_fy;
  with base as (
    select a.agency_id, s.mem_total::numeric as mem, s.valuation, s.gen_levy, s.sb_levy, s.total_levy,
           ne_afr_amt(a.agency_id, p_fy, '01-2-20400-000') as gf_exp,
           ne_afr_amt(a.agency_id, p_fy, '01-1-10000-000') as gf_rev,
           ne_afr_amt(a.agency_id, p_fy, '01-1-03110-000') as state_aid,
           coalesce(ne_afr_amt(a.agency_id, p_fy, '01-0-%-END'), 0) as gf_cash,
           coalesce(ne_afr_amt(a.agency_id, p_fy, '02-0-%-END'), 0) as dep_cash,
           coalesce(ne_afr_amt(a.agency_id, p_fy, '03-0-%-END'), 0) as eb_cash,
           ne_afr_amt(a.agency_id, p_fy, '08-0-%-END') as sb_cash,
           ne_afr_amt(a.agency_id, p_fy, '08-1-10000-000') - coalesce(ne_afr_amt(a.agency_id, p_fy, '08-1-05100-000'), 0) as sb_rev,
           ne_afr_amt(a.agency_id, p_fy, '08-2-20500-000') as sb_exp,
           ne_afr_amt(a.agency_id, p_fy, '01-2-01000-000') as instr,
           ne_afr_amt(a.agency_id, p_fy, '01-2-02600-000') as om,
           coalesce(ne_afr_amt(a.agency_id, p_fy, '01-2-027X0-000'), 0) + coalesce(ne_afr_amt(a.agency_id, p_fy, '01-2-027X2-000'), 0) as transp,
           coalesce(ne_afr_amt(a.agency_id, p_fy, '01-2-02300-000'), 0) + coalesce(ne_afr_amt(a.agency_id, p_fy, '01-2-02400-000'), 0) + coalesce(ne_afr_amt(a.agency_id, p_fy, '01-2-02500-000'), 0) as admin,
           (select sum(amount) from ne_afr x where x.agency_id = a.agency_id and x.fiscal_year = p_fy and x.account like '%-2-20500-000') as all_exp
    from (select distinct agency_id from ne_afr where fiscal_year = p_fy) a
    join ne_stat s on s.agency_id = a.agency_id and s.fiscal_year = p_fy
    where s.mem_total > 0
  ), m(agency_id, measure_key, grp, fund, line, unit, amount, value) as (
    select agency_id, 'exp|General|TOTAL', 'main', 'General', 'TOTAL', 'per_pupil', gf_exp, gf_exp / mem from base where gf_exp is not null
    union all select agency_id, 'rev|General|TOTAL', 'main', 'General', 'TOTAL', 'per_pupil', gf_rev, gf_rev / mem from base where gf_rev is not null
    union all select agency_id, 'rev|General|State aid', 'main', 'General', 'State aid', 'per_pupil', state_aid, state_aid / mem from base where state_aid is not null
    union all select agency_id, 'exp|General|Instruction', 'main', 'General', 'Instruction', 'per_pupil', instr, instr / mem from base where instr is not null
    union all select agency_id, 'exp|General|Operation and maintenance', 'main', 'General', 'Operation and maintenance', 'per_pupil', om, om / mem from base where om is not null
    union all select agency_id, 'exp|General|Student transportation', 'main', 'General', 'Student transportation', 'per_pupil', transp, transp / mem from base
    union all select agency_id, 'exp|General|Administration', 'main', 'General', 'Administration', 'per_pupil', admin, admin / mem from base
    union all select agency_id, 'bal|General|RESERVE_PCT', 'main', 'General', 'RESERVE_PCT', 'pct', gf_cash + dep_cash + eb_cash,
                     round(100 * (gf_cash + dep_cash + eb_cash) / nullif(gf_exp, 0), 1) from base where gf_exp > 0
    union all select agency_id, 'bal|Special Building|ENDING', 'main', 'Special Building', 'ENDING', 'per_pupil', sb_cash, sb_cash / mem from base where sb_cash is not null
    union all select agency_id, 'rev|Special Building|TOTAL', 'main', 'Special Building', 'TOTAL', 'per_pupil', sb_rev, sb_rev / mem from base where sb_rev is not null
    union all select agency_id, 'exp|Special Building|TOTAL', 'main', 'Special Building', 'TOTAL', 'per_pupil', sb_exp, sb_exp / mem from base where sb_exp is not null
    union all select agency_id, 'bal|Depreciation|ENDING', 'main', 'Depreciation', 'ENDING', 'per_pupil', dep_cash, dep_cash / mem from base
    union all select agency_id, 'exp|ALL|TOTAL', 'main', 'ALL', 'TOTAL', 'per_pupil', all_exp, all_exp / mem from base where all_exp is not null
    union all select agency_id, 'val|ALL|VALUATION', 'detail', 'ALL', 'VALUATION', 'per_pupil', valuation, valuation / mem from base where valuation is not null
    union all select agency_id, 'lev|General|LEVY', 'main', 'General', 'LEVY', 'pct', null, gen_levy from base where gen_levy is not null
    union all select agency_id, 'lev|ALL|LEVY', 'main', 'ALL', 'LEVY', 'pct', null, total_levy from base where total_levy is not null
  )
  insert into ne_measure (agency_id, fiscal_year, measure_key, grp, fund, line, unit, amount, value)
  select agency_id, p_fy, measure_key, grp, fund, line, unit, amount, value from m where value is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- size bands (fall membership) ----------
create or replace function public.ne_band(p_mem numeric) returns int language sql immutable as $$
  select case when p_mem is null then null when p_mem < 250 then 1 when p_mem < 400 then 2 when p_mem < 600 then 3
              when p_mem < 1000 then 4 when p_mem < 2500 then 5 when p_mem < 7500 then 6 else 7 end
$$;
create or replace function public.ne_band_label(p int) returns text language sql immutable as $$
  select case p when 1 then 'under 250 students' when 2 then '250–399 students' when 3 then '400–599 students'
                when 4 then '600–999 students' when 5 then '1,000–2,499 students' when 6 then '2,500–7,499 students'
                else '7,500 or more students' end
$$;

-- ---------- peer callouts: the same shape and rules as ia_benchmark (part 16), so the app's card is shared ----------
create or replace function public.ne_benchmark(p_agency text, p_fy int, p_district uuid default null)
returns table(measure_key text, grp text, fund text, line text, unit text, amount numeric, value numeric, peer_group text, peer_n integer,
              peer_mean numeric, peer_median numeric, peer_p25 numeric, peer_p75 numeric, pct_rank numeric, vs_mean_pct numeric,
              prior_value numeric, change_pct numeric, peer_change_median_pct numeric, flag text, callout text)
language plpgsql stable set search_path = public as $function$
#variable_conflict use_column
declare r benchmark_rule; v_band int; v_label text;
begin
  select * into r from benchmark_rule where district_id = p_district;
  if not found then select * into r from benchmark_rule where district_id is null limit 1; end if;
  select ne_band(mem_total) into v_band from ne_stat where agency_id = p_agency and fiscal_year = p_fy;
  v_label := 'Nebraska districts with ' || ne_band_label(v_band);
  return query
  with peers as (select s.agency_id from ne_stat s where s.fiscal_year = p_fy and s.agency_id <> p_agency and ne_band(s.mem_total) = v_band),
  me as (select * from ne_measure m where m.agency_id = p_agency and m.fiscal_year = p_fy),
  me_prior as (select m.measure_key, m.value from ne_measure m where m.agency_id = p_agency and m.fiscal_year = p_fy - 1),
  pv as (select me.measure_key, p.agency_id, pm.value as v from me cross join peers p
         left join ne_measure pm on pm.agency_id = p.agency_id and pm.fiscal_year = p_fy and pm.measure_key = me.measure_key),
  pchg as (select me.measure_key, percentile_cont(0.5) within group (order by 100.0 * (c.value - o.value) / abs(o.value)) as med
           from me join peers p on true
           join ne_measure c on c.agency_id = p.agency_id and c.fiscal_year = p_fy and c.measure_key = me.measure_key
           join ne_measure o on o.agency_id = p.agency_id and o.fiscal_year = p_fy - 1 and o.measure_key = me.measure_key
           where o.value <> 0 group by me.measure_key),
  st as (select pv.measure_key, count(v)::int n, avg(v) mean, percentile_cont(0.5) within group (order by v) med,
                percentile_cont(0.25) within group (order by v) p25, percentile_cont(0.75) within group (order by v) p75
         from pv where v is not null group by pv.measure_key),
  rk as (select me.measure_key, (count(*) filter (where pv.v < me.value) + 0.5 * count(*) filter (where pv.v = me.value)) / nullif(count(pv.v), 0)::numeric as pr
         from me join pv using (measure_key) group by me.measure_key, me.value),
  j as (select me.*, st.n, st.mean, st.med, st.p25, st.p75, rk.pr, round(100 * (me.value - st.mean) / nullif(abs(st.mean), 0), 1) as vsm,
               mp.value as prior, round(100 * (me.value - mp.value) / nullif(abs(mp.value), 0), 1) as chg, round(pchg.med::numeric, 1) as pchg_med
        from me left join st using (measure_key) left join rk using (measure_key) left join me_prior mp using (measure_key) left join pchg using (measure_key)),
  fl as (select j.*, case
           when coalesce(j.n, 0) < r.min_peers or j.grp = 'detail' then null
           when j.unit = 'per_pupil' and coalesce(j.med, 0) = 0 then null
           when j.pr >= r.high_rank and abs(j.value - j.med) >= case when j.unit = 'pct' then r.min_gap_pct else r.min_gap_per_pupil end then 'high'
           when j.pr <= r.low_rank and abs(j.value - j.med) >= case when j.unit = 'pct' then r.min_gap_pct else r.min_gap_per_pupil end then 'low'
           when j.unit = 'per_pupil' and j.chg is not null and j.pchg_med is not null and abs(j.chg - j.pchg_med) >= r.yoy_jump_pct
                and abs(j.value - j.prior) >= r.yoy_min_per_pupil and abs(j.prior) >= r.yoy_min_per_pupil then 'jump'
           else null end as flag from j)
  select fl.measure_key, fl.grp, fl.fund, fl.line, fl.unit, fl.amount, fl.value, v_label, fl.n, round(fl.mean, 2), round(fl.med::numeric, 2),
         round(fl.p25::numeric, 2), round(fl.p75::numeric, 2), round(fl.pr, 3), fl.vsm, fl.prior, fl.chg, fl.pchg_med, fl.flag,
         case fl.flag
           when 'high' then case when fl.unit = 'pct' then fl.value || '% — above ' || round(100 * fl.pr) || '% of ' || fl.n || ' ' || v_label || ' (median ' || round(fl.med::numeric, 1) || '%)'
             else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || (case when fl.vsm >= 100 then round(1 + fl.vsm / 100, 1) || '× the average of ' else round(abs(fl.vsm)) || '% above the average of ' end) || fl.n || ' ' || v_label || ' (higher than ' || round(100 * fl.pr) || '% of them)' end
           when 'low' then case when fl.unit = 'pct' then fl.value || '% — below ' || round(100 * (1 - fl.pr)) || '% of ' || fl.n || ' ' || v_label || ' (median ' || round(fl.med::numeric, 1) || '%)'
             else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || round(abs(fl.vsm)) || '% below the average of ' || fl.n || ' ' || v_label || ' (lower than ' || round(100 * (1 - fl.pr)) || '% of them)' end
           when 'jump' then (case when fl.chg >= 0 then 'Up ' else 'Down ' end) || abs(fl.chg) || '% from last year; ' || v_label || ' moved ' || fl.pchg_med || '% (median)'
         end
  from fl
  order by (fl.flag is null), case when fl.flag = 'jump' then abs(fl.chg - fl.pchg_med) else abs(fl.vsm) end desc nulls last, fl.grp, fl.fund, fl.line;
end $function$;

-- ---------- starting figures for a district (Starting numbers, the General Fund, TEEOSA) ----------
create or replace function public.ne_prefill(p_agency text)
returns jsonb language sql stable set search_path = public as $$
  with st as (select * from ne_stat where agency_id = p_agency order by fiscal_year desc limit 1),
  aid as (select * from ne_aid where agency_id = p_agency order by fiscal_year desc limit 1),
  pta as (select * from ne_pta where agency_id = p_agency order by fiscal_year desc limit 1),
  bud as (select * from ne_budget where agency_id = p_agency order by fiscal_year desc limit 1),
  lc as (select * from ne_lc2 where agency_id = p_agency order by fiscal_year desc limit 1),
  af as (select max(fiscal_year) fy from ne_afr where agency_id = p_agency and account = '01-2-20400-000'),
  a as (select account, amount from ne_afr, af where agency_id = p_agency and fiscal_year = af.fy),
  s as (select (select sum(amount) from a where account like p) v, p from unnest(array[
          '01-0-%-END','02-0-%-END','08-0-%-END','09-0-%-END','03-0-%-END',
          '08-1-10000-000','08-1-05100-000','08-1-09%','09-1-10000-000','09-1-05100-000','02-1-05200-000',
          '01-1-10000-000','01-1-01100-000','01-1-03130-000','01-1-03131-000','01-1-03110-000','01-1-03120-000','01-1-03000-000','01-1-05000-000',
          '01-2-20400-000','07-2-05000-000','08-2-05000-000',
          '04-0-%-END','03-1-05200-000','03-2-20500-000','04-1-05200-000','04-2-20500-000']) p)
  select case when not exists (select 1 from ne_district where agency_id = p_agency) then null else jsonb_build_object(
    'agency_id', p_agency,
    'name', (select name from ne_district where agency_id = p_agency),
    'class', (select class from ne_district where agency_id = p_agency),
    'stat', (select jsonb_build_object('fiscal_year', fiscal_year, 'valuation', valuation, 'gen_levy', gen_levy, 'bond_levy', bond_levy,
                    'sb_levy', sb_levy, 'qcpuf_levy', qcpuf_levy, 'total_levy', total_levy, 'mem_total', mem_total, 'mem_k12', mem_k12, 'source', source) from st),
    'aid', (select jsonb_build_object('fiscal_year', fiscal_year, 'formula_need', formula_need, 'local_effort', local_effort, 'option_funding', option_funding,
                   'income_tax', income_tax, 'other_receipts', other_receipts, 'formula_students', formula_students, 'eq_aid', eq_aid, 'calc_aid', calc_aid,
                   'basic_funding', basic_funding, 'sga', sga, 'sgacorr', sgacorr, 'prior_year_corr', prior_year_corr, 'prior_cert_aid', prior_cert_aid,
                   'total_resources', total_resources, 'source', source) from aid),
    'pta', (select jsonb_build_object('fiscal_year', fiscal_year, 'gf_ask', gf_ask, 'sb_ask', sb_ask, 'authority', authority, 'prior_unused', prior_unused,
                   'base_growth_rate', base_growth_rate, 'g_member', g_member, 'g_lep', g_lep, 'g_poverty', g_poverty,
                   'board_pct', board_pct, 'authority_with_board', authority_with_board, 'source', source) from pta),
    'lc2', (select to_jsonb(lc) - 'agency_id' - 'loaded_at' from lc),
    'budget', (select jsonb_build_object('fiscal_year', fiscal_year, 'authority', authority, 'method', method, 'reserve_pct', reserve_pct,
                   'formula_need', formula_need, 'gfbe', gfbe, 'sgf', sgf, 'sped', sped, 'gfle', gfle, 'adjusted', adjusted, 'two_pct', two_pct,
                   'unused', unused, 'sga', sga, 'sgacorr', sgacorr, 'source', source) from bud),
    /* NDE's certified English learner and poverty parts of the base growth, oldest first (the counts behind them aren't
       published by district; HighGround uses their recent average for the years ahead) */
    'pta_hist', (select jsonb_agg(jsonb_build_object('fiscal_year', fiscal_year, 'g_member', g_member, 'g_lep', g_lep, 'g_poverty', g_poverty) order by fiscal_year)
                 from (select * from ne_pta where agency_id = p_agency order by fiscal_year desc limit 4) h),
    /* K-12 fall membership, oldest first: the base growth percentage counts its yearly rise (79-3402(3)) */
    'mem_hist', (select jsonb_agg(jsonb_build_object('fiscal_year', fiscal_year, 'k12', mem_k12, 'total', mem_total) order by fiscal_year)
                 from (select * from ne_stat where agency_id = p_agency and mem_k12 is not null order by fiscal_year desc limit 5) h),
    'afr', (select jsonb_build_object('fiscal_year', (select fy from af),
      'balances', jsonb_build_object('general', (select v from s where p = '01-0-%-END'), 'save', (select v from s where p = '02-0-%-END'),
                                     'ppel', (select v from s where p = '08-0-%-END'), 'vppel', (select v from s where p = '09-0-%-END'),
                                     'employee_benefit', (select v from s where p = '03-0-%-END'), 'contingency', (select v from s where p = '04-0-%-END')),
      /* the Employee Benefit (03) and Contingency (04) funds: transfers in from the General Fund, and what they paid out */
      'funds', jsonb_build_object('eb_transfer', (select v from s where p = '03-1-05200-000'), 'eb_paid', (select v from s where p = '03-2-20500-000'),
                                  'cont_transfer', (select v from s where p = '04-1-05200-000'), 'cont_paid', (select v from s where p = '04-2-20500-000')),
      'receipts', jsonb_build_object(
          'ppel', (select v from s where p = '08-1-10000-000') - coalesce((select v from s where p = '08-1-05100-000'), 0) - coalesce((select v from s where p = '08-1-09%'), 0),
          'vppel', (select v from s where p = '09-1-10000-000') - coalesce((select v from s where p = '09-1-05100-000'), 0),
          'save', (select v from s where p = '02-1-05200-000')),
      'general', jsonb_build_object(
          'revenue', (select v from s where p = '01-1-10000-000'),
          'property_tax', coalesce((select v from s where p = '01-1-01100-000'), 0) + coalesce((select v from s where p = '01-1-03130-000'), 0) + coalesce((select v from s where p = '01-1-03131-000'), 0),
          'state_aid', (select v from s where p = '01-1-03110-000'),
          'sped', (select v from s where p = '01-1-03120-000'),
          'other_state', coalesce((select v from s where p = '01-1-03000-000'), 0) - coalesce((select v from s where p = '01-1-03110-000'), 0)
                         - coalesce((select v from s where p = '01-1-03130-000'), 0) - coalesce((select v from s where p = '01-1-03131-000'), 0),
          'other_financing', (select v from s where p = '01-1-05000-000'),
          'expenditures', (select v from s where p = '01-2-20400-000')),
      'debt_payments', jsonb_build_object('debt_levy', (select v from s where p = '07-2-05000-000'), 'ppel', (select v from s where p = '08-2-05000-000')),
      'source', 'NDE Annual Financial Report, ' || ((select fy from af) - 1) || '/' || right(((select fy from af))::text, 2)) where (select fy from af) is not null)
  ) end
$$;

create or replace function public.ne_district_search(q text)
returns table (agency_id text, name text, county text) language sql stable set search_path = public as $$
  select agency_id, name, county from ne_district
  where agency_id = trim(q) or name ilike '%' || trim(q) || '%' order by name limit 20
$$;

-- new functions are callable by everyone (PUBLIC) by default: as with Iowa's (part 16), signed-in people only
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ne\_%' loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
grant execute on function public.ne_prefill(text), public.ne_benchmark(text, int, uuid), public.ne_district_search(text),
                          public.ne_band(numeric), public.ne_band_label(int), public.ne_afr_amt(text, int, text) to authenticated;
revoke execute on function public.ne_refresh_measures(int) from public, anon, authenticated;

-- A lease or a QCPUF bond can be repaid from the QCPUF levy (the vppel slot): 79-10,110.02 lets the board issue bonds against it
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.financing'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%repay_from%';
  if c is not null then execute format('alter table public.financing drop constraint %I', c); end if;
  alter table public.financing add constraint financing_repay_from_check check (repay_from in ('levy','save','ppel','vppel','none'));
end $$;

-- Nebraska rules confirmed 12 Nov 2026 (replaces part 34's recalled values)
insert into public.rule_value (state, key, fy, value, unit, status, source_note, checked_on) values
  ('NE','fiscal_year_start_month',null,9,'month','verified','Neb. Rev. Stat. 79-1091: September 1 to August 31','2026-11-12'),
  ('NE','go_referendum_threshold',null,0.50,'share of votes','verified','Neb. Rev. Stat. 10-702: a majority of the electors voting on the question','2026-11-12'),
  ('NE','ag_land_share',null,0.75,'share of actual value','verified','Neb. Rev. Stat. 77-201(2)','2026-11-12'),
  ('NE','ag_land_share_school_bonds',null,0.50,'share of actual value','verified','Neb. Rev. Stat. 77-201(2): school bond levies for bonds approved by voters on or after 1 Jan 2022','2026-11-12'),
  ('NE','qcpuf_max_rate',null,0.03,'per $100','verified','Neb. Rev. Stat. 79-10,110.02: with 79-10,110 levies, 3¢; up to 10 years; no vote','2026-11-12'),
  ('NE','qcpuf_max_years',null,10,'years','verified','Neb. Rev. Stat. 79-10,110.02','2026-11-12'),
  ('NE','special_building_max_rate',null,0.14,'per $100','verified','Neb. Rev. Stat. 79-10,120','2026-11-12'),
  ('NE','allowable_reserve_471',null,0.45,'share of GF budget','verified','Neb. Rev. Stat. 79-1027 (0–471 ADM; 35% to 3,044; 25% to 10,000; 20% above)','2026-11-12'),
  ('NE','teeosa_local_effort_rate',2027,1.00,'per $100','verified','NDE 2026/27 state aid certification FAQ','2026-11-12'),
  ('NE','teeosa_foundation_per_student',2027,1500,'dollars','verified','NDE 2026/27 FAQ: foundation aid $1,500 per formula student; 60% counted as a resource','2026-11-12'),
  ('NE','base_growth_member_factor_low',null,0.4,'multiplier','verified','Neb. Rev. Stat. 79-3402(3)(b): 1 (avg ≥3% over 3 years and ≥150 students), 0.7 (avg ≥3%), else 0.4; checked against NDE 2026/27 certification','2026-11-12'),
  ('NE','base_growth_lep_poverty_factor',null,0.15,'multiplier','verified','Neb. Rev. Stat. 79-3402(3)(c),(d): rise in LEP / poverty students ÷ fall membership × 0.15','2026-11-12'),
  ('NE','authority_override_vote',null,0.60,'share of votes','verified','Neb. Rev. Stat. 79-3405(1): exceeding the property tax request authority takes 60% of voters','2026-11-12'),
  ('NE','special_building_voter_max_rate',null,0.175,'per $100','recalled','NDE budget instructions and budgeting FAQ: 14¢ by the board, 17.5¢ with a vote of patrons. No statute sets 17.5¢ (full-text search of the Revised Statutes, 14 Nov 2026); 79-10,120 has said 14¢ since at least 2006. The vote is a 77-3444 levy override, which is how HighGround models it','2026-11-14'),
  ('NE','sdptrc_fund',2026,808000000,'dollars','verified','Neb. Rev. Stat. 77-7305(1)(a): School District Property Tax Relief Credit, tax year 2026 (2025 $780M; then $838M, $870M, $902M, +3%)','2026-11-12'),
  ('NE','sdptrc_share',2025,0.262,'share of non-bond school taxes','assumed','$780M ÷ $2,976M non-bond school taxes levied in 2025 (DOR 2025 annual report, table 3D); excludes bonds and 77-3444 overrides (DOR Directive 25-4)','2026-11-12'),
  ('NE','budget_basic_allowable_growth',2027,0.025,'share','verified','Neb. Rev. Stat. 79-1025 and 77-3446: basic allowable growth rate 2.5%; NDE 2026/27 budget instructions','2026-11-12'),
  ('NE','budget_formula_need_share',null,1.10,'multiplier','verified','Neb. Rev. Stat. 79-1023(3): budget authority may be 110% of formula need less special education × 1.025; checked against NDE 2026/27 certified budget authority','2026-11-12'),
  ('NE','budget_unused_use_max',null,0.02,'share of prior adjusted GF expenditures','verified','Neb. Rev. Stat. 79-1030: unused budget authority carries forward; a year may use at most 2% of the prior year''s adjusted General Fund expenditures','2026-11-12'),
  ('NE','go_debt_limit',null,0,'none','verified','No statutory limit on school bonded debt: Neb. Rev. Stat. 10-701 to 10-719 set none; voter-approved bond levies are outside the levy limits (77-3442(1)); checked 14 Nov 2026','2026-11-14'),
  ('NE','levy_override_max_years',null,5,'years','verified','Neb. Rev. Stat. 77-3444: a majority of voters may approve a levy above 77-3442 limits, for at most five years','2026-11-14'),
  ('NE','budget_override_vote',null,0.50,'share of votes','verified','Neb. Rev. Stat. 79-1029: exceeding the General Fund budget authority takes a majority of legal voters','2026-11-14'),
  ('NE','teeosa_need_band',null,0.12,'yearly change, max','verified','Neb. Rev. Stat. 79-1007.11(2),(3): formula need stays between 100% and 112% of the prior year (a student growth adjustment is exempt from the 112%)','2026-11-14'),
  ('NE','contingency_payout_max',null,0.05,'share of GF budget','verified','Neb. Rev. Stat. 79-1072: Contingency Fund, from General Fund transfers; disbursements ≤5% of budgeted General Fund expenditures','2026-11-12')
on conflict (state, key, fy) do update set value = excluded.value, unit = excluded.unit, status = excluded.status, source_note = excluded.source_note, checked_on = excluded.checked_on;

notify pgrst, 'reload schema';

-- ---------- checks: every row should say PASS ----------
select 'Nebraska data tables' as check_name,
       case when (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('ne_district','ne_stat','ne_aid','ne_pta','ne_budget','ne_lc2','ne_afr','ne_measure','ne_load_run')) = 9 then 'PASS' else 'FAIL' end as result
union all
select 'Nebraska functions', case when (select count(*) from pg_proc where proname in ('ne_prefill','ne_benchmark','ne_district_search','ne_refresh_measures')) >= 4 then 'PASS' else 'FAIL' end
union all
select 'Nebraska rules confirmed', case when (select count(*) from public.rule_value where state = 'NE' and status = 'verified') >= 25 then 'PASS' else 'FAIL' end
union all
select 'Readable by signed-in people only', case when (select count(*) from pg_policies where schemaname = 'public' and tablename like 'ne\_%' and policyname = 'ne read') = 9
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ne\_%'
                  and has_function_privilege('anon', p.oid, 'execute')) then 'PASS' else 'FAIL' end;
