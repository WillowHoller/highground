-- =====================================================================================
-- HighGround database — part 16: state peer data and check registers on HighGround's own
-- districts and roles (run once, after 15). Re-running is safe.
--
-- What it does
--   1. Removes leftovers from the retired Horizon planner that were added on 6 Oct 2026
--      (cip_* tables and functions) and the first version of the register tables, which
--      checked access through those leftovers. Stops if any register data exists.
--   2. Links a HighGround district to its Iowa district number: district.state_district_id.
--   3. Peer settings per district (district_peer, benchmark_rule) on district.id.
--   4. Check registers as a new upload kind, 'check_register', in the existing upload flow
--      (import_batch): register_line, vendor_note, register_rule, register_flag,
--      register_check(), register_check_all(), register_summary().
--      Business managers and admins upload and answer; every member can read the questions.
--   5. Public state data (ia_*) readable by signed-in users only, like the rest of HighGround.
-- =====================================================================================
set search_path = public, extensions;

-- ------------------------------------------------------------------ 1. remove leftovers
do $$ declare n bigint := 0; begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'register_line' and column_name = 'import_id') then
    execute 'select count(*) from public.register_line' into n;
    if n > 0 then
      raise exception 'The old register_line table has data, so nothing was changed. Send this message to Claude.';
    end if;
  end if;
end $$;

drop function if exists public.register_check_all(text);
drop function if exists public.register_sample(uuid, int);
drop function if exists public.register_rule_for(text, text);
drop function if exists public.ia_benchmark(text, int, text, text, text);
do $$ begin   -- the old (Horizon-era) register tables had an import_id column; the new ones don't
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'register_line' and column_name = 'import_id') then
    drop function if exists public.register_check(uuid);
    drop function if exists public.register_summary(uuid);
    drop table if exists public.register_flag, public.register_line, public.register_import,
                         public.register_rule, public.vendor_note cascade;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'benchmark_rule' and column_name = 'tenant_id') then
    drop table public.benchmark_rule cascade;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district_peer' and column_name = 'tenant_id') then
    drop table public.district_peer cascade;
  end if;
end $$;
drop table if exists public.district_state_link cascade;
drop table if exists public.cip_project_request, public.cip_access_request, public.cip_tenant, public.cip_member cascade;
drop function if exists public.cip_can_write(text);
drop function if exists public.cip_is_admin(text);

-- ------------------------------------------------------------------ 2. state district number
-- The Iowa Department of Education district number ('0009' = AGWSR). Set it in Settings; the
-- app then shows peer comparisons and can fill General Fund starting figures from state reports.
alter table public.district add column if not exists state_district_id text
  references public.ia_district(de_district) on update cascade;

-- ------------------------------------------------------------------ 3. peer settings
create table if not exists public.district_peer (     -- hand-picked peers; none = same size band
  district_id uuid not null references public.district(id) on delete cascade,
  de_district text not null references public.ia_district(de_district),
  primary key (district_id, de_district)
);
create table if not exists public.benchmark_rule (    -- callout thresholds; district_id null = default
  id                bigint generated always as identity primary key,
  district_id       uuid unique references public.district(id) on delete cascade,
  min_peers         int     not null default 8,
  high_rank         numeric not null default 0.90,
  low_rank          numeric not null default 0.10,
  min_gap_per_pupil numeric not null default 25,
  min_gap_pct       numeric not null default 2,
  yoy_jump_pct      numeric not null default 25,
  yoy_min_per_pupil numeric not null default 50
);
insert into public.benchmark_rule (district_id)
select null where not exists (select 1 from public.benchmark_rule where district_id is null);

