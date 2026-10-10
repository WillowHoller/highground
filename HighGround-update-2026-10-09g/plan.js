/* HighGround — the district's improvement plan, in three views of one set of data:
     full     every goal (priorities, outcomes, measures) and every initiative, with or without a cost
     csip     only the priorities tagged as state CSIP goals (Iowa Administrative Code 281-12.8) and the initiatives serving them
     capital  the capital improvement plan: initiatives with capital-fund phases in the board version, or typed as capital
   Items: 'approved' shows completed, in progress and approved work only; 'all' adds proposals (labelled "Proposed, not yet
   approved by the board") and deferred items. Totals always count approved work only (approved, underway, done).
   Costs are the board version's phase costs within the plan years (actual cost for finished phases), plus yearly costs.
   Pure; tested by plan_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VIEWS = { full: 'Full plan', csip: 'Academic goals (CSIP)', capital: 'Capital improvement plan' };
  const GROUPS = [
    ['done', 'Completed'], ['underway', 'In progress'], ['approved', 'Approved and scheduled'],
    ['proposed', 'Proposed, not yet approved by the board'], ['deferred', 'Deferred'],
  ];
  const GROUP_OF = { done: 'done', underway: 'underway', approved: 'approved', idea: 'proposed', proposed: 'proposed', analysis: 'proposed', deferred: 'deferred' };
  const COUNTED = new Set(['done', 'underway', 'approved']);
  const STATUS_WORD = { idea: 'Idea', proposed: 'Proposed', analysis: 'Being analysed', approved: 'Approved', underway: 'In progress', done: 'Completed', deferred: 'Deferred', declined: 'Declined' };
  const TYPE_WORD = { capital: 'Capital project', program: 'Program', staff: 'Staff or hire', curriculum: 'Curriculum', technology: 'Technology', other: 'Other' };
  const TIER_WORD = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have' };
  const FROM_ENGINE = { High: 'must', Med: 'strategic', Low: 'nice', '10-yr': 'nice' };
  const FUND_WORD = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants and donations', boost: 'Boosters', camp: 'Capital campaign', general: 'General Fund', other: 'Other', debt_levy: 'Debt service levy' };
  const FUND_ORDER = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp', 'general', 'other'];
  const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

  const fyText = (ys) => {
    const a = [...new Set(ys)].sort((x, y) => x - y);
    if (!a.length) return '';
    return a[0] === a[a.length - 1] ? `FY${a[0]}` : `FY${a[0]}–FY${a[a.length - 1]}`;
  };

  /**
   * rows: { initiatives, phases, funding, recurring, priorities, scenarios }  (as loaded by the app)
   * dir:  { outcomes, measures, st: Map(measureId → { state, latest }) }      (optional)
   * opts: { view, items, years, start, boardId }
   */
  function build(rows, dir, opts) {
    const o = Object.assign({ view: 'full', items: 'approved', years: 5 }, opts || {});
    const board = (rows.scenarios || []).find((s) => s.id === o.boardId) || (rows.scenarios || []).find((s) => s.is_board_version) || null;
    const start = n(o.start) || null;
    const last = start ? start + n(o.years) - 1 : null;
    const inYears = (fy) => !start || (fy >= start && fy <= last);
    const pri = new Map((rows.priorities || []).map((p) => [p.id, p]));
    const csipIds = new Set((rows.priorities || []).filter((p) => p.csip_goal).map((p) => p.id));
    const phases = board ? (rows.phases || []).filter((p) => p.scenario_id === board.id) : [];
    const recurring = board ? (rows.recurring || []).filter((r) => r.scenario_id === board.id) : [];
    const fundBy = new Map();
    (rows.funding || []).forEach((f) => { if (!fundBy.has(f.phase_id)) fundBy.set(f.phase_id, []); fundBy.get(f.phase_id).push(f); });

    const items = [];
    (rows.initiatives || []).forEach((i) => {
      const status = i.status || 'proposed';
      if (status === 'declined') return;
      const group = GROUP_OF[status];
      if (!group || (o.items === 'approved' && !COUNTED.has(status))) return;
      const ph = phases.filter((p) => p.initiative_id === i.id);
      const rc = recurring.filter((r) => r.initiative_id === i.id);
      const capitalPhase = ph.some((p) => { const fs = fundBy.get(p.id) || []; return !fs.length || fs.some((f) => f.fund !== 'general'); });
      const capital = capitalPhase || i.type === 'capital';
      if (o.view === 'capital' && !capital) return;
      if (o.view === 'csip' && !csipIds.has(i.priority_id)) return;
      const byFund = {}, named = {}, choices = new Set();
      let cost = 0, auto = 0;
      ph.filter((p) => inYears(n(p.fy))).forEach((p) => {
        const c = p.status === 'done' && p.actual_cost != null ? n(p.actual_cost) : n(p.cost);
        cost += c;
        const fs = fundBy.get(p.id) || [];
        if (!fs.length) { auto += c; return; }
        const tot = fs.reduce((t, f) => t + n(f.pct), 0) || 100;
        fs.forEach((f) => { byFund[f.fund] = (byFund[f.fund] || 0) + (c * n(f.pct)) / tot; });
        /* a phase with fund choices ("SAVE or PPEL") is described that way; its cost counts under the first choice */
        if (Array.isArray(p.fund_options) && p.fund_options.length > 1) choices.add(p.fund_options.map((k) => FUND_WORD[k] || k).join(' or '));
        else fs.forEach((f) => { named[f.fund] = (named[f.fund] || 0) + (c * n(f.pct)) / tot; });
      });
      const yearlyRows = rc.filter((r) => (!start || (n(r.first_fy) <= last && (r.last_fy == null || n(r.last_fy) >= start))));
      const yearly = yearlyRows.reduce((t, r) => t + n(r.annual_amount), 0);
      const yearlyFunds = [...new Set(yearlyRows.map((r) => r.fund))];
      const funds = FUND_ORDER.filter((k) => named[k] > 0.5 || yearlyFunds.includes(k)).map((k) => FUND_WORD[k]).concat([...choices]);
      if (auto > 0.5) funds.push('Capital funds, as the plan assigns');
      const phaseYears = ph.map((p) => n(p.fy));
      const doneDates = ph.map((p) => p.done_date).filter(Boolean).sort();
      let completion = '';
      if (status === 'done' && doneDates.length) completion = doneDates[doneDates.length - 1];
      else if (phaseYears.length) completion = fyText(phaseYears);
      else if (yearlyRows.length) completion = `Ongoing from FY${Math.min(...yearlyRows.map((r) => n(r.first_fy)))}`;
      else if (i.need_by_fy) completion = `Needed by FY${i.need_by_fy}`;
      const tier = i.tier || FROM_ENGINE[i.engine_priority] || '';
      const p = pri.get(i.priority_id);
      items.push({
        id: i.id, name: i.name, status, statusWord: STATUS_WORD[status] || status, group, counted: COUNTED.has(status),
        category: [TYPE_WORD[i.type] || '', i.focus_area || ''].filter(Boolean).join(' · '),
        priority: TIER_WORD[tier] || '', completion, firstFY: phaseYears.length ? Math.min(...phaseYears) : (yearlyRows.length ? Math.min(...yearlyRows.map((r) => n(r.first_fy))) : null),
        cost, yearly, byFund, auto, funding: funds.join(', '), noCost: cost < 0.5 && yearly < 0.5,
        owner: i.owner_name || '', goal: p ? p.name : '', csip: csipIds.has(i.priority_id), capital,
        phases: ph.filter((x) => inYears(n(x.fy))).map((x) => ({ fy: n(x.fy), cost: x.status === 'done' && x.actual_cost != null ? n(x.actual_cost) : n(x.cost), label: x.label || '' })),
      });
    });
    items.sort((a, b) => (a.firstFY || 9999) - (b.firstFY || 9999) || a.name.localeCompare(b.name));

    const groups = GROUPS.map(([key, label]) => ({ key, label, items: items.filter((x) => x.group === key) })).filter((g) => g.items.length);
    const counted = items.filter((x) => x.counted), proposed = items.filter((x) => !x.counted);
    const byFund = {};
    counted.forEach((x) => Object.entries(x.byFund).forEach(([k, v]) => { byFund[k] = (byFund[k] || 0) + v; }));
    const totals = {
      cost: counted.reduce((t, x) => t + x.cost, 0), yearly: counted.reduce((t, x) => t + x.yearly, 0), auto: counted.reduce((t, x) => t + x.auto, 0),
      byFund, count: counted.length, noCost: counted.filter((x) => x.noCost).length,
      proposedCost: proposed.reduce((t, x) => t + x.cost, 0), proposedCount: proposed.length,
    };

    // the schedule: costed phases by year (approved work, plus proposals when shown, marked)
    const years = start ? Array.from({ length: n(o.years) }, (_, k) => start + k) : [...new Set(items.flatMap((x) => x.phases.map((p) => p.fy)))].sort((a, b) => a - b);
    const schedule = years.map((fy) => ({ fy, items: items.filter((x) => x.phases.some((p) => p.fy === fy)).map((x) => ({ id: x.id, name: x.name, counted: x.counted, funding: x.funding,
      cost: x.phases.filter((p) => p.fy === fy).reduce((t, p) => t + p.cost, 0) })) })).filter((y) => y.items.length);

    // goals: priorities with their outcomes and measures (none for the capital view)
    let goals = [];
    if (o.view !== 'capital') {
      const st = (dir && dir.st) || new Map(), outcomePri = new Map(((dir && dir.outcomes) || []).map((x) => [x.id, x.priority_id]));
      goals = (rows.priorities || []).filter((p) => o.view !== 'csip' || p.csip_goal).slice().sort((a, b) => n(a.position) - n(b.position) || a.name.localeCompare(b.name)).map((p) => ({
        id: p.id, name: p.name, statement: p.statement || '', csip: !!p.csip_goal,
        outcomes: ((dir && dir.outcomes) || []).filter((x) => x.priority_id === p.id).map((x) => x.name),
        measures: ((dir && dir.measures) || []).filter((m) => (m.priority_id || outcomePri.get(m.outcome_id)) === p.id).map((m) => { const s = st.get(m.id) || {};
          return { id: m.id, name: m.name, state: s.state || 'nodata', latest: s.latest ? s.latest.value : null, period: s.latest ? s.latest.period || '' : '', target: m.target_value == null ? null : Number(m.target_value), unit: m.unit || '' }; }),
        initiatives: items.filter((x) => x.goal === p.name).length,
      }));
    }
    const unlinked = o.view === 'capital' ? 0 : items.filter((x) => !x.goal).length;
    return { view: o.view, viewName: VIEWS[o.view], items: o.items, years, start, last, board: board ? { id: board.id, name: board.name } : null, groups, totals, schedule, goals, unlinked, list: items };
  }

  /** the Excel sheet: the district's own columns, one row per item */
  function sheet(plan) {
    const head = ['Status', 'Initiative', 'Anticipated completion', 'Category', 'Priority level', 'Cost in plan years', 'Yearly cost', 'Funding source', 'Responsible party', 'Goal', 'CSIP goal', 'Counted in totals'];
    const out = [head];
    plan.groups.forEach((g) => g.items.forEach((x) => out.push([
      x.counted ? x.statusWord : `${x.statusWord} (not yet approved)`, x.name, x.completion, x.category, x.priority,
      x.noCost ? 'No outside cost' : Math.round(x.cost), x.yearly ? Math.round(x.yearly) : '', x.funding, x.owner, x.goal, x.csip ? 'Yes' : '', x.counted ? 'Yes' : 'No',
    ])));
    return out;
  }

  return { VIEWS, GROUPS, FUND_WORD, build, sheet, fyText };
});
