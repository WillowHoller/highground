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
  return { periodEnd, status, nextPeriod, STATE_NAME };
});