CREATE OR REPLACE FUNCTION public.ia_benchmark(p_de text, p_fy integer, p_status text DEFAULT 'Actual'::text, p_peer text DEFAULT 'size'::text, p_district uuid DEFAULT NULL::uuid)
 RETURNS TABLE(measure_key text, grp text, fund text, line text, unit text, amount numeric, value numeric, peer_group text, peer_n integer, peer_mean numeric, peer_median numeric, peer_p25 numeric, peer_p75 numeric, pct_rank numeric, vs_mean_pct numeric, prior_value numeric, change_pct numeric, peer_change_median_pct numeric, flag text, callout text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare r benchmark_rule; v_band int; v_aea text; v_label text;
begin
  select * into r from benchmark_rule where district_id = p_district;
  if not found then select * into r from benchmark_rule where district_id is null limit 1; end if;
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
                                       where dp.district_id = p_district and dp.de_district = y.de_district)
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
        when coalesce(j.n, 0) < r.min_peers or j.grp = 'detail' then null
        -- only the measures a board acts on (table benchmark_flaggable), and never a line most peers don't have
        when not exists (select 1 from benchmark_flaggable bf where bf.enabled and j.measure_key like bf.pattern) then null
        when j.unit = 'per_pupil' and coalesce(j.med, 0) = 0 then null
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
               else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || (case when fl.vsm >= 100 then round(1 + fl.vsm / 100, 1) || '× the average of ' else round(abs(fl.vsm)) || '% above the average of ' end) || fl.n || ' ' || v_label || ' (higher than ' || round(100 * fl.pr) || '% of them)' end
           when 'low' then
             case when fl.unit = 'pct'
               then fl.value || '% — below ' || round(100 * (1 - fl.pr)) || '% of ' || fl.n || ' ' || v_label || ' (median ' || round(fl.med::numeric, 1) || '%)'
               else '$' || to_char(round(fl.value), 'FM999,999') || '/pupil — ' || round(abs(fl.vsm)) || '% below the average of ' || fl.n || ' ' || v_label || ' (lower than ' || round(100 * (1 - fl.pr)) || '% of them)' end
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
end $function$;

-- ------------------------------------------------------------------ 4. check registers
-- A register upload is an import_batch of kind 'check_register', with period_end = the month's end.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.import_batch'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%gl_monthly%budget%';
  if c is not null and position('check_register' in pg_get_constraintdef((select oid from pg_constraint where conname = c and conrelid = 'public.import_batch'::regclass))) = 0 then
    execute format('alter table public.import_batch drop constraint %I', c);
    alter table public.import_batch add constraint import_batch_kind_check
      check (kind in ('gl_monthly','budget','balances','projects','goals','measure_values','survey','check_register'));
  end if;
end $$;

-- financial uploads (now including registers) need business manager or admin
create or replace function public.can_import(d uuid, k text) returns boolean
language sql stable set search_path = '' as $$
  select case when k in ('gl_monthly','budget','balances','check_register') then public.can_finance(d)
              when k = 'measure_values'                   then public.can_measure(d)
              else public.can_plan(d) end;
$$;

-- 'ACME Supply, Inc.' and 'ACME SUPPLY INC' are the same vendor
create or replace function public.hg_vendor_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9 ]', ' ', 'g'),
             '\m(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LP|LLP|PC|THE)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

create table if not exists public.register_line (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null,
  district_id uuid not null,
  line_no     int,
  pay_date    date,
  check_no    text,
  vendor_no   text,
  vendor_name text not null,
  vendor_key  text generated always as (public.hg_vendor_key(vendor_name)) stored,
  invoice_no  text,
  description text,
  account     text,
  fund        text,             -- Iowa fund code: 10 General, 33 SAVE, 36 PPEL ...
  func        text,             -- function code, e.g. 2600 operations and maintenance
  obj         text,             -- object code, e.g. 611 supplies
  amount      numeric(14,2) not null,
  method      text,
  unique (id, district_id),
  foreign key (batch_id, district_id) references public.import_batch(id, district_id) on delete cascade
);
create index if not exists register_line_batch_idx  on public.register_line (batch_id);
create index if not exists register_line_vendor_idx on public.register_line (district_id, vendor_key);
create index if not exists register_line_trgm_idx   on public.register_line using gin (vendor_key gin_trgm_ops);

-- the vendor dictionary: decode a cryptic name once, keep it every month
create table if not exists public.vendor_note (
  district_id uuid not null references public.district(id) on delete cascade,
  vendor_key  text not null,
  plain_label text check (length(plain_label) <= 120),
  category    text,
  expected    boolean not null default false,   -- reviewed and normal: no longer flagged as new
  note        text check (length(note) <= 800),
  updated_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (district_id, vendor_key)
);

