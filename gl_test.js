/* HighGround GL import test. Run: node gl_test.js */
const G = require('./gl.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b) => Math.abs(a - b) < 0.005;
// amounts in the forms exports use
check('money: commas, dollars, parentheses, trailing minus', G.money('1,234.56') === 1234.56 && G.money('$1,234') === 1234 && G.money('(1,234.56)') === -1234.56 && G.money('1234-') === -1234 && G.money('-') === null && G.money('') === null);
// Iowa codes
const e = G.splitCode('33-0000-4700-000-1001-450'), r = G.splitCode('36-0000-000-0000-1171'), b = G.splitCode('33-0000-000-0000-760');
check('expenditure code: fund, function, project, object', e.kind === 'expenditure' && e.fund === '33' && e.function === '4700' && e.project === '1001' && e.object === '450');
check('revenue code: 4-digit source', r.kind === 'revenue' && r.source === '1171');
check('balance-sheet code: 3-digit account', b.kind === 'balance' && b.account === '760');
check('digits run together are split by the standard lengths', G.splitCode('33000047000001001450').object === '450' && G.splitCode('36000000000001171').source === '1171');
check('suggestions: SAVE spending, PPEL revenue, SAVE fund balance', G.suggest(e).maps_to === 'expense' && G.suggest(e).mapped_fund === 'save' && G.suggest(r).mapped_fund === 'ppel' && G.suggest(b).maps_to === 'fund_balance');
check('cash and other balance-sheet lines are ignored', G.suggest(G.splitCode('33-0000-000-0000-101')).maps_to === 'ignore');
check('an unrecognised code is left for review', G.suggest(G.splitCode('ABC')).maps_to === 'unmapped');
// the sample export
const rows = G.sampleExport(), L = G.detectLayout(rows);
check('columns found by their headings', L.header === 0 && L.cols.account === 0 && L.cols.description === 1 && L.cols.month === 2 && L.cols.ytd === 3 && L.cols.budget === 4 && L.cols.encumbered === 5 && !L.missing.length, JSON.stringify(L));
const P = G.parse(rows, L);
check('every account line read, total row skipped', P.lines.length === 21 && !P.issues.some((i) => i.level === 'error'), P.lines.length);
const map = {}; P.lines.forEach((l) => { map[l.code] = G.suggest(l.parts); });
const B = G.balances(P.lines, map);
// SAVE: 1,420,000 + 295,236 − (262,750 + 138,900 + 4,500) = 1,309,086
check('SAVE balance at 30 Sept = equity + revenue − spending', near(B.save.balance, 1309086), B.save.balance);
// PPEL: 990,000 + 34,000 + 103,000 − (148,000 + 159,800 + 31,000) = 788,200
check('PPEL balance', near(B.ppel.balance, 788200), B.ppel.balance);
check('Debt Service and General Fund balances', near(B.debt_levy.balance, 170140) && near(B.general.balance, 4142073.04), [B.debt_levy.balance, B.general.balance]);
check('cash is not counted in the balance', near(B.save.equity, 1420000));
// month two: accounts already matched need no review
const accounts = P.lines.map((l) => Object.assign({ code: l.code, needs_review: false }, G.suggest(l.parts)));
const next = rows.concat([['33-0000-4700-000-1004-450', 'Elementary boiler - design', '12,000.00', '12,000.00', '640,000.00', '']]);
const R2 = G.reconcile(G.parse(next).lines, accounts);
check('next month: only the new account needs review', R2.fresh.length === 1 && R2.known.length === 21 && R2.fresh[0].suggestion.mapped_fund === 'save' && /SAVE spending, facilities/.test(R2.fresh[0].about), R2.fresh.map((x) => x.line.code));
// problems are reported plainly
const dup = G.parse([rows[0], rows[2], rows[2]]);
check('the same account twice is an error', dup.issues.some((i) => i.level === 'error' && /appears twice/.test(i.text)));
check('a file with no account lines is an error', G.parse([['Account', 'Year to date'], ['', 'nothing']]).issues.some((i) => i.level === 'error'));
const seg = G.detectLayout([['Fund', 'Facility', 'Function', 'Program', 'Project', 'Object', 'Source', 'Description', 'YTD Actual']]);
check('exports with separate code columns are understood', seg.cols.fund === 0 && seg.cols.object === 5 && seg.cols.ytd === 8 && !seg.missing.length, JSON.stringify(seg));
const P3 = G.parse([['Fund', 'Facility', 'Function', 'Program', 'Project', 'Object', 'Source', 'Description', 'YTD Actual'], ['33', '0000', '4700', '000', '1001', '450', '', 'Roof', '262,750.00']]);
check('…and their codes put back together', P3.lines[0].parts.kind === 'expenditure' && P3.lines[0].parts.object === '450');
console.log(`SAVE ${B.save.balance.toLocaleString()} · PPEL ${B.ppel.balance.toLocaleString()} · Debt Service ${B.debt_levy.balance.toLocaleString()} · General ${B.general.balance.toLocaleString()}`);
console.log(`gl tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
