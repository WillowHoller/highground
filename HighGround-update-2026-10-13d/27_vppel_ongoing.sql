-- HighGround part 27: ongoing V-PPEL commitments. Written 2026-10-13. Safe to run twice.
-- Paste into the Supabase SQL Editor and Run, AFTER uploading the new app files to GitHub.
--
-- The state's annual report has one PPEL fund for regular and voter-approved PPEL. The app now splits its
-- ongoing (non-construction, non-debt) spending between PPEL and V-PPEL by the two levy rates, like the
-- balance and receipts, so V-PPEL needs a place to keep its share. Nothing else changes in the database.

set search_path = public, extensions;

alter table public.district_settings
  add column if not exists vppel_ongoing numeric(14,2) not null default 0;

alter table public.district_settings drop constraint if exists district_settings_vppel_ongoing_check;
alter table public.district_settings add constraint district_settings_vppel_ongoing_check check (vppel_ongoing >= 0);

select case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'district_settings' and column_name = 'vppel_ongoing')
            then 'PASS' else 'FAIL' end as result,
       'district_settings.vppel_ongoing' as check_name;
