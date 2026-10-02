/* HighGround — budget vs. actual vs. forecast, from a month-end GL import.
   Iowa school fiscal year: 1 July – 30 June. Share of the year gone = whole months since 1 July ÷ 12.
   Forecast (full year):
     budget   = the budget, unless already exceeded (spending: actual + encumbered; revenue: received)   (default)
     pace     = actual so far + budget × share of the year still to come                                 (steady items)
     straight = actual so far ÷ share of the year gone                                                   (this year's pace, extended)
   Pure; tested by budget_test.js. */
(function (root, factory) {
  const G = root.HGGL || (typeof require === 'function' ? require('./gl.js') : null);
  const api = factory(G);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGBudget = api;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const FUNCTION_NAME = { '1': 'Instruction', '2': 'Support services', '3': 'Noninstructional programs', '4': 'Facilities acquisition and construction',
    '5': 'Debt service', '6': 'Other financing uses' };
  const SUPPORT_NAME = { '21': 'Student support', '22': 'Instructional staff support', '23': 'General administration', '24': 'School administration',
    '25': 'Business and central services', '26': 'Operation and maintenance of plant', '27': 'Student transportation', '29': 'Other support' };

  /** share of the fiscal year gone at a month-end date */
  function elapsed(periodEnd) {
    const d = new Date(String(periodEnd) + 'T12:00:00');
    const monthsSinceJuly = (d.getMonth() - 6 + 12) % 12 + 1;   // July → 1 … June → 12
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === lastDay ? monthsSinceJuly / 12 : (monthsSinceJuly - 1 + d.getDate() / lastDay) / 12;
  }
  function forecast(actual, budget, gone, method, committed) {
    if (method === 'straight') return gone > 0 ? actual / gone : actual;
    if (method === 'pace') return actual + (budget || 0) * (1 - gone);
    return Math.max(budget || 0, committed == null ? actual : committed);
  }
  const fundKey = (a) => (a.mapped_fund && a.mapped_fund !== 'other' ? a.mapped_fund : 'f' + (a.fund_code || '??'));
  const fundName = (k) => (k.startsWith('f') ? `Fund ${k.slice(1)}` : (G && G.FUND_NAME[k]) || k);
  function functionGroup(code) {
    const c = String(code || ''), d1 = c[0], d2 = c.slice(0, 2);
    if (d1 === '2' && SUPPORT_NAME[d2]) return { key: d2, name: SUPPORT_NAME[d2] };
    if (FUNCTION_NAME[d1]) return { key: d1, name: FUNCTION_NAME[d1] };
    return { key: 'x', name: 'Not coded by function' };
  }
  const blank = () => ({ budget: 0, actual: 0, encumbered: 0, accounts: 0 });

  function summarize(accounts, amounts, periodEnd, method) {
    const gone = elapsed(periodEnd), acc = new Map((accounts || []).map((a) => [a.id, a])), funds = {};
    (amounts || []).forEach((g) => {
      const a = acc.get(g.account_id); if (!a) return;
      const kind = a.maps_to === 'revenue' ? 'revenue' : a.maps_to === 'expense' || a.maps_to === 'initiative' ? 'spending' : null; if (!kind) return;
      const k = fundKey(a), f = (funds[k] = funds[k] || { key: k, name: fundName(k), revenue: blank(), spending: blank(), byFunction: {} });
      const sign = a.sign || 1, add = (o) => { o.budget += (Number(g.budget_amount) || 0) * sign; o.actual += (Number(g.ytd_amount) || 0) * sign; o.encumbered += (Number(g.encumbered) || 0) * sign; o.accounts++; };
      add(f[kind]);
      if (kind === 'spending') { const grp = functionGroup(a.function_code); add(f.byFunction[grp.key] = f.byFunction[grp.key] || Object.assign(blank(), { name: grp.name })); }
    });
    const finish = (o, isSpending) => {
      const fc = forecast(o.actual, o.budget, gone, method, isSpending ? o.actual + o.encumbered : o.actual);
      return Object.assign(o, { forecast: fc, variance: fc - o.budget,
        used: o.budget ? (o.actual + (isSpending ? o.encumbered : 0)) / o.budget : null, available: isSpending ? o.budget - o.actual - o.encumbered : null });
    };
    Object.values(funds).forEach((f) => { finish(f.revenue, false); finish(f.spending, true); Object.values(f.byFunction).forEach((x) => finish(x, true)); });
    const order = ['general', 'save', 'ppel', 'vppel', 'grants', 'debt_levy'];
    const list = Object.values(funds).sort((x, y) => ((order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99)) || x.name.localeCompare(y.name));
    return { gone, method, funds: list, hasBudget: list.some((f) => f.revenue.budget || f.spending.budget) };
  }

  /** two month-end imports side by side, by fund: received, spent, encumbered, and the change from the earlier to the later */
  function compareMonths(accounts, amountsEarly, amountsLate, early, late) {
    const A = summarize(accounts, amountsEarly, early.period_end, 'budget'), Bm = summarize(accounts, amountsLate, late.period_end, 'budget');
    const keys = [...new Set(A.funds.map((f) => f.key).concat(Bm.funds.map((f) => f.key)))];
    const pick = (S, k) => S.funds.find((f) => f.key === k);
    const rows = keys.map((k) => {
      const a = pick(A, k), b = pick(Bm, k), v = (f, kind, field) => (f ? f[kind][field] : 0);
      const line = (kind, field) => ({ early: v(a, kind, field), late: v(b, kind, field), change: v(b, kind, field) - v(a, kind, field) });
      return { key: k, name: (b || a).name, received: line('revenue', 'actual'), spent: line('spending', 'actual'), encumbered: line('spending', 'encumbered') };
    });
    const order = ['general', 'save', 'ppel', 'vppel', 'grants', 'debt_levy'];
    rows.sort((x, y) => ((order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99)) || x.name.localeCompare(y.name));
    return { rows, sameYear: (early.fiscal_year || 0) === (late.fiscal_year || 0) };
  }

  /** is the ledger current? A month's close is usually ready about 6 weeks after it ends. */
  function ledgerStatus(latestPeriodEnd, today) {
    if (!latestPeriodEnd) return { has: false };
    const end = new Date(latestPeriodEnd + 'T12:00:00'), now = today ? new Date(today + 'T12:00:00') : new Date();
    const days = Math.round((now - end) / 86400000);
    const next = new Date(end.getFullYear(), end.getMonth() + 2, 0);   // the following month-end
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { has: true, days, stale: days > 45, nextMonthEnd: iso(next) };
  }

  return { elapsed, forecast, functionGroup, summarize, compareMonths, ledgerStatus };
});
