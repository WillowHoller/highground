-- HighGround / CIP planner: base tables for a NEW Supabase project (was supabase_setup_horizon.sql).
-- Paste all of this into SQL Editor and click Run. Safe to run twice; it skips anything that exists.
-- Section 5 makes admin@willowholler.com (Willow Holler) the all-districts admin.

-- 1. One row per district. The whole plan (settings, project list, scenarios) is stored as JSON in doc.
create table if not exists public.cip_tenant (
  id          text primary key,              -- tenant id used in the link: ?d=loma
  doc         jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 2. Who may write which district. tenant_id '*' = may write every district.
create table if not exists public.cip_member (
  tenant_id  text not null,
  email      text not null,
  role       text not null default 'editor' check (role in ('admin','editor')),
  primary key (tenant_id, email)
);

alter table public.cip_tenant enable row level security;
alter table public.cip_member enable row level security;

-- 3. The write check (security definer so it can read cip_member without exposing it).
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

-- 4. Policies. Read: everyone (board members open the link with no account). Write: members only.
drop policy if exists "cip read"   on public.cip_tenant;
drop policy if exists "cip insert" on public.cip_tenant;
drop policy if exists "cip update" on public.cip_tenant;
create policy "cip read"   on public.cip_tenant for select to anon, authenticated using (true);
create policy "cip insert" on public.cip_tenant for insert to authenticated with check (public.cip_can_write(id));
create policy "cip update" on public.cip_tenant for update to authenticated
  using (public.cip_can_write(id)) with check (public.cip_can_write(id));

drop policy if exists "cip own membership" on public.cip_member;
create policy "cip own membership" on public.cip_member for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 5. The Willow Holler admin account is the '*' admin: it can write every district, including the demos.
insert into public.cip_member (tenant_id, email, role) values
  ('*', 'admin@willowholler.com', 'admin')
on conflict do nothing;

-- 6. People and access requests (Settings -> People).
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

drop policy if exists "cip admins see members"    on public.cip_member;
drop policy if exists "cip admins add members"    on public.cip_member;
drop policy if exists "cip admins remove members" on public.cip_member;
create policy "cip admins see members"    on public.cip_member for select to authenticated using (public.cip_is_admin(tenant_id));
create policy "cip admins add members"    on public.cip_member for insert to authenticated
  with check (tenant_id <> '*' and public.cip_is_admin(tenant_id));
create policy "cip admins remove members" on public.cip_member for delete to authenticated
  using (tenant_id <> '*' and public.cip_is_admin(tenant_id));

create table if not exists public.cip_access_request (
  tenant_id  text not null,
  email      text not null,
  status     text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);
alter table public.cip_access_request enable row level security;
drop policy if exists "cip ask for access"      on public.cip_access_request;
drop policy if exists "cip see own request"     on public.cip_access_request;
drop policy if exists "cip admins see requests" on public.cip_access_request;
drop policy if exists "cip admins answer"       on public.cip_access_request;
create policy "cip ask for access"      on public.cip_access_request for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'pending');
create policy "cip see own request"     on public.cip_access_request for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "cip admins see requests" on public.cip_access_request for select to authenticated using (public.cip_is_admin(tenant_id));
create policy "cip admins answer"       on public.cip_access_request for update to authenticated
  using (public.cip_is_admin(tenant_id)) with check (public.cip_is_admin(tenant_id));

grant select, insert, update on public.cip_tenant to anon, authenticated;
grant select, insert, delete on public.cip_member to authenticated;
grant select, insert, update on public.cip_access_request to authenticated;

-- 7. Project suggestions (anyone signed in can suggest; the district's editors review).
create table if not exists public.cip_project_request (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null,
  email      text not null,
  name       text not null check (length(name) between 1 and 90),
  fy         int,
  estimate   numeric,
  reason     text check (reason is null or length(reason) <= 800),
  status     text not null default 'pending' check (status in ('pending','added','declined')),
  created_at timestamptz not null default now()
);
alter table public.cip_project_request enable row level security;
drop policy if exists "cip suggest"            on public.cip_project_request;
drop policy if exists "cip see own suggestion" on public.cip_project_request;
drop policy if exists "cip editors see"        on public.cip_project_request;
drop policy if exists "cip editors answer"     on public.cip_project_request;
create policy "cip suggest"            on public.cip_project_request for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'pending');
create policy "cip see own suggestion" on public.cip_project_request for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "cip editors see"        on public.cip_project_request for select to authenticated using (public.cip_can_write(tenant_id));
create policy "cip editors answer"     on public.cip_project_request for update to authenticated
  using (public.cip_can_write(tenant_id)) with check (public.cip_can_write(tenant_id));
grant select, insert, update on public.cip_project_request to authenticated;

-- 8. Check: lists every table in the project with RLS status, and your admin row.
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
