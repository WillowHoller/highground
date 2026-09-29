-- HighGround — structure check. Run after 01–04. Changes nothing. Every row should say PASS.
with t as (
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), p as (
  select tablename, count(*) as c from pg_policies where schemaname = 'public' group by tablename
), anon_fns as (
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> 'public_publication'
)
select 1 as n, 'All 36 tables exist' as test,
       case when count(*) = 36 then 'PASS' else 'FAIL' end as result, count(*)::text || ' tables' as detail
  from t
union all
select 2, 'Every table has row level security on',
       case when count(*) filter (where not relrowsecurity) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(relname, ', ') filter (where not relrowsecurity), '')
  from t
union all
select 3, 'Every table has at least one access rule',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(t.relname, ', '), '')
  from t left join p on p.tablename = t.relname where p.c is null
union all
select 4, 'Anonymous visitors have no table access',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(distinct table_name, ', '), '')
  from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
union all
select 5, 'Anonymous visitors can call only public_publication',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(proname, ', '), '')
  from anon_fns
union all
select 6, 'Signed-in users cannot call claim_invitations',
       case when has_function_privilege('authenticated', 'public.claim_invitations(uuid,text)', 'execute')
            then 'FAIL' else 'PASS' end, ''
union all
select 7, 'Sign-up triggers are on auth.users',
       case when count(*) = 2 then 'PASS' else 'FAIL' end, count(*)::text || ' triggers'
  from pg_trigger where tgrelid = 'auth.users'::regclass and tgname like 'highground_auth_%'
union all
select 8, 'Storage buckets exist',
       case when count(*) = 2 then 'PASS' else 'FAIL' end, coalesce(string_agg(id, ', '), '')
  from storage.buckets where id in ('district-files', 'district-public')
union all
select 9, 'Iowa rule values loaded',
       case when count(*) = 18 then 'PASS' else 'FAIL' end, count(*)::text || ' values'
  from public.rule_value where state = 'IA'
order by n;
