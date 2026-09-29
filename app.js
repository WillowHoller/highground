/* HighGround — app shell.
   Every screen is marked Live, Partly built, or Not built yet. Anything not built either shows a
   dashed "Not built yet (Phase N)" panel or, when clicked, throws HG.NotBuiltError, which the app
   shows as a message. Nothing here pretends to work. */
(function () {
  const HG = window.HG;
  const app = document.getElementById('app');

  // ------------------------------------------------------------------ helpers
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const money = (n) => (n == null || n === '' ? '' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const ROLE = { admin: 'Admin', business_manager: 'Business manager', superintendent: 'Superintendent', editor: 'Editor', board: 'Board member', viewer: 'Viewer' };
  const KIND = { gl_monthly: 'Monthly GL export', budget: 'Budget', balances: 'Fund balances', projects: 'Projects', goals: 'Goals', measure_values: 'Measure results', survey: 'Survey results' };
  const STATUS = { live: ['b-live', 'Live'], partial: ['b-partial', 'Partly built'], wip: ['b-wip', 'Not built yet'] };
  const badge = (s) => `<span class="badge ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
  const initials = (s) => (String(s || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();
  const LOGO = `<svg width="64" height="26" viewBox="0 0 64 26" aria-hidden="true"><path d="M2 24 L20 6 L28 14 L38 3 L62 24" fill="none" stroke="#F7F5EF" stroke-width="2.4" stroke-linejoin="round"/><path d="M14 12 L20 6 L24 10 M33 8 L38 3 L43 8" fill="none" stroke="#C9A24A" stroke-width="2"/></svg>`;

  /** A dashed panel saying what will be here. */
  function wip({ phase, items = [], uses, title }) {
    return `<section class="wip" aria-label="Not built yet">
      <h3>${esc(title || 'Not built yet')}${phase ? ` (Phase ${esc(phase)})` : ''}</h3>
      ${items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${uses ? `<div class="uses">Will use: ${esc(uses)}</div>` : ''}</section>`;
  }
  /** A button for something that doesn't exist yet. Clicking it throws NotBuiltError. */
  const nb = (label, feature, phase) =>
    `<button type="button" class="btn notbuilt" data-notbuilt="${esc(feature)}" data-phase="${esc(phase || '')}" title="Not built yet">${esc(label)}</button>`;
  const table = (cols, rows, emptyText) => rows.length
    ? `<div class="scroll"><table class="data"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
       <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(emptyText)}</div>`;

  function toast(title, body, kind) {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = `<b>${esc(title)}</b>${esc(body || '')}`;
    box.appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 9000 : 6000);
  }
  class UserError extends Error {}
  function showError(err) {
    if (!err) return;
    if (err instanceof HG.NotBuiltError) return toast('Not built yet', err.message, 'notbuilt');
    if (err instanceof HG.ApiError && err.status === 401 && HG.auth.session) {
      HG.auth.signOut().then(() => { S.loaded = false; go('#/signin', 'Your session ended. Sign in again.'); });
      return;
    }
    if (!(err instanceof HG.ApiError) && !(err instanceof UserError)) console.error(err);
    toast('That didn’t work', err.message || String(err), 'error');
  }
  window.addEventListener('unhandledrejection', (e) => showError(e.reason));
  window.addEventListener('error', (e) => showError(e.error || new Error(e.message)));

  // ------------------------------------------------------------------ state and routing
  const S = { loaded: false, user: null, profile: null, isStaff: false, memberships: [], districts: [], district: null, role: null };
  let flash = null; // one-time message for the next screen
  function go(hash, message) {
    flash = message || null;
    if (location.hash === hash) route(); else location.hash = hash;
  }
  HG.onSignedOut = (msg) => { S.loaded = false; go('#/signin', msg); };

  async function loadContext(force) {
    if (S.loaded && !force) return;
    const u = await HG.auth.currentUser();
    S.user = u;
    const [staff, mems, prof] = await Promise.all([
      HG.db.select('platform_admin', `select=user_id&user_id=eq.${enc(u.id)}`),
      HG.db.select('district_member', `select=role,district:district_id(id,slug,name,short_name,state,county,brand_color,is_demo,public_link_enabled)&user_id=eq.${enc(u.id)}`),
      HG.db.select('profile', `select=*&user_id=eq.${enc(u.id)}`),
    ]);
    S.isStaff = staff.length > 0;
    S.memberships = mems.filter((m) => m.district);
    S.profile = prof[0] || null;
    S.districts = S.isStaff
      ? await HG.db.select('district', 'select=id,slug,name,short_name,state,county,brand_color,is_demo,public_link_enabled&order=name')
      : S.memberships.map((m) => m.district).sort((a, b) => a.name.localeCompare(b.name));
    S.loaded = true;
  }
  const roleIn = (d) => { const m = S.memberships.find((x) => x.district.id === d.id); return m ? m.role : (S.isStaff ? 'staff' : null); };
  const ctx = () => {
    const r = S.role, staff = S.isStaff;
    return {
      district: S.district, role: r, staff,
      admin: staff || r === 'admin',
      plan: staff || ['admin', 'superintendent', 'editor'].includes(r),
      finance: staff || ['admin', 'business_manager'].includes(r),
    };
  };

  async function route() {
    const hash = location.hash || '';
    if (!HG.configured) return renderNotConnected();
    if (/(access_token|error_description|error)=/.test(hash)) return handleEmailLink(hash);
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const linkSlug = new URLSearchParams(location.search).get('d');
    try {
      if (parts[0] === 'p' && parts[1]) return await renderPublic(parts[1]);
      if (linkSlug && !HG.auth.session && !parts.length) return await renderPublic(linkSlug);
      if (['signin', 'signup', 'forgot'].includes(parts[0])) return renderAuth(parts[0]);
      if (!HG.auth.session) return go('#/signin');
      if (parts[0] === 'set-password') return renderSetPassword();
      await loadContext();
      if (parts[0] === 'staff') return await renderStaff();
      if (parts[0] === 'd' && parts[1]) return await renderDistrict(parts[1], parts[2], parts[3]);
      if (!S.districts.length) return S.isStaff ? go('#/staff', flash) : renderNoDistrict();
      let last = null; try { last = localStorage.getItem('highground-last-district'); } catch (e) {}
      const first = S.districts.find((x) => x.slug === last) || S.districts[0];
      return go(`#/d/${enc(first.slug)}/overview/today`, flash);
    } catch (err) {
      if (err instanceof HG.ApiError && err.status === 401) { await HG.auth.signOut(); S.loaded = false; return go('#/signin', 'Your session ended. Sign in again.'); }
      renderFatal(err);
    }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------------ the map of the product
  // status: live | partial | wip.  phase: when the rest arrives (see 05-roadmap/phases.md).
  const SECTIONS = [
    { id: 'overview', label: 'Overview', tabs: [
      { id: 'today', label: 'Today', status: 'partial', phase: 5, lede: 'How the district is doing, and what needs attention.', render: vOverview },
    ] },
    { id: 'direction', label: 'Direction', tabs: [
      { id: 'priorities', label: 'Priorities', status: 'partial', phase: 5, lede: 'The strategic plan: priorities and the outcomes behind them.', render: vPriorities },
      { id: 'measures', label: 'Measures', status: 'partial', phase: 5, lede: 'How each outcome is measured, with a starting point and a target.', render: vMeasures },
      { id: 'community', label: 'Community', status: 'wip', phase: 5, lede: 'What the community told us, and where it shows up in the plan.', render: vCommunity },
    ] },
    { id: 'decisions', label: 'Decisions', tabs: [
      { id: 'initiatives', label: 'All initiatives', status: 'partial', phase: 2, lede: 'Everything that costs money: projects, programs, hires.', render: vInitiatives },
      { id: 'ranking', label: 'Ranking & funding line', status: 'wip', phase: 2, lede: 'Force-rank initiatives and see where the money runs out.', render: vRanking },
      { id: 'scenarios', label: 'Scenarios', status: 'partial', phase: 2, lede: 'Different ways to pay for the plan, side by side.', render: vScenarios },
    ] },
    { id: 'resources', label: 'Resources', tabs: [
      { id: 'summary', label: 'Summary', status: 'wip', phase: 1, lede: 'Every fund at a glance.', render: vResSummary },
      { id: 'general', label: 'General fund', status: 'wip', phase: 6, lede: 'Five-year general-fund forecast, staffing and settlements.', render: vGeneralFund },
      { id: 'funds', label: 'All funds', status: 'partial', phase: 1, lede: 'Balances, receipts, debt and rules for each capital fund.', render: vFunds },
      { id: 'capital', label: 'Capital plan', status: 'wip', phase: 1, lede: 'Projects by year, split across Iowa’s capital funds, with the gap to close.', render: vCapital },
      { id: 'assumptions', label: 'Assumption sets', status: 'wip', phase: 2, lede: 'Base, Conservative and Growth: the world the plan has to survive.', render: vAssumptions },
    ] },
    { id: 'progress', label: 'Progress', tabs: [
      { id: 'initiatives', label: 'Initiatives', status: 'wip', phase: 3, lede: 'Status, budget against actual, schedule and owner.', render: vProgInitiatives },
      { id: 'measures', label: 'Measures', status: 'wip', phase: 5, lede: 'Results against targets over time.', render: vProgMeasures },
      { id: 'actuals', label: 'Budget vs. actual', status: 'wip', phase: 3, lede: 'Monthly actuals from the business office, by fund.', render: vActuals },
      { id: 'uploads', label: 'Uploads', status: 'partial', phase: 3, lede: 'Every file brought in, and what happened to it.', render: vUploads },
    ] },
    { id: 'reports', label: 'Reports', tabs: [
      { id: 'board', label: 'Board reports', status: 'wip', phase: 4, lede: 'Monthly board report, capital summary, decision packets.', render: vBoardReports },
      { id: 'community', label: 'Community page', status: 'partial', phase: 4, lede: 'What the public link shows.', render: vCommunityPage },
      { id: 'exports', label: 'Exports', status: 'wip', phase: 4, lede: 'Download the data behind every screen.', render: vExports },
    ] },
  ];
  const FOOT = [
    { id: 'settings', label: 'Settings', tabs: [
      { id: 'district', label: 'District', status: 'partial', phase: 1, lede: 'Name, link and look, and the numbers the plan starts from.', render: vDistrict },
      { id: 'people', label: 'People', status: 'live', lede: 'Who can see and change this district.', render: vPeople },
      { id: 'account', label: 'Your account', status: 'partial', phase: 1, lede: 'Your name, password and sign-in security.', render: vAccount },
    ] },
    { id: 'help', label: 'Help', tabs: [
      { id: 'built', label: 'What’s built', status: 'live', lede: 'Every screen, and whether it works yet.', render: vBuilt },
    ] },
  ];
  const ALL = [...SECTIONS, ...FOOT];

  // ------------------------------------------------------------------ frame
  function frame({ slug, sectionId, body }) {
    const d = S.district;
    const navLink = (s) => `<a href="#/d/${enc(slug)}/${s.id}/${s.tabs[0].id}" ${s.id === sectionId ? 'aria-current="page"' : ''}>${esc(s.label)}${s.tabs.every((t) => t.status === 'wip') ? '<span class="dot" title="Not built yet"></span>' : ''}</a>`;
    const options = S.districts.map((x) => `<option value="${esc(x.slug)}" ${d && x.slug === d.slug ? 'selected' : ''}>${esc(x.name)}${x.is_demo ? ' (demo)' : ''}</option>`).join('');
    const name = (S.profile && S.profile.full_name) || (S.user && S.user.email) || '';
    app.innerHTML = `
      <div class="frame">
        <nav class="rail" aria-label="HighGround">
          <a class="brand" href="#/">${LOGO}<span>HighGround</span></a>
          <div class="nav">${slug ? SECTIONS.map(navLink).join('') : ''}</div>
          <div class="nav nav-foot">
            ${slug ? FOOT.map(navLink).join('') : ''}
            ${S.isStaff ? `<a href="#/staff" ${sectionId === 'staff' ? 'aria-current="page"' : ''}>Willow Holler</a>` : ''}
          </div>
        </nav>
        <div class="main">
          ${d && d.is_demo ? '<div class="demo-bar">Demo district: made-up figures.</div>' : ''}
          <header class="topbar">
            ${slug ? nb('Search', 'Search', 5).replace('class="btn notbuilt"', 'class="btn notbuilt small"') : ''}
            <span class="spacer"></span>
            ${S.districts.length ? `<label class="chip">${d ? `<span class="tile" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>` : ''}
              <select data-switch aria-label="District">${d ? '' : '<option value="">Choose a district</option>'}${options}</select></label>` : ''}
            <a class="avatar" href="${slug ? `#/d/${enc(slug)}/settings/account` : '#/'}" title="${esc(name)}" aria-label="Your account">${esc(initials(name))}</a>
            <button type="button" class="btn small" data-action="signOut">Sign out</button>
          </header>
          <main class="content" id="content">${body}</main>
        </div>
      </div>`;
  }

  async function renderDistrict(slug, sectionId, tabId) {
    const d = S.districts.find((x) => x.slug === slug);
    if (!d) {
      S.district = null;
      frame({ slug: null, body: `<div class="notice error">You don’t have access to a district called “${esc(slug)}”, or it doesn’t exist.</div>
        <p><a href="#/">Go to your districts</a></p>` });
      return;
    }
    S.district = d; S.role = roleIn(d);
    try { localStorage.setItem('highground-last-district', d.slug); } catch (e) {}
    const section = ALL.find((s) => s.id === sectionId) || SECTIONS[0];
    const tab = section.tabs.find((t) => t.id === tabId) || section.tabs[0];
    const tabs = section.tabs.length > 1
      ? `<nav class="tabs" aria-label="${esc(section.label)}">${section.tabs.map((t) => `<a href="#/d/${enc(slug)}/${section.id}/${t.id}" ${t.id === tab.id ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>` : '';
    frame({ slug, sectionId: section.id, body: `
      <div class="page-head"><div><h1>${esc(section.label)}</h1>
        <div class="lede">${esc(tab.lede)}</div></div>
        <div class="right">${badge(tab.status)}${tab.status !== 'live' && tab.phase ? `<span class="small muted">${tab.status === 'wip' ? 'Planned for' : 'Rest in'} Phase ${tab.phase}</span>` : ''}</div></div>
      ${tabs}
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      <div id="view" class="stack"><div class="empty">Loading…</div></div>` });
    flash = null;
    const view = document.getElementById('view');
    try { view.innerHTML = await tab.render(ctx()); }
    catch (err) {
      view.innerHTML = `<div class="notice error">${esc(err instanceof HG.NotBuiltError ? err.message : 'This screen couldn’t load: ' + (err.message || err))}</div>`;
      if (!(err instanceof HG.NotBuiltError)) console.error(err);
    }
  }

  // ------------------------------------------------------------------ views: Overview
  async function vOverview(c) {
    const d = c.district.id;
    const [ini, sc, up, mem] = await Promise.all([
      HG.db.select('initiative', `select=id&district_id=eq.${d}`),
      HG.db.select('scenario', `select=id,name,is_board_version&district_id=eq.${d}`),
      HG.db.select('import_batch', `select=id,kind,status,uploaded_at&district_id=eq.${d}&order=uploaded_at.desc&limit=1`),
      HG.db.select('district_member', `select=user_id&district_id=eq.${d}`),
    ]);
    const board = sc.find((s) => s.is_board_version);
    return `
      <div class="grid">
        <div class="card"><div class="stat">${ini.length}</div><div class="muted">initiatives</div></div>
        <div class="card"><div class="stat">${sc.length}</div><div class="muted">scenarios${board ? `; board version is “${esc(board.name)}”` : '; no board version chosen'}</div></div>
        <div class="card"><div class="stat">${up.length ? esc(day(up[0].uploaded_at)) : 'None'}</div><div class="muted">last upload${up.length ? ` (${esc(KIND[up[0].kind] || up[0].kind)})` : ''}</div></div>
        <div class="card"><div class="stat">${mem.length}</div><div class="muted">people with access</div></div>
      </div>
      <p class="small muted">These counts are live. Everything below them is still to come.</p>
      ${wip({ phase: 5, items: [
        'Progress on each strategic priority',
        'Capital gap to close and general-fund outlook, from the engine',
        'Decisions coming up at the next board meetings',
        'Spending by priority',
        'What changed since last month',
      ], uses: 'priority, measure_value, scenario (engine), gl_current, report_snapshot' })}`;
  }

  // ------------------------------------------------------------------ views: Direction
  async function vPriorities(c) {
    const rows = await HG.db.select('priority', `select=position,name,statement,community_importance&district_id=eq.${c.district.id}&order=position`);
    return `
      <div class="row">${nb('Add a priority', 'Adding priorities', 5)}${nb('Upload goals', 'Goals upload', 5)}</div>
      <div class="card">${table([
        { label: 'Priority', get: (r) => r.name },
        { label: 'Statement', get: (r) => r.statement },
        { label: 'Community importance', num: true, get: (r) => r.community_importance },
      ], rows, 'No priorities yet. Adding them and uploading them both arrive in Phase 5.')}</div>
      ${wip({ phase: 5, items: ['Outcomes under each priority', 'Initiatives and dollars linked to each priority', 'Reorder by dragging'], uses: 'priority, outcome, initiative' })}`;
  }
  async function vMeasures(c) {
    const rows = await HG.db.select('measure', `select=name,unit,baseline_value,baseline_period,target_value,target_period,owner_name,cadence&district_id=eq.${c.district.id}&order=name`);
    return `
      <div class="row">${nb('Add a measure', 'Adding measures', 5)}${nb('Upload measure results', 'Measure results upload', 5)}</div>
      <div class="card">${table([
        { label: 'Measure', get: (r) => r.name },
        { label: 'Starting point', get: (r) => [r.baseline_value, r.unit, r.baseline_period && `(${r.baseline_period})`].filter((x) => x != null && x !== '').join(' ') },
        { label: 'Target', get: (r) => [r.target_value, r.unit, r.target_period && `(${r.target_period})`].filter((x) => x != null && x !== '').join(' ') },
        { label: 'Owner', get: (r) => r.owner_name },
        { label: 'Updated', get: (r) => r.cadence },
      ], rows, 'No measures yet.')}</div>
      ${wip({ phase: 5, items: ['Status against target', 'Measures filled automatically from Progress and uploads (projects on budget, solvency)'], uses: 'measure, measure_value' })}`;
  }
  async function vCommunity() {
    return `<div class="row">${nb('Upload survey results', 'Survey upload', 5)}</div>
      ${wip({ phase: 5, items: [
        'Survey totals and importance ratings',
        'Comment themes, each linked to a priority or initiative',
        'Flags where the community’s top concern is ranked low in the plan',
      ], uses: 'survey, survey_result (totals and themes only; no individual responses)' })}`;
  }

  // ------------------------------------------------------------------ views: Decisions
  async function vInitiatives(c) {
    const rows = await HG.db.select('initiative', `select=name,type,status,focus_area,tier,cost_confidence,condition&district_id=eq.${c.district.id}&order=name`);
    return `
      <div class="row">${nb('Add an initiative', 'Adding initiatives', 1)}${nb('Upload projects', 'Project upload', 1)}</div>
      <div class="card">${table([
        { label: 'Initiative', get: (r) => r.name },
        { label: 'Type', get: (r) => r.type },
        { label: 'Status', get: (r) => r.status },
        { label: 'Focus area', get: (r) => r.focus_area },
        { label: 'Tier', get: (r) => r.tier },
        { label: 'Cost', get: (r) => r.cost_confidence },
        { label: 'Condition', get: (r) => r.condition },
      ], rows, 'No initiatives yet. The project upload arrives in Phase 1.')}</div>
      ${wip({ phase: 2, items: ['Status pipeline from idea to done', 'Side panel: one-time costs, yearly costs, effect on the gap and on solvency', 'Programs and hires with yearly costs (the FFA-program case)'], uses: 'initiative, phase, phase_funding, recurring_cost' })}`;
  }
  async function vRanking() {
    return wip({ phase: 2, items: [
      'Force-ranked tiers: must-have, strategic, nice-to-have',
      'The funding line: where the money runs out, in rank order',
      'Flags where a lower-ranked item spends money a higher one needs',
      '“Fund in rank order” as a what-if',
    ], uses: 'scenario_initiative (rank), the engine' });
  }
  async function vScenarios(c) {
    const rows = await HG.db.select('scenario', `select=name,is_board_version,is_locked,updated_at&district_id=eq.${c.district.id}&order=name`);
    return `
      <div class="row">${nb('New scenario', 'Creating scenarios', 1)}${nb('Compare side by side', 'Scenario comparison', 2)}</div>
      <div class="card">${table([
        { label: 'Scenario', get: (r) => r.name },
        { label: 'Board version', get: (r) => (r.is_board_version ? 'Yes' : '') },
        { label: 'Locked', get: (r) => (r.is_locked ? 'Locked' : '') },
        { label: 'Last changed', get: (r) => day(r.updated_at) },
      ], rows, 'No scenarios yet.')}</div>
      ${wip({ phase: 2, items: ['Need, gap and funding by source for each scenario, from the engine', 'What each asks of the community: a vote, a tax change, a delay'], uses: 'scenario, phase, financing, the engine' })}`;
  }

  // ------------------------------------------------------------------ views: Resources
  async function vResSummary() {
    return wip({ phase: 1, items: ['Capital plan totals and gap, from the engine', 'Fund balances and their low points', 'Recurring costs committed by initiatives'], uses: 'fund_balance, scenario, the engine' })
      + wip({ title: 'General-fund summary: not built yet', phase: 6, items: ['Ending balance and solvency ratio'] });
  }
  async function vGeneralFund() {
    return wip({ phase: 6, items: [
      'Revenue: certified enrollment, cost per pupil, state supplemental aid',
      'Spending: staff by group, settlement %, health insurance',
      'Ending balance, solvency ratio, unspent spending authority',
      'What a settlement or a new hire does to the next five years',
    ], uses: 'assumption_set, recurring_cost, gl_current, budget_line' })
      + '<p class="small muted">This is the hardest model to get right. It will be checked with at least two business managers before any board sees it.</p>';
  }
  async function vFunds(c) {
    const d = c.district.id;
    const [bal, debt, set] = await Promise.all([
      HG.db.select('fund_balance', `select=fund,as_of,amount,source&district_id=eq.${d}&order=as_of.desc`),
      HG.db.select('debt_obligation', `select=name,fund,annual_payment,final_fy&district_id=eq.${d}&order=final_fy`),
      HG.db.select('district_settings', `select=*&district_id=eq.${d}`),
    ]);
    const latest = []; const seen = new Set();
    bal.forEach((b) => { if (!seen.has(b.fund)) { seen.add(b.fund); latest.push(b); } });
    const s = set[0];
    return `
      <div class="row">${c.finance ? nb('Enter balances', 'Entering balances', 1) + nb('Upload balances', 'Balances upload', 1) : ''}</div>
      <div class="card"><h3>Latest balances</h3>${table([
        { label: 'Fund', get: (r) => r.fund.toUpperCase() },
        { label: 'As of', get: (r) => day(r.as_of) },
        { label: 'Balance', num: true, get: (r) => money(r.amount) },
        { label: 'From', get: (r) => ({ manual: 'Typed in', upload: 'Balances upload', gl_import: 'Monthly GL' }[r.source] || r.source) },
      ], latest, 'No balances yet.')}</div>
      <div class="card"><h3>Existing debt</h3>${table([
        { label: 'Obligation', get: (r) => r.name },
        { label: 'Paid from', get: (r) => r.fund.toUpperCase() },
        { label: 'Per year', num: true, get: (r) => money(r.annual_payment) },
        { label: 'Final year', get: (r) => 'FY' + r.final_fy },
      ], debt, 'No debt entered.')}</div>
      <div class="card"><h3>Yearly receipts</h3>${s ? table([
        { label: 'Fund', get: (r) => r.f }, { label: 'Receipts per year', num: true, get: (r) => money(r.v) },
      ], [{ f: 'SAVE', v: s.save_receipts }, { f: 'PPEL', v: s.ppel_receipts }, { f: 'V-PPEL', v: s.vppel_status === 'none' ? null : s.vppel_annual }], '') : '<div class="empty">Not set up yet. The setup wizard arrives in Phase 1.</div>'}</div>
      ${wip({ phase: 1, items: ['What each fund may legally pay for', 'Year-by-year receipts, spending and low point, from the engine', 'SAVE revenue-bond room and the GO debt limit'], uses: 'district_settings, fund_balance, debt_obligation, rule_value, the engine' })}`;
  }
  async function vCapital() {
    return wip({ title: 'Today’s capital planner moves here: not built yet', phase: 1, items: [
      'Capital spending by year: levies and grants, boosters, campaign or bond needed',
      'What-if levers: valuation growth, grant yield, SAVE trend, inflation, SF 2472, V-PPEL',
      'Financing: bonds, leases, campaigns',
      'Projects by year as cards or a table',
      'Same engine and same numbers as the working planner, proved by its regression tests',
    ], uses: 'scenario, phase, phase_funding, financing, district_settings, fund_balance, debt_obligation, the engine' });
  }
  async function vAssumptions() {
    return wip({ phase: 2, items: ['Base, Conservative and Growth assumption sets', 'Stress-test one decision across all three', 'Keeps “the world” (assumptions) apart from “our choices” (scenarios)'], uses: 'assumption_set, scenario' });
  }

  // ------------------------------------------------------------------ views: Progress
  async function vProgInitiatives() {
    return wip({ phase: 3, items: ['Status and percent complete', 'Budget against actual, from matched GL accounts', 'Start, due and done dates; owner', 'Mark a phase done with its actual cost'], uses: 'phase, gl_account (initiative mapping), gl_current' });
  }
  async function vProgMeasures() {
    return wip({ phase: 5, items: ['Each measure’s trend against its target', 'Updates owed by each owner'], uses: 'measure, measure_value' });
  }
  async function vActuals() {
    return wip({ phase: 3, items: [
      'Upload a monthly GL export or trial balance',
      'Match accounts once; HighGround remembers them month to month',
      'Review new accounts, then apply',
      'Budget against actual by fund, compared with any earlier month',
    ], uses: 'import_batch, gl_account, gl_amount, budget_line, apply_import()' });
  }
  async function vUploads(c) {
    const rows = await HG.db.select('import_batch', `select=kind,period_end,file_name,status,uploaded_at&district_id=eq.${c.district.id}&order=uploaded_at.desc&limit=100`);
    const buttons = [
      c.finance && nb('Monthly GL export', 'Monthly GL upload', 3),
      c.finance && nb('Budget', 'Budget upload', 3),
      c.finance && nb('Fund balances', 'Balances upload', 1),
      c.plan && nb('Projects', 'Project upload', 1),
      c.plan && nb('Goals', 'Goals upload', 5),
      (c.plan || c.finance) && nb('Measure results', 'Measure results upload', 5),
      c.plan && nb('Survey results', 'Survey upload', 5),
    ].filter(Boolean);
    return `
      ${buttons.length ? `<div class="card"><h3>Upload</h3><div class="row">${buttons.join('')}</div>
        <p class="small muted" style="margin-top:10px">Every upload is kept. You review it before it counts, and a new month’s upload replaces the earlier one for that month.</p></div>`
        : '<p class="muted">Your role can see uploads but not add them.</p>'}
      <div class="card"><h3>History</h3>${table([
        { label: 'Kind', get: (r) => KIND[r.kind] || r.kind },
        { label: 'Month', get: (r) => day(r.period_end) },
        { label: 'File', get: (r) => r.file_name },
        { label: 'Status', get: (r) => r.status },
        { label: 'Uploaded', get: (r) => day(r.uploaded_at) },
      ], rows, 'Nothing uploaded yet.')}</div>
      ${wip({ phase: 3, items: ['Templates to download for each kind of upload', 'Review screen: new accounts, warnings, errors', 'Apply and discard'], uses: 'import_batch, import_row, import_issue, storage bucket district-files' })}`;
  }

  // ------------------------------------------------------------------ views: Reports
  async function vBoardReports() {
    return `<div class="row">${nb('Create this month’s board report', 'Monthly board report', 4)}</div>` + wip({ phase: 4, items: [
      'Monthly board report: a dated snapshot, with what changed since last month',
      'Capital summary',
      'Decision packet: one initiative across all funds over five years',
      'Strategic progress',
      'PDF packet',
    ], uses: 'report_snapshot' });
  }
  async function vCommunityPage(c) {
    const pubs = await HG.db.select('publication', `select=kind,title,published_at,is_current&district_id=eq.${c.district.id}&order=published_at.desc&limit=20`);
    const link = `${HG.appUrl()}#/p/${enc(c.district.slug)}`;
    const current = pubs.find((p) => p.kind === 'board_plan' && p.is_current);
    return `
      <div class="card"><h3>Public link</h3>
        <p>${c.district.public_link_enabled ? `Anyone with this link sees what you publish, and nothing else: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : 'The public link is turned off for this district (Settings, District).'}</p>
        <p class="small muted">${current ? `Board version published ${esc(day(current.published_at))}.` : 'Nothing published yet.'}</p>
        <div class="row">${c.admin ? nb('Publish the board version', 'Publishing the board version', 1) + nb('Publish the community page', 'Publishing the community page', 4) : ''}</div></div>
      ${wip({ phase: 4, items: ['Choose what’s public: what you told us, what we planned, what we delivered', 'Changes since the last publish', 'Unapproved proposals held back automatically', 'Publish log'], uses: 'publication, public_publication()' })}`;
  }
  async function vExports() {
    return `<div class="row">${nb('Download all data', 'Data export', 4)}</div>` + wip({ phase: 4, items: ['Every table as a spreadsheet', 'Uploads use the same layouts, so an export can be edited and uploaded back'], uses: 'every district table' });
  }

  // ------------------------------------------------------------------ views: Settings
  async function vDistrict(c) {
    const d = c.district;
    const dis = c.admin ? '' : 'disabled';
    return `
      <div class="card"><h3>District</h3>
        <form class="stack" data-form="saveDistrict">
          <label class="field">District name<input name="name" required maxlength="120" value="${esc(d.name)}" ${dis}></label>
          <label class="field">Short name<input name="short_name" maxlength="40" value="${esc(d.short_name)}" ${dis}></label>
          <label class="field">County<input name="county" value="${esc(d.county)}" ${dis}></label>
          <label class="field">Brand color<input name="brand_color" type="color" value="${esc(d.brand_color || '#1E3A2F')}" ${dis}>
            <span class="hint">Used for the district’s tile and public page. Buttons keep HighGround’s colors.</span></label>
          <label class="row"><input type="checkbox" name="public_link_enabled" ${d.public_link_enabled ? 'checked' : ''} ${dis}> Public link on</label>
          <p class="small muted">Link id: <b>${esc(d.slug)}</b> (set when the district is created)</p>
          ${c.admin ? '<div><button class="btn primary" type="submit">Save changes</button></div>' : '<p class="small muted">Only a district admin can change these.</p>'}
        </form></div>
      <div class="row">${c.admin ? nb('Upload a logo', 'Logo upload', 1) : ''}${c.finance ? nb('Set up the plan’s starting numbers', 'Setup wizard (revenue, levies, debt, balances)', 1) : ''}</div>
      ${wip({ phase: 1, items: ['Setup wizard: plan years, SAVE and PPEL receipts, V-PPEL, grants, valuation, debt', 'Logo'], uses: 'district_settings, debt_obligation, storage bucket district-public' })}`;
  }
  async function vPeople(c) {
    const d = c.district.id;
    const [mem, inv] = await Promise.all([
      HG.db.select('district_member', `select=user_id,role,created_at&district_id=eq.${d}&order=created_at`),
      c.admin ? HG.db.select('invitation', `select=id,email,role,created_at,expires_at&district_id=eq.${d}&accepted_at=is.null&order=created_at.desc`) : Promise.resolve([]),
    ]);
    const ids = mem.map((m) => m.user_id);
    const prof = ids.length ? await HG.db.select('profile', `select=user_id,email,full_name,title&user_id=in.(${ids.map(enc).join(',')})`) : [];
    const P = Object.fromEntries(prof.map((p) => [p.user_id, p]));
    const roleSelect = (m) => `<select data-role-for="${esc(m.user_id)}" aria-label="Role" ${c.admin ? '' : 'disabled'}>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    const roleOptions = Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === 'viewer' ? 'selected' : ''}>${v}</option>`).join('');
    return `
      <div class="card"><h3>People with access</h3>${table([
        { label: 'Name', get: (m) => (P[m.user_id] && P[m.user_id].full_name) || '' },
        { label: 'Email', get: (m) => (P[m.user_id] && P[m.user_id].email) || '' },
        { label: 'Role', html: roleSelect },
        { label: '', html: (m) => (c.admin ? `<button type="button" class="btn small danger" data-action="removeMember" data-user="${esc(m.user_id)}">Remove</button>` : '') },
      ], mem, 'Nobody has access yet.')}</div>
      ${c.admin ? `
      <div class="card"><h3>Invite someone</h3>
        <p class="small muted">They create an account with this email and confirm it; access starts then. If they already have a confirmed account, access starts now.</p>
        <form class="inline-form" data-form="invite">
          <label class="field">Email<input name="email" type="email" required autocomplete="off"></label>
          <label class="field">Role<select name="role">${roleOptions}</select></label>
          <button class="btn primary" type="submit">Send invitation</button>
        </form>
        <p class="small muted" style="margin-top:10px">HighGround doesn’t email the invitation yet (Phase 1). Tell them to go to ${esc(HG.appUrl())} and create an account with that address.</p></div>
      <div class="card"><h3>Waiting to accept</h3>${table([
        { label: 'Email', get: (i) => i.email },
        { label: 'Role', get: (i) => ROLE[i.role] },
        { label: 'Invited', get: (i) => day(i.created_at) },
        { label: 'Expires', get: (i) => day(i.expires_at) },
        { label: '', html: (i) => `<button type="button" class="btn small danger" data-action="cancelInvite" data-id="${esc(i.id)}">Cancel</button>` },
      ], inv, 'No open invitations.')}</div>` : '<p class="small muted">Only a district admin can invite people or change roles.</p>'}
      <details class="small muted"><summary>What each role can do</summary>
        <p><b>Admin</b>: everything, including people, settings, publishing and unlocking scenarios. <b>Business manager</b>: financial uploads, balances, debt, settings. <b>Superintendent</b> and <b>Editor</b>: initiatives, scenarios, goals, project and goal uploads. <b>Board member</b> and <b>Viewer</b>: read everything in the district.</p></details>`;
  }
  async function vAccount() {
    const p = S.profile || {};
    return `
      <div class="card"><h3>You</h3>
        <form class="stack" data-form="saveProfile">
          <label class="field">Name<input name="full_name" maxlength="120" value="${esc(p.full_name)}"></label>
          <label class="field">Title<input name="title" maxlength="120" value="${esc(p.title)}" placeholder="Business manager, board member …"></label>
          <p class="small muted">Signed in as ${esc(S.user && S.user.email)}</p>
          <div><button class="btn primary" type="submit">Save changes</button></div>
        </form></div>
      <div class="card"><h3>Change password</h3>
        <form class="stack" data-form="changePassword">
          <label class="field">New password<input name="password" type="password" minlength="8" required autocomplete="new-password"><span class="hint">At least 8 characters, with a lowercase letter, a capital, a number and a symbol.</span></label>
          <label class="field">New password again<input name="again" type="password" minlength="8" required autocomplete="new-password"></label>
          <div><button class="btn primary" type="submit">Change password</button></div>
        </form></div>
      <div class="card"><h3>Two-step sign-in</h3><p>Use an authenticator app as a second step when you sign in.</p>${nb('Turn on two-step sign-in', 'Two-step sign-in', 1)}</div>`;
  }
  async function vBuilt() {
    const rows = [];
    ALL.forEach((s) => s.tabs.forEach((t) => rows.push({ s: s.label, t: t.label, status: t.status, phase: t.phase })));
    rows.push({ s: 'Sign-in', t: 'Email and password, confirmation, reset', status: 'live' });
    rows.push({ s: 'Public link', t: 'Read-only page for a district', status: 'partial', phase: 1 });
    return `<div class="card">${table([
      { label: 'Section', get: (r) => r.s }, { label: 'Screen', get: (r) => r.t },
      { label: 'Status', html: (r) => badge(r.status) }, { label: 'Rest arrives', get: (r) => (r.status === 'live' ? '' : r.phase ? 'Phase ' + r.phase : '') },
    ], rows, '')}</div>
    <p class="small muted">Anything dashed or orange is not built. Buttons with a dashed border say so when you click them.</p>`;
  }

  // ------------------------------------------------------------------ Willow Holler staff
  async function renderStaff() {
    S.district = null; S.role = null;
    const rows = await HG.db.select('district', 'select=id,slug,name,state,is_demo,public_link_enabled,created_at&order=name');
    frame({ slug: null, sectionId: 'staff', body: `
      <div class="page-head"><div><h1>Willow Holler</h1><div class="lede">Every district, and new ones.</div></div><div class="right">${badge('live')}</div></div>
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      <div class="card"><h3>Districts</h3>${table([
        { label: 'District', html: (r) => `<a href="#/d/${enc(r.slug)}/overview/today">${esc(r.name)}</a>` },
        { label: 'Link id', get: (r) => r.slug }, { label: 'State', get: (r) => r.state },
        { label: 'Demo', get: (r) => (r.is_demo ? 'Demo' : '') }, { label: 'Created', get: (r) => day(r.created_at) },
      ], rows, 'No districts yet. Add the first one below; start with a fictional demo district.')}</div>
      <div class="card"><h3>Add a district</h3>
        <form class="stack" data-form="createDistrict">
          <label class="field">District name<input name="name" required maxlength="120" placeholder="Ironwood Valley Community School District"></label>
          <label class="field">Short name<input name="short_name" maxlength="40" placeholder="Ironwood Valley"></label>
          <label class="field">Link id<input name="slug" required pattern="[a-z0-9\\-]{2,40}" placeholder="ironwood-valley"><span class="hint">Lowercase letters, numbers and hyphens. It appears in the district’s link and can’t be changed later.</span></label>
          <label class="row"><input type="checkbox" name="is_demo"> Demo district (fictional figures)</label>
          <label class="field">First admin’s email<input name="admin_email" type="email" placeholder="optional"><span class="hint">Gets an invitation as the district’s admin.</span></label>
          <div><button class="btn primary" type="submit">Add district</button></div>
        </form></div>` });
    flash = null;
  }

  function renderNoDistrict() {
    S.district = null;
    frame({ slug: null, body: `
      <div class="page-head"><div><h1>Welcome to HighGround</h1><div class="lede">You’re signed in as ${esc(S.user.email)}.</div></div></div>
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      <div class="card"><h3>You don’t have access to a district yet</h3>
        <p>Ask your district’s HighGround admin to invite <b>${esc(S.user.email)}</b>. Access starts as soon as they do.</p>
        <div class="row"><button type="button" class="btn primary" data-action="recheck">Check again</button>${nb('Request access', 'Requesting access', 1)}</div></div>` });
    flash = null;
  }

  // ------------------------------------------------------------------ public page (no account)
  async function renderPublic(slug) {
    const p = await HG.db.rpc('public_publication', { p_slug: slug, p_kind: 'board_plan' }, { auth: false });
    const d = p && p.district;
    app.innerHTML = `
      <div class="main">
        <header class="topbar"><span class="brand" style="flex-direction:row;gap:10px">${LOGO.replace('#F7F5EF', '#1E3A2F')}<b style="font-family:var(--serif)">HighGround</b></span>
          <span class="spacer"></span><a class="btn small" href="#/signin">Sign in</a></header>
        <main class="content">
          ${p ? `<div class="page-head"><div><h1>${esc(d.name)}</h1><div class="lede">${esc(p.title || 'Capital plan')}, published ${esc(day(p.published_at))}</div></div><div class="right">${badge('partial')}</div></div>
            ${d.is_demo ? '<div class="notice">Demo district: made-up figures.</div>' : ''}
            ${wip({ title: 'Showing the published plan: not built yet', phase: 1, items: ['The board version’s chart, projects by year and gap to close', 'What-if levers that visitors can move without saving anything'] })}`
          : `<div class="card"><h2>Nothing published here yet</h2><p>This link doesn’t have a published plan. If you expected one, ask the district.</p></div>`}
        </main>
      </div>`;
  }

  // ------------------------------------------------------------------ sign-in screens
  function authFrame(inner) {
    app.innerHTML = `<div class="auth">
      <aside class="auth-side"><a class="brand" href="#/signin" style="align-items:flex-start">${LOGO}<span>HighGround</span></a>
        <p>Strategy, decisions, capital planning and accountability for Iowa school districts.</p>
        <p class="small">By Willow Holler.</p></aside>
      <main class="auth-main"><div class="auth-card">${inner}</div></main></div>`;
  }
  function renderAuth(which) {
    const msg = flash ? `<div class="notice ${/confirm|sent|check|changed/i.test(flash) ? 'ok' : 'error'}">${esc(flash)}</div>` : '';
    flash = null;
    if (which === 'signup') return authFrame(`<h1>Create your account</h1>${msg}
      <form class="stack" data-form="signUp">
        <label class="field">Your name<input name="full_name" autocomplete="name" required></label>
        <label class="field">Work email<input name="email" type="email" autocomplete="email" required><span class="hint">Use the address your district invited.</span></label>
        <label class="field">Password<input name="password" type="password" minlength="8" autocomplete="new-password" required><span class="hint">At least 8 characters, with a lowercase letter, a capital, a number and a symbol.</span></label>
        <label class="field">Password again<input name="again" type="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Create account</button></form>
      <div class="links"><a href="#/signin">I have an account</a></div>`);
    if (which === 'forgot') return authFrame(`<h1>Reset your password</h1>${msg}
      <form class="stack" data-form="forgot">
        <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
        <button class="btn primary" type="submit">Email me a reset link</button></form>
      <div class="links"><a href="#/signin">Back to sign in</a></div>`);
    return authFrame(`<h1>Sign in</h1>${msg}
      <form class="stack" data-form="signIn">
        <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
        <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Sign in</button></form>
      <div class="links"><a href="#/forgot">Forgot your password?</a><a href="#/signup">Create an account</a></div>`);
  }
  function renderSetPassword() {
    authFrame(`<h1>Choose a new password</h1>
      <form class="stack" data-form="setPassword">
        <label class="field">New password<input name="password" type="password" minlength="8" autocomplete="new-password" required><span class="hint">At least 8 characters, with a lowercase letter, a capital, a number and a symbol.</span></label>
        <label class="field">New password again<input name="again" type="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Save password</button></form>`);
  }
  async function handleEmailLink(hash) {
    history.replaceState(null, '', location.pathname + location.search);
    let r;
    try { r = await HG.auth.fromLink(hash); } catch (e) { return go('#/signin', e.message); }
    if (!r) return go('#/signin');
    if (r.error) return go('#/signin', r.error);
    S.loaded = false;
    if (r.type === 'recovery') return go('#/set-password');
    return go('#/', 'Your email is confirmed. Welcome to HighGround.');
  }
  function renderNotConnected() {
    app.innerHTML = `<div class="auth"><aside class="auth-side"><span class="brand" style="align-items:flex-start">${LOGO}<span>HighGround</span></span></aside>
      <main class="auth-main"><div class="auth-card"><h1>Not connected yet</h1>
        <p>This copy of HighGround doesn’t know which database to use.</p>
        <p>Open <b>config.js</b> and fill in the Supabase project address and its <b>publishable</b> key (Supabase: Project Settings, API Keys). Never put the secret key there.</p>
        <p class="small muted">See docs/SETUP.md, step 9.</p></div></main></div>`;
  }
  function renderFatal(err) {
    console.error(err);
    app.innerHTML = `<div class="auth"><aside class="auth-side"><span class="brand" style="align-items:flex-start">${LOGO}<span>HighGround</span></span></aside>
      <main class="auth-main"><div class="auth-card"><h1>Something went wrong</h1>
        <div class="notice error">${esc(err && err.message ? err.message : err)}</div>
        <div class="row"><button class="btn primary" type="button" data-action="reload">Try again</button><button class="btn" type="button" data-action="signOut">Sign out</button></div></div></main></div>`;
  }

  // ------------------------------------------------------------------ actions and forms
  const pwOk = (f) => {
    if (f.password !== f.again) throw new UserError('The two passwords don’t match.');
    if (String(f.password).length < 8) throw new UserError('Use at least 8 characters.');
    const pw = String(f.password);
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
      throw new UserError('Use at least one lowercase letter, one capital, one number and one symbol (like ! or #).');
    }
  };
  const here = () => route();
  const ACTIONS = {
    async signOut() { await HG.auth.signOut(); S.loaded = false; go('#/signin', 'You’re signed out.'); },
    async recheck() { await loadContext(true); go('#/'); },
    async reload() { S.loaded = false; route(); },
    async removeMember(el) {
      if (!confirm('Remove this person’s access to the district?')) return;
      await HG.db.remove('district_member', `district_id=eq.${S.district.id}&user_id=eq.${enc(el.dataset.user)}`);
      if (el.dataset.user === S.user.id) { await loadContext(true); return go('#/'); }
      toast('Removed', 'They no longer have access.'); here();
    },
    async cancelInvite(el) {
      await HG.db.remove('invitation', `id=eq.${enc(el.dataset.id)}`);
      toast('Invitation cancelled'); here();
    },
  };
  const FORMS = {
    async signIn(f) { await HG.auth.signIn(f.email.trim(), f.password); document.getElementById('toasts').innerHTML = ''; S.loaded = false; go('#/'); },
    async signUp(f) {
      pwOk(f);
      const ready = await HG.auth.signUp(f.email.trim(), f.password, f.full_name.trim());
      S.loaded = false;
      if (ready) return go('#/');
      go('#/signin', `Check ${f.email.trim()} for a confirmation link. Open it, and you’ll be signed in.`);
    },
    async forgot(f) { await HG.auth.sendReset(f.email.trim()); go('#/signin', 'If that email has an account, we sent a reset link. Check your inbox.'); },
    async setPassword(f) { pwOk(f); await HG.auth.setPassword(f.password); go('#/', 'Password changed.'); },
    async changePassword(f, form) { pwOk(f); await HG.auth.setPassword(f.password); form.reset(); toast('Password changed'); },
    async saveProfile(f) {
      await HG.db.update('profile', `user_id=eq.${enc(S.user.id)}`, { full_name: f.full_name.trim() || null, title: f.title.trim() || null });
      await loadContext(true); toast('Saved'); here();
    },
    async saveDistrict(f) {
      await HG.db.update('district', `id=eq.${S.district.id}`, {
        name: f.name.trim(), short_name: f.short_name.trim() || null, county: f.county.trim() || null,
        brand_color: f.brand_color || null, public_link_enabled: !!f.public_link_enabled,
      });
      await loadContext(true); toast('Saved'); here();
    },
    async invite(f, form) {
      await HG.db.insert('invitation', { district_id: S.district.id, email: f.email.trim().toLowerCase(), role: f.role });
      form.reset(); toast('Invitation saved', `${f.email.trim()} can now create an account and will get access once their email is confirmed.`); here();
    },
    async createDistrict(f) {
      const [d] = await HG.db.insert('district', { name: f.name.trim(), short_name: f.short_name.trim() || null, slug: f.slug.trim(), is_demo: !!f.is_demo });
      if (f.admin_email && f.admin_email.trim()) {
        await HG.db.insert('invitation', { district_id: d.id, email: f.admin_email.trim().toLowerCase(), role: 'admin' });
      }
      await loadContext(true);
      go('#/staff', `Added ${d.name}.${f.admin_email ? ' Invitation saved for its admin.' : ''}`);
    },
  };

  async function run(fn, button) {
    if (button) button.disabled = true;
    try { await fn(); } catch (err) { showError(err); } finally { if (button && button.isConnected) button.disabled = false; }
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-notbuilt]');
    if (n) { e.preventDefault(); try { HG.notBuilt(n.dataset.notbuilt, n.dataset.phase); } catch (err) { showError(err); } return; }
    const a = e.target.closest('[data-action]');
    if (a && ACTIONS[a.dataset.action]) { e.preventDefault(); run(() => ACTIONS[a.dataset.action](a), a); }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form || !FORMS[form.dataset.form]) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    run(() => FORMS[form.dataset.form](data, form), form.querySelector('[type=submit]'));
  });
  document.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-switch]');
    if (sw && sw.value) {
      const parts = location.hash.replace(/^#\/?/, '').split('/');
      const tail = parts[0] === 'd' ? parts.slice(2).join('/') : 'overview/today';
      return go(`#/d/${enc(sw.value)}/${tail || 'overview/today'}`);
    }
    const rs = e.target.closest('[data-role-for]');
    if (rs) run(async () => {
      await HG.db.update('district_member', `district_id=eq.${S.district.id}&user_id=eq.${enc(rs.dataset.roleFor)}`, { role: rs.value });
      toast('Role changed', ROLE[rs.value]);
      if (rs.dataset.roleFor === S.user.id) { await loadContext(true); here(); }
    }, rs);
  });

  route();
})();
