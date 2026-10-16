-- HighGround part 30: live community surveys. Written 2026-10-15. Safe to run twice.
-- Paste into the Supabase SQL Editor and Run, BEFORE uploading the new app files to GitHub
-- (the new app reads and saves these; the old app ignores them).
--
-- A district can now run its community survey inside HighGround instead of importing results:
--   survey.mode        'imported' (as before: totals typed or uploaded) or 'live' (answered on the public survey page)
--   survey.status      draft → open → closed. Only an open survey can be answered.
--   survey.focus       what it asks: 'ideas' (how much people support initiatives being considered),
--                      'new_ideas' (open suggestions), 'rating' (how the district is doing on each priority). One or more.
--   survey.intro       a short note shown at the top of the survey
--   survey.items       the initiatives and priorities it asks about, copied when it opens, so later edits don't change it
--   district.survey_cadence   how often to remind planners to ask the community: monthly, quarterly (default),
--                             semiannual, annual, or off
--
--   survey_response    one row per answer. NO names, emails or addresses are collected. Members who can plan read them;
--                      nobody can write them directly: answers arrive only through submit_survey() below.
--   public_survey(slug)               the open survey's questions, for the signed-out survey page
--   submit_survey(slug, id, answers, device)   saves one answer, with limits: open surveys only, one answer per device
--                      per survey (a random id the browser keeps; not a fingerprint), size limits, at most 5,000 answers a day.
--   survey_result.kind gains 'support' (an initiative's average support) and 'rating' (a priority's average rating).

set search_path = public, extensions;

alter table public.survey
  add column if not exists mode   text not null default 'imported' check (mode in ('imported', 'live')),
  add column if not exists status text not null default 'closed'   check (status in ('draft', 'open', 'closed')),
  add column if not exists focus  text[] not null default '{}',
  add column if not exists intro  text check (length(intro) <= 600),
  add column if not exists items  jsonb not null default '{}'::jsonb;

alter table public.district
  add column if not exists survey_cadence text not null default 'quarterly'
    check (survey_cadence in ('monthly', 'quarterly', 'semiannual', 'annual', 'off'));

alter table public.survey_result drop constraint if exists survey_result_kind_check;
alter table public.survey_result add constraint survey_result_kind_check
  check (kind in ('importance', 'theme', 'question', 'support', 'rating'));

create table if not exists public.survey_response (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.district(id) on delete cascade,
  survey_id    uuid not null,
  submitted_at timestamptz not null default now(),
  role         text check (role in ('parent', 'staff', 'community', 'student', 'none')),
  answers      jsonb not null default '{}'::jsonb check (pg_column_size(answers) <= 12000),
  device       text not null check (length(device) between 16 and 64),
  unique (survey_id, device),
  foreign key (survey_id, district_id) references public.survey(id, district_id) on delete cascade
);
create index if not exists survey_response_survey_idx on public.survey_response (survey_id, submitted_at);

alter table public.survey_response enable row level security;
drop policy if exists "planners read" on public.survey_response;
create policy "planners read" on public.survey_response for select to authenticated using (public.can_plan(district_id));
drop policy if exists "planners delete" on public.survey_response;
create policy "planners delete" on public.survey_response for delete to authenticated using (public.can_plan(district_id));
drop policy if exists "two-step sign-in" on public.survey_response;
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'two_step_ok') then
    execute 'create policy "two-step sign-in" on public.survey_response as restrictive for all to authenticated '
            'using ((select public.two_step_ok())) with check ((select public.two_step_ok()))';
  end if;
end $$;
revoke all on public.survey_response from anon;
revoke insert, update on public.survey_response from authenticated;
grant select, delete on public.survey_response to authenticated;

-- the open survey, for the signed-out survey page: questions only, never answers
create or replace function public.public_survey(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'district', jsonb_build_object('slug', d.slug, 'name', d.name, 'short_name', d.short_name, 'brand_color', d.brand_color,
                                          'logo_path', d.logo_path, 'is_demo', d.is_demo),
           'survey', jsonb_build_object('id', s.id, 'name', s.name, 'intro', s.intro, 'focus', to_jsonb(s.focus), 'items', s.items,
                                        'closed_on', s.closed_on))
  from public.district d
  join public.survey s on s.district_id = d.id
  where d.slug = p_slug and d.public_link_enabled and s.mode = 'live' and s.status = 'open'
    and (s.closed_on is null or s.closed_on >= current_date)
  order by s.opened_on desc nulls last, s.created_at desc
  limit 1;
$$;

-- one answer. Returns 'saved', 'already' (this device answered already) or 'closed'.
create or replace function public.submit_survey(p_slug text, p_survey uuid, p_answers jsonb, p_device text, p_role text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select sv.id, sv.district_id into s
  from public.survey sv join public.district d on d.id = sv.district_id
  where d.slug = p_slug and d.public_link_enabled and sv.id = p_survey and sv.mode = 'live' and sv.status = 'open'
    and (sv.closed_on is null or sv.closed_on >= current_date);
  if not found then return 'closed'; end if;
  if p_device is null or length(p_device) < 16 or length(p_device) > 64 then raise exception 'bad device id'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 12000 then raise exception 'answers too large'; end if;
  if (select count(*) from public.survey_response r where r.survey_id = s.id and r.submitted_at > now() - interval '1 day') >= 5000 then
    raise exception 'too many answers today';
  end if;
  insert into public.survey_response (district_id, survey_id, answers, device, role)
  values (s.district_id, s.id, p_answers, p_device, case when p_role in ('parent', 'staff', 'community', 'student', 'none') then p_role end)
  on conflict (survey_id, device) do nothing;
  if not found then return 'already'; end if;
  update public.survey set response_count = coalesce(response_count, 0) + 1 where id = s.id;
  return 'saved';
end $$;

revoke execute on function public.public_survey(text) from public;
revoke execute on function public.submit_survey(text, uuid, jsonb, text, text) from public;
grant execute on function public.public_survey(text) to anon, authenticated;
grant execute on function public.submit_survey(text, uuid, jsonb, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'survey has mode, status, focus, intro and items' as test,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'survey'
                  and column_name in ('mode', 'status', 'focus', 'intro', 'items')) = 5 then 'PASS' else 'FAIL' end as result
union all
select 'district has a survey reminder setting',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district' and column_name = 'survey_cadence') then 'PASS' else 'FAIL' end
union all
select 'answers table exists with row level security on',
       case when to_regclass('public.survey_response') is not null and (select relrowsecurity from pg_class where oid = 'public.survey_response'::regclass) then 'PASS' else 'FAIL' end
union all
select 'nobody writes answers directly (only through submit_survey)',
       case when not has_table_privilege('anon', 'public.survey_response', 'insert') and not has_table_privilege('authenticated', 'public.survey_response', 'insert')
             and not has_table_privilege('anon', 'public.survey_response', 'select') then 'PASS' else 'FAIL' end
union all
select 'the public can see an open survey and answer it, nothing else',
       case when has_function_privilege('anon', 'public.public_survey(text)', 'execute') and has_function_privilege('anon', 'public.submit_survey(text, uuid, jsonb, text, text)', 'execute')
            then 'PASS' else 'FAIL' end;
