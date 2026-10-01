/* HighGround capital bridge test. Run: node capital_test.js
   Loads each fictional demo district into database-shaped rows (as the app does), rounds every number the
   way the database columns would store it, reads the rows back into engine inputs, and checks the results
   against the working planner's own output in golden_engine.json. */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js');
const G = require('./golden_engine.json');
const KEY = { 'demo-small': 'harvest-plains', 'demo-medium': 'ironwood-valley', 'demo-large': 'lakeshore-heights' };
// numeric(p,s) columns: round as Postgres would store them
const SCALE = { cost: 2, actual_cost: 2, amount: 2, annual_payment: 2, pct: 2, save_receipts: 2, save_ongoing: 2, ppel_receipts: 2,
  ppel_ongoing: 2, vppel_annual: 2, grants_avg: 2, taxable_valuation: 2, actual_valuation: 2, go_outstanding: 2,
  save_trend: 4, ppel_growth: 4, ppel_rate: 4, grants_yield: 4, construction_inflation: 4, rate: 4,
  lever_ppel_growth: 4, lever_grant_yield: 4, lever_save_trend: 4, lever_inflation: 4 };
const asStored = (rows) => rows.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[k] = (SCALE[k] != null && typeof v === 'number') ? Number(v.toFixed(SCALE[k])) : v; return o; });
let i = 0; const newId = () => 'id-' + (++i);
const close = (a, b) => Math.abs(a - b) <= 1e-4 + 1e-12 * Math.abs(b);
let cases = 0, diffs = 0;
for (const [gk, g] of Object.entries(G.districts)) {
  const demo = D[KEY[gk]];
  const R = C.demoRows(demo, 'district-' + gk, newId);
  const rows = { district: { name: demo.name }, settings: asStored(R.district_settings)[0], balances: asStored(R.fund_balance),
    debts: asStored(R.debt_obligation), scenarios: asStored(R.scenario), initiatives: R.initiative, phases: asStored(R.phase),
    funding: asStored(R.phase_funding), financing: asStored(R.financing) };
  g.scenarios.forEach((gs, si) => {
    const sid = R.scenario[si].id;
    const inp = C.buildInputs(rows, sid);
    if (inp.notes.length) console.log('notes', gk, inp.notes);
    g.cases.filter((c) => c.scenario === gs.id).forEach((c) => {
      cases++;
      const L = E.leversOf(Object.assign({}, inp.stored, c.patch || {}), inp.cfg);
      const r = E.compute(inp.projects, L, inp.cfg);
      const bad = ['need', 'gap', 'overflow', 'levyFunded', 'financed', 'unfunded'].filter((k) => !close(r[k], c.result[k]));
      r.res.forEach((m, y) => { if (!close(m.total, c.result.years[y][0]) || !close(m.avail.save, c.result.years[y][1]) || !close(m.fin.unfunded, c.result.years[y][10])) bad.push('year ' + y); });
      if (bad.length) { diffs++; console.log('DIFF', gk, gs.name, JSON.stringify(c.patch), bad.join(',')); }
    });
  });
}
// fund paths add up: each year's end = start + receipts - spending (never below zero), and carries into next year
let pathBad = 0;
for (const [gk, g] of Object.entries(G.districts)) {
  const cfg = E.makeConfig(g.settings);
  for (const sc of g.scenarios) {
    const r = E.compute(E.cleanList(sc.projects, cfg), E.leversOf(sc.levers || {}, cfg), cfg);
    const P = C.fundPaths(r, cfg);
    for (const b of C.CAP_FUNDS) P[b].years.forEach((y, i, a) => {
      if (Math.abs(y.end - Math.max(0, y.start + y.receipts - y.spend)) > 1e-6) pathBad++;
      if (Math.abs(y.over - Math.max(0, y.spend - y.start - y.receipts)) > 1e-6) pathBad++;
      if (i && Math.abs(a[i - 1].end - y.start) > 1e-6) pathBad++;
    });
    const over = C.CAP_FUNDS.reduce((t, b) => t + P[b].over, 0);
    if (Math.abs(over - r.overflow) > 1e-6) pathBad++;
  }
}
console.log(`fund paths: ${pathBad ? pathBad + ' problems' : 'all add up'}`);
if (pathBad) diffs++;
console.log(`database round trip: cases ${cases} diffs ${diffs}`);
process.exit(diffs ? 1 : 0);