-- rule switches and thresholds; district_id null = the default for everyone
create table if not exists public.register_rule (
  id          bigint generated always as identity primary key,
  district_id uuid references public.district(id) on delete cascade,
  rule        text not null,
  enabled     boolean not null default true,
  params      jsonb not null default '{}'
);
create unique index if not exists register_rule_uq
  on public.register_rule (coalesce(district_id, '00000000-0000-0000-0000-000000000000'::uuid), rule);
insert into public.register_rule (district_id, rule, params)
select null, r, p::jsonb from (values
  ('new_vendor',          '{}'),
  ('vendor_name_change',  '{}'),
  ('lookalike_vendor',    '{"similarity": 0.6}'),
  ('duplicate_payment',   '{"days": 45}'),
  -- no default bid threshold: each district sets its own from its purchasing policy (705.1)
  ('near_threshold',      '{"threshold": null, "within_pct": 10}'),
  ('split_purchase',      '{"threshold": null, "days": 14}'),
  ('vendor_spike',        '{"multiple": 3, "min_gap": 5000, "min_months": 3}'),
  ('account_spike',       '{"pct": 50, "min_gap": 10000}'),
  -- ASSUMED: salary (1xx) and benefit (2xx) objects on SAVE (33) or PPEL (36) deserve a question
  ('restricted_fund_use', '{"funds": ["33","36"], "object_prefixes": ["1","2"]}'),
  ('round_amount',        '{"min": 5000, "multiple": 1000}'),
  ('weekend_date',        '{}'),
  ('missing_info',        '{}')
) v(r, p)
where not exists (select 1 from public.register_rule x where x.district_id is null and x.rule = v.r);

create table if not exists public.register_flag (
  id          bigint generated always as identity primary key,
  district_id uuid not null,
  batch_id    uuid not null,
  line_id     bigint,
  vendor_key  text,
  rule        text not null,
  severity    text not null check (severity in ('info','question','concern')),
  question    text not null,                 -- written as a question to the business office
  detail      jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open','explained','dismissed')),
  response    text check (length(response) <= 2000),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (batch_id, district_id) references public.import_batch(id, district_id) on delete cascade,
  foreign key (line_id, district_id) references public.register_line(id, district_id) on delete cascade
);
create index if not exists register_flag_batch_idx on public.register_flag (batch_id, status);

-- rule params for a district (its own row wins over the default)
create or replace function public.register_rule_for(p_district uuid, p_rule text)
returns jsonb language sql stable set search_path = public as $$
  select case when enabled then params else null end
  from register_rule where rule = p_rule and (district_id = p_district or district_id is null)
  order by (district_id is null) limit 1
$$;

