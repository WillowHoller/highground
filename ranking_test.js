/* HighGround ranking and funding line test. Run: node ranking_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), K = require('./ranking.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const newId = () => 'id-' + (++i);
const R = C.demoRows(D['ironwood-valley'], 'd1', newId);
const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: [], scenario_initiative: R.scenario_initiative };
const sid = R.scenario[0].id;
const k = K.build(rows, sid);
check('every initiative in the scenario is listed once', k.items.length === 16 && new Set(k.items.map((x) => x.id)).size === 16);
check('priorities come from the initiatives', k.items.every((x) => !x.suggested) && k.items[0].tier === 'must');
const oldOnly = K.tierOf({ engine_priority: 'Med' }), none = K.tierOf({});
check('an initiative with only the old High/Med/Low still gets a priority', oldOnly.tier === 'strategic' && oldOnly.suggested && none.tier === '');
check('list runs must-have, then strategic, then nice to have', k.items.every((x, j, a) => !j || K.TIERS.indexOf(a[j - 1].tier) <= K.TIERS.indexOf(x.tier)));
check('positions are 1..n', k.items.map((x) => x.position).join() === Array.from({ length: 16 }, (_, j) => j + 1).join());
// everything above the line really fits: running just those leaves no capital fund short
const keepIds = new Set(k.items.slice(0, k.line).map((x) => x.id));
const inp = C.buildInputs(rows, sid);
const r = E.compute(inp.projects.filter((p) => keepIds.has(String(p.id))), inp.levers, inp.cfg);
check('above the line fits within SAVE, PPEL, V-PPEL and grants', r.overflow <= k.baseOverflow + 0.5, r.overflow);
if (k.line < k.items.length) {
  const withNext = new Set([...keepIds, k.items[k.line].id]);
  const r2 = E.compute(inp.projects.filter((p) => withNext.has(String(p.id))), inp.levers, inp.cfg);
  check('the first item below the line is the one that runs a fund short', r2.overflow > k.baseOverflow + 0.5, r2.overflow);
}
check('fund in rank order defers exactly what is below the line', k.rankOrder.deferred.length === k.items.length - k.line);
// ranking changes the line: put the most expensive item first
const big = k.items.slice().sort((a, b) => b.oneTime - a.oneTime)[0];
const rows2 = Object.assign({}, rows, { initiatives: rows.initiatives.map((x) => x.id === big.id ? Object.assign({}, x, { tier: 'must' }) : x),
  scenario_initiative: rows.scenario_initiative.map((x) => x.scenario_id === sid ? Object.assign({}, x, { rank: x.initiative_id === big.id ? 0 : x.rank }) : x) });
const k2 = K.build(rows2, sid);
check('a tier set on the initiative wins over the suggestion', k2.items[0].id === big.id && k2.items[0].suggested === false);
// a scenario where a lower-ranked item spends PPEL a higher one needs
const ppelHungry = Object.assign({}, rows, { settings: Object.assign({}, rows.settings, { ppel_receipts: 60000 }) });
const k3 = K.build(ppelHungry, sid);
check('flags name who spends what a higher-ranked one needs', k3.flags.length > 0 && /spends PPEL that .* is short of in FY/.test(k3.flags[0].text), k3.flags.slice(0, 2).map((f) => f.text));
check('flags only point down the list', k3.flags.every((f) => f.low.position > f.high.position));
// yearly costs belong to their initiative, never a nameless extra row
const ffaInit = rows.initiatives[0].id;
const rowsY = Object.assign({}, rows, { recurring: [{ id: 'y1', scenario_id: sid, initiative_id: ffaInit, kind: 'supplies', fund: 'ppel', first_fy: 2028, last_fy: null, annual_amount: 9000, grows_with: 'none' }] });
const ky = K.build(rowsY, sid);
check('yearly costs attach to their initiative', ky.items.length === 16 && ky.items.find((x) => x.id === ffaInit).yearly === 9000 && !ky.items.some((x) => x.name === 'Initiative'), ky.items.length);
console.log('\nIronwood baseline, in rank order:');
k.items.forEach((x, j) => { if (j === k.line) console.log('   ───── funding line: money runs out here ─────'); console.log(`   #${String(x.position).padStart(2)} ${K.TIER_NAME[x.tier].padEnd(13)} ${x.name.padEnd(40)} $${Math.round(x.oneTime / 1000)}k${x.outside ? ` (campaign/boosters $${Math.round(x.outside / 1000)}k)` : ''}`); });
console.log(`   above the line $${Math.round(k.aboveCost / 1000)}k · deferred $${Math.round(k.rankOrder.deferredCost / 1000)}k · gap ${Math.round(k.current.gap)} → ${Math.round(k.rankOrder.gap)}`);
console.log(`\nranking tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
