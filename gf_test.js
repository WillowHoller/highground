/* HighGround General Fund forecast test. Run: node gf_test.js */
const F = require('./gf.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b, t) => Math.abs(a - b) < (t || 0.5);
const gfi = { enrollment: 1000, dcpp: 8148, other_formula: 2000000, misc_income: 1000000, misc_growth: 0, nonstaff: 2000000, fund_balance: 1500000, unspent: 1000000, aea_flowthrough: 0,
  staff: [{ name: 'Teachers', fte: 100, salary: 50000, benefits: 0.2, health: 10000 }] };
const a = { ssa: 0.02, enroll: 0, settle: 0.03, health: 0.05, inflation: 0 };
const R = F.forecast(gfi, a, [2027, 2028]), y1 = R.years[0], y2 = R.years[1];
// FY2027: regular 1,000 × 8,148 = 8,148,000; revenue 11,148,000; staff 100 × (50,000 × 1.2 + 10,000) = 7,000,000; spending 9,000,000
check('year one: revenue, spending, ending balance', near(y1.regular, 8148000) && near(y1.revenue, 11148000) && near(y1.staff, 7000000) && near(y1.spending, 9000000) && near(y1.balance, 3648000), y1);
check('year one: solvency = balance ÷ revenue (less AEA flowthrough)', near(y1.solvency, 3648000 / 11148000, 1e-9));
// authority = 8,148,000 + 2,000,000 + 1,000,000 + 1,000,000 = 12,148,000; unspent = 12,148,000 − 9,000,000
check('year one: spending authority and unspent balance', near(y1.authority, 12148000) && near(y1.unspent, 3148000) && near(y1.unspentRatio, 3148000 / 12148000, 1e-9));
// FY2028: cost per pupil × 1.02 = 8,310.96; salary 51,500, health 10,500 → staff 100 × (61,800 + 10,500) = 7,230,000
check('year two: cost per pupil and formula funding grow with state aid; staff with settlement and health', near(y2.dcpp, 8310.96, 1e-6) && near(y2.regular, 8310960) && near(y2.other, 2040000) && near(y2.staff, 7230000), y2);
// new money 202,960 vs a 3% settlement costing 5,000,000 × 3% × 1.2 = 180,000; each 1% costs 60,000 → about 3.4% affordable
check('new money vs settlement', near(y2.newMoney, 202960) && near(y2.settlementCost, 180000) && near(y2.costPerPoint, 60000) && near(y2.affordableSettlement, 0.033827, 1e-5), [y2.newMoney, y2.settlementCost, y2.affordableSettlement]);
check('unspent balance carries forward', near(y2.authority, 8310960 + 2040000 + 1000000 + 3148000));
// falling enrollment: the 101% budget guarantee
const G = F.forecast(gfi, Object.assign({}, a, { enroll: -0.05 }), [2027, 2028]).years[1];
// formula: 950 × 8,310.96 = 7,895,412; guarantee floor 1.01 × 8,148,000 = 8,229,480
check('budget guarantee: at least 101% of last year’s regular program', near(G.regular, 8229480) && near(G.guarantee, 8229480 - 7895412), G);
check('FY2027 uses the enacted 2% even if the assumption differs', near(F.forecast(gfi, Object.assign({}, a, { ssa: 0.05 }), [2026, 2027]).years[1].dcpp, 8148 * 1.02, 1e-6));
// flags: a district spending far more than it takes in
const poor = F.forecast(Object.assign({}, gfi, { fund_balance: 200000, unspent: 100000, nonstaff: 5000000 }), a, [2027, 2028, 2029]);
check('flags: deficits, low solvency, unspent balance below zero', poor.flags.deficit.length === 3 && poor.flags.lowSolvency.includes(2027) && poor.flags.negativeUnspent.includes(2028), poor.flags);
check('plan’s yearly General Fund costs are added to spending', near(F.forecast(gfi, a, [2027, 2028], { 2028: 75500 }).years[1].spending, 9230000 + 75500));
const T = F.forecast(Object.assign({}, gfi, { turnover_savings: 0.01 }), a, [2027, 2028]).years[1];
check('turnover savings: salaries grow by settlement less turnover (3% − 1%)', near(T.staff, 100 * (50000 * 1.02 * 1.2 + 10500)), T.staff);
check('enacted figures are recorded with their source date', F.RULES.scpp[2027] === 8148 && F.RULES.ssa[2027] === 0.02 && F.RULES.checked === '2026-10-01');
// starting figures from a budget
const b = F.fromBudget([{ fund_code: '10', account_type: 'revenue', budget: 12300000 }, { fund_code: '10', account_type: 'expenditure', object_code: '111', budget: 4820000 },
  { fund_code: '10', account_type: 'expenditure', object_code: '211', budget: 455000 }, { fund_code: '10', account_type: 'expenditure', object_code: '622', budget: 310000 }, { fund_code: '33', account_type: 'expenditure', object_code: '450', budget: 1 }]);
check('starting figures from a budget: General Fund only, staff (objects 1xx–2xx) vs other', b.revenue === 12300000 && b.staff === 5275000 && b.nonstaff === 310000, b);
console.log(`gf tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
