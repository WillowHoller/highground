/* HighGround budget vs. actual test. Run: node budget_test.js */
const B = require('./budget.js'), G = require('./gl.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b) => Math.abs(a - b) < 0.01;
check('share of the year: 30 Sept = 3 of 12 months; 30 June = all; 15 July = half a month', B.elapsed('2026-09-30') === 0.25 && B.elapsed('2027-06-30') === 1 && near(B.elapsed('2026-07-15'), 15 / 31 / 12));
check('function groups: instruction, plant operation, transportation, debt service', B.functionGroup('1100').name === 'Instruction' && B.functionGroup('2600').name === 'Operation and maintenance of plant'
  && B.functionGroup('2700').name === 'Student transportation' && B.functionGroup('5100').name === 'Debt service' && B.functionGroup('').name === 'Not coded by function');
// the September sample
const P = G.parse(G.sampleExport());
const accounts = P.lines.map((l, k) => Object.assign({ id: 'a' + k, fund_code: l.parts.fund, function_code: l.parts.function || null }, G.suggest(l.parts)));
const amounts = P.lines.map((l, k) => ({ account_id: 'a' + k, ytd_amount: l.ytd, budget_amount: l.budget, encumbered: l.encumbered }));
const S = B.summarize(accounts, amounts, '2026-09-30', 'pace'), gen = S.funds.find((f) => f.key === 'general');
const S0 = B.summarize(accounts, amounts, '2026-09-30', 'budget'), save0 = S0.funds.find((f) => f.key === 'save');
check('default forecast: budget unless already exceeded, so front-loaded capital spending is not a false alarm', save0.spending.forecast === 638000 && save0.spending.variance === 0, save0.spending);
const over = B.summarize(accounts, amounts.map((x) => (x.account_id === 'a9' ? Object.assign({}, x, { ytd_amount: 500000 }) : x)), '2026-09-30', 'budget').funds.find((f) => f.key === 'save');
check('…but already spent plus encumbered past the budget is flagged', over.spending.forecast > 638000 && over.spending.variance > 0, over.spending);
check('General Fund first, then SAVE, PPEL, Debt Service', S.funds.map((f) => f.key).join() === 'general,save,ppel,debt_levy', S.funds.map((f) => f.key));
// revenue: budget 4,950,000 + 7,350,000 = 12,300,000; received 1,104,226.40 + 1,805,325 = 2,909,551.40
check('General Fund revenue: budget and received', near(gen.revenue.budget, 12300000) && near(gen.revenue.actual, 2909551.40));
// on pace: 2,909,551.40 + 12,300,000 × 0.75 = 12,134,551.40
check('forecast on pace with the budget', near(gen.revenue.forecast, 12134551.40) && near(gen.revenue.variance, -165448.60), gen.revenue.forecast);
// spending: budget 4,820,000 + 455,000 + 310,000 = 5,585,000; spent 804,230.44 + 76,403.90 + 71,144.02 = 951,778.36; encumbered 4,200
check('General Fund spending: budget, spent, encumbered, available', near(gen.spending.budget, 5585000) && near(gen.spending.actual, 951778.36) && near(gen.spending.encumbered, 4200) && near(gen.spending.available, 5585000 - 951778.36 - 4200));
check('by function: instruction and plant operation', near(gen.byFunction['1'].actual, 880634.34) && near(gen.byFunction['1'].budget, 5275000) && near(gen.byFunction['26'].encumbered, 4200));
const S2 = B.summarize(accounts, amounts, '2026-09-30', 'straight'), gen2 = S2.funds.find((f) => f.key === 'general');
check('straight-line forecast: so far ÷ share of the year gone', near(gen2.revenue.forecast, 2909551.40 / 0.25));
check('balances and ignored accounts are left out', !S.funds.some((f) => f.revenue.accounts + f.spending.accounts === 0) && S.funds.find((f) => f.key === 'save').spending.accounts === 3);
check('a missing budget column is noticed', !B.summarize(accounts, amounts.map((x) => Object.assign({}, x, { budget_amount: null })), '2026-09-30', 'pace').hasBudget);
// two months compared: August at half of September's amounts
const aug = amounts.map((x) => Object.assign({}, x, { ytd_amount: x.ytd_amount / 2, encumbered: 0 }));
const cm = B.compareMonths(accounts, aug, amounts, { period_end: '2026-08-31', fiscal_year: 2027 }, { period_end: '2026-09-30', fiscal_year: 2027 });
const cg = cm.rows.find((r) => r.key === 'general');
check('compare: received and spent in each month, and the change', near(cg.received.late, 2909551.40) && near(cg.received.early, 1454775.70) && near(cg.received.change, 1454775.70) && near(cg.spent.change, 951778.36 / 2) && cm.sameYear);
check('compare: months in different fiscal years are marked', !B.compareMonths(accounts, aug, amounts, { period_end: '2026-06-30', fiscal_year: 2026 }, { period_end: '2026-09-30', fiscal_year: 2027 }).sameYear);
// the ledger is current, or getting old
const st = B.ledgerStatus('2026-08-31', '2026-10-01'), old = B.ledgerStatus('2026-08-31', '2026-10-20');
check('ledger status: 31 days after August is current; 50 days is getting old; next month-end is 30 Sept', !st.stale && old.stale && old.nextMonthEnd === '2026-09-30' && !B.ledgerStatus(null).has, [st, old]);
console.log(`General Fund at 30 Sept: revenue ${Math.round(gen.revenue.actual).toLocaleString()} of ${gen.revenue.budget.toLocaleString()} (forecast ${Math.round(gen.revenue.forecast).toLocaleString()}); spending ${Math.round(gen.spending.actual).toLocaleString()} of ${gen.spending.budget.toLocaleString()}`);
console.log(`budget tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