create or replace function public.register_check(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  imp import_batch; v_start date; p jsonb; v_hist int; v_n int; v_total int := 0; v_counts jsonb := '{}';
begin
  select * into imp from import_batch where id = p_batch and kind = 'check_register';
  -- Runs with owner rights (so editors can replace open flags), so check access here:
  -- signed-in callers must be members of the district; direct database sessions (staff
  -- backfill with the database password) and the service role are allowed.
  if not found
     or (auth.jwt() ? 'role' and auth.jwt()->>'role' <> 'service_role' and not can_finance(imp.district_id)) then
    raise exception 'Register upload not found, or you do not have permission to check it' using errcode = '42501';
  end if;
  if imp.period_end is null then raise exception 'A register upload needs its month (period_end)'; end if;
  v_start := date_trunc('month', imp.period_end)::date;

  delete from register_flag where batch_id = p_batch and status = 'open';

  create temp table if not exists _cur  (like register_line) on commit drop;
  create temp table if not exists _hist (like register_line) on commit drop;
  truncate _cur; truncate _hist;
  insert into _cur  select l.* from register_line l where l.batch_id = p_batch;
  -- history: this district's earlier register months that weren't discarded or replaced
  insert into _hist select l.* from register_line l join import_batch i on i.id = l.batch_id
                    where i.district_id = imp.district_id and i.kind = 'check_register'
                      and i.status in ('uploaded','review','applied') and i.period_end < v_start;
  select count(*) into v_hist from _hist;

  -- 1 new vendor (only meaningful once there is history)
  p := register_rule_for(imp.district_id, 'new_vendor');
  if p is not null and v_hist > 0 then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, min(c.id), c.vendor_key, 'new_vendor',
           case when sum(c.amount) >= 10000 then 'question' else 'info' end,
           'First payment to ' || max(c.vendor_name) || ' ($' || to_char(sum(c.amount), 'FM999,999,990.00') || '). What was it for, and who approved adding this vendor?',
           jsonb_build_object('total', sum(c.amount), 'payments', count(*))
    from _cur c
    where not exists (select 1 from _hist h where h.vendor_key = c.vendor_key)
      and not exists (select 1 from vendor_note n where n.district_id = imp.district_id and n.vendor_key = c.vendor_key and n.expected)
    group by c.vendor_key;
  end if;

  -- 2 same vendor number, different name
  p := register_rule_for(imp.district_id, 'vendor_name_change');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, min(c.id), c.vendor_key, 'vendor_name_change', 'concern',
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
  p := register_rule_for(imp.district_id, 'lookalike_vendor');
  if p is not null and v_hist > 0 then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, x.line_id, x.vendor_key, 'lookalike_vendor', 'question',
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
  p := register_rule_for(imp.district_id, 'duplicate_payment');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select distinct on (c.id) imp.district_id, p_batch, c.id, c.vendor_key, 'duplicate_payment',
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
    where (o.batch_id <> p_batch or o.id < c.id)   -- within one month, flag the later line only
    order by c.id, (c.invoice_no = o.invoice_no) desc nulls last;
  end if;

  -- 5 just under the bid / quote threshold
  p := register_rule_for(imp.district_id, 'near_threshold');
  if p is not null and (p->>'threshold') is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, c.id, c.vendor_key, 'near_threshold', 'question',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' is just under the $' ||
           to_char((p->>'threshold')::numeric, 'FM999,999,990') || ' purchasing threshold. Were quotes or bids obtained?',
           jsonb_build_object('threshold', (p->>'threshold')::numeric)
    from _cur c
    where c.amount < (p->>'threshold')::numeric
      and c.amount >= (p->>'threshold')::numeric * (1 - (p->>'within_pct')::numeric / 100);
  end if;

  -- 6 split purchase: several payments to one vendor, each under the threshold, together over it
  p := register_rule_for(imp.district_id, 'split_purchase');
  if p is not null and (p->>'threshold') is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, min(c.id), c.vendor_key, 'split_purchase', 'question',
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
  p := register_rule_for(imp.district_id, 'vendor_spike');
  if p is not null and v_hist > 0 then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, null, cur.vendor_key, 'vendor_spike', 'question',
           cur.vendor_name || ': $' || to_char(cur.total, 'FM999,999,990') || ' this period vs a typical $' ||
           to_char(h.med, 'FM999,999,990') || ' a month over the past year. What drove the increase?',
           jsonb_build_object('total', cur.total, 'typical_month', round(h.med), 'months', h.months)
    from (select vendor_key, max(vendor_name) vendor_name, sum(amount) total from _cur group by vendor_key) cur
    join (select vendor_key, count(*) months, percentile_cont(0.5) within group (order by m_total)::numeric med
          from (select h.vendor_key, h.batch_id, sum(h.amount) m_total
                from _hist h join import_batch i on i.id = h.batch_id
                where i.period_end >= v_start - interval '12 months'
                group by h.vendor_key, h.batch_id) m
          group by vendor_key) h using (vendor_key)
    where h.months >= (p->>'min_months')::int
      and cur.total > h.med * (p->>'multiple')::numeric
      and cur.total - h.med >= (p->>'min_gap')::numeric;
  end if;

  -- 8 account spike: fund + function total vs the same period a year earlier
  p := register_rule_for(imp.district_id, 'account_spike');
  if p is not null and v_hist > 0 then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, null, null, 'account_spike', 'question',
           'Fund ' || cur.fund || ', function ' || cur.func || ': $' || to_char(cur.total, 'FM999,999,990') ||
           ' vs $' || to_char(ly.total, 'FM999,999,990') || ' in the same period last year (+' ||
           round(100 * (cur.total - ly.total) / ly.total) || '%). Planned, or something to explain?',
           jsonb_build_object('fund', cur.fund, 'func', cur.func, 'total', cur.total, 'last_year', ly.total)
    from (select fund, func, sum(amount) total from _cur where fund is not null and func is not null group by 1, 2) cur
    join (select h.fund, h.func, sum(h.amount) total
          from _hist h join import_batch i on i.id = h.batch_id
          where date_trunc('month', i.period_end) = v_start - interval '12 months'
          group by 1, 2) ly using (fund, func)
    where ly.total > 0
      and cur.total > ly.total * (1 + (p->>'pct')::numeric / 100)
      and cur.total - ly.total >= (p->>'min_gap')::numeric;
  end if;

  -- 9 restricted fund paying for something it usually can't (ASSUMED code lists, see rule params)
  p := register_rule_for(imp.district_id, 'restricted_fund_use');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, c.id, c.vendor_key, 'restricted_fund_use', 'question',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' is charged to fund ' || c.fund ||
           ' with object ' || c.obj || '. Is this an allowed use of that fund?',
           jsonb_build_object('fund', c.fund, 'obj', c.obj, 'account', c.account)
    from _cur c
    where c.fund in (select jsonb_array_elements_text(p->'funds'))
      and c.obj is not null
      and left(c.obj, 1) in (select jsonb_array_elements_text(p->'object_prefixes'));
  end if;

  -- 10 large round-dollar amounts
  p := register_rule_for(imp.district_id, 'round_amount');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, c.id, c.vendor_key, 'round_amount', 'info',
           'Round amount: $' || to_char(c.amount, 'FM999,999,990') || ' to ' || c.vendor_name || '. Invoice, deposit or estimate?',
           '{}'::jsonb
    from _cur c
    where c.amount >= (p->>'min')::numeric and mod(c.amount, (p->>'multiple')::numeric) = 0;
  end if;

  -- 11 paid on a weekend
  p := register_rule_for(imp.district_id, 'weekend_date');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, c.id, c.vendor_key, 'weekend_date', 'info',
           'Dated ' || to_char(c.pay_date, 'Dy Mon DD') || ': $' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || '. Off-cycle payment?',
           '{}'::jsonb
    from _cur c where extract(isodow from c.pay_date) in (6, 7);
  end if;

  -- 12 can't tell what it is
  p := register_rule_for(imp.district_id, 'missing_info');
  if p is not null then
    insert into register_flag (district_id, batch_id, line_id, vendor_key, rule, severity, question, detail)
    select imp.district_id, p_batch, c.id, c.vendor_key, 'missing_info', 'info',
           '$' || to_char(c.amount, 'FM999,999,990.00') || ' to ' || c.vendor_name || ' has no description or account code. What was it for?',
           '{}'::jsonb
    from _cur c where coalesce(c.description, '') = '' and coalesce(c.account, c.fund, '') = '';
  end if;

  -- a question already answered for this line and rule isn't asked again
  delete from register_flag n
  using register_flag a
  where n.batch_id = p_batch and n.status = 'open' and a.batch_id = p_batch and a.status <> 'open'
    and a.rule = n.rule and coalesce(a.line_id, 0) = coalesce(n.line_id, 0)
    and coalesce(a.vendor_key, '') = coalesce(n.vendor_key, '');

  update import_batch set row_count = (select count(*) from _cur) where id = p_batch;

  select coalesce(jsonb_object_agg(rule, n), '{}'), coalesce(sum(n), 0) into v_counts, v_total
  from (select rule, count(*) n from register_flag where batch_id = p_batch and status = 'open' group by rule) s;
  return jsonb_build_object('batch_id', p_batch, 'open_flags', v_total, 'by_rule', v_counts, 'history_lines', v_hist);
end $$;
revoke all on function public.register_check(uuid) from public, anon;
revoke all on function public.register_check(uuid) from public, anon;
grant execute on function public.register_check(uuid) to authenticated;

-- every register month of a district, in date order (after loading past months)
create or replace function public.register_check_all(p_district uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare b record; out jsonb := '[]';
begin
  for b in select id, period_end from import_batch
           where district_id = p_district and kind = 'check_register' and status in ('uploaded','review','applied')
           order by period_end loop
    out := out || jsonb_build_array(jsonb_build_object('period_end', b.period_end) || register_check(b.id));
  end loop;
  return out;
end $$;

-- one-page summary of a month: totals by fund, top vendors, open questions
create or replace function public.register_summary(p_batch uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', (select sum(amount) from register_line where batch_id = p_batch),
    'lines', (select count(*) from register_line where batch_id = p_batch),
    'by_fund', (select coalesce(jsonb_object_agg(coalesce(fund, '?'), t), '{}')
                from (select fund, sum(amount) t from register_line where batch_id = p_batch group by fund) s),
    'top_vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor', v, 'label', lbl, 'total', t) order by t desc), '[]')
                    from (select max(l.vendor_name) v, max(n.plain_label) lbl, sum(l.amount) t
                          from register_line l
                          left join vendor_note n on n.district_id = l.district_id and n.vendor_key = l.vendor_key
                          where l.batch_id = p_batch group by l.vendor_key order by 3 desc limit 10) s),
    'flags', (select coalesce(jsonb_object_agg(severity, n), '{}')
              from (select severity, count(*) n from register_flag where batch_id = p_batch and status = 'open' group by 1) s)
  )
