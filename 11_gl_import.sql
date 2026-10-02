-- =====================================================================================
-- HighGround database — part 11: monthly general-ledger import (run once, before the matching app files)
--   * remembers each district's export layout (which column is which)
--   * Apply computes each fund's month-end balance from the ledger:
--       fund-balance accounts + year-to-date revenue - year-to-date spending,
--     only for funds with a fund-balance account in that import
-- Re-running is safe.
-- =====================================================================================

alter table public.district_settings add column if not exists gl_layout jsonb;

create or replace function public.apply_import(p_batch uuid) returns public.import_batch
language plpgsql security definer set search_path = '' as $$
declare b public.import_batch;
begin
  select * into b from public.import_batch where id = p_batch for update;
  if not found then raise exception 'Import not found'; end if;
  if not public.can_import(b.district_id, b.kind) then
    raise exception 'You do not have permission to apply this import' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','review') then raise exception 'This import is already %', b.status; end if;
  if exists (select 1 from public.import_issue where batch_id = p_batch and severity = 'error' and not resolved) then
    raise exception 'Resolve the errors in this import before applying it';
  end if;

  update public.import_batch set status = 'superseded', superseded_by = p_batch
   where district_id = b.district_id and kind = b.kind and status = 'applied'
     and period_end is not distinct from b.period_end and id <> p_batch;

  update public.import_batch set status = 'applied', applied_by = auth.uid(), applied_at = now()
   where id = p_batch returning * into b;

  if b.kind = 'gl_monthly' then
    -- each fund's month-end balance: fund-balance accounts + year-to-date revenue - year-to-date spending,
    -- only for funds with at least one fund-balance account in this import (a partial export can't set a wrong balance)
    insert into public.fund_balance (district_id, fund, as_of, amount, source, import_batch_id, created_by)
    select b.district_id, a.mapped_fund, b.period_end,
           sum(case when a.maps_to in ('fund_balance', 'revenue') then coalesce(g.ytd_amount, 0) * a.sign
                    when a.maps_to in ('expense', 'initiative') then -coalesce(g.ytd_amount, 0) * a.sign else 0 end),
           'gl_import', b.id, auth.uid()
      from public.gl_amount g join public.gl_account a on a.id = g.account_id
     where g.batch_id = b.id and a.mapped_fund is not null and a.mapped_fund <> 'other'
     group by a.mapped_fund
    having bool_or(a.maps_to = 'fund_balance')
    on conflict (district_id, fund, as_of)
      do update set amount = excluded.amount, source = 'gl_import', import_batch_id = excluded.import_batch_id;
  end if;
  return b;
end $$;

notify pgrst, 'reload schema';

-- check (both rows should say PASS)
select 1 as n, 'District settings can remember the export layout' as test,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'district_settings' and column_name = 'gl_layout')
            then 'PASS' else 'FAIL' end as result
union all
select 2, 'Apply computes balances from fund balance + revenue - spending',
       case when position('bool_or(a.maps_to = ''fund_balance'')' in pg_get_functiondef('public.apply_import(uuid)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end
order by n;
