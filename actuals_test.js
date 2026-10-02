/* HighGround project actuals test. Run: node actuals_test.js */
const A = require('./actuals.js'), G = require('./gl.js'), C = require('./capital.js'), D = require('./demo_data.js'), E = require('./engine.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const R = C.demoRows(D['bridger-hollow'], 'dB', () => 'id-' + (++i));
const inits = R.initiative, byName = (n) => inits.find((x) => x.name === n).id;
// the September sample, imported: accounts as they'd be saved, amounts against a batch
const P = G.parse(G.sampleExport());
const accounts = P.lines.map((l, k) => Object.assign({ id: 'a' + k, code: l.code, description: l.description, project_code: l.parts.project || null, function_code: l.parts.function || null }, G.suggest(l.parts)));
const sugg = A.suggestLinks(accounts, inits);
const pick = (code) => sugg.find((s) => s.account.code === code);
check('roof construction → High school roof replacement', pick('33-0000-4700-000-1001-450').initiativeId === byName('High school roof replacement'), pick('33-0000-4700-000-1001-450'));
check('vestibule construction → Secure entry vestibules', pick('33-0000-4700-000-1002-450').initiativeId === byName('Secure entry vestibules (two buildings)'));
check('bus purchase → Bus replacement', pick('36-0000-2700-000-0000-733').initiativeId === byName('Bus replacement (one a year)'));
check('Chromebooks → 1:1 Chromebook refresh', pick('36-0000-2230-000-1003-734').initiativeId === byName('1:1 Chromebook refresh'));
check('debt payments are never suggested as project spending', !pick('36-0000-5000-000-0000-831'));
check('only capital-fund spending is suggested (not General Fund, revenue or balances)', sugg.every((s) => ['save', 'ppel', 'vppel', 'other'].includes(s.account.mapped_fund) && s.account.maps_to === 'expense'));
// a project code already linked carries to new accounts with the same code
const linked = accounts.map((a) => (a.code === '33-0000-4700-000-1001-450' ? Object.assign({}, a, { initiative_id: byName('High school roof replacement'), maps_to: 'initiative' }) : a));
const extra = Object.assign({}, accounts[0], { id: 'ax', code: '33-0000-4700-000-1001-340', description: 'Architect fees', project_code: '1001', maps_to: 'expense', mapped_fund: 'save', initiative_id: null });
const s2 = A.suggestLinks(linked.concat([extra]), inits).find((s) => s.account.id === 'ax');
check('a project code already linked suggests the same initiative', s2.initiativeId === byName('High school roof replacement') && /project code/.test(s2.why));
// actuals from the latest import in each fiscal year
const links = { '33-0000-4700-000-1001-450': byName('High school roof replacement'), '36-0000-2230-000-1003-734': byName('1:1 Chromebook refresh') };
const acc2 = accounts.map((a) => (links[a.code] ? Object.assign({}, a, { initiative_id: links[a.code], maps_to: 'initiative' }) : a));
const amounts = (batch, scale) => P.lines.map((l, k) => ({ batch_id: batch, account_id: 'a' + k, ytd_amount: l.ytd * scale, encumbered: l.encumbered, budget_amount: l.budget }));
const batches = [{ id: 'aug', kind: 'gl_monthly', status: 'applied', period_end: '2026-08-31', fiscal_year: 2027 },
  { id: 'sep', kind: 'gl_monthly', status: 'applied', period_end: '2026-09-30', fiscal_year: 2027 },
  { id: 'old', kind: 'gl_monthly', status: 'superseded', period_end: '2026-09-30', fiscal_year: 2027 }];
const act = A.actuals(acc2, amounts('aug', 0.5).concat(amounts('sep', 1), amounts('old', 9)), batches);
const roof = act.byInitiative[byName('High school roof replacement')][2027];
check('actuals use the latest applied import in the year (not earlier months, not replaced ones)', roof.spent === 262750 && roof.encumbered === 147250 && roof.through === '2026-09-30', roof);
check('“through” date per year', act.through['2027'] === '2026-09-30');
// the plan for the same year, to compare
const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario, initiatives: R.initiative,
  phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: R.recurring_cost };
const inp = C.buildInputs(rows, R.scenario[0].id), plan = A.planned(inp.projects, inp.levers, inp.cfg, 2027);
check('planned cost this year: the roof’s first phase', Math.abs(plan[byName('High school roof replacement')] - 410000) < 1, plan[byName('High school roof replacement')]);
console.log(`Roof FY2027: planned $${Math.round(plan[byName('High school roof replacement')]).toLocaleString()}, spent $${roof.spent.toLocaleString()}, encumbered $${roof.encumbered.toLocaleString()}`);
console.log(`actuals tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
