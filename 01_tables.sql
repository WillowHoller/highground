-- =====================================================================================
-- HighGround database — part 1 of 4: tables
-- Run in the Supabase SQL editor of a NEW, EMPTY project, in order: 01, 02, 03, 04.
-- Contains no personal data and no real district data. Safe to keep in the repo.
--
-- Conventions
--   * Every district-owned row carries district_id. Child tables use composite foreign keys
--     (x_id, district_id) so a row can never point at another district's data.
--   * Money is numeric(14,2) dollars. Fiscal years are integers: 2027 = FY2027 (1 Jul 2026–30 Jun 2027).
--   * Capital buckets match the engine: save, ppel, vppel, grants, boost (boosters), camp (campaign/bond).
--   * No student data. Survey results are stored as totals and themes, never as individual responses.
-- =====================================================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ------------------------------------------------------------------ tenancy and people
create table public.district (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),  -- the link id
  name                text not null check (length(name) <= 120),
  short_name          text check (length(short_name) <= 40),
  state               text not null default 'IA' check (state ~ '^[A-Z]{2}$'),
  county              text,
  brand_color         text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path           text,                        -- path in the district-public storage bucket
  is_demo             boolean not null default false,
  public_link_enabled boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profile_email_idx on public.profile (lower(email));

-- Willow Holler staff who can see and manage every district. Rows are added only in the SQL editor.
create table public.platform_admin (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.district_member (
  district_id uuid not null references public.district(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','business_manager','superintendent','editor','board','viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (district_id, user_id)
);
create index district_member_user_idx on public.district_member (user_id);

-- A district admin invites by email. The invitation turns into membership automatically when a
-- person with that email has an account AND has confirmed the email address.
create table public.invitation (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.district(id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        text not null check (role in ('admin','business_manager','superintendent','editor','board','viewer')),
  invited_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create unique index invitation_open_uq on public.invitation (district_id, lower(email)) where accepted_at is null;

create table public.access_request (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.district(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  message     text check (length(message) <= 1000),
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (district_id, user_id)
);

-- ------------------------------------------------------------------ settings and assumptions
create table public.district_settings (
  district_id            uuid primary key references public.district(id) on delete cascade,
  plan_start_fy          int check (plan_start_fy between 2000 and 2100),
  plan_years             int not null default 10 check (plan_years between 5 and 15),
  enrollment             int check (enrollment >= 0),
  enrollment_year        text,
  save_receipts          numeric(14,2),
  save_receipts_fy       int,
  save_ongoing           numeric(14,2) not null default 0,
  save_trend             numeric(6,4)  not null default 0,
  sf2472                 boolean       not null default true,
  ppel_receipts          numeric(14,2),
  ppel_ongoing           numeric(14,2) not null default 0,
  ppel_growth            numeric(6,4)  not null default 0.03,
  ppel_rate              numeric(6,4),
  taxable_valuation      numeric(16,2),
  actual_valuation       numeric(16,2),
  go_outstanding         numeric(14,2),
  vppel_status           text not null default 'none' check (vppel_status in ('none','proposed','active')),
  vppel_annual           numeric(14,2),
  vppel_rate             numeric(6,4),
  vppel_first_fy         int,
  vppel_last_fy          int,
  grants_avg             numeric(14,2) not null default 0,
  grants_yield           numeric(5,4)  not null default 0.75 check (grants_yield between 0 and 1),
  construction_inflation numeric(6,4)  not null default 0,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null default auth.uid()
);

create table public.debt_obligation (
  id             uuid primary key default gen_random_uuid(),
  district_id    uuid not null references public.district(id) on delete cascade,
  name           text not null,
  fund           text not null check (fund in ('save','ppel','debt_levy')),
  annual_payment numeric(14,2) not null check (annual_payment >= 0),
  final_fy       int not null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index debt_obligation_district_idx on public.debt_obligation (district_id);

-- "The world": Base / Conservative / Growth. General-fund fields are for the later general-fund model.
create table public.assumption_set (
  id                     uuid primary key default gen_random_uuid(),
  district_id            uuid not null references public.district(id) on delete cascade,
  name                   text not null,
  is_default             boolean not null default false,
  construction_inflation numeric(6,4),
  save_trend             numeric(6,4),
  ppel_growth            numeric(6,4),
  grant_yield            numeric(5,4),
  enrollment_change_pct  numeric(6,4),
  state_aid_growth       numeric(6,4),
  settlement_pct         numeric(6,4),
  health_growth          numeric(6,4),
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, district_id)
);
create unique index assumption_set_default_uq on public.assumption_set (district_id) where is_default;

-- ------------------------------------------------------------------ direction (goals)
create table public.priority (
  id                   uuid primary key default gen_random_uuid(),
  district_id          uuid not null references public.district(id) on delete cascade,
  position             int not null default 0,
  name                 text not null check (length(name) <= 120),
  statement            text,
  community_importance numeric(6,2),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, district_id)
);
create index priority_district_idx on public.priority (district_id);

create table public.outcome (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null,
  priority_id uuid not null,
  position    int not null default 0,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, district_id),
  foreign key (priority_id, district_id) references public.priority(id, district_id) on delete cascade
);

create table public.measure (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null references public.district(id) on delete cascade,
  priority_id     uuid,
  outcome_id      uuid,
  name            text not null,
  unit            text,                 -- %, $, count, days …
  better          text not null default 'up' check (better in ('up','down','target')),
  baseline_value  numeric,
  baseline_period text,
  target_value    numeric,
  target_period   text,
  owner_user_id   uuid references auth.users(id) on delete set null,
  owner_name      text,
  cadence         text check (cadence in ('monthly','quarterly','semester','annual')),
  source          text not null default 'manual' check (source in ('manual','progress','import')),
  is_public       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, district_id),
  foreign key (priority_id, district_id) references public.priority(id, district_id) on delete cascade,
  foreign key (outcome_id,  district_id) references public.outcome(id,  district_id) on delete cascade
);
create index measure_district_idx on public.measure (district_id);

-- ------------------------------------------------------------------ decisions (initiatives and scenarios)
create table public.initiative (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null references public.district(id) on delete cascade,
  name            text not null check (length(name) <= 120),
  type            text not null default 'capital'
                  check (type in ('capital','program','staff','curriculum','technology','other')),
  status          text not null default 'proposed'
                  check (status in ('idea','proposed','analysis','approved','underway','done','deferred','declined')),
  priority_id     uuid,
  focus_area      text check (length(focus_area) <= 40),
  tier            text check (tier in ('must','strategic','nice')),
  engine_priority text check (engine_priority in ('High','Med','Low','10-yr')),  -- today's planner priority
  owner_user_id   uuid references auth.users(id) on delete set null,
  owner_name      text,
  description     text,
  cost_confidence text not null default 'estimate' check (cost_confidence in ('firm','estimate')),
  condition       text check (condition in ('good','fair','poor','critical')),
  remaining_life  int check (remaining_life >= 0),
  approved_on     date,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, district_id),
  foreign key (priority_id, district_id) references public.priority(id, district_id) on delete set null (priority_id)
);
create index initiative_district_idx on public.initiative (district_id);

-- A scenario is a complete version of the plan: its own phases, levers and financing.
create table public.scenario (
  id                 uuid primary key default gen_random_uuid(),
  district_id        uuid not null references public.district(id) on delete cascade,
  name               text not null check (length(name) <= 80),
  description        text,
  is_board_version   boolean not null default false,
  is_locked          boolean not null default false,
  assumption_set_id  uuid,
  -- levers: null means "use the district default"
  lever_vppel        boolean,
  lever_sf2472       boolean,
  lever_ppel_growth  numeric(6,4),
  lever_grant_yield  numeric(5,4),
  lever_save_trend   numeric(6,4),
  lever_inflation    numeric(6,4),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at         timestamptz not null default now(),
  unique (id, district_id),
  foreign key (assumption_set_id, district_id) references public.assumption_set(id, district_id) on delete set null (assumption_set_id)
);
create unique index scenario_board_uq on public.scenario (district_id) where is_board_version;

create table public.scenario_initiative (
  scenario_id   uuid not null,
  initiative_id uuid not null,
  district_id   uuid not null,
  rank          int,
  included      boolean not null default true,
  primary key (scenario_id, initiative_id),
  foreign key (scenario_id,   district_id) references public.scenario(id,   district_id) on delete cascade,
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);

create table public.phase (
  id            uuid primary key default gen_random_uuid(),
  district_id   uuid not null,
  scenario_id   uuid not null,
  initiative_id uuid not null,
  seq           int not null default 1,
  fy            int not null check (fy between 2000 and 2100),
  cost          numeric(14,2) not null check (cost >= 0),
  status        text not null default 'planned' check (status in ('planned','underway','done')),
  actual_cost   numeric(14,2),
  start_date    date,
  due_date      date,
  done_date     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, district_id),
  foreign key (scenario_id,   district_id) references public.scenario(id,   district_id) on delete cascade,
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);
create index phase_scenario_idx on public.phase (scenario_id);

