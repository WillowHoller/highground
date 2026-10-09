/* HighGround — capital plan bridge.
   Turns database rows into engine inputs (settings, projects, levers) and back.
   Pure functions: no network, no page. Tested by capital_test.js, which loads each demo district
   through demoRows() and checks the engine gives the same answers as the working planner. */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGCapital = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const n = (v, d) => { const x = Number(v); return v === null || v === undefined || v === '' || !isFinite(x) ? d : x; };
  const CAP_FUNDS = ['save', 'ppel', 'vppel', 'grants'];
  const COND = { good: 'Good', fair: 'Fair', poor: 'Poor', critical: 'Critical' };

  /** district_settings row + fund_balance rows + debt_obligation rows → engine settings (+ notes to show). */
  function settingsFromRows(district, s, balances, debts) {
    const notes = [];
    s = s || {};
    // latest balance per capital fund
    const latest = {};
    (balances || []).forEach((b) => {
      if (!CAP_FUNDS.includes(b.fund)) return;
      if (!latest[b.fund] || b.as_of > latest[b.fund].as_of) latest[b.fund] = b;
    });
    const dates = [...new Set(Object.values(latest).map((b) => b.as_of))].sort();
    const asOf = dates.length ? dates[dates.length - 1] : '';
    if (dates.length > 1) notes.push(`Fund balances have different dates (${dates.join(', ')}). The plan starts from ${asOf}.`);
    const bal = (f) => (latest[f] ? n(latest[f].amount, 0) : (f === 'save' || f === 'ppel' ? null : 0));
    const capDebts = (debts || []).filter((d) => d.fund === 'save' || d.fund === 'ppel');
    if ((debts || []).some((d) => d.fund === 'debt_levy')) notes.push('Payments on debt repaid from the debt service levy (usually voter-approved general-obligation bonds) aren’t taken out of SAVE or PPEL here: a separate property tax pays them.');
    return {
      settings: {
        district: { name: district ? district.name : '', short: district ? district.short_name : '', enrollment: n(s.enrollment, null) },
        plan: Object.assign({ years: n(s.plan_years, 10) }, s.plan_start_fy != null ? { startFY: n(s.plan_start_fy, undefined) } : {}),
        balances: { asOf: asOf, save: bal('save'), ppel: bal('ppel'), vppel: bal('vppel'), grants: bal('grants') },
        save: { receipts: n(s.save_receipts, null), ongoing: n(s.save_ongoing, 0), trend: n(s.save_trend, 0), sf2472: s.sf2472 !== false, receiptsFY: n(s.save_receipts_fy, null) },
        ppel: { receipts: n(s.ppel_receipts, null), ongoing: n(s.ppel_ongoing, 0), growth: n(s.ppel_growth, 0.03), valuation: n(s.taxable_valuation, null),
                rate: n(s.ppel_rate, null), actualValuation: n(s.actual_valuation, null), goOutstanding: n(s.go_outstanding, null) },
        vppel: { status: s.vppel_status || 'none', annual: n(s.vppel_annual, 0), firstFY: n(s.vppel_first_fy, null), lastFY: n(s.vppel_last_fy, null) },
        grants: { avg: n(s.grants_avg, 0), yield: n(s.grants_yield, 0.75) },
        debt: capDebts.map((d) => ({ name: d.name, fund: d.fund, annual: n(d.annual_payment, 0), lastFY: n(d.final_fy, null) })),
        inflation: n(s.construction_inflation, 0),
      },
      notes,
    };
  }

  /** initiative + phase + phase_funding rows for one scenario → engine projects (+ notes). */
  function projectsFromRows(initiatives, phases, funding, scenarioId, cfg) {
    const notes = [];
    const byInit = new Map();
    const fundBy = new Map();
    (funding || []).forEach((f) => { if (!fundBy.has(f.phase_id)) fundBy.set(f.phase_id, []); fundBy.get(f.phase_id).push({ b: f.fund === 'general' ? 'save' : f.fund, p: n(f.pct, 0) }); });
    if ((funding || []).some((f) => f.fund === 'general')) notes.push('Some phases are paid from the general fund; the capital plan counts them against SAVE for now.');
    let outside = 0;
    (phases || []).filter((p) => p.scenario_id === scenarioId)
      .sort((a, b) => (a.fy - b.fy) || (a.seq - b.seq))
      .forEach((p) => {
        const y = n(p.fy, cfg.start) - cfg.start;
        if (y < 0 || y >= cfg.n) outside++;
        if (!byInit.has(p.initiative_id)) byInit.set(p.initiative_id, []);
        byInit.get(p.initiative_id).push({
          cost: n(p.cost, 0), year: y, funding: fundBy.get(p.id) || [],
          status: p.status === 'planned' ? undefined : p.status, actual: p.actual_cost == null ? undefined : n(p.actual_cost, undefined),
          phaseId: p.id, label: p.label || undefined,
        });
      });
    if (outside) notes.push(`${outside} phase${outside === 1 ? '' : 's'} fall outside FY${cfg.start}–FY${cfg.start + cfg.n - 1} and are counted in the nearest plan year.`);
    const INIT = new Map((initiatives || []).map((i) => [i.id, i]));
    const raw = [];
    byInit.forEach((ph, id) => {
      const i = INIT.get(id) || {};
      raw.push({ id: id, name: i.name, pri: i.engine_priority || '', est: i.cost_confidence !== 'firm', area: i.focus_area || '',
                 cond: COND[i.condition] || '', life: i.remaining_life, phases: ph });
    });
    return { projects: E.cleanList(raw, cfg), notes };
  }

  /** recurring_cost rows for one scenario → engine yearly costs (with the initiative's name for display). */
  function recurFromRows(recurring, sid, initiatives) {
    const INIT = new Map((initiatives || []).map((i) => [i.id, i]));
    return (recurring || []).filter((r) => r.scenario_id === sid).map((r) => ({
      id: r.id, initiative_id: r.initiative_id, name: (INIT.get(r.initiative_id) || {}).name || '', kind: r.kind, fund: r.fund,
      first: n(r.first_fy, 0), last: r.last_fy == null ? null : n(r.last_fy, null), amount: n(r.annual_amount, 0), grows: r.grows_with || 'none', fte: r.fte == null ? null : n(r.fte, null),
    }));
  }
  /** scenario row + its financing rows → stored levers (null lever = district default). */
  function leversFromRows(sc, financing) {
    const o = {};
    if (sc) {
      if (sc.lever_vppel != null) o.vppel = !!sc.lever_vppel;
      if (sc.lever_sf2472 != null) o.sf = !!sc.lever_sf2472;
      if (sc.lever_ppel_growth != null) o.pg = n(sc.lever_ppel_growth, 0);
      if (sc.lever_grant_yield != null) o.gy = n(sc.lever_grant_yield, 0);
      if (sc.lever_save_trend != null) o.sg = n(sc.lever_save_trend, 0);
      if (sc.lever_inflation != null) o.infl = n(sc.lever_inflation, 0);
    }
    const fin = (financing || []).filter((f) => !sc || f.scenario_id === sc.id)
      .map((f) => ({ name: f.name, kind: f.kind, fy: n(f.issue_fy, 0), amount: n(f.amount, 0), rate: n(f.rate, 0), years: n(f.years, 0), repay: f.repay_from }));
    if (fin.length) o.fin = fin;
    return o;
  }

  /** Everything for one scenario, ready for HGEngine.compute. */
  function buildInputs(rows, scenarioId) {
    const st = settingsFromRows(rows.district, rows.settings, rows.balances, rows.debts);
    const cfg = E.makeConfig(st.settings);
    const sc = (rows.scenarios || []).find((s) => s.id === scenarioId);
    const pr = projectsFromRows(rows.initiatives, rows.phases, rows.funding, scenarioId, cfg);
    const stored = leversFromRows(sc, rows.financing);
    // the scenario's assumption set fills any lever the scenario hasn't saved for itself
    const set = sc && sc.assumption_set_id ? (rows.assumption_sets || []).find((x) => x.id === sc.assumption_set_id) || null : null;
    if (set) {
      [['pg', 'ppel_growth'], ['gy', 'grant_yield'], ['sg', 'save_trend'], ['infl', 'construction_inflation']].forEach(([k, col]) => {
        if (stored[k] == null && set[col] != null) stored[k] = n(set[col], 0);
      });
      if (set.settlement_pct != null) stored.settle = n(set.settlement_pct, 0);
    }
    const recur = recurFromRows(rows.recurring, scenarioId, rows.initiatives);
    if (recur.length) stored.recur = recur;
    const notes = st.notes.concat(pr.notes);
    const ss = rows.settings || {};
    const tax = { valuation: n(ss.taxable_valuation, 0), homeValue: n(ss.tax_home_value, 150000), agPerAcre: n(ss.ag_value_per_acre, 0) };
    if (recur.some((r) => r.grows === 'settlement') && !(stored.settle > 0)) notes.push('Yearly costs set to grow with salary settlements stay flat until the scenario uses an assumption set with a settlement rate.');
    return { cfg, projects: pr.projects, stored, levers: E.leversOf(stored, cfg), notes, tax, set };
  }

  /* ------------------------------------------------ demo data → database rows */
  /** Rows for every table, in the order they must be inserted. ids come from newId() (crypto.randomUUID in the browser). */
  function demoRows(demo, districtId, newId) {
    const s = demo.settings;
    const startFY = E.fyOfDate(s.balances.asOf);
    const out = { district_settings: [], fund_balance: [], debt_obligation: [], initiative: [], scenario: [],
                  scenario_initiative: [], phase: [], phase_funding: [], financing: [], recurring_cost: [], lock: [],
                  priority: [], outcome: [], measure: [], measure_value: [], survey: [], survey_result: [] };
    // the strategic plan (priorities, outcomes, measures and their results), if the demo has one
    const prioId = new Map(), outId = new Map(), dir = demo.direction || null;
    if (dir) dir.priorities.forEach((pr, k) => {
      const pid = newId(); prioId.set(pr.key, pid);
      out.priority.push({ id: pid, district_id: districtId, position: k + 1, name: pr.name, statement: pr.statement || null });
      (pr.outcomes || []).forEach((o, j) => { const oid = newId(); outId.set(o.key, oid); out.outcome.push({ id: oid, district_id: districtId, priority_id: pid, position: j + 1, name: o.name }); });
      (pr.measures || []).forEach((m) => {
        const mid = newId();
        out.measure.push({ id: mid, district_id: districtId, priority_id: pid, outcome_id: m.outcome ? outId.get(m.outcome) || null : null, name: m.name, unit: m.unit || null, better: m.better || 'up',
          baseline_value: m.baseline_value, baseline_period: m.baseline_period || null, target_value: m.target_value, target_period: m.target_period || null,
          owner_name: m.owner_name || null, cadence: m.cadence || null, source: m.auto ? (/balance|gap/.test(m.auto) ? 'import' : 'progress') : 'manual', is_public: true,
          auto_metric: m.auto || null });
        (m.values || []).forEach(([period, value]) => out.measure_value.push({ district_id: districtId, measure_id: mid, period, value, note: null }));
      });
    });
    out.district_settings.push({
      district_id: districtId, plan_start_fy: startFY, plan_years: s.plan.years, enrollment: demo.enrollment,
      ...(demo.enrollmentYear ? { enrollment_year: demo.enrollmentYear } : {}),
      save_receipts: s.save.receipts, save_receipts_fy: s.save.receiptsFY, save_ongoing: s.save.ongoing, save_trend: s.save.trend, sf2472: s.save.sf2472 !== false,
      ppel_receipts: s.ppel.receipts, ppel_ongoing: s.ppel.ongoing, ppel_growth: s.ppel.growth, ppel_rate: s.ppel.rate,
      taxable_valuation: s.ppel.valuation, actual_valuation: s.ppel.actualValuation, go_outstanding: s.ppel.goOutstanding,
      vppel_status: s.vppel.status, vppel_annual: s.vppel.annual, vppel_first_fy: s.vppel.firstFY, vppel_last_fy: s.vppel.lastFY,
      grants_avg: s.grants.avg, grants_yield: s.grants.yield, construction_inflation: s.inflation,
      ...(s.tax ? { tax_home_value: s.tax.homeValue, ag_value_per_acre: s.tax.agPerAcre } : {}),
      ...(s.gf ? { gf_inputs: s.gf } : {}),
    });
    CAP_FUNDS.forEach((f) => out.fund_balance.push({ district_id: districtId, fund: f, as_of: s.balances.asOf, amount: s.balances[f] || 0, source: 'manual' }));
    (s.debt || []).forEach((d) => out.debt_obligation.push({ district_id: districtId, name: d.name, fund: d.fund, annual_payment: d.annual, final_fy: d.lastFY }));
    const initId = new Map();
    demo.scenarios.forEach((sc) => sc.projects.forEach((p) => {
      if (initId.has(p.id)) return;
      const id = newId(); initId.set(p.id, id);
      out.initiative.push({ id: id, district_id: districtId, name: p.name, type: p.type || 'capital', status: p.status || 'proposed', engine_priority: p.pri || null,
        tier: p.tier || ({ High: 'must', Med: 'strategic', Low: 'nice', '10-yr': 'nice' })[p.pri] || null,
        owner_name: p.owner_name || null,   // every row carries every field: the database rejects bulk rows that differ
        priority_id: dir && dir.links && dir.links[String(p.id)] ? prioId.get(dir.links[String(p.id)]) || null : null,
        focus_area: p.area || null, cost_confidence: p.est === false ? 'firm' : 'estimate', condition: p.cond ? p.cond.toLowerCase() : null,
        remaining_life: p.life == null ? null : p.life });
    }));
    demo.scenarios.forEach((sc, si) => {
      const sid = newId();
      const L = sc.levers || {};
      out.scenario.push({ id: sid, district_id: districtId, name: sc.name, is_board_version: !!sc.board, is_locked: false,
        lever_vppel: L.vppel == null ? null : !!L.vppel, lever_sf2472: L.sf == null ? null : !!L.sf,
        lever_ppel_growth: L.pg == null ? null : L.pg, lever_grant_yield: L.gy == null ? null : L.gy,
        lever_save_trend: L.sg == null ? null : L.sg, lever_inflation: L.infl == null ? null : L.infl });
      if (sc.locked) out.lock.push(sid);   // locked only after its contents are in
      sc.projects.forEach((p, rank) => {
        out.scenario_initiative.push({ scenario_id: sid, initiative_id: initId.get(p.id), district_id: districtId, rank: rank + 1, included: true });
        p.phases.forEach((ph, k) => {
          const pid = newId();
          out.phase.push({ id: pid, district_id: districtId, scenario_id: sid, initiative_id: initId.get(p.id), seq: k + 1,
            fy: startFY + ph.year, cost: ph.cost, status: ph.status || 'planned', actual_cost: ph.actual == null ? null : ph.actual,
            label: ph.label || null });
          (ph.funding || []).forEach((f) => out.phase_funding.push({ phase_id: pid, district_id: districtId, fund: f.b, pct: f.p }));
        });
      });
      (sc.recur || []).forEach((r) => out.recurring_cost.push({ district_id: districtId, scenario_id: sid, initiative_id: initId.get(r.project), kind: r.kind,
        fund: r.fund, first_fy: r.first, last_fy: r.last == null ? null : r.last, annual_amount: r.amount, grows_with: r.grows || 'none' }));
      (L.fin || []).forEach((f) => out.financing.push({ district_id: districtId, scenario_id: sid, name: f.name, kind: f.kind, issue_fy: f.fy,
        amount: f.amount, rate: f.rate || 0, years: f.years || 0,
        repay_from: f.kind === 'rev' ? 'save' : f.kind === 'lease' ? (f.repay === 'save' ? 'save' : 'ppel') : f.kind === 'gift' ? 'none' : 'levy' }));
    });
    if (dir && dir.survey) {   // after the initiatives exist, so themes can link to them
      const sv = dir.survey, sid = newId();
      out.survey.push({ id: sid, district_id: districtId, name: sv.name, opened_on: sv.opened_on || null, closed_on: sv.closed_on || null, response_count: sv.response_count == null ? null : sv.response_count, notes: sv.notes || null });
      (sv.results || []).forEach((r, k) => out.survey_result.push({ district_id: districtId, survey_id: sid, kind: r.kind, label: r.label, value: r.value == null ? null : r.value,
        mentions: r.mentions == null ? null : r.mentions, position: k + 1, priority_id: r.priority ? prioId.get(r.priority) || null : null,
        initiative_id: r.project != null ? initId.get(r.project) || null : null }));
    }
    return out;
  }

  /* ------------------------------------------------ summaries for the screen */
  function yearSummary(r, cfg) {
    return r.res.map((m) => {
      const capacity = CAP_FUNDS.reduce((a, b) => a + m.avail[b], 0);
      const banks = CAP_FUNDS.reduce((a, b) => a + Math.max(0, m.avail[b] - m.spend[b]), 0);
      const over = CAP_FUNDS.reduce((a, b) => a + m.over[b], 0);
      const fromFunds = CAP_FUNDS.reduce((a, b) => a + m.spend[b], 0) - over;
      return { fy: m.fy, total: m.total, capacity, banks, over, fromFunds, boost: m.ext.boost, financed: m.fin.used, campNeeded: m.fin.unfunded };
    });
  }

  /* each capital fund, year by year: what came in, what was spent, what was left, and the low point */
  function fundPaths(r, cfg) {
    const out = {};
    CAP_FUNDS.forEach((b) => {
      const years = r.res.map((m) => {
        const receipts = m.avail[b] - m.carryIn[b];
        const end = Math.max(0, m.avail[b] - m.spend[b]);
        return { fy: m.fy, start: m.carryIn[b], receipts, spend: m.spend[b], over: m.over[b], end };
      });
      const low = years.reduce((a, y) => (y.end < a.end ? y : a), years[0]);
      out[b] = { years, open: years.length ? years[0].start : 0, receipts: years.reduce((a, y) => a + y.receipts, 0),
        spend: years.reduce((a, y) => a + y.spend, 0), over: years.reduce((a, y) => a + y.over, 0),
        end: years.length ? years[years.length - 1].end : 0, low: low ? low.end : 0, lowFY: low ? low.fy : null };
    });
    return out;
  }

  /* what each capital fund is already committed to over the plan, before any project: payments on existing debt and new
     borrowing, ongoing commitments, and yearly costs of programs and hires charged to the fund (year 0 scaled like receipts) */
  function commitments(L, cfg) {
    const out = {};
    CAP_FUNDS.forEach((b) => { out[b] = { debt: 0, ongoing: 0, yearly: 0 }; });
    cfg.years.forEach((fy, y) => {
      const f = y === 0 ? cfg.f0 : 1;
      ['save', 'ppel'].forEach((b) => {
        out[b].debt += (E.debtIn(cfg, b, y) + E.finPay(cfg, b, y, L)) * f;
        out[b].ongoing += (b === 'save' ? cfg.saveOng : cfg.ppelOng) * f;
      });
      CAP_FUNDS.forEach((b) => { out[b].yearly += E.recurIn(cfg, b, y, L) * f; });
    });
    return out;
  }
  /* yearly costs by year: capital (counted in the plan) and other (general fund, boosters: shown as commitments) */
  function recurByYear(L, cfg) {
    return cfg.years.map((fy, y) => {
      const cap = CAP_FUNDS.reduce((a, b) => a + E.recurIn(cfg, b, y, L), 0);
      const other = ['general', 'boost', 'other'].reduce((a, b) => a + E.recurIn(cfg, b, y, L), 0);
      return { fy, capital: cap, other, total: cap + other };
    });
  }

  /* starting points for Base, Conservative and Growth, from the district's own numbers (meant to be edited) */
  function starterSets(settings) {
    const s = settings || {}, r = (v) => Math.round(v * 10000) / 10000;
    const infl = s.inflation == null ? 0.03 : s.inflation, sg = (s.save && s.save.trend) || 0, pg = (s.ppel && s.ppel.growth) || 0, gy = s.grants && s.grants.yield != null ? s.grants.yield : 0.75;
    return [
      { name: 'Base', is_default: true, construction_inflation: r(infl), save_trend: r(sg), ppel_growth: r(pg), grant_yield: r(gy), settlement_pct: 0.025,
        state_aid_growth: 0.0225, enrollment_change_pct: -0.005, health_growth: 0.05, notes: 'The district’s own starting numbers.' },
      { name: 'Conservative', is_default: false, construction_inflation: r(infl + 0.015), save_trend: r(sg - 0.01), ppel_growth: r(pg - 0.01), grant_yield: r(gy * 0.67), settlement_pct: 0.035,
        state_aid_growth: 0.0125, enrollment_change_pct: -0.015, health_growth: 0.08, notes: 'Costs rise faster and revenue grows slower than expected.' },
      { name: 'Growth', is_default: false, construction_inflation: r(Math.max(0, infl - 0.005)), save_trend: r(sg + 0.01), ppel_growth: r(pg + 0.01), grant_yield: r(Math.min(1, gy + 0.1)), settlement_pct: 0.02,
        state_aid_growth: 0.03, enrollment_change_pct: 0.005, health_growth: 0.04, notes: 'Revenue grows faster and costs a little slower than expected.' },
    ];
  }

  return { starterSets, settingsFromRows, projectsFromRows, leversFromRows, recurFromRows, buildInputs, demoRows, yearSummary, fundPaths, recurByYear, commitments, CAP_FUNDS };
});
