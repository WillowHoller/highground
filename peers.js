/* HighGround — peer comparisons from the state's annual reports (Iowa Certified Annual Report data).
   The database (ia_benchmark, part 16) decides what is unusual; this file only chooses which callouts belong on
   which screen and words them. Numbers within the normal range get nothing, so screens stay as they are.
   Pure functions. Tests: peers_test.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGPeers = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FUND = { ALL: 'All funds', General: 'General Fund', SAVE: 'SAVE', PPEL: 'PPEL', Management: 'Management Fund', Nutrition: 'School Nutrition', 'Debt Service': 'Debt Service' };

  /** which state funds each screen speaks for */
  const SCREENS = {
    general: (r) => r.fund === 'General',
    funds: (r) => ['ALL', 'Management', 'Nutrition'].includes(r.fund),
    capital: (r) => ['SAVE', 'PPEL'].includes(r.fund),
  };

  /** "General Fund · Student Transportation spending", "All funds · total revenue", "General Fund · solvency ratio" */
  function label(r) {
    const fund = FUND[r.fund] || r.fund, kind = String(r.measure_key || '').split('|')[0];
    let what;
    if (kind === 'bal') what = r.line === 'SOLVENCY' ? 'solvency ratio' : r.line === 'ENDING' ? 'ending balance' : r.line === 'ENDING_PCT' ? 'ending balance, % of spending' : String(r.line).toLowerCase() + ' balance';
    else if (r.line === 'TOTAL') what = kind === 'rev' ? 'total revenue' : 'total spending';
    else what = r.line + (kind === 'rev' ? ' revenue' : ' spending');
    return `${fund} · ${what}`;
  }

  /** the flagged rows for one screen, most unusual first (the database already orders them) */
  function pick(rows, screen) {
    const keep = SCREENS[screen] || (() => true);
    return (rows || []).filter((r) => r.flag && r.grp !== 'detail' && keep(r));
  }

  const FLAG = { high: 'High vs. peers', low: 'Low vs. peers', jump: 'Changed vs. peers' };

  /** a small card; '' when nothing is unusual. meta: { fy, peer_group, name } */
  function cardHtml(rows, meta) {
    if (!rows || !rows.length) return '';
    const m = meta || {};
    return `<div class="card peers" data-peers><h3>Compared with ${esc(m.peer_group || (rows[0] && rows[0].peer_group) || 'similar districts')}</h3>
      <ul>${rows.map((r) => `<li><span class="peer-tag peer-${esc(r.flag)}">${esc(FLAG[r.flag] || r.flag)}</span> <b>${esc(label(r))}</b>: ${esc(r.callout)}.</li>`).join('')}</ul>
      <p class="small muted">From the state’s Certified Annual Report data, FY${esc(m.fy)}${m.name ? ` (${esc(m.name)})` : ''}. Only numbers well outside the usual range are listed; each is a question to ask, not a finding. Per-pupil figures use certified enrollment.</p></div>`;
  }

  /** one line for the Overview's "Needs attention" list, or '' */
  function overviewLine(rows) {
    const n = pick(rows, 'all').length;
    return n ? `${n} number${n === 1 ? ' stands' : 's stand'} out against similar Iowa districts in the state’s latest annual report` : '';
  }

  return { label, pick, cardHtml, overviewLine, FUND, SCREENS };
});
