/* HighGround: contracted projects and pay applications. Run: node contract_test.js */
const K = require('./contract.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
const contract = { contractor: 'Genesis', original_sum: 4200000, original_contingency: 200000, start_date: '2026-03-01', completion_date: '2027-08-31' };
const pa = (no, date, sum, done, ret, left) => ({ pay_app_no: no, through_date: date, contract_sum: sum, completed_to_date: done, retainage: ret, contingency_remaining: left });
const apps = [pa(3, '2026-08-31', 4220000, 1450000, 72500, 170000), pa(4, '2026-09-30', 4238000, 1950000, 97500, 138000)];

// the basics, from the latest pay app (order given doesn't matter)
let x = K.status(contract, apps.slice().reverse(), { planned: 4300000, ledgerSpent: 1852500, asOf: '2026-09-30' });
check('uses the latest pay app', x.latest.pay_app_no === 4);
check('% complete = completed ÷ contract sum', near(x.pctComplete, 1950000 / 4238000, 1e-9));
check('change orders = contract sum today − original', x.changeOrders === 38000 && near(x.changeOrdersPct, 38000 / 4200000, 1e-9));
check('contingency used = 1 − left ÷ original', near(x.contingencyUsedPct, 0.31, 1e-9));
check('projected final = contract sum + contingency left', x.projectedFinal === 4238000 + 138000);
check('paid per pay apps = completed − retainage', x.paid === 1950000 - 97500);
check('still to pay includes retainage', x.stillToPay === 4238000 - 1852500);
check('ledger = paid: books match; retainage is not a difference', x.books === 'match' && near(x.booksDiff, 0));

// cost over
x = K.status(contract, apps, { planned: 4300000 });
check('over budget flagged when projected final passes the plan', x.cost === 'over' && near(x.overBy, 76000) && x.flags.some((f) => f.k === 'cost') && x.status === 'bad', x);
x = K.status(contract, apps, { planned: 4400000 });
check('within budget: no cost flag', x.cost === 'within' && !x.flags.some((f) => f.k === 'cost'));
x = K.status(contract, apps, {});
check('no plan figure: cost unknown, not a flag', x.cost === 'unknown' && !x.flags.some((f) => f.k === 'cost'));

// contingency burning faster than the work
x = K.status(contract, [pa(2, '2026-06-30', 4200000, 840000, 42000, 60000)], { planned: 4400000 });
check('contingency 70% used at 20% complete: flagged', x.flags.some((f) => f.k === 'contingency'), x.flags);
x = K.status(contract, [pa(2, '2026-06-30', 4200000, 840000, 42000, 180000)], { planned: 4400000 });
check('contingency 10% used at 20% complete: fine', !x.flags.some((f) => f.k === 'contingency'));
x = K.status(Object.assign({}, contract, { original_contingency: 0 }), apps, {});
check('no contingency in the contract: not measured', x.contingencyUsedPct == null && !x.flags.some((f) => f.k === 'contingency'));

// schedule
x = K.status(contract, [pa(5, '2027-02-28', 4238000, 1700000, 85000, 120000)], { asOf: '2027-02-28' });
check('behind: well under the straight line between the dates', x.schedule === 'behind' && x.expectedPct > 0.6, x);
x = K.status(contract, apps, { asOf: '2026-09-30' });
check('on pace near the straight line', x.schedule === 'on', [x.pctComplete, x.expectedPct]);
x = K.status(Object.assign({}, contract, { completion_date: null }), apps, {});
check('no completion date: schedule unknown', x.schedule === 'unknown' && x.expectedPct == null);

// books
x = K.status(contract, apps, { ledgerSpent: 1950000 });
check('ledger counts retainage as spent when earned: recognized, not flagged', x.books === 'match-gross' && !x.flags.some((f) => f.k === 'books'));
x = K.status(contract, apps, { ledgerSpent: 1452500 });
check('a pay app missing from the ledger: flagged', x.books === 'differ' && x.flags.some((f) => f.k === 'books') && x.booksDiff < 0);
x = K.status(contract, apps, { ledgerSpent: 1852500 + 4000 });
check('small differences (under $5,000) are not flagged', x.books === 'match');
x = K.status(contract, apps, {});
check('no linked accounts: books unknown', x.books === 'unknown');

// never double counted: status() returns pay-app figures only; nothing adds them to the ledger
x = K.status(contract, apps, { ledgerSpent: 1852500, planned: 4400000 });
check('pay-app figures are a check: ledger spent is reported as given', x.ledgerSpent === 1852500 && x.paid === 1852500);

// no pay apps yet
x = K.status(contract, [], { planned: 1 });
check('no pay app: nothing worked out', x.hasPayApp === false && x.flags.length === 0);
check('sentence without pay apps', /no pay application/.test(K.sentence('Addition', x)));
x = K.status(contract, apps, { planned: 4400000 });
const s = K.sentence('Genesis addition', x);
check('board sentence', /46% complete/.test(s) && /\$38k in change orders \(0\.9%\)/.test(s) && /contingency 31% used/.test(s) && /projected \$4\.38M against \$4\.40M planned/.test(s), s);

// entry checks
let c = K.checkEntry(pa(5, '2026-10-31', 4238000, 2400000, 3000000, 100000), contract, apps);
check('retainage over completed is an error', c.errors.some((m) => /Retainage/.test(m)));
c = K.checkEntry(pa(5, '2026-10-31', 4238000, 5000000, 0, 100000), contract, apps);
check('completed over contract sum is an error', c.errors.some((m) => /more than the contract sum/.test(m)));
c = K.checkEntry(pa(5, '2026-10-31', 4238000, 1500000, 75000, 100000), contract, apps);
check('completed going down is a warning', c.errors.length === 0 && c.warnings.some((m) => /less than on the last/.test(m)));
c = K.checkEntry(pa(5, '2026-10-31', 4238000, 2400000, 120000, 300000), contract, apps);
check('contingency left over the original is a warning', c.warnings.some((m) => /more than the original contingency/.test(m)));
c = K.checkEntry(pa(5, '2026-10-31', 4238000, 2400000, 480000, 100000), contract, apps);
check('retainage over 10% is a warning', c.warnings.some((m) => /5%/.test(m)));
c = K.checkEntry(pa(5, '', 0, null, 0, null), contract, []);
check('missing date, sum and completed are errors', c.errors.length === 3, c.errors);
c = K.checkEntry(pa(5, '2026-10-31', 4238000, 2400000, 120000, 100000), contract, apps);
check('a normal pay app passes', c.errors.length === 0 && c.warnings.length === 0, c);

console.log(`contract tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
