-- =====================================================================================
-- HighGround database — part 12: progress on the adopted plan (run once, before the matching app files)
-- The board version is usually locked, so its costs, years and funding can't change. Progress still has to be
-- recorded on it: whether each phase is planned, underway or done, its dates, and what it actually cost.
-- set_phase_progress changes ONLY those fields, for people who can plan or manage finances in that district.
-- Every change is still written to the activity log by the existing audit trigger. Re-running is safe.
-- =====================================================================================

create or replace function public.set_phase_progress(
  p_phase uuid, p_status text, p_start date, p_done date, p_actual numeric
) returns public.phase
language plpgsql security definer set search_path = '' as $$
declare ph public.phase;
begin
  select * into ph from public.phase where id = p_phase;
  if not found then raise exception 'Phase not found'; end if;
  if not (public.can_plan(ph.district_id) or public.can_finance(ph.district_id)) then
    raise exception 'You do not have permission to record progress in this district' using errcode = '42501';
  end if;
  if p_status not in ('planned', 'underway', 'done') then raise exception 'Status must be planned, underway or done' using errcode = '22023'; end if;
  if p_actual is not null and p_actual < 0 then raise exception 'Actual cost cannot be negative' using errcode = '22023'; end if;
  if p_start is not null and p_done is not null and p_done < p_start then raise exception 'The finish date is before the start date' using errcode = '22023'; end if;
  update public.phase
     set status = p_status, start_date = p_start, done_date = case when p_status = 'done' then coalesce(p_done, current_date) else null end,
         actual_cost = case when p_status = 'done' then p_actual else null end
   where id = p_phase
  returning * into ph;
  return ph;
end $$;
revoke execute on function public.set_phase_progress(uuid, text, date, date, numeric) from public, anon;
grant execute on function public.set_phase_progress(uuid, text, date, date, numeric) to authenticated;

notify pgrst, 'reload schema';

-- check (should say PASS)
select 'Progress can be recorded on the adopted plan, by signed-in planners only' as test,
       case when has_function_privilege('authenticated', 'public.set_phase_progress(uuid,text,date,date,numeric)', 'execute')
             and not has_function_privilege('anon', 'public.set_phase_progress(uuid,text,date,date,numeric)', 'execute')
            then 'PASS' else 'FAIL' end as result;