$$;


-- ------------------------------------------------------------------ onboarding pre-fill
-- A district's latest year-end figures from the state's annual report, for the General Fund setup
-- and fund balances. The app shows them for confirmation; nothing is saved by this function.
create or replace function public.ia_prefill(p_de text)
returns jsonb language sql stable set search_path = public as $$
  with yr as (select max(fiscal_year) fy from ia_measure
              where de_district = p_de and status = 'Actual' and measure_key = 'bal|General|ENDING'),
  m as (select measure_key, amount, value from ia_measure, yr
        where de_district = p_de and fiscal_year = yr.fy and status = 'Actual'),
  a as (select measure_key k, amount from m),
  enr as (select fiscal_year, certified_enrollment from ia_district_year
          where de_district = p_de and status = 'Actual' and certified_enrollment is not null
          order by fiscal_year desc limit 1)
  select jsonb_build_object(
    'de_district', p_de,
    'name', (select name from ia_district where de_district = p_de),
    'fiscal_year', (select fy from yr),
    'source', 'Iowa Department of Education, Certified Annual Report, FY' || (select fy from yr) || ' (year end June 30)',
    'certified_enrollment', (select certified_enrollment from ia_district_year, yr
                             where de_district = p_de and fiscal_year = yr.fy and status = 'Actual'),
    'latest_enrollment', (select jsonb_build_object('fiscal_year', fiscal_year, 'certified', certified_enrollment) from enr),
    'general', jsonb_build_object(
        'ending_balance',  (select amount from a where k = 'bal|General|ENDING'),
        'unassigned',      (select amount from a where k = 'bal|General|Unassigned'),
        'assigned',        (select amount from a where k = 'bal|General|Assigned'),
        'revenue',         (select amount from a where k = 'rev|General|TOTAL'),
        'spending',        (select amount from a where k = 'exp|General|TOTAL'),
        'aea_flowthrough', (select amount from a where k = 'exp|General|AEA Support - Direct to AEA'),
        'solvency_pct',    (select value  from m where measure_key = 'bal|General|SOLVENCY')),
    'receipts', jsonb_build_object(              -- the fund's whole revenue that year (levy/sales tax plus interest)
        'save', (select amount from a where k = 'rev|SAVE|TOTAL'),
        'ppel', (select amount from a where k = 'rev|PPEL|TOTAL')),
    'balances', jsonb_build_object(              -- keys match fund_balance.fund
        'general',   (select amount from a where k = 'bal|General|ENDING'),
        'save',      (select amount from a where k = 'bal|SAVE|ENDING'),
        'ppel',      (select amount from a where k = 'bal|PPEL|ENDING'),
        'debt_levy', (select amount from a where k = 'bal|Debt Service|ENDING'))
  )
