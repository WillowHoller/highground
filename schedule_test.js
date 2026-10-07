/* HighGround year-by-year funding line test. Run: node schedule_test.js */
const C = require('./capital.js'), D = require('./demo_data.js'), R = require('./ranking.js'), H = require('./schedule.js'), E = require('./engine.js');
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); } };
let i = 0; const X = C.demoRows(D['ironwood-valley'], 'd1', () => 'id' + (++i));
const mk = (saveFactor, initPatch) => {
  const rows = { district: { name: 'x' }, settings: Object.assign({}, X.district_settings[0]), balances: X.fund_balance, debts: X.debt_obligation, scenarios: X.scenario,
    initiatives: X.initiative.map((x) => Object.assign({}, x, (initPatch || {})[x.name] || {})), phases: X.phase, funding: X.phase_funding, financing: X.financing,
    recurring: [], scenario_initiative: X.scenario_initiative || [], priorities: [], assumption_sets: [] };
  rows.settings.save_receipts = Number(rows.settings.save_receipts) * saveFactor;
  const sid = rows.scenarios.find((s) => s.is_board_version).id, k = R.build(rows, sid), inp = C.buildInputs(rows, sid);
  return { rows, k, inp, S: H.schedule(inp, k.items) };
};
const lev = (r) => r.res.reduce((a, m) => a + H.LEVY.reduce((s, b) => s + m.over[b], 0), 0);

// 1. everything fits: nothing moves, nothing short
const a = mk(1);
check('fits: nothing moves', a.S.moves.length === 0 && a.S.items.every((x) => x.status !== 'short' && x.slip === 0), JSON.stringify(a.S.moves));

// 2. squeezed: some initiatives wait a year or more; the capital funds are short less than before
const b = mk(0.85), before = lev(E.compute(b.inp.projects, b.inp.levers, b.inp.cfg)), after = lev(E.compute(b.S.projects, b.inp.levers, b.inp.cfg));
check('squeezed: initiatives move later to fit', b.S.moves.length > 0 && b.S.items.some((x) => x.status === 'later'), JSON.stringify(b.S.items.map((x) => [x.name, x.status, x.slip])));
check('squeezed: the funds are short by less after scheduling', after < before - 0.5, `${before} -> ${after}`);
check('squeezed: moves only go later, never earlier', b.S.moves.every((m) => m.toFY > m.fromFY));
check('squeezed: the lowest-ranked wait first (the #1 initiative never moves)', !b.S.moves.some((m) => m.id === String(b.k.items[0].id)));
check('done or underway phases never move', b.S.projects.every((p) => p.phases.every((ph, k) => ph.status === 'planned' || ph.status == null || ph.year === b.inp.projects.find((q) => q.id === p.id).phases[k].year)));

// 3. needed-by is never passed
const moved = b.S.moves[0], nm = b.k.items.find((x) => String(x.id) === moved.id).name;
const c = mk(0.85, { [nm]: { need_by_fy: moved.fromFY } });
check('needed by: an initiative that can’t wait stays put (others move instead, or the year is short)', !c.S.moves.some((m) => m.id === moved.id), JSON.stringify(c.S.moves.filter((m) => m.id === moved.id)));
check('needed by: no initiative ends after its year', c.S.items.every((x) => x.needBy == null || x.status === 'outside' || Math.max(...x.scheduled) <= Math.max(x.needBy, ...x.planned)));

// 4. year totals
check('years: one row per plan year', b.S.years.length === b.inp.cfg.n && b.S.years.every((y) => y.short >= 0));
console.log(`schedule_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
