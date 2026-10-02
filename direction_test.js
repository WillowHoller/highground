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
// automatic measures
const phases = [
  { fy: 2027, cost: 200000, status: 'done', actual_cost: 205000, done_date: '2026-09-25' },   // within 5% of 200,000 (no inflation in year 0) and on time
  { fy: 2027, cost: 100000, status: 'done', actual_cost: 120000, done_date: '2027-08-10' },   // over budget, and finished in FY2028: late
  { fy: 2028, cost: 300000, status: 'planned' }];
const ob = H.autoValues('phases_on_budget', { phases, inflation: 0, startFY: 2027 });
check('auto: phases on budget, by the fiscal year they finished', ob.length === 2 && ob[0].period === 'FY2027' && ob[0].value === 100 && ob[1].period === 'FY2028' && ob[1].value === 0 && ob[0].note === '1 of 1 phases', ob);
const os = H.autoValues('phases_on_schedule', { phases });
check('auto: phases finished in their planned year', os.find((x) => x.period === 'FY2028').value === 0 && os.find((x) => x.period === 'FY2027').value === 100);
const gap = H.autoValues('capital_gap', { reports: [{ period_end: '2026-08-31', payload: { plan: { gap: 3100000 } } }, { period_end: '2026-09-30', payload: { plan: { gap: 3017590.4 } } }] });
check('auto: capital gap from each board report', gap.length === 2 && gap[1].period === '2026-09' && gap[1].value === 3017590);
const sb = H.autoValues('save_balance', { balances: [{ fund: 'save', as_of: '2026-09-30', amount: 1309086 }, { fund: 'save', as_of: '2026-06-30', amount: 1420000 }, { fund: 'ppel', as_of: '2026-09-30', amount: 1 }] });
check('auto: SAVE balance month by month, in date order', sb.length === 2 && sb[0].value === 1420000 && sb[1].period === '2026-09');
check('auto: a SAVE balance measure gets status like any other', H.status({ better: 'up', baseline_value: 1000000, baseline_period: '2026-06', target_value: 1500000, target_period: '2027-06', cadence: 'monthly' }, sb, '2026-10-05').state === 'ontrack');
// goals spreadsheet
const goals = H.parseGoals([['Priority', 'Outcome', 'Measure', 'Unit', 'Better', 'Start', 'Start period', 'Target', 'Target period', 'Owner', 'Cadence'],
  ['Safe places', 'Secure buildings', 'Buildings with a secure entry', 'buildings', 'Higher', '1', '2024-25', '3', '2026-27', 'Facilities director', 'Yearly'],
  ['Safe places', '', 'Chronic absence', '%', 'Lower', '14', '2024-25', '9', 'soon', '', 'semester'], ['Stewardship', '', '', '', '', '', '', '', '', '', '']]);
check('goals: priorities, outcomes and measures read; bad periods flagged', goals.items.length === 3 && goals.items[0].better === 'up' && goals.items[0].cadence === 'annual' && goals.items[1].better === 'down'
  && goals.issues.length === 1 && /soon/.test(goals.issues[0].m), goals.issues);
check('goals: without a Priority column, explained', H.parseGoals([['Name'], ['x']]).issues[0].l === 'e');
// results spreadsheet
const ms = [{ id: 'm1', name: 'Four-year graduation rate' }, { id: 'm2', name: 'SAVE balance', auto_metric: 'save_balance' }];
const res = H.parseResults([['Measure', 'Period', 'Result', 'Note'], ['Four-year graduation rate', '2026-27', '90.7%', 'Preliminary'], ['SAVE balance', '2026-09', '1', ''], ['Graduation', '2026-27', '1', ''], ['Four-year graduation rate', 'next', '1', '']], ms);
check('results: matched by measure name; self-updating measures skipped; unknowns and bad periods flagged', res.items.length === 1 && res.items[0].value === 90.7 && res.items[0].period_end === '2027-06-30'
  && res.issues.filter((i) => i.l === 'w').length === 1 && res.issues.filter((i) => i.l === 'e').length === 2, res.issues);
// survey spreadsheet
const sv = H.parseSurvey([['Kind', 'Label', 'Value', 'Mentions', 'Priority'], ['Importance', 'Safe places', '4.6', '', ''], ['Theme', 'Crowded classrooms', '', '84', 'Safe places'], ['Theme', 'Bus times', '', 'x', '']], [{ id: 'p2', name: 'Safe places' }]);
check('survey: importance linked to its priority by name; themes with mentions; bad numbers flagged', sv.items.length === 2 && sv.items[0].kind === 'importance' && sv.items[0].priority_id === 'p2' && sv.items[1].mentions === 84 && sv.items[1].priority_id === 'p2' && sv.issues.length === 1, sv);
console.log(`direction tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
