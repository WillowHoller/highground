/* HighGround check-register reading test. Run: node register_test.js */
const R = require('./register.js'), U = require('./uploads.js'), fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); } };

// 1. a typical board-packet export: title lines, one account string, a total row
const csv = ['Cottonwood Ridge CSD - Check Register', '', 'Check Date,Check #,Vendor #,Vendor Name,Invoice #,Description,Account Number,Amount',
  '09/03/2026,10421,V0012,Midwest Bus Parts,INV-5531,Brake pads,10-2700-000-000-1100-000-618,"1,240.50"',
  '09/15/2026,10422,V0044,Alliant Energy,88231,Electric - HS,10-2600-000-000-1100-000-622,8411.00',
  '09/30/2026,10423,V0090,Hawkeye Roofing LLC,R-77,Roof repair north wing,33-4700-000-000-1100-000-450,(500.00)',
  '10/01/2026,10424,V0012,Midwest Bus Parts,INV-5602,Filters,10-2700-000-000-1100-000-618,99',
  ',,,Total,,,,9250.50'].join('\n');
const P = R.parse(U.parseCSV(csv));
check('header found below the title line', P.header[0] === 'Check Date', P.headerIndex);
check('columns matched by name', P.cols.pay_date === 0 && P.cols.check_no === 1 && P.cols.vendor_no === 2 && P.cols.vendor_name === 3 && P.cols.invoice_no === 4 && P.cols.account === 6 && P.cols.amount === 7, JSON.stringify(P.cols));
check('payments read, total row skipped', P.lines.length === 4 && P.skipped === 1, P.lines.length + '/' + P.skipped);
check('amounts: commas and parentheses', P.lines[0].amount === 1240.5 && P.lines[2].amount === -500, P.lines.map((l) => l.amount).join());
check('account split: fund, function, object (assumed layout)', P.lines[0].fund === '10' && P.lines[0].func === '2700' && P.lines[0].obj === '618' && P.lines[2].fund === '33' && P.lines[2].obj === '450', JSON.stringify(P.lines[0]));
check('the split is flagged as an assumption', P.issues.some((i) => i.l === 'w' && /first two digits/.test(i.m)));
check('no errors', !P.issues.some((i) => i.l === 'e'), JSON.stringify(P.issues));
check('split by month: September and October', P.months.map((m) => m.period_end).join() === '2026-09-30,2026-10-31' && P.months[0].lines.length === 3, P.months.map((m) => m.period_end).join());
check('month totals', Math.abs(P.months[0].total - 9151.5) < 0.001, P.months[0].total);
check('line numbers count payments from the header, as the staff loader does', P.lines[0].line_no === 1 && P.lines[3].line_no === 4, P.lines[0].line_no);

// 2. dates in other shapes
check('dates: ISO, 2-digit year, Excel serial, text', R.parseDate('2026-09-03') === '2026-09-03' && R.parseDate('9/3/26') === '2026-09-03' && R.parseDate(46268) === '2026-09-03' && R.parseDate('Sep 3, 2026') === '2026-09-03',
  [R.parseDate('9/3/26'), R.parseDate(46268), R.parseDate('Sep 3, 2026')].join());
check('dates: with a time', R.parseDate('09/03/2026 00:00:00') === '2026-09-03');
check('amounts: trailing minus and $', R.parseAmount('$1,000.00-') === -1000 && R.parseAmount('abc') === null);

// 3. separate fund / function / object columns win over the account string
const P2 = R.parse([['Pay Date', 'Payee', 'Fund', 'Function', 'Object', 'Net Amount', 'Memo'], ['2026-08-02', 'Acme Supply', '10', '1000', '611', '45.10', 'Paper']]);
check('separate columns used as they are', P2.lines[0].fund === '10' && P2.lines[0].func === '1000' && P2.lines[0].obj === '611' && P2.lines[0].description === 'Paper', JSON.stringify(P2.lines[0]));
check('missing vendor numbers and invoices: warned, not refused', !P2.issues.some((i) => i.l === 'e') && P2.issues.filter((i) => i.l === 'w').length === 2, JSON.stringify(P2.issues));

// 4. what can't be read
const P3 = R.parse([['Date', 'Something', 'Else'], ['1/1/2026', 'x', 'y']]);
check('no vendor or amount column: errors, nothing read', P3.issues.filter((i) => i.l === 'e').length === 2 && !P3.lines.length, JSON.stringify(P3.issues));
const P4 = R.parse([['Check Date', 'Vendor Name', 'Amount'], ['', 'Acme', '10'], ['soon', 'Acme', '12']]);
check('payments without a readable date are an error', P4.issues.some((i) => i.l === 'e' && /2 payments have no date/.test(i.m)), JSON.stringify(P4.issues));
const P5 = R.parse([['Check Date', 'Vendor', 'Amount', 'Vendor Name'], ['1/2/2026', 'V1', '10', 'Acme']], { vendor_name: 3 });
check('a column chosen by hand wins', P5.cols.vendor_name === 3 && P5.lines[0].vendor_name === 'Acme', JSON.stringify(P5.cols));

// 5. rows for the database
const rows = R.toRows(P.months[0].lines, 'b1', 'd1');
check('database rows carry the upload and district, with the same keys on every row', rows.length === 3 && rows[0].batch_id === 'b1' && rows[0].district_id === 'd1' && new Set(rows.map((r) => Object.keys(r).sort().join())).size === 1 && !('vendor_key' in rows[0]), Object.keys(rows[0]).join());

// 6. the staff loader's fixture reads the same here
const fx = path.join(__dirname, 'loader', 'register_fixture.csv');
if (fs.existsSync(fx)) {
  const F = R.parse(U.parseCSV(fs.readFileSync(fx, 'utf8')));
  check('fixture: 105 payments over 12 months, as the staff loader reads it', F.lines.length === 105 && F.months.length === 12, F.lines.length + ' / ' + F.months.length);
}

console.log(`register_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
