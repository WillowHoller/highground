-- HighGround part 33: "Checked with the business office" for the plan's checks. Written 2026-10-21. Safe to run twice.
-- Paste into the Supabase SQL Editor and Run, BEFORE uploading the new app files to GitHub.
-- (Before this runs, the app still works: the checks show, but the "Checked" button says the database needs this part.)
--
-- The capital plan and Rank & fund list charges to confirm with the business office (a fund the law allows only in some
-- cases) and costs that may be counted twice (a repeating purchase on a fund that also holds money back every year).
-- Once someone has confirmed one, they click "Checked with the business office" and it stops nagging, for everyone in the
-- district and in every scenario. Each row remembers what was checked (sig: the fund, years or amount at the time), so if
-- that cost changes the check comes back by itself. Undo removes the row.
--
--   warning_check   one row per district and check: key (which check), sig (what it looked like), who and when.
--   Members read; anyone who can plan or manage finances in the district can write. Every change goes to the activity log.

set search_path = public, extensions;

create table if not exists public.warning_check (
  district_id uuid not null references public.district(id) on delete cascade,
  key         text not null check (length(key) between 3 and 300),
  sig         text not null default '' check (length(sig) <= 300),
  note        text check (length(note) <= 300),
  checked_by  uuid references auth.users(id) on delete set null default auth.uid(),
  checked_at  timestamptz not null default now(),
  primary key (district_id, key)
);

alter table public.warning_check enable row level security;

drop policy if exists "members read" on public.warning_check;
drop policy if exists "writers insert" on public.warning_check;
drop policy if exists "writers update" on public.warning_check;
drop policy if exists "writers delete" on public.warning_check;
create policy "members read" on public.warning_check for select to authenticated using (public.is_member(district_id));
create policy "writers insert" on public.warning_check for insert to authenticated
  with check (public.can_plan(district_id) or public.can_finance(district_id));
create policy "writers update" on public.warning_check for update to authenticated
  using (public.can_plan(district_id) or public.can_finance(district_id))
  with check (public.can_plan(district_id) or public.can_finance(district_id));
create policy "writers delete" on public.warning_check for delete to authenticated
  using (public.can_plan(district_id) or public.can_finance(district_id));

-- two-step sign-in (part 26): a password-only session that should have done two-step sees and changes nothing
drop policy if exists "two-step sign-in" on public.warning_check;
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'two_step_ok') then
    execute 'create policy "two-step sign-in" on public.warning_check as restrictive for all to authenticated '
            'using ((select public.two_step_ok())) with check ((select public.two_step_ok()))';
  end if;
end $$;

drop trigger if exists warning_check_audit on public.warning_check;
create trigger warning_check_audit after insert or update or delete on public.warning_check for each row execute function public.write_audit();

revoke all on public.warning_check from anon;
grant select, insert, update, delete on public.warning_check to authenticated;

notify pgrst, 'reload schema';

-- checks: every row should say PASS
select 'warning_check table exists' as test,
       case when to_regclass('public.warning_check') is not null then 'PASS' else 'FAIL' end as result
union all
select 'warning_check has row level security on',
       case when (select relrowsecurity from pg_class where oid = 'public.warning_check'::regclass) then 'PASS' else 'FAIL' end
union all
select 'four policies, plus the two-step sign-in rule',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'warning_check' and policyname <> 'two-step sign-in') = 4
             and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'warning_check' and policyname = 'two-step sign-in' and permissive = 'RESTRICTIVE') = 1
            then 'PASS' else 'FAIL' end
union all
select 'the public (signed out) can''t read checks',
       case when not has_table_privilege('anon', 'public.warning_check', 'select') then 'PASS' else 'FAIL' end;
