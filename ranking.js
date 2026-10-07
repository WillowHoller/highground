/* HighGround — ranking and the funding line.
   Initiatives in a scenario, in one list: tier (must-have, strategic, nice-to-have) then rank within the tier.
   The funding line: walk down the list, adding each initiative to what's already funded, and stop at the first
   one that would leave SAVE, PPEL, V-PPEL or grants short in some year. Campaign/bond and booster shares don't
   count against those funds; they're reported separately.
   Flags: a lower-ranked initiative spending a fund in or before a year when a higher-ranked one runs that fund short.
   Fund in rank order: what the plan looks like with only the initiatives above the line.
   Pure; tested by ranking_test.js. */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const C = root.HGCapital || (typeof require === 'function' ? require('./capital.js') : null);
  const api = factory(E, C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGRanking = api;
})(typeof self !== 'undefined' ? self : this, function (E, C) {
  'use strict';
  const TIERS = ['must', 'strategic', 'nice', ''];
  const TIER_NAME = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have', '': 'No priority set' };
  const FROM_PRIORITY = { High: 'must', Med: 'strategic', Low: 'nice', '10-yr': 'nice' };
  const CAP = ['save', 'ppel', 'vppel', 'grants'];
  const FUND = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'grants' };

  /** The tier to use: the one set on the initiative, or one suggested from its High/Med/Low priority. */
  function tierOf(init) {
    if (init && init.tier) return { tier: init.tier, suggested: false };
    const t = init && FROM_PRIORITY[init.engine_priority];
    return t ? { tier: t, suggested: true } : { tier: '', suggested: false };
  }

  function build(rows, sid, opts) {
    const by = (opts && opts.by) || 'rank';
    const inp = C.buildInputs(rows, sid), cfg = inp.cfg, L = inp.levers;
    const INIT = new Map(rows.initiatives.map((i) => [i.id, i]));
    const RANK = new Map((rows.scenario_initiative || []).filter((x) => x.scenario_id === sid).map((x) => [x.initiative_id, x.rank]));
    const ids = [...new Set([...inp.projects.map((p) => String(p.id)), ...(L.recur || []).map((r) => String(r.initiative_id))])];
    const items = ids.map((id) => {
      const init = INIT.get(id) || { id, name: (inp.projects.find((p) => String(p.id) === id) || {}).name || 'Initiative' };
      const p = inp.projects.find((x) => String(x.id) === id);
      const t = tierOf(init);
      const oneTime = p ? p.phases.reduce((a, ph) => a + ph.cost, 0) : 0;
      const share = (b) => (p ? p.phases.reduce((a, ph) => a + ph.cost * ph.funding.filter((f) => f.b === b).reduce((s, f) => s + f.p, 0) / 100, 0) : 0);
      const camp = share('camp'), boost = share('boost'), outside = camp + boost;
      const capitalYearly = (L.recur || []).filter((r) => String(r.initiative_id) === id && CAP.includes(r.fund)).reduce((a, r) => a + r.amount, 0);
      const yearly = (L.recur || []).filter((r) => String(r.initiative_id) === id).reduce((a, r) => a + r.amount, 0);
      const years = p ? [...new Set(p.phases.map((ph) => cfg.start + ph.year))] : [];
      const needBy = init.need_by_fy != null && init.need_by_fy !== '' ? Number(init.need_by_fy) : init.remaining_life != null && init.remaining_life !== '' && p ? cfg.start + Number(init.remaining_life) : null;
      return { id, name: init.name, tier: t.tier, needBy, suggested: t.suggested, rank: RANK.has(id) ? RANK.get(id) : null, oneTime, outside, camp, boost, yearly, years, project: p,
               outsideOnly: oneTime > 0.5 && oneTime - outside < 0.5 && capitalYearly < 0.5 };
    });
    const byPriority = (a, b) => (TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) || ((a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank)) || a.name.localeCompare(b.name);
    // 'rank' (default): the district's own force rank across all priorities; anything not ranked yet goes last, in priority order.
    // 'need': the year each is needed by first (no year = after those with one), then rank. 'priority': grouped by priority (the old view).
    const byRank = (a, b) => ((a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank)) || byPriority(a, b);
    items.sort(by === 'need' ? (a, b) => ((a.needBy == null ? 9999 : a.needBy) - (b.needBy == null ? 9999 : b.needBy)) || byRank(a, b) : by === 'priority' ? byPriority : byRank);
    items.forEach((x, k) => { x.position = k + 1; });

    // walk down the list
    const runWith = (set) => {
      const keep = new Set(set);
      const projects = inp.projects.filter((p) => keep.has(String(p.id)));
      const Lk = Object.assign({}, L, { recur: (L.recur || []).filter((r) => keep.has(String(r.initiative_id))) });
      return E.compute(projects, Lk, cfg);
    };
    const base = runWith([]);
    const baseOver = base.overflow;   // existing debt or commitments can leave a fund short even with nothing planned
    let line = items.length, taken = [];
    for (let k = 0; k < items.length; k++) {
      const r = runWith(taken.concat(items[k].id));
      items[k].overflowWith = r.overflow;
      if (r.overflow > baseOver + 0.5) { line = k; break; }
      taken.push(items[k].id);
    }
    // below the line: does each still fit on its own in what's left?
    for (let k = line; k < items.length; k++) {
      const r = runWith(taken.concat(items[k].id));
      items[k].fitsAlone = r.overflow <= baseOver + 0.5;
      items[k].above = false;
    }
    items.slice(0, line).forEach((x) => { x.above = true; });

    // flags from the full scenario: who spends a fund that a higher-ranked initiative then finds short
    const full = E.compute(inp.projects, L, cfg);
    const flags = [];
    const posOf = new Map(items.map((x) => [x.id, x.position]));
    const shortYears = [];
    full.res.forEach((m, y) => CAP.forEach((b) => { if (m.over[b] > 0.5) shortYears.push({ y, b, fy: m.fy }); }));
    shortYears.forEach(({ y, b, fy }) => {
      const needing = items.filter((x) => x.project && x.project.phases.some((ph) => ph.year === y && ph.funding.some((f) => f.b === b)));
      needing.forEach((h) => {
        items.filter((l) => l.position > h.position && l.project && l.project.phases.some((ph) => ph.year <= y && ph.funding.some((f) => f.b === b)))
          .forEach((l) => {
            const yr = cfg.start + Math.min(...l.project.phases.filter((ph) => ph.year <= y && ph.funding.some((f) => f.b === b)).map((ph) => ph.year));
            const key = l.id + '|' + h.id + '|' + b;
            if (!flags.some((f) => f.key === key)) flags.push({ key, low: l, high: h, fund: b, fy: yr, shortFY: fy,
              text: `${l.name} (${TIER_NAME[l.tier].toLowerCase()}, #${l.position}, FY${yr}) spends ${FUND[b]} that ${h.name} (${TIER_NAME[h.tier].toLowerCase()}, #${h.position}) is short of in FY${fy}.` });
          });
      });
    });
    flags.sort((a, b) => a.high.position - b.high.position || a.low.position - b.low.position);

    // fund in rank order: keep only what's above the line
    const kept = runWith(items.slice(0, line).map((x) => x.id));
    const deferred = items.slice(line);
    return {
      cfg, by, items, line, flags, baseOverflow: baseOver,
      current: { need: full.need, gap: full.gap, overflow: full.overflow },
      rankOrder: { need: kept.need, gap: kept.gap, overflow: kept.overflow, deferred, deferredCost: deferred.reduce((a, x) => a + x.oneTime, 0),
                   deferredYearly: deferred.reduce((a, x) => a + x.yearly, 0) },
      aboveCost: items.slice(0, line).reduce((a, x) => a + x.oneTime, 0),
    };
  }

  return { build, tierOf, TIERS, TIER_NAME, FROM_PRIORITY };
});
