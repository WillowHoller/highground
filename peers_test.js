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
check('card: heading, sentence, source and year', /Compared with districts your size/.test(html) && html.includes('1.8× the average of 41') && html.includes('FY2025') && html.includes('High vs. peers'), html);
check('card: nothing unusual, nothing shown', P.cardHtml([], { fy: 2025 }) === '');
check('card: text is escaped', !P.cardHtml([row('exp|General|<b>x</b>', 'high')], { fy: 1 }).includes('<b>x</b>'));
check('overview line', P.overviewLine(rows) === '5 numbers stand out against similar Iowa districts in the state’s latest annual report' && P.overviewLine([]) === '');
console.log(`peers_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
