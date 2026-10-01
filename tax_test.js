/* HighGround tax impact test. Run: node tax_test.js */
const E = require('./engine.js'), T = require('./tax.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b) => Math.abs(a - b) < 0.01;
// homestead arithmetic, worked by hand
// FY2027: $150,000 × 44.5345% = $66,801.75; minus the $4,850 credit-as-value = $61,951.75
check('FY2027 home: rollback, then the $4,850 homestead credit', near(T.homeTaxable(150000, 2027), 61951.75), T.homeTaxable(150000, 2027));
// FY2028: 10% exemption on $66,801.75 = $6,680.18 → $60,121.58
check('FY2028 home: 10% homestead exemption', near(T.homeTaxable(150000, 2028), 60121.575), T.homeTaxable(150000, 2028));
check('exemption never below $5,500', near(T.homeTaxable(100000, 2028), 100000 * 0.445345 - 5500));
check('exemption never above $20,000', near(T.homeTaxable(600000, 2028), 600000 * 0.445345 - 20000));
check('65 and older: an extra $6,500 after the 10%', near(T.homeTaxable(150000, 2028, true), 60121.575 - 6500));
check('rollbacks held at the latest known year', T.rollback('res', 2031) === 0.445345 && T.rollback('ag', 2031) === 0.594401 && T.rollback('res', 2026) === 0.474316);
// a $4.2M, 20-year, 4.5% general-obligation bond issued FY2030 in a district with $727.27M taxable valuation, flat
const cfg = E.makeConfig({ balances: { asOf: '2026-07-01', save: 0, ppel: 0 }, save: { receipts: 0 }, ppel: { receipts: 0 }, plan: { years: 10 }, vppel: { status: 'none' } });
const L = E.leversOf({ pg: 0, fin: [{ name: 'Bond', kind: 'go', fy: 2030, amount: 4200000, rate: 0.045, years: 20 }] }, cfg);
const imp = T.impact(cfg, L, { valuation: 727272727, homeValue: 150000, agPerAcre: 2400 });
const pay = E.pmt(4200000, 0.045, 20), rate = pay / 727272.727;
const y31 = imp.years.find((x) => x.fy === 2031);
check('levy starts the year after the bond is issued', imp.years.find((x) => x.fy === 2030).added === 0 && near(y31.added, pay), y31.added);
check('rate = levy ÷ (valuation ÷ 1,000)', near(y31.rate, rate), y31.rate);
check('home cost = taxable value ÷ 1,000 × rate', near(y31.home, T.homeTaxable(150000, 2031) / 1000 * rate), y31.home);
check('farmland per acre uses the farmland rollback', near(y31.acre, 2400 * 0.594401 / 1000 * rate));
check('valuation growth lowers the rate over time', (() => { const g = T.impact(cfg, Object.assign({}, L, { pg: 0.03 }), { valuation: 727272727 }); return g.years[9].rate < g.years[4].rate; })());
// no added levy for SAVE revenue bonds, leases and campaigns
const L2 = E.leversOf({ fin: [{ name: 'R', kind: 'rev', fy: 2028, amount: 1e6, rate: 0.04, years: 10 }, { name: 'Lease', kind: 'lease', fy: 2028, amount: 2e5, rate: 0.05, years: 5 }, { name: 'Gift', kind: 'gift', fy: 2028, amount: 5e5 }] }, cfg);
check('SAVE bonds, leases and campaigns add no levy', T.impact(cfg, L2, { valuation: 1e8 }).taxed.length === 0);
// a proposed V-PPEL that's switched on adds a levy; an active one doesn't
const cfgP = E.makeConfig({ balances: { asOf: '2026-07-01' }, plan: { years: 10 }, vppel: { status: 'proposed', annual: 260000, firstFY: 2028, lastFY: 2037 } });
const onP = T.impact(cfgP, E.leversOf({ vppel: true }, cfgP), { valuation: 193939394 });
check('proposed V-PPEL switched on: an added levy from its first year', onP.newVppel && onP.years.find((x) => x.fy === 2027).added === 0 && onP.years.find((x) => x.fy === 2028).added === 260000);
check('proposed V-PPEL switched off: nothing added', T.impact(cfgP, E.leversOf({ vppel: false }, cfgP), { valuation: 1e8 }).taxed.length === 0);
const cfgA = E.makeConfig({ balances: { asOf: '2026-07-01' }, plan: { years: 10 }, vppel: { status: 'active', annual: 900000, firstFY: 2026, lastFY: 2035 } });
check('an active V-PPEL is already in place: not counted as new', T.impact(cfgA, E.leversOf({ vppel: true }, cfgA), { valuation: 1e8 }).taxed.length === 0);
check('without a valuation, no rate is invented', T.impact(cfg, L, {}).years.find((x) => x.fy === 2031).rate === null);
console.log(`FY2031 example: $${Math.round(pay).toLocaleString()} a year, $${rate.toFixed(4)} per $1,000, $${y31.home.toFixed(2)} a year for a $150,000 home, $${y31.acre.toFixed(2)} an acre`);
console.log(`tax tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
