/* HighGround: checks for the fixes from the 10 Oct 2026 validation (HighGround Validation Record, open issues 1–14).
   Run: node validation_test.js */
const E = require('./engine.js'), C = require('./capital.js');
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.5 : t);

// 1. fund legality (Iowa Code 298.3(4), 423F.3)
check('PPEL can’t pay salaries; the reason cites the law', E.legality('ppel', { kind: 'salary' }).level === 'no' && /298\.3/.test(E.legality('ppel', { kind: 'salary' }).text));
check('SAVE can’t pay benefits, supplies or activities', ['benefits', 'supplies', 'activities'].every((k) => E.legality('save', { kind: k }).level === 'no'));
check('V-PPEL follows PPEL', E.legality('vppel', { kind: 'supplies' }).level === 'no');
check('General Fund, grants and boosters can pay anything', ['general', 'grants', 'boost', 'other', 'camp'].every((b) => E.legality(b, { kind: 'salary' }).level === 'ok'));
check('a contract or subscription on PPEL or SAVE is flagged to confirm, not refused', E.legality('ppel', { kind: 'contract' }).level === 'check' && E.legality('save', { kind: 'contract' }).level === 'check');
check('capital projects may use SAVE, PPEL and V-PPEL; SAVE reminds about the revenue purpose statement', ['save', 'ppel', 'vppel'].every((b) => E.legality(b, { type: 'capital' }).level === 'ok') && /revenue purpose statement/.test(E.legality('save', { type: 'capital' }).text));
check('staff and curriculum initiatives can’t use capital funds', ['staff', 'curriculum'].every((t) => ['save', 'ppel', 'vppel'].every((b) => E.legality(b, { type: t }).level === 'no')));
check('a program’s one-time costs on a capital fund are flagged to confirm (a CTE shop is a building)', E.legality('save', { type: 'program' }).level === 'check' && /buildings, sites and equipment/.test(E.legality('save', { type: 'program' }).text));
check('technology is flagged to confirm', E.legality('ppel', { type: 'technology' }).level === 'check');
{
  const cfg = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-06-30', save: 1e6, ppel: 1e6 }, save: { receipts: 1e6 }, ppel: { receipts: 5e5 } }, '2026-07-01');
  const ps = E.cleanList([{ id: 'a', name: 'Counselor', type: 'staff', phases: [{ cost: 1000, year: 0, options: ['save', 'ppel', 'grants'] }] }], cfg);
  check('a "whichever has room" phase never uses a fund the law doesn’t allow for its type (only grants is left)', ps[0].phases[0].options === undefined && ps[0].phases[0].funding.length === 1 && ps[0].phases[0].funding[0].b === 'grants', ps[0].phases[0]);
  const L = E.leversOf({ recur: [{ fund: 'ppel', kind: 'salary', first: 2027, amount: 50000, name: 'Aide' }, { fund: 'general', kind: 'salary', first: 2027, amount: 1 }] }, cfg);
  const iss = E.checkLegal(E.cleanList([{ id: 'b', name: 'Reading coaches', type: 'staff', phases: [{ cost: 1, year: 0, funding: [{ b: 'save', p: 100 }] }] }], cfg), L);
  check('checkLegal lists every refused charge, refused first', iss.length === 2 && iss.every((x) => x.level === 'no') && iss.some((x) => x.what === 'yearly' && x.fund === 'ppel') && iss.some((x) => x.what === 'phase' && x.fund === 'save'), iss);
}
// 3 & G1–G6 are in gf_test.js. 5: "whichever has room" looks ahead
{
  const mk = (saveOpen) => {
    const c = E.makeConfig({ plan: { startFY: 2027, years: 5 }, balances: { asOf: '2026-06-30', save: saveOpen, ppel: 200000, vppel: 0, grants: 0 }, save: { receipts: 0, sf2472: false }, ppel: { receipts: 0, growth: 0 }, inflation: 0 }, '2026-07-01');
    const pr = E.cleanList([{ id: 'A', name: 'A', phases: [{ cost: 100000, year: 0, options: ['save', 'ppel'] }] }, { id: 'B', name: 'B', phases: [{ cost: 90000, year: 1, funding: [{ b: 'save', p: 100 }] }] }], c);
    return E.compute(pr, E.leversOf({ infl: 0 }, c), c);
  };
  const lo = mk(90000), hi = mk(100000);
  check('a phase that can use SAVE or PPEL leaves SAVE for a later SAVE-only phase', hi.gap === 0 && hi.picks[0].b === 'ppel' && lo.gap === 0, [lo.gap, hi.gap, hi.picks]);
  const two = (() => {   // two choice phases in one year: the combination that leaves nothing short wins
    const c = E.makeConfig({ plan: { startFY: 2027, years: 5 }, balances: { asOf: '2026-06-30', save: 100000, ppel: 60000, vppel: 0, grants: 0 }, save: { receipts: 0, sf2472: false }, ppel: { receipts: 0, growth: 0 }, inflation: 0 }, '2026-07-01');
    const pr = E.cleanList([{ id: 'A', name: 'A', phases: [{ cost: 60000, year: 0, options: ['save', 'ppel'] }] }, { id: 'B', name: 'B', phases: [{ cost: 100000, year: 0, options: ['save', 'ppel'] }] }], c);
    return E.compute(pr, E.leversOf({ infl: 0 }, c), c);
  })();
  check('several choice phases in one year: every combination is tried', two.gap === 0 && two.picks.map((x) => x.b).join() === 'ppel,save', two.picks);
}
// 6: higher-ranked initiatives choose first
{
  const demo = { enrollment: 500, settings: { plan: { years: 5 }, balances: { asOf: '2026-06-30', save: 0, ppel: 100000, vppel: 0, grants: 0 }, save: { receipts: 100000, sf2472: false }, ppel: { receipts: 0, growth: 0 }, vppel: { status: 'none' }, grants: { avg: 0 }, debt: [], inflation: 0 },
    scenarios: [{ name: 'S', board: true, projects: [
      { id: 1, name: 'Ranked second', phases: [{ cost: 100000, year: 0, options: ['ppel', 'save'] }] },
      { id: 2, name: 'Ranked first', phases: [{ cost: 100000, year: 0, funding: [{ b: 'ppel', p: 100 }] }] }] }] };
  let k = 0; const R = C.demoRows(demo, 'd', () => 'id' + (++k));
  // rank the second-listed initiative first
  R.scenario_initiative[0].rank = 2; R.scenario_initiative[1].rank = 1;
  const rows = { district: { name: 'x' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario, initiatives: R.initiative, phases: R.phase, funding: R.phase_funding,
    financing: R.financing, recurring: R.recurring_cost, scenario_initiative: R.scenario_initiative };
  const inp = C.buildInputs(rows, R.scenario[0].id);
  check('projects reach the engine in force-rank order', inp.projects.map((p) => p.name).join('|') === 'Ranked first|Ranked second', inp.projects.map((p) => p.name));
}
// 7: uneven splits are charged in full
{
  const cfg = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-06-30' } }, '2026-07-01');
  const ph = E.cleanPhases([{ cost: 300000, year: 0, funding: [{ b: 'save', p: 1 }, { b: 'ppel', p: 1 }, { b: 'grants', p: 1 }] }], cfg)[0];
  check('a 1:1:1 split becomes 34/33/33, so the whole cost is charged', ph.funding.map((f) => f.p).join('/') === '34/33/33', ph.funding);
}
// 8: SF 2472 cut on projected current-law SAVE
check('SF 2472 cut: LSA dollars ÷ projected school-infrastructure SAVE', near(E.sfCut(2027), 0.0584, 1e-4) && near(E.sfCut(2028), 0.0855, 1e-4) && near(E.sfCut(2029), 0.1017, 1e-4) && near(E.sfCut(2030), 0.145, 1e-4) && near(E.sfCut(2031), 0.1614, 1e-4) && E.sfCut(2040) === E.sfCut(2031) && E.sfCut(2026) === 0, E.SF2472_CUT);
// 12: existing debt in a part year
{
  const mk = (timing) => { const c = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-12-31', save: 0 }, save: { receipts: 1e6, sf2472: false }, debt: [{ name: 'Bond', fund: 'save', annual: 400000, lastFY: 2035, timing }] }, '2027-01-01');
    const r = E.compute([], E.leversOf({}, c), c); return { f0: c.f0, inflow: r.res[0].avail.save - r.res[0].carryIn.save }; };
  const sp = mk('spread'), af = mk('after'), bf = mk('before');
  check('this year’s debt payment: spread with receipts (the old way), all still due, or already paid', near(sp.inflow, (1e6 - 400000) * sp.f0) && near(af.inflow, 1e6 * af.f0 - 400000) && near(bf.inflow, 1e6 * bf.f0), [sp, af, bf]);
  const c2 = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-06-30' }, save: { receipts: 1e6 }, debt: [{ name: 'No end date', fund: 'save', annual: 1000, lastFY: null }] }, '2026-07-01');
  check('a debt with no final year runs to the end of the plan instead of being dropped', E.debtIn(c2, 'save', 0) === 1000 && E.debtIn(c2, 'save', 4) === 1000);
}
// 13: SAVE revenue-bond room after ongoing commitments
{
  const c = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-06-30' }, save: { receipts: 1200000, ongoing: 120000, sf2472: false }, debt: [{ name: 'Old bonds', fund: 'save', annual: 300000, lastFY: 2040 }] }, '2026-07-01');
  const cap = E.saveBondCapacity(c, E.leversOf({}, c), 0, 10, 1.2);
  // coverage: 1,200,000 ÷ 1.2 − 300,000 = 700,000; cash: 1,200,000 − 120,000 − 300,000 = 780,000 → 700,000 a year, 7,000,000 at 0% for 10 years
  check('SAVE bond room: coverage on all SAVE debt when that is the tighter limit', near(cap.pay, 700000) && near(cap.pv, 7000000), cap);
  const c2 = E.makeConfig({ plan: { years: 5 }, balances: { asOf: '2026-06-30' }, save: { receipts: 1200000, ongoing: 400000, sf2472: false }, debt: [{ name: 'Old bonds', fund: 'save', annual: 300000, lastFY: 2040 }] }, '2026-07-01');
  const cap2 = E.saveBondCapacity(c2, E.leversOf({}, c2), 0, 10, 1.2);
  // cash: 1,200,000 − 400,000 − 300,000 = 500,000 < coverage 700,000
  check('SAVE bond room: what’s left after ongoing commitments when that is tighter', near(cap2.pay, 500000), cap2);
}
console.log(`validation tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
