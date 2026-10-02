/* HighGround decision packet test. Run: node packet_test.js */
const C = require('./capital.js'), D = require('./demo_data.js'), K = require('./packet.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b) => Math.abs(a - b) < 0.01;
let i = 0; const R = C.demoRows(D['bridger-hollow'], 'dB', () => 'id-' + (++i));
const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario, initiatives: R.initiative,
  phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: R.recurring_cost, scenario_initiative: R.scenario_initiative };
const board = R.scenario[0].id, idOf = (n) => R.initiative.find((x) => x.name === n).id;
const P = K.build(rows, idOf('CTE and ag building addition'), board);
check('what it is: name, status, priority, owner', P.initiative.name === 'CTE and ag building addition' && P.initiative.status === 'analysis' && P.initiative.tier === 'strategic' && P.initiative.owner === 'Superintendent');
check('five years from the plan’s start', P.years.join() === '2027,2028,2029,2030,2031');
const infl = 0.035, save = P.byFund.find((r) => r.fund === 'save'), camp = P.byFund.find((r) => r.fund === 'camp');
// design FY2029 (plan year 2): 180,000 × 1.035² · construction FY2030 (year 3): 2,400,000 × 1.035³, split 75% campaign / 25% SAVE
check('costs by fund and year, in each year’s dollars', near(save.values[2], 180000 * Math.pow(1 + infl, 2)) && near(save.values[3], 2400000 * Math.pow(1 + infl, 3) * 0.25) && near(camp.values[3], 2400000 * Math.pow(1 + infl, 3) * 0.75), [save.values, camp.values]);
check('effect on the gap: at least the unpaid campaign share comes off without it', P.gap.effect >= 2400000 * Math.pow(1 + infl, 3) * 0.75 - 1 && near(P.gap.with - P.gap.without, P.gap.effect), P.gap);
check('lowest SAVE balance with and without it', P.lows.length === 1 && P.lows[0].fund === 'save' && P.lows[0].without >= P.lows[0].with, P.lows);
check('funding line: its place in the list', P.fundingLine && P.fundingLine.position > 0 && P.fundingLine.of === 14);
check('other scenarios that include it', P.others.length === 2 && P.others.some((o) => /bond/.test(o.name)));
const F = K.build(rows, idOf('FFA program'), board);
check('yearly costs by year (teacher and supplies from FY2028)', F.yearly[0] === 0 && near(F.yearly[1], 68000 + 7500) && F.recur.length === 2, F.yearly);
check('a program’s yearly general-fund costs leave the capital gap alone', Math.abs(F.gap.effect - (F.oneTimeAll > 0 ? F.gap.effect : 0)) < 1e-9 && F.lows.every((l) => l.fund !== 'general'));
const Bnd = K.build(rows, idOf('CTE and ag building addition'), R.scenario[1].id);
check('in the bond scenario: the added tax with and without it is reported', Bnd.tax.hasValuation && Bnd.tax.with >= Bnd.tax.without);
check('plain data, safe to store', JSON.parse(JSON.stringify(P)).gap.effect === P.gap.effect);
console.log(`CTE building: ${Math.round(P.oneTimeAll).toLocaleString()} one-time; gap with it ${Math.round(P.gap.with).toLocaleString()}, without ${Math.round(P.gap.without).toLocaleString()}; #${P.fundingLine.position} of ${P.fundingLine.of}`);
console.log(`packet tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
