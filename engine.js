/* HighGround — Iowa capital funds engine (pure module, no globals, no page access).
   Same math as the working planner (app1.js "math (pure)", build 2026-09-24), lifted so it can be
   tested on its own and run in the browser or on a server. Checked against the planner's own output:
   see engine_test.js and golden_engine.json.

   Usage:
     const cfg = HGEngine.makeConfig(settings);            // settings in the planner's shape (see normSettings)
     const levers = HGEngine.defaultLevers(cfg);           // or HGEngine.leversOf(stored, cfg)
     const projects = HGEngine.cleanList(rawProjects, cfg); // phases: {cost, year (0-based), funding:[{b,p}], status?, actual?}
     const r = HGEngine.compute(projects, levers, cfg);     // {need, gap, overflow, levyFunded, financed, unfunded, res[...]}
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCKETS = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp'];
  const BUCKET_NAMES = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants/Donations', boost: 'Boosters', camp: 'Campaign/Bond' };
  const CAP_ORDER = ['save', 'ppel', 'vppel', 'grants'];
  const BUCKET_ALIAS = { bondp: 'save' };
  const PRI_LIST = ['High', 'Med', 'Low', '10-yr'];

  /* SF 2472 (2026): share of SAVE cut from school infrastructure. LSA final fiscal note (15 Jul 2026)
     statewide reductions ÷ FY2026 statewide SAVE of $652.7M. Held at the FY2031 level afterwards. */
  const SF2472_CUT = { 2027: 0.060, 2028: 0.090, 2029: 0.110, 2030: 0.162 };
  const sfCut = (fy) => (fy < 2027 ? 0 : SF2472_CUT[fy] != null ? SF2472_CUT[fy] : 0.186);

  const num = (v, d) => { const n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? d : n; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* Iowa fiscal years run 1 July – 30 June and are named for the year they end.
     A 30 June close is the opening balance of the next year. */
  function fyOfDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 7) return y + 1;
    if (mo === 6 && d === 30) return y + 1;
    return y;
  }
  /* share of the first plan year's receipts still to come after the balance date */
  function firstYearFraction(iso) {
    const fy = fyOfDate(iso); if (!fy) return { f: 1, months: 12 };
    const start = Date.UTC(fy - 1, 6, 1), end = Date.UTC(fy, 6, 1);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86400000;
    if (t <= start + 86400000) return { f: 1, months: 12 };
    const f = Math.max(0, Math.min(1, (end - t) / (end - start)));
    return { f: f, months: Math.round(f * 12 * 10) / 10 };
  }

  function blankSettings(todayIso) {
    return {
      district: { name: '', short: '', enrollment: null },
      plan: { startFY: fyOfDate(todayIso || new Date().toISOString().slice(0, 10)), years: 10 },
      balances: { asOf: '', save: null, ppel: null, vppel: 0, grants: 0 },
      save: { receipts: null, ongoing: 0, trend: 0, sf2472: true, receiptsFY: null },
      ppel: { receipts: null, ongoing: 0, growth: 0.03, valuation: null, rate: null, actualValuation: null, goOutstanding: null },
      vppel: { status: 'none', annual: 0, firstFY: null, lastFY: null },
      grants: { avg: 0, yield: 0.75 },
      debt: [],
      inflation: 0,
    };
  }
  function normSettings(s, todayIso) {
    const b = blankSettings(todayIso); s = s || {};
    const out = {
      district: Object.assign(b.district, s.district || {}),
      plan: Object.assign(b.plan, s.plan || {}),
      balances: Object.assign(b.balances, s.balances || {}),
      save: Object.assign(b.save, s.save || {}),
      ppel: Object.assign(b.ppel, s.ppel || {}),
      vppel: Object.assign(b.vppel, s.vppel || {}),
      grants: Object.assign(b.grants, s.grants || {}),
      debt: Array.isArray(s.debt) ? s.debt.map((d) => ({ name: String(d.name || 'Debt obligation'), fund: d.fund === 'ppel' ? 'ppel' : 'save',
        annual: num(d.annual, 0), lastFY: num(d.lastFY, null) })) : [],
      inflation: num(s.inflation, 0),
    };
    out.save.sf2472 = !(out.save.sf2472 === false || out.save.sf2472 === 'false');
    out.save.receiptsFY = num(out.save.receiptsFY, null);
    const fy = fyOfDate(out.balances.asOf); if (fy) out.plan.startFY = fy;
    out.plan.years = Math.max(5, Math.min(15, Math.round(num(out.plan.years, 10))));
    if (!['none', 'proposed', 'active'].includes(out.vppel.status)) out.vppel.status = 'none';
    return out;
  }

  /** Everything the math needs, derived once from the settings. */
  function makeConfig(settings, todayIso) {
    const s = normSettings(settings, todayIso);
    const start = s.plan.startFY, n = s.plan.years;
    const fr = firstYearFraction(s.balances.asOf);
    const v = s.vppel;
    const years = [];
    for (let i = 0; i < n; i++) years.push(start + i);
    return {
      settings: s, start: start, n: n, years: years, f0: fr.f, months0: fr.months,
      open: { save: num(s.balances.save, 0), ppel: num(s.balances.ppel, 0), vppel: num(s.balances.vppel, 0), grants: num(s.balances.grants, 0) },
      saveInc: num(s.save.receipts, 0), saveOng: num(s.save.ongoing, 0), saveFY: num(s.save.receiptsFY, null),
      ppelInc: num(s.ppel.receipts, 0), ppelOng: num(s.ppel.ongoing, 0),
      vStatus: v.status, vAnnual: num(v.annual, 0),
      vFirst: num(v.firstFY, start), vLast: num(v.lastFY, start + n - 1),
      grantAvg: num(s.grants.avg, 0),
      debt: s.debt.map((d) => ({ fund: d.fund, annual: num(d.annual, 0), last: num(d.lastFY, start - 1) })),
    };
  }

  const defaultLevers = (cfg) => {
    const s = cfg.settings;
    return { vppel: cfg.vStatus === 'active', pg: num(s.ppel.growth, 0.03), gy: num(s.grants.yield, 0.75),
      sg: num(s.save.trend, 0), infl: num(s.inflation, 0), sf: s.save.sf2472 !== false, fin: [] };
  };
  function cleanFin(list, cfg) {
    return (Array.isArray(list) ? list : []).map((f) => ({
      name: String(f.name || 'Financing').slice(0, 60),
      kind: ['go', 'rev', 'lease', 'gift'].includes(f.kind) ? f.kind : 'go',
      fy: Math.round(num(f.fy, cfg.start)), amount: Math.max(0, num(f.amount, 0)),
      rate: Math.max(0, num(f.rate, 0)), years: Math.max(0, Math.round(num(f.years, 0))),
      repay: f.kind === 'rev' ? 'save' : f.kind === 'lease' ? (f.repay === 'save' ? 'save' : 'ppel') : f.kind === 'gift' ? 'none' : 'levy',
    })).slice(0, 8);
  }
  /* yearly costs (programs, hires) in a scenario: {fund, first, last (null = ongoing), amount, grows: none|inflation|settlement} */
  function cleanRecur(list) {
    return (Array.isArray(list) ? list : []).map((r) => ({
      fund: ['save', 'ppel', 'vppel', 'grants', 'general', 'boost', 'other'].includes(r.fund) ? r.fund : 'general',
      first: Math.round(num(r.first, 0)), last: r.last == null || r.last === '' ? null : Math.round(num(r.last, 0)),
      amount: Math.max(0, num(r.amount, 0)), grows: ['inflation', 'settlement'].includes(r.grows) ? r.grows : 'none',
      name: r.name ? String(r.name).slice(0, 90) : '', kind: r.kind || 'other', id: r.id,
    }));
  }
  function leversOf(stored, cfg) {
    const o = Object.assign(defaultLevers(cfg), clone(stored || {}));
    o.fin = cleanFin(o.fin, cfg); o.sf = !!o.sf; o.recur = cleanRecur(o.recur); o.settle = num(o.settle, 0);
    return o;
  }

  function cleanPhases(raw, cfg) {
    const N = cfg.n;
    return (Array.isArray(raw) ? raw : []).map((ph) => {
      let f = Array.isArray(ph && ph.funding)
        ? ph.funding.map((x) => x && { b: BUCKET_ALIAS[x.b] || x.b, p: Number(x.p) || 0 }).filter((x) => x && BUCKETS.includes(x.b)) : [];
      const merged = []; f.forEach((x) => { const hit = merged.find((m) => m.b === x.b); if (hit) hit.p += x.p; else merged.push(x); });
      f = merged.slice(0, 3);
      if (!f.length) f = [{ b: 'save', p: 100 }];
      const tot = f.reduce((a, x) => a + x.p, 0);
      if (tot !== 100 && tot > 0) f.forEach((x) => { x.p = Math.round(x.p / tot * 100); });
      if (tot === 0) f.forEach((x, i) => { x.p = i === 0 ? 100 : 0; });
      const o = { cost: Math.max(0, Number(ph && ph.cost) || 0), year: Math.max(0, Math.min(N - 1, Number(ph && ph.year) || 0)), funding: f };
      if (ph && (ph.status === 'underway' || ph.status === 'done')) o.status = ph.status;
      if (ph && ph.actual != null && ph.actual !== '' && isFinite(Number(ph.actual))) o.actual = Math.max(0, Number(ph.actual));
      if (ph && typeof ph.label === 'string' && ph.label.trim()) o.label = ph.label.trim().slice(0, 80);
      return o;
    }).slice(0, 12);
  }
  function cleanProject(p, fallbackId, cfg) {
    const phases = cleanPhases(p.phases, cfg);
    return {
      id: p.id != null ? p.id : fallbackId,
      name: (typeof p.name === 'string' && p.name.trim()) ? p.name.trim().slice(0, 90) : 'Untitled project',
      pri: PRI_LIST.includes(p.pri) ? p.pri : '', est: p.est !== false,
      area: typeof p.area === 'string' ? p.area.slice(0, 40) : '',
      cond: ['Good', 'Fair', 'Poor', 'Critical'].includes(p.cond) ? p.cond : '',
      life: (p.life === null || p.life === undefined || p.life === '' || !isFinite(Number(p.life))) ? null : Math.max(0, Math.round(Number(p.life))),
      phases: phases.length ? phases : cleanPhases([{ cost: 0, year: 0 }], cfg),
    };
  }
  const cleanList = (list, cfg) => (Array.isArray(list) ? list : []).filter((p) => p && !p.del).map((p, i) => cleanProject(p, 1000 + i, cfg));

  // ---------------------------------------------------------------- the math
  const pmt = (a, r, n) => (n <= 0 ? 0 : r > 0 ? a * r / (1 - Math.pow(1 + r, -n)) : a / n);
  function debtIn(cfg, fund, y) {
    const fy = cfg.start + y;
    return cfg.debt.reduce((a, d) => a + (d.fund === fund && fy <= d.last ? d.annual : 0), 0);
  }
  function sfFactor(cfg, fy, L) {
    if (!L.sf) return 1;
    const base = cfg.saveFY || cfg.start - 1;
    return (1 - sfCut(fy)) / (1 - sfCut(base));
  }
  /* new borrowing in the scenario: payments begin the year after issue */
  function finPay(cfg, fund, y, L) {
    const fy = cfg.start + y;
    return (L.fin || []).reduce((a, f) => a + (f.repay === fund && fy > f.fy && fy <= f.fy + f.years ? pmt(f.amount, f.rate, f.years) : 0), 0);
  }
  /* yearly costs charged to a capital fund in plan year y (none charged = 0, so earlier results are unchanged) */
  function recurIn(cfg, fund, y, L) {
    const fy = cfg.start + y;
    return (L.recur || []).reduce((a, r) => {
      if (r.fund !== fund || fy < r.first || (r.last != null && fy > r.last)) return a;
      const g = r.grows === 'inflation' ? L.infl : r.grows === 'settlement' ? (L.settle || 0) : 0;
      return a + r.amount * Math.pow(1 + g, fy - r.first);
    }, 0);
  }
  function finProceeds(cfg, y, L) {
    const fy = cfg.start + y;
    return (L.fin || []).reduce((a, f) => a + (f.fy === fy ? f.amount : 0), 0);
  }
  /* net receipts landing in plan year y; year 0 is scaled to the part of the year after the balance date */
  function inflow(cfg, bucket, y, L) {
    const f = y === 0 ? cfg.f0 : 1;
    if (bucket === 'save') return (cfg.saveInc * Math.pow(1 + L.sg, y) * sfFactor(cfg, cfg.start + y, L) - debtIn(cfg, 'save', y) - finPay(cfg, 'save', y, L) - cfg.saveOng - recurIn(cfg, 'save', y, L)) * f;
    if (bucket === 'ppel') return (cfg.ppelInc * Math.pow(1 + L.pg, y) - cfg.ppelOng - debtIn(cfg, 'ppel', y) - finPay(cfg, 'ppel', y, L) - recurIn(cfg, 'ppel', y, L)) * f;
    if (bucket === 'vppel') {
      const fy = cfg.start + y;
      return ((cfg.vStatus !== 'none' && L.vppel && fy >= cfg.vFirst && fy <= cfg.vLast) ? cfg.vAnnual : 0) * f - recurIn(cfg, 'vppel', y, L) * f;
    }
    if (bucket === 'grants') return (cfg.grantAvg * L.gy - recurIn(cfg, 'grants', y, L)) * f;
    return 0;
  }
  /* a completed phase with an actual cost counts at that cost, not the inflated estimate */
  const escalated = (ph, L) => (ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + L.infl, ph.year));
  const zero = () => { const o = {}; BUCKETS.forEach((k) => { o[k] = 0; }); return o; };

  function compute(projects, L, cfg) {
    const N = cfg.n;
    const carry = zero(); CAP_ORDER.forEach((b) => { carry[b] = cfg.open[b] || 0; });
    const res = cfg.years.map((fy) => ({ fy: fy, spend: {}, avail: {}, carryIn: {}, over: {}, ext: { boost: 0, camp: 0 }, total: 0 }));
    const spentByBucket = zero();
    let need = 0, finCarry = 0, financed = 0, unfunded = 0;
    for (let y = 0; y < N; y++) {
      const spend = zero();
      projects.forEach((p) => p.phases.forEach((ph) => {
        if (ph.year !== y) return;
        const c = escalated(ph, L); need += c; res[y].total += c;
        ph.funding.forEach((f) => { spend[f.b] += c * f.p / 100; });
      }));
      for (const b of CAP_ORDER) {
        const avail = carry[b] + inflow(cfg, b, y, L);
        res[y].carryIn[b] = carry[b]; res[y].avail[b] = avail; res[y].spend[b] = spend[b];
        const left = avail - spend[b]; res[y].over[b] = left < 0 ? -left : 0; carry[b] = left > 0 ? left : 0;
        spentByBucket[b] += spend[b];
      }
      res[y].ext.boost = spend.boost; res[y].ext.camp = spend.camp;
      spentByBucket.boost += spend.boost; spentByBucket.camp += spend.camp;
      /* campaign/bond items draw first on money raised or borrowed in this scenario */
      const pot = finCarry + finProceeds(cfg, y, L), used = Math.min(pot, spend.camp);
      res[y].fin = { avail: pot, used: used, unfunded: spend.camp - used }; finCarry = pot - used; financed += used; unfunded += spend.camp - used;
    }
    const overflow = res.reduce((a, m) => a + CAP_ORDER.reduce((s, b) => s + m.over[b], 0), 0);
    const levyFunded = spentByBucket.save + spentByBucket.ppel + spentByBucket.vppel + spentByBucket.grants;
    return { res, spentByBucket, need, overflow, levyFunded, financed, unfunded, finLeft: finCarry, gap: unfunded + overflow };
  }

  /* SAVE revenue-bond room: the lowest future year's SAVE ÷ coverage, as a level payment, at present value.
     Reproduces the planner exactly. Note: it divides receipts by the coverage BEFORE subtracting existing
     SAVE debt, and ignores ongoing SAVE commitments; the spec says after. Kept as-is by decision (29 Sept 2026);
     revisit before go-live (GO_LIVE.md). */
  function saveBondCapacity(cfg, L, rate, years, cover) {
    let low = Infinity, ly = 0;
    for (let y = 1; y < cfg.n; y++) {
      const L2 = Object.assign({}, L, { fin: (L.fin || []).filter((f) => f.repay !== 'save') });
      const net = cfg.saveInc * Math.pow(1 + L2.sg, y) * sfFactor(cfg, cfg.start + y, L2) / cover - debtIn(cfg, 'save', y) - finPay(cfg, 'save', y, L2);
      if (net < low) { low = net; ly = y; }
    }
    const pay = Math.max(0, low);
    const pv = rate > 0 ? pay * (1 - Math.pow(1 + rate, -years)) / rate : pay * years;
    return { pv: pv, pay: pay, fy: cfg.start + ly };
  }
  /* 5% of actual valuation, less GO principal outstanding and new GO borrowing in the scenario. Null if no valuation. */
  function goDebtRoom(cfg, L) {
    const actual = num(cfg.settings.ppel.actualValuation, 0);
    if (!actual) return null;
    const out = num(cfg.settings.ppel.goOutstanding, 0);
    return Math.max(0, actual * 0.05 - out - (L.fin || []).filter((f) => f.kind === 'go').reduce((a, f) => a + f.amount, 0));
  }

  return {
    VERSION: '2026-10-01',
    BUCKETS, BUCKET_NAMES, CAP_ORDER, PRI_LIST,
    fyOfDate, firstYearFraction, normSettings, makeConfig, defaultLevers, leversOf, cleanFin,
    cleanPhases, cleanProject, cleanList, cleanRecur, recurIn, compute, pmt, sfCut, saveBondCapacity, goDebtRoom,
  };
});
