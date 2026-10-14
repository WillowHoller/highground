/* HighGround: Rank & fund tests the General Fund too (14 Oct). Run: node gfrank_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), K = require('./ranking.js'), G = require('./gf.js'), SG = require('./suggest.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const newId = () => 'id-' + (++i);
const R = C.demoRows(D['ironwood-valley'], 'd1', newId);
const S0 = R.district_settings[0], healthy = Object.assign({}, S0, { gf_inputs: Object.assign({}, S0.gf_inputs, { fund_balance: Number(S0.gf_inputs.fund_balance) + 3000000, unspent: Number(S0.gf_inputs.unspent || 0) + 2000000 }) });
const base = { district: { name: 'x' }, settings: healthy, balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: [], scenario_initiative: R.scenario_initiative };
const sid = R.scenario[0].id;
/* the same closure the app builds (rankGf): the GF forecast with only the kept initiatives' yearly General Fund costs */
const gfFor = (rows) => {
  const gfi = rows.settings.gf_inputs, a = Object.assign({}, G.DEFAULTS), bi = C.buildInputs(rows, sid), L = Object.assign({}, bi.levers, { settle: a.settle }), years = bi.cfg.years.slice(0, 5);
  return (keep) => { const Lk = Object.assign({}, L, { recur: L.recur.filter((r) => keep.has(String(r.initiative_id))) }), extra = {};
    years.forEach((fy) => { extra[fy] = E.recurIn(bi.cfg, 'general', fy - bi.cfg.start, Lk); }); return G.forecast(gfi, a, years, extra).years; };
};
check('the Ironwood demo has General Fund figures', !!base.settings.gf_inputs);
const k0 = K.build(base, sid, { gf: gfFor(base) });
const first = k0.items[0].id, start = k0.cfg.start;
const gfBase = gfFor(base)(new Set());
check('the General Fund starts healthy in the demo', gfBase.every((y) => y.solvency >= 0.05), gfBase.map((y) => y.solvency.toFixed(3)));
const yr = (amt, extra) => Object.assign({ id: 'y' + Math.random(), scenario_id: sid, initiative_id: first, kind: 'salary', fund: 'general', first_fy: start + 1, last_fy: null, annual_amount: amt, grows_with: 'settlement' }, extra || {});
// the demo as it is: solvency already heads under 5% by year 5, so any new General Fund cost is stopped, and says so
{ const demo = Object.assign({}, base, { settings: S0, recurring: [yr(70000)] }), k = K.build(demo, sid, { gf: gfFor(demo) });
  check('when the General Fund is already headed under 5%, a new yearly cost can’t push it lower', k.items[0].gfFail && k.items[0].gfFail.floor < 0.05 && k.items[0].gfFail.solvency < k.items[0].gfFail.floor, k.items[0].gfFail); }
// a modest hire fits
{ const rows = Object.assign({}, base, { recurring: [yr(70000)] }), k = K.build(rows, sid, { gf: gfFor(rows) });
  check('a modest General Fund hire fits', k.items[0].above && !k.items[0].gfFail && k.gf && k.gf.years.length === 5, k.items[0]);
  check('the yearly column knows it is General Fund money', k.items[0].gfYearly === 70000 && k.items[0].yearly === 70000); }
// a cost the General Fund can't carry stops the line, with the year and the reason
const huge = Object.assign({}, base, { recurring: [yr(4000000)] });
const kh = K.build(huge, sid, { gf: gfFor(huge) });
check('a General Fund cost it can’t carry stops the funding line at that initiative', kh.line === 0 && kh.items[0].stop === 'gf' && kh.items[0].gfFail && kh.items[0].gfFail.fy >= start + 1, kh.items[0].gfFail);
check('the reason is solvency or spending authority', ['solvency', 'authority'].includes(kh.items[0].gfFail.why));
check('without the General Fund figures, the same plan tests capital funds only (as before)', K.build(huge, sid).line === K.build(base, sid).line);
check('filling in skips it, says why, and funds the rest', kh.items[0].fill.reason === 'gf' && kh.fillIn.count === K.build(base, sid).fillIn.count - 1, [kh.items[0].fill, kh.fillIn.count]);
check('ways to fit more uses the same line', (() => { const s = SG.suggest(C.buildInputs(huge, sid), kh.items, huge.initiatives, { gfFails: kh.gfFails }); return s.suggestions.every((g) => !g.funds.some((f) => f.id === first)); })());
// subsequent years: a cost that starts late or grows is tested in the years it runs
{ const late = Object.assign({}, base, { recurring: [yr(4000000, { first_fy: start + 4 })] }), k = K.build(late, sid, { gf: gfFor(late) });
  check('a cost that starts in year 5 is tested in year 5', k.items[0].gfFail && k.items[0].gfFail.fy === start + 4, k.items[0].gfFail); }
{ const later = Object.assign({}, base, { recurring: [yr(4000000, { first_fy: start + 6 })] }), k = K.build(later, sid, { gf: gfFor(later) });
  check('a cost starting after the five-year forecast isn’t tested (and isn’t stopped)', !k.items[0].gfFail && k.items[0].above); }
// a one-year General Fund cost is a one-time cost, not a yearly one
{ const rows = Object.assign({}, base, { recurring: [yr(25000, { kind: 'supplies', first_fy: start + 1, last_fy: start + 1, grows_with: 'none' }), yr(60000)] }), k = K.build(rows, sid, { gf: gfFor(rows) });
  check('a one-year General Fund cost shows as one-time', k.items[0].oneTimeOther === 25000 && k.items[0].yearly === 60000, [k.items[0].oneTimeOther, k.items[0].yearly]); }
// an FFA-style program: start-up from the General Fund one year, an advisor every year after, and nothing from the capital funds
{ const ffa = { id: 'ffa', district_id: 'd1', name: 'FFA chapter', type: 'program', status: 'proposed', tier: 'strategic' };
  const rows = Object.assign({}, base, { initiatives: base.initiatives.concat(ffa),
    scenario_initiative: base.scenario_initiative.concat({ scenario_id: sid, initiative_id: 'ffa', rank: 2.5, included: true }),
    recurring: [yr(30000, { initiative_id: 'ffa', kind: 'supplies', first_fy: start + 1, last_fy: start + 1, grows_with: 'none' }), yr(68000, { initiative_id: 'ffa', first_fy: start + 1 })] });
  const k = K.build(rows, sid, { gf: gfFor(rows) }), x = k.items.find((y) => y.id === 'ffa');
  check('an FFA chapter is listed with its rank, one-time start-up and yearly cost', x && x.position === 3 && x.oneTimeOther === 30000 && x.yearly === 68000 && x.oneTime === 0, x && [x.position, x.oneTimeOther, x.yearly]);
  check('it uses no capital fund, so it never moves the capital line', K.build(rows, sid).line === K.build(base, sid).line + (K.build(base, sid).line >= 2 ? 1 : 0)); }
console.log(`gfrank tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
