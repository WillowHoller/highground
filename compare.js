/* HighGround — comparing scenarios.
   metrics(): the numbers a board compares, for one scenario.
   explain(): why two scenarios' gaps differ, as a list of plain-language changes, each with its effect on the gap
   measured on its own (apply just that change to the first scenario, recompute). Changes can interact, so the
   remainder is reported as "these changes working together". Pure; tested by compare_test.js. */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const C = root.HGCapital || (typeof require === 'function' ? require('./capital.js') : null);
  const api = factory(E, C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGCompare = api;
})(typeof self !== 'undefined' ? self : this, function (E, C) {
  'use strict';
  const fmt = (v) => { const s = v < 0 ? '−' : ''; v = Math.abs(v); return s + (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)); };
  const pct = (v) => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
  const KIND = { go: 'general-obligation bond', rev: 'SAVE revenue bond', lease: 'lease-purchase', gift: 'campaign or gift' };
  const LEVER = {
    pg: ['PPEL valuation growth', pct], gy: ['grant yield to capital', pct], sg: ['SAVE receipts trend', pct],
    infl: ['construction inflation', pct], sf: ['SF 2472 SAVE cut', (v) => (v ? 'on' : 'off')], vppel: ['V-PPEL', (v) => (v ? 'on' : 'off')],
  };

  function run(rows, sid) {
    const inp = C.buildInputs(rows, sid);
    const r = E.compute(inp.projects, inp.levers, inp.cfg);
    return { sid, sc: rows.scenarios.find((x) => x.id === sid), inp, r };
  }
  const gapOf = (projects, L, cfg) => E.compute(projects, L, cfg).gap;

  function metrics(x) {
    const { inp, r } = x, cfg = inp.cfg, L = inp.levers, P = C.fundPaths(r, cfg);
    const yrs = C.yearSummary(r, cfg), busiest = yrs.reduce((a, y) => (y.total > a.total ? y : a), yrs[0]);
    const cap = E.saveBondCapacity(cfg, L, 0.045, 20, 1.2), go = E.goDebtRoom(cfg, L);
    const asks = [];
    (L.fin || []).forEach((f) => {
      if (f.kind === 'go') asks.push(`A general-obligation bond of ${fmt(f.amount)} in FY${f.fy}, which needs a public vote`);
      else if (f.kind === 'gift') asks.push(`Raise ${fmt(f.amount)} through a campaign or gifts by FY${f.fy}`);
      else asks.push(`A ${KIND[f.kind]} of ${fmt(f.amount)} in FY${f.fy}`);
    });
    if (cfg.vStatus === 'proposed' && L.vppel) asks.push(`A V-PPEL vote (proposed through FY${cfg.vLast})`);
    const levy = (L.fin || []).filter((f) => f.repay === 'levy').reduce((a, f) => a + E.pmt(f.amount, f.rate, f.years), 0);
    if (levy > 0.5) asks.push(`Debt service levy of about ${fmt(levy)} a year while the bond is repaid`);
    if (r.unfunded > 0.5) asks.push(`${fmt(r.unfunded)} of campaign or bond projects not yet paid for`);
    if (r.overflow > 0.5) asks.push(`${fmt(r.overflow)} of spending beyond what SAVE, PPEL, V-PPEL and grants can pay`);
    return {
      need: r.need, levyFunded: r.levyFunded, boosters: r.spentByBucket.boost, campaign: r.spentByBucket.camp, financed: r.financed,
      unfunded: r.unfunded, overflow: r.overflow, gap: r.gap, busiestFY: busiest.fy, busiest: busiest.total,
      saveLow: P.save.low, saveLowFY: P.save.lowFY, ppelLow: P.ppel.low, ppelLowFY: P.ppel.lowFY,
      bondRoom: cap.pv, goRoom: go, asks, levers: L, projects: inp.projects.length,
    };
  }

  /* ---------------- why two scenarios differ ---------------- */
  const sig = (ph) => JSON.stringify([ph.year, ph.cost, ph.funding, ph.status || '', ph.actual == null ? null : ph.actual]);
  function describeProject(pa, pb, cfg) {
    if (!pa) return `Added ${pb.name}`;
    if (!pb) return `Removed ${pa.name}`;
    const parts = [];
    const tot = (p) => p.phases.reduce((t, ph) => t + ph.cost, 0);
    const yrs = (p) => p.phases.map((ph) => cfg.start + ph.year);
    if (JSON.stringify(yrs(pa)) !== JSON.stringify(yrs(pb))) {
      parts.push(pa.phases.length === 1 && pb.phases.length === 1 ? `moved from FY${yrs(pa)[0]} to FY${yrs(pb)[0]}` : `timing changed (FY${yrs(pa).join(', ')} → FY${yrs(pb).join(', ')})`);
    }
    if (Math.abs(tot(pa) - tot(pb)) > 0.5) parts.push(`cost ${fmt(tot(pa))} → ${fmt(tot(pb))}`);
    // the share of the project's cost each fund pays, regardless of how it's split into phases
    const mix = (p) => { const t = tot(p) || 1, m = {}; p.phases.forEach((ph) => ph.funding.forEach((f) => { m[f.b] = (m[f.b] || 0) + ph.cost * f.p / 100 / t; }));
      return m; };
    const ma = mix(pa), mb = mix(pb);
    if ([...new Set([...Object.keys(ma), ...Object.keys(mb)])].some((k) => Math.abs((ma[k] || 0) - (mb[k] || 0)) > 0.005)) parts.push('funding changed');
    const done = (p) => p.phases.filter((ph) => ph.status === 'done').map((ph) => [ph.year, ph.actual == null ? null : ph.actual]);
    const going = (p) => p.phases.filter((ph) => ph.status === 'underway').map((ph) => ph.year);
    if (JSON.stringify(done(pa)) !== JSON.stringify(done(pb)) || JSON.stringify(going(pa)) !== JSON.stringify(going(pb))) parts.push('progress changed');
    if (pa.phases.length !== pb.phases.length) parts.push(`${pa.phases.length} → ${pb.phases.length} phases`);
    return `${pb.name}: ${parts.join('; ') || 'changed'}`;
  }

  function explain(rows, refId, otherId) {
    const A = run(rows, refId), B = run(rows, otherId), cfg = A.inp.cfg;
    const LA = A.inp.levers, LB = B.inp.levers;
    const base = A.r.gap, total = B.r.gap - base, items = [];
    // levers, one at a time
    Object.keys(LEVER).forEach((k) => {
      if (JSON.stringify(LA[k]) === JSON.stringify(LB[k])) return;
      const L = Object.assign({}, LA, { [k]: LB[k] });
      items.push({ kind: 'lever', label: `${LEVER[k][0][0].toUpperCase() + LEVER[k][0].slice(1)}: ${LEVER[k][1](LA[k])} → ${LEVER[k][1](LB[k])}`,
                   effect: gapOf(A.inp.projects, L, cfg) - base });
    });
    // financing, as one change
    if (JSON.stringify(LA.fin || []) !== JSON.stringify(LB.fin || [])) {
      const L = Object.assign({}, LA, { fin: LB.fin || [] });
      const add = (LB.fin || []).filter((f) => !(LA.fin || []).some((g) => JSON.stringify(g) === JSON.stringify(f)));
      const drop = (LA.fin || []).filter((f) => !(LB.fin || []).some((g) => JSON.stringify(g) === JSON.stringify(f)));
      const words = [...add.map((f) => `adds ${f.name} (${KIND[f.kind]}, ${fmt(f.amount)} in FY${f.fy})`), ...drop.map((f) => `drops ${f.name}`)];
      items.push({ kind: 'financing', label: `Financing ${words.join('; ')}`, effect: gapOf(A.inp.projects, L, cfg) - base });
    }
    // projects, each on its own
    const byA = new Map(A.inp.projects.map((p) => [String(p.id), p])), byB = new Map(B.inp.projects.map((p) => [String(p.id), p]));
    const ids = [...new Set([...byA.keys(), ...byB.keys()])];
    ids.forEach((id) => {
      const pa = byA.get(id), pb = byB.get(id);
      if (pa && pb && JSON.stringify(pa.phases.map(sig)) === JSON.stringify(pb.phases.map(sig))) return;
      const list = A.inp.projects.filter((p) => String(p.id) !== id).concat(pb ? [pb] : []);
      items.push({ kind: 'project', label: describeProject(pa, pb, cfg), effect: gapOf(list, LA, cfg) - base });
    });
    const sum = items.reduce((t, x) => t + x.effect, 0), together = total - sum;
    items.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
    return { refGap: base, otherGap: B.r.gap, total, items, together: Math.abs(together) > 0.5 ? together : 0, ref: A.sc, other: B.sc };
  }

  return { run, metrics, explain, fmt };
});
