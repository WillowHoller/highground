-- =====================================================================================
-- HighGround database — part 7: sign-in hardening (run once, after 01–04)
--   * access requests: someone signed in asks a district for access; admins approve or decline
--   * district email-domain allow-list: confirmed addresses at listed domains get access
--   * invitation emails: when each invitation was last emailed
-- Re-running is safe.
-- =====================================================================================

-- ---------------------------------------------------------------- domain allow-list
alter table public.district add column if not exists allowed_domains text[] not null default '{}';
alter table public.district add column if not exists domain_role text not null default 'viewer';
do $$ begin
  alter table public.district add constraint district_domain_role_chk check (domain_role in ('viewer', 'board'));
exception when duplicate_object then null; end $$;

-- Tidy the list, and refuse public email services: anyone can get an address there.
create or replace function public.check_allowed_domains() returns trigger
language plpgsql set search_path = '' as $$
declare dom text;
  public_services text[] := array['gmail.com','googlemail.com','yahoo.com','ymail.com','outlook.com','hotmail.com','live.com','msn.com',
    'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','mail.com','zoho.com','zohomail.com',
    'yandex.com','fastmail.com','hey.com','tutanota.com','duck.com','comcast.net','att.net','verizon.net','mchsi.com','q.com'];
begin
  new.allowed_domains := coalesce((select array_agg(distinct lower(trim(both ' @' from x))) from unnest(new.allowed_domains) x
                                   where trim(both ' @' from x) <> ''), '{}');
  foreach dom in array new.allowed_domains loop
    if dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
      raise exception 'Not an email domain: %', dom using errcode = '22023';
    end if;
    if dom = any(public_services) then
      raise exception '% is a public email service, so anyone could get an address there. List only the district’s own domain.', dom using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists district_domains on public.district;
create trigger district_domains before insert or update of allowed_domains on public.district
  for each row execute function public.check_allowed_domains();

create or replace function public.claim_domains(uid uuid, addr text) returns void
language sql security definer set search_path = '' as $$
  insert into public.district_member (district_id, user_id, role)
  select d.id, uid, d.domain_role from public.district d
  where lower(split_part(addr, '@', 2)) = any(d.allowed_domains)
  on conflict (district_id, user_id) do nothing;
$$;

-- Sign-up and email confirmation now also check the domain list.
create or replace function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profile (user_id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do update set email = excluded.email;
  if new.email_confirmed_at is not null and new.email is not null then
    perform public.claim_invitations(new.id, new.email);
    perform public.claim_domains(new.id, new.email);
  end if;
  return new;
end $$;

-- The app calls this on load, so domain lists and invitations added later still apply.
-- It only ever uses the caller's own confirmed address.
create or replace function public.claim_my_access() returns void
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  select email into e from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if e is null then return; end if;
  perform public.claim_invitations(auth.uid(), e);
  perform public.claim_domains(auth.uid(), e);
end $$;

-- ---------------------------------------------------------------- access requests
alter table public.access_request add column if not exists email text;
-- Requests now go only through request_access(), which records the requester's real, confirmed email.
drop policy if exists "ask" on public.access_request;

create or replace function public.request_access(p_slug text, p_message text) returns text
language plpgsql security definer set search_path = '' as $$
declare d uuid; e text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select email into e from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if e is null then raise exception 'Confirm your email address first.'; end if;
  select id into d from public.district where slug = lower(trim(p_slug));
  if d is null then return 'sent'; end if;                     -- don't reveal which districts exist
  if exists (select 1 from public.district_member where district_id = d and user_id = auth.uid()) then return 'member'; end if;
  insert into public.access_request (district_id, user_id, email, message, status)
  values (d, auth.uid(), e, left(coalesce(p_message, ''), 1000), 'pending')
  on conflict (district_id, user_id) do update
    set message = excluded.message, email = excluded.email, status = 'pending', created_at = now(), decided_at = null, decided_by = null;
  return 'sent';
end $$;

-- ---------------------------------------------------------------- invitation emails
alter table public.invitation add column if not exists last_sent_at timestamptz;
alter table public.invitation add column if not exists sent_count int not null default 0;

-- ---------------------------------------------------------------- permissions
revoke execute on function public.claim_domains(uuid, text)    from public, anon, authenticated;
revoke execute on function public.check_allowed_domains()      from public, anon, authenticated;
revoke execute on function public.handle_auth_user()           from public, anon, authenticated;
revoke execute on function public.claim_my_access()            from public, anon;
revoke execute on function public.request_access(text, text)   from public, anon;
grant  execute on function public.claim_my_access()            to authenticated;
grant  execute on function public.request_access(text, text)   to authenticated;

-- ---------------------------------------------------------------- check (every row should say PASS)
select 1 as n, 'New columns are in place' as test,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and
                   ((table_name = 'district' and column_name in ('allowed_domains', 'domain_role')) or
                    (table_name = 'access_request' and column_name = 'email') or
                    (table_name = 'invitation' and column_name in ('last_sent_at', 'sent_count')))) = 5
            then 'PASS' else 'FAIL' end as result
union all
select 2, 'Signed-in users can request access and refresh their own access',
       case when has_function_privilege('authenticated', 'public.request_access(text,text)', 'execute')
             and has_function_privilege('authenticated', 'public.claim_my_access()', 'execute') then 'PASS' else 'FAIL' end
union all
select 3, 'Signed-in users cannot grant themselves a domain or another person’s access',
       case when not has_function_privilege('authenticated', 'public.claim_domains(uuid,text)', 'execute')
             and not has_function_privilege('authenticated', 'public.claim_invitations(uuid,text)', 'execute') then 'PASS' else 'FAIL' end
union all
select 4, 'Anonymous visitors still reach only the public page',
       case when not has_function_privilege('anon', 'public.request_access(text,text)', 'execute')
             and not has_function_privilege('anon', 'public.claim_my_access()', 'execute') then 'PASS' else 'FAIL' end
union all
select 5, 'Direct inserts into access requests are closed',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'access_request' and policyname = 'ask')
            then 'PASS' else 'FAIL' end
order by n;
