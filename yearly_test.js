/* HighGround yearly costs test. Run: node yearly_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), X = require('./compare.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const newId = () => 'id-' + (++i);
const R = C.demoRows(D['ironwood-valley'], 'd1', newId);
const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: [] };
const sid = R.scenario[0].id;
const base = C.buildInputs(rows, sid), r0 = E.compute(base.projects, base.levers, base.cfg), P0 = C.fundPaths(r0, base.cfg);
// an FFA program: a shop renovation (one-time) plus a teacher (general fund) and supplies (PPEL), from FY2028
const ffa = { id: 'ffa', district_id: 'd1', name: 'FFA program' };
rows.initiatives = rows.initiatives.concat([ffa]);
rows.phases = rows.phases.concat([{ id: 'ph-ffa', district_id: 'd1', scenario_id: sid, initiative_id: 'ffa', seq: 1, fy: 2028, cost: 150000, status: 'planned' }]);
rows.funding = rows.funding.concat([{ phase_id: 'ph-ffa', district_id: 'd1', fund: 'ppel', pct: 100 }]);
rows.recurring = [
  { id: 'r1', scenario_id: sid, initiative_id: 'ffa', kind: 'salary', fund: 'general', first_fy: 2028, last_fy: null, annual_amount: 65000, grows_with: 'none' },
  { id: 'r2', scenario_id: sid, initiative_id: 'ffa', kind: 'supplies', fund: 'ppel', first_fy: 2028, last_fy: 2033, annual_amount: 8000, grows_with: 'inflation' },
];
const inp = C.buildInputs(rows, sid), r = E.compute(inp.projects, inp.levers, inp.cfg), P = C.fundPaths(r, inp.cfg);
check('FFA: one initiative with a one-time phase and two yearly costs', inp.projects.some((p) => p.name === 'FFA program') && inp.levers.recur.length === 2);
const drop = (y) => P0.ppel.years[y].receipts - P.ppel.years[y].receipts;
check('PPEL supplies come off PPEL each year they run', Math.abs(drop(0)) < 1e-6 && Math.abs(drop(1) - 8000) < 1e-6 && Math.abs(drop(6) - 8000) < 1e-6 && Math.abs(drop(7)) < 1e-6,
  [0, 1, 6, 7].map(drop).join(','));
check('SAVE untouched by PPEL and general-fund costs', P0.save.years.every((y, k) => Math.abs(y.receipts - P.save.years[k].receipts) < 1e-6));
const byYear = C.recurByYear(inp.levers, inp.cfg);
check('general-fund salary shown as a commitment, not in the capital plan', byYear[1].other === 65000 && byYear[1].capital === 8000 && byYear[0].total === 0, JSON.stringify(byYear.slice(0, 2)));
const L2 = Object.assign({}, inp.levers, { infl: 0.03 });
check('inflation growth compounds from the first year', Math.abs(E.recurIn(inp.cfg, 'ppel', 4, L2) - 8000 * Math.pow(1.03, 3)) < 1e-6);
const genOnly = E.leversOf({ recur: [{ fund: 'general', first: 2027, last: null, amount: 1e6, grows: 'none' }] }, base.cfg);
check('general-fund costs never change the capital gap', Math.abs(E.compute(base.projects, genOnly, base.cfg).gap - r0.gap) < 1e-6);
const settle = E.leversOf({ recur: [{ fund: 'ppel', first: 2027, last: null, amount: 1000, grows: 'settlement' }] }, base.cfg);
check('settlement growth stays flat until a settlement rate exists', Math.abs(E.recurIn(base.cfg, 'ppel', 5, settle) - 1000) < 1e-9);
check('a note explains flat settlement growth', C.buildInputs(Object.assign({}, rows, { recurring: [Object.assign({}, rows.recurring[0], { grows_with: 'settlement' })] }), sid).notes.some((n) => /settlement/.test(n)));
// a big PPEL yearly cost pushes PPEL short and shows up in the gap and in "why"
const rowsB = Object.assign({}, rows, { scenarios: rows.scenarios.concat([{ id: 'sB', name: 'With a big PPEL cost', district_id: 'd1' }]),
  phases: rows.phases.concat(rows.phases.filter((p) => p.scenario_id === sid).map((p) => Object.assign({}, p, { id: p.id + 'B', scenario_id: 'sB' }))),
  funding: rows.funding.concat(rows.funding.filter((f) => rows.phases.some((p) => p.id === f.phase_id && p.scenario_id === sid)).map((f) => Object.assign({}, f, { phase_id: f.phase_id + 'B' }))),
  recurring: rows.recurring.concat(rows.recurring.map((x) => Object.assign({}, x, { id: x.id + 'B', scenario_id: 'sB', annual_amount: x.fund === 'ppel' ? 250000 : x.annual_amount }))) });
const ex = X.explain(rowsB, sid, 'sB');
check('why: a bigger yearly PPEL cost raises the gap and is named', ex.total > 0 && ex.items.some((x) => x.kind === 'yearly' && /FFA program: yearly costs/.test(x.label) && x.effect > 0), JSON.stringify(ex.items.map((x) => [x.label, Math.round(x.effect)])));
check('why: still adds up exactly', Math.abs(ex.items.reduce((t, x) => t + x.effect, 0) + ex.together - ex.total) < 1e-6);
// an assumption set fills levers the scenario hasn't saved, and gives settlement growth a rate
const setRows = Object.assign({}, rows, { assumption_sets: [{ id: 'as1', name: 'Conservative', construction_inflation: 0.05, save_trend: -0.02, ppel_growth: 0.01, grant_yield: 0.5, settlement_pct: 0.04 }],
  scenarios: rows.scenarios.map((x) => (x.id === sid ? Object.assign({}, x, { assumption_set_id: 'as1', lever_inflation: 0.02 }) : x)),
  recurring: [Object.assign({}, rows.recurring[0], { fund: 'ppel', grows_with: 'settlement' })] });
const si = C.buildInputs(setRows, sid);
check('set fills the levers the scenario left open', si.levers.sg === -0.02 && si.levers.pg === 0.01 && si.levers.gy === 0.5 && si.set.name === 'Conservative');
check('a lever saved on the scenario still wins', si.levers.infl === 0.02);
check('settlement growth uses the set’s rate', Math.abs(E.recurIn(si.inp ? si.inp.cfg : si.cfg, 'ppel', 3, si.levers) - 65000 * Math.pow(1.04, 2)) < 1e-6 && !si.notes.some((n) => /settlement/.test(n)));
const st = C.starterSets({ inflation: 0.035, save: { trend: 0 }, ppel: { growth: 0.03 }, grants: { yield: 0.75 } });
check('starter sets: Base from the district, Conservative tougher, Growth easier', st[0].construction_inflation === 0.035 && st[1].construction_inflation > st[0].construction_inflation && st[2].ppel_growth > st[0].ppel_growth && st[1].settlement_pct > st[0].settlement_pct);
console.log(`yearly cost tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
