-- =====================================================================================
-- HighGround database — part 8: phase names (run once, before uploading the matching app files)
-- Adds an optional name to each one-time phase ("Chapter start-up fees", "Shop buildout"),
-- and makes "Copy scenario" carry the names along. Re-running is safe.
-- =====================================================================================

alter table public.phase add column if not exists label text;
do $$ begin
  alter table public.phase add constraint phase_label_len check (label is null or length(label) <= 80);
exception when duplicate_object then null; end $$;

-- Same as before, plus the phase name.
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
    insert into public.phase (district_id, scenario_id, initiative_id, seq, label, fy, cost, status, actual_cost,
                              start_date, due_date, done_date)
    values (ph.district_id, new_id, ph.initiative_id, ph.seq, ph.label, ph.fy, ph.cost, ph.status, ph.actual_cost,
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
revoke execute on function public.copy_scenario(uuid, text) from public, anon;
grant execute on function public.copy_scenario(uuid, text) to authenticated;

-- check (both rows should say PASS)
select 1 as n, 'Phases can have a name' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'phase' and column_name = 'label')
            then 'PASS' else 'FAIL' end as result
union all
select 2, 'Copying a scenario carries phase names',
       case when position('ph.label' in pg_get_functiondef('public.copy_scenario(uuid,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end
order by n;
