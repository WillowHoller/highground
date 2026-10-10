-- HighGround part 24: an initiative can belong to several focus areas ("Academics, Staffing")
-- Run after part 23. Safe to run more than once. No data changes.
--
-- The focus areas stay in initiative.focus_area, separated by commas; the app shows the initiative under each one's filter.
-- The old 40-character limit only fit one area, so it becomes 160.

alter table public.initiative drop constraint if exists initiative_focus_area_check;
alter table public.initiative drop constraint if exists initiative_focus_area_len;
alter table public.initiative add constraint initiative_focus_area_len check (focus_area is null or length(focus_area) <= 160);

notify pgrst, 'reload schema';

select 1 as n, 'An initiative can have several focus areas (up to 160 characters)' as test,
       case when exists (select 1 from pg_constraint where conname = 'initiative_focus_area_len' and pg_get_constraintdef(oid) like '%160%')
             and not exists (select 1 from pg_constraint where conname = 'initiative_focus_area_check')
            then 'PASS' else 'FAIL' end as result;
