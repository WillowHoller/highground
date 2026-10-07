/* HighGround — the year-by-year funding line.
   A ranked list says who goes first; a year-by-year line says WHEN each can be paid for. Walk the plan a year at a time.
   When the capital funds (SAVE, PPEL, V-PPEL, grants) are short in a year, the initiative that can best wait moves to the
   next year: first those with room before their needed-by year (or no needed-by year), lowest in the district's rank
   first; never past its needed-by year, never a phase already underway or done. What still doesn't fit is short that year.
   Pure functions; the engine does the math. Tests: schedule_test.js */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGSchedule = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const LEVY = ['save', 'ppel', 'vppel', 'grants'];
  const movable = (ph) => ph.status !== 'done' && ph.status !== 'underway';
  const usesLevy = (ph) => ph.funding.some((f) => LEVY.includes(f.b));
  const clone = (projects) => projects.map((p) => Object.assign({}, p, { phases: p.phases.map((ph) => Object.assign({}, ph)) }));

  /**
   * inp: { projects, levers, cfg }; items: ranked items ({ id, name, tier, needBy }) best first.
   * Returns { items: [{ id, name, tier, needBy, planned:[fy], scheduled:[fy], slip, status }], years: [{ fy, short }], projects (rescheduled), moves }
   * status: 'on time' | 'later' (moved, still by its needed-by year) | 'short' (a year it needs is still short) | 'outside' (campaign/boosters only)
   */
  function schedule(inp, items) {
    const cfg = inp.cfg, L = inp.levers, n = cfg.n;
    const projects = clone(inp.projects), byId = new Map(projects.map((p) => [String(p.id), p]));
    const rank = new Map(items.map((x, k) => [String(x.id), k])), info = new Map(items.map((x) => [String(x.id), x]));
    const planned = new Map(projects.map((p) => [String(p.id), p.phases.map((ph) => ph.year)]));
    const overIn = (y) => { const r = E.compute(projects, L, cfg); return LEVY.reduce((a, b) => a + r.res[y].over[b], 0); };
    const base = E.compute([], L, cfg), baseOver = (y) => LEVY.reduce((a, b) => a + base.res[y].over[b], 0);   // short with nothing planned
    const moves = [];
    for (let y = 0; y < n; y++) {
      let guard = 0;
      while (overIn(y) > baseOver(y) + 0.5 && guard++ < 200) {
        // who has a phase in this year that could wait a year?
        const cand = [];
        projects.forEach((p) => {
          const id = String(p.id), nb = (info.get(id) || {}).needBy;
          p.phases.forEach((ph) => {
            if (ph.year !== y || !movable(ph) || !usesLevy(ph) || y + 1 > n - 1) return;
            if (nb != null && cfg.start + y + 1 > nb) return;   // can't wait past its needed-by year
            cand.push({ id, ph, slack: nb == null ? 99 : nb - (cfg.start + y), r: rank.has(id) ? rank.get(id) : 1e6 });
          });
        });
        if (!cand.length) break;
        cand.sort((a, b) => (b.r - a.r) || (b.slack - a.slack));   // lowest-ranked first; more slack breaks ties
        const c = cand[0];
        c.ph.year = y + 1; moves.push({ id: c.id, fromFY: cfg.start + y, toFY: cfg.start + y + 1 });
      }
    }
    const final = E.compute(projects, L, cfg);
    const years = final.res.map((m, y) => ({ fy: m.fy, short: Math.max(0, LEVY.reduce((a, b) => a + m.over[b], 0) - baseOver(y)) }));
    const shortYears = new Set(years.filter((x) => x.short > 0.5).map((x) => x.fy - cfg.start));
    const out = items.filter((x) => byId.has(String(x.id))).map((x) => {
      const id = String(x.id), p = byId.get(id), pl = planned.get(id), sc = p.phases.map((ph) => ph.year);
      const slip = Math.max(0, ...sc.map((yy, k) => yy - pl[k]));
      const levy = p.phases.some(usesLevy);
      const short = levy && p.phases.some((ph) => usesLevy(ph) && shortYears.has(ph.year));
      return { id, name: x.name, tier: x.tier, needBy: x.needBy == null ? null : x.needBy, planned: pl.map((yy) => cfg.start + yy), scheduled: sc.map((yy) => cfg.start + yy), slip,
        status: !levy ? 'outside' : short ? 'short' : slip ? 'later' : 'on time' };
    });
    // collapse the step-by-step moves to one move per phase: original year → final year
    const net = [];
    projects.forEach((p) => p.phases.forEach((ph, k) => { const from = cfg.start + planned.get(String(p.id))[k], to = cfg.start + ph.year; if (from !== to) net.push({ id: String(p.id), fromFY: from, toFY: to }); }));
    return { items: out, years, projects, moves: net, steps: moves.length };
  }

  return { schedule, LEVY };
});
