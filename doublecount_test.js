/* HighGround: "may be counted twice" check (14 Oct). Run: node doublecount_test.js */
const C = require('./capital.js'), D = require('./demo_data.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const on = { save: 150000, ppel: 40000, vppel: 90000 };
const ph = (fy, b, cost) => ({ fy, cost: cost || 100000, funds: [b] });
const R = (item, o) => C.routineOverlap(item, o || on);
check('buses every year on V-PPEL with an ongoing V-PPEL amount: flagged', R({ name: 'Bus replacement (one a year)', phases: [2027, 2028, 2029].map((y) => ph(y, 'vppel')) }).some((x) => x.fund === 'vppel' && x.how === 'repeats' && x.routine));
check('the same buses with no ongoing V-PPEL amount: not flagged', !R({ name: 'Bus replacement', phases: [2027, 2028].map((y) => ph(y, 'vppel')) }, { save: 0, ppel: 0, vppel: 0 }).length);
check('a one-time building project: not flagged', !R({ name: 'High school roof replacement', phases: [ph(2027, 'save'), ph(2029, 'save', 400000)] }).length);
check('a one-year bus purchase: not flagged', !R({ name: 'Replace two route buses', phases: [ph(2028, 'ppel')] }).length);
check('a device refresh split across PPEL and V-PPEL: flagged on both', R({ name: '1:1 Chromebook refresh', phases: [ph(2027, 'ppel'), ph(2031, 'vppel')] }).length === 2);
check('an even replacement cycle with any name: flagged', R({ name: 'District-wide program', phases: [2028, 2030, 2032, 2034].map((y) => ph(y, 'save', 200000)) }).length === 1);
check('uneven costs and years with a plain name: not flagged', !R({ name: 'Addition and renovation', phases: [ph(2027, 'save', 100000), ph(2028, 'save', 900000), ph(2031, 'save', 50000), ph(2032, 'save', 70000)] }).length);
check('a yearly cost on a capital fund with an ongoing amount: flagged as yearly', R({ name: 'Camera maintenance', yearly: [{ fund: 'save', first: 2028, last: null, amount: 18000 }] }).some((x) => x.how === 'yearly'));
check('a one-year "yearly" cost is one-time: not flagged as yearly', !R({ name: 'Start-up', yearly: [{ fund: 'save', first: 2028, last: 2028, amount: 5000 }] }).length);
check('General Fund yearly costs are never flagged', !R({ name: 'Bus driver', yearly: [{ fund: 'general', first: 2028, last: null, amount: 50000 }] }).length);
check('done phases don’t count', !R({ name: 'Bus replacement', phases: [Object.assign(ph(2026, 'ppel'), { status: 'done' }), ph(2027, 'ppel')] }).length);
// whole scenarios
const scan = (slug) => { let i = 0; const r = C.demoRows(D[slug], 'd1', () => 'x' + (++i));
  const rows = { district: { name: 'x' }, settings: r.district_settings[0], balances: r.fund_balance, debts: r.debt_obligation, scenarios: r.scenario, initiatives: r.initiative, phases: r.phase,
    funding: r.phase_funding, financing: r.financing, recurring: r.recurring_cost || [], scenario_initiative: r.scenario_initiative };
  return C.doubleCount(C.buildInputs(rows, r.scenario[0].id)); };
const bh = scan('bridger-hollow');
check('Bridger Hollow: the yearly bus on V-PPEL is flagged against its $90k ongoing V-PPEL', bh.some((x) => /Bus replacement/.test(x.name) && x.fund === 'vppel' && Math.round(x.ongoing) === 90000), bh.map((x) => x.name));
check('Bridger Hollow: the roof and the CTE addition are not', !bh.some((x) => /roof|CTE/i.test(x.name)));
check('Ironwood Valley: the bus fleet cycle on PPEL is flagged', scan('ironwood-valley').some((x) => /Bus fleet/.test(x.name) && x.fund === 'ppel'));
console.log(`double count tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
