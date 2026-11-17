/* HighGround — what a scenario means for taxpayers (Iowa rules below; other states in STATE_TAX, keyed by the pack's tax).
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
  /* Nebraska [verified 12 Nov 2026]: rates are per $100 of taxable value. Homes are taxed at their assessed value; agricultural
     land at 75% of actual value, and 50% for school bond levies approved by voters on or after 1 Jan 2022 (77-201(2)).
     The School District Property Tax Relief Credit (LB 34, 2024; 77-7305; Department of Revenue Directive 25-4) pays a fixed
     statewide amount toward each parcel's school taxes, in proportion to them. It covers General Fund, Special Building and
     QCPUF levies, not bond levies or voter-approved overrides (77-3444). So an added QCPUF levy costs a taxpayer about
     (1 − the credit's share) of the levy, and a bond levy costs all of it. The share: $780 million for 2025 ÷ $2,976 million
     of non-bond school taxes levied in 2025 (DOR 2025 annual report, table 3D) = 26.2%; a county's share depends on its
     school taxes the year before, so the district can enter its own. The Property Tax Credit (77-4209 to 77-4212) is set per
     $ of value, so a school levy doesn't change it. Homestead exemptions depend on income, age or disability: not shown. */
  const STATE_TAX = {
    NE: { checked: '2026-11-12', per: 100, homeShare: 1, agShare: 0.75, agBondShare: 0.50, status: 'verified',
      credit: { share: 0.262, name: 'School District Property Tax Relief Credit', cite: 'Neb. Rev. Stat. 77-7305', bonds: false,
        basis: '$780 million for 2025 ÷ $2.98 billion of non-bond school taxes levied statewide in 2025', fund: { 2024: 750e6, 2025: 780e6, 2026: 808e6, 2027: 838e6, 2028: 870e6, 2029: 902e6 } } },
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
    const T = cfg && STATE_TAX[cfg.state];
    if (T) return impactFlat(cfg, L, tax, T);
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

  /* a state with flat assessment shares (no rollback table): rate = added levy ÷ (valuation ÷ per) */
  function impactFlat(cfg, L, tax, T) {
    const val0 = Number(tax && tax.valuation) || 0, home = Number(tax && tax.homeValue) || 150000, acre = Number(tax && tax.agPerAcre) || 0;
    const vp = cfg.settings.vppel || {}, newVppel = vp.status === 'proposed' && L.vppel;
    const cs0 = tax && tax.creditShare != null && !isNaN(Number(tax.creditShare)) ? Math.max(0, Math.min(0.9, Number(tax.creditShare))) : null;
    const credit = T.credit ? Object.assign({}, T.credit, cs0 != null ? { share: cs0, own: true } : {}) : null;
    const years = cfg.years.map((fy, y) => {
      const go = (L.fin || []).filter((f) => f.repay === 'levy' && fy > f.fy && fy <= f.fy + f.years).reduce((a, f) => a + E.pmt(f.amount, f.rate, f.years), 0);
      const vpp = newVppel && fy >= cfg.vFirst && fy <= cfg.vLast ? cfg.vAnnual : 0;
      /* a levy override (Nebraska 77-3444): what it lets Special Building raise above the plan without it; no school tax credit */
      const Lp = Object.assign({}, L, { pg: L.pg || 0 });
      const ovr = cfg.lid && cfg.lid.override && E.lidRoom ? Math.max(0, E.lidRoom(cfg, y, Lp).receipts - E.lidRoom(Object.assign({}, cfg, { lid: Object.assign({}, cfg.lid, { override: null }) }), y, Lp).receipts) : 0;
      const added = go + vpp + ovr, valuation = val0 * Math.pow(1 + (L.pg || 0), y);
      const rate = valuation > 0 ? added / (valuation / T.per) : null, r = rate || 0;
      const goRate = valuation > 0 ? go / (valuation / T.per) : 0, oRate = valuation > 0 ? ovr / (valuation / T.per) : 0, vRate = r - goRate - oRate;
      const agOn = (v) => v / T.per * (goRate * T.agBondShare + (vRate + oRate) * T.agShare);   // bonds and other levies tax farmland at different shares
      const h = rate == null ? null : home * T.homeShare / T.per * r;
      /* after the state's school tax credit: the non-bond part of the added levy costs (1 − share) of it */
      const cs = credit ? credit.share : 0, keep = (v) => (v == null ? null : v);
      const hNet = rate == null ? null : home * T.homeShare / T.per * (goRate + oRate + vRate * (1 - cs));
      const agNet = (v) => v / T.per * (goRate * T.agBondShare + (oRate + vRate * (1 - cs)) * T.agShare);
      return { fy, go, vppel: vpp, override: ovr, added, valuation, rate, home: h, home65: h,
        acre: rate == null || !acre ? null : agOn(acre), farm100k: rate == null ? null : agOn(100000), held: false,
        homeNet: keep(hNet), farm100kNet: rate == null ? null : agNet(100000), acreNet: rate == null || !acre ? null : agNet(acre),
        creditPaid: vpp * cs };
    });
    const taxed = years.filter((x) => x.added > 0.5);
    const peak = taxed.reduce((a, x) => (!a || (x.home || 0) > (a.home || 0) ? x : a), null);
    return { years, taxed, peak, homeValue: home, agPerAcre: acre, hasValuation: val0 > 0, newVppel: !!newVppel,
      hasGO: (L.fin || []).some((f) => f.repay === 'levy'), hasOverride: years.some((x) => x.override > 0.5), totalAdded: taxed.reduce((a, x) => a + x.added, 0), per: T.per, state: cfg.state, credit };
  }

  return { RULES, STATE_TAX, rollback, homeTaxable, impact };
});
