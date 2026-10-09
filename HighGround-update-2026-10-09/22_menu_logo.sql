-- HighGround part 22: the district's logo in place of its name at the top of the menu
-- Run after part 21. Safe to run more than once.
--
-- district.menu_logo_only = true shows the uploaded logo by itself at the top of the menu, instead of the
-- initials tile and the district's name. Admins change it in Settings → District, under Logo.

alter table public.district add column if not exists menu_logo_only boolean not null default false;

notify pgrst, 'reload schema';

select 1 as n, 'Districts can show their logo alone at the top of the menu' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public'
                         and table_name = 'district' and column_name = 'menu_logo_only') then 'PASS' else 'FAIL' end as result;
