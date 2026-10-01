/* HighGround engine test. Run: node engine_test.js
   Checks engine.js against golden_engine.json: the working planner's own output for the three fictional
   demo districts, every scenario, eight lever sets (including SF 2472 off and three kinds of financing).
   Every number must match to within a hundredth of a cent. */
const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden_engine.json'), 'utf8'));
const close = (a, b) => Math.abs(a - b) <= 1e-4 + 1e-12 * Math.abs(b);
let cases = 0, diffs = 0;
for (const [id, d] of Object.entries(G.districts)) {
  const cfg = E.makeConfig(d.settings);
  for (const c of d.cases) {
    cases++;
    const sc = d.scenarios.find((s) => s.id === c.scenario);
    const L = E.leversOf(Object.assign({}, sc.levers || {}, c.patch || {}), cfg);
    const r = E.compute(E.cleanList(sc.projects, cfg), L, cfg);
    const cap = E.saveBondCapacity(cfg, L, 0.045, 20, 1.2);
    const bad = [];
    for (const k of ['need', 'gap', 'overflow', 'levyFunded', 'financed', 'unfunded']) if (!close(r[k], c.result[k])) bad.push(`${k} ${r[k]} vs ${c.result[k]}`);
    r.res.forEach((m, y) => {
      const got = [m.total, m.avail.save, m.avail.ppel, m.avail.vppel, m.avail.grants, m.over.save, m.over.ppel, m.over.vppel, m.over.grants, m.fin.used, m.fin.unfunded];
      got.forEach((v, i) => { if (!close(v, c.result.years[y][i])) bad.push(`year ${y} col ${i} ${v} vs ${c.result.years[y][i]}`); });
    });
    if (!close(cap.pv, c.capacity.pv) || cap.fy !== c.capacity.fy) bad.push(`capacity ${cap.pv}/${cap.fy} vs ${c.capacity.pv}/${c.capacity.fy}`);
    if (bad.length) { diffs++; console.log('DIFF', id, c.scenario, JSON.stringify(c.patch), bad.slice(0, 3).join('; ')); }
  }
}
console.log(`cases ${cases} diffs ${diffs}`);
process.exit(diffs ? 1 : 0);
