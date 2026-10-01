/* HighGround upload parsing test. Run: node uploads_test.js */
const E = require('./engine.js'), U = require('./uploads.js'), G = require('./golden_engine.json');
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); } };

// 1. the template itself
const t = U.parseProjects(U.parseCSV(U.projectTemplate(2027)), 2027, 10);
const by = Object.fromEntries(t.projects.map((p) => [p.name, p]));
check('template: 4 projects from 5 rows', t.projects.length === 4, t.projects.length);
check('template: rows with the same name become phases', by['Roof replacement — north wing'].phases.length === 2);
check('template: split funding', JSON.stringify(by['Roof replacement — north wing'].phases[0].funding) === JSON.stringify([{ b: 'save', p: 60 }, { b: 'ppel', p: 40 }]));
check('template: cost range uses the midpoint, as an estimate', by['Track resurface'].phases[0].cost === 275000 && by['Track resurface'].est === true && t.issues.some((i) => i.l === 'w' && /midpoint/.test(i.m)));
check('template: Firm is read', by['Replace route bus'].est === false);
check('template: condition and life', by['Roof replacement — north wing'].cond === 'Poor' && by['Roof replacement — north wing'].life === 2);
check('template: no errors', !t.issues.some((i) => i.l === 'e'));
check('template: phase names read', by['Roof replacement — north wing'].phases.map((ph) => ph.label).join('|') === 'Sections A–B|Sections C–D');
const old = U.parseProjects([['Project', 'FY', 'Estimate', 'Funding source'], ['Boiler', 'FY2028', '90000', 'SAVE']], 2027, 10);
check('older spreadsheets without a Phase name column still work', old.projects.length === 1 && !old.issues.some((i) => i.l === 'e') && old.projects[0].phases[0].label === undefined);
const named = U.parseProjects(U.parseCSV(U.projectsToCSV([{ name: 'FFA program', est: true, phases: [{ year: 0, cost: 5000, funding: [{ b: 'grants', p: 100 }], label: 'Chapter start-up fees' }, { year: 2, cost: 150000, funding: [{ b: 'ppel', p: 50 }, { b: 'boost', p: 50 }], label: 'Shop buildout' }] }], 2027)), 2027, 10);
check('phase names survive export and re-upload', named.projects[0].phases.map((ph) => ph.label).join('|') === 'Chapter start-up fees|Shop buildout');

// 2. edge cases the planner handled
const rows = [['Project', 'FY', 'Estimate', 'Funding source', 'Funding %', 'Funding source 2', 'Funding % 2'],
  ['Gym floor', 'Summer 2027', '$120k', 'PPEL', '0.6', 'Boosters', '0.4'],
  ['Boiler', '2027-28', '95,000', 'sales tax', '', '', ''],
  ['Far future', 'FY2040', '10000', 'SAVE', '100', '', ''],
  ['Mystery', 'FY2029', 'lots', 'SAVE', '100', '', ''],
  ['Odd source', 'FY2029', '5000', 'Piggy bank', '100', '', '']];
const r = U.parseProjects(rows, 2027, 10);
const rb = Object.fromEntries(r.projects.map((p) => [p.name, p]));
check('Summer 2027 lands in FY2028; $120k read', rb['Gym floor'].phases[0].year === 1 && rb['Gym floor'].phases[0].cost === 120000);
check('Excel percentages (0.6/0.4) become 60/40', rb['Gym floor'].phases[0].funding.map((f) => f.p).join() === '60,40');
check('2027-28 is FY2028; "sales tax" is SAVE', rb['Boiler'].phases[0].year === 1 && rb['Boiler'].phases[0].funding[0].b === 'save');
check('year outside the plan is an error', r.issues.some((i) => i.l === 'e' && /FY2040 is outside/.test(i.m)));
check('unreadable estimate is an error', r.issues.some((i) => i.l === 'e' && /can’t read the estimate “lots”/.test(i.m)));
check('unknown source is a warning, uses SAVE', rb['Odd source'].phases[0].funding[0].b === 'save' && r.issues.some((i) => i.l === 'w' && /Piggy bank/.test(i.m)));
check('missing columns are reported', U.parseProjects([['Name', 'Cost']], 2027, 10).issues.some((i) => /No “FY” column/.test(i.m)));

// 3. balances
const bal = U.parseBalances(U.parseCSV('Fund,Iowa fund code,Balance,As-of date\r\nSAVE (Secure an Advanced Vision for Education),33,"$2,150,000",6/30/2026\r\nPPEL (board-approved),36,420000,\r\nV-PPEL (voter-approved),36,760000,\r\nGrants / donations restricted to capital,,60000,\r\nGeneral fund,10,5000000,\r\n'));
check('balances: four funds read', bal.found.save === 2150000 && bal.found.ppel === 420000 && bal.found.vppel === 760000 && bal.found.grants === 60000, JSON.stringify(bal.found));
check('balances: date read', bal.asOf === '2026-06-30', bal.asOf);
check('balances: general fund skipped with a note', bal.issues.some((i) => /General fund/.test(i.m) && i.l === 'w'));

// 4. round trip: every demo plan → spreadsheet → parsed → same engine answers as the working planner
let cases = 0, diffs = 0;
for (const [k, d] of Object.entries(G.districts)) {
  const cfg = E.makeConfig(d.settings);
  for (const sc of d.scenarios) {
    const csv = U.projectsToCSV(E.cleanList(sc.projects, cfg), cfg.start);
    const back = U.parseProjects(U.parseCSV(csv), cfg.start, cfg.n);
    if (back.issues.some((i) => i.l === 'e')) { diffs++; console.log('ERRORS', k, sc.name, back.issues.filter((i) => i.l === 'e').map((i) => i.m)); continue; }
    for (const c of d.cases.filter((c) => c.scenario === sc.id)) {
      cases++;
      const L = E.leversOf(Object.assign({}, sc.levers || {}, c.patch || {}), cfg);
      const res = E.compute(E.cleanList(back.projects, cfg), L, cfg);
      if (Math.abs(res.gap - c.result.gap) > 1e-4 || Math.abs(res.need - c.result.need) > 1e-4 || Math.abs(res.overflow - c.result.overflow) > 1e-4) {
        diffs++; console.log('DIFF', k, sc.name, JSON.stringify(c.patch), res.gap, c.result.gap);
      }
    }
  }
}
check(`round trip through the spreadsheet: ${cases} cases`, diffs === 0, diffs + ' differences');
console.log(`upload tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
