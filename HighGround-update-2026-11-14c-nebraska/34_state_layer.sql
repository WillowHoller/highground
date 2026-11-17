-- =====================================================================================
-- HighGround database — part 34: the state layer (11 Nov 2026)
-- Run after parts 01–33. Paste into Supabase → SQL Editor and Run. Safe to run twice.
--
-- What it does
--  * district_settings.state_inputs: figures only some states need (Nebraska: the $1.05 lid and the
--    property tax request authority). Empty for Iowa.
--  * Nebraska's rule values in rule_value, each with how sure we are (verified / recalled / assumed).
--  * Documents the fund SLOTS: the fund keys stored in phase_funding, fund_balance, debt_obligation and
--    recurring_cost stay save / ppel / vppel / grants / boost / camp / general / debt_levy. Each state's
--    pack (states.js) names them and turns them on or off. Nebraska: ppel = Special Building Fund,
--    vppel = QCPUF levy, save = off. No stored row changes.
--  * district.state already exists (part 01, default 'IA'); the Admin Portal can now set it.
-- =====================================================================================
set search_path = public, extensions;

alter table public.district_settings add column if not exists state_inputs jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'district_settings_state_inputs_object') then
    alter table public.district_settings add constraint district_settings_state_inputs_object check (jsonb_typeof(state_inputs) = 'object');
  end if;
end $$;
comment on column public.district_settings.state_inputs is
  'State-specific starting figures (states.js). Nebraska: {"lid": {"gfRate", "otherRate", "authority", "carry", "growth" (optional; blank = NDE''s formula), "memHist" (K-12 fall membership, oldest first), "memGrowth", "lepPov", "gfGrowth", "boardBump", "sbVoter"}, "taxCredit": {"share"}}. Empty for Iowa.';
comment on column public.district.state is
  'Two-letter state. Picks the state pack (states.js): fund names, rules, calendar, units and words on every screen. IA and NE so far.';
comment on column public.phase_funding.fund is
  'A fund SLOT: save (state shared revenue; Iowa SAVE, off in Nebraska), ppel (board capital levy; Iowa PPEL, Nebraska Special Building), vppel (second capital levy; Iowa V-PPEL, Nebraska QCPUF), grants, boost, camp, general.';

insert into public.rule_value (state, key, fy, value, unit, status, source_note, checked_on) values
  ('NE','levy_lid',null,1.05,'per $100','verified','General Fund + Special Building levy maximum (NDE School Finance Review Commission presentation, Aug 2025)','2026-11-11'),
  ('NE','special_building_max_rate',null,0.14,'per $100','verified','Special Building Fund levy, 14¢ (17.5¢ in some cases), inside the $1.05 lid (NDE, Aug 2025)','2026-11-11'),
  ('NE','qcpuf_max_rate',null,0.03,'per $100','verified','Neb. Rev. Stat. 79-10,110.02: with 79-10,110 levies, 3¢; up to 10 years; no vote','2026-11-12'),
  ('NE','request_authority_base_growth',null,0.03,'share','verified','Property tax request authority: 3% base growth plus enrollment, LEP and poverty growth (NDE 2026-27 explanation)','2026-11-11'),
  ('NE','request_authority_board_vote',null,0.70,'share of board','verified','Extra growth with a 70% board vote: 7% (<=471 ADM), 6% (472-3,044), 5% (3,045-10,000), 4% (>10,000) (NDE 2026-27)','2026-11-11'),
  ('NE','fiscal_year_start_month',null,9,'month','verified','Neb. Rev. Stat. 79-1091: September 1 to August 31','2026-11-12'),
  ('NE','go_referendum_threshold',null,0.50,'share of votes','verified','Neb. Rev. Stat. 10-702: a majority of the electors voting on the question','2026-11-12'),
  ('NE','ag_land_share',null,0.75,'share of actual value','verified','Neb. Rev. Stat. 77-201(2)','2026-11-12'),
  ('NE','ag_land_share_school_bonds',null,0.50,'share of actual value','verified','Neb. Rev. Stat. 77-201(2): school bond levies for bonds approved by voters on or after 1 Jan 2022','2026-11-12'),
  ('NE','gf_ratio_marks',null,0.05,'share','assumed','HighGround marks a 5% and 10% fund balance ratio; Nebraska districts set their own target',null)
on conflict (state, key, fy) do update
  set value = excluded.value, unit = excluded.unit, status = excluded.status, source_note = excluded.source_note, checked_on = excluded.checked_on;

-- ---------- checks: every row should say PASS ----------
select 'state_inputs column' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district_settings' and column_name = 'state_inputs') then 'PASS' else 'FAIL' end as result
union all
select 'Nebraska rule values', case when (select count(*) from public.rule_value where state = 'NE') >= 10 then 'PASS' else 'FAIL' end
union all
select 'Iowa rule values untouched', case when (select count(*) from public.rule_value where state = 'IA') >= 18 then 'PASS' else 'FAIL' end
union all
select 'district.state column', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district' and column_name = 'state') then 'PASS' else 'FAIL' end;
