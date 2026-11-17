/* HighGround — capital funds engine (pure module, no globals, no page access). Each state's funds, laws, calendar and
   limits come from its pack in states.js; a district with no state is Iowa.
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
  const ST = root.HGStates || (typeof require === 'function' ? require('./states.js') : null);
  const api = factory(ST);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGEngine = api;
})(typeof self !== 'undefined' ? self : this, function (ST) {
  'use strict';
  /* the district's state pack (states.js). No state = Iowa, so every stored Iowa district and test reads exactly as before. */
  const packOf = (code) => ST.pack(code || ST.current().code);   // no state given: the one on screen (Iowa in node)

  const BUCKETS = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp'];
  const BUCKET_NAMES = Object.fromEntries(BUCKETS.map((b) => [b, ST.label(b, 'IA')]));   // Iowa's names; other states: bucketNames(state)
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
  /* the tables themselves live in each state's pack (states.js → legal); these are Iowa's, kept as exports */
  const LEGAL_YEARLY = packOf('IA').legal.yearly;   // yearly-cost kind -> the capital funds
  const LEGAL_TYPE = packOf('IA').legal.type;       // initiative type (one-time phases) -> the capital funds
  const WHY = {
    salary: 'pay salaries', benefits: 'pay staff benefits', supplies: 'buy supplies', activities: 'pay for activities',
    contract: 'pay contracts or subscriptions', other: 'pay this kind of yearly cost',
    staff: 'pay for staff or hires', program: 'pay a program’s one-time costs', curriculum: 'buy curriculum', technology: 'buy technology', type_other: 'pay for this kind of initiative',
  };
  /** 'ok' | 'check' | 'no' for a fund paying a yearly cost of `kind`, or one-time phases of an initiative of `type`, under the
      district's state's rules (no state = Iowa) */
  function legality(fund, what, state) {
    const G = packOf(state).legal;
    if (!G.funds.includes(fund)) return { level: 'ok' };
    const byFund = (G.typeByFund && G.typeByFund[fund]) || {};
    const level = what.kind != null ? (G.yearly[what.kind] || 'check') : (byFund[what.type || 'capital'] || G.type[what.type || 'capital'] || 'check');
    const name = ST.label(fund, state), cite = G.cite[fund];
    if (level === 'ok') return { level, text: G.okNote[fund] || '' };
    const why = what.kind != null ? WHY[what.kind] || WHY.other : (what.type === 'other' ? WHY.type_other : WHY[what.type] || WHY.type_other);
    const own = what.kind == null && G.checkText && G.checkText[fund];
    const text = level === 'no'
      ? `${name} can’t be used to ${why} (${cite}).`
      : own ? own.replace('{cite}', cite)
      : `${name} can be used to ${why} only in some cases${what.kind == null ? ', such as buildings, sites and equipment' : ''} (${cite}${G.checkNote[fund] || ''}). Confirm with the business office.`;
    return { level, text, cite };
  }
  /** every charge in a plan that the law doesn't allow ('no') or that needs checking ('check') */
  function checkLegal(projects, L, state) {
    const out = [];
    (projects || []).forEach((p) => {
      const funds = new Set();
      p.phases.forEach((ph) => { ph.funding.forEach((f) => funds.add(f.b)); (ph.options || []).forEach((b) => funds.add(b)); });
      funds.forEach((b) => { const g = legality(b, { type: p.type || 'capital' }, state); if (g.level !== 'ok') out.push({ level: g.level, fund: b, project: p.id, name: p.name, what: 'phase', text: g.text }); });
    });
    ((L && L.recur) || []).forEach((r) => {
      const g = legality(r.fund, { kind: r.kind || 'other' }, state);
      if (g.level !== 'ok') out.push({ level: g.level, fund: r.fund, project: r.initiative_id, name: r.name || '', what: 'yearly', kind: r.kind, amount: r.amount, text: g.text });
    });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'no' ? -1 : 1));
  }

  const num = (v, d) => { const n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? d : n; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* fiscal years by the state's calendar (states.js), named for the year they end. Iowa: 1 July – 30 June, and a 30 June
     close is the opening balance of the next year. Nebraska: 1 September – 31 August. */
  const fyOfDate = (iso, state) => ST.fyOfDate(iso, state);
  /* share of the first plan year's receipts still to come after the balance date */
  function firstYearFraction(iso, state) {
    const fy = fyOfDate(iso, state); if (!fy) return { f: 1, months: 12 };
    const sm = (packOf(state).fyStartMonth || 7) - 1;
    const start = Date.UTC(fy - 1, sm, 1), end = Date.UTC(fy, sm, 1);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86400000;
    if (t <= start + 86400000) return { f: 1, months: 12 };
    const f = Math.max(0, Math.min(1, (end - t) / (end - start)));
    return { f: f, months: Math.round(f * 12 * 10) / 10 };
  }

  function blankSettings(todayIso, state) {
    return {
      state: ST.pack(state || ST.current().code).code,
      district: { name: '', short: '', enrollment: null },
      plan: { startFY: fyOfDate(todayIso || new Date().toISOString().slice(0, 10), state), years: 10 },
      balances: { asOf: '', save: null, ppel: null, vppel: 0, grants: 0 },
      save: { receipts: null, ongoing: 0, ongoingPct: null, trend: 0, sf2472: true, receiptsFY: null },
      ppel: { receipts: null, ongoing: 0, ongoingPct: null, growth: 0.03, valuation: null, rate: null, actualValuation: null, goOutstanding: null },
      vppel: { status: 'none', annual: 0, ongoing: 0, ongoingPct: null, firstFY: null, lastFY: null },
      grants: { avg: 0, yield: 0.75 },
      /* Nebraska's lid inputs (district_settings.state_inputs.lid): General Fund levy rate, other levies under the lid, the
         property tax request authority for General + Special Building, its growth, and whether the board takes the extra
         growth (70% vote). Empty for Iowa. */
      lid: {},
      debt: [],
      inflation: 0,
    };
  }
  function normSettings(s, todayIso) {
    s = s || {};
    const b = blankSettings(todayIso, s.state);
    const out = {
      state: b.state,
      district: Object.assign(b.district, s.district || {}),
      plan: Object.assign(b.plan, s.plan || {}),
      balances: Object.assign(b.balances, s.balances || {}),
      save: Object.assign(b.save, s.save || {}),
      ppel: Object.assign(b.ppel, s.ppel || {}),
      vppel: Object.assign(b.vppel, s.vppel || {}),
      grants: Object.assign(b.grants, s.grants || {}),
      lid: Object.assign(b.lid, s.lid || {}),
      debt: Array.isArray(s.debt) ? s.debt.map((d) => ({ name: String(d.name || 'Debt obligation'), fund: d.fund === 'ppel' ? 'ppel' : 'save',
        annual: num(d.annual, 0), lastFY: num(d.lastFY, null), timing: ['after', 'before'].includes(d.timing) ? d.timing : 'spread' })) : [],
      inflation: num(s.inflation, 0),
    };
    out.save.sf2472 = !(out.save.sf2472 === false || out.save.sf2472 === 'false') && ST.feature('sf2472', out.state);
    out.save.receiptsFY = num(out.save.receiptsFY, null);
    const fy = fyOfDate(out.balances.asOf, out.state); if (fy) out.plan.startFY = fy;
    out.plan.years = Math.max(5, Math.min(15, Math.round(num(out.plan.years, 10))));
    if (!['none', 'proposed', 'active'].includes(out.vppel.status)) out.vppel.status = 'none';
    return out;
  }

  const pctOf = (v) => Math.max(0, Math.min(1, num(v, 0)));
  /** Nebraska's base growth percentage for each plan year (states.js NE.lid.growthRule, 79-3402(3)).
      hist: fall membership, oldest first, the newest being the fall the first plan year's authority was certified on;
      memGrowth: expected yearly change after that; lepPov: the LEP and poverty parts, a share a year. growth[0] = 0 (the
      first year's authority is NDE's certified figure); growth[t] takes the authority from year t-1 to year t. */
  function authorityGrowth(rule, hist, memGrowth, lepPov, n) {
    const m = (hist || []).map(Number).filter((x) => x > 0);
    if (!m.length) return null;
    const out = [0];
    for (let t = 1; t < n; t++) {
      m.push(m[m.length - 1] * (1 + memGrowth));
      const k = m.length - 1, rise = m[k] / m[k - 1] - 1;
      /* the average of the last three yearly rises, and the students gained over them */
      const back = Math.min(3, k), avg = back ? [...Array(back).keys()].reduce((a, j) => a + m[k - j] / m[k - j - 1] - 1, 0) / back : 0, students = m[k] - m[k - back];
      let f = rule.otherFactor;
      for (const [minAvg, minStudents, factor] of rule.tiers) if (back >= 3 && avg >= minAvg - 1e-12 && students >= minStudents) { f = factor; break; }
      out.push(rule.base + Math.max(0, rise) * f + Math.max(0, lepPov || 0));
    }
    return out;
  }
  function lidConfig(P, s, lid, n) {
    const bump = lid.boardBump ? ST.boardBump(s.district.enrollment, P.code) : 0;
    /* a growth entered by hand is used every year; otherwise NDE's formula from fall membership, when it's there */
    const formula = num(lid.growth, null) == null && Array.isArray(lid.memHist) && lid.memHist.length >= 2 && P.lid.growthRule
      ? authorityGrowth(P.lid.growthRule, lid.memHist, num(lid.memGrowth, 0), num(lid.lepPov, 0), n) : null;
    const growth = num(lid.growth, P.lid.baseGrowth) + bump;
    const path = formula ? formula.map((g, t) => (t ? g + bump : 0)) : null;
    const gfGrowth = num(lid.gfGrowth, num(lid.growth, P.lid.baseGrowth));
    /* cumulative factors: the authority, and the General Fund levy (it follows the authority unless given its own growth) */
    const authF = [1], gfF = [1];
    for (let t = 1; t < n; t++) {
      authF.push(authF[t - 1] * (1 + (path ? path[t] : growth)));
      gfF.push(gfF[t - 1] * (1 + (num(lid.gfGrowth, null) != null || !path ? gfGrowth : path[t] - bump)));
    }
    const voter = !!lid.sbVoter && P.lid.sbVoterMax;
    /* a levy override for building purposes (77-3444: a majority of voters, at most five years) */
    const ov = lid.override && num(lid.override.cents, 0) > 0 ? { rate: num(lid.override.cents, 0) / 100, first: num(lid.override.first, s.plan.startFY), last: num(lid.override.last, s.plan.startFY + 4),
      authorityVote: !!lid.override.authorityVote } : null;
    if (ov && ov.last - ov.first + 1 > (P.lid.overrideMaxYears || 5)) ov.last = ov.first + (P.lid.overrideMaxYears || 5) - 1;
    return {
      per: P.rate.per, valuation: num(s.ppel.valuation, 0), sbRate: num(s.ppel.rate, null), sbMax: voter ? P.lid.sbVoterMax : P.lid.sbMax, sbVoter: !!voter, levyLid: P.lid.levy,
      override: ov, sbVoterMax: P.lid.sbVoterMax || null,
      gfRate: num(lid.gfRate, null), otherRate: num(lid.otherRate, 0), authority: num(lid.authority, null),
      growth, gfGrowth, growthPath: path, authF, gfF, formula: !!path,
      carry: Math.max(0, num(lid.carry, 0)),   // prior years' unused authority at the start of the plan (NDE certification)
    };
  }
  /** Everything the math needs, derived once from the settings. */
  function makeConfig(settings, todayIso) {
    const s = normSettings(settings, todayIso);
    const start = s.plan.startFY, n = s.plan.years;
    const fr = firstYearFraction(s.balances.asOf, s.state);
    const v = s.vppel, P = packOf(s.state), saveOn = ST.on('save', s.state), lid = s.lid || {};
    const years = [];
    for (let i = 0; i < n; i++) years.push(start + i);
    return {
      settings: s, state: P.code, start: start, n: n, years: years, f0: fr.f, months0: fr.months,
      open: { save: saveOn ? num(s.balances.save, 0) : 0, ppel: num(s.balances.ppel, 0), vppel: num(s.balances.vppel, 0), grants: num(s.balances.grants, 0) },
      saveInc: saveOn ? num(s.save.receipts, 0) : 0, saveOng: saveOn ? num(s.save.ongoing, 0) : 0, saveFY: num(s.save.receiptsFY, null),
      ppelInc: num(s.ppel.receipts, 0), ppelOng: num(s.ppel.ongoing, 0),
      vStatus: v.status, vAnnual: num(v.annual, 0), vppelOng: num(v.ongoing, 0),
      /* an ongoing commitment set as a share of each year's receipts (0-1) instead of dollars; 0 = dollars only */
      saveOngPct: pctOf(s.save.ongoingPct), ppelOngPct: pctOf(s.ppel.ongoingPct), vppelOngPct: pctOf(v.ongoingPct),
      vFirst: num(v.firstFY, start), vLast: num(v.lastFY, start + n - 1),
      grantAvg: num(s.grants.avg, 0),
      /* Special Building room under Nebraska's limits (method 'lid_shared'); null = receipts grow with valuation, as in Iowa */
      lid: P.funds.ppel.method === 'lid_shared' ? lidConfig(P, s, lid, n) : null,
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
    const kinds = packOf(cfg.state).financing;   // the kinds this state has (Nebraska: no SAVE revenue bond)
    return (Array.isArray(list) ? list : []).map((f) => ({
      name: String(f.name || 'Financing').slice(0, 60),
      kind: kinds.includes(f.kind) ? f.kind : 'go',
      fy: Math.round(num(f.fy, cfg.start)), amount: Math.max(0, num(f.amount, 0)),
      rate: Math.max(0, num(f.rate, 0)), years: Math.max(0, Math.round(num(f.years, 0))),
      /* a lease or (Nebraska) a QCPUF bond can be repaid from the second levy: 'vppel' */
      repay: f.kind === 'rev' ? 'save' : f.kind === 'lease' ? (f.repay === 'save' ? 'save' : f.repay === 'vppel' ? 'vppel' : 'ppel') : f.kind === 'gift' ? 'none' : 'levy',
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
    o.fin = cleanFin(o.fin, cfg); o.sf = !!o.sf && ST.feature('sf2472', cfg.state); o.recur = cleanRecur(o.recur); o.settle = num(o.settle, 0);
    return o;
  }

  function cleanPhases(raw, cfg, type) {
    const N = cfg.n;
    return (Array.isArray(raw) ? raw : []).map((ph) => {
      let f = Array.isArray(ph && ph.funding)
        ? ph.funding.map((x) => x && { b: BUCKET_ALIAS[x.b] || x.b, p: Number(x.p) || 0 }).filter((x) => x && BUCKETS.includes(x.b)) : [];
      const merged = []; f.forEach((x) => { const hit = merged.find((m) => m.b === x.b); if (hit) hit.p += x.p; else merged.push(x); });
      f = merged.slice(0, 3);
      if (!f.length) f = [{ b: ST.defaultFund(cfg.state), p: 100 }];   // no fund given: the state's first capital fund
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
        .filter((b) => legality(b, { type: type || 'capital' }, cfg.state).level !== 'no').slice(0, 3) : [];   // never choose a fund the law doesn't allow
      if (opts.length > 1) { o.options = opts; o.funding = [{ b: opts[0], p: 100 }]; }
      else if (opts.length === 1 && Array.isArray(ph && ph.options) && ph.options.length > 1) o.funding = [{ b: opts[0], p: 100 }];   // the only allowed choice left
      if (ph && (ph.status === 'underway' || ph.status === 'done')) o.status = ph.status;
      if (ph && ph.actual != null && ph.actual !== '' && isFinite(Number(ph.actual))) o.actual = Math.max(0, Number(ph.actual));
      if (ph && typeof ph.label === 'string' && ph.label.trim()) o.label = ph.label.trim().slice(0, 80);
      return o;
    }).slice(0, 12);
  }
  function cleanProject(p, fallbackId, cfg) {
    const type = typeof p.type === 'string' && packOf(cfg && cfg.state).legal.type[p.type] ? p.type : 'capital';
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
    if (!L.sf || !ST.feature('sf2472', cfg.state)) return 1;
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
    if (bucket === 'ppel') return cfg.lid ? lidRoom(cfg, y, L).receipts : cfg.ppelInc * Math.pow(1 + L.pg, y);
    if (bucket === 'vppel') { const fy = cfg.start + y; return cfg.vStatus !== 'none' && L.vppel && fy >= cfg.vFirst && fy <= cfg.vLast ? cfg.vAnnual : 0; }
    return 0;
  }
  /* Nebraska: what the Special Building levy can raise in plan year y, the least of three limits (states.js NE.lid):
       rate  – the Special Building rate (at most 14¢) × valuation;
       lid   – the $1.05 levy lid, less the General Fund levy and any other levy under it, × valuation;
       authority – the property tax request authority for General + Special Building, grown each year, plus what earlier
                   years left unused, less the General Fund's property tax.
     Valuation grows with the valuation-growth lever. The General Fund's property tax starts at its rate × valuation and grows
     with the authority (lid.gfGrowth, default the authority's growth) [assumed: the board keeps the General Fund's share of
     the authority steady]. With no lid inputs, the entered receipts grow with valuation. */
  function lidRoom(cfg, y, L) {
    /* walk the years up to y: what the district doesn't request one year carries into the next (NDE certification, "Prior
       Years Unused Property Tax Authority"); X.carry is what was already unused before the plan starts */
    const X = cfg.lid, per = X.per;
    let carry = X.carry || 0, out = null;
    for (let t = 0; t <= y; t++) {
      const g = Math.pow(1 + L.pg, t), V = X.valuation * g;
      const gfLevy = X.gfRate == null ? null : X.gfRate * X.valuation / per * (X.gfF && X.gfF[t] != null ? X.gfF[t] : Math.pow(1 + X.gfGrowth, t));
      /* a levy override (77-3444) for building purposes in its years: the lid rises by the override, Special Building may go to
         NDE's 17.5¢, and the request authority rises by the same levy only if voters also approved exceeding it (79-3405) */
      const OV = X.override, fy = cfg.start + t, ovOn = !!(OV && OV.rate > 0 && fy >= OV.first && fy <= OV.last);
      const ovRate = ovOn ? OV.rate : 0, sbCap = ovOn && X.sbVoterMax ? Math.max(X.sbMax, X.sbVoterMax) : X.sbMax;
      const byRate = X.sbRate != null && V > 0 ? Math.min(X.sbRate, sbCap) * V / per : cfg.ppelInc * g;
      const byLid = gfLevy != null && V > 0 ? Math.max(0, (X.levyLid + ovRate - X.otherRate) * V / per - gfLevy) : Infinity;
      const base0 = X.authority == null ? null : X.authority * (X.authF && X.authF[t] != null ? X.authF[t] : Math.pow(1 + X.growth, t));
      const base = base0 == null ? null : base0 + (ovOn && OV.authorityVote ? ovRate * V / per : 0);
      const byAuth = base != null && gfLevy != null ? Math.max(0, base + carry - gfLevy) : Infinity;
      const receipts = Math.max(0, Math.min(byRate, byLid, byAuth));
      const limit = receipts === byRate ? 'rate' : receipts === byLid ? 'lid' : 'authority';
      out = { receipts, byRate, byLid, byAuth, limit, valuation: V, gfLevy, carryIn: carry, authority: base, override: ovOn };
      if (base != null && gfLevy != null) carry = Math.max(0, base + carry - gfLevy - receipts);   // unused this year, carried forward
    }
    out.carryOut = carry;
    return out;
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
      return (r ? r - ongoingIn(cfg, 'vppel', y, L) : 0) * f - recurIn(cfg, 'vppel', y, L) * f - finPay(cfg, 'vppel', y, L) * f;
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
    if (!ST.on('save', cfg.state) || !ST.feature('saveBond', cfg.state)) return { pv: 0, pay: 0, fy: cfg.start, none: true };
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
  /* the state's GO debt limit (Iowa: 5% of actual valuation), less GO principal outstanding and new GO borrowing in the
     scenario. Null if no valuation, or if the state's pack sets no limit HighGround checks (Nebraska). */
  function goDebtRoom(cfg, L) {
    const share = packOf(cfg.state).debt.limitShare;
    if (share == null) return null;
    const actual = num(cfg.settings.ppel.actualValuation, 0);
    if (!actual) return null;
    const out = num(cfg.settings.ppel.goOutstanding, 0);
    return Math.max(0, actual * share - out - (L.fin || []).filter((f) => f.kind === 'go').reduce((a, f) => a + f.amount, 0));
  }

  return {
    VERSION: '2026-11-11',
    BUCKETS, BUCKET_NAMES, bucketNames: (state) => Object.fromEntries(BUCKETS.map((b) => [b, ST.label(b, state)])), lidRoom, authorityGrowth, CAP_ORDER, PRI_LIST, SF2472_CUT, LEGAL_YEARLY, LEGAL_TYPE,
    fyOfDate, firstYearFraction, normSettings, makeConfig, defaultLevers, leversOf, cleanFin,
    cleanPhases, cleanProject, cleanList, cleanRecur, recurIn, receiptsIn, ongoingIn, debtIn, debtDue, finPay, inflow, compute, pmt, sfCut, saveBondCapacity, goDebtRoom, legality, checkLegal,
  };
});
