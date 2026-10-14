/* HighGround: the yearly holdback (one combined figure by default, or split into recurring dollars + a cushion), and tracking
   how much of it the ledger shows used. Run: node holdback_test.js */
const E = require('./engine.js'), C = require('./capital.js'), A = require('./actuals.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
const bal = [{ fund: 'save', as_of: '2026-06-30', amount: 500000 }, { fund: 'ppel', as_of: '2026-06-30', amount: 100000 }];
const row = (extra) => Object.assign({ plan_years: 10, save_receipts: 1000000, save_receipts_fy: 2026, ppel_receipts: 200000, vppel_status: 'none', sf2472: false }, extra);
const cfgOf = (extra) => E.makeConfig(C.settingsFromRows({ name: 'x' }, row(extra), bal, []).settings);
const L = (cfg) => E.defaultLevers(cfg);

// combined (the default): one figure, % of receipts or $ a year; a stale dollar amount is ignored when a % is set
let cfg = cfgOf({ save_ongoing: 99999, save_ongoing_pct: 0.15 });
check('combined %: holds back 15% of each year’s receipts, ignores the old dollars', near(E.ongoingIn(cfg, 'save', 2, L(cfg)), 0.15 * E.receiptsIn(cfg, 'save', 2, L(cfg))));
cfg = cfgOf({ save_ongoing: 150000 });
check('combined $: holds back the dollars', E.ongoingIn(cfg, 'save', 2, L(cfg)) === 150000);
// split: recurring dollars + a cushion share, both held back
cfg = cfgOf({ save_ongoing: 60000, save_ongoing_pct: 0.09, save_holdback_split: true });
check('split: recurring $ + cushion % are both held back', near(E.ongoingIn(cfg, 'save', 2, L(cfg)), 60000 + 0.09 * E.receiptsIn(cfg, 'save', 2, L(cfg))));
check('split flag reaches the settings', cfg.settings.save.split === true && cfgOf({}).settings.save.split === false);
// the same total either way, in the year the split was set up
const comb = cfgOf({ save_ongoing_pct: 0.15 }), split = cfgOf({ save_ongoing: 60000, save_ongoing_pct: 0.09, save_holdback_split: true });
check('switching combined → split keeps this year’s total when split from it', near(E.ongoingIn(comb, 'save', 0, L(comb)), E.ongoingIn(split, 'save', 0, L(split)), 1));
// a bigger holdback means less for projects, dollar for dollar
const c0 = cfgOf({ save_ongoing_pct: 0.10 }), c1 = cfgOf({ save_ongoing_pct: 0.20 });
check('holding back 10 points more takes exactly that off what projects can use', near(E.inflow(c0, 'save', 3, L(c0)) - E.inflow(c1, 'save', 3, L(c1)), 0.10 * E.receiptsIn(c0, 'save', 3, L(c0)), 1));
// Funding vs. committed counts the holdback in both modes
const K = C.commitments(L(split), split); let want = 0; split.years.forEach((fy, y) => { want += E.ongoingIn(split, 'save', y, L(split)) * (y === 0 ? split.f0 : 1); });
check('Funding vs. committed counts a split holdback', near(K.save.ongoing, want, 1));
// demo rows round trip a split
const demo = { settings: { plan: { startFY: 2027, years: 10 }, balances: { asOf: '2026-06-30', save: 1, ppel: 1, vppel: 0, grants: 0 }, save: { receipts: 1000000, ongoing: 60000, ongoingPct: 0.09, split: true },
  ppel: { receipts: 200000, ongoing: 40000 }, vppel: { status: 'none' }, grants: { avg: 0, yield: 0.75 }, debt: [] }, projects: [], scenarios: [] };
try { let n = 0; const r = C.demoRows(demo, 'd1', () => 'id' + (++n)); check('demo rows keep the split flag', r.district_settings[0].save_holdback_split === true && !('ppel_holdback_split' in r.district_settings[0])); }
catch (e) { check('demo rows keep the split flag', false, e.message); }

// tracking: unlinked spending in each capital fund against the holdback
const accounts = [
  { id: 'a1', code: '33-2600-730', description: 'Pottery wheel and kiln', maps_to: 'expense', mapped_fund: 'save', function_code: '2600', sign: 1 },
  { id: 'a2', code: '33-4600-450', description: 'Genesis addition', maps_to: 'initiative', initiative_id: 'i1', mapped_fund: 'save', function_code: '4600', sign: 1 },
  { id: 'a3', code: '33-5100-830', description: 'Revenue bond interest', maps_to: 'expense', mapped_fund: 'save', function_code: '5100', sign: 1 },
  { id: 'a4', code: '33-6100-930', description: 'Transfer to debt service', maps_to: 'expense', mapped_fund: 'save', function_code: '6100', sign: 1 },
  { id: 'a5', code: '33-4300-450', description: 'Parking lot lights', maps_to: 'expense', mapped_fund: 'save', function_code: '4300', sign: 1 },
  { id: 'a6', code: '36-2700-733', description: 'Bus', maps_to: 'expense', mapped_fund: 'ppel', function_code: '2700', sign: 1 },
  { id: 'a7', code: '10-1100-610', description: 'Supplies', maps_to: 'expense', mapped_fund: 'general', function_code: '1100', sign: 1 },
  { id: 'a8', code: '33-0000-1500', description: 'Interest', maps_to: 'revenue', mapped_fund: 'save', function_code: '', sign: 1 },
];
const amounts = [
  { account_id: 'a1', ytd_amount: 2926.87, encumbered: 0 }, { account_id: 'a2', ytd_amount: 393000, encumbered: 2000000 },
  { account_id: 'a3', ytd_amount: 50000, encumbered: 0 }, { account_id: 'a4', ytd_amount: 80000, encumbered: 0 },
  { account_id: 'a5', ytd_amount: 57125, encumbered: 4700 }, { account_id: 'a6', ytd_amount: 95000, encumbered: 0 },
  { account_id: 'a7', ytd_amount: 1e6, encumbered: 0 }, { account_id: 'a8', ytd_amount: 900, encumbered: 0 },
];
const H = A.holdbackUse(accounts, amounts, { save: 150000, ppel: 120000, vppel: 0 }, 0.25);
const sv = H.find((x) => x.fund === 'save'), pp = H.find((x) => x.fund === 'ppel');
check('used = unlinked spending + on order; leaves out linked projects, debt, transfers, revenue and other funds', near(sv.used, 2926.87 + 57125 + 4700), sv);
check('expected by now = held × share of the year gone', near(sv.expected, 37500));
check('ahead of pace is flagged', sv.status === 'ahead', sv.status);
check('unlinked building and site spending (function 4xxx) is called out', near(sv.facilities, 61825));
check('largest lines listed', sv.top[0].description === 'Parking lot lights' && sv.top.length === 2);
check('PPEL: on pace when used is near the expected', pp.status === 'over' || pp.status === 'ahead' || pp.status === 'pace');
check('PPEL over when used passes the year’s holdback', A.holdbackUse(accounts, amounts, { ppel: 90000 }, 0.25).find((x) => x.fund === 'ppel').status === 'over');
check('on pace', A.holdbackUse(accounts, amounts, { ppel: 400000 }, 0.25).find((x) => x.fund === 'ppel').status === 'pace');
check('nothing held back but spending: "none"', A.holdbackUse(accounts, amounts, {}, 0.25).find((x) => x.fund === 'ppel').status === 'none');
check('funds with nothing held and nothing spent are left out', !H.some((x) => x.fund === 'vppel'));
check('credits (negative signs) reduce what’s used', near(A.holdbackUse(accounts.map((a) => a.id === 'a5' ? Object.assign({}, a, { sign: -1 }) : a), amounts, { save: 150000 }, 0.5).find((x) => x.fund === 'save').used, 2926.87 - 61825));

console.log(`holdback tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
