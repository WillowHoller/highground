-- =====================================================================================
-- HighGround database — part 9: one priority (run once)
-- Initiatives now have a single priority: Must-have, Strategic or Nice to have (the `tier` column).
-- This copies the old High/Med/Low into it wherever a priority hasn't been chosen yet:
--   High → Must-have · Med → Strategic · Low or 10-yr → Nice to have.
-- Nothing is deleted. Re-running is safe: it only fills blanks.
-- =====================================================================================

update public.initiative
   set tier = case engine_priority when 'High' then 'must' when 'Med' then 'strategic' when 'Low' then 'nice' when '10-yr' then 'nice' end
 where tier is null and engine_priority is not null;

-- check (should say PASS)
select 'Every initiative with an old priority now has a new one' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result, count(*) || ' still to convert' as detail
  from public.initiative where tier is null and engine_priority is not null;
