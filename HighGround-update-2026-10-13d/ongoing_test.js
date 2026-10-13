/* HighGround: ongoing SAVE / PPEL / V-PPEL commitments (13 Oct). Run: node ongoing_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const base = { balances: { asOf: '2026-06-30', save: 0, ppel: 0, vppel: 0, grants: 0 }, save: { receipts: 1000000, sf2472: false },
  ppel: { receipts: 200000 }, vppel: { status: 'active', annual: 400000, firstFY: 2027, lastFY: 2031 } };
const cfgOf = (vOng) => E.makeConfig(Object.assign({}, base, { vppel: Object.assign({}, base.vppel, { ongoing: vOng }) }));
const c0 = cfgOf(0), c1 = cfgOf(100000), L0 = E.defaultLevers(c0), L1 = E.defaultLevers(c1);
check('V-PPEL ongoing is read from the settings', c1.vppelOng === 100000 && c0.vppelOng === 0);
check('collected years: V-PPEL receipts net of its ongoing commitments', Math.abs(E.inflow(c1, 'vppel', 1, L1) - 300000) < 1, E.inflow(c1, 'vppel', 1, L1));
const after = c1.years.indexOf(2032);
check('after the levy ends nothing more comes out of V-PPEL', after > 0 && Math.abs(E.inflow(c1, 'vppel', after, L1)) < 1, E.inflow(c1, 'vppel', after, L1));
check('SAVE and PPEL untouched by a V-PPEL commitment', E.inflow(c0, 'save', 1, L0) === E.inflow(c1, 'save', 1, L1) && E.inflow(c0, 'ppel', 1, L0) === E.inflow(c1, 'ppel', 1, L1));
const K1 = C.commitments(L1, c1);
check('commitments: V-PPEL ongoing counted only in collected years (5 × $100k)', Math.abs(K1.vppel.ongoing - 500000) < 1, K1.vppel.ongoing);
const Lnov = Object.assign({}, L1, { vppel: false });
check('vote switched off in a what-if: no V-PPEL commitment either', C.commitments(Lnov, c1).vppel.ongoing === 0);
// round trip through the database row
const B = D['bridger-hollow']; let i = 0; const R = C.demoRows(B, 'dB', () => 'id-' + (++i)), s = R.district_settings[0];
check('demo row carries vppel_ongoing', s.vppel_ongoing === 90000 && s.save_ongoing === 150000 && s.ppel_ongoing === 40000, [s.save_ongoing, s.ppel_ongoing, s.vppel_ongoing]);
const back = C.settingsFromRows({ name: B.name }, s, R.fund_balance, R.debt_obligation);
check('settings from the row keep V-PPEL ongoing', back && back.settings.vppel.ongoing === 90000, back && back.settings.vppel);
// Bridger Hollow now shows believable shares of receipts
const sh = (o, r) => o / r;
check('Bridger Hollow: SAVE ongoing 10–25% of receipts', sh(B.settings.save.ongoing, B.settings.save.receipts) >= 0.1 && sh(B.settings.save.ongoing, B.settings.save.receipts) <= 0.25);
check('Bridger Hollow: PPEL ongoing plus the bus lease 50–90% of receipts', sh(B.settings.ppel.ongoing + 62000, B.settings.ppel.receipts) >= 0.5 && sh(B.settings.ppel.ongoing + 62000, B.settings.ppel.receipts) <= 0.9);
check('Bridger Hollow: V-PPEL ongoing 20–60% of receipts', sh(B.settings.vppel.ongoing, B.settings.vppel.annual) >= 0.2 && sh(B.settings.vppel.ongoing, B.settings.vppel.annual) <= 0.6);
console.log(`ongoing tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
