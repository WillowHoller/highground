/* HighGround guardrail (Leslie, 11 Nov 2026). Run: node guardrail_test.js   (node guardrail_test.js --update to lower the baseline)
   States differ in their funds, laws, rates, units and calendar. Those belong in states.js, read through HGStates. This test
   counts Iowa's fund names and other Iowa-only words in every other app file and FAILS if any count goes UP from
   guardrail_baseline.json. Counts going down are good: run with --update to lock in the lower numbers.
   Tests, demo data, SQL, docs and the Iowa data loaders are left out: they are about Iowa on purpose. */
const fs = require('fs'), path = require('path');
const DIR = __dirname, BASE = path.join(DIR, 'guardrail_baseline.json');
const TERMS = { SAVE: /\bSAVE\b/g, PPEL: /(?<!-)\bPPEL\b/g, 'V-PPEL': /\bV-PPEL\b/g, Iowa: /\bIowa\b/g, 'SF 2472': /SF ?2472|sf2472/g, 'per $1,000': /per \$1,000/g,
  'fiscal year July': /1 July|July 1|June 30|30 June/g };
const SKIP = /(_test\.(js|mjs)$|^states\.js$|^demo_data\.js$|^guardrail)/;
const files = fs.readdirSync(DIR).filter((f) => /\.(js|html)$/.test(f) && !SKIP.test(f)).sort();
const now = {};
files.forEach((f) => { const t = fs.readFileSync(path.join(DIR, f), 'utf8'), c = {};
  Object.entries(TERMS).forEach(([k, re]) => { const n = (t.match(re) || []).length; if (n) c[k] = n; }); if (Object.keys(c).length) now[f] = c; });
if (process.argv.includes('--update') || !fs.existsSync(BASE)) {
  fs.writeFileSync(BASE, JSON.stringify({ note: 'Counts of Iowa-only words outside states.js. guardrail_test.js fails if any goes up. Lower them, then run node guardrail_test.js --update.', updated: new Date().toISOString().slice(0, 10), counts: now }, null, 1) + '\n');
  console.log('guardrail baseline written'); process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).counts;
let pass = 0, fail = 0, lower = 0;
Object.entries(now).forEach(([f, c]) => Object.entries(c).forEach(([k, n]) => {
  const was = (base[f] || {})[k] || 0;
  if (n > was) { fail++; console.log(`FAIL guardrail: ${f} has ${n} × “${k}” (baseline ${was}). Read it from HGStates (states.js) instead of writing it out.`); }
  else { pass++; if (n < was) lower++; }
}));
if (lower) console.log(`(${lower} count${lower === 1 ? '' : 's'} went down: run node guardrail_test.js --update to lock them in)`);
console.log(`guardrail tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
