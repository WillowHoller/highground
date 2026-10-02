/* HighGround — the decision packet: one initiative, everything a board needs to decide on it.
   Costs by fund and year over five years (each year's dollars), yearly costs, its effect on the gap and on each fund's
   lowest balance (the plan with and without it), its effect on taxpayers, the funding line, and other scenarios.
   Pure; tested by packet_test.js. */
(function (root, factory) {
  const need = (n, path) => root[n] || (typeof require === 'function' ? require(path) : null);
  const api = factory(need('HGEngine', './engine.js'), need('HGCapital', './capital.js'), need('HGRanking', './ranking.js'), need('HGTax', './tax.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGPacket = api;
})(typeof self !== 'undefined' ? self : this, function (E, C, K, T) {
  'use strict';
  const FUNDS = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp'];

  function build(rows, initiativeId, scenarioId, opts) {
    const sc = rows.scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new Error('Scenario not found');
    const init = rows.initiatives.find((x) => x.id === initiativeId);
    if (!init) throw new Error('Initiative not found');
    const inp = C.buildInputs(rows, scenarioId), cfg = inp.cfg, L = inp.levers;
    const id = String(initiativeId), proj = inp.projects.find((p) => String(p.id) === id) || null;
    const recur = (L.recur || []).filter((r) => String(r.initiative_id) === id);
    const firstFY = (opts && opts.firstFY) || cfg.start, years = Array.from({ length: 5 }, (_, k) => firstFY + k);
    // one-time costs by fund and year, in that year's dollars (finished phases at actual cost)
    const byFund = {};
    (proj ? proj.phases : []).forEach((ph) => {
      const fy = cfg.start + ph.year, cost = ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + L.infl, ph.year);
      ph.funding.forEach((f) => { const row = (byFund[f.b] = byFund[f.b] || {}); row[fy] = (row[fy] || 0) + cost * f.p / 100; });
    });
    const yearly = years.map((fy) => recur.reduce((t, r) => t + E.recurIn(cfg, r.fund, fy - cfg.start, Object.assign({}, L, { recur: [r] })), 0));
    const total = (row, list) => list.reduce((t, fy) => t + (row[fy] || 0), 0);
    const oneTimeAll = Object.values(byFund).reduce((t, row) => t + Object.values(row).reduce((a, v) => a + v, 0), 0);
    // the plan with and without it
    const without = { projects: inp.projects.filter((p) => String(p.id) !== id), L: Object.assign({}, L, { recur: (L.recur || []).filter((r) => String(r.initiative_id) !== id) }) };
    const rWith = E.compute(inp.projects, L, cfg), rWithout = E.compute(without.projects, without.L, cfg);
    const pWith = C.fundPaths(rWith, cfg), pWithout = C.fundPaths(rWithout, cfg);
    const draws = [...new Set(Object.keys(byFund).filter((b) => ['save', 'ppel', 'vppel', 'grants'].includes(b)).concat(recur.map((r) => r.fund).filter((b) => ['save', 'ppel', 'vppel', 'grants'].includes(b))))];
    const lows = draws.map((b) => ({ fund: b, with: pWith[b].low, withFY: pWith[b].lowFY, without: pWithout[b].low, withoutFY: pWithout[b].lowFY }));
    // taxpayers
    const tWith = T ? T.impact(cfg, L, inp.tax) : null, tWithout = T ? T.impact(cfg, without.L, inp.tax) : null;
    const peak = (t) => (t && t.peak && t.hasValuation ? t.peak.home : 0);
    // funding line
    const k = K.build(rows, scenarioId), item = k.items.find((x) => x.id === id) || null;
    const flags = k.flags.filter((f) => f.low.id === id || f.high.id === id).map((f) => f.text);
    // other scenarios that include it
    const others = rows.scenarios.filter((x) => x.id !== scenarioId).map((x) => {
      const ph = rows.phases.filter((p) => p.scenario_id === x.id && p.initiative_id === initiativeId);
      const rc = (rows.recurring || []).filter((r) => r.scenario_id === x.id && r.initiative_id === initiativeId);
      return ph.length || rc.length ? { name: x.name, board: !!x.is_board_version, cost: ph.reduce((t, p) => t + Number(p.cost), 0), years: [...new Set(ph.map((p) => p.fy))].sort(), yearly: rc.reduce((t, r) => t + Number(r.annual_amount), 0) } : null;
    }).filter(Boolean);
    const prio = (rows.priorities || []).find((p) => p.id === init.priority_id);
    return {
      version: 1, initiative: { id, name: init.name, type: init.type || 'capital', status: init.status || 'proposed', tier: K.tierOf(init).tier, owner: init.owner_name || '',
        area: init.focus_area || '', description: init.description || '', priority: prio ? prio.name : '', approved_on: init.approved_on || null },
      scenario: { id: sc.id, name: sc.name, board: !!sc.is_board_version }, years, inScenario: !!(proj || recur.length),
      byFund: FUNDS.filter((b) => byFund[b]).map((b) => ({ fund: b, values: years.map((fy) => byFund[b][fy] || 0), inWindow: total(byFund[b], years), all: Object.values(byFund[b]).reduce((a, v) => a + v, 0) })),
      yearly, oneTimeAll, phases: (proj ? proj.phases : []).map((ph) => ({ fy: cfg.start + ph.year, label: ph.label || '', cost: ph.cost, status: ph.status || 'planned' })),
      recur: recur.map((r) => ({ kind: r.kind, fund: r.fund, amount: r.amount, first: r.first, last: r.last, grows: r.grows })),
      gap: { with: rWith.gap, without: rWithout.gap, effect: rWith.gap - rWithout.gap }, lows,
      tax: { with: peak(tWith), without: peak(tWithout), homeValue: tWith ? tWith.homeValue : 150000, hasValuation: !!(tWith && tWith.hasValuation) },
      fundingLine: item ? { position: item.position, of: k.items.length, above: item.above, fitsAlone: !!item.fitsAlone, lineAt: k.line, outsideOnly: !!item.outsideOnly, camp: item.camp > 0.5 } : null, flags, others,
    };
  }
  return { build };
});