$$;

-- ------------------------------------------------------------------ access rules
alter table public.district_peer   enable row level security;
alter table public.benchmark_rule  enable row level security;
alter table public.register_line   enable row level security;
alter table public.vendor_note     enable row level security;
alter table public.register_rule   enable row level security;
alter table public.register_flag   enable row level security;

drop policy if exists "members read"     on public.district_peer;
drop policy if exists "finance writes"   on public.district_peer;
drop policy if exists "finance removes"  on public.district_peer;
create policy "members read"    on public.district_peer for select to authenticated using (public.is_member(district_id));
create policy "finance writes"  on public.district_peer for insert to authenticated with check (public.can_finance(district_id));
create policy "finance removes" on public.district_peer for delete to authenticated using (public.can_finance(district_id));

drop policy if exists "members read"   on public.benchmark_rule;
drop policy if exists "admins write"   on public.benchmark_rule;
drop policy if exists "admins change"  on public.benchmark_rule;
create policy "members read"  on public.benchmark_rule for select to authenticated
  using (district_id is null or public.is_member(district_id));
create policy "admins write"  on public.benchmark_rule for insert to authenticated
  with check (district_id is not null and public.is_district_admin(district_id));
create policy "admins change" on public.benchmark_rule for update to authenticated
  using (district_id is not null and public.is_district_admin(district_id))
  with check (district_id is not null and public.is_district_admin(district_id));

