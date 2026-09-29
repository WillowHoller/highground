-- =====================================================================================
-- HighGround database — part 2 of 4: who can do what
-- Row Level Security on every table, account/invitation handling, audit trail, and the
-- functions the app calls (apply an import, copy a scenario, read the public page).
--
-- Roles per district
--   admin            everything in the district: people, settings, publishing, unlocking
--   business_manager uploads monthly GL / budget / balances, settings, debt, measures
--   superintendent   initiatives, scenarios, goals, measures, project and goal uploads
--   editor           same as superintendent
--   board            read everything in the district
--   viewer           read everything in the district
-- Willow Holler staff (platform_admin) can do everything in every district.
-- Anonymous visitors can read only what an admin has published, through public_publication().
-- =====================================================================================

-- ------------------------------------------------------------------ permission helpers
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admin where user_id = auth.uid());
$$;

create or replace function public.has_role(d uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or exists (select 1 from public.district_member m
                 where m.district_id = d and m.user_id = auth.uid() and m.role = any(roles));
$$;

create or replace function public.is_member(d uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.has_role(d, array['admin','business_manager','superintendent','editor','board','viewer']);
$$;
create or replace function public.is_district_admin(d uuid) returns boolean
language sql stable set search_path = '' as $$ select public.has_role(d, array['admin']); $$;
create or replace function public.can_plan(d uuid) returns boolean
language sql stable set search_path = '' as $$ select public.has_role(d, array['admin','superintendent','editor']); $$;
create or replace function public.can_finance(d uuid) returns boolean
language sql stable set search_path = '' as $$ select public.has_role(d, array['admin','business_manager']); $$;
create or replace function public.can_measure(d uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.has_role(d, array['admin','superintendent','editor','business_manager']);
$$;
create or replace function public.can_import(d uuid, k text) returns boolean
language sql stable set search_path = '' as $$
  select case when k in ('gl_monthly','budget','balances') then public.can_finance(d)
              when k = 'measure_values'                   then public.can_measure(d)
              else public.can_plan(d) end;
$$;

create or replace function public.scenario_unlocked(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not is_locked from public.scenario where id = s), false);
$$;
create or replace function public.phase_unlocked(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not s.is_locked from public.phase ph join public.scenario s on s.id = ph.scenario_id
                   where ph.id = p), false);
$$;
create or replace function public.initiative_in_locked_scenario(i uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.phase ph join public.scenario s on s.id = ph.scenario_id
                 where ph.initiative_id = i and s.is_locked)
      or exists (select 1 from public.scenario_initiative si join public.scenario s on s.id = si.scenario_id
                 where si.initiative_id = i and s.is_locked);
$$;
create or replace function public.shares_district_with(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.district_member a join public.district_member b using (district_id)
                 where a.user_id = auth.uid() and b.user_id = u);
$$;
create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return t::uuid; exception when others then return null; end $$;

-- ------------------------------------------------------------------ accounts and invitations
-- Membership comes only from an invitation, and only once the email address is confirmed.
create or replace function public.claim_invitations(uid uuid, addr text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.district_member (district_id, user_id, role)
  select i.district_id, uid, i.role
  from public.invitation i
  where lower(i.email) = lower(addr) and i.accepted_at is null and i.expires_at > now()
  on conflict (district_id, user_id) do update set role = excluded.role;

  update public.invitation
     set accepted_at = now(), accepted_by = uid
   where lower(email) = lower(addr) and accepted_at is null and expires_at > now();
end $$;

create or replace function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profile (user_id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do update set email = excluded.email;
  if new.email_confirmed_at is not null and new.email is not null then
    perform public.claim_invitations(new.id, new.email);
  end if;
  return new;
end $$;

create trigger highground_auth_user_created
  after insert on auth.users for each row execute function public.handle_auth_user();
create trigger highground_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function public.handle_auth_user();

-- If the invited person already has a confirmed account, the invitation applies at once.
create or replace function public.handle_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  select id, email into u from auth.users
   where lower(email) = lower(new.email) and email_confirmed_at is not null limit 1;
  if found then perform public.claim_invitations(u.id, u.email); end if;
  return null;
end $$;
create trigger invitation_claim after insert on public.invitation
  for each row execute function public.handle_invitation();

-- ------------------------------------------------------------------ scenario and publishing guards
create or replace function public.guard_scenario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;            -- SQL editor / service key
  if tg_op = 'UPDATE' and old.is_locked and not new.is_locked
     and not public.is_district_admin(new.district_id) then
    raise exception 'Only a district admin can unlock a scenario' using errcode = '42501';
  end if;
  if ((tg_op = 'INSERT' and new.is_board_version)
      or (tg_op = 'UPDATE' and new.is_board_version is distinct from old.is_board_version))
     and not public.is_district_admin(new.district_id) then
    raise exception 'Only a district admin can choose the board version' using errcode = '42501';
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger scenario_guard before insert or update on public.scenario
  for each row execute function public.guard_scenario();

create or replace function public.publication_make_current() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_current then
    update public.publication set is_current = false
     where district_id = new.district_id and kind = new.kind and is_current and id <> new.id;
  end if;
  return new;
end $$;
create trigger publication_current before insert on public.publication
  for each row execute function public.publication_make_current();

-- ------------------------------------------------------------------ audit trail
create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb; n jsonb; d uuid;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  d := public.try_uuid(coalesce(n ->> 'district_id', o ->> 'district_id',
         case when tg_table_name = 'district' then coalesce(n ->> 'id', o ->> 'id') end));
  insert into public.audit_log (district_id, table_name, row_pk, action, actor, old_row, new_row)
  values (d, tg_table_name, coalesce(n ->> 'id', o ->> 'id'), lower(tg_op), auth.uid(), o, n);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['district','district_member','invitation','district_settings','debt_obligation',
    'fund_balance','initiative','scenario','phase','phase_funding','recurring_cost','financing',
    'priority','outcome','measure','measure_value','import_batch','gl_account','publication']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ Row Level Security
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Standard district tables: members read; the named permission writes.
do $$
declare r record;
begin
  for r in select * from (values
      ('district_settings','can_finance'), ('debt_obligation','can_finance'), ('fund_balance','can_finance'),
      ('gl_account','can_finance'),        ('gl_amount','can_finance'),       ('budget_line','can_finance'),
      ('assumption_set','can_plan'),       ('priority','can_plan'),           ('outcome','can_plan'),
      ('measure','can_plan'),              ('survey','can_plan'),             ('survey_result','can_plan'),
      ('initiative_note','can_plan'),      ('attachment','can_plan'),
      ('measure_value','can_measure')
    ) as v(tbl, fn)
  loop
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (public.is_member(district_id))', r.tbl);
    execute format('create policy "writers insert" on public.%I for insert to authenticated
                    with check (public.%I(district_id))', r.tbl, r.fn);
    execute format('create policy "writers update" on public.%I for update to authenticated
                    using (public.%I(district_id)) with check (public.%I(district_id))', r.tbl, r.fn, r.fn);
    execute format('create policy "writers delete" on public.%I for delete to authenticated
                    using (public.%I(district_id))', r.tbl, r.fn);
  end loop;
end $$;

-- Scenario contents: planners write, and only while the scenario is unlocked.
do $$
declare t text;
begin
  foreach t in array array['scenario_initiative','phase','recurring_cost','financing'] loop
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (public.is_member(district_id))', t);
    execute format('create policy "planners insert" on public.%I for insert to authenticated
                    with check (public.can_plan(district_id) and public.scenario_unlocked(scenario_id))', t);
    execute format('create policy "planners update" on public.%I for update to authenticated
                    using (public.can_plan(district_id) and public.scenario_unlocked(scenario_id))
                    with check (public.can_plan(district_id) and public.scenario_unlocked(scenario_id))', t);
    execute format('create policy "planners delete" on public.%I for delete to authenticated
                    using (public.can_plan(district_id) and public.scenario_unlocked(scenario_id))', t);
  end loop;
end $$;

create policy "members read" on public.phase_funding for select to authenticated
  using (public.is_member(district_id));
create policy "planners insert" on public.phase_funding for insert to authenticated
  with check (public.can_plan(district_id) and public.phase_unlocked(phase_id));
create policy "planners update" on public.phase_funding for update to authenticated
  using (public.can_plan(district_id) and public.phase_unlocked(phase_id))
  with check (public.can_plan(district_id) and public.phase_unlocked(phase_id));
create policy "planners delete" on public.phase_funding for delete to authenticated
  using (public.can_plan(district_id) and public.phase_unlocked(phase_id));

-- district
create policy "members read" on public.district for select to authenticated using (public.is_member(id));
create policy "staff insert" on public.district for insert to authenticated with check (public.is_platform_admin());
create policy "admins update" on public.district for update to authenticated
  using (public.is_district_admin(id)) with check (public.is_district_admin(id));
create policy "staff delete" on public.district for delete to authenticated using (public.is_platform_admin());

-- profile: yourself and people in your districts
create policy "read colleagues" on public.profile for select to authenticated
  using (user_id = auth.uid() or public.shares_district_with(user_id) or public.is_platform_admin());
create policy "edit self" on public.profile for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read self" on public.platform_admin for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- people
create policy "members read" on public.district_member for select to authenticated using (public.is_member(district_id));
create policy "admins insert" on public.district_member for insert to authenticated with check (public.is_district_admin(district_id));
create policy "admins update" on public.district_member for update to authenticated
  using (public.is_district_admin(district_id)) with check (public.is_district_admin(district_id));
create policy "admins or self delete" on public.district_member for delete to authenticated
  using (public.is_district_admin(district_id) or user_id = auth.uid());

create policy "admins all" on public.invitation for all to authenticated
  using (public.is_district_admin(district_id)) with check (public.is_district_admin(district_id));

create policy "ask" on public.access_request for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "see own or admin" on public.access_request for select to authenticated
  using (user_id = auth.uid() or public.is_district_admin(district_id));
create policy "admins decide" on public.access_request for update to authenticated
  using (public.is_district_admin(district_id)) with check (public.is_district_admin(district_id));
create policy "withdraw or admin" on public.access_request for delete to authenticated
  using (user_id = auth.uid() or public.is_district_admin(district_id));

-- initiatives: can't delete one that sits in a locked scenario unless you're an admin
create policy "members read" on public.initiative for select to authenticated using (public.is_member(district_id));
create policy "planners insert" on public.initiative for insert to authenticated with check (public.can_plan(district_id));
create policy "planners update" on public.initiative for update to authenticated
  using (public.can_plan(district_id)) with check (public.can_plan(district_id));
create policy "planners delete" on public.initiative for delete to authenticated
  using (public.can_plan(district_id)
         and (public.is_district_admin(district_id) or not public.initiative_in_locked_scenario(id)));

-- scenarios: locked ones change only by an admin
create policy "members read" on public.scenario for select to authenticated using (public.is_member(district_id));
create policy "planners insert" on public.scenario for insert to authenticated with check (public.can_plan(district_id));
create policy "planners update" on public.scenario for update to authenticated
  using (public.can_plan(district_id) and (not is_locked or public.is_district_admin(district_id)))
  with check (public.can_plan(district_id));
create policy "planners delete" on public.scenario for delete to authenticated
  using (public.can_plan(district_id) and (not is_locked or public.is_district_admin(district_id)));

-- suggestions: anyone signed in may suggest; planners review
create policy "suggest" on public.project_request for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "see own or planners" on public.project_request for select to authenticated
  using (user_id = auth.uid() or public.can_plan(district_id));
create policy "planners decide" on public.project_request for update to authenticated
  using (public.can_plan(district_id)) with check (public.can_plan(district_id));
create policy "planners delete" on public.project_request for delete to authenticated
  using (public.can_plan(district_id));

-- uploads: who may upload depends on the kind of file
create policy "members read" on public.import_batch for select to authenticated using (public.is_member(district_id));
create policy "uploaders insert" on public.import_batch for insert to authenticated
  with check (public.can_import(district_id, kind) and status in ('uploaded','review'));
create policy "uploaders update" on public.import_batch for update to authenticated
  using (public.can_import(district_id, kind) and status in ('uploaded','review'))
  with check (public.can_import(district_id, kind) and status in ('uploaded','review','discarded'));
create policy "admins delete" on public.import_batch for delete to authenticated
  using (public.is_district_admin(district_id));

do $$
declare t text;
begin
  foreach t in array array['import_row','import_issue'] loop
    execute format('create policy "uploaders all" on public.%I for all to authenticated
      using (exists (select 1 from public.import_batch b where b.id = batch_id and public.can_import(b.district_id, b.kind)))
      with check (exists (select 1 from public.import_batch b where b.id = batch_id and public.can_import(b.district_id, b.kind)))', t);
  end loop;
end $$;

-- reports and publishing
create policy "members read" on public.report_snapshot for select to authenticated using (public.is_member(district_id));
create policy "writers insert" on public.report_snapshot for insert to authenticated
  with check (public.can_plan(district_id) or public.can_finance(district_id));
create policy "admins delete" on public.report_snapshot for delete to authenticated using (public.is_district_admin(district_id));

create policy "members read" on public.publication for select to authenticated using (public.is_member(district_id));
create policy "admins publish" on public.publication for insert to authenticated with check (public.is_district_admin(district_id));
create policy "admins update" on public.publication for update to authenticated
  using (public.is_district_admin(district_id)) with check (public.is_district_admin(district_id));
create policy "admins delete" on public.publication for delete to authenticated using (public.is_district_admin(district_id));

-- rules: everyone signed in reads; only Willow Holler staff edit
create policy "read" on public.rule_value for select to authenticated using (true);
create policy "staff write" on public.rule_value for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- audit: district admins read their district; nobody edits
create policy "admins read" on public.audit_log for select to authenticated
  using (public.is_platform_admin() or (district_id is not null and public.is_district_admin(district_id)));

-- ------------------------------------------------------------------ functions the app calls
-- Apply a reviewed upload. Replaces the earlier applied upload of the same kind and month.
-- For a monthly GL import, refreshes fund balances from accounts mapped to 'fund_balance'.
create or replace function public.apply_import(p_batch uuid) returns public.import_batch
language plpgsql security definer set search_path = '' as $$
declare b public.import_batch;
begin
  select * into b from public.import_batch where id = p_batch for update;
  if not found then raise exception 'Import not found'; end if;
  if not public.can_import(b.district_id, b.kind) then
    raise exception 'You do not have permission to apply this import' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','review') then raise exception 'This import is already %', b.status; end if;
  if exists (select 1 from public.import_issue where batch_id = p_batch and severity = 'error' and not resolved) then
    raise exception 'Resolve the errors in this import before applying it';
  end if;

  update public.import_batch set status = 'superseded', superseded_by = p_batch
   where district_id = b.district_id and kind = b.kind and status = 'applied'
     and period_end is not distinct from b.period_end and id <> p_batch;

  update public.import_batch set status = 'applied', applied_by = auth.uid(), applied_at = now()
   where id = p_batch returning * into b;

  if b.kind = 'gl_monthly' then
    insert into public.fund_balance (district_id, fund, as_of, amount, source, import_batch_id, created_by)
    select b.district_id, a.mapped_fund, b.period_end, sum(coalesce(g.ytd_amount, 0) * a.sign), 'gl_import', b.id, auth.uid()
      from public.gl_amount g join public.gl_account a on a.id = g.account_id
     where g.batch_id = b.id and a.maps_to = 'fund_balance' and a.mapped_fund is not null
     group by a.mapped_fund
    on conflict (district_id, fund, as_of)
      do update set amount = excluded.amount, source = 'gl_import', import_batch_id = excluded.import_batch_id;
  end if;
  return b;
end $$;

-- Copy a scenario (with its initiatives, phases, funding, yearly costs and financing) into a new, unlocked one.
create or replace function public.copy_scenario(p_source uuid, p_name text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare s public.scenario; new_id uuid; ph record; new_phase uuid;
begin
  select * into s from public.scenario where id = p_source;
  if not found then raise exception 'Scenario not found'; end if;
  insert into public.scenario (district_id, name, description, assumption_set_id, lever_vppel, lever_sf2472,
                               lever_ppel_growth, lever_grant_yield, lever_save_trend, lever_inflation)
  values (s.district_id, p_name, s.description, s.assumption_set_id, s.lever_vppel, s.lever_sf2472,
          s.lever_ppel_growth, s.lever_grant_yield, s.lever_save_trend, s.lever_inflation)
  returning id into new_id;

  insert into public.scenario_initiative (scenario_id, initiative_id, district_id, rank, included)
  select new_id, initiative_id, district_id, rank, included from public.scenario_initiative where scenario_id = p_source;

  for ph in select * from public.phase where scenario_id = p_source loop
    insert into public.phase (district_id, scenario_id, initiative_id, seq, fy, cost, status, actual_cost,
                              start_date, due_date, done_date)
    values (ph.district_id, new_id, ph.initiative_id, ph.seq, ph.fy, ph.cost, ph.status, ph.actual_cost,
            ph.start_date, ph.due_date, ph.done_date)
    returning id into new_phase;
    insert into public.phase_funding (phase_id, district_id, fund, pct)
    select new_phase, district_id, fund, pct from public.phase_funding where phase_id = ph.id;
  end loop;

  insert into public.recurring_cost (district_id, scenario_id, initiative_id, kind, fund, first_fy, last_fy,
                                     annual_amount, fte, grows_with)
  select district_id, new_id, initiative_id, kind, fund, first_fy, last_fy, annual_amount, fte, grows_with
    from public.recurring_cost where scenario_id = p_source;

  insert into public.financing (district_id, scenario_id, name, kind, issue_fy, amount, rate, years, repay_from)
  select district_id, new_id, name, kind, issue_fy, amount, rate, years, repay_from
    from public.financing where scenario_id = p_source;
  return new_id;
end $$;

-- The only thing an anonymous visitor can read: the current published page for a district link.
create or replace function public.public_publication(p_slug text, p_kind text default 'board_plan') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'district', jsonb_build_object('slug', d.slug, 'name', d.name, 'short_name', d.short_name,
                                          'state', d.state, 'brand_color', d.brand_color, 'logo_path', d.logo_path,
                                          'is_demo', d.is_demo),
           'kind', p.kind, 'title', p.title, 'period_end', p.period_end,
           'published_at', p.published_at, 'payload', p.payload)
  from public.district d
  join public.publication p on p.district_id = d.id
  where d.slug = p_slug and d.public_link_enabled
    and p.kind = p_kind and p.is_current and p.withdrawn_at is null
  limit 1;
$$;

-- ------------------------------------------------------------------ grants
-- Anonymous visitors get no table access at all. Signed-in users get table access,
-- and the policies above decide which rows.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.platform_admin from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.public_publication(text, text) to anon;
-- Internal functions: only triggers use these. claim_invitations in particular must never be callable,
-- or a signed-in user could claim an invitation meant for someone else's email.
revoke execute on function public.claim_invitations(uuid, text) from authenticated;
revoke execute on function public.handle_auth_user()           from authenticated;
revoke execute on function public.handle_invitation()          from authenticated;
revoke execute on function public.guard_scenario()             from authenticated;
revoke execute on function public.publication_make_current()   from authenticated;
revoke execute on function public.write_audit()                from authenticated;
revoke execute on function public.set_updated_at()             from authenticated;

-- New tables added later start closed to anonymous visitors too.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
