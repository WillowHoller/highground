/* HighGround — strategic plan measures.
   A measure has a starting point (baseline value at a period), a target (value at a period), a direction
   (higher is better, lower is better) and a cadence. Its status at the latest result:
     met        the target is reached
     on track   at or ahead of the straight path from starting point to target, at that result's date (2% tolerance)
     off track  behind that path
     no data    nothing recorded yet
   Update owed: no result within the cadence (monthly 1, quarterly 3, semester 6, annual 12 months) plus a month's grace.
   Periods as districts write them: '2025-26' (school year → 30 June 2026), 'FY2027' (→ 30 June 2027), '2026-09' (→ 30 Sept 2026), '2026' (→ 31 Dec 2026).
   Pure; tested by direction_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGDirection = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthEnd = (y, m) => new Date(y, m, 0);   // m is 1-12
  /** the date a period ends, or null if it can't be read */
  function periodEnd(p) {
    const s = String(p || '').trim(); let m;
    if ((m = s.match(/^(?:FY\s?)(\d{4})$/i))) return iso(monthEnd(+m[1], 6));
    if ((m = s.match(/^(\d{4})\s?[-–/]\s?(\d{2}|\d{4})$/)) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
      const y2 = m[2].length === 2 ? Math.floor(+m[1] / 100) * 100 + +m[2] : +m[2];
      if (y2 === +m[1] + 1) return iso(monthEnd(y2, 6));
    }
    if ((m = s.match(/^(\d{4})-(0[1-9]|1[0-2])$/))) return iso(monthEnd(+m[1], +m[2]));
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
    if ((m = s.match(/^(\d{4})$/))) return iso(monthEnd(+m[1], 12));
    return null;
  }
  const days = (a, b) => (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000;
  const CADENCE_MONTHS = { monthly: 1, quarterly: 3, semester: 6, annual: 12 };
  function addMonths(isoDate, n) { const d = new Date(isoDate + 'T12:00:00'); return iso(monthEnd(d.getFullYear(), d.getMonth() + 1 + n)); }

  /** values: [{ period, period_end?, value }]; today: 'YYYY-MM-DD' (optional) */
  function status(m, values, today) {
    const now = today || iso(new Date());
    const vals = (values || []).map((v) => ({ period: v.period, end: v.period_end || periodEnd(v.period), value: Number(v.value), note: v.note || '' }))
      .filter((v) => v.end && isFinite(v.value)).sort((a, b) => a.end.localeCompare(b.end));
    const latest = vals[vals.length - 1] || null, previous = vals[vals.length - 2] || null;
    const t0 = periodEnd(m.baseline_period), t1 = periodEnd(m.target_period);
    const b = m.baseline_value == null ? null : Number(m.baseline_value), tg = m.target_value == null ? null : Number(m.target_value);
    const up = m.better === 'down' ? false : m.better === 'up' ? true : (b != null && tg != null ? tg >= b : true);
    let state = 'nodata', expected = null, progress = null;
    if (latest) {
      state = 'tracking';
      if (tg != null) {
        const met = up ? latest.value >= tg : latest.value <= tg;
        if (met) state = 'met';
        else if (b != null && t0 && t1 && days(t0, t1) > 0) {
          const f = Math.max(0, Math.min(1, days(t0, latest.end) / days(t0, t1)));
          expected = b + (tg - b) * f;
          const tol = Math.abs(tg - b) * 0.02;
          state = (up ? latest.value >= expected - tol : latest.value <= expected + tol) ? 'ontrack' : 'offtrack';
        }
        if (b != null && tg !== b) progress = Math.max(0, Math.min(1, (latest.value - b) / (tg - b)));
      }
    }
    const months = CADENCE_MONTHS[m.cadence] || null;
    let due = null, owed = false;
    if (months) {
      const from = latest ? latest.end : t0 || (m.created_at ? String(m.created_at).slice(0, 10) : null);
      if (from) { due = addMonths(from, months); owed = now > addMonths(due, 1); }   // a month's grace after it was due
    }
    return { state, latest, previous, values: vals, expected, progress, due, owed, up,
      trend: latest && previous ? Math.sign(latest.value - previous.value) * (up ? 1 : -1) : 0 };
  }

  const STATE_NAME = { met: 'Met', ontrack: 'On track', offtrack: 'Off track', tracking: 'Recorded', nodata: 'No data yet' };
  /** a suggested period for the next result, by cadence (school-year style for annual and semester) */
  function nextPeriod(m, today) {
    const d = new Date((today || iso(new Date())) + 'T12:00:00'), y = d.getFullYear(), mo = d.getMonth() + 1;
    if (m.cadence === 'monthly' || m.cadence === 'quarterly') { const p = new Date(y, mo - 1, 0); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`; }
    const sy = mo >= 7 ? y : y - 1; return `${sy}-${String((sy + 1) % 100).padStart(2, '0')}`;
  }
  /* ---------- automatic measures: values from HighGround's own data ---------- */
  const AUTO = {
    phases_on_budget: { name: 'Capital phases finished within 5% of budget', unit: '%', better: 'up', source: 'progress', cadence: 'annual' },
    phases_on_schedule: { name: 'Capital phases finished in their planned year', unit: '%', better: 'up', source: 'progress', cadence: 'annual' },
    capital_gap: { name: 'Capital gap to close', unit: '$', better: 'down', source: 'progress', cadence: 'monthly' },
    save_balance: { name: 'SAVE balance', unit: '$', better: 'up', source: 'import', cadence: 'monthly' },
    ppel_balance: { name: 'PPEL balance', unit: '$', better: 'up', source: 'import', cadence: 'monthly' },
    general_balance: { name: 'General Fund balance', unit: '$', better: 'up', source: 'import', cadence: 'monthly' },
  };
  const fyOf = (isoDate) => { const d = new Date(isoDate + 'T12:00:00'); return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(); };
  /** data: { phases (board version, with fy, cost, status, actual_cost, done_date), inflation, startFY, balances, reports } */
  function autoValues(metric, data) {
    const out = [];
    if (metric === 'phases_on_budget' || metric === 'phases_on_schedule') {
      const done = (data.phases || []).filter((p) => p.status === 'done' && p.done_date && (metric === 'phases_on_schedule' || p.actual_cost != null));
      const byFY = {};
      done.forEach((p) => { const fy = fyOf(p.done_date); (byFY[fy] = byFY[fy] || []).push(p); });
      Object.keys(byFY).sort().forEach((fy) => {
        const list = byFY[fy];
        const ok = list.filter((p) => metric === 'phases_on_schedule' ? fyOf(p.done_date) <= p.fy
          : Number(p.actual_cost) <= Number(p.cost) * Math.pow(1 + (data.inflation || 0), Math.max(0, p.fy - (data.startFY || p.fy))) * 1.05).length;
        out.push({ period: `FY${fy}`, period_end: `${fy}-06-30`, value: Math.round(ok / list.length * 1000) / 10, auto: true, note: `${ok} of ${list.length} phases` });
      });
    } else if (metric === 'capital_gap') {
      const byMonth = {};
      (data.reports || []).forEach((r) => { if (r.payload && r.payload.plan && r.period_end) byMonth[r.period_end.slice(0, 7)] = { end: r.period_end, v: r.payload.plan.gap }; });
      Object.keys(byMonth).sort().forEach((k) => out.push({ period: k, period_end: byMonth[k].end, value: Math.round(byMonth[k].v), auto: true, note: 'From the board report' }));
    } else if (/_balance$/.test(metric)) {
      const fund = metric.replace('_balance', '');
      (data.balances || []).filter((b) => b.fund === fund).forEach((b) => out.push({ period: b.as_of.slice(0, 7), period_end: b.as_of, value: Number(b.amount), auto: true, note: '' }));
      out.sort((a, b) => a.period_end.localeCompare(b.period_end));
    }
    return out;
  }

  /* ---------- spreadsheets for the plan: goals, and measure results ---------- */
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function headerIndex(rows, want) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const cells = (rows[r] || []).map(norm), map = {};
      Object.entries(want).forEach(([k, pats]) => { const i = cells.findIndex((c) => pats.some((p) => p.test(c))); if (i >= 0) map[k] = i; });
      if (Object.keys(map).length >= 2) return { header: r, map };
    }
    return null;
  }
  const num = (v) => { const s = String(v == null ? '' : v).replace(/[$,%\s]/g, ''); return s === '' ? null : (isFinite(Number(s)) ? Number(s) : NaN); };
  /** goals spreadsheet: one row per measure (or per outcome, or per priority) */
  function parseGoals(rows) {
    const H = headerIndex(rows, { priority: [/^priority/, /^goal$/], outcome: [/^outcome/], measure: [/^measure/, /^indicator/], unit: [/^unit/],
      better: [/^better/, /^direction/], start: [/^start$/, /^baseline$/, /^starting point$/], startPeriod: [/^start period/, /^baseline (period|year)/],
      target: [/^target$/], targetPeriod: [/^target (period|year)/, /^by$/], owner: [/^owner/], cadence: [/^cadence/, /^updated/, /^frequency/] });
    const issues = [], items = [];
    if (!H || H.map.priority == null) return { items, issues: [{ l: 'e', m: 'HighGround couldn’t find a “Priority” column. Use the goals template.' }] };
    const g = (row, k) => (H.map[k] == null ? '' : String(row[H.map[k]] == null ? '' : row[H.map[k]]).trim());
    for (let r = H.header + 1; r < rows.length; r++) {
      const row = rows[r] || [], priority = g(row, 'priority'); if (!priority) continue;
      const it = { row: r + 1, priority, outcome: g(row, 'outcome') || null, measure: g(row, 'measure') || null };
      if (it.measure) {
        Object.assign(it, { unit: g(row, 'unit') || null, better: /low|down|less|fewer/i.test(g(row, 'better')) ? 'down' : 'up', start: num(g(row, 'start')), startPeriod: g(row, 'startPeriod') || null,
          target: num(g(row, 'target')), targetPeriod: g(row, 'targetPeriod') || null, owner: g(row, 'owner') || null,
          cadence: ({ monthly: 'monthly', quarterly: 'quarterly', semester: 'semester', annual: 'annual', yearly: 'annual', year: 'annual', month: 'monthly', quarter: 'quarterly' })[norm(g(row, 'cadence')).split(' ')[0]] || 'annual' });
        if (Number.isNaN(it.start) || Number.isNaN(it.target)) issues.push({ l: 'e', row: it.row, m: `Row ${it.row}: start and target must be numbers.` });
        ['startPeriod', 'targetPeriod'].forEach((k) => { if (it[k] && !periodEnd(it[k])) issues.push({ l: 'e', row: it.row, m: `Row ${it.row}: “${it[k]}” isn’t a period HighGround can read (use 2025-26, FY2027, 2026-09 or 2026).` }); });
      }
      items.push(it);
    }
    if (!items.length) issues.push({ l: 'e', m: 'No rows with a priority were found.' });
    return { items, issues };
  }
  /** measure results spreadsheet: Measure, Period, Result, Note */
  function parseResults(rows, measures) {
    const H = headerIndex(rows, { measure: [/^measure/, /^indicator/], period: [/^period/, /^year/, /^month/], value: [/^(result|value|actual)$/], note: [/^note/] });
    const issues = [], items = [];
    if (!H || H.map.measure == null || H.map.value == null) return { items, issues: [{ l: 'e', m: 'HighGround needs “Measure”, “Period” and “Result” columns. Use the results template.' }] };
    const byName = new Map((measures || []).map((m) => [norm(m.name), m]));
    for (let r = H.header + 1; r < rows.length; r++) {
      const row = rows[r] || [], name = String(row[H.map.measure] || '').trim(); if (!name) continue;
      const m = byName.get(norm(name)), period = String(row[H.map.period] == null ? '' : row[H.map.period]).trim(), value = num(row[H.map.value]);
      if (!m) { issues.push({ l: 'e', row: r + 1, m: `Row ${r + 1}: no measure called “${name}”.` }); continue; }
      if (m.auto_metric) { issues.push({ l: 'w', row: r + 1, m: `Row ${r + 1}: “${m.name}” updates itself, so this row is skipped.` }); continue; }
      if (!periodEnd(period)) { issues.push({ l: 'e', row: r + 1, m: `Row ${r + 1}: “${period}” isn’t a period HighGround can read.` }); continue; }
      if (value === null || Number.isNaN(value)) { issues.push({ l: 'e', row: r + 1, m: `Row ${r + 1}: the result must be a number.` }); continue; }
      items.push({ row: r + 1, measure: m, period, period_end: periodEnd(period), value, note: H.map.note == null ? null : String(row[H.map.note] || '').trim() || null });
    }
    return { items, issues };
  }
  /** survey results spreadsheet: Kind (importance / theme / question), Label, Value, Mentions, Priority */
  function parseSurvey(rows, priorities) {
    const H = headerIndex(rows, { kind: [/^kind/, /^type/], label: [/^label/, /^item/, /^theme/, /^question/], value: [/^(value|score|percent|share)/], mentions: [/^mentions/, /^count/, /^responses/, /^how many/], priority: [/^priority/] });
    const issues = [], items = [];
    if (!H || H.map.label == null) return { items, issues: [{ l: 'e', m: 'HighGround needs at least a “Label” column. Use the survey template.' }] };
    const byName = new Map((priorities || []).map((p) => [norm(p.name), p.id]));
    for (let r = H.header + 1; r < rows.length; r++) {
      const row = rows[r] || [], label = String(row[H.map.label] || '').trim(); if (!label) continue;
      const k = norm(H.map.kind == null ? '' : row[H.map.kind]), kind = /import/.test(k) ? 'importance' : /question/.test(k) ? 'question' : 'theme';
      const value = H.map.value == null ? null : num(row[H.map.value]), mentions = H.map.mentions == null ? null : num(row[H.map.mentions]);
      if (Number.isNaN(value) || Number.isNaN(mentions)) { issues.push({ l: 'e', row: r + 1, m: `Row ${r + 1}: value and mentions must be numbers.` }); continue; }
      const pname = H.map.priority == null ? '' : String(row[H.map.priority] || '').trim();
      const priority_id = pname ? byName.get(norm(pname)) || null : (kind === 'importance' ? byName.get(norm(label)) || null : null);
      if (pname && !priority_id) issues.push({ l: 'w', row: r + 1, m: `Row ${r + 1}: no priority called “${pname}”; it won’t be linked.` });
      items.push({ row: r + 1, kind, label: label.slice(0, 200), value, mentions: mentions == null ? null : Math.round(mentions), priority_id });
    }
    if (!items.length) issues.push({ l: 'e', m: 'No result rows were found.' });
    return { items, issues };
  }

  return { periodEnd, status, nextPeriod, STATE_NAME, AUTO, autoValues, parseGoals, parseResults, parseSurvey };
});