drop policy if exists "members read"     on public.register_line;
drop policy if exists "finance adds"     on public.register_line;
drop policy if exists "finance removes"  on public.register_line;
create policy "members read"    on public.register_line for select to authenticated using (public.is_member(district_id));
create policy "finance adds"    on public.register_line for insert to authenticated with check (public.can_finance(district_id));
create policy "finance removes" on public.register_line for delete to authenticated using (public.can_finance(district_id));

drop policy if exists "members read"    on public.vendor_note;
drop policy if exists "finance writes"  on public.vendor_note;
drop policy if exists "finance changes" on public.vendor_note;
drop policy if exists "finance removes" on public.vendor_note;
create policy "members read"    on public.vendor_note for select to authenticated using (public.is_member(district_id));
create policy "finance writes"  on public.vendor_note for insert to authenticated with check (public.can_finance(district_id));
create policy "finance changes" on public.vendor_note for update to authenticated
  using (public.can_finance(district_id)) with check (public.can_finance(district_id));
create policy "finance removes" on public.vendor_note for delete to authenticated using (public.can_finance(district_id));

drop policy if exists "members read"    on public.register_rule;
drop policy if exists "finance writes"  on public.register_rule;
drop policy if exists "finance changes" on public.register_rule;
create policy "members read"    on public.register_rule for select to authenticated
  using (district_id is null or public.is_member(district_id));
create policy "finance writes"  on public.register_rule for insert to authenticated
  with check (district_id is not null and public.can_finance(district_id));
create policy "finance changes" on public.register_rule for update to authenticated
  using (district_id is not null and public.can_finance(district_id))
  with check (district_id is not null and public.can_finance(district_id));

-- questions are created only by register_check(); members read them; finance answers them
drop policy if exists "members read"     on public.register_flag;
drop policy if exists "finance answers"  on public.register_flag;
create policy "members read"    on public.register_flag for select to authenticated using (public.is_member(district_id));
create policy "finance answers" on public.register_flag for update to authenticated
  using (public.can_finance(district_id)) with check (public.can_finance(district_id));

-- answers and dictionary edits go in the audit log, like other key tables
drop trigger if exists register_flag_audit  on public.register_flag;
drop trigger if exists vendor_note_audit    on public.vendor_note;
drop trigger if exists register_rule_audit  on public.register_rule;
drop trigger if exists district_peer_audit  on public.district_peer;
create trigger register_flag_audit after update on public.register_flag for each row execute function public.write_audit();
create trigger vendor_note_audit   after insert or update or delete on public.vendor_note   for each row execute function public.write_audit();
create trigger register_rule_audit after insert or update or delete on public.register_rule for each row execute function public.write_audit();
create trigger district_peer_audit after insert or delete on public.district_peer for each row execute function public.write_audit();

-- ------------------------------------------------------------------ 5. state data: signed-in users only
drop policy if exists "ia read"        on public.ia_district;
drop policy if exists "signed in read" on public.ia_district;
drop policy if exists "ia read"        on public.ia_fin_line_def;
drop policy if exists "signed in read" on public.ia_fin_line_def;
drop policy if exists "ia read"        on public.ia_district_year;
drop policy if exists "signed in read" on public.ia_district_year;
drop policy if exists "ia read"        on public.ia_fin;
drop policy if exists "signed in read" on public.ia_fin;
drop policy if exists "ia read"        on public.ia_load_run;
drop policy if exists "signed in read" on public.ia_load_run;
drop policy if exists "ia read"        on public.ia_measure;
drop policy if exists "signed in read" on public.ia_measure;
drop policy if exists "flaggable read" on public.benchmark_flaggable;
drop policy if exists "signed in read" on public.benchmark_flaggable;
create policy "signed in read" on public.ia_district         for select to authenticated using (true);
create policy "signed in read" on public.ia_fin_line_def     for select to authenticated using (true);
create policy "signed in read" on public.ia_district_year    for select to authenticated using (true);
create policy "signed in read" on public.ia_fin              for select to authenticated using (true);
create policy "signed in read" on public.ia_load_run         for select to authenticated using (true);
create policy "signed in read" on public.ia_measure          for select to authenticated using (true);
create policy "signed in read" on public.benchmark_flaggable for select to authenticated using (true);
-- staging tables: the loader only (it connects as the database owner)
drop policy if exists "loader only" on public.ia_stage;
drop policy if exists "loader only" on public.ia_enroll_stage;
create policy "loader only" on public.ia_stage        for all to authenticated using (false) with check (false);
create policy "loader only" on public.ia_enroll_stage for all to authenticated using (false) with check (false);

