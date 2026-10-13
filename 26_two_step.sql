-- =====================================================================================
-- HighGround part 26: two-step sign-in required, district by district
-- Run after part 25. Safe to run more than once. No data is deleted.
--
-- * district.require_two_step: on by default. Willow Holler staff can turn it off (for
--   demo districts); district admins can't change it.
-- * Who must use two-step sign-in: Willow Holler staff always, and anyone who belongs to at
--   least one district that requires it.
-- * The database enforces it, not just the app: a RESTRICTIVE policy on every table means
--   a session that should have passed two-step sign-in (aal2) but hasn't sees and changes
--   nothing. Anonymous visitors (the public community page) are not affected.
-- * Re-run this file after adding any new part with new tables, so they get the rule too.
--   Check 4 below lists any table that's missing it.
-- =====================================================================================

set client_min_messages = warning;

alter table public.district add column if not exists require_two_step boolean not null default true;

-- Existing demo districts: off, so demo logins work without a phone. Runs only the first time
-- (when the column is new); after that, whatever staff set is kept.
-- (The column comment marks the one-time step as done.)
do $$ begin
  if coalesce(col_description('public.district'::regclass,
       (select attnum from pg_attribute where attrelid = 'public.district'::regclass and attname = 'require_two_step')), '') = '' then
    update public.district set require_two_step = false where is_demo;
    comment on column public.district.require_two_step is
      'Everyone in this district must use two-step sign-in. Staff-only setting (part 26).';
  end if;
end $$;

-- ------------------------------------------------------------------ who must use it
create or replace function public.two_step_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or exists (select 1 from public.district_member m
                 join public.district d on d.id = m.district_id
                 where m.user_id = auth.uid() and d.require_two_step);
$$;

-- true when this session may use the data: two-step done (aal2), or not required
create or replace function public.two_step_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' or not public.two_step_required();
$$;

revoke execute on function public.two_step_required() from public, anon;
revoke execute on function public.two_step_ok()       from public, anon;
grant  execute on function public.two_step_required() to authenticated;
grant  execute on function public.two_step_ok()       to authenticated;

-- ------------------------------------------------------------------ only staff change the setting
create or replace function public.guard_require_two_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null in the SQL editor and for the server's own jobs: allowed
  if auth.uid() is not null and not public.is_platform_admin() then
    if tg_op = 'INSERT' and new.require_two_step is distinct from true then
      raise exception 'Only Willow Holler staff can turn off two-step sign-in for a district.' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.require_two_step is distinct from old.require_two_step then
      raise exception 'Only Willow Holler staff can change whether a district requires two-step sign-in.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_require_two_step() from public, anon, authenticated;
drop trigger if exists guard_require_two_step on public.district;
create trigger guard_require_two_step before insert or update on public.district
  for each row execute function public.guard_require_two_step();

-- ------------------------------------------------------------------ the rule on every table
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists "two-step sign-in" on public.%I', t.tablename);
    execute format('create policy "two-step sign-in" on public.%I as restrictive for all to authenticated '
                   'using ((select public.two_step_ok())) with check ((select public.two_step_ok()))', t.tablename);
  end loop;
end $$;

-- uploaded files (ledgers, attachments). Skipped with a note if this project doesn't allow it.
do $$ begin
  drop policy if exists "two-step sign-in" on storage.objects;
  create policy "two-step sign-in" on storage.objects as restrictive for all to authenticated
    using ((select public.two_step_ok())) with check ((select public.two_step_ok()));
exception when others then raise notice 'Uploaded files not covered: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------ check (rows 1–4 should say PASS)
select 1 as n, 'Districts have the "require two-step sign-in" setting' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public'
                         and table_name = 'district' and column_name = 'require_two_step') then 'PASS' else 'FAIL' end as result
union all
select 2, 'Only staff can change it',
       case when exists (select 1 from pg_trigger where tgname = 'guard_require_two_step' and not tgisinternal) then 'PASS' else 'FAIL' end
union all
select 3, 'Sign-in check functions are in place',
       case when to_regprocedure('public.two_step_ok()') is not null and to_regprocedure('public.two_step_required()') is not null
            then 'PASS' else 'FAIL' end
union all
select 4, 'Every protected table has the rule' ||
          coalesce(' (missing: ' || (select string_agg(t.tablename, ', ') from pg_tables t
             where t.schemaname = 'public' and t.rowsecurity
               and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                               and p.policyname = 'two-step sign-in')) || ')', ''),
       case when exists (select 1 from pg_tables t where t.schemaname = 'public' and t.rowsecurity
               and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                               and p.policyname = 'two-step sign-in')) then 'FAIL' else 'PASS' end
union all
select 5, 'Uploaded files covered too',
       case when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                         and policyname = 'two-step sign-in') then 'PASS' else 'INFO: not covered (see the note in the output)' end
union all
select 6, 'Districts requiring it: ' || (select count(*) from public.district where require_two_step)::text
          || ' of ' || (select count(*) from public.district)::text || ' (demo districts start off)', 'INFO';
