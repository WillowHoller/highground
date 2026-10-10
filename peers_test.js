/* HighGround peer callouts test. Run: node peers_test.js */
const P = require('./peers.js');
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); } };
const row = (k, flag, extra) => { const [kind, fund, line] = k.split('|'); return Object.assign({ measure_key: k, grp: kind, fund, line, flag, peer_group: 'districts your size', callout: 'x' }, extra || {}); };
const rows = [row('exp|General|Student Transportation', 'high', { callout: '$1,210/pupil — 1.8× the average of 41 districts your size (higher than 95% of them)' }),
  row('exp|ALL|Plant Operation & Maintenance', 'jump'), row('bal|General|SOLVENCY', 'low'), row('bal|SAVE|ENDING', 'high'), row('exp|PPEL|TOTAL', null),
  row('exp|ALL|Instruction', null), row('rev|ALL|TOTAL', 'low'), row('exp|General|Instruction|Salaries', 'high', { grp: 'detail' })];
check('labels', P.label(rows[0]) === 'General Fund · Student Transportation spending' && P.label(rows[2]) === 'General Fund · solvency ratio' && P.label(rows[3]) === 'SAVE · ending balance' && P.label(rows[6]) === 'All funds · total revenue', [P.label(rows[0]), P.label(rows[2]), P.label(rows[3]), P.label(rows[6])].join(' | '));
check('General Fund screen: General Fund callouts only', P.pick(rows, 'general').map((r) => r.measure_key).join() === 'exp|General|Student Transportation,bal|General|SOLVENCY');
check('Funds screen: all-funds callouts', P.pick(rows, 'funds').map((r) => r.measure_key).join() === 'exp|ALL|Plant Operation & Maintenance,rev|ALL|TOTAL');
check('Capital screen: SAVE and PPEL', P.pick(rows, 'capital').map((r) => r.measure_key).join() === 'bal|SAVE|ENDING');
check('unflagged and detail rows never shown', !P.pick(rows, 'all').some((r) => !r.flag || r.grp === 'detail') && P.pick(rows, 'all').length === 5);
const html = P.cardHtml(P.pick(rows, 'general'), { fy: 2025 });
check('card: heading, sentence, source and year', /Unusual vs\. districts your size/.test(html) && html.includes('1.8× the average of 41') && html.includes('FY2025') && html.includes('High vs. peers'), html);
check('card: nothing unusual, nothing shown', P.cardHtml([], { fy: 2025 }) === '');
check('card: text is escaped', !P.cardHtml([row('exp|General|<b>x</b>', 'high')], { fy: 1 }).includes('<b>x</b>'));
check('overview line', P.overviewLine(rows) === '5 numbers stand out against similar Iowa districts in the state’s latest annual report' && P.overviewLine([]) === '');
// drill-down
const D = [Object.assign(row('exp|General|Student Transportation', 'high'), { unit: 'per_pupil', value: 1210, amount: 1437480, peer_median: 640, peer_p25: 520, peer_p75: 760, peer_mean: 672, pct_rank: 0.95, peer_n: 41, prior_value: 980, change_pct: 23.5, peer_change_median_pct: 3.1 }),
  Object.assign(row('exp|General|Student Transportation|Purchased services', null), { grp: 'detail', line: 'Student Transportation · Purchased services', unit: 'per_pupil', value: 700, peer_median: 150 }),
  Object.assign(row('exp|General|Student Transportation|Salaries', null), { grp: 'detail', line: 'Student Transportation · Salaries', unit: 'per_pupil', value: 300, peer_median: 310 }),
  Object.assign(row('exp|General|TOTAL', null), { unit: 'per_pupil', value: 12000, peer_median: 11500 }),
  Object.assign(row('exp|General|Instruction', null), { unit: 'per_pupil', value: 7000, peer_median: 6900 }),
  Object.assign(row('bal|General|SOLVENCY', 'low'), { unit: 'pct', value: 4.2, peer_median: 11.3, peer_p25: 7, peer_p75: 16 })];
const dh = P.detailHtml(D, 'exp|General|Student Transportation', { fy: 2025 });
check('detail: district vs. median, middle half, rank and last year', dh.includes('$1,210/pupil') && dh.includes('$1,437,480 in all') && dh.includes('$520/pupil to $760/pupil') && dh.includes('higher than 95% of 41') && dh.includes('up 23.5%') && dh.includes('peers’ median up 3.1%'), dh);
check('detail: a function breaks down by kind of spending, largest first', /By kind of spending/.test(dh) && dh.indexOf('Purchased services') < dh.indexOf('Salaries') && dh.includes('+$550'), dh);
const dt = P.detailHtml(D, 'exp|General|TOTAL', { fy: 2025 });
check('detail: a fund total breaks down by function', /By function/.test(dt) && dt.includes('Instruction') && dt.includes('Student Transportation') && !dt.includes('Purchased services'));
check('detail: percentages', P.detailHtml(D, 'bal|General|SOLVENCY', { fy: 2025 }).includes('4.2%') && P.fmtVal(11.25, 'pct') === '11.3%');
check('detail: callouts link to their detail', P.cardHtml(P.pick(rows, 'general'), { fy: 2025 }).includes('data-action="peerDetail" data-key="exp|General|Student Transportation"'));
console.log(`peers_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