-- grants: nothing for anonymous visitors; signed-in users read state data and use the functions
do $$
declare t text; f regprocedure;
begin
  foreach t in array array['ia_district','ia_fin_line_def','ia_district_year','ia_fin','ia_stage','ia_load_run',
                           'ia_measure','ia_measure_v','ia_enroll_stage','benchmark_flaggable','benchmark_rule',
                           'district_peer','register_line','vendor_note','register_rule','register_flag'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'ia\_%' or p.proname like 'register\_%'
                                           or p.proname in ('hg_vendor_key','can_import')) loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
grant select on public.ia_district, public.ia_fin_line_def, public.ia_district_year, public.ia_fin, public.ia_load_run,
                public.ia_measure, public.ia_measure_v, public.benchmark_flaggable to authenticated;
revoke all on public.ia_stage, public.ia_enroll_stage from authenticated;
grant select, insert, delete on public.district_peer to authenticated;
grant select, insert, update on public.benchmark_rule, public.register_rule to authenticated;
grant select, insert, delete on public.register_line to authenticated;
grant select, insert, update, delete on public.vendor_note to authenticated;
grant select, update (status, response, resolved_by, resolved_at) on public.register_flag to authenticated;
grant execute on function public.ia_benchmark(text, int, text, text, uuid), public.ia_district_search(text),
                          public.ia_prefill(text), public.ia_line_role(text, text), public.ia_band(numeric),
                          public.ia_band_label(int), public.ia_measures_calc(int), public.hg_vendor_key(text),
                          public.register_rule_for(uuid, text), public.register_check(uuid),
                          public.register_check_all(uuid), public.register_summary(uuid),
                          public.can_import(uuid, text) to authenticated;
revoke execute on function public.ia_publish(text, boolean), public.ia_publish_enrollment(),
                           public.ia_refresh_measures(int), public.ia_compare_stage(text, int) from authenticated;

notify pgrst, 'reload schema';

-- check (every row should say PASS)
select 1 as n, 'Horizon leftovers removed' as test,
       case when to_regclass('public.cip_member') is null and to_regclass('public.cip_tenant') is null
             and not exists (select 1 from pg_proc where proname in ('cip_can_write','cip_is_admin')) then 'PASS' else 'FAIL' end as result
union all
select 2, 'Districts can be linked to a state district number',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district' and column_name = 'state_district_id') then 'PASS' else 'FAIL' end
union all
select 3, 'Check registers are an upload kind for business managers and admins',
       case when position('check_register' in pg_get_functiondef('public.can_import(uuid,text)'::regprocedure)) > 0
             and exists (select 1 from pg_constraint where conname = 'import_batch_kind_check' and pg_get_constraintdef(oid) like '%check_register%') then 'PASS' else 'FAIL' end
union all
select 4, 'Register tables are on HighGround districts',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'register_line' and column_name = 'batch_id')
             and not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id') then 'PASS' else 'FAIL' end
union all
select 5, 'Anonymous visitors cannot read state data or call its functions',
       case when not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and (table_name like 'ia\_%' or table_name like 'register\_%' or table_name in ('benchmark_rule','benchmark_flaggable','district_peer','vendor_note')))
             and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and (p.proname like 'ia\_%' or p.proname like 'register\_%') and has_function_privilege('anon', p.oid, 'execute'))
            then 'PASS' else 'FAIL' end
order by n;
