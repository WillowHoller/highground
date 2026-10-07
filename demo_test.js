/* HighGround demo data test: Bridger Hollow loads, holds together, and tells the intended story. Run: node demo_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), K = require('./ranking.js'), T = require('./tax.js'), X = require('./compare.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const B = D['bridger-hollow']; let i = 0;
const R = C.demoRows(B, 'dB', () => 'id-' + (++i));
const rows = { district: { name: B.name }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: R.recurring_cost, scenario_initiative: R.scenario_initiative };
check('fictional name, no real Lo-Ma data', B.name === 'Bridger Hollow Community School District' && !JSON.stringify(B).match(/lo-?ma|logan|magnolia/i));
check('starting numbers complete, including enrollment year and tax estimates', ['plan_years','enrollment','enrollment_year','save_receipts','save_receipts_fy','ppel_receipts','ppel_rate','taxable_valuation','actual_valuation','vppel_status','grants_avg','construction_inflation','tax_home_value','ag_value_per_acre'].every((k) => R.district_settings[0][k] != null) && R.fund_balance.length === 4 && R.debt_obligation.length === 3);
for (const D2 of Object.keys(D)) {
  const RR = C.demoRows(D[D2], 'dX', () => 'z' + (++i));
  const bad = Object.entries(RR).filter(([t, list]) => Array.isArray(list) && list.length && typeof list[0] === 'object' && new Set(list.map((x) => Object.keys(x).sort().join())).size > 1).map(([t]) => t);
  check(`${D2}: every bulk set of rows has matching fields`, !bad.length, bad.join());
}
check('three scenarios: board version locked, a bond, a delay', R.scenario.length === 3 && R.lock.length === 1 && R.financing.some((f) => f.kind === 'go'));
check('initiatives carry type, status, owner and priority', R.initiative.every((x) => x.type && x.status && x.tier) && R.initiative.some((x) => x.owner_name));
check('yearly costs load and belong to their initiatives', R.recurring_cost.length === 9 && R.recurring_cost.every((r) => R.initiative.some((x) => x.id === r.initiative_id)));
// consistency with Iowa rules
const s = B.settings, perStudent = s.save.receipts / B.enrollment;
check('SAVE per student near the FY2026 statewide amount (~$1,358)', Math.abs(perStudent / 1358 - 1) < 0.05, perStudent.toFixed(0));
check('PPEL receipts ≈ $0.33 × taxable valuation', Math.abs(s.ppel.receipts / (0.33 * s.ppel.valuation / 1000) - 1) < 0.02);
check('actual valuation above taxable valuation', s.ppel.actualValuation > s.ppel.valuation);
// the story
const board = R.scenario[0], kb = K.build(rows, board.id);
check('board version: a funding line partway down the list', kb.line > 5 && kb.line < kb.items.length - 2, kb.line);
check('board version: flags explain the shortfall', kb.flags.length >= 2 && kb.flags.every((f) => /SAVE/.test(f.text)));
check('no nameless rows in any scenario', R.scenario.every((sc) => K.build(rows, sc.id).items.every((x) => x.name && x.name !== 'Initiative')));
const bond = R.scenario[1], ib = C.buildInputs(rows, bond.id), tb = T.impact(ib.cfg, ib.levers, ib.tax);
check('bond scenario: a believable tax impact for the example home', tb.peak && tb.peak.home > 5 && tb.peak.home < 200, tb.peak && tb.peak.home);
const mA = X.metrics(X.run(rows, board.id)), mB = X.metrics(X.run(rows, bond.id));
check('bond scenario: a smaller gap than the board version', mB.gap < mA.gap);
const F = require('./gf.js'), g = B.settings.gf, gr = F.forecast(g, g.assume, [2027, 2028, 2029, 2030, 2031]).years;
check('General Fund: believable starting point (revenue ≈ spending, staff about 78%, solvency in the teens)', Math.abs(gr[0].revenue - gr[0].spending) < 0.03 * gr[0].revenue && gr[0].staffShare > 0.74 && gr[0].staffShare < 0.82 && gr[0].solvency > 0.12 && gr[0].solvency < 0.2, gr[0]);
check('General Fund: a steady squeeze over five years (health costs outrun state aid), not a cliff: still at the healthy range’s floor', gr[4].solvency < gr[0].solvency && gr[4].solvency > 0.05, gr.map((y) => y.solvency));
console.log(`Bridger Hollow: gap ${Math.round(mA.gap / 1e3)}k board, ${Math.round(mB.gap / 1e3)}k with bond; line after #${kb.line}; ${kb.flags.length} flags; bond adds $${tb.peak.home.toFixed(2)}/yr for a $${B.settings.tax.homeValue.toLocaleString()} home`);
console.log(`demo tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
