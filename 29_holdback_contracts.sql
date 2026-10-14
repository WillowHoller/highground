-- HighGround part 29: the yearly holdback, and pay-app tracking for contracted projects. Written 2026-10-14. Safe to run twice.
-- Paste into the Supabase SQL Editor and Run, BEFORE uploading the new app files to GitHub
-- (the new app reads and saves these; the old app ignores them).
--
-- 1. Held back each year (district_settings.{save,ppel,vppel}_holdback_split)
--    Each capital fund holds back money off the top of every year's receipts before anything goes to projects.
--    By default that's ONE combined figure: the existing {fund}_ongoing (dollars a year) or {fund}_ongoing_pct (share of
--    receipts), exactly as before. A district that wants to track recurring costs and a cushion separately ticks
--    "Split it": then {fund}_ongoing is the recurring dollars AND {fund}_ongoing_pct is the cushion, and both are held back.
--
-- 2. Contracts and pay applications
--    initiative_contract  one row per contracted initiative: contractor, original contract sum, owner's contingency, dates.
--    contract_progress    one row per pay application, typed from the contractor's or construction manager's summary:
--                         contract sum today (with change orders), work completed to date, retainage held, contingency left.
--    These are a progress and cost check. They are never added to ledger spending (which already includes what was paid).
--    Members read; anyone who can plan or manage finances in the district can write. Every change goes to the activity log.
--    Both tables get the two-step sign-in rule from part 26, so there's no need to re-run 26_two_step.sql.

set search_path = public, extensions;

-- 1 ------------------------------------------------------------------------------------------------------------------
alter table public.district_settings
  add column if not exists save_holdback_split  boolean not null default false,
  add column if not exists ppel_holdback_split  boolean not null default false,
  add column if not exists vppel_holdback_split boolean not null default false;

-- 2 ------------------------------------------------------------------------------------------------------------------
create table if not exists public.initiative_contract (
  initiative_id        uuid primary key,
  district_id          uuid not null references public.district(id) on delete cascade,
  contractor           text check (length(contractor) <= 120),
  original_sum         numeric(14,2) not null check (original_sum > 0),
  original_contingency numeric(14,2) not null default 0 check (original_contingency >= 0),
  start_date           date,
  completion_date      date,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id) on delete set null default auth.uid(),
  check (completion_date is null or start_date is null or completion_date >= start_date),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);

create table if not exists public.contract_progress (
  id                    uuid primary key default gen_random_uuid(),
  district_id           uuid not null references public.district(id) on delete cascade,
  initiative_id         uuid not null,
  pay_app_no            integer check (pay_app_no between 0 and 999),
  through_date          date not null,
  contract_sum          numeric(14,2) not null check (contract_sum > 0),
  completed_to_date     numeric(14,2) not null check (completed_to_date >= 0),
  retainage             numeric(14,2) not null default 0 check (retainage >= 0),
  contingency_remaining numeric(14,2) check (contingency_remaining >= 0),
  note                  text check (length(note) <= 300),
  entered_by            uuid references auth.users(id) on delete set null default auth.uid(),
  entered_at            timestamptz not null default now(),
  check (retainage <= completed_to_date),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);
create index if not exists contract_progress_init_idx on public.contract_progress (district_id, initiative_id, through_date);

alter table public.initiative_contract enable row level security;
alter table public.contract_progress   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['initiative_contract', 'contract_progress'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "writers insert" on public.%I', t);
    execute format('drop policy if exists "writers update" on public.%I', t);
    execute format('drop policy if exists "writers delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(district_id))', t);
    execute format('create policy "writers insert" on public.%I for insert to authenticated
                    with check (public.can_plan(district_id) or public.can_finance(district_id))', t);
    execute format('create policy "writers update" on public.%I for update to authenticated
                    using (public.can_plan(district_id) or public.can_finance(district_id))
                    with check (public.can_plan(district_id) or public.can_finance(district_id))', t);
    execute format('create policy "writers delete" on public.%I for delete to authenticated
                    using (public.can_plan(district_id) or public.can_finance(district_id))', t);
    -- two-step sign-in (part 26): a password-only session that should have done two-step sees and changes nothing
    execute format('drop policy if exists "two-step sign-in" on public.%I', t);
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'two_step_ok') then
      execute format('create policy "two-step sign-in" on public.%I as restrictive for all to authenticated '
                     'using ((select public.two_step_ok())) with check ((select public.two_step_ok()))', t);
    end if;
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

revoke all on public.initiative_contract, public.contract_progress from anon;
grant select, insert, update, delete on public.initiative_contract, public.contract_progress to authenticated;

notify pgrst, 'reload schema';

-- checks: every row should say PASS
select 'district_settings holdback split columns' as test,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'district_settings'
                  and column_name in ('save_holdback_split', 'ppel_holdback_split', 'vppel_holdback_split')) = 3 then 'PASS' else 'FAIL' end as result
union all
select 'contract tables exist',
       case when to_regclass('public.initiative_contract') is not null and to_regclass('public.contract_progress') is not null then 'PASS' else 'FAIL' end
union all
select 'contract tables have row level security on',
       case when (select count(*) from pg_class where oid in ('public.initiative_contract'::regclass, 'public.contract_progress'::regclass) and relrowsecurity) = 2 then 'PASS' else 'FAIL' end
union all
select 'four policies on each contract table, plus the two-step sign-in rule',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('initiative_contract', 'contract_progress') and policyname <> 'two-step sign-in') = 8
             and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('initiative_contract', 'contract_progress') and policyname = 'two-step sign-in' and permissive = 'RESTRICTIVE') = 2
            then 'PASS' else 'FAIL' end
union all
select 'the public (signed out) can''t read contracts',
       case when not has_table_privilege('anon', 'public.contract_progress', 'select') and not has_table_privilege('anon', 'public.initiative_contract', 'select') then 'PASS' else 'FAIL' end;
