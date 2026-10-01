/* HighGround scenario comparison test. Run: node compare_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), X = require('./compare.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const newId = () => 'id-' + (++i);
const R = C.demoRows(D['ironwood-valley'], 'd1', newId);
const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing };
const [base, phased] = R.scenario;
const mA = X.metrics(X.run(rows, base.id)), mB = X.metrics(X.run(rows, phased.id));
check('metrics: board version gap is $5.35M', Math.abs(mA.gap - 5350000) < 1, mA.gap);
check('metrics: phased scenario gap is $1.15M', Math.abs(mB.gap - 1150000) < 1, mB.gap);
check('metrics: asks name the GO bond and its vote', mB.asks.some((a) => /general-obligation bond of \$4\.20M in FY2030, which needs a public vote/.test(a)), JSON.stringify(mB.asks));
check('metrics: asks show the yearly levy', mB.asks.some((a) => /Debt service levy of about/.test(a)));
check('metrics: unpaid campaign projects named', mA.asks.some((a) => /\$5\.35M of campaign or bond projects not yet paid for/.test(a)), JSON.stringify(mA.asks));
const ex = X.explain(rows, base.id, phased.id);
check('explain: total is the difference in gaps', Math.abs(ex.total - (mB.gap - mA.gap)) < 1e-6);
check('explain: changes plus their interaction add up exactly', Math.abs(ex.items.reduce((t, x) => t + x.effect, 0) + ex.together - ex.total) < 1e-6);
check('explain: names the bond financing', ex.items.some((x) => x.kind === 'financing' && /adds/.test(x.label)), JSON.stringify(ex.items.map((x) => x.label)));
check('explain: splitting into phases is not reported as a funding or progress change', !ex.items.some((x) => /funding changed|progress changed/.test(x.label)), JSON.stringify(ex.items.map((x) => x.label)));
check('explain: largest effect listed first', ex.items.every((x, k, a) => !k || Math.abs(a[k - 1].effect) >= Math.abs(x.effect)));
// each listed effect is reproducible by applying just that change
const A = X.run(rows, base.id), B = X.run(rows, phased.id);
let reproducible = true;
ex.items.filter((x) => x.kind === 'financing').forEach((x) => {
  const g = E.compute(A.inp.projects, Object.assign({}, A.inp.levers, { fin: B.inp.levers.fin }), A.inp.cfg).gap - A.r.gap;
  if (Math.abs(g - x.effect) > 1e-6) reproducible = false;
});
check('explain: effects reproduce when applied alone', reproducible);
// same scenario against itself: nothing to explain
const same = X.explain(rows, base.id, base.id);
check('explain: a scenario compared with itself has no changes', same.items.length === 0 && same.total === 0);
console.log('\nWhy the gap differs, District baseline → Addition phased:');
ex.items.forEach((x) => console.log('  ', X.fmt(x.effect).padStart(9), x.label));
if (ex.together) console.log('  ', X.fmt(ex.together).padStart(9), 'these changes working together');
console.log('   total', X.fmt(ex.total));
console.log(`\ncompare tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
