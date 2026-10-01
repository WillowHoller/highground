/* HighGround — what a scenario means for taxpayers (Iowa).
   Counts the property tax a scenario ADDS: the debt service levy for general-obligation bonds, and a V-PPEL that is
   proposed (not already in place) and switched on. SAVE revenue bonds, PPEL leases and campaigns add no levy.
   Shows the added cost only, never a household's whole tax bill.
   Pure; tested by tax_test.js. Rules checked 1 Oct 2026; update each November when the state sets new rollbacks. */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGTax = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const RULES = {
    checked: '2026-10-01',
    // Iowa Department of Revenue assessment limitation orders (rollback), by fiscal year the tax is paid.
    // FY2026 (assessment year 2024): LSA Fiscal Topics, 7 Jan 2026. FY2027 (AY2025): IDR order of Nov 2025, per Iowa League of Cities.
    residentialRollback: { 2025: 0.463428, 2026: 0.474316, 2027: 0.445345 },
    agRollback: { 2025: 0.718370, 2026: 0.738575, 2027: 0.594401 },
    // Homestead: the old credit (tax on $4,850 of value) through FY2027; from assessment year 2026 (FY2028) an
    // exemption of 10% of taxable value, at least $5,500 and at most $20,000 (2026 Iowa Acts, SF 2472, Division XX).
    // The maximum is adjusted for inflation each year after AY2026; HighGround holds it at $20,000 until published.
    homesteadCreditValue: 4850, homesteadCreditLastFY: 2027,
    homesteadPct: 0.10, homesteadMin: 5500, homesteadMax: 20000,
    seniorExemption: 6500,    // 65 and older, assessment years 2024 and later
  };
  const latest = (table, fy) => {
    const ys = Object.keys(table).map(Number).sort((a, b) => a - b);
    let v = table[ys[0]];
    ys.forEach((y) => { if (y <= fy) v = table[y]; });
    return v;
  };
  const rollback = (kind, fy) => latest(kind === 'ag' ? RULES.agRollback : RULES.residentialRollback, fy);
  const heldRollback = (fy) => fy > Math.max(...Object.keys(RULES.residentialRollback).map(Number));

  /** taxable value of a homestead in a fiscal year: assessed × rollback, less the homestead benefit (and 65+ if asked) */
  function homeTaxable(value, fy, senior) {
    const t = value * rollback('res', fy);
    let ex = fy <= RULES.homesteadCreditLastFY ? RULES.homesteadCreditValue
      : Math.min(RULES.homesteadMax, Math.max(RULES.homesteadMin, RULES.homesteadPct * t));
    if (senior) ex += RULES.seniorExemption;
    return Math.max(0, t - ex);
  }

  /** the scenario's added levy, year by year, and what it costs taxpayers */
  function impact(cfg, L, tax) {
    const val0 = Number(tax && tax.valuation) || 0, home = Number(tax && tax.homeValue) || 150000, acre = Number(tax && tax.agPerAcre) || 0;
    const s = cfg.settings, vp = s.vppel || {};
    const newVppel = vp.status === 'proposed' && L.vppel;
    const years = cfg.years.map((fy, y) => {
      const go = (L.fin || []).filter((f) => f.repay === 'levy' && fy > f.fy && fy <= f.fy + f.years).reduce((a, f) => a + E.pmt(f.amount, f.rate, f.years), 0);
      const vpp = newVppel && fy >= cfg.vFirst && fy <= cfg.vLast ? cfg.vAnnual : 0;
      const added = go + vpp;
      const valuation = val0 * Math.pow(1 + (L.pg || 0), y);
      const rate = valuation > 0 ? added / (valuation / 1000) : null;
      const r = rate || 0;
      return { fy, go, vppel: vpp, added, valuation, rate,
        home: rate == null ? null : homeTaxable(home, fy, false) / 1000 * r,
        home65: rate == null ? null : homeTaxable(home, fy, true) / 1000 * r,
        acre: rate == null || !acre ? null : acre * rollback('ag', fy) / 1000 * r,
        farm100k: rate == null ? null : 100000 * rollback('ag', fy) / 1000 * r,
        held: heldRollback(fy) };
    });
    const taxed = years.filter((x) => x.added > 0.5);
    const peak = taxed.reduce((a, x) => (!a || (x.home || 0) > (a.home || 0) ? x : a), null);
    return {
      years, taxed, peak, homeValue: home, agPerAcre: acre, hasValuation: val0 > 0, newVppel: !!newVppel,
      hasGO: (L.fin || []).some((f) => f.repay === 'levy'),
      totalAdded: taxed.reduce((a, x) => a + x.added, 0),
    };
  }

  return { RULES, rollback, homeTaxable, impact };
});
