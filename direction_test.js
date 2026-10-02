/* HighGround strategic measures test. Run: node direction_test.js */
const H = require('./direction.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
check('periods: school year, FY, month, year, date', H.periodEnd('2025-26') === '2026-06-30' && H.periodEnd('2025–2026') === '2026-06-30' && H.periodEnd('FY2027') === '2027-06-30'
  && H.periodEnd('2026-09') === '2026-09-30' && H.periodEnd('2026') === '2026-12-31' && H.periodEnd('2026-02-14') === '2026-02-14' && H.periodEnd('soon') === null);
// graduation rate: 88% in 2024-25, aiming for 94% by 2028-29 (four years), higher is better
const grad = { better: 'up', baseline_value: 88, baseline_period: '2024-25', target_value: 94, target_period: '2028-29', cadence: 'annual' };
const s1 = H.status(grad, [{ period: '2025-26', value: 89.8 }], '2026-10-01');
// one year of four: expected 88 + 6 × 1/4 = 89.5; 89.8 is ahead
check('on track: ahead of the straight path to the target', s1.state === 'ontrack' && Math.abs(s1.expected - 89.5) < 0.01 && Math.abs(s1.progress - 0.3) < 0.001, s1);
check('off track: behind the path', H.status(grad, [{ period: '2025-26', value: 88.4 }], '2026-10-01').state === 'offtrack');
check('met: target reached early', H.status(grad, [{ period: '2025-26', value: 94.2 }], '2026-10-01').state === 'met');
check('no data yet', H.status(grad, [], '2026-10-01').state === 'nodata');
// lower is better: chronic absence 14% → 9%
const abs = { better: 'down', baseline_value: 14, baseline_period: '2024-25', target_value: 9, target_period: '2027-28', cadence: 'semester' };
check('lower is better: falling counts as progress', H.status(abs, [{ period: '2025-26', value: 12 }], '2026-10-01').state === 'ontrack' && H.status(abs, [{ period: '2025-26', value: 13.9 }], '2026-10-01').state === 'offtrack');
// update owed: monthly measure last recorded for July, now October
const mon = { better: 'up', baseline_value: 0, baseline_period: '2026-06', target_value: 100, target_period: '2027-06', cadence: 'monthly' };
const o = H.status(mon, [{ period: '2026-07', value: 10 }], '2026-10-01');
check('update owed: monthly, nothing since July (due end of August, plus a month)', o.owed && o.due === '2026-08-31', o);
check('not owed within the grace month', !H.status(mon, [{ period: '2026-08', value: 20 }], '2026-10-01').owed);
check('latest and previous, in date order whatever the entry order', H.status(grad, [{ period: '2026-27', value: 91 }, { period: '2025-26', value: 89 }], '2027-10-01').previous.value === 89);
check('trend counts improvement in the better direction', H.status(abs, [{ period: '2024-25', value: 14 }, { period: '2025-26', value: 12 }], '2026-10-01').trend === 1);
check('next period suggested by cadence', H.nextPeriod(grad, '2026-10-01') === '2026-27' && H.nextPeriod(mon, '2026-10-01') === '2026-09');
console.log(`direction tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
