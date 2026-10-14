/* HighGround: dollar-flow checks on random districts (14 Oct 2026).
   Instead of a few worked examples, thousands of random districts and plans, and rules money must always obey:
   every dollar charged somewhere, each fund's year rolls into the next, the gap adds up, more money never raises the gap,
   higher costs never lower it, doubling every dollar doubles it, the charts agree with the engine, the funding line and
   "fill in around the gaps" really fit, and the General Fund balance rolls forward.
   Run: node dollarflow_test.js            (fixed seeds: the same every time)
        SEED=12345 N=3000 node dollarflow_test.js   (the nightly run uses a new seed; a failure prints it so it can be replayed) */
const E = require('./engine.js'), C = require('./capital.js'), D = require('./demo_data.js'), K = require('./ranking.js');
const G = require('./gf.js');
const SEED0 = Number(process.env.SEED || process.argv[2] || 20261014); let seed = SEED0; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)], R = (lo, hi) => lo + rnd() * (hi - lo);
const fails = {}; const bad = (k, d) => { fails[k] = fails[k] || { n: 0, ex: d }; fails[k].n++; };
const near = (a, b, t) => Math.abs(a - b) <= (t || 1) + 1e-7 * Math.max(Math.abs(a), Math.abs(b));
const FUNDS = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp'];
function randSettings() {
  const base = JSON.parse(JSON.stringify(pick(Object.values(D)).settings));
  const sc = R(0.3, 3);
  base.save.receipts *= sc; base.ppel.receipts *= sc; base.save.ongoing = rnd() < .5 ? 0 : base.save.receipts * R(0, .4);
  base.ppel.ongoing = rnd() < .5 ? 0 : base.ppel.receipts * R(0, .9);
  if (rnd() < .3) { base.save.ongoing = 0; base.save.ongoingPct = R(0, .3); }
  base.balances.asOf = pick(['2026-06-30', '2026-09-30', '2027-01-31', '2026-07-01']);
  base.balances.save = R(0, 3e6); base.balances.ppel = R(0, 1e6); base.balances.vppel = R(0, 8e5); base.balances.grants = R(0, 2e5);
  base.vppel = rnd() < .5 ? { status: 'none', annual: 0 } : { status: pick(['active', 'proposed']), annual: R(1e5, 9e5), ongoing: R(0, 1e5), firstFY: 2024 + Math.floor(R(0, 6)), lastFY: 2030 + Math.floor(R(0, 8)) };
  base.debt = (base.debt || []).concat(rnd() < .5 ? [{ name: 'x', fund: pick(['save', 'ppel']), annual: R(0, 4e5), lastFY: 2027 + Math.floor(R(0, 12)), timing: pick(['spread', 'after', 'before']) }] : []);
  base.inflation = R(0, .06); base.save.sf2472 = rnd() < .7;
  return base;
}
function randProjects(cfg) {
  const n = 1 + Math.floor(R(0, 12)), out = [];
  for (let i = 0; i < n; i++) {
    const ph = [], m = 1 + Math.floor(R(0, 3));
    for (let j = 0; j < m; j++) {
      const k = 1 + Math.floor(R(0, 3)), fs = [...new Set(Array.from({ length: k }, () => pick(FUNDS)))];
      let left = 100; const funding = fs.map((b, z) => { const p = z === fs.length - 1 ? left : Math.max(1, Math.round(R(1, left - (fs.length - z - 1)))); left -= p; return { b, p }; });
      const either = fs.length > 1 && rnd() < .3;
      ph.push({ cost: Math.round(R(1e4, 4e6)), year: Math.floor(R(0, cfg.n)), funding: either ? [{ b: fs[0], p: 100 }] : funding, options: either ? fs : undefined,
        status: rnd() < .1 ? 'done' : rnd() < .1 ? 'underway' : 'planned', actual: rnd() < .5 ? Math.round(R(1e4, 3e6)) : null });
    }
    out.push({ id: 'p' + i, name: 'P' + i, phases: ph });
  }
  return E.cleanList(out, cfg);
}
const N = Number(process.env.N || process.argv[3] || 1200);
for (let t = 0; t < N; t++) {
  const s = randSettings(), cfg = E.makeConfig(s), L = E.defaultLevers(cfg);
  if (rnd() < .3) L.fin = [{ name: 'b', kind: pick(['go', 'rev', 'lease', 'gift']), fy: cfg.start + Math.floor(R(0, 4)), amount: R(1e5, 5e6), rate: .045, years: 15 }].map((f) => f); L.fin = E.leversOf(L, cfg).fin;
  if (rnd() < .3) L.recur = E.cleanRecur([{ fund: pick(['save', 'ppel', 'vppel', 'grants', 'general']), first: cfg.start + 1, last: rnd() < .5 ? null : cfg.start + 4, amount: R(1e3, 2e5), grows: pick(['none', 'inflation']), kind: 'other', initiative_id: 'p0' }]);
  const P = randProjects(cfg), r = E.compute(P, L, cfg);
  const tag = `SEED=${SEED0} case ${t}`;
  // 1. every dollar of every phase is charged to exactly one place
  const charged = Object.values(r.spentByBucket).reduce((a, b) => a + b, 0);
  if (!near(charged, r.need, 1)) bad('need = everything charged to some fund', { tag, need: r.need, charged });
  // 2. year by year, each fund: start + receipts - spending = next start (or a shortfall)
  r.res.forEach((m, y) => E.CAP_ORDER.forEach((b) => {
    const left = m.avail[b] - m.spend[b];
    if (!near(m.over[b], Math.max(0, -left))) bad('shortfall = spending beyond what is available', { tag, y, b });
    if (y + 1 < r.res.length && !near(r.res[y + 1].carryIn[b], Math.max(0, left))) bad('next year starts with what is left', { tag, y, b });
    if (!near(m.avail[b] - m.carryIn[b], E.inflow(cfg, b, y, L))) bad('receipts this year = inflow()', { tag, y, b });
  }));
  if (!near(r.res[0].carryIn.save, cfg.open.save)) bad('year 1 starts at the balance', { tag });
  // 3. the gap adds up
  if (!near(r.gap, r.unfunded + r.overflow)) bad('gap = unfunded campaign + fund shortfalls', { tag });
  if (!near(r.financed + r.unfunded, r.spentByBucket.camp, 1)) bad('campaign spending = financed + unfunded', { tag });
  // 4. more money never makes the gap bigger; more cost never makes it smaller
  { const s2 = JSON.parse(JSON.stringify(s)); s2.save.receipts *= 1.2; s2.ppel.receipts *= 1.2; s2.balances.save += 1e5;
    const c2 = E.makeConfig(s2), r2 = E.compute(E.cleanList(P.map((p) => ({ ...p, phases: p.phases.map((ph) => ({ ...ph })) })), c2), E.leversOf(L, c2), c2);
    if (r2.gap > r.gap + 1) bad('more receipts never raise the gap', { tag, g1: r.gap, g2: r2.gap }); }
  { const P2 = P.map((p) => ({ ...p, phases: p.phases.map((ph) => ({ ...ph, cost: ph.cost * 1.1 })) })), r2 = E.compute(P2, L, cfg);
    if (r2.gap < r.gap - 1) bad('higher costs never lower the gap', { tag, g1: r.gap, g2: r2.gap }); }
  // 5. dropping a project never raises the gap
  if (P.length > 1) { const r2 = E.compute(P.slice(1), L, cfg); if (r2.gap > r.gap + 1) bad('removing a project never raises the gap', { tag, g1: r.gap, g2: r2.gap }); }
  // 6. scale everything by 2 (no inflation): every dollar figure doubles
  { const s2 = JSON.parse(JSON.stringify(s)); s2.inflation = 0;
    const c1 = E.makeConfig(s2), L1 = Object.assign(E.defaultLevers(c1), { fin: [], recur: [] }), P1 = P.map((p) => ({ ...p, phases: p.phases.map((ph) => ({ ...ph, actual: null, status: 'planned' })) }));
    const a = E.compute(P1, L1, c1);
    const s3 = JSON.parse(JSON.stringify(s2)); ['receipts', 'ongoing'].forEach((k) => { s3.save[k] *= 2; s3.ppel[k] *= 2; }); s3.vppel.annual *= 2; s3.vppel.ongoing = (s3.vppel.ongoing || 0) * 2;
    ['save', 'ppel', 'vppel', 'grants'].forEach((b) => { s3.balances[b] *= 2; }); s3.grants.avg *= 2; s3.debt = s3.debt.map((d) => ({ ...d, annual: d.annual * 2 }));
    const c3 = E.makeConfig(s3), L3 = Object.assign(E.defaultLevers(c3), { fin: [], recur: [] }), b2 = E.compute(P1.map((p) => ({ ...p, phases: p.phases.map((ph) => ({ ...ph, cost: ph.cost * 2 })) })), L3, c3);
    if (!near(b2.gap, 2 * a.gap, 2) || !near(b2.need, 2 * a.need, 2)) bad('double every dollar: the gap doubles (no hidden fixed amounts)', { tag, gap: a.gap, gap2: b2.gap }); }
  // 7. ongoing commitments = receipts - what the plan gets (Funding vs. committed agrees with the engine)
  { const com = C.commitments(L, cfg); ['save', 'ppel'].forEach((b) => {
      let got = 0, rec = 0; cfg.years.forEach((fy, y) => { const f = y === 0 ? cfg.f0 : 1; got += E.inflow(cfg, b, y, L); rec += E.receiptsIn(cfg, b, y, L) * f; });
      if (!near(rec - got, com[b].debt + com[b].ongoing + com[b].yearly, 5)) bad('Funding vs. committed adds up to receipts minus what the plan gets', { tag, b, rec, got, com: com[b] }); }); }
}

