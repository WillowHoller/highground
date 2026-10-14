-- HighGround part 28: ongoing SAVE, PPEL and V-PPEL commitments as a share of receipts. Written 2026-10-14. Safe to run twice.
-- Paste into the Supabase SQL Editor and Run, BEFORE uploading the new app files to GitHub
-- (the new app saves these columns; the old app ignores them).
--
-- Starting numbers can now set each fund's ongoing commitment either in dollars a year (as before) or as a share of
-- that fund's receipts each year ("10% of SAVE for regular maintenance"). A share is kept as a fraction (0.10 = 10%).
-- Empty (null) means the dollar amount is used. Nothing else changes in the database.

set search_path = public, extensions;

alter table public.district_settings
  add column if not exists save_ongoing_pct  numeric(6,4),
  add column if not exists ppel_ongoing_pct  numeric(6,4),
  add column if not exists vppel_ongoing_pct numeric(6,4);

alter table public.district_settings drop constraint if exists district_settings_ongoing_pct_check;
alter table public.district_settings add constraint district_settings_ongoing_pct_check check (
  (save_ongoing_pct  is null or save_ongoing_pct  between 0 and 1) and
  (ppel_ongoing_pct  is null or ppel_ongoing_pct  between 0 and 1) and
  (vppel_ongoing_pct is null or vppel_ongoing_pct between 0 and 1));

select case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'district_settings'
                    and column_name in ('save_ongoing_pct', 'ppel_ongoing_pct', 'vppel_ongoing_pct')) = 3
            then 'PASS' else 'FAIL' end as result,
       'district_settings ongoing share columns' as check_name
union all
select case when exists (select 1 from pg_constraint where conname = 'district_settings_ongoing_pct_check')
            then 'PASS' else 'FAIL' end,
       'shares must be between 0% and 100%';
