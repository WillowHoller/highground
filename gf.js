/* HighGround — the General Fund forecast (Iowa school finance, simplified for planning).
   Rules (checked 10 Oct 2026; sources and status in the HighGround Validation Record, rules G1–G6):
     State cost per pupil FY2018–FY2027 (LSA); FY2027 2% SSA, $8,148 (2026 Iowa Acts SF 2201). SSA adds the same dollar amount
       to every district's cost per pupil (Iowa Code 257.10(2)); the enacted dollar increase is used when known.
     Solvency ratio = (unassigned + assigned General Fund balance) ÷ (General Fund revenue − AEA flowthrough)   [ISFIS]
     Authorized budget = combined district cost + miscellaneous income + prior year's unspent balance; spending authority is the
       lesser of that and the certified budget (257.7(1)). Unspent balance = authority − General Fund spending.
     What carries into next year's authority is capped (SF 2472 Sec. 84, 257.7(3), from FY2027): the lesser of the unspent balance and
       35% of authorized expenditures two years earlier. The School Budget Review Committee can allow more on request.
       Years before the plan starts are estimated from the first year's authority, less state supplemental aid.
     Budget guarantee (257.14): regular program at least 101% of the base year's regular program district cost, not counting the base
       year's own guarantee (it does not compound). The board opts in each year (gfi.guarantee_optin, default on). FY2027's is paid by
       state aid rather than property tax (SF 2201 Div III); revenue is the same, the levy is not.
     Budget enrollment: from FY2028 the average of the 1 October count and the 15 January adjusted count (SF 2201; gfi.jan_change =
       expected January count vs October, default 0).
   Revenue  = budget enrollment × district cost per pupil, with the guarantee, + other state formula funding (grows with SSA)
              + miscellaneous income (grows at its own rate).
   Spending = Σ staff groups: FTE × (average salary × (1 + benefits %) + health insurance per FTE); salaries grow with settlement less
              turnover savings, health with health-insurance growth; FTE change with enrollment if chosen
              + non-staff spending (grows with inflation) + the plan's yearly General Fund costs.
   Likely range: solvency ± the 10th–90th percentile miss in the history replay, by years ahead (RULES.band).
   Planning estimates, not the state's official calculation. Pure; tested by gf_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGGF = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* Iowa rules (checked 10 Oct 2026; see the HighGround Validation Record, rules G1–G6):
     scpp: state cost per pupil by fiscal year (LSA; FY2027 from SF 2201). ssa: enacted state supplemental aid, used instead of the
     assumption. SSA adds the same DOLLAR amount to every district's cost per pupil (Iowa Code 257.10(2)), so a district above
     the state cost per pupil grows by that amount, not by the percent. guarantee: 101% of the base year's regular program
     district cost, not counting that year's own guarantee (257.14); the board opts in each year; FY2027's is paid by state aid
     (SF 2201 Div III). enrollmentAvgFrom: from FY2028 budget enrollment is the average of the 1 October and 15 January counts
     (SF 2201, 257.6). uabCap: 35% of authorized expenditures two years earlier (SF 2472 Sec. 84, 257.7(3)). */
  const RULES = { checked: '2026-10-10', scpp: { 2018: 6664, 2019: 6736, 2020: 6880, 2021: 7048, 2022: 7227, 2023: 7413, 2024: 7635, 2025: 7826, 2026: 7988, 2027: 8148 },
    ssa: { 2027: 0.02 }, guarantee: 1.01, guaranteeStatePaid: [2027], enrollmentAvgFrom: 2028,
    solvencyTarget: [0.05, 0.10], unspentTarget: [0.05, 0.15], uabCap: 0.35, uabCapFrom: 2027,
    /* the likely range: where actual solvency landed around the forecast in the history replay (Iowa CAR actuals, 325 districts,
       forecasts started from FY2020 and FY2021 with the default assumptions; 650 district-forecasts a year ahead, 325 five years
       ahead). 10th and 90th percentile of (actual − forecast), as solvency points, by years ahead. Held out of sample, a band built
       from one start year covered 68–82% of the other start year's outcomes. */
    band: { 1: [-0.062, 0.062], 2: [-0.116, 0.130], 3: [-0.191, 0.194], 4: [-0.271, 0.255], 5: [-0.246, 0.389] }, bandSource: 'HighGround history replay, 10 Oct 2026' };

  /** inputs: settings.gf_inputs (see demo); a: { ssa, enroll, settle, health, inflation }; extraByFY: plan's yearly General Fund costs */
  function forecast(gfi, a, years, extraByFY) {
    const g = gfi || {}, out = [];
    const groups = (g.staff || []).map((s) => ({ name: s.name, fte: Number(s.fte) || 0, salary: Number(s.salary) || 0, benefits: s.benefits == null ? 0.1709 : Number(s.benefits), health: Number(s.health) || 0 }));
    let enroll = Number(g.enrollment) || 0, dcpp = Number(g.dcpp) || RULES.scpp[2027];
    let scpp = RULES.scpp[years[0]] || dcpp;   // the state cost per pupil the SSA dollars are figured on
    let other = Number(g.other_formula) || 0, misc = Number(g.misc_income) || 0, nonstaff = Number(g.nonstaff) || 0;
    let balance = Number(g.fund_balance) || 0, unspent = Number(g.unspent) || 0, prevFormula = null, prevAuthorized = null, certified = Number(g.certified_budget) || null;
    const optIn = g.guarantee_optin !== false, janChange = Number(g.jan_change) || 0;
    const auth = {};   // authorized expenditures by fiscal year, for the carry-forward cap two years later
    const baseEnroll = enroll, ssaFor = (fy) => (RULES.ssa[fy] != null && a.useEnacted !== false ? RULES.ssa[fy] : a.ssa);
    years.forEach((fy, i) => {
      if (i > 0) {
        const ssa = ssaFor(fy);
        const enacted = a.useEnacted !== false && RULES.scpp[fy] != null && RULES.scpp[fy - 1] != null && RULES.ssa[fy] != null;
        const add = enacted ? RULES.scpp[fy] - RULES.scpp[fy - 1] : scpp * ssa;   // the enacted dollar increase when known
        scpp += add; dcpp += add; other *= 1 + ssa; misc *= 1 + (g.misc_growth == null ? DEFAULTS.misc_growth : Number(g.misc_growth));
        enroll *= 1 + (a.enroll || 0); nonstaff *= 1 + (a.inflation || 0);
        // salaries grow with the settlement, less turnover savings (experienced staff replaced by newer staff on lower pay)
        groups.forEach((s) => { s.salary *= 1 + (a.settle || 0) - (Number(g.turnover_savings) || 0); s.health *= 1 + (a.health || 0); if (g.fte_follow_enrollment) s.fte = s.fte * (1 + (a.enroll || 0)); });
      }
      /* budget enrollment: from FY2028 the average of the October count and the January adjusted count */
      const budgetEnroll = fy >= RULES.enrollmentAvgFrom ? enroll * (1 + janChange / 2) : enroll;
      const formulaRegular = budgetEnroll * dcpp;
      const floor = prevFormula == null || !optIn ? 0 : prevFormula * RULES.guarantee;   // 101% of last year's formula cost, without its guarantee
      const regular = Math.max(formulaRegular, floor);
      const guarantee = regular - formulaRegular;
      prevFormula = formulaRegular;
      const revenue = regular + other + misc;
      const staff = groups.reduce((t, s) => t + s.fte * (s.salary * (1 + s.benefits) + s.health), 0);
      const salaries = groups.reduce((t, s) => t + s.fte * s.salary, 0);
      const extra = (extraByFY && extraByFY[fy]) || 0;
      const spending = staff + nonstaff + extra;
      /* the unspent balance carried in is capped at 35% of authorized expenditures two years before */
      let look = auth[fy - 2];
      if (look == null) {   // before the plan starts: this year's base (or the first year's authority), less a year of state aid growth per year back
        const known = auth[fy - 1], g1 = 1 + (RULES.ssa[years[0]] != null ? RULES.ssa[years[0]] : (a.ssa || 0.02));
        look = known != null ? known / g1 : (regular + other + misc + unspent) / (g1 * g1);
      }
      const cap = fy >= RULES.uabCapFrom && !a.noUabCap ? RULES.uabCap * look : Infinity;
      const carried = unspent > 0 ? Math.min(unspent, cap) : unspent, lost = unspent > 0 ? unspent - carried : 0;
      /* spending authority is the lesser of the authorized budget and the certified budget (257.7(1)); a certified budget
         entered for the first year is assumed to move with the authorized budget after that */
      const authorized = regular + other + misc + carried;
      if (certified != null && prevAuthorized != null && prevAuthorized > 0) certified *= authorized / prevAuthorized;
      prevAuthorized = authorized;
      const authority = certified != null ? Math.min(authorized, certified) : authorized;
      auth[fy] = authority;
      balance = balance + revenue - spending;
      unspent = authority - spending;
      const aea = (Number(g.aea_flowthrough) || 0);
      const solvency = revenue - aea > 0 ? balance / (revenue - aea) : null, b = RULES.band[i];
      out.push({ fy, enrollment: enroll, budgetEnrollment: budgetEnroll, dcpp, regular, guarantee, guaranteeStatePaid: guarantee > 0.5 && RULES.guaranteeStatePaid.includes(fy),
        other, misc, revenue, staff, salaries, nonstaff, extra, spending, net: revenue - spending,
        balance, solvency, solvencyLow: solvency != null && b ? solvency + b[0] : solvency, solvencyHigh: solvency != null && b ? solvency + b[1] : solvency,
        authorized, certified, authority, carried, uabLost: lost, unspent, unspentRatio: authority > 0 ? unspent / authority : null,
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
      /* below 5% even at the top of the likely range ("likely"), or only at its bottom ("could"). In the replay the point forecast
         alone flagged 33 districts two years out that stayed above 5%; the top of the range flagged 10. */
      lowSolvencyLikely: lt('solvencyHigh', RULES.solvencyTarget[0]).map((y) => y.fy),
      lowSolvencyPossible: lt('solvencyLow', RULES.solvencyTarget[0]).map((y) => y.fy),
      negativeUnspent: lt('unspent', 0).map((y) => y.fy),
      lowUnspent: lt('unspentRatio', RULES.unspentTarget[0]).map((y) => y.fy),
      guarantee: out.filter((y) => y.guarantee > 0.5).map((y) => y.fy),
      guaranteeStatePaid: out.filter((y) => y.guaranteeStatePaid).map((y) => y.fy),
      uabCap: out.filter((y) => y.uabLost > 0.5).map((y) => y.fy),
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
  const DEFAULTS = { ssa: 0.02, enroll: -0.005, settle: 0.025, health: 0.08, inflation: 0.025, misc_growth: 0.01 };
  /**
   * A staff list (from payroll: one row per person or position) → staff groups for the General Fund setup.
   * rows: spreadsheet rows, headings first. Needs a Group column and FTE / Annual salary; health insurance (the district's
   * yearly contribution) is optional. Averages are per FTE: total salary ÷ total FTE, so part-time people count fairly.
   * Returns { groups: [{ name, fte, salary, health, people }], people, issues: [text] }.
   */
  function roster(rows) {
    const issues = [];
    const norm = (h) => String(h == null ? '' : h).trim().toLowerCase();
    const head = (rows[0] || []).map(norm);
    const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
    const cG = find(/group|category|classification|type/), cF = find(/\bfte\b|full.?time/), cS = find(/salary|wage|pay/, /health|insurance/), cH = find(/health|insurance|medical/);
    if (cG < 0 || cS < 0) return { groups: [], people: 0, issues: ['Use the template’s headings: it needs a Group column and an Annual salary column.'] };
    const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isNaN(x) ? null : x; };
    const by = new Map(); let people = 0;
    rows.slice(1).forEach((r, i) => {
      if (!r || !r.some((x) => String(x == null ? '' : x).trim() !== '')) return;
      const g = String(r[cG] == null ? '' : r[cG]).trim().replace(/\s+/g, ' ');
      if (!g) { issues.push(`Row ${i + 2}: no group, left out.`); return; }
      const fte = cF < 0 || num(r[cF]) == null ? 1 : num(r[cF]), sal = num(r[cS]), hl = cH < 0 ? 0 : num(r[cH]) || 0;
      if (sal == null) { issues.push(`Row ${i + 2}: no salary, left out.`); return; }
      if (!(fte > 0) || fte > 2) { issues.push(`Row ${i + 2}: FTE ${r[cF]} looks wrong, left out.`); return; }
      const k = g.toLowerCase(), x = by.get(k) || { name: g.charAt(0).toUpperCase() + g.slice(1), fte: 0, sal: 0, health: 0, people: 0 };
      x.fte += fte; x.sal += sal; x.health += hl; x.people++; by.set(k, x); people++;
    });
    const groups = [...by.values()].map((x) => ({ name: x.name, people: x.people, fte: Math.round(x.fte * 100) / 100,
      salary: Math.round(x.sal / x.fte), health: Math.round(x.health / x.fte) }));
    return { groups, people, issues };
  }
  const ROSTER_TEMPLATE = [['Position or name (optional)', 'Group', 'FTE', 'Annual salary', 'District health insurance contribution (annual)'],
    ['3rd grade teacher', 'Teachers', 1, 52000, 13200], ['Art teacher (half time)', 'Teachers', 0.5, 26000, 0],
    ['Special education paraeducator', 'Paraeducators', 1, 27000, 9600], ['Head custodian', 'Support staff', 1, 41000, 13200],
    ['High school principal', 'Administrators', 1, 112000, 13200]];

  /** staff groups whose benefits % looks like it already includes health insurance while health per FTE is also entered */
  function healthTwice(staff) {
    return (staff || []).filter((x) => Number(x.benefits) > 0.24 && Number(x.health) > 0).map((x) => x.name || 'Staff');
  }
  /** the first year's staff cost from the staff groups: salaries, benefits besides health, health */
  function staffCost(staff) {
    const t = { salaries: 0, benefits: 0, health: 0 };
    (staff || []).forEach((x) => { const f = Number(x.fte) || 0, sal = Number(x.salary) || 0; t.salaries += f * sal; t.benefits += f * sal * (x.benefits == null ? 0.1709 : Number(x.benefits)); t.health += f * (Number(x.health) || 0); });
    t.total = t.salaries + t.benefits + t.health; return t;
  }

  return { RULES, DEFAULTS, forecast, fromBudget, roster, ROSTER_TEMPLATE, healthTwice, staffCost };
});
