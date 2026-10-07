-- HighGround part 18: when each initiative is needed by
-- Run after part 17. Safe to run more than once.
--
-- initiative.need_by_fy = the last fiscal year the initiative can wait until (a roof with five years of life left,
-- a program the district wants running by fall 2027). The ranking shows how much room each initiative has, and the
-- suggestions never move one later than this year. Blank = no deadline (the planned year is a preference only).

alter table public.initiative add column if not exists need_by_fy int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'initiative_need_by_fy_check') then
    alter table public.initiative add constraint initiative_need_by_fy_check check (need_by_fy between 2000 and 2100);
  end if;
end $$;

notify pgrst, 'reload schema';

select 1 as n, 'Initiatives can record the year they are needed by' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public'
                         and table_name = 'initiative' and column_name = 'need_by_fy') then 'PASS' else 'FAIL' end as result;
