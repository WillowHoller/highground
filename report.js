/* HighGround — the monthly board report.
   build(): a dated snapshot of everything a board looks at, computed from HighGround's own data, so it needs no
   hand editing. The snapshot is stored as it was (report_snapshot.payload) and never recalculated afterwards.
   changes(): what changed since the previous snapshot, as plain sentences.
   Pure; tested by report_test.js. */
(function (root, factory) {
  const need = (n, path) => root[n] || (typeof require === 'function' ? require(path) : null);
  const api = factory(need('HGEngine', './engine.js'), need('HGCapital', './capital.js'), need('HGBudget', './budget.js'), need('HGActuals', './actuals.js'), need('HGTax', './tax.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGReport = api;
})(typeof self !== 'undefined' ? self : this, function (E, C, B, A, T) {
  'use strict';
  const CAPF = ['save', 'ppel', 'vppel', 'grants'];
  const FUNDN = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants', general: 'General Fund', debt_levy: 'Debt Service' };
  const STATUSN = { idea: 'Idea', proposed: 'Proposed', analysis: 'Being analysed', approved: 'Approved', underway: 'Underway', done: 'Done', deferred: 'Deferred', declined: 'Declined' };
  const fmt = (v) => { const s = v < 0 ? '−' : ''; v = Math.abs(v); return s + (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)); };

  /** inputs: { district, rows (capital rows), periodEnd, batch, accounts, amounts (that batch), linkedAmounts, batches, balances } */
  function build(inp) {
    const rows = inp.rows, board = rows.scenarios.find((x) => x.is_board_version);
    if (!board) throw new Error('No board version');
    const bi = C.buildInputs(rows, board.id), cfg = bi.cfg, r = E.compute(bi.projects, bi.levers, cfg);
    const fy = E.fyOfDate(inp.periodEnd);
    // balances: each fund's latest balance on or before the month end
    const bal = {};
    (inp.balances || []).filter((b) => b.as_of <= inp.periodEnd).forEach((b) => { if (!bal[b.fund] || b.as_of > bal[b.fund].as_of) bal[b.fund] = { amount: Number(b.amount), as_of: b.as_of }; });
    // budget vs. actual from the month's ledger
    const budget = inp.batch ? B.summarize(inp.accounts, inp.amounts, inp.batch.period_end, 'budget').funds.map((f) => ({
      key: f.key, name: f.name, revenue: pick(f.revenue), spending: pick(f.spending) })) : [];
    // progress on the adopted plan this fiscal year
    const act = A.actuals(inp.accounts || [], inp.linkedAmounts || inp.amounts || [], inp.batches || []);
    const planned = A.planned(bi.projects, bi.levers, cfg, fy);
    const INIT = new Map(rows.initiatives.map((i) => [i.id, i]));
    const phases = rows.phases.filter((p) => p.scenario_id === board.id);
    const initiatives = {};
    rows.initiatives.forEach((i) => { initiatives[i.id] = { name: i.name, status: i.status || 'proposed' }; });
    const progress = [...new Set(bi.projects.map((p) => String(p.id)).concat(Object.keys(act.byInitiative)))].filter((id) => INIT.has(id)).map((id) => {
      const a = (act.byInitiative[id] || {})[fy] || null, ph = phases.filter((p) => p.initiative_id === id);
      return { id, name: INIT.get(id).name, status: INIT.get(id).status || 'proposed', planned: planned[id] || 0, spent: a ? a.spent : 0, encumbered: a ? a.encumbered : 0,
        phasesDone: ph.filter((p) => p.status === 'done').length, phases: ph.length };
    }).filter((x) => x.planned > 0.5 || x.spent > 0.5).sort((x, y) => y.planned - x.planned || x.name.localeCompare(y.name));
    const done = phases.filter((p) => p.status === 'done' && p.done_date).map((p) => ({ id: p.id, initiative: (INIT.get(p.initiative_id) || {}).name || '', label: p.label || '', fy: p.fy, done_date: p.done_date, actual: p.actual_cost == null ? null : Number(p.actual_cost) }));
    // decisions ahead: proposals the board hasn't approved, with their cost in the board version (or anywhere)
    const costOf = (id) => rows.phases.filter((p) => p.initiative_id === id && (p.scenario_id === board.id)).reduce((t, p) => t + Number(p.cost), 0);
    const pending = rows.initiatives.filter((i) => ['idea', 'proposed', 'analysis'].includes(i.status || 'proposed')).map((i) => ({ id: i.id, name: i.name, status: i.status || 'proposed', cost: costOf(i.id) }))
      .sort((x, y) => y.cost - x.cost || x.name.localeCompare(y.name));
    const tax = T ? T.impact(cfg, bi.levers, bi.tax) : null;
    return {
      version: 1, periodEnd: inp.periodEnd, fiscalYear: fy, district: inp.district ? inp.district.name : '', scenario: { id: board.id, name: board.name },
      ledgerThrough: inp.batch ? inp.batch.period_end : null,
      plan: { need: r.need, levyFunded: r.levyFunded, financed: r.financed, gap: r.gap, overflow: r.overflow, start: cfg.start, years: cfg.n },
      balances: bal, budget, progress, initiatives, done, pending: pending.slice(0, 12), pendingCount: pending.length,
      tax: tax && tax.taxed.length && tax.hasValuation ? { home: tax.peak.home, fy: tax.peak.fy, homeValue: tax.homeValue } : null,
      gf: inp.gf || null,   // the General Fund forecast's headline figures, when the district has set it up
    };
    function pick(o) { return { budget: o.budget, actual: o.actual, encumbered: o.encumbered, forecast: o.forecast, variance: o.variance }; }
  }

  /** what changed since the previous snapshot, as plain sentences (most important first) */
  function changes(now, prev) {
    if (!prev) return { first: true, items: ['This is the first board report, so there is nothing to compare with yet.'] };
    const items = [];
    const dGap = now.plan.gap - prev.plan.gap;
    if (Math.abs(dGap) > 0.5) items.push(`The gap to close ${dGap > 0 ? 'grew' : 'shrank'} by ${fmt(Math.abs(dGap))}, to ${fmt(now.plan.gap)}.`);
    if (now.scenario.id !== prev.scenario.id) items.push(`The board version is now “${now.scenario.name}” (was “${prev.scenario.name}”).`);
    (now.done || []).filter((d) => !(prev.done || []).some((p) => p.id === d.id)).forEach((d) =>
      items.push(`Finished: ${d.initiative}${d.label ? ' · ' + d.label : ''}, on ${d.done_date}${d.actual != null ? `, at ${fmt(d.actual)}` : ''}.`));
    Object.entries(now.initiatives || {}).forEach(([id, i]) => {
      const p = (prev.initiatives || {})[id];
      if (!p) items.push(`New initiative: ${i.name} (${STATUSN[i.status] || i.status}).`);
      else if (p.status !== i.status) items.push(`${i.name}: ${STATUSN[p.status] || p.status} → ${STATUSN[i.status] || i.status}.`);
    });
    ['save', 'ppel', 'vppel', 'debt_levy', 'general'].forEach((f) => {
      const a = (now.balances || {})[f], b = (prev.balances || {})[f];
      if (a && b && Math.abs(a.amount - b.amount) > 0.5) items.push(`${FUNDN[f]} balance ${a.amount > b.amount ? 'up' : 'down'} ${fmt(Math.abs(a.amount - b.amount))}, to ${fmt(a.amount)}.`);
    });
    if (now.gf && prev.gf && now.gf.solvency != null && prev.gf.solvency != null && Math.abs(now.gf.solvency - prev.gf.solvency) >= 0.001)
      items.push(`General Fund solvency ${now.gf.solvency > prev.gf.solvency ? 'rose' : 'fell'} from ${(prev.gf.solvency * 100).toFixed(1)}% to ${(now.gf.solvency * 100).toFixed(1)}%.`);
    const spentNow = (now.progress || []).reduce((t, x) => t + x.spent, 0), spentPrev = now.fiscalYear === prev.fiscalYear ? (prev.progress || []).reduce((t, x) => t + x.spent, 0) : 0;
    if (spentNow - spentPrev > 0.5) items.push(`Spending on initiatives this period: ${fmt(spentNow - spentPrev)}.`);
    if (!items.length) items.push('Nothing material changed since the last report.');
    return { first: false, items, since: prev.periodEnd };
  }

  return { build, changes, fmt };
});
