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
    const grp = m.peer_group || (rows[0] && rows[0].peer_group) || 'similar districts';
    return `<div class="card peers" data-peers><h3>Unusual vs. ${esc(grp)} <span class="count">${rows.length}</span></h3>
      <p class="small">${rows.length === 1 ? 'One number is' : `${rows.length} numbers are`} far outside what ${esc(grp)} report: worth asking about, not necessarily a problem.</p>
      <ul>${rows.map((r) => `<li><span class="peer-tag peer-${esc(r.flag)}">${esc(FLAG[r.flag] || r.flag)}</span> <b>${esc(label(r))}</b>: ${esc(r.callout)}. <a href="#" data-action="peerDetail" data-key="${esc(r.measure_key)}">Details</a></li>`).join('')}</ul>
      <p class="small muted">From the district’s Certified Annual Report to the state, FY${esc(m.fy)}. Per-pupil figures use certified enrollment.</p></div>`;
  }

  const num = (v) => (v == null || v === '' ? null : Number(v));
  /** a value in the measure's unit: $1,234/pupil or 12.3% */
  function fmtVal(v, unit) {
    v = num(v); if (v == null || isNaN(v)) return '—';
    return unit === 'pct' ? v.toFixed(1) + '%' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US') + (unit === 'per_pupil' ? '/pupil' : '');
  }
  const dollars = (v) => (v == null ? '—' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(Number(v))).toLocaleString('en-US'));
  /** the pieces under a measure: objects (salaries, benefits…) under a function; functions under a fund's total */
  function parts(rows, r) {
    const kind = String(r.measure_key).split('|')[0];
    let list;
    if (r.line === 'TOTAL') list = rows.filter((x) => x.grp !== 'detail' && x.fund === r.fund && x.line !== 'TOTAL' && String(x.measure_key).split('|')[0] === kind);
    else list = rows.filter((x) => String(x.measure_key).startsWith(r.measure_key + '|'));
    return list.filter((x) => num(x.value) || num(x.peer_median)).sort((a, b) => (num(b.value) || 0) - (num(a.value) || 0));
  }
  /** the detail behind one measure: the district against its peers, last year, and what it's made of */
  function detailHtml(rows, key, meta) {
    const r = (rows || []).find((x) => x.measure_key === key); if (!r) return '<p class="muted">No detail for this number.</p>';
    const m = meta || {}, u = r.unit, pr = num(r.pct_rank), sub = parts(rows, r), kind = String(key).split('|')[0];
    const partName = (x) => (r.line === 'TOTAL' ? x.line : String(x.line).split(' · ').slice(1).join(' · ') || x.line);
    const gap = (x) => { const v = num(x.value), md = num(x.peer_median); if (v == null || md == null) return ''; const d = v - md; return Math.abs(d) < (u === 'pct' ? 0.05 : 0.5) ? '' : (d > 0 ? '+' : '−') + fmtVal(Math.abs(d), x.unit).replace('/pupil', ''); };
    return `<div class="stack peerdetail">
      <h2 id="modal-title">${esc(label(r))}</h2>
      ${r.callout ? `<p><span class="peer-tag peer-${esc(r.flag)}">${esc(FLAG[r.flag] || 'Within the usual range')}</span> ${esc(r.callout)}.</p>` : '<p class="muted">Within the usual range for these peers.</p>'}
      <div class="scroll"><table class="data"><tbody>
        <tr><td>This district</td><td class="num"><b>${esc(fmtVal(r.value, u))}</b>${u === 'per_pupil' && r.amount != null ? ` <span class="small muted">(${esc(dollars(r.amount))} in all)</span>` : ''}</td></tr>
        <tr><td>Typical peer (median)</td><td class="num">${esc(fmtVal(r.peer_median, u))}</td></tr>
        <tr><td>Middle half of peers</td><td class="num">${esc(fmtVal(r.peer_p25, u))} to ${esc(fmtVal(r.peer_p75, u))}</td></tr>
        <tr><td>Peer average</td><td class="num">${esc(fmtVal(r.peer_mean, u))}</td></tr>
        ${pr != null ? `<tr><td>Rank</td><td class="num">higher than ${Math.round(pr * 100)}% of ${esc(r.peer_n)} ${esc(r.peer_group || 'peers')}</td></tr>` : ''}
        ${r.prior_value != null ? `<tr><td>Last year</td><td class="num">${esc(fmtVal(r.prior_value, u))}${r.change_pct != null ? ` (${num(r.change_pct) >= 0 ? 'up' : 'down'} ${Math.abs(num(r.change_pct))}%${r.peer_change_median_pct != null ? `; peers’ median ${num(r.peer_change_median_pct) >= 0 ? 'up' : 'down'} ${Math.abs(num(r.peer_change_median_pct))}%` : ''})` : ''}</td></tr>` : ''}
      </tbody></table></div>
      ${sub.length ? `<h3>${r.line === 'TOTAL' ? (kind === 'rev' ? 'By source' : 'By function') : 'By kind of spending'}</h3>
        <div class="scroll"><table class="data"><thead><tr><th></th><th class="num">This district</th><th class="num">Typical peer</th><th class="num">Difference</th><th></th></tr></thead><tbody>
        ${sub.map((x) => `<tr><td>${esc(partName(x))}</td><td class="num">${esc(fmtVal(x.value, x.unit))}</td><td class="num">${esc(fmtVal(x.peer_median, x.unit))}</td><td class="num">${esc(gap(x))}</td><td>${x.flag ? `<span class="peer-tag peer-${esc(x.flag)}">${esc(FLAG[x.flag])}</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      <p class="small muted">From the district’s Certified Annual Report to the state, FY${esc(m.fy)}. Peers: ${esc(r.peer_group || 'districts the same size')}. Per pupil uses certified enrollment. A difference can have good reasons (a new building, a bus route, a grant), so treat it as a question, not a finding.</p></div>`;
  }

  /** one line for the Overview's "Needs attention" list, or '' */
  function overviewLine(rows) {
    const n = pick(rows, 'all').length;
    return n ? `${n} number${n === 1 ? ' stands' : 's stand'} out against similar Iowa districts in the state’s latest annual report` : '';
  }

  return { label, pick, cardHtml, detailHtml, parts, fmtVal, overviewLine, FUND, SCREENS };
});
