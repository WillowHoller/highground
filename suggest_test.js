/* HighGround suggestions test. Run: node suggest_test.js */
const C = require('./capital.js'), D = require('./demo_data.js'), R = require('./ranking.js'), S = require('./suggest.js');
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); } };
let i = 0; const X = C.demoRows(D['ironwood-valley'], 'd1', () => 'id' + (++i));
const mk = (saveFactor, initPatch) => {
  const rows = { district: { name: 'x' }, settings: Object.assign({}, X.district_settings[0]), balances: X.fund_balance, debts: X.debt_obligation, scenarios: X.scenario,
    initiatives: X.initiative.map((x) => Object.assign({}, x, (initPatch || {})[x.name] || {})), phases: X.phase, funding: X.phase_funding, financing: X.financing,
    recurring: [], scenario_initiative: X.scenario_initiative || [], priorities: [], assumption_sets: [] };
  rows.settings.save_receipts = Number(rows.settings.save_receipts) * saveFactor;
  const sid = rows.scenarios.find((s) => s.is_board_version).id, k = R.build(rows, sid);
  return { rows, k, res: S.suggest(C.buildInputs(rows, sid), k.items, rows.initiatives) };
};

// 1. the demo as it is: everything fits, nothing to suggest that funds anything
const a = mk(1);
check('everything fits: no suggestion funds anything', a.res.suggestions.every((s) => s.funds.length === 0), JSON.stringify(a.res.suggestions.map((s) => s.name)));

// 2. SAVE 10% lower: the line breaks, and moving a project later funds others
const b = mk(0.9), top = b.res.suggestions[0];
check('squeezed: the line breaks', b.k.line < b.k.items.length, b.k.line);
check('squeezed: the best suggestion funds initiatives below the line', top && top.funds.length >= 1 && top.delta > 0, JSON.stringify(top));
check('squeezed: what it funds was below the line, and the moved one is not listed as funding itself', top && top.funds.every((f) => !b.k.items.find((x) => x.id === f.id).above) && !top.funds.some((f) => f.id === top.id));
check('squeezed: from/to years match the move', top && top.to.every((y, k) => y === top.from[k] + top.delta));
check('one suggestion per initiative', new Set(b.res.suggestions.map((s) => s.id)).size === b.res.suggestions.length);

// 3. needed-by: a project can't be moved past the year it's needed
const name = top.name, nb = top.from[top.from.length - 1];
const c = mk(0.9, { [name]: { need_by_fy: nb } });
check('needed by: never moved later than its year', !c.res.suggestions.some((s) => s.name === name && s.delta > 0), JSON.stringify(c.res.suggestions.map((s) => [s.name, s.delta])));
check('needed by: remaining life counts when no year is given', S.needBy({ remaining_life: 3 }, { start: 2027 }) === 2030 && S.needBy({ need_by_fy: 2029, remaining_life: 9 }, { start: 2027 }) === 2029 && S.needBy({}, { start: 2027 }) === null);

// 4. timing warnings
const late = mk(1, { 'Stadium turf': { need_by_fy: 2030 } });
check('late: planned after the year it is needed', late.res.late.some((x) => x.name === 'Stadium turf' && x.planned === 2032 && x.needBy === 2030), JSON.stringify(late.res.late));
const urgent = mk(0.9, { 'Playground surfacing (two sites)': { need_by_fy: 2028 } });
check('urgent: below the line and needed within two years', urgent.res.urgentBelow.some((x) => x.name === 'Playground surfacing (two sites)'), JSON.stringify(urgent.res.urgentBelow));
check('moves: the phase changes a suggestion makes', JSON.stringify(S.moves({ from: [2031, 2033], to: [2033, 2035] })) === JSON.stringify([{ fy: 2031, toFy: 2033 }, { fy: 2033, toFy: 2035 }]));

// 5. ordering by when needed: a strategic item needed soon goes ahead of must-haves needed later
{ const rows = mk(1, { 'CTE welding & construction lab': { need_by_fy: 2028 }, 'High school roof, sections A–D': { need_by_fy: 2032 } }).rows, sid = rows.scenarios.find((s) => s.is_board_version).id;
  const kn = R.build(rows, sid, { by: 'need' }), kp = R.build(rows, sid);
  const pos = (k, n) => k.items.findIndex((x) => x.name === n);
  check('order by need: a strategic item needed in FY2028 comes first', kn.by === 'need' && pos(kn, 'CTE welding & construction lab') === 0 && pos(kp, 'CTE welding & construction lab') > pos(kp, 'High school roof, sections A–D'), JSON.stringify(kn.items.slice(0, 3).map((x) => x.name)));
  check('order by need: items keep their needed-by year', kn.items[0].needBy === 2028); }
// 6. goal seek
{ const g = mk(0.85), below = g.k.items.filter((x) => !x.above && !x.outsideOnly), t = below[0];
  const inp = C.buildInputs(g.rows, g.rows.scenarios.find((s) => s.is_board_version).id);
  const r = S.goalSeek(inp, g.k.items, g.rows.initiatives, t.id, null);
  check('goal seek: finds ways to fund an initiative below the line', r.possible && r.options.length > 0, JSON.stringify(r));
  check('goal seek: a rank answer says how high and who drops', r.options.some((o) => o.kind === 'rank' && o.position >= 1 && Array.isArray(o.drops)));
  check('goal seek: move answers never move the target itself, one per initiative', r.options.filter((o) => o.kind === 'move').every((o) => o.moves[0].id !== String(t.id)) && new Set(r.options.filter((o) => o.kind === 'move').map((o) => o.moves[0].id)).size === r.options.filter((o) => o.kind === 'move').length);
  const early = S.goalSeek(inp, g.k.items, g.rows.initiatives, t.id, Math.max(...t.years) - 2);
  check('goal seek: a target year earlier than planned pulls its phases forward', early.notes.some((n) => /2 years earlier/.test(n)), JSON.stringify(early.notes));
  const top = S.goalSeek(inp, g.k.items, g.rows.initiatives, g.k.items[0].id, null);
  check('goal seek: something already funded says so', top.possible && top.options.length === 0 && /already fits/.test(top.notes.join(' ')));
  const tooEarly = S.goalSeek(inp, g.k.items, g.rows.initiatives, t.id, 2000);
  check('goal seek: a year before the plan starts is refused, explained', !tooEarly.possible && /before the plan starts/.test(tooEarly.notes.join(' '))); }
console.log(`suggest_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
