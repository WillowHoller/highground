/* HighGround: ongoing commitments as a share of receipts (14 Oct). Run: node ongoing_pct_test.js */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
const base = JSON.parse(JSON.stringify(D['bridger-hollow'].settings));
const cfgD = E.makeConfig(base), L = E.defaultLevers(cfgD);
// 12% of SAVE receipts as a share, against the same as dollars: equal in the year receipts match, different later as receipts change
const pctS = JSON.parse(JSON.stringify(base)); pctS.save.ongoing = 0; pctS.save.ongoingPct = 0.12;
const cfgP = E.makeConfig(pctS);
for (let y = 0; y < cfgP.n; y++) {
  const want = 0.12 * E.receiptsIn(cfgP, 'save', y, L);
  if (!near(E.ongoingIn(cfgP, 'save', y, L), want)) { check('SAVE share follows each year’s receipts (y=' + y + ')', false, [E.ongoingIn(cfgP, 'save', y, L), want]); break; }
}
check('SAVE share follows each year’s receipts', true);
check('SF 2472 lowers receipts, so a share commits less in later years than in the first', E.ongoingIn(cfgP, 'save', 6, L) < E.ongoingIn(cfgP, 'save', 1, L));
check('a share comes out of the fund like dollars do', near(E.inflow(cfgD, 'save', 3, L) + cfgD.saveOng, E.inflow(cfgP, 'save', 3, L) + E.ongoingIn(cfgP, 'save', 3, L), 0.5));
// PPEL share grows with valuation
const pp = JSON.parse(JSON.stringify(base)); pp.ppel.ongoing = 0; pp.ppel.ongoingPct = 0.5; const cfgPP = E.makeConfig(pp);
check('PPEL share grows with receipts', E.ongoingIn(cfgPP, 'ppel', 5, L) > E.ongoingIn(cfgPP, 'ppel', 1, L) && near(E.ongoingIn(cfgPP, 'ppel', 1, L), 0.5 * 136000 * 1.03));
// V-PPEL: only in the years it is collected, and not with the vote switched off
const vp = JSON.parse(JSON.stringify(base)); vp.vppel.ongoing = 0; vp.vppel.ongoingPct = 0.25; vp.vppel.lastFY = cfgD.start + 3; const cfgV = E.makeConfig(vp);
check('V-PPEL share only while collected', near(E.ongoingIn(cfgV, 'vppel', 1, L), 0.25 * 412000) && E.ongoingIn(cfgV, 'vppel', 5, L) === 0);
check('V-PPEL share is off when the what-if switches the vote off', E.ongoingIn(cfgV, 'vppel', 1, Object.assign({}, L, { vppel: false })) === 0);
// no share set: exactly the old dollars (golden cases rely on this)
check('no share: exactly the dollar amount', E.ongoingIn(cfgD, 'save', 4, L) === cfgD.saveOng && E.ongoingIn(cfgD, 'ppel', 4, L) === cfgD.ppelOng);
// the database row: a share wins over a stale dollar amount, both ways round trip
const row = { save_receipts: 1000000, save_ongoing: 99999, save_ongoing_pct: 0.1, ppel_receipts: 100000, ppel_ongoing: 40000, plan_years: 10, vppel_status: 'none' };
const st = C.settingsFromRows({ name: 'x' }, row, [{ fund: 'save', as_of: '2026-06-30', amount: 1 }], []).settings;
check('a share in the database ignores the dollar column', st.save.ongoing === 0 && st.save.ongoingPct === 0.1 && st.ppel.ongoing === 40000 && st.ppel.ongoingPct == null, [st.save, st.ppel.ongoingPct]);
// commitments (Funding vs. committed) count the share
const com = C.commitments(L, cfgP), comD = C.commitments(L, cfgD);
let want = 0; cfgP.years.forEach((fy, y) => { want += E.ongoingIn(cfgP, 'save', y, L) * (y === 0 ? cfgP.f0 : 1); });
check('Funding vs. committed counts a share year by year', near(com.save.ongoing, want, 1) && com.save.ongoing !== comD.save.ongoing, [com.save.ongoing, want]);
// SAVE bond room leaves room for the share too
const bD = E.saveBondCapacity(cfgD, L, 0.045, 20, 1.2), bBig = (() => { const s2 = JSON.parse(JSON.stringify(pctS)); s2.save.ongoingPct = 0.9; return E.saveBondCapacity(E.makeConfig(s2), L, 0.045, 20, 1.2); })();
check('a big SAVE share lowers revenue-bond room', bBig.pv < bD.pv, [bBig.pv, bD.pv]);
// out of range is clamped
const bad = JSON.parse(JSON.stringify(base)); bad.save.ongoingPct = 3; check('a share over 100% is held at 100%', E.makeConfig(bad).saveOngPct === 1);
console.log(`ongoing share tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