// the funding line and "fill in around the gaps", on the demo districts with random receipts and a random order
for (let t = 0; t < Math.max(40, Math.round(N / 30)); t++) {
  const slug = pick(Object.keys(D)); let i = 0; const Rw = C.demoRows(D[slug], 'd1', () => 'x' + (++i));
  const set = Object.assign({}, Rw.district_settings[0], { save_receipts: Rw.district_settings[0].save_receipts * R(0.4, 1.6), ppel_receipts: Rw.district_settings[0].ppel_receipts * R(0.4, 1.6) });
  const sid = pick(Rw.scenario).id, ranks = Rw.scenario_initiative.filter((x) => x.scenario_id === sid).map((x) => Object.assign({}, x, { rank: Math.floor(R(1, 30)) }));
  const rows = { district: { name: 'x' }, settings: set, balances: Rw.fund_balance, debts: Rw.debt_obligation, scenarios: Rw.scenario, initiatives: Rw.initiative, phases: Rw.phase,
    funding: Rw.phase_funding, financing: Rw.financing, recurring: Rw.recurring_cost || [], scenario_initiative: Rw.scenario_initiative.filter((x) => x.scenario_id !== sid).concat(ranks) };
  const k = K.build(rows, sid), inp = C.buildInputs(rows, sid), tag = `SEED=${SEED0} ranking ${t} (${slug})`;
  const run = (ids) => { const keep = new Set(ids); return E.compute(inp.projects.filter((p) => keep.has(String(p.id))), Object.assign({}, inp.levers, { recur: (inp.levers.recur || []).filter((r) => keep.has(String(r.initiative_id))) }), inp.cfg); };
  if (run(k.items.slice(0, k.line).map((x) => x.id)).overflow > k.baseOverflow + 0.5) bad('everything above the funding line fits', { tag });
  if (k.line < k.items.length && run(k.items.slice(0, k.line + 1).map((x) => x.id)).overflow <= k.baseOverflow + 0.5) bad('the first initiative below the line really does not fit', { tag });
  if (run(k.fillIn.funded).overflow > k.baseOverflow + 0.5) bad('filling in around the gaps only funds what fits', { tag });
  if (!k.items.slice(0, k.line).every((x) => k.fillIn.funded.includes(x.id))) bad('filling in keeps everything strict rank order funds', { tag });
  if (k.items.length && !k.items.every((x, j) => x.position === j + 1)) bad('positions run 1..n', { tag });
}
// the General Fund: the balance rolls forward, and a new yearly cost never improves solvency
for (const slug of Object.keys(D).filter((s) => D[s].settings.gf)) {
  const gfi = D[slug].settings.gf, a = Object.assign({}, G.DEFAULTS), years = [2027, 2028, 2029, 2030, 2031];
  for (let t = 0; t < 30; t++) {
    const extra = {}; years.forEach((fy) => { extra[fy] = rnd() < .5 ? 0 : R(0, 4e5); });
    const f0 = G.forecast(gfi, a, years, {}).years, f1 = G.forecast(gfi, a, years, extra).years, tag = `SEED=${SEED0} gf ${slug} ${t}`;
    f1.forEach((y, j) => { const prev = j ? f1[j - 1].balance : Number(gfi.fund_balance);
      if (!near(y.balance, prev + y.revenue - y.spending, 1)) bad('General Fund: balance = last year + revenue - spending', { tag, fy: y.fy });
      if (y.solvency != null && f0[j].solvency != null && y.solvency > f0[j].solvency + 1e-9) bad('General Fund: a new cost never raises solvency', { tag, fy: y.fy }); });
  }
}

console.log(`dollar flow: ${N} random districts (SEED=${SEED0})`); Object.entries(fails).forEach(([k, v]) => console.log(`FAIL x${v.n}: ${k}\n   e.g. ${JSON.stringify(v.ex).slice(0, 300)}`));
const nf = Object.values(fails).reduce((a, v) => a + v.n, 0);
console.log(`dollar flow tests: ${nf ? 0 : 1} passed, ${nf} failed${nf ? ` (replay with SEED=${SEED0})` : ''}`); process.exit(nf ? 1 : 0);
