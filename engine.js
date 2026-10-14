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

  /* SF 2472 (2026): share of SAVE cut from school infrastructure. LSA final fiscal note (FN 1605287, 15 Jul 2026), Fig. 7:
     statewide reductions of $38.9M, $58.6M, $71.7M, $105.5M, $121.5M for FY2027–FY2031, each divided by that year's
     projected current-law school-infrastructure SAVE: FY2026 $652.7M grown at the note's sales-tax growth of 2.0%, 2.9%,
     2.9%, 3.2%, 3.5% (FY2027–FY2031). Held at the FY2031 level afterwards. (Rule G7, checked 10 Oct 2026; the earlier
     version divided by a flat FY2026 base and overstated the cut.) */
  const SF2472_BASE = 652.7, SF2472_GROWTH = { 2027: 0.020, 2028: 0.029, 2029: 0.029, 2030: 0.032, 2031: 0.035 };
  const SF2472_DOLLARS = { 2027: 38.9, 2028: 58.6, 2029: 71.7, 2030: 105.5, 2031: 121.5 };
  const SF2472_CUT = (() => { const o = {}; let base = SF2472_BASE; for (let fy = 2027; fy <= 2031; fy++) { base *= 1 + SF2472_GROWTH[fy]; o[fy] = Math.round(SF2472_DOLLARS[fy] / base * 10000) / 10000; } return o; })();
  const sfCut = (fy) => (fy < 2027 ? 0 : SF2472_CUT[fy] != null ? SF2472_CUT[fy] : SF2472_CUT[2031]);

  /* Which fund may pay for what (Iowa law). 'no' = not allowed: the editor refuses it and the plan flags it.
     'check' = allowed only in some cases: the plan flags it for the business office to confirm.
     Sources: Iowa Code 298.3 (PPEL and V-PPEL uses; 298.3(4): not salaries, travel, supplies or maintenance),
     423F.3 (SAVE: school infrastructure only, not personnel; uses beyond levy relief need a revenue purpose statement).
     Grants, boosters and campaign money follow the donor's or grant's own terms. Rule C4, checked 10 Oct 2026. */
  const CAPITAL_LAW = ['save', 'ppel', 'vppel'];
  const LEGAL_YEARLY = {   // yearly-cost kind -> SAVE / PPEL / V-PPEL
    salary: 'no', benefits: 'no', supplies: 'no', activities: 'no', contract: 'check', other: 'check',
  };
  const LEGAL_TYPE = {     // initiative type (one-time phases) -> SAVE / PPEL / V-PPEL
    capital: 'ok', technology: 'check', program: 'check', other: 'check', staff: 'no', curriculum: 'no',   // a program's one-time costs may be a building or equipment
  };
  const WHY = {
    salary: 'pay salaries', benefits: 'pay staff benefits', supplies: 'buy supplies', activities: 'pay for activities',
    contract: 'pay contracts or subscriptions', other: 'pay this kind of yearly cost',
    staff: 'pay for staff or hires', program: 'pay a program’s one-time costs', curriculum: 'buy curriculum', technology: 'buy technology', type_other: 'pay for this kind of initiative',
  };
  const FUND_LABEL = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL' };
  const CITE = { save: 'Iowa Code 423F.3', ppel: 'Iowa Code 298.3', vppel: 'Iowa Code 298.3' };
  /** 'ok' | 'check' | 'no' for a fund paying a yearly cost of `kind`, or one-time phases of an initiative of `type` */
  function legality(fund, what) {
    if (!CAPITAL_LAW.includes(fund)) return { level: 'ok' };
    const level = what.kind != null ? (LEGAL_YEARLY[what.kind] || 'check') : (LEGAL_TYPE[what.type || 'capital'] || 'check');
    if (level === 'ok') return { level, text: fund === 'save' ? 'SAVE uses must be covered by the district’s revenue purpose statement.' : '' };
    const why = what.kind != null ? WHY[what.kind] || WHY.other : (what.type === 'other' ? WHY.type_other : WHY[what.type] || WHY.type_other);
    const text = level === 'no'
      ? `${FUND_LABEL[fund]} can’t be used to ${why} (${CITE[fund]}).`
      : `${FUND_LABEL[fund]} can be used to ${why} only in some cases${what.kind == null ? ', such as buildings, sites and equipment' : ''} (${CITE[fund]}${fund === 'save' ? '; the revenue purpose statement must cover it' : ''}). Confirm with the business office.`;
    return { level, text, cite: CITE[fund] };
  }
  /** every charge in a plan that the law doesn't allow ('no') or that needs checking ('check') */
  function checkLegal(projects, L) {
    const out = [];
    (projects || []).forEach((p) => {
      const funds = new Set();
      p.phases.forEach((ph) => { ph.funding.forEach((f) => funds.add(f.b)); (ph.options || []).forEach((b) => funds.add(b)); });
      funds.forEach((b) => { const g = legality(b, { type: p.type || 'capital' }); if (g.level !== 'ok') out.push({ level: g.level, fund: b, project: p.id, name: p.name, what: 'phase', text: g.text }); });
    });
    ((L && L.recur) || []).forEach((r) => {
      const g = legality(r.fund, { kind: r.kind || 'other' });
      if (g.level !== 'ok') out.push({ level: g.level, fund: r.fund, project: r.initiative_id, name: r.name || '', what: 'yearly', kind: r.kind, amount: r.amount, text: g.text });
    });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'no' ? -1 : 1));
  }

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
      save: { receipts: null, ongoing: 0, ongoingPct: null, trend: 0, sf2472: true, receiptsFY: null },
      ppel: { receipts: null, ongoing: 0, ongoingPct: null, growth: 0.03, valuation: null, rate: null, actualValuation: null, goOutstanding: null },
      vppel: { status: 'none', annual: 0, ongoing: 0, ongoingPct: null, firstFY: null, lastFY: null },
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
        annual: num(d.annual, 0), lastFY: num(d.lastFY, null), timing: ['after', 'before'].includes(d.timing) ? d.timing : 'spread' })) : [],
      inflation: num(s.inflation, 0),
    };
    out.save.sf2472 = !(out.save.sf2472 === false || out.save.sf2472 === 'false');
    out.save.receiptsFY = num(out.save.receiptsFY, null);
    const fy = fyOfDate(out.balances.asOf); if (fy) out.plan.startFY = fy;
    out.plan.years = Math.max(5, Math.min(15, Math.round(num(out.plan.years, 10))));
    if (!['none', 'proposed', 'active'].includes(out.vppel.status)) out.vppel.status = 'none';
    return out;
  }

  const pctOf = (v) => Math.max(0, Math.min(1, num(v, 0)));
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
      vStatus: v.status, vAnnual: num(v.annual, 0), vppelOng: num(v.ongoing, 0),
      /* an ongoing commitment set as a share of each year's receipts (0-1) instead of dollars; 0 = dollars only */
      saveOngPct: pctOf(s.save.ongoingPct), ppelOngPct: pctOf(s.ppel.ongoingPct), vppelOngPct: pctOf(v.ongoingPct),
      vFirst: num(v.firstFY, start), vLast: num(v.lastFY, start + n - 1),
      grantAvg: num(s.grants.avg, 0),
      /* a debt with no final year is treated as running to the end of the plan (it used to be dropped) */
      debt: s.debt.map((d) => ({ fund: d.fund, annual: num(d.annual, 0), last: num(d.lastFY, start + n - 1), timing: d.timing || 'spread' })),
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
      name: r.name ? String(r.name).slice(0, 90) : '', kind: r.kind || 'other', id: r.id, initiative_id: r.initiative_id,
    }));
  }
  function leversOf(stored, cfg) {
    const o = Object.assign(defaultLevers(cfg), clone(stored || {}));
    o.fin = cleanFin(o.fin, cfg); o.sf = !!o.sf; o.recur = cleanRecur(o.recur); o.settle = num(o.settle, 0);
    return o;
  }

  function cleanPhases(raw, cfg, type) {
    const N = cfg.n;
    return (Array.isArray(raw) ? raw : []).map((ph) => {
      let f = Array.isArray(ph && ph.funding)
        ? ph.funding.map((x) => x && { b: BUCKET_ALIAS[x.b] || x.b, p: Number(x.p) || 0 }).filter((x) => x && BUCKETS.includes(x.b)) : [];
      const merged = []; f.forEach((x) => { const hit = merged.find((m) => m.b === x.b); if (hit) hit.p += x.p; else merged.push(x); });
      f = merged.slice(0, 3);
      if (!f.length) f = [{ b: 'save', p: 100 }];
      const tot = f.reduce((a, x) => a + x.p, 0);
      if (tot !== 100 && tot > 0) {   // rescale to 100; rounding leftovers go to the largest share so the whole cost is charged
        f.forEach((x) => { x.p = Math.round(x.p / tot * 100); });
        const left = 100 - f.reduce((a, x) => a + x.p, 0);
        if (left) f.reduce((m, x) => (x.p > m.p ? x : m), f[0]).p += left;
      }
      if (tot === 0) f.forEach((x, i) => { x.p = i === 0 ? 100 : 0; });
      const o = { cost: Math.max(0, Number(ph && ph.cost) || 0), year: Math.max(0, Math.min(N - 1, Number(ph && ph.year) || 0)), funding: f };
      /* "whichever has room": two or three funds in order of preference; the phase is paid in full from one of them */
      const opts = Array.isArray(ph && ph.options) ? [...new Set(ph.options.map((b) => BUCKET_ALIAS[b] || b).filter((b) => BUCKETS.includes(b)))]
        .filter((b) => legality(b, { type: type || 'capital' }).level !== 'no').slice(0, 3) : [];   // never choose a fund the law doesn't allow
      if (opts.length > 1) { o.options = opts; o.funding = [{ b: opts[0], p: 100 }]; }
      else if (opts.length === 1 && Array.isArray(ph && ph.options) && ph.options.length > 1) o.funding = [{ b: opts[0], p: 100 }];   // the only allowed choice left
      if (ph && (ph.status === 'underway' || ph.status === 'done')) o.status = ph.status;
      if (ph && ph.actual != null && ph.actual !== '' && isFinite(Number(ph.actual))) o.actual = Math.max(0, Number(ph.actual));
      if (ph && typeof ph.label === 'string' && ph.label.trim()) o.label = ph.label.trim().slice(0, 80);
      return o;
    }).slice(0, 12);
  }
  function cleanProject(p, fallbackId, cfg) {
    const type = typeof p.type === 'string' && LEGAL_TYPE[p.type] ? p.type : 'capital';
    const phases = cleanPhases(p.phases, cfg, type);
    return {
      id: p.id != null ? p.id : fallbackId,
      name: (typeof p.name === 'string' && p.name.trim()) ? p.name.trim().slice(0, 90) : 'Untitled project', type,
      pri: PRI_LIST.includes(p.pri) ? p.pri : '', est: p.est !== false,
      area: typeof p.area === 'string' ? p.area.slice(0, 40) : '',
      cond: ['Good', 'Fair', 'Poor', 'Critical'].includes(p.cond) ? p.cond : '',
      life: (p.life === null || p.life === undefined || p.life === '' || !isFinite(Number(p.life))) ? null : Math.max(0, Math.round(Number(p.life))),
      phases: phases.length ? phases : cleanPhases([{ cost: 0, year: 0 }], cfg, type),
    };
  }
  const cleanList = (list, cfg) => (Array.isArray(list) ? list : []).filter((p) => p && !p.del).map((p, i) => cleanProject(p, 1000 + i, cfg));

  // ---------------------------------------------------------------- the math
  const pmt = (a, r, n) => (n <= 0 ? 0 : r > 0 ? a * r / (1 - Math.pow(1 + r, -n)) : a / n);
  function debtIn(cfg, fund, y) {
    const fy = cfg.start + y;
    return cfg.debt.reduce((a, d) => a + (d.fund === fund && fy <= d.last ? d.annual : 0), 0);
  }
  /* existing debt still to pay in plan year y. Year 0 after a mid-year balance date: payments due after that date
     ('after') count in full, payments already made ('before') not at all, 'spread' (the default) in proportion. */
  function debtDue(cfg, fund, y) {
    if (y !== 0 || cfg.f0 >= 1) return debtIn(cfg, fund, y);
    return cfg.debt.reduce((a, d) => a + (d.fund === fund && cfg.start <= d.last ? d.annual * (d.timing === 'after' ? 1 : d.timing === 'before' ? 0 : cfg.f0) : 0), 0);
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
  /* a fund's receipts in plan year y, before anything comes out (V-PPEL: 0 in years it isn't collected) */
  function receiptsIn(cfg, bucket, y, L) {
    if (bucket === 'save') return cfg.saveInc * Math.pow(1 + L.sg, y) * sfFactor(cfg, cfg.start + y, L);
    if (bucket === 'ppel') return cfg.ppelInc * Math.pow(1 + L.pg, y);
    if (bucket === 'vppel') { const fy = cfg.start + y; return cfg.vStatus !== 'none' && L.vppel && fy >= cfg.vFirst && fy <= cfg.vLast ? cfg.vAnnual : 0; }
    return 0;
  }
  /* ongoing commitments in plan year y: the dollar amount, plus any share of that year's receipts (so a percentage follows
     receipts up or down: SF 2472's SAVE cut, valuation growth). V-PPEL's comes out only in the years it's collected. */
  function ongoingIn(cfg, bucket, y, L) {
    if (bucket === 'save') return cfg.saveOng + (cfg.saveOngPct ? cfg.saveOngPct * receiptsIn(cfg, 'save', y, L) : 0);
    if (bucket === 'ppel') return cfg.ppelOng + (cfg.ppelOngPct ? cfg.ppelOngPct * receiptsIn(cfg, 'ppel', y, L) : 0);
    if (bucket === 'vppel') { const r = receiptsIn(cfg, 'vppel', y, L); return r ? (cfg.vppelOng || 0) + (cfg.vppelOngPct || 0) * r : 0; }
    return 0;
  }
  /* net receipts landing in plan year y; year 0 is scaled to the part of the year after the balance date */
  function inflow(cfg, bucket, y, L) {
    const f = y === 0 ? cfg.f0 : 1;
    if (bucket === 'save') return (cfg.saveInc * Math.pow(1 + L.sg, y) * sfFactor(cfg, cfg.start + y, L) - finPay(cfg, 'save', y, L) - ongoingIn(cfg, 'save', y, L) - recurIn(cfg, 'save', y, L)) * f - debtDue(cfg, 'save', y);
    if (bucket === 'ppel') return (cfg.ppelInc * Math.pow(1 + L.pg, y) - ongoingIn(cfg, 'ppel', y, L) - finPay(cfg, 'ppel', y, L) - recurIn(cfg, 'ppel', y, L)) * f - debtDue(cfg, 'ppel', y);
    if (bucket === 'vppel') {
      /* ongoing V-PPEL commitments (devices, buses the ballot names) come out only in the years the levy is collected */
      const r = receiptsIn(cfg, 'vppel', y, L);
      return (r ? r - ongoingIn(cfg, 'vppel', y, L) : 0) * f - recurIn(cfg, 'vppel', y, L) * f;
    }
    if (bucket === 'grants') return (cfg.grantAvg * L.gy - recurIn(cfg, 'grants', y, L)) * f;
    return 0;
  }
  /* a completed phase with an actual cost counts at that cost, not the inflated estimate */
  const escalated = (ph, L) => (ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + L.infl, ph.year));
  const zero = () => { const o = {}; BUCKETS.forEach((k) => { o[k] = 0; }); return o; };
  const lexLess = (a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] < b[j]; return false; };

  function compute(projects, L, cfg) {
    const N = cfg.n;
    const carry = zero(); CAP_ORDER.forEach((b) => { carry[b] = cfg.open[b] || 0; });
    const res = cfg.years.map((fy) => ({ fy: fy, spend: {}, avail: {}, carryIn: {}, over: {}, ext: { boost: 0, camp: 0 }, total: 0 }));
    const spentByBucket = zero();
    let need = 0, finCarry = 0, financed = 0, unfunded = 0;
    const pick = new Map(), picks = [];
    /* fixed-fund spending by year (phases without a choice), for the look-ahead when a phase can use several funds */
    const fixedSpend = cfg.years.map(() => zero()), flexHeld = cfg.years.map(() => zero());
    projects.forEach((p) => p.phases.forEach((ph) => {
      if (ph.year < 0 || ph.year >= N || (ph.options && ph.options.length > 1)) return;
      const c = escalated(ph, L); ph.funding.forEach((f) => { fixedSpend[ph.year][f.b] += c * f.p / 100; });
    }));
    for (let y = 0; y < N; y++) {
      const spend = zero(), flex = [];
      projects.forEach((p) => p.phases.forEach((ph) => {
        if (ph.year !== y) return;
        const c = escalated(ph, L); need += c; res[y].total += c;
        if (ph.options && ph.options.length > 1) flex.push([p, ph, c]);
        else ph.funding.forEach((f) => { spend[f.b] += c * f.p / 100; });
      }));
      /* phases that can use any of several funds: after the fixed ones, in list order, each takes the first fund with room
         for all of it; when none has room it goes to the one with the most room (and the shortfall counts in the gap).
         Boosters and campaign/bond have no yearly limit, so as a choice they always have room. */
      if (flex.length) {
        /* room this year, and "safe" room: what can be taken now without leaving a later year's fixed-fund phases short
           (the lowest running balance from this year to the end of the plan, counting later fixed spending) */
        const room = {}, safe = {};
        /* a campaign or bond is the last resort for what no levy fund can pay, but it pays only what this scenario raises or
           borrows: between choices that leave the levy funds equally short, the one that leaves less to an unfinanced campaign wins
           (so boosters, when listed, beat a campaign with nothing behind it; found by the random-district checks, 14 Oct 2026) */
        const campRoom = Math.max(0, finCarry + finProceeds(cfg, y, L) - spend.camp);
        CAP_ORDER.forEach((b) => {
          room[b] = carry[b] + inflow(cfg, b, y, L) - spend[b];
          let run = room[b], low = run;
          for (let t = y + 1; t < N; t++) { run += inflow(cfg, b, t, L) - fixedSpend[t][b] - flexHeld[t][b]; if (run < low) low = run; }
          safe[b] = Math.min(room[b], low);
        });
        const capital = (o) => CAP_ORDER.includes(o);
        /* up to 8 such phases in a year: try every combination and keep the one that leaves the least short, now or in a later year
           (the "safe" room), then the least short this year, then the earliest choices for the highest-ranked phases (list order).
           More than 8: one at a time, in list order, each taking the first fund that has safe room, else room this year. */
        let choice = null;
        if (flex.length <= 8) {
          const n = flex.length, idx = new Array(n).fill(0);
          let best = null;
          for (;;) {
            const use = { camp: 0 }; CAP_ORDER.forEach((b) => { use[b] = 0; });
            for (let k = 0; k < n; k++) { const b = flex[k][1].options[idx[k]]; if (capital(b) || b === 'camp') use[b] += flex[k][2]; }
            let shortSafe = 0, shortNow = 0;
            const campShort = Math.max(0, use.camp - campRoom);
            CAP_ORDER.forEach((b) => { shortSafe += Math.max(0, use[b] - Math.max(0, safe[b])); shortNow += Math.max(0, use[b] - Math.max(0, room[b])); });
            const key = [Math.round(shortSafe), Math.round(shortNow), Math.round(campShort)].concat(idx);
            if (!best || lexLess(key, best)) best = key;
            let k = n - 1; while (k >= 0 && ++idx[k] >= flex[k][1].options.length) { idx[k] = 0; k--; }
            if (k < 0) break;
          }
          choice = best.slice(3);
        }
        flex.forEach(([p, ph, c], k) => {
          let b;
          if (choice) b = ph.options[choice[k]];
          else {
            b = ph.options.find((o) => (o === 'camp' ? campRoom >= c - 0.5 : !capital(o) || safe[o] >= c - 0.5));   // fits now and later
            if (!b) b = ph.options.find((o) => !capital(o));                                  // boosters, or a campaign as the last resort
            if (!b) b = ph.options.find((o) => capital(o) && room[o] >= c - 0.5);            // fits now only
            if (!b) b = ph.options.slice().sort((a, z) => (capital(z) ? safe[z] : Infinity) - (capital(a) ? safe[a] : Infinity))[0];
          }
          spend[b] += c; if (capital(b)) { room[b] -= c; safe[b] -= c; }
          pick.set(ph, b); picks.push({ project: p.id, fy: cfg.start + y, b, first: b === ph.options[0], fits: !capital(b) || room[b] >= -0.5 });
        });
      }
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
    return { res, spentByBucket, need, overflow, levyFunded, financed, unfunded, finLeft: finCarry, gap: unfunded + overflow, pick, picks };
  }

  /* SAVE revenue-bond room: the level payment the lowest future year can carry, at present value. Two limits, the lower wins
     (issue 13, 10 Oct 2026):
       coverage   – SAVE receipts must cover ALL SAVE debt payments `cover` times: new ≤ receipts ÷ cover − existing payments;
       cash       – receipts must still pay the ongoing SAVE commitments too: new ≤ receipts − ongoing − existing payments.
     Coverage is a market assumption (often 1.20–1.25×), not set in statute (Iowa Code 423F.4). */
  function saveBondCapacity(cfg, L, rate, years, cover) {
    let low = Infinity, ly = 0;
    for (let y = 1; y < cfg.n; y++) {
      const L2 = Object.assign({}, L, { fin: (L.fin || []).filter((f) => f.repay !== 'save') });
      const rec = cfg.saveInc * Math.pow(1 + L2.sg, y) * sfFactor(cfg, cfg.start + y, L2), owed = debtIn(cfg, 'save', y) + finPay(cfg, 'save', y, L2);
      const net = Math.min(rec / cover - owed, rec - (cfg.saveOng + cfg.saveOngPct * rec) - owed);
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
    VERSION: '2026-10-14d',
    BUCKETS, BUCKET_NAMES, CAP_ORDER, PRI_LIST, SF2472_CUT, LEGAL_YEARLY, LEGAL_TYPE,
    fyOfDate, firstYearFraction, normSettings, makeConfig, defaultLevers, leversOf, cleanFin,
    cleanPhases, cleanProject, cleanList, cleanRecur, recurIn, receiptsIn, ongoingIn, debtIn, debtDue, finPay, inflow, compute, pmt, sfCut, saveBondCapacity, goDebtRoom, legality, checkLegal,
  };
});
