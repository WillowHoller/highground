/* HighGround — suggestions: "move this project N years and these others fit".
   For each initiative with phases not yet started, try moving them 1–3 years later or 1–2 years earlier, rerun the
   plan, and see which initiatives cross the funding line (the ranking's walk down the list, the same rule as
   Decisions → Ranking). A move is suggested only when it funds something without pushing anything else below the
   line, and never moves an initiative later than the year it is needed by.
   Needed by = initiative.need_by_fy; if blank, a capital project with a remaining life uses plan start + life.
   Pure functions; the engine does the math. Tests: suggest_test.js */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGSuggest = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const TIER_WEIGHT = { must: 3, strategic: 2, nice: 1 };
  const MOVES = [1, 2, 3, -1, -2];
  const movable = (ph) => ph.status !== 'done' && ph.status !== 'underway';

  /** the year an initiative is needed by, or null */
  function needBy(init, cfg) {
    if (!init) return null;
    if (init.need_by_fy != null && init.need_by_fy !== '') return Number(init.need_by_fy);
    if (init.remaining_life != null && init.remaining_life !== '') return cfg.start + Number(init.remaining_life);
    return null;
  }

  /** the funding line for one set of projects: the same walk as the ranking (order = initiative ids, best first) */
  function walk(projects, L, cfg, order) {
    const run = (ids) => {
      const keep = new Set(ids);
      return E.compute(projects.filter((p) => keep.has(String(p.id))), Object.assign({}, L, { recur: (L.recur || []).filter((r) => keep.has(String(r.initiative_id))) }), cfg);
    };
    const baseOver = run([]).overflow, taken = [];
    for (const id of order) {
      if (run(taken.concat(id)).overflow > baseOver + 0.5) break;
      taken.push(id);
    }
    return { above: new Set(taken), gap: E.compute(projects, L, cfg).gap };
  }

  const shift = (p, d) => Object.assign({}, p, { phases: p.phases.map((ph) => (movable(ph) ? Object.assign({}, ph, { year: ph.year + d }) : ph)) });

  /**
   * inp: { projects, levers, cfg } (HGCapital.buildInputs); items: the ranking's items in rank order ({ id, name, tier });
   * inits: initiative rows (for need_by_fy / remaining_life). Returns { suggestions, late, urgentBelow }.
   */
  function suggest(inp, items, inits, opts) {
    const o = Object.assign({ max: 5 }, opts || {}), cfg = inp.cfg, L = inp.levers;
    const order = items.map((x) => String(x.id)), byId = new Map(items.map((x) => [String(x.id), x]));
    const INIT = new Map((inits || []).map((i) => [String(i.id), i]));
    const base = walk(inp.projects, L, cfg, order);
    const out = [];
    inp.projects.forEach((p, idx) => {
      const mv = p.phases.filter(movable); if (!mv.length) return;
      const nb = needBy(INIT.get(String(p.id)), cfg);
      MOVES.forEach((d) => {
        const ys = mv.map((ph) => ph.year + d);
        if (Math.min(...ys) < 0 || Math.max(...ys) > cfg.n - 1) return;
        if (d > 0 && nb != null && cfg.start + Math.max(...ys) > nb) return;   // never later than it's needed
        const projects = inp.projects.slice(); projects[idx] = shift(p, d);
        const w = walk(projects, L, cfg, order);
        const funds = order.filter((id) => w.above.has(id) && !base.above.has(id) && id !== String(p.id));
        const loses = order.filter((id) => base.above.has(id) && !w.above.has(id));
        const gapChange = w.gap - base.gap;
        if (loses.length || (!funds.length && gapChange > -0.5)) return;
        const it = byId.get(String(p.id)) || { name: p.name };
        out.push({ id: String(p.id), name: it.name || p.name, delta: d, from: mv.map((ph) => cfg.start + ph.year), to: ys.map((y) => cfg.start + y), needBy: nb,
          funds: funds.map((id) => ({ id, name: (byId.get(id) || {}).name || id, tier: (byId.get(id) || {}).tier })), gapChange,
          score: funds.reduce((a, id) => a + (TIER_WEIGHT[(byId.get(id) || {}).tier] || 1), 0) * 1e9 - gapChange - Math.abs(d) });
      });
    });
    out.sort((a, b) => b.score - a.score);
    // one suggestion per initiative: its best move
    const seen = new Set(), suggestions = out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, o.max);
    // timing warnings the ranking can show
    const late = [], urgentBelow = [];
    inp.projects.forEach((p) => {
      const nb = needBy(INIT.get(String(p.id)), cfg), it = byId.get(String(p.id)); if (nb == null || !it) return;
      const last = Math.max(...p.phases.map((ph) => cfg.start + ph.year));
      if (last > nb) late.push({ id: String(p.id), name: it.name, planned: last, needBy: nb });
      if (!base.above.has(String(p.id)) && nb - cfg.start <= 2) urgentBelow.push({ id: String(p.id), name: it.name, needBy: nb });
    });
    return { suggestions, late, urgentBelow, baseGap: base.gap, aboveCount: base.above.size };
  }

  /**
   * Goal seek: what would it take to fund one initiative (above the funding line) with all its phases by a fiscal year?
   * Returns { possible, notes, options: [{ kind: 'rank'|'move'|'pair', text-ready fields… }] }, best first.
   *  rank: put it at #position in the force rank (who drops below the line as a result)
   *  move / pair: move one or two OTHER initiatives (never past their needed-by year, never a started phase), keeping its rank
   */
  function goalSeek(inp, items, inits, targetId, byFY, opts) {
    const o = Object.assign({ max: 6 }, opts || {}), cfg = inp.cfg, L = inp.levers, tid = String(targetId);
    const INIT = new Map((inits || []).map((i) => [String(i.id), i])), byId = new Map(items.map((x) => [String(x.id), x]));
    let order = items.map((x) => String(x.id));
    const idx = inp.projects.findIndex((p) => String(p.id) === tid), notes = [];
    if (idx < 0) return { possible: false, notes: ['This initiative has no one-time phases in this scenario, so the funding line doesn’t apply to it.'], options: [] };
    let projects = inp.projects.slice();
    const tp = projects[idx], lastFY = cfg.start + Math.max(...tp.phases.map((ph) => ph.year));
    if (byFY != null && lastFY > byFY) {                 // it has to happen earlier: pull its unstarted phases forward
      const d = byFY - lastFY;
      if (tp.phases.some((ph) => movable(ph) && ph.year + d < 0)) return { possible: false, notes: [`It can’t be finished by FY${byFY}: that is before the plan starts.`], options: [] };
      projects[idx] = shift(tp, d);
      notes.push(`Its phases move ${-d} year${d === -1 ? '' : 's'} earlier to finish by FY${byFY}.`);
    }
    const name = (id) => (byId.get(id) || {}).name || id;
    const base = walk(projects, L, cfg, order);
    if (base.above.has(tid)) return { possible: true, notes: notes.concat(notes.length ? ['With that, it fits as ranked.'] : ['It already fits, as ranked and as planned.']), options: [] };
    const out = [];
    // 1. rank it higher: the lowest position at which it's above the line
    const rest = order.filter((id) => id !== tid);
    for (let pos = rest.length; pos >= 0; pos--) {
      const ord = rest.slice(0, pos).concat(tid, rest.slice(pos));
      const w = walk(projects, L, cfg, ord);
      if (w.above.has(tid)) {
        const drops = [...base.above].filter((id) => !w.above.has(id));
        out.push({ kind: 'rank', position: pos + 1, drops: drops.map((id) => ({ id, name: name(id) })), order: ord, score: 1e6 * drops.length });
        break;
      }
    }
    // 2. one other initiative moves (keeps everything funded that was funded, and funds the target)
    const single = [];
    projects.forEach((p, j) => {
      if (j === idx) return;
      const mv = p.phases.filter(movable); if (!mv.length) return;
      const nb = needBy(INIT.get(String(p.id)), cfg);
      MOVES.forEach((d) => {
        const ys = mv.map((ph) => ph.year + d);
        if (Math.min(...ys) < 0 || Math.max(...ys) > cfg.n - 1 || (d > 0 && nb != null && cfg.start + Math.max(...ys) > nb)) return;
        const pr = projects.slice(); pr[j] = shift(p, d);
        const w = walk(pr, L, cfg, order), drops = [...base.above].filter((id) => !w.above.has(id));
        const m = { id: String(p.id), name: name(String(p.id)), delta: d, from: mv.map((ph) => cfg.start + ph.year), to: ys.map((y) => cfg.start + y) };
        if (w.above.has(tid) && !drops.length) out.push({ kind: 'move', moves: [m], score: Math.abs(d) });
        else if (!drops.length) single.push({ m, j, p, d });   // harmless on its own: a candidate for pairing
      });
    });
    // 3. two moves together, only if no single move works
    if (!out.some((x) => x.kind === 'move')) {
      const cand = single.slice(0, 40);
      for (let a = 0; a < cand.length && out.filter((x) => x.kind === 'pair').length < 3; a++) {
        for (let b = a + 1; b < cand.length; b++) {
          if (cand[a].j === cand[b].j) continue;
          const pr = projects.slice(); pr[cand[a].j] = shift(cand[a].p, cand[a].d); pr[cand[b].j] = shift(cand[b].p, cand[b].d);
          const w = walk(pr, L, cfg, order), drops = [...base.above].filter((id) => !w.above.has(id));
          if (w.above.has(tid) && !drops.length) { out.push({ kind: 'pair', moves: [cand[a].m, cand[b].m], score: 100 + Math.abs(cand[a].d) + Math.abs(cand[b].d) }); break; }
        }
      }
    }
    out.sort((a, b) => a.score - b.score);
    { const seen = new Set();   // one option per moved initiative: its smallest move (already first after the sort)
      const kept = out.filter((x) => { if (x.kind !== 'move') return true; const key = x.moves[0].id; if (seen.has(key)) return false; seen.add(key); return true; });
      out.length = 0; out.push(...kept); }
    // keep the rank option visible even when moves exist, but list moves first when they cost nothing
    return { possible: out.length > 0, notes, options: out.slice(0, o.max), pulledForward: notes.length > 0, byFY };
  }

  /** the phase-year changes a suggestion makes, for saving it as a scenario: [{ fy, toFy }] per movable phase */
  const moves = (s) => s.from.map((fy, k) => ({ fy, toFy: s.to[k] }));

  return { suggest, goalSeek, needBy, walk, moves, MOVES };
});
