/* HighGround — the General Fund forecast (Iowa school finance, simplified for planning).
   Sources (checked 1 Oct 2026):
     FY2027 state supplemental aid 2%, state cost per pupil $8,148 (from $7,988): 2026 Iowa Acts SF 2201, signed 26 Feb 2026.
     Solvency ratio = (unassigned + assigned General Fund balance) ÷ (General Fund revenue − AEA flowthrough)   [ISFIS, IASB]
     Spending authority = combined district cost + miscellaneous income + prior year's unspent balance         [IASB glossary]
     Unspent balance = authority − General Fund spending; carries over. Unspent balance ratio = unspent ÷ authority.
     Budget guarantee (budget adjustment): regular program funding of at least 101% of the prior year's.
   Revenue  = enrollment (prior-year certified) × district cost per pupil (grows with state supplemental aid), with the 101% guarantee,
              + other state formula funding (grows with state supplemental aid) + miscellaneous income (grows at its own rate).
   Spending = Σ staff groups: FTE × (average salary × (1 + benefits %) + health insurance per FTE); salaries grow with settlement less turnover savings,
              health with health-insurance growth; FTE change with enrollment if chosen
              + non-staff spending (grows with inflation) + the plan's yearly General Fund costs.
   Combined district cost (for authority) ≈ regular program + other state formula funding.
   Planning estimates, not the state's official calculation. Pure; tested by gf_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGGF = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RULES = { checked: '2026-10-01', scpp: { 2026: 7988, 2027: 8148 }, ssa: { 2027: 0.02 }, guarantee: 1.01, solvencyTarget: [0.05, 0.10], unspentTarget: [0.05, 0.15] };

  /** inputs: settings.gf_inputs (see demo); a: { ssa, enroll, settle, health, inflation }; extraByFY: plan's yearly General Fund costs */
  function forecast(gfi, a, years, extraByFY) {
    const g = gfi || {}, out = [];
    const groups = (g.staff || []).map((s) => ({ name: s.name, fte: Number(s.fte) || 0, salary: Number(s.salary) || 0, benefits: s.benefits == null ? 0.1709 : Number(s.benefits), health: Number(s.health) || 0 }));
    let enroll = Number(g.enrollment) || 0, dcpp = Number(g.dcpp) || RULES.scpp[2027];
    let other = Number(g.other_formula) || 0, misc = Number(g.misc_income) || 0, nonstaff = Number(g.nonstaff) || 0;
    let balance = Number(g.fund_balance) || 0, unspent = Number(g.unspent) || 0, prevRegular = null;
    const baseEnroll = enroll, ssaFor = (fy) => (RULES.ssa[fy] != null && a.useEnacted !== false ? RULES.ssa[fy] : a.ssa);
    years.forEach((fy, i) => {
      if (i > 0) {
        const ssa = ssaFor(fy);
        dcpp *= 1 + ssa; other *= 1 + ssa; misc *= 1 + (g.misc_growth == null ? 0.01 : Number(g.misc_growth));
        enroll *= 1 + (a.enroll || 0); nonstaff *= 1 + (a.inflation || 0);
        // salaries grow with the settlement, less turnover savings (experienced staff replaced by newer staff on lower pay)
        groups.forEach((s) => { s.salary *= 1 + (a.settle || 0) - (Number(g.turnover_savings) || 0); s.health *= 1 + (a.health || 0); if (g.fte_follow_enrollment) s.fte = s.fte * (1 + (a.enroll || 0)); });
      }
      const formulaRegular = enroll * dcpp;
      const regular = prevRegular == null ? formulaRegular : Math.max(formulaRegular, prevRegular * RULES.guarantee);
      const guarantee = regular - formulaRegular;
      prevRegular = regular;
      const revenue = regular + other + misc;
      const staff = groups.reduce((t, s) => t + s.fte * (s.salary * (1 + s.benefits) + s.health), 0);
      const salaries = groups.reduce((t, s) => t + s.fte * s.salary, 0);
      const extra = (extraByFY && extraByFY[fy]) || 0;
      const spending = staff + nonstaff + extra;
      const authority = regular + other + misc + unspent;
      balance = balance + revenue - spending;
      unspent = authority - spending;
      const aea = (Number(g.aea_flowthrough) || 0);
      out.push({ fy, enrollment: enroll, dcpp, regular, guarantee, other, misc, revenue, staff, salaries, nonstaff, extra, spending, net: revenue - spending,
        balance, solvency: revenue - aea > 0 ? balance / (revenue - aea) : null, authority, unspent, unspentRatio: authority > 0 ? unspent / authority : null,
        staffShare: spending > 0 ? staff / spending : null });
    });
    // "new money" vs settlement: what the formula adds each year, beside what a 1% settlement and the assumed settlement cost
    out.forEach((y, i) => {
      if (!i) { y.newMoney = null; return; }
      const p = out[i - 1];
      y.newMoney = (y.regular + y.other) - (p.regular + p.other);
      y.settlementCost = p.salaries * (a.settle || 0) * (1 + (groups[0] ? groups[0].benefits : 0.1709));
      y.costPerPoint = p.salaries * 0.01 * (1 + (groups[0] ? groups[0].benefits : 0.1709));
      y.affordableSettlement = y.costPerPoint > 0 ? y.newMoney / y.costPerPoint / 100 : null;
    });
    const lt = (k, lim) => out.filter((y) => y[k] != null && y[k] < lim);
    return { years: out, flags: {
      lowSolvency: lt('solvency', RULES.solvencyTarget[0]).map((y) => y.fy),
      negativeUnspent: lt('unspent', 0).map((y) => y.fy),
      lowUnspent: lt('unspentRatio', RULES.unspentTarget[0]).map((y) => y.fy),
      guarantee: out.filter((y) => y.guarantee > 0.5).map((y) => y.fy),
      deficit: out.filter((y) => y.net < -0.5).map((y) => y.fy),
    }, baseEnroll };
  }

  /** starting figures from an adopted budget or a ledger's budget column (accounts with their budget amounts) */
  function fromBudget(lines) {
    // lines: [{ fund_code, object_code, account_type, budget }]
    const gf = lines.filter((l) => l.fund_code === '10' && l.budget != null);
    const rev = gf.filter((l) => l.account_type === 'revenue').reduce((t, l) => t + Number(l.budget), 0);
    const exp = gf.filter((l) => l.account_type === 'expenditure');
    const staff = exp.filter((l) => /^[12]/.test(String(l.object_code || ''))).reduce((t, l) => t + Number(l.budget), 0);
    const other = exp.filter((l) => !/^[12]/.test(String(l.object_code || ''))).reduce((t, l) => t + Number(l.budget), 0);
    return { revenue: rev, staff, nonstaff: other, total: staff + other };
  }

  /** the General Fund's own defaults, used when a scenario's assumption set leaves them blank */
  const DEFAULTS = { ssa: 0.0225, enroll: -0.005, settle: 0.025, health: 0.05, inflation: 0.02 };
  return { RULES, DEFAULTS, forecast, fromBudget };
});
