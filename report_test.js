/* HighGround board report test. Run: node report_test.js */
const C = require('./capital.js'), D = require('./demo_data.js'), G = require('./gl.js'), Rp = require('./report.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
let i = 0; const R = C.demoRows(D['bridger-hollow'], 'dB', () => 'id-' + (++i));
const rows = { district: { name: 'Bridger Hollow Community School District' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: JSON.parse(JSON.stringify(R.initiative)), phases: JSON.parse(JSON.stringify(R.phase)), funding: R.phase_funding, financing: R.financing, recurring: R.recurring_cost };
const nameId = (n) => rows.initiatives.find((x) => x.name === n).id;
// the September ledger, with the roof and Chromebooks linked to their initiatives
const P = G.parse(G.sampleExport());
const link = { '33-0000-4700-000-1001-450': nameId('High school roof replacement'), '36-0000-2230-000-1003-734': nameId('1:1 Chromebook refresh') };
const accounts = P.lines.map((l, k) => Object.assign({ id: 'a' + k, code: l.code, fund_code: l.parts.fund, function_code: l.parts.function || null, initiative_id: link[l.code] || null }, G.suggest(l.parts), link[l.code] ? { maps_to: 'initiative' } : {}));
const amounts = (batch, scale) => P.lines.map((l, k) => ({ batch_id: batch, account_id: 'a' + k, ytd_amount: l.ytd * scale, budget_amount: l.budget, encumbered: l.encumbered }));
const aug = { id: 'aug', kind: 'gl_monthly', status: 'applied', period_end: '2026-08-31', fiscal_year: 2027 }, sep = { id: 'sep', kind: 'gl_monthly', status: 'applied', period_end: '2026-09-30', fiscal_year: 2027 };
const balancesAug = R.fund_balance.concat([{ fund: 'save', as_of: '2026-08-31', amount: 1352000 }, { fund: 'ppel', as_of: '2026-08-31', amount: 801000 }]);
const prev = Rp.build({ district: rows.district, rows, periodEnd: '2026-08-31', batch: aug, accounts, amounts: amounts('aug', 0.5), batches: [aug], balances: balancesAug });
check('August report: dated, board version, plan figures', prev.periodEnd === '2026-08-31' && prev.fiscalYear === 2027 && prev.scenario.name === 'District baseline' && Math.abs(prev.plan.gap - 3818185) < 1000, prev.plan.gap);   // 13 Oct: $3.818M once Bridger Hollow carries realistic ongoing SAVE/PPEL/V-PPEL commitments (was $2.918M); $3.018M before the SF 2472 cut was figured on projected SAVE (rule G7, 10 Oct 2026)
check('first report says there is nothing to compare', Rp.changes(prev, null).first);
// during September: the vestibules finished, CTE moved to approved, and the September ledger came in
const vest = rows.phases.find((p) => p.scenario_id === R.scenario[0].id && p.initiative_id === nameId('Secure entry vestibules (two buildings)'));
Object.assign(vest, { status: 'done', done_date: '2026-09-25', actual_cost: 209800 });
rows.initiatives.find((x) => x.name === 'CTE and ag building addition').status = 'approved';
const balancesSep = balancesAug.concat([{ fund: 'save', as_of: '2026-09-30', amount: 1309086 }, { fund: 'ppel', as_of: '2026-09-30', amount: 788200 }]);
const now = Rp.build({ district: rows.district, rows, periodEnd: '2026-09-30', batch: sep, accounts, amounts: amounts('sep', 1), batches: [aug, sep], balances: balancesSep });
check('September report: balances as of the month end', now.balances.save.amount === 1309086 && now.balances.ppel.as_of === '2026-09-30');
check('September report: budget vs. actual from the ledger', now.budget.find((f) => f.key === 'general').revenue.actual > 2.9e6 && now.ledgerThrough === '2026-09-30');
const roof = now.progress.find((x) => x.name === 'High school roof replacement');
check('September report: progress against the plan, with spending from the ledger', roof && Math.round(roof.planned) === 410000 && roof.spent === 262750 && roof.encumbered === 147250, roof);
check('September report: decisions ahead, unapproved only, largest first', now.pending.every((x) => ['idea', 'proposed', 'analysis'].includes(x.status)) && !now.pending.some((x) => x.name.startsWith('CTE')) && now.pending.every((x, k, a) => !k || a[k - 1].cost >= x.cost));
const ch = Rp.changes(now, prev), text = ch.items.join(' | ');
check('changes: the finished phase, with its date and cost', /Finished: Secure entry vestibules \(two buildings\), on 2026-09-25, at \$210k/.test(text), text);
check('changes: the status change', /CTE and ag building addition: Being analysed → Approved/.test(text), text);
check('changes: balances moved', /SAVE balance down \$43k, to \$1\.31M/.test(text) && /PPEL balance down \$13k/.test(text), text);
check('changes: the gap moved because the finished phase cost less than planned', /The gap to close (shrank|grew)/.test(text) || Math.abs(now.plan.gap - prev.plan.gap) < 0.5, text);
check('changes: spending this period', /Spending on initiatives this period: \$211k/.test(text), text);
const withGf = Rp.build({ district: rows.district, rows, periodEnd: '2026-09-30', batch: sep, accounts, amounts: amounts('sep', 1), batches: [aug, sep], balances: balancesSep, gf: { solvency: 0.152, lowest: 0.13, lowestFY: 2031, unspentRatio: 0.11 } });
const prevGf = Object.assign({}, prev, { gf: { solvency: 0.164 } });
check('General Fund headline kept in the report, and its change described', withGf.gf.solvency === 0.152 && /General Fund solvency fell from 16\.4% to 15\.2%/.test(Rp.changes(withGf, prevGf).items.join(' ')));
check('nothing material: said plainly', Rp.changes(now, now).items[0] === 'Nothing material changed since the last report.');
check('the report is plain data (can be stored as it was)', JSON.parse(JSON.stringify(now)).plan.need === now.plan.need);
// 14 Oct (f): what each capital fund holds back this year, against unlinked spending; contracted projects from the app
const hb = now.holdback || [];
check('holdback: each capital fund with something held back or spent, from the board version', hb.length >= 1 && hb.every((h) => ['save', 'ppel', 'vppel'].includes(h.fund) && h.held >= 0), hb);
const sv = hb.find((h) => h.fund === 'save');
check('holdback: SAVE held back is the board version’s figure for FY2027 ($150k in the demo)', sv && Math.abs(sv.held - 150000) < 1, sv);
check('holdback: expected by now = held × the share of the year gone (Sep 30: 25%)', sv && Math.abs(sv.expected - sv.held * 0.25) < 1, sv);
check('holdback: no ledger, no holdback lines', (prev.holdback || []).length >= 0 && (Rp.build({ district: rows.district, rows, periodEnd: '2026-09-30', batch: null, accounts: [], amounts: [], batches: [], balances: balancesSep }).holdback || []).length === 0);
const over = JSON.parse(JSON.stringify(now)); over.holdback = [{ fund: 'save', held: 150000, used: 190000, expected: 37500, status: 'over' }];
const pace = JSON.parse(JSON.stringify(now)); pace.holdback = [{ fund: 'save', held: 150000, used: 20000, expected: 37500, status: 'pace' }];
check('changes: a fund passing its holdback is said once', /SAVE spending outside the plan’s initiatives \(\$190k\) has passed what the plan holds back for the year \(\$150k\)/.test(Rp.changes(over, pace).items.join(' ')) && !/passed what the plan holds back/.test(Rp.changes(over, over).items.join(' ')));
const withK = Rp.build({ district: rows.district, rows, periodEnd: '2026-09-30', batch: sep, accounts, amounts: amounts('sep', 1), batches: [aug, sep], balances: balancesSep,
  contracts: [{ id: 'k1', name: 'Addition', sentence: 'Addition · 46% complete.', status: 'warn', flags: ['Contingency is 70% used with the work 46% complete.'] }] });
check('contracts: carried into the report as given', withK.contracts.length === 1 && withK.contracts[0].sentence === 'Addition · 46% complete.');
check('changes: a contract newly off track is said', /Addition: Contingency is 70% used/.test(Rp.changes(withK, now).items.join(' ')));
console.log(ch.items.map((x) => '  · ' + x).join('\n'));
console.log(`report tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
