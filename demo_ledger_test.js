/* HighGround: the demo districts' month-end ledger (14 Oct). Run: node demo_ledger_test.js */
const C = require('./capital.js'), D = require('./demo_data.js'), B = require('./budget.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
Object.keys(D).forEach((slug) => {
  let i = 0; const R = C.demoRows(D[slug], 'd1', () => 'x' + (++i));
  check(`${slug}: three month-ends, July to September of the plan's first year`, R.import_batch.length === 3 && R.import_batch.every((b) => b.kind === 'gl_monthly' && b.status === 'uploaded' && b.fiscal_year === 2027), R.import_batch.map((b) => b.period_end));
  check(`${slug}: revenue and spending accounts only, so applying it never changes the starting balances`, R.gl_account.length > 0 && R.gl_account.every((a) => ['revenue', 'expense', 'initiative'].includes(a.maps_to)));
  check(`${slug}: every account has an amount each month`, R.gl_amount.length === R.gl_account.length * 3);
  const last = R.import_batch[2], S = B.summarize(R.gl_account, R.gl_amount.filter((a) => a.batch_id === last.id), last.period_end, 'budget');
  check(`${slug}: Budget vs. actual has figures for SAVE and PPEL, a quarter of the way through the year`, S.hasBudget && ['save', 'ppel'].every((k) => S.funds.some((f) => f.key === k && f.revenue.budget > 0 && f.revenue.actual > 0)) && Math.abs(S.gone - 0.25) < 1e-9);
  check(`${slug}: nothing has spent more than its budget yet`, S.funds.every((f) => f.spending.actual <= f.spending.budget + 1));
  const ini = R.gl_account.filter((a) => a.maps_to === 'initiative');
  check(`${slug}: this year's capital phases show as spending on those initiatives`, ini.length > 0 && ini.every((a) => R.initiative.some((x) => x.id === a.initiative_id)));
  if (D[slug].settings.gf) check(`${slug}: the General Fund has revenue and spending by function`, S.funds.some((f) => f.key === 'general' && Object.keys(f.byFunction).length >= 8));
});
console.log(`demo ledger tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