create table public.phase_funding (
  phase_id    uuid not null,
  district_id uuid not null,
  fund        text not null check (fund in ('save','ppel','vppel','grants','boost','camp','general')),
  pct         numeric(5,2) not null check (pct > 0 and pct <= 100),
  primary key (phase_id, fund),
  foreign key (phase_id, district_id) references public.phase(id, district_id) on delete cascade
);

-- Yearly costs of programs and hires (the FFA program, a new FTE). Not in today's engine yet.
create table public.recurring_cost (
  id            uuid primary key default gen_random_uuid(),
  district_id   uuid not null,
  scenario_id   uuid not null,
  initiative_id uuid not null,
  kind          text not null check (kind in ('salary','benefits','supplies','activities','contract','other')),
  fund          text not null default 'general' check (fund in ('general','save','ppel','vppel','grants','boost','other')),
  first_fy      int not null,
  last_fy       int,                          -- null = ongoing
  annual_amount numeric(14,2) not null check (annual_amount >= 0),
  fte           numeric(6,2),
  grows_with    text not null default 'none' check (grows_with in ('settlement','inflation','none')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (scenario_id,   district_id) references public.scenario(id,   district_id) on delete cascade,
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);

create table public.financing (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null,
  scenario_id uuid not null,
  name        text not null,
  kind        text not null check (kind in ('go','rev','lease','gift')),
  issue_fy    int not null,
  amount      numeric(14,2) not null check (amount >= 0),
  rate        numeric(6,4) not null default 0,
  years       int not null default 0 check (years between 0 and 40),
  repay_from  text not null check (repay_from in ('levy','save','ppel','none')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (scenario_id, district_id) references public.scenario(id, district_id) on delete cascade
);

create table public.initiative_note (
  id            uuid primary key default gen_random_uuid(),
  district_id   uuid not null,
  initiative_id uuid not null,
  body          text not null check (length(body) <= 5000),
  author        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);

-- Quotes, inspection reports, photos. The file lives in the district-files bucket.
create table public.attachment (
  id            uuid primary key default gen_random_uuid(),
  district_id   uuid not null references public.district(id) on delete cascade,
  initiative_id uuid,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  description   text,
  uploaded_by   uuid references auth.users(id) on delete set null default auth.uid(),
  uploaded_at   timestamptz not null default now(),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete cascade
);

-- Suggestions from staff or community members who have an account.
create table public.project_request (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.district(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  name        text not null check (length(name) <= 120),
  fy          int,
  estimate    numeric(14,2),
  reason      text check (length(reason) <= 2000),
  status      text not null default 'pending' check (status in ('pending','accepted','declined')),
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ uploads and monthly actuals
-- Every upload is a batch. Files go to storage; parsed rows are reviewed; "apply" makes them count.
create table public.import_batch (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.district(id) on delete cascade,
  kind         text not null check (kind in ('gl_monthly','budget','balances','projects','goals','measure_values','survey')),
  period_end   date,                          -- month-end for gl_monthly
  fiscal_year  int,
  file_name    text,
  storage_path text,
  status       text not null default 'uploaded' check (status in ('uploaded','review','applied','discarded','superseded')),
  row_count    int,
  notes        text,
  uploaded_by  uuid references auth.users(id) on delete set null default auth.uid(),
  uploaded_at  timestamptz not null default now(),
  applied_by   uuid references auth.users(id) on delete set null,
  applied_at   timestamptz,
  superseded_by uuid references public.import_batch(id) on delete set null,
  unique (id, district_id),
  check (kind <> 'gl_monthly' or period_end is not null)
);
create index import_batch_district_idx on public.import_batch (district_id, kind, period_end);

create table public.import_row (
  batch_id    uuid not null,
  district_id uuid not null,
  row_no      int not null,
  data        jsonb not null,
  primary key (batch_id, row_no),
  foreign key (batch_id, district_id) references public.import_batch(id, district_id) on delete cascade
);

create table public.import_issue (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null,
  district_id uuid not null,
  row_no      int,
  severity    text not null check (severity in ('info','warning','error')),
  message     text not null,
  resolved    boolean not null default false,
  foreign key (batch_id, district_id) references public.import_batch(id, district_id) on delete cascade
);

-- The district's chart of accounts, learned from its exports and remembered month to month.
-- Segment widths vary by export, so segments are stored as text exactly as exported.
create table public.gl_account (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null references public.district(id) on delete cascade,
  code            text not null,
  fund_code       text,
  facility_code   text,
  function_code   text,
  program_code    text,
  object_code     text,
  project_code    text,
  description     text,
  account_type    text check (account_type in ('revenue','expenditure','balance_sheet','other')),
  maps_to         text not null default 'unmapped'
                  check (maps_to in ('fund_balance','revenue','expense','initiative','ignore','unmapped')),
  mapped_fund     text check (mapped_fund in ('save','ppel','vppel','grants','general','debt_levy','other')),
  sign            smallint not null default 1 check (sign in (1,-1)),  -- flips credit-balance accounts
  category        text,
  initiative_id   uuid,
  needs_review    boolean not null default true,
  first_seen_batch uuid references public.import_batch(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (district_id, code),
  unique (id, district_id),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete set null (initiative_id)
);

create table public.gl_amount (
  id             bigint generated always as identity primary key,
  district_id    uuid not null,
  batch_id       uuid not null,
  account_id     uuid not null,
  fiscal_year    int not null,
  period_end     date not null,
  month_amount   numeric(14,2),
  ytd_amount     numeric(14,2),
  budget_amount  numeric(14,2),
  encumbered     numeric(14,2),
  unique (batch_id, account_id),
  foreign key (batch_id,   district_id) references public.import_batch(id, district_id) on delete cascade,
  foreign key (account_id, district_id) references public.gl_account(id,   district_id) on delete cascade
);
create index gl_amount_district_period_idx on public.gl_amount (district_id, period_end);

create table public.budget_line (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null,
  account_id      uuid not null,
  fiscal_year     int not null,
  version         text not null default 'adopted' check (version in ('proposed','adopted','amended')),
  amount          numeric(14,2) not null,
  import_batch_id uuid,
  unique (account_id, fiscal_year, version),
  foreign key (account_id, district_id) references public.gl_account(id, district_id) on delete cascade,
  foreign key (import_batch_id, district_id) references public.import_batch(id, district_id) on delete set null (import_batch_id)
);

-- Only rows from applied imports count.
create view public.gl_current with (security_invoker = true) as
  select g.*, b.uploaded_at
  from public.gl_amount g
  join public.import_batch b on b.id = g.batch_id
  where b.status = 'applied';

-- Fund balances: manual entry, a balances upload, or refreshed from an applied GL import.
create table public.fund_balance (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null references public.district(id) on delete cascade,
  fund            text not null check (fund in ('save','ppel','vppel','grants','general','debt_levy','other')),
  as_of           date not null,
  amount          numeric(14,2) not null,
  source          text not null default 'manual' check (source in ('manual','upload','gl_import')),
  import_batch_id uuid,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (district_id, fund, as_of),
  foreign key (import_batch_id, district_id) references public.import_batch(id, district_id) on delete set null (import_batch_id)
);

create table public.measure_value (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null,
  measure_id      uuid not null,
  period          text not null,              -- '2026-09', 'FY2027', '2025-26' …
  period_end      date,
  value           numeric not null,
  note            text,
  import_batch_id uuid,
  entered_by      uuid references auth.users(id) on delete set null default auth.uid(),
  entered_at      timestamptz not null default now(),
  unique (measure_id, period),
  foreign key (measure_id, district_id) references public.measure(id, district_id) on delete cascade,
  foreign key (import_batch_id, district_id) references public.import_batch(id, district_id) on delete set null (import_batch_id)
);

-- Community surveys: totals and themes only (no individual responses, no names).
create table public.survey (
  id             uuid primary key default gen_random_uuid(),
  district_id    uuid not null references public.district(id) on delete cascade,
  name           text not null,
  opened_on      date,
  closed_on      date,
  response_count int check (response_count >= 0),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (id, district_id)
);

create table public.survey_result (
  id            uuid primary key default gen_random_uuid(),
  district_id   uuid not null,
  survey_id     uuid not null,
  kind          text not null check (kind in ('importance','theme','question')),
  label         text not null,
  value         numeric,
  mentions      int,
  position      int not null default 0,
  priority_id   uuid,
  initiative_id uuid,
  foreign key (survey_id,     district_id) references public.survey(id,     district_id) on delete cascade,
  foreign key (priority_id,   district_id) references public.priority(id,   district_id) on delete set null (priority_id),
  foreign key (initiative_id, district_id) references public.initiative(id, district_id) on delete set null (initiative_id)
);

-- ------------------------------------------------------------------ reports and publishing
-- Internal dated snapshots (monthly board report, decision packet …).
create table public.report_snapshot (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.district(id) on delete cascade,
  kind         text not null check (kind in ('board_monthly','capital_summary','decision_packet','strategic_progress')),
  title        text,
  period_end   date,
  scenario_id  uuid,
  batch_id     uuid,
  payload      jsonb not null,
  storage_path text,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (scenario_id, district_id) references public.scenario(id, district_id) on delete set null (scenario_id),
  foreign key (batch_id,    district_id) references public.import_batch(id, district_id) on delete set null (batch_id)
);

-- What the public link shows. Only a district admin publishes. The payload is a frozen copy,
-- so drafts, imports and member lists are never readable without an account.
create table public.publication (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.district(id) on delete cascade,
  kind         text not null check (kind in ('board_plan','community_page','board_report')),
  title        text,
  scenario_id  uuid,
  period_end   date,
  payload      jsonb not null,
  is_current   boolean not null default true,
  published_by uuid references auth.users(id) on delete set null default auth.uid(),
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  foreign key (scenario_id, district_id) references public.scenario(id, district_id) on delete set null (scenario_id)
);
create unique index publication_current_uq on public.publication (district_id, kind) where is_current;

-- ------------------------------------------------------------------ state rules (dated, sourced)
create table public.rule_value (
  id          uuid primary key default gen_random_uuid(),
  state       text not null default 'IA',
  key         text not null,
  fy          int,                             -- null = applies to every year
  value       numeric not null,
  unit        text,
  status      text not null check (status in ('verified','recalled','assumed')),
  source_note text,
  source_url  text,
  checked_on  date,
  unique nulls not distinct (state, key, fy)
);

-- ------------------------------------------------------------------ audit log (append-only)
create table public.audit_log (
  id          bigint generated always as identity primary key,
  district_id uuid,
  table_name  text not null,
  row_pk      text,
  action      text not null,
  actor       uuid,
  at          timestamptz not null default now(),
  old_row     jsonb,
  new_row     jsonb
);
create index audit_log_district_idx on public.audit_log (district_id, at desc);

-- ------------------------------------------------------------------ updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['district','profile','district_member','district_settings','debt_obligation',
    'assumption_set','priority','outcome','measure','initiative','scenario','phase','recurring_cost',
    'financing','gl_account']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;
