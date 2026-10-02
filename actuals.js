/* HighGround — project actuals from the monthly GL imports.
   Spending accounts linked to an initiative (gl_account.initiative_id) give its actual spending:
   for each fiscal year, the year-to-date amount in that year's latest applied import.
   Suggestions link capital-fund spending accounts to initiatives by project code and by words in the description.
   Pure; tested by actuals_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGActuals = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CAPITAL = ['save', 'ppel', 'vppel', 'other'];
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'new', 'phase', 'construction', 'design', 'project', 'projects', 'upgrade', 'replacement', 'replace',
    'renovation', 'two', 'one', 'year', 'buildings', 'building', 'services', 'service', 'devices', 'purchase', 'fund', 'district']);
  const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9: ]+/g, ' ').split(/\s+/)
    .map((w) => (w.length > 4 ? w.replace(/ies$/, 'y').replace(/([^su])s$/, '$1') : w)).filter((w) => w.length >= 3 && !STOP.has(w)));

  /** each fiscal year's latest applied monthly import */
  function latestByYear(batches) {
    const out = {};
    (batches || []).filter((b) => b.kind === 'gl_monthly' && b.status === 'applied' && b.period_end).forEach((b) => {
      const fy = b.fiscal_year || null; if (!fy) return;
      if (!out[fy] || b.period_end > out[fy].period_end) out[fy] = b;
    });
    return out;
  }

  /** actual spending per initiative per fiscal year: { [initiativeId]: { [fy]: { spent, encumbered, budget, through } } } */
  function actuals(accounts, amounts, batches) {
    const latest = latestByYear(batches), batchFY = {};
    Object.entries(latest).forEach(([fy, b]) => { batchFY[b.id] = { fy: Number(fy), through: b.period_end }; });
    const acc = new Map((accounts || []).filter((a) => a.initiative_id).map((a) => [a.id, a]));
    const out = {};
    (amounts || []).forEach((g) => {
      const a = acc.get(g.account_id), bf = batchFY[g.batch_id]; if (!a || !bf) return;
      const sign = a.sign || 1, rec = ((out[a.initiative_id] = out[a.initiative_id] || {})[bf.fy] = out[a.initiative_id][bf.fy] || { spent: 0, encumbered: 0, budget: 0, through: bf.through, accounts: 0 });
      rec.spent += (Number(g.ytd_amount) || 0) * sign; rec.encumbered += (Number(g.encumbered) || 0) * sign; rec.budget += (Number(g.budget_amount) || 0) * sign; rec.accounts++;
    });
    return { byInitiative: out, through: Object.fromEntries(Object.entries(latest).map(([fy, b]) => [fy, b.period_end])) };
  }

  /** suggested links for capital-fund spending accounts not yet linked to an initiative */
  function suggestLinks(accounts, initiatives) {
    const inits = (initiatives || []).map((i) => ({ i, w: words(i.name) }));
    const byProject = {};
    (accounts || []).forEach((a) => { if (a.initiative_id && a.project_code && !/^0+$/.test(a.project_code)) byProject[a.project_code] = a.initiative_id; });
    // debt service (function 5xxx) and other financing uses (6xxx) are never project spending
    return (accounts || []).filter((a) => !a.initiative_id && (a.maps_to === 'expense' || a.maps_to === 'initiative') && CAPITAL.includes(a.mapped_fund) && !/^[56]/.test(a.function_code || ''))
      .map((a) => {
        if (a.project_code && byProject[a.project_code]) return { account: a, initiativeId: byProject[a.project_code], why: `same project code (${a.project_code}) as an account already linked`, score: 1 };
        const aw = words(a.description); let best = null;
        inits.forEach(({ i, w }) => {
          if (!w.size || !aw.size) return;
          let common = 0; aw.forEach((x) => { if (w.has(x)) common++; });
          const score = common / Math.min(aw.size, w.size);
          if (common >= 1 && (!best || score > best.score)) best = { i, score, common };
        });
        return best && (best.score >= 0.5 || best.common >= 2)
          ? { account: a, initiativeId: best.i.id, why: 'words in the description', score: best.score }
          : { account: a, initiativeId: null, why: '', score: 0 };
      });
  }

  /** a plan's cost per initiative in one fiscal year, in that year's dollars (finished phases at their actual cost) */
  function planned(projects, levers, cfg, fy) {
    const y = fy - cfg.start, out = {};
    (projects || []).forEach((p) => p.phases.forEach((ph) => {
      if (ph.year !== y) return;
      const cost = ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + (levers.infl || 0), ph.year);
      out[p.id] = (out[p.id] || 0) + cost;
    }));
    return out;
  }

  return { latestByYear, actuals, suggestLinks, planned, words };
});
