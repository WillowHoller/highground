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
  /* HighGround's logo: 'light' (cream) on the dark green rail and sign-in panel, colour on light backgrounds */
  const LOGO_LIGHT = `<img src="highground-wordmark-light.png" alt="HighGround" class="logo-img" width="170" height="31">`;
  const LOGO_COLOR = `<img src="highground-wordmark.png" alt="HighGround" class="logo-img" width="170" height="31">`;

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
    const verified = (u.factors || []).filter((f) => f.status === 'verified');
    S.mfaFactor = verified.length && HG.auth.aal() !== 'aal2' ? verified[0].id : null;
    if (S.mfaFactor) { S.loaded = false; return; }
    try { await HG.db.rpc('claim_my_access'); } catch (e) { /* older database without part 7: carry on */ }
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
    document.querySelectorAll('[data-modal]').forEach((m) => m.remove());   // a dialog never outlives its page
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
      if (S.mfaFactor) return renderTwoStep();
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
      { id: 'initiatives', label: 'All initiatives', status: 'live', lede: 'Everything that costs money: projects, programs, hires.', render: vInitiatives },
      { id: 'ranking', label: 'Ranking & funding line', status: 'live', lede: 'Force-rank initiatives and see where the money runs out.', render: vRanking },
      { id: 'scenarios', label: 'Scenarios', status: 'live', lede: 'Different ways to pay for the plan, side by side.', render: vScenarios },
    ] },
    { id: 'resources', label: 'Resources', tabs: [
      { id: 'summary', label: 'Summary', status: 'partial', phase: 6, lede: 'Every fund at a glance, from the board version.', render: vResSummary },
      { id: 'general', label: 'General fund', status: 'wip', phase: 6, lede: 'Five-year general-fund forecast, staffing and settlements.', render: vGeneralFund },
      { id: 'funds', label: 'All funds', status: 'live', lede: 'Balances, receipts, spending, debt and rules for each capital fund.', render: vFunds },
      { id: 'capital', label: 'Capital plan', status: 'partial', phase: 1, lede: 'Projects by year, split across Iowa’s capital funds, with the gap to close.', render: vCapital },
      { id: 'assumptions', label: 'Assumption sets', status: 'live', lede: 'Base, Conservative and Growth: the world the plan has to survive.', render: vAssumptions },
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
      { id: 'exports', label: 'Exports', status: 'partial', phase: 2, lede: 'Download the district’s data, for spreadsheets or backup.', render: vExports },
    ] },
  ];
  const FOOT = [
    { id: 'settings', label: 'Settings', tabs: [
      { id: 'district', label: 'District', status: 'partial', phase: 1, lede: 'Name, link and look, and the numbers the plan starts from.', render: vDistrict },
      { id: 'setup', label: 'Starting numbers', status: 'live', lede: 'What the capital plan starts from: receipts, balances and existing debt.', render: vSetup },
      { id: 'people', label: 'People', status: 'live', lede: 'Who can see and change this district.', render: vPeople },
      { id: 'activity', label: 'Activity', status: 'live', lede: 'Every change: who, when, and what it was before.', render: vActivity },
      { id: 'account', label: 'Your account', status: 'live', lede: 'Your name, password and sign-in security.', render: vAccount },
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
          <a class="brand" href="#/" aria-label="HighGround home">${LOGO_LIGHT}</a>
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
    ACT.before = null;
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
  const INI = { status: '', type: '', sid: null, key: null };
  async function vInitiatives(c) {
    const rows = await loadCapitalRows(c.district);
    INI.rows = rows;
    const board = rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0];
    if (INI.key !== c.district.id || !rows.scenarios.some((x) => x.id === INI.sid)) { INI.key = c.district.id; INI.sid = board ? board.id : null; }
    const costSc = rows.scenarios.find((x) => x.id === INI.sid);
    const P = Object.fromEntries((rows.priorities || []).map((p) => [p.id, p.name]));
    const oneTime = {}, yearly = {};
    if (costSc) {
      rows.phases.filter((ph) => ph.scenario_id === costSc.id).forEach((ph) => { oneTime[ph.initiative_id] = (oneTime[ph.initiative_id] || 0) + Number(ph.cost); });
      (rows.recurring || []).filter((r) => r.scenario_id === costSc.id).forEach((r) => { yearly[r.initiative_id] = (yearly[r.initiative_id] || 0) + Number(r.annual_amount); });
    }
    const STATUS = Object.fromEntries(INIT_STATUS), TYPE = Object.fromEntries(INIT_TYPES);
    const plansOf = (id) => rows.scenarios.filter((x) => rows.phases.some((ph) => ph.scenario_id === x.id && ph.initiative_id === id) || (rows.recurring || []).some((r) => r.scenario_id === x.id && r.initiative_id === id));
    INI.plansOf = plansOf;
    const counts = Object.fromEntries(INIT_STATUS.map(([k]) => [k, rows.initiatives.filter((i) => (i.status || 'proposed') === k).length]));
    const list = rows.initiatives.filter((i) => (!INI.status || (i.status || 'proposed') === INI.status) && (!INI.type || i.type === INI.type));
    return `
      <div class="pipeline" role="group" aria-label="Filter by status">
        <button type="button" class="pipe ${!INI.status ? 'on' : ''}" data-action="iniStatus" data-v="">All <b>${rows.initiatives.length}</b></button>
        ${INIT_STATUS.map(([k, v]) => `<button type="button" class="pipe ${INI.status === k ? 'on' : ''}" data-action="iniStatus" data-v="${k}">${v} <b>${counts[k]}</b></button>`).join('')}
      </div>
      <div class="row">
        ${rows.scenarios.length ? `<label class="chip"><span class="small muted">Costs from</span><select data-ini-sid aria-label="Costs from">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === INI.sid ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>` : ''}
        <label class="chip"><span class="small muted">Type</span><select data-ini-type aria-label="Type"><option value="">All types</option>${INIT_TYPES.map(([k, v]) => `<option value="${k}" ${INI.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${c.plan ? '<button type="button" class="btn primary" data-action="editInitiative" data-id="">Add an initiative</button>' : ''}
        <a class="btn" href="#/d/${enc(c.district.slug)}/progress/uploads">Upload projects</a>
      </div>
      <div class="card">${table([
        { label: 'Initiative', html: (i) => (c.plan ? `<a href="#" data-action="editInitiative" data-id="${esc(i.id)}">${esc(i.name)}</a>` : esc(i.name)) },
        { label: 'Type', get: (i) => TYPE[i.type] || i.type },
        { label: 'Status', html: (i) => `<span class="st st-${esc(i.status || 'proposed')}">${esc(STATUS[i.status || 'proposed'])}</span>` },
        { label: 'In plans', html: (i) => { const pl = plansOf(i.id); const inBoard = board && pl.some((x) => x.id === board.id);
          const warn = (i.status === 'approved' || i.status === 'underway') && board && !inBoard ? `<br><span class="small gaptext">Approved, but not in the board version yet</span>` : '';
          return (pl.length ? pl.map((x) => esc(x.name) + (x.is_board_version ? ' <span class="small muted">(board)</span>' : '')).join('<br>') : '<span class="muted">Not in a plan yet</span>') + warn; } },
        { label: 'Priority', get: (i) => (HGUploads.TIER_WORD[HGRanking.tierOf(i).tier] || '') },
        ...((rows.priorities || []).length ? [{ label: 'Strategic priority', get: (i) => P[i.priority_id] || '' }] : []),
        { label: 'Owner', get: (i) => i.owner_name || '' },
        { label: 'One-time cost', num: true, get: (i) => (oneTime[i.id] ? fmtK(oneTime[i.id]) : '') },
        { label: 'Yearly cost', num: true, get: (i) => (yearly[i.id] ? fmtK(yearly[i.id]) : '') },
      ], list, rows.initiatives.length ? 'Nothing matches these filters.' : 'No initiatives yet. Add one, or upload a project spreadsheet.')}
      ${costSc ? `<p class="small muted" style="margin-top:8px">Costs are from ${esc(costSc.name)}${costSc.is_board_version ? ', the board version' : ''}, in today’s dollars (yearly costs at their starting amount). Change them here or on the capital plan; both edit the same plan.</p>` : ''}</div>`;
  }
  const RK = { key: null, sid: null };
  async function vRanking(c) {
    const rows = await loadCapitalRows(c.district);
    RK.rows = rows;
    if (!rows.settings || !rows.scenarios.length) return notReady(c, { rows });
    if (RK.key !== c.district.id || !rows.scenarios.some((x) => x.id === RK.sid)) { RK.key = c.district.id; RK.sid = (rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0]).id; }
    const sc = rows.scenarios.find((x) => x.id === RK.sid), k = HGRanking.build(rows, RK.sid);
    RK.k = k;
    const canMove = c.plan && !sc.is_locked, TN = HGRanking.TIER_NAME;
    const outside = k.items.filter((x) => x.outside > 0.5);
    const campTotal = outside.reduce((a, x) => a + x.camp, 0), boostTotal = outside.reduce((a, x) => a + x.boost, 0);
    const summary = k.line >= k.items.length
      ? `<b>Everything fits</b> within SAVE, PPEL, V-PPEL and grants, in rank order.`
      : `<b>The money runs out at #${k.line + 1}.</b> The first ${k.line} initiative${k.line === 1 ? '' : 's'} (${fmtK(k.aboveCost)}) fit within SAVE, PPEL, V-PPEL and grants; ${k.items.length - k.line} fall below the line.`;
    const tierSel = (x) => c.plan ? `<select data-rank-tier="${esc(x.id)}" aria-label="Priority for ${esc(x.name)}">${HGRanking.TIERS.map((t) => `<option value="${t}" ${x.tier === t ? 'selected' : ''}>${TN[t]}</option>`).join('')}</select>${x.suggested ? '<br><span class="small muted">from the old High/Med/Low</span>' : ''}`
      : `${TN[x.tier]}${x.suggested ? ' <span class="small muted">(suggested)</span>' : ''}`;
    const sameTier = (x, d) => { const j = k.items.indexOf(x) + d; return j >= 0 && j < k.items.length && k.items[j].tier === x.tier; };
    const row = (x) => `<tr class="${x.above ? '' : 'below'}">
      <td class="num"><b>#${x.position}</b></td>
      <td>${tierSel(x)}</td>
      <td>${esc(x.name)}${x.camp > 0.5 ? `<br><span class="small muted">${fmtK(x.camp)} from a campaign or bond</span>` : ''}${x.boost > 0.5 ? `<br><span class="small muted">${fmtK(x.boost)} from boosters</span>` : ''}</td>
      <td>${x.years.length ? 'FY' + x.years.join(', ') : '<span class="muted">yearly only</span>'}</td>
      <td class="num">${x.oneTime ? fmtK(x.oneTime) : ''}</td>
      <td class="num">${x.yearly ? fmtK(x.yearly) + '/yr' : ''}</td>
      <td>${x.above && x.outsideOnly ? `<span class="st st-proposed">${x.camp > 0.5 ? 'Campaign or bond' : 'Boosters'}</span>` : x.above ? '<span class="st st-approved">Fits</span>' : x.fitsAlone ? '<span class="st st-proposed">Below the line, but would fit on its own</span>' : '<span class="st st-declined">Below the line</span>'}</td>
      <td class="moves">${canMove ? `<button type="button" class="btn small" data-action="rankMove" data-id="${esc(x.id)}" data-d="-1" ${sameTier(x, -1) ? '' : 'disabled'} aria-label="Move ${esc(x.name)} up">▲</button><button type="button" class="btn small" data-action="rankMove" data-id="${esc(x.id)}" data-d="1" ${sameTier(x, 1) ? '' : 'disabled'} aria-label="Move ${esc(x.name)} down">▼</button>` : ''}</td></tr>`;
    const body = k.items.map((x, j) => (j === k.line ? `<tr class="fline"><td colspan="8">Funding line: the money runs out here</td></tr>` : '') + row(x)).join('');
    const ro = k.rankOrder;
    return `
      <div class="row">
        <label class="chip"><span class="small muted">Scenario</span><select data-rank-sid aria-label="Scenario">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === RK.sid ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}${x.is_locked ? ' (locked)' : ''}</option>`).join('')}</select></label>
      </div>
      <div class="card"><p>${summary}</p>
        ${outside.length ? `<p class="small">Separately, ${[campTotal > 0.5 ? `<b>${fmtK(campTotal)}</b> depends on a campaign or bond` : '', boostTotal > 0.5 ? `<b>${fmtK(boostTotal)}</b> on boosters` : ''].filter(Boolean).join(' and ')}: ${outside.map((x) => `#${x.position} ${esc(x.name)}`).join(', ')}.</p>` : ''}
        <p class="small muted">Priorities say why something matters: <b>must-have</b> (safety, law, failing systems), <b>strategic</b> (moves the strategic plan forward), <b>nice to have</b> (worth doing when money allows). The list runs from #1 must-have to the last nice-to-have; ▲ ▼ change the order within a priority.${sc.is_locked ? ' This scenario is locked, so its order can’t change; priorities can, because they belong to the initiative.' : ''}</p></div>
      <div class="card"><div class="scroll"><table class="data ranktable"><thead><tr><th>#</th><th>Priority</th><th>Initiative</th><th>Years</th><th class="num">One-time</th><th class="num">Yearly</th><th>Funding line</th><th></th></tr></thead>
        <tbody>${body}</tbody></table></div></div>
      ${k.flags.length ? `<div class="card"><h3>Spent before a higher-ranked need</h3><ul class="flags">${k.flags.slice(0, 12).map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>
        ${k.flags.length > 12 ? `<p class="small muted">and ${k.flags.length - 12} more.</p>` : ''}
        <p class="small muted">Moving the lower-ranked item to a later year, or to another fund, usually fixes this.</p></div>` : ''}
      <div class="card"><h3>Fund in rank order</h3>
        ${ro.deferred.length ? `<p>Keep the ${k.line} initiatives above the line and defer the rest (${fmtK(ro.deferredCost)} one-time${ro.deferredYearly ? `, ${fmtK(ro.deferredYearly)} a year` : ''}): the gap goes from <b>${fmtK(k.current.gap)}</b> to <b>${fmtK(ro.gap)}</b>.</p>
          <p class="small">Deferred: ${ro.deferred.map((x) => esc(x.name)).join(', ')}.</p>
          ${c.plan ? '<button type="button" class="btn primary" data-action="rankScenario">Make a scenario with only what fits</button>' : ''}`
        : `<p>Nothing needs deferring: every initiative fits in rank order.${outside.length ? ` The gap of ${fmtK(k.current.gap)} is the campaign or bond share above that isn’t paid for yet.` : ''}</p>`}</div>`;
  }
  async function rankMove(el) {
    const k = RK.k, x = k.items.find((i) => i.id === el.dataset.id), j = k.items.indexOf(x), d = Number(el.dataset.d), y = k.items[j + d];
    if (!y || y.tier !== x.tier) return;
    const order = k.items.map((i) => i.id); order[j] = y.id; order[j + d] = x.id;
    await HG.db.upsert('scenario_initiative', order.map((id, n) => ({ scenario_id: RK.sid, initiative_id: id, district_id: S.district.id, rank: n + 1, included: true })), 'scenario_id,initiative_id');
    here();
  }
  async function rankScenario() {
    const k = RK.k, sc = RK.rows.scenarios.find((x) => x.id === RK.sid);
    const name = (prompt('Name the new scenario', `${sc.name}: only what fits`) || '').trim(); if (!name) return;
    const id = await HG.db.rpc('copy_scenario', { p_source: RK.sid, p_name: name.slice(0, 80) });
    const nid = typeof id === 'string' ? id : (id && id.copy_scenario);
    const ids = k.rankOrder.deferred.map((x) => enc(x.id)).join(',');
    for (const t of ['phase', 'recurring_cost', 'scenario_initiative']) await HG.db.removeAll(t, `scenario_id=eq.${nid}&initiative_id=in.(${ids})`);
    toast('Scenario made', `“${name}” keeps the ${k.line} initiatives above the line.`);
    CAP.key = S.district.id; CAP.scenarioId = nid; go(`#/d/${enc(S.district.slug)}/resources/capital`);
  }
  const CMP = { key: null, ids: [], a: null, b: null };
  async function vScenarios(c) {
    const rows = await loadCapitalRows(c.district);
    CMP.rows = rows;
    if (!rows.settings || !rows.scenarios.length) return notReady(c, { rows });
    const all = rows.scenarios.slice().sort((x, y) => (y.is_board_version - x.is_board_version) || x.name.localeCompare(y.name));
    if (CMP.key !== c.district.id || !CMP.ids.every((id) => all.some((x) => x.id === id)) || !CMP.ids.length) {
      CMP.key = c.district.id; CMP.ids = all.slice(0, 3).map((x) => x.id); CMP.a = CMP.ids[0]; CMP.b = CMP.ids[1] || CMP.ids[0];
    }
    const pick = (x) => `<input type="checkbox" data-cmp-pick value="${esc(x.id)}" ${CMP.ids.includes(x.id) ? 'checked' : ''} aria-label="Compare ${esc(x.name)}">`;
    return `
      <div class="card"><h3>Scenarios</h3>
        <p class="small muted">Tick up to three to compare. Open one to edit it on the capital plan.</p>
        ${table([
          { label: 'Compare', html: pick },
          { label: 'Scenario', get: (r) => r.name },
          { label: '', html: (r) => (r.is_board_version ? badge('live').replace('Live', 'Board version') : '') + (r.is_locked ? ' <span class="small muted">Locked</span>' : '') },
          { label: 'Last changed', get: (r) => day(r.updated_at) },
          { label: '', html: (r) => `<a href="#" data-action="openScenario" data-id="${esc(r.id)}">Open</a>` },
        ], all, '')}</div>
      <div id="cmp-table">${compareTableHtml()}</div>
      <div id="cmp-why">${whyHtml()}</div>`;
  }
  function compareTableHtml() {
    const rows = CMP.rows, cols = CMP.ids.map((id) => ({ sc: rows.scenarios.find((x) => x.id === id), m: HGCompare.metrics(HGCompare.run(rows, id)) }));
    if (!cols.length) return '';
    const minGap = Math.min(...cols.map((k) => k.m.gap));
    const line = (label, f, opts) => `<tr${opts && opts.strong ? ' class="strong"' : ''}><th scope="row">${esc(label)}</th>${cols.map((k) => `<td class="num">${f(k.m, k)}</td>`).join('')}</tr>`;
    const lowest = (v, fy) => `${fmtK(v)} <span class="small muted">FY${fy}</span>`;
    return `<div class="card"><h3>Side by side</h3><div class="scroll"><table class="data cmp">
      <thead><tr><th></th>${cols.map((k) => `<th class="num">${esc(k.sc.name)}${k.sc.is_board_version ? '<br><span class="small muted">board version</span>' : ''}</th>`).join('')}</tr></thead>
      <tbody>
        ${line('Assumptions', (m, k) => { const set = (CMP.rows.assumption_sets || []).find((x) => x.id === k.sc.assumption_set_id); return esc(set ? set.name : 'Starting numbers'); })}
        ${line('10-year need', (m) => fmtK(m.need))}
        ${line('Paid by levies and grants', (m) => fmtK(m.levyFunded))}
        ${line('Boosters', (m) => fmtK(m.boosters))}
        ${line('Campaign or bond projects', (m) => fmtK(m.campaign))}
        ${line('Paid by borrowing or gifts in the scenario', (m) => fmtK(m.financed))}
        ${line('Gap to close', (m) => `<b class="${m.gap > 0.5 ? 'gaptext' : ''}">${fmtK(m.gap)}</b>${cols.length > 1 && m.gap === minGap ? '<br><span class="small muted">smallest</span>' : ''}`, { strong: true })}
        ${line('Busiest year', (m) => `FY${m.busiestFY} <span class="small muted">${fmtK(m.busiest)}</span>`)}
        ${line('Yearly costs (first year they start)', (m) => (m.yearlyCapital + m.yearlyOther > 0.5 ? `${fmtK(m.yearlyCapital + m.yearlyOther)} <span class="small muted">FY${m.yearlyFY}</span><br><span class="small muted">${fmtK(m.yearlyCapital)} capital · ${fmtK(m.yearlyOther)} other</span>` : '$0'))}
        ${line('Lowest SAVE balance', (m) => lowest(m.saveLow, m.saveLowFY))}
        ${line('Lowest PPEL balance', (m) => lowest(m.ppelLow, m.ppelLowFY))}
        ${line('SAVE bond room', (m) => fmtK(m.bondRoom))}
        ${line('General-obligation debt room', (m) => (m.goRoom == null ? '<span class="small muted">needs valuation</span>' : fmtK(m.goRoom)))}
        ${line('Added tax, example home (highest year)', (m) => (!m.tax || !m.tax.taxed.length ? '$0' : !m.tax.hasValuation ? '<span class="small muted">needs valuation</span>'
          : `$${Math.round(m.tax.peak.home).toLocaleString('en-US')}/yr <span class="small muted">FY${m.tax.peak.fy}</span><br><span class="small muted">$${Math.round(m.tax.homeValue).toLocaleString('en-US')} home</span>`))}
        <tr><th scope="row">What it asks of the community</th>${cols.map((k) => `<td class="asks">${k.m.asks.length ? `<ul>${k.m.asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<span class="muted">Nothing beyond current levies and grants</span>'}</td>`).join('')}</tr>
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">Bond room assumes 1.20 coverage, 20 years at 4.5%. A general-obligation bond needs a public vote; confirm requirements with bond counsel.</p></div>`;
  }
  function whyHtml() {
    const rows = CMP.rows, all = rows.scenarios;
    if (all.length < 2) return '';
    if (!all.some((x) => x.id === CMP.a)) CMP.a = all[0].id;
    if (!all.some((x) => x.id === CMP.b) || CMP.b === CMP.a) CMP.b = (all.find((x) => x.id !== CMP.a) || all[0]).id;
    const ex = HGCompare.explain(rows, CMP.a, CMP.b);
    const opt = (sel) => all.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const effect = (v) => (Math.abs(v) < 0.5 ? '<span class="muted">no effect on its own</span>' : v < 0 ? `lowers the gap by <b>${fmtK(-v)}</b>` : `raises the gap by <b class="gaptext">${fmtK(v)}</b>`);
    return `<div class="card"><h3>Why the gap differs</h3>
      <div class="inline-form">
        <label class="field">Compared with<select data-why="a">${opt(CMP.a)}</select></label>
        <label class="field">What changes in<select data-why="b">${opt(CMP.b)}</select></label></div>
      <p style="margin-top:12px">Gap: <b>${fmtK(ex.refGap)}</b> in ${esc(ex.ref.name)} → <b>${fmtK(ex.otherGap)}</b> in ${esc(ex.other.name)}
        (${Math.abs(ex.total) < 0.5 ? 'the same' : ex.total < 0 ? `${fmtK(-ex.total)} smaller` : `${fmtK(ex.total)} larger`}).</p>
      ${ex.items.length ? table([
        { label: 'What changes', get: (x) => x.label },
        { label: 'Effect on the gap', html: (x) => effect(x.effect) },
      ], ex.items.concat(ex.together ? [{ label: 'These changes working together', effect: ex.together }] : []), '') : '<p class="muted">These two scenarios have the same projects, levers and financing.</p>'}
      <p class="small muted" style="margin-top:8px">Each change is measured on its own: applied to “${esc(ex.ref.name)}” alone, then recomputed. When changes depend on each other (a bond that pays for a project only in the year it’s built, say), the difference shows up as “working together.”</p></div>`;
  }

  // ------------------------------------------------------------------ views: Resources
  const FUND_NAMES = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants and donations' };
  /* the board version (or the first scenario) run through the engine; null if not set up */
  async function boardRun(d) {
    const rows = await loadCapitalRows(d);
    if (!rows.settings || !rows.scenarios.length) return { rows, none: true };
    const sc = rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0];
    const inp = HGCapital.buildInputs(rows, sc.id);
    const r = HGEngine.compute(inp.projects, inp.levers, inp.cfg);
    return { rows, sc, inp, r, paths: HGCapital.fundPaths(r, inp.cfg) };
  }
  const notReady = (c, b) => `<div class="card"><h3>${!b.rows.settings ? 'Starting numbers aren’t set up yet' : 'No scenarios yet'}</h3>
    <p>${!b.rows.settings ? 'Enter the district’s receipts, balances and debt first.' : 'Upload the district’s projects to create its first scenario.'}</p>
    <a class="btn primary" href="#/d/${enc(c.district.slug)}/${!b.rows.settings ? 'settings/setup' : 'progress/uploads'}">${!b.rows.settings ? 'Starting numbers' : 'Upload projects'}</a></div>`;
  async function vResSummary(c) {
    const b = await boardRun(c.district);
    if (b.none) return notReady(c, b) + wip({ title: 'General-fund summary: not built yet', phase: 6, items: ['Ending balance and solvency ratio'] });
    const { sc, inp, r, paths } = b, cfg = inp.cfg, fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
    const byY = HGCapital.recurByYear(inp.levers, cfg), recY = byY.find((y) => y.total > 0.5), rec = recY ? recY.total : 0;
    const funds = HGCapital.CAP_FUNDS.filter((k) => k !== 'vppel' || cfg.vStatus !== 'none' || paths[k].open > 0);
    return `
      <p class="small muted">From <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}, FY${cfg.start}–FY${cfg.start + cfg.n - 1}. <a href="#/d/${enc(c.district.slug)}/resources/capital">Open the capital plan</a></p>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">10-year capital need</div><div class="stat">${fmtK(r.need)}</div></div>
        <div class="card tile-card"><div class="small muted">Paid by levies and grants</div><div class="stat">${fmtK(r.levyFunded)}</div></div>
        <div class="card tile-card ${r.gap > 0.5 ? 'gap' : ''}"><div class="small muted">Gap to close</div><div class="stat">${fmtK(r.gap)}</div></div>
        <div class="card tile-card"><div class="small muted">Yearly costs committed</div><div class="stat">${rec ? fmtK(rec) : '$0'}</div><div class="small muted">${recY ? `programs and hires, FY${recY.fy}` : 'programs and hires, per year'}</div></div>
      </div>
      <div class="card"><h3>Capital funds</h3>${table([
        { label: 'Fund', get: (k) => FUND_NAMES[k] },
        { label: `Starting balance`, num: true, get: (k) => fmt(paths[k].open) },
        { label: '10-year receipts', num: true, get: (k) => fmt(paths[k].receipts) },
        { label: '10-year spending', num: true, get: (k) => fmt(paths[k].spend) },
        { label: 'Short by', num: true, html: (k) => (paths[k].over > 0.5 ? `<b class="gaptext">${fmt(paths[k].over)}</b>` : '') },
        { label: 'Lowest balance', num: true, get: (k) => `${fmt(paths[k].low)} (FY${paths[k].lowFY})` },
        { label: `Ending FY${cfg.start + cfg.n - 1}`, num: true, get: (k) => fmt(paths[k].end) },
      ], funds, '')}
      <p class="small muted" style="margin-top:8px">“Short by” is spending planned on a fund beyond what it has that year; it counts toward the gap. Details by year are on All funds.</p></div>
      ${wip({ title: 'General-fund summary: not built yet', phase: 6, items: ['Ending balance and solvency ratio', 'Unspent spending authority'] })}`;
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
  const FUND_RULES = {
    save: 'School infrastructure: building, remodeling, repairing and equipping school buildings and sites, technology, and safety, plus SAVE revenue bonds and property-tax relief, as the district’s revenue purpose statement allows (Iowa Code chapter 423F).',
    ppel: 'Buying, building and improving buildings and grounds; equipment such as buses and technology; and lease-purchase payments (Iowa Code section 298.3). Board-approved.',
    vppel: 'The same uses as PPEL, at a higher rate approved by the district’s voters for up to 10 years.',
    grants: 'Whatever each grant or gift is restricted to by the funder or donor.',
  };
  async function vFunds(c) {
    const d = c.district.id;
    const [bal, debt, b] = await Promise.all([
      HG.db.select('fund_balance', `select=fund,as_of,amount,source&district_id=eq.${d}&order=as_of.desc`),
      HG.db.select('debt_obligation', `select=name,fund,annual_payment,final_fy&district_id=eq.${d}&order=final_fy`),
      boardRun(c.district),
    ]);
    const latest = []; const seen = new Set();
    bal.forEach((x) => { if (!seen.has(x.fund)) { seen.add(x.fund); latest.push(x); } });
    const fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
    const top = `
      <div class="row">${c.finance ? `<a class="btn" href="#/d/${enc(c.district.slug)}/settings/setup">Enter balances</a><a class="btn" href="#/d/${enc(c.district.slug)}/progress/uploads">Upload balances</a>` : ''}</div>
      <div class="cap-grid">
      <div class="card"><h3>Latest balances</h3>${table([
        { label: 'Fund', get: (r) => FUND_NAMES[r.fund] || r.fund.toUpperCase() },
        { label: 'As of', get: (r) => day(r.as_of) },
        { label: 'Balance', num: true, get: (r) => money(r.amount) },
        { label: 'From', get: (r) => ({ manual: 'Typed in', upload: 'Balances upload', gl_import: 'Monthly GL' }[r.source] || r.source) },
      ], latest, 'No balances yet.')}</div>
      <div class="card"><h3>Existing debt</h3>${table([
        { label: 'Obligation', get: (r) => r.name },
        { label: 'Paid from', get: (r) => ({ save: 'SAVE', ppel: 'PPEL', debt_levy: 'Debt service levy' })[r.fund] || r.fund },
        { label: 'Per year', num: true, get: (r) => money(r.annual_payment) },
        { label: 'Final year', get: (r) => 'FY' + r.final_fy },
      ], debt, 'No debt entered.')}</div></div>`;
    if (b.none) return top + notReady(c, b);
    const { sc, inp, r, paths } = b, cfg = inp.cfg;
    const cap = HGEngine.saveBondCapacity(cfg, inp.levers, 0.045, 20, 1.2), go = HGEngine.goDebtRoom(cfg, inp.levers);
    const funds = HGCapital.CAP_FUNDS.filter((k) => k !== 'vppel' || cfg.vStatus !== 'none' || paths[k].open > 0);
    const fundCard = (k) => { const P = paths[k]; return `<div class="card fundcard"><h3>${FUND_NAMES[k]}</h3>
      <p class="small">${esc(FUND_RULES[k])}</p>
      ${table([
        { label: 'Year', get: (y) => 'FY' + y.fy },
        { label: 'Start', num: true, get: (y) => fmt(y.start) },
        { label: 'Receipts', num: true, get: (y) => fmt(y.receipts) },
        { label: 'Spending', num: true, get: (y) => fmt(y.spend) },
        { label: 'Short by', num: true, html: (y) => (y.over > 0.5 ? `<b class="gaptext">${fmt(y.over)}</b>` : '') },
        { label: 'End', num: true, html: (y) => (y.fy === P.lowFY ? `<b>${fmt(y.end)}</b> <span class="small muted">low</span>` : fmt(y.end)) },
      ], P.years, '')}
      <p class="small muted">Receipts are after existing debt payments and ongoing commitments${k === 'save' && inp.levers.sf ? ', and after the SF 2472 reduction' : ''}${cfg.f0 < 1 ? `; FY${cfg.start} counts only the part of the year after ${day(cfg.settings.balances.asOf)}` : ''}.</p></div>`; };
    return top + `
      <p class="small muted">Year by year from <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}. <a href="#/d/${enc(c.district.slug)}/resources/capital">Change it on the capital plan</a></p>
      ${funds.map(fundCard).join('')}
      <div class="card"><h3>Borrowing room</h3>
        <p>SAVE revenue bonds: about <b>${fmtK(cap.pv)}</b>, based on the lowest year (FY${cap.fy}), 1.20 coverage, 20 years at 4.5%.</p>
        <p>${go != null ? `General-obligation bonds: about <b>${fmtK(go)}</b> left under the debt limit (5% of actual valuation, less GO debt outstanding). A GO bond also needs 60% of voters.` : 'General-obligation limit: add the district’s actual (100%) valuation in Starting numbers to see it.'}</p></div>
      <p class="small muted">Fund rules are a plain-language guide, not legal advice. Confirm a specific use with the district’s attorney or the Iowa Department of Education.</p>`;
  }
  // ---------------------------------------------------------------- capital plan (live engine)
  const CAP = { key: null, rows: null, scenarioId: null, inputs: null, levers: null, pub: false };
  const fmtK = (v) => { const sgn = v < 0 ? '-' : ''; v = Math.abs(v); if (v >= 1e6) return sgn + '$' + (v / 1e6).toFixed(2) + 'M'; if (v >= 1000) return sgn + '$' + Math.round(v / 1000) + 'k'; return sgn + '$' + Math.round(v); };
  const pct = (v, dp) => (v * 100).toFixed(dp) + '%';
  const FUND_LABEL = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants', boost: 'Boosters', camp: 'Campaign/bond' };
  const LEVERS = [
    { k: 'pg', label: 'PPEL valuation growth', min: 0, max: 0.08, step: 0.005, show: (v) => pct(v, 1) },
    { k: 'gy', label: 'Grant yield to capital', min: 0, max: 1, step: 0.05, show: (v) => pct(v, 0) },
    { k: 'sg', label: 'SAVE receipts trend', min: -0.05, max: 0.05, step: 0.005, show: (v) => (v > 0 ? '+' : '') + pct(v, 1) },
    { k: 'infl', label: 'Construction inflation', min: 0, max: 0.08, step: 0.005, show: (v) => pct(v, 1) },
  ];
  async function loadCapitalRows(d) {
    const q = (t, extra) => HG.db.select(t, `select=*&district_id=eq.${d.id}${extra || ''}`);
    const [settings, balances, debts, scenarios, initiatives, phases, funding, financing, recurring, priorities, scenarioInitiatives, assumptionSets] = await Promise.all([
      q('district_settings'), q('fund_balance'), q('debt_obligation'), q('scenario', '&order=name'),
      q('initiative', '&order=name'), q('phase'), q('phase_funding'), q('financing'), q('recurring_cost'), q('priority', '&order=position'), q('scenario_initiative'), q('assumption_set', '&order=name')]);
    return { district: d, settings: settings[0] || null, balances, debts, scenarios, initiatives, phases, funding, financing, recurring, priorities, scenario_initiative: scenarioInitiatives, assumption_sets: assumptionSets };
  }
  function capCompute() { return HGEngine.compute(CAP.inputs.projects, CAP.levers, CAP.inputs.cfg); }

  async function vCapital(c) {
    const rows = await loadCapitalRows(c.district);
    CAP.rows = rows; CAP.pub = false; CAP.ctx = c;
    if (!rows.settings) {
      return `<div class="card"><h3>Starting numbers aren’t set up yet</h3>
        <p>The capital plan needs this district’s SAVE and PPEL receipts, fund balances and existing debt before it can run.</p>
        <div class="row">${c.finance ? `<a class="btn primary" href="#/d/${enc(c.district.slug)}/settings/setup">Set up starting numbers</a>` : '<span class="small muted">A business manager or admin can set these up.</span>'}</div>
        ${S.isStaff && c.district.is_demo ? '<p class="small muted" style="margin-top:10px">This is a demo district: you can fill it with fictional data from the Willow Holler page.</p>' : ''}</div>`;
    }
    if (!rows.scenarios.length) {
      return `<div class="card"><h3>No scenarios yet</h3><p>Upload the district’s project spreadsheet to create its first scenario.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/progress/uploads">Upload projects</a></div>`;
    }
    const key = c.district.id;
    if (!rows.scenarios.some((x) => x.id === CAP.scenarioId)) {
      CAP.key = key;
      CAP.scenarioId = (rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0]).id;
    }
    capLoadScenario();
    const cfg = CAP.inputs.cfg;
    const opts = rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === CAP.scenarioId ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}${x.is_locked ? ' (locked)' : ''}</option>`).join('');
    return `
      <div class="row cap-bar">
        <label class="chip"><span class="small muted">Scenario</span><select data-cap-scenario aria-label="Scenario">${opts}</select></label>
        ${scenarioToolbar(c)}
        ${rows.scenarios.length > 1 ? `<a class="btn" href="#/d/${enc(c.district.slug)}/decisions/scenarios">Compare scenarios</a>` : ''}
      </div>
      ${CAP.sc.is_locked ? `<div class="notice">This scenario is locked, so it can’t be changed${c.admin ? '. Unlock it to edit.' : '. A district admin can unlock it.'} Copy it to try changes.</div>` : ''}
      ${CAP.inputs.notes.length ? `<div class="notice">${CAP.inputs.notes.map(esc).join('<br>')}</div>` : ''}
      <div id="cap-results">${capResultsHtml()}</div>
      <div class="cap-grid">
        <div class="card" id="cap-levers">${capLeversHtml()}</div>
        <div class="card" id="cap-fin">${capFinHtml()}</div>
      </div>
      <div class="card" id="cap-tax">${capTaxHtml()}</div>
      <div id="cap-filters">${capFiltersHtml()}</div>
      <div id="cap-years">${capYearsHtml()}</div>
      ${CAP.editable ? '<div class="row"><button type="button" class="btn primary" data-action="editProject" data-id="">Add an initiative</button></div>' : ''}
      <div id="cap-yearly">${capYearlyHtml()}</div>
      ${(() => { if (CAP.openEditor && CAP.editable) { const id = CAP.openEditor; setTimeout(() => openProjectEditor(id), 0); } CAP.openEditor = null; return ''; })()}
`;
  }
  function capLoadScenario() {
    CAP.sc = CAP.rows.scenarios.find((x) => x.id === CAP.scenarioId);
    CAP.editable = !CAP.pub && !!CAP.ctx && CAP.ctx.plan && !CAP.sc.is_locked;
    CAP.inputs = HGCapital.buildInputs(CAP.rows, CAP.scenarioId);
    CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers));
  }
  function capResultsHtml() {
    const cfg = CAP.inputs.cfg, r = capCompute(), yrs = HGCapital.yearSummary(r, cfg);
    const busiest = yrs.reduce((a, y) => (y.total > a.total ? y : a), yrs[0]);
    const enr = cfg.settings.district.enrollment;
    const tiles = [
      ['10-year need', fmtK(r.need), `FY${cfg.start}–FY${cfg.start + cfg.n - 1}`],
      ['Levies & grants', fmtK(r.levyFunded), 'SAVE, PPEL, V-PPEL, grants'],
      ['Campaign / bond', fmtK(r.spentByBucket.camp), r.spentByBucket.boost ? `plus ${fmtK(r.spentByBucket.boost)} boosters` : (r.financed ? `${fmtK(r.financed)} financed` : 'none planned')],
      ['Gap to close', fmtK(r.gap), r.gap > 0.5 ? [r.unfunded > 0.5 ? `${fmtK(r.unfunded)} campaign or bond not yet financed` : '', r.overflow > 0.5 ? `${fmtK(r.overflow)} over what the funds can pay` : ''].filter(Boolean).join('; ') : 'Fully paid for in this scenario'],
      ['Busiest year', 'FY' + busiest.fy, fmtK(busiest.total)],
      enr ? ['Per pupil', '$' + Math.round(r.need / enr).toLocaleString('en-US'), `${enr.toLocaleString('en-US')} enrolled`] : null,
    ].filter(Boolean);
    const max = Math.max(1, ...yrs.map((y) => y.total));
    const W = 64, H = 170, top = 24, base = top + H;
    const bars = yrs.map((y, i) => {
      const x = i * W + 12, w = W - 24; let yy = base;
      const seg = (v, cls) => { if (v <= 0.5) return ''; const h = v / max * H; yy -= h; return `<rect class="${cls}" x="${x}" y="${yy.toFixed(1)}" width="${w}" height="${h.toFixed(1)}"></rect>`; };
      const parts = seg(y.fromFunds, 'b-funds') + seg(y.over, 'b-over') + seg(y.boost, 'b-boost') + seg(y.financed, 'b-fin') + seg(y.campNeeded, 'b-camp');
      return `<g><title>FY${y.fy}: ${fmtK(y.total)}${y.campNeeded > 0.5 ? `, campaign or bond needed ${fmtK(y.campNeeded)}` : ''}${y.over > 0.5 ? `, over capacity ${fmtK(y.over)}` : ''}</title>${parts}
        ${y.total > 0.5 ? `<text x="${x + w / 2}" y="${(yy - 6).toFixed(1)}" class="b-lab ${y.campNeeded > 0.5 || y.over > 0.5 ? 'warn' : ''}">${fmtK(y.total)}</text>` : ''}
        <text x="${x + w / 2}" y="${base + 16}" class="b-fy">${y.fy}</text></g>`;
    }).join('');
    return `<div class="grid tiles">${tiles.map((t, i) => `<div class="card tile-card ${i === 3 && r.gap > 0.5 ? 'gap' : ''}"><div class="small muted">${esc(t[0])}</div><div class="stat">${esc(t[1])}</div><div class="small muted">${esc(t[2])}</div></div>`).join('')}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>Capital spending by year</h3>
        <div class="legend small"><span><i class="b-funds"></i>Levies &amp; grants</span><span><i class="b-boost"></i>Boosters</span><span><i class="b-fin"></i>Financed</span><span><i class="b-camp"></i>Campaign / bond needed</span><span><i class="b-over"></i>Over capacity</span></div></div>
        <div class="scroll"><svg class="capchart" viewBox="0 0 ${yrs.length * W} ${base + 24}" role="img" aria-label="Capital spending by year">${bars}</svg></div></div>`;
  }
  function capLeversHtml() {
    const cfg = CAP.inputs.cfg;
    const sets = (!CAP.pub && CAP.rows && CAP.rows.assumption_sets) || [], cur = CAP.inputs.set;
    const setLine = CAP.pub ? '' : sets.length
      ? (CAP.editable ? `<label class="field">Assumptions<select data-cap-set aria-label="Assumption set"><option value="">Starting numbers</option>${sets.map((x) => `<option value="${esc(x.id)}" ${cur && cur.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`
        : `<p class="small">Assumptions: <b>${esc(cur ? cur.name : 'Starting numbers')}</b></p>`)
      : `<p class="small muted">Assumptions: starting numbers. <a href="#/d/${enc(S.district.slug)}/resources/assumptions">Make assumption sets</a> to stress-test the plan.</p>`;
    return `<h3>What-if</h3>${setLine}
          <p class="small muted">${CAP.editable ? 'Try a change here. Nothing is saved unless you click Save.' : 'Try a change here; nothing is saved.'} Reset returns to ${CAP.pub ? 'the published plan' : cur ? `the “${esc(cur.name)}” set` : 'the scenario’s own settings'}.</p>
          <div class="stack">
          ${LEVERS.map((l) => `<label class="lever"><span>${esc(l.label)} <b data-lever-val="${l.k}">${esc(l.show(CAP.levers[l.k]))}</b></span>
             <input type="range" data-lever="${l.k}" min="${l.min}" max="${l.max}" step="${l.step}" value="${CAP.levers[l.k]}"></label>`).join('')}
          <label class="row"><input type="checkbox" data-lever="sf" ${CAP.levers.sf ? 'checked' : ''}> SF 2472 SAVE cut</label>
          ${cfg.vStatus !== 'none' ? `<label class="row"><input type="checkbox" data-lever="vppel" ${CAP.levers.vppel ? 'checked' : ''}> V-PPEL through FY${cfg.vLast}${cfg.vStatus === 'proposed' ? ' (proposed; needs a vote)' : ''}</label>` : ''}
          <div class="row"><button type="button" class="btn small" data-action="capReset">Reset</button>
          ${CAP.editable ? '<button type="button" class="btn small primary" data-action="saveLevers">Save these to the scenario</button>' : ''}</div></div>`;
  }
  function capFinHtml() {
    const cfg = CAP.inputs.cfg, L = CAP.levers;
    const cap = HGEngine.saveBondCapacity(cfg, L, 0.045, 20, 1.2), go = HGEngine.goDebtRoom(cfg, L);
    const KIND = { go: 'General-obligation bond', rev: 'SAVE revenue bond', lease: 'Lease-purchase', gift: 'Campaign or gift' };
    const REPAY = { levy: 'debt service levy', save: 'SAVE', ppel: 'PPEL', none: 'nothing (gift)' };
    return `<h3>Financing</h3>
      ${(() => {
        const list = CAP.pub ? (L.fin || []).map((f) => ({ f })) : (CAP.rows.financing || []).filter((x) => x.scenario_id === CAP.scenarioId)
          .map((x) => ({ id: x.id, f: { name: x.name, kind: x.kind, fy: x.issue_fy, amount: Number(x.amount), rate: Number(x.rate), years: x.years, repay: x.repay_from } }));
        return list.length ? `<div class="stack">${list.map(({ id, f }) => `<div><b>${esc(f.name)}</b>: ${esc(KIND[f.kind] || f.kind)}, ${fmtK(f.amount)} in FY${f.fy}${f.years ? `, ${f.years} years at ${pct(f.rate, 2)}` : ''}, repaid from ${esc(REPAY[f.repay] || f.repay)}.
          ${CAP.editable && id ? `<a href="#" data-action="editFinancing" data-id="${esc(id)}">Edit</a>` : ''}</div>`).join('')}</div>` : '<p class="muted">None in this scenario.</p>';
      })()}
      <p class="small">SAVE revenue-bond room is about <b>${fmtK(cap.pv)}</b> (lowest year FY${cap.fy}, 1.20 coverage, 20 years at 4.5%).
      ${go != null ? ` The general-obligation debt limit (5% of actual valuation) leaves about <b>${fmtK(go)}</b>.` : ' Add the district’s actual (100%) valuation to see the general-obligation limit.'}</p>
      ${CAP.editable ? '<div><button type="button" class="btn small" data-action="editFinancing" data-id="">Add a bond, lease or campaign</button></div>' : ''}`;
  }
  /* every phase, with what the filters and the table need */
  function capItems() {
    const cfg = CAP.inputs.cfg, L = CAP.levers;
    const INIT = new Map(((CAP.rows && CAP.rows.initiatives) || []).map((i) => [String(i.id), i]));
    const out = [];
    CAP.inputs.projects.forEach((p) => {
      const init = INIT.get(String(p.id)) || { engine_priority: p.pri };
      const tier = HGRanking.tierOf(init).tier;
      p.phases.forEach((ph, k) => {
        const cost = ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + L.infl, ph.year);
        out.push({ p, ph, k, tier, area: p.area || init.focus_area || '', fy: cfg.start + ph.year, today: ph.cost, cost });
      });
    });
    return out;
  }
  const capFiltering = () => { const f = CAP.filter || {}; return !!(f.tier || f.fund || f.area || f.q); };
  function capMatch(x) {
    const f = CAP.filter || {};
    if (f.tier && x.tier !== f.tier) return false;
    if (f.fund && !x.ph.funding.some((g) => g.b === f.fund)) return false;
    if (f.area && x.area !== f.area) return false;
    if (f.q && !(x.p.name + ' ' + (x.ph.label || '')).toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  }
  function capFiltersHtml() {
    const f = CAP.filter || {}, items = capItems(), areas = [...new Set(items.map((x) => x.area).filter(Boolean))].sort();
    const usedFunds = HGCapital.CAP_FUNDS.concat(['boost', 'camp']).filter((b) => items.some((x) => x.ph.funding.some((g) => g.b === b)));
    const view = CAP.view || 'cards';
    return `<div class="row capfilters">
      <div class="seg" role="group" aria-label="View"><button type="button" class="btn small ${view === 'cards' ? 'on' : ''}" data-action="capView" data-v="cards" aria-pressed="${view === 'cards'}">Cards</button><button type="button" class="btn small ${view === 'table' ? 'on' : ''}" data-action="capView" data-v="table" aria-pressed="${view === 'table'}">Table</button></div>
      <label class="chip"><span class="small muted">Priority</span><select data-cap-filter="tier" aria-label="Priority"><option value="">All</option>${[['must', 'Must-have'], ['strategic', 'Strategic'], ['nice', 'Nice to have']].map(([k, v]) => `<option value="${k}" ${f.tier === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="chip"><span class="small muted">Paid from</span><select data-cap-filter="fund" aria-label="Paid from"><option value="">Any fund</option>${usedFunds.map((b) => `<option value="${b}" ${f.fund === b ? 'selected' : ''}>${FUND_LABEL[b]}</option>`).join('')}</select></label>
      ${areas.length ? `<label class="chip"><span class="small muted">Focus area</span><select data-cap-filter="area" aria-label="Focus area"><option value="">All</option>${areas.map((a) => `<option value="${esc(a)}" ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>` : ''}
      <input type="search" data-cap-filter="q" placeholder="Search projects" value="${esc(f.q || '')}" aria-label="Search projects" class="capsearch">
    </div>`;
  }
  function capYearsHtml() {
    const cfg = CAP.inputs.cfg, r = capCompute(), yrs = HGCapital.yearSummary(r, cfg), all = capItems(), shown = all.filter(capMatch);
    const note = capFiltering() ? `<p class="small">Showing ${shown.length} of ${all.length} phases (${fmtK(shown.reduce((a, x) => a + x.cost, 0))}). <a href="#" data-action="capClearFilters">Clear filters</a>${(CAP.view || 'cards') === 'cards' ? ' <span class="muted">Year totals still include everything.</span>' : ''}</p>` : '';
    const chips = (ph) => `<span class="chips">${ph.funding.map((f) => `<span class="fchip f-${f.b}">${FUND_LABEL[f.b]}${f.p !== 100 ? ' ' + f.p + '%' : ''}</span>`).join('')}</span>`;
    const nameLink = (p) => (CAP.editable ? `<a href="#" data-action="editProject" data-id="${esc(p.id)}">${esc(p.name)}</a>` : esc(p.name));
    if ((CAP.view || 'cards') === 'table') {
      const list = shown.slice().sort((a, b) => a.fy - b.fy || a.p.name.localeCompare(b.p.name));
      const TN = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have', '': '' };
      return `<h2 style="margin-top:6px">Projects by year</h2>${note}
        <div class="card"><div class="scroll"><table class="data captable"><thead><tr><th>Year</th><th>Initiative</th><th>Phase</th><th>Priority</th><th>Focus area</th><th>Paid from</th><th>Status</th><th class="num">Today’s $</th><th class="num">That year’s $</th></tr></thead><tbody>
          ${list.map((x) => `<tr><td>FY${x.fy}</td><td>${nameLink(x.p)}</td><td>${esc(x.ph.label || (x.p.phases.length > 1 ? `${x.k + 1} of ${x.p.phases.length}` : ''))}</td><td>${TN[x.tier] || ''}</td><td>${esc(x.area)}</td><td>${chips(x.ph)}</td>
            <td>${x.ph.status === 'done' ? '<b class="ok">Done</b>' : x.ph.status === 'underway' ? 'Underway' : 'Planned'}</td><td class="num">${fmtK(x.today)}</td><td class="num">${fmtK(x.cost)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nothing matches these filters.</td></tr>'}
          </tbody>${list.length ? `<tfoot><tr><th colspan="7">${list.length} phase${list.length === 1 ? '' : 's'}</th><th class="num">${fmtK(list.reduce((a, x) => a + x.today, 0))}</th><th class="num">${fmtK(list.reduce((a, x) => a + x.cost, 0))}</th></tr></tfoot>` : ''}</table></div>
          <div style="margin-top:10px"><button type="button" class="btn small" data-action="capDownload">Download this table (.csv)</button></div></div>`;
    }
    const cards = yrs.map((y, i) => {
      const items = shown.filter((x) => x.ph.year === i).map((x) => `<li><span>${nameLink(x.p)}${x.ph.label ? ` <span class="muted">· ${esc(x.ph.label)}</span>` : x.p.phases.length > 1 ? ` <span class="muted">${x.k + 1}/${x.p.phases.length}</span>` : ''}
          ${x.ph.status === 'done' ? '<b class="ok">Done</b>' : x.ph.status === 'underway' ? '<span class="muted">underway</span>' : ''}
          ${chips(x.ph)}</span><b>${fmtK(x.cost)}</b></li>`);
      const spend = HGCapital.CAP_FUNDS.reduce((a, b) => a + r.res[i].spend[b], 0);
      return `<div class="card ycard ${y.campNeeded > 0.5 || y.over > 0.5 ? 'warn' : ''}">
        <div class="row" style="justify-content:space-between"><h3>FY${y.fy}${i === 0 && cfg.f0 < 1 ? ` <span class="small muted">from ${esc(day(cfg.settings.balances.asOf))}</span>` : ''}</h3><b>${fmtK(y.total)}</b></div>
        <div class="small muted">${fmtK(spend)} of ${fmtK(y.capacity)} capacity; banks ${fmtK(y.banks)}</div>
        ${y.campNeeded > 0.5 ? `<div class="small gaptext">Campaign / bond needed ${fmtK(y.campNeeded)}</div>` : ''}
        ${y.financed > 0.5 ? `<div class="small">Financed ${fmtK(y.financed)}</div>` : ''}
        ${y.over > 0.5 ? `<div class="small gaptext">Over what the funds can pay by ${fmtK(y.over)}</div>` : ''}
        ${y.boost > 0.5 ? `<div class="small">Boosters ${fmtK(y.boost)}</div>` : ''}
        <ul class="ylist">${items.join('') || `<li class="muted">${capFiltering() ? 'Nothing matching' : 'Nothing planned'}</li>`}</ul></div>`;
    }).join('');
    return `<h2 style="margin-top:6px">Projects by year</h2>${note}<div class="ygrid">${cards}</div>`;
  }
  function capDownload() {
    const TN = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have', '': '' };
    const list = capItems().filter(capMatch).sort((a, b) => a.fy - b.fy || a.p.name.localeCompare(b.p.name));
    const out = [['FY', 'Initiative', 'Phase', 'Priority', 'Focus area', 'Paid from', 'Status', 'Cost (today’s $)', 'Cost (that year’s $)']];
    list.forEach((x) => out.push([x.fy, x.p.name, x.ph.label || '', TN[x.tier] || '', x.area, x.ph.funding.map((f) => FUND_LABEL[f.b] + (f.p !== 100 ? ' ' + f.p + '%' : '')).join(' + '),
      x.ph.status || 'planned', Math.round(x.today), Math.round(x.cost)]));
    const name = ((CAP.sc && CAP.sc.name) || 'plan').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    saveFile(`${(S.district && S.district.slug) || 'district'}-${name}-projects.csv`, HGUploads.toCSV(out));
  }

  function capTaxHtml() {
    const cfg = CAP.inputs.cfg, imp = HGTax.impact(cfg, CAP.levers, CAP.inputs.tax || {}), R = HGTax.RULES;
    const dollars = (v) => (v == null ? '' : v < 100 ? '$' + v.toFixed(2) : '$' + Math.round(v).toLocaleString('en-US'));
    const homeTxt = '$' + Math.round(imp.homeValue).toLocaleString('en-US') + ' home';
    const head = '<h3>What it means for taxpayers</h3>';
    if (!imp.taxed.length) return head + `<p>This scenario adds <b>no property tax</b>: it has no general-obligation bond, and no new V-PPEL.</p>
      <p class="small muted">SAVE revenue bonds, leases paid from PPEL, and campaigns or gifts don’t add a levy.</p>`;
    const first = imp.taxed[0].fy, last = imp.taxed[imp.taxed.length - 1].fy;
    const sources = [imp.hasGO ? 'the debt service levy for a general-obligation bond' : '', imp.newVppel ? 'a new V-PPEL' : ''].filter(Boolean).join(' and ');
    if (!imp.hasValuation) return head + `<p>Adds about <b>${fmtK(imp.taxed[0].added)} a year</b> in property tax from FY${first} (${sources}).</p>
      <p class="small muted">Enter the district’s taxable valuation in Settings, Starting numbers to see the levy rate and what it costs a homeowner and a farmer.</p>`;
    const pk = imp.peak, farmCol = imp.agPerAcre ? 'Farmland, per acre' : 'Farmland, per $100,000 assessed';
    return head + `<p>Adds ${sources}, FY${first}–FY${last}. At its highest (FY${pk.fy}), about <b>${dollars(pk.home)} a year</b> (${dollars(pk.home / 12)} a month) for a ${homeTxt}${imp.agPerAcre ? `, and <b>${dollars(pk.acre)} an acre</b> of farmland` : `, and <b>${dollars(pk.farm100k)}</b> per $100,000 of assessed farmland`}.</p>
      <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">Added levy</th><th class="num">Rate per $1,000</th><th class="num">${esc(homeTxt)}</th><th class="num">Same home, owner 65+</th><th class="num">${farmCol}</th></tr></thead><tbody>
        ${imp.taxed.map((x) => `<tr><td>FY${x.fy}${x.held ? ' <span class="small muted">*</span>' : ''}</td><td class="num">${fmtK(x.added)}</td><td class="num">$${x.rate.toFixed(4)}</td><td class="num">${dollars(x.home)}</td><td class="num">${dollars(x.home65)}</td><td class="num">${dollars(imp.agPerAcre ? x.acre : x.farm100k)}</td></tr>`).join('')}
      </tbody></table></div>
      ${(() => { const endFY = Math.max(0, ...(CAP.levers.fin || []).filter((f) => f.repay === 'levy').map((f) => f.fy + f.years)); const planEnd = cfg.start + cfg.n - 1;
        return endFY > planEnd ? `<p class="small" style="margin-top:8px">The bond’s levy continues past the plan’s last year, through FY${endFY}.</p>` : ''; })()}
      <p class="small muted" style="margin-top:8px">The added cost only, not anyone’s whole tax bill. Rate = added levy ÷ the district’s taxable valuation per $1,000, with valuation growing at the PPEL growth lever.
        Homes: value × the residential rollback, less the homestead credit (the tax on $${R.homesteadCreditValue.toLocaleString()} of value, through FY${R.homesteadCreditLastFY}) or, from FY${R.homesteadCreditLastFY + 1}, the 10% homestead exemption ($${R.homesteadMin.toLocaleString()} to $${R.homesteadMax.toLocaleString()}); owners 65 and older get $${R.seniorExemption.toLocaleString()} more.
        * Rollbacks after FY2027 aren’t set yet; these use FY2027’s (44.5345% residential, 59.4401% farmland). ${imp.hasGO ? 'A general-obligation bond needs a public vote.' : ''} Rules checked ${day(R.checked)}.</p>`;
  }
  function capYearlyHtml() {
    const list = (CAP.levers.recur || []), cfg = CAP.inputs.cfg;
    if (!list.length) return '';
    const by = HGCapital.recurByYear(CAP.levers, cfg), firstYear = by.find((y) => y.total > 0.5) || by[0];
    const FUND = Object.fromEntries(YEARLY_FUNDS), KIND = Object.fromEntries(YEARLY_KINDS);
    return `<div class="card"><h3>Yearly costs</h3>
      <p class="small muted">In FY${firstYear.fy}: <b>${fmtK(firstYear.capital)}</b> from capital funds (counted in the plan) and <b>${fmtK(firstYear.other)}</b> from the general fund and other sources (shown as commitments).</p>
      ${table([
        { label: 'Initiative', html: (r) => (CAP.editable ? `<a href="#" data-action="editProject" data-id="${esc(r.initiative_id)}">${esc(r.name)}</a>` : esc(r.name)) },
        { label: 'What', get: (r) => KIND[r.kind] || r.kind },
        { label: 'Paid from', get: (r) => FUND[r.fund] || r.fund },
        { label: 'Per year', num: true, get: (r) => fmtK(r.amount) },
        { label: 'Years', get: (r) => `FY${r.first}–${r.last == null ? 'ongoing' : 'FY' + r.last}` },
        { label: 'Grows with', get: (r) => ({ none: 'Stays flat', inflation: 'Inflation', settlement: 'Settlements' })[r.grows] },
      ], list, '')}</div>`;
  }
  function capRefresh() {
    const a = document.getElementById('cap-results'), b = document.getElementById('cap-years'), f = document.getElementById('cap-fin');
    if (a) a.innerHTML = capResultsHtml();
    if (b) b.innerHTML = capYearsHtml();
    if (f) f.innerHTML = capFinHtml();
    const yc = document.getElementById('cap-yearly'); if (yc) yc.innerHTML = capYearlyHtml();
    const tx = document.getElementById('cap-tax'); if (tx) tx.innerHTML = capTaxHtml();
    LEVERS.forEach((l) => { const el = document.querySelector(`[data-lever-val="${l.k}"]`); if (el) el.textContent = l.show(CAP.levers[l.k]); });
  }
  const SET_FIELDS = [
    ['construction_inflation', 'Construction inflation', 'How fast project costs rise each year'],
    ['save_trend', 'SAVE receipts trend', 'Negative if SAVE is expected to fall (enrollment, sales tax)'],
    ['ppel_growth', 'PPEL valuation growth', 'Growth in taxable valuation, which drives PPEL and tax rates'],
    ['grant_yield', 'Grant yield to capital', 'Share of grants and gifts that goes to capital projects'],
    ['settlement_pct', 'Salary settlements', 'How fast yearly staff costs grow'],
  ];
  const pctTxt = (v) => (v == null ? '' : (Number(v) * 100).toFixed(1).replace(/\.0$/, '') + '%');
  async function vAssumptions(c) {
    const rows = await loadCapitalRows(c.district);
    AS.rows = rows;
    const sets = rows.assumption_sets || [];
    const usedBy = (id) => rows.scenarios.filter((x) => x.assumption_set_id === id);
    const intro = `<p class="small muted">Assumptions describe the world the plan has to survive: inflation, revenue growth, salary settlements. Scenarios are the district’s choices. Each scenario on the capital plan uses one set; a lever saved on a scenario still wins over its set.</p>`;
    if (!sets.length) return `<div class="card"><h3>No assumption sets yet</h3>${intro}
      ${rows.settings ? (c.plan ? '<div class="row"><button type="button" class="btn primary" data-action="starterSets">Create Base, Conservative and Growth</button><button type="button" class="btn" data-action="editSet" data-id="">Add a set</button></div><p class="small muted" style="margin-top:8px">Base starts from the district’s starting numbers; Conservative and Growth are tougher and easier versions of it. Edit any of them.</p>' : '')
        : `<p>Set up the starting numbers first.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/settings/setup">Starting numbers</a>`}</div>`;
    return `${intro}
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editSet" data-id="">Add a set</button>' : ''}<a class="btn" href="#/d/${enc(c.district.slug)}/resources/capital">Choose a set for a scenario on the capital plan</a></div>
      <div class="card"><div class="scroll"><table class="data"><thead><tr><th>Set</th>${SET_FIELDS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th>Used by</th><th></th></tr></thead><tbody>
        ${sets.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.is_default ? ' <span class="st st-approved">Default</span>' : ''}${x.notes ? `<br><span class="small muted">${esc(x.notes)}</span>` : ''}</td>
          ${SET_FIELDS.map(([k]) => `<td class="num">${pctTxt(x[k])}</td>`).join('')}
          <td>${usedBy(x.id).map((sc) => esc(sc.name)).join('<br>') || '<span class="muted">No scenario yet</span>'}</td>
          <td>${c.plan ? `<a href="#" data-action="editSet" data-id="${esc(x.id)}">Edit</a>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">New scenarios use the default set. Scenarios without a set use the starting numbers directly.</p></div>
      ${wip({ title: 'Still to come', phase: 6, items: ['Enrollment, state aid and health-insurance growth, for the general-fund forecast'] })}`;
  }
  const AS = { rows: null };
  function openSetEditor(id) {
    const x = id ? AS.rows.assumption_sets.find((s) => s.id === id) : { name: '', construction_inflation: 0.03, save_trend: 0, ppel_growth: 0.03, grant_yield: 0.75, settlement_pct: 0.03 };
    const used = id ? AS.rows.scenarios.filter((sc) => sc.assumption_set_id === id) : [];
    modal(`<form class="stack" data-form="saveSet" data-id="${esc(id || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${id ? 'Edit ' + esc(x.name) : 'Add an assumption set'}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      ${used.length ? `<p class="small muted">Used by ${used.map((sc) => `“${esc(sc.name)}”`).join(', ')}. Changes apply to them straight away, except levers saved on a scenario.</p>` : ''}
      <div class="fgrid">
        <label class="field">Name<input name="name" maxlength="40" value="${esc(x.name || '')}" required></label>
        ${SET_FIELDS.map(([k, l, h]) => `<label class="field">${l}, % a year<input name="${k}" inputmode="decimal" value="${x[k] == null ? '' : +(Number(x[k]) * 100).toFixed(2)}"><span class="hint">${h}</span></label>`).join('')}
        <label class="row" style="align-self:end"><input type="checkbox" name="is_default" ${x.is_default ? 'checked' : ''}> Default for new scenarios</label>
      </div>
      <label class="field">Notes<textarea name="notes" maxlength="500">${esc(x.notes || '')}</textarea></label>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${id ? `<span style="flex:1"></span><button type="button" class="btn danger" data-action="deleteSet" data-id="${esc(id)}">Delete</button>` : ''}</div></form>`);
  }
  async function saveSet(f, form) {
    const box = form.querySelector('[data-form-errors]'), errs = [], row = { name: (f.name || '').trim().slice(0, 40), notes: (f.notes || '').trim() || null, is_default: !!f.is_default };
    if (!row.name) errs.push('Give the set a name.');
    SET_FIELDS.forEach(([k, l]) => {
      const v = toNum(f[k]);
      if (v === null) { row[k] = null; return; }
      if (isNaN(v) || v < -20 || v > (k === 'grant_yield' ? 100 : 25)) errs.push(`${l}: enter a percentage.`);
      row[k] = +(v / 100).toFixed(4);
    });
    if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return; }
    const id = form.dataset.id, d = S.district.id;
    if (row.is_default) { const old = AS.rows.assumption_sets.find((x) => x.is_default && x.id !== id); if (old) await HG.db.update('assumption_set', `id=eq.${old.id}`, { is_default: false }); }
    if (id) await HG.db.update('assumption_set', `id=eq.${enc(id)}`, row);
    else await HG.db.insert('assumption_set', Object.assign({ district_id: d }, row));
    closeModal(); toast('Saved', row.name); here();
  }
  async function starterSets() {
    const rows = AS.rows, st = HGCapital.settingsFromRows(rows.district, rows.settings, rows.balances, rows.debts).settings;
    await HG.db.insert('assumption_set', HGCapital.starterSets(st).map((x) => Object.assign({ district_id: S.district.id }, x)));
    toast('Three sets made', 'Base, Conservative and Growth. Edit them to match the district’s outlook.'); here();
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
  // ---------------------------------------------------------------- scenario work: toolbar, project editor, financing, levers
  function scenarioToolbar(c) {
    const sc = CAP.sc || {}, btn = (a, label, cls) => `<button type="button" class="btn ${cls || ''}" data-action="${a}">${label}</button>`;
    const out = [];
    if (c.plan) out.push(btn('copyScenario', 'Copy'));
    if (c.plan && !sc.is_locked) out.push(btn('renameScenario', 'Rename'));
    if (c.plan && !sc.is_locked) out.push(btn('lockScenario', 'Lock'));
    if (c.admin && sc.is_locked) out.push(btn('unlockScenario', 'Unlock'));
    if (c.admin && !sc.is_board_version) out.push(btn('makeBoard', 'Make it the board version'));
    if (c.plan && !sc.is_locked && !sc.is_board_version) out.push(btn('deleteScenario', 'Delete', 'danger'));
    if (c.admin && sc.is_board_version) out.push(btn('publishBoard', 'Publish to the public link', 'primary'));
    return out.join('');
  }
  const FUNDS = [['save', 'SAVE'], ['ppel', 'PPEL'], ['vppel', 'V-PPEL'], ['grants', 'Grants/Donations'], ['boost', 'Boosters'], ['camp', 'Campaign/Bond']];
  function modal(inner) {
    closeModal();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" data-modal><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${inner}</div></div>`);
    const first = document.querySelector('[data-modal] input, [data-modal] select'); if (first) first.focus();
  }
  function closeModal() { document.querySelectorAll('[data-modal]').forEach((m) => m.remove()); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const INIT_TYPES = [['capital', 'Capital project'], ['program', 'Program'], ['staff', 'Staff or hire'], ['curriculum', 'Curriculum'], ['technology', 'Technology'], ['other', 'Other']];
  const INIT_STATUS = [['idea', 'Idea'], ['proposed', 'Proposed'], ['analysis', 'Being analysed'], ['approved', 'Approved'], ['underway', 'Underway'], ['done', 'Done'], ['deferred', 'Deferred'], ['declined', 'Declined']];
  const YEARLY_KINDS = [['salary', 'Salary'], ['benefits', 'Benefits'], ['supplies', 'Supplies'], ['activities', 'Activities'], ['contract', 'Contract or subscription'], ['other', 'Other']];
  const YEARLY_FUNDS = [['general', 'General fund'], ['save', 'SAVE'], ['ppel', 'PPEL'], ['vppel', 'V-PPEL'], ['grants', 'Grants/Donations'], ['boost', 'Boosters'], ['other', 'Other']];
  function yearlyRowHtml(r, cfg) {
    const opt = (list, v) => list.map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('');
    const yr = (v, ongoing) => (ongoing ? `<option value="" ${v == null ? 'selected' : ''}>Ongoing</option>` : '') + cfg.years.map((fy) => `<option value="${fy}" ${fy === Number(v) ? 'selected' : ''}>FY${fy}</option>`).join('');
    return `<tr data-yearly-row>
      <td><select name="y_kind" aria-label="What">${opt(YEARLY_KINDS, r.kind)}</select></td>
      <td><select name="y_fund" aria-label="Paid from">${opt(YEARLY_FUNDS, r.fund)}</select></td>
      <td><input name="y_amount" inputmode="decimal" value="${r.amount == null ? '' : Number(r.amount).toLocaleString('en-US')}" aria-label="Per year"></td>
      <td><select name="y_first" aria-label="From">${yr(r.first, false)}</select></td>
      <td><select name="y_last" aria-label="Until">${yr(r.last, true)}</select></td>
      <td><select name="y_grows" aria-label="Grows with">${opt([['none', 'Stays flat'], ['inflation', 'Inflation'], ['settlement', 'Salary settlements']], r.grows || 'none')}</select></td>
      <td><button type="button" class="btn small danger" data-action="removeYearlyRow" aria-label="Remove this yearly cost">×</button></td></tr>`;
  }
  /* even split that totals 100: 100 · 50/50 · 34/33/33 */
  const evenSplit = (n) => Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));
  function fundRowHtml(f) {
    return `<div class="src" data-src><select name="src" aria-label="Fund">${FUNDS.map(([k, v]) => `<option value="${k}" ${f.b === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input name="pct" inputmode="decimal" value="${f.p == null ? '' : f.p}" aria-label="Percent"><span class="small muted">%</span>
      <button type="button" class="btn small danger" data-action="removeFund" aria-label="Remove this fund">×</button></div>`;
  }
  function phaseRowHtml(ph, cfg) {
    const yr = (v) => cfg.years.map((fy) => `<option value="${fy}" ${fy === v ? 'selected' : ''}>FY${fy}</option>`).join('');
    const funds = (ph.funding && ph.funding.length ? ph.funding : [{ b: 'save', p: 100 }]).slice(0, 3);
    return `<tr data-phase-row>
      <td><input name="label" maxlength="80" value="${esc(ph.label || '')}" placeholder="Name (optional)" aria-label="Phase name"></td>
      <td><select name="fy" aria-label="Fiscal year">${yr(ph.fy || cfg.start)}</select></td>
      <td><input name="cost" inputmode="decimal" value="${ph.cost == null ? '' : Number(ph.cost).toLocaleString('en-US')}" aria-label="Cost in today’s dollars"></td>
      <td><div data-srcs class="${funds.length > 1 ? 'multi' : ''}">${funds.map(fundRowHtml).join('')}</div>
        <button type="button" class="btn small" data-action="addFund" ${funds.length >= 3 ? 'hidden' : ''}>Add a fund</button></td>
      <td><select name="status" aria-label="Status">${[['planned', 'Planned'], ['underway', 'Underway'], ['done', 'Done']].map(([k, v]) => `<option value="${k}" ${(ph.status || 'planned') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input name="actual" inputmode="decimal" value="${ph.actual == null ? '' : Number(ph.actual).toLocaleString('en-US')}" aria-label="Actual cost" placeholder="Actual cost if done"></td>
      <td><button type="button" class="btn small danger" data-action="removePhaseRow" aria-label="Remove this phase">×</button></td></tr>`;
  }
  function rebalanceFunds(cell) {
    const rows = [...cell.querySelectorAll('[data-src]')], split = evenSplit(rows.length);
    rows.forEach((r, i) => { r.querySelector('[name=pct]').value = split[i]; });
    cell.classList.toggle('multi', rows.length > 1);
    cell.parentElement.querySelector('[data-action=addFund]').hidden = rows.length >= 3;
  }
  /* ---- one editor for an initiative: its shared details, and its costs in one scenario ----
     From the capital plan, the scenario is the one on screen. From Decisions, costs are optional and
     go to the scenario picked in "Apply to scenario". Either way the same rows are read and written. */
  const ED = { rows: null, cfg: null, sid: null, mode: 'plan' };
  const inScen = (rows, sid, iid) => rows.phases.some((x) => x.scenario_id === sid && x.initiative_id === iid) || (rows.recurring || []).some((x) => x.scenario_id === sid && x.initiative_id === iid);
  function edCfg(rows) { return rows.settings ? HGEngine.makeConfig(HGCapital.settingsFromRows(rows.district, rows.settings, rows.balances, rows.debts).settings) : null; }
  function openProjectEditor(pid) {
    ED.rows = CAP.rows; ED.cfg = CAP.inputs.cfg; ED.sid = CAP.scenarioId; ED.mode = 'plan';
    renderEditor(pid);
  }
  function openDecisionEditor(pid) {
    const rows = INI.rows; ED.rows = rows; ED.cfg = edCfg(rows); ED.mode = 'decisions';
    const usable = (x) => x && !x.is_locked, chosen = rows.scenarios.find((x) => x.id === INI.sid);
    let sid = null;
    if (pid) { const pl = rows.scenarios.filter((x) => inScen(rows, x.id, pid)); sid = usable(chosen) && pl.includes(chosen) ? chosen.id : (pl.find(usable) || {}).id || null; }
    ED.sid = ED.cfg ? sid : null;   // a new initiative starts as "details only": choosing a scenario is deliberate
    renderEditor(pid);
  }
  function costSectionHtml(pid) {
    const rows = ED.rows, cfg = ED.cfg, sid = ED.sid;
    if (!sid || !cfg) return '';
    const fundBy = {}; rows.funding.forEach((f) => { (fundBy[f.phase_id] = fundBy[f.phase_id] || []).push({ b: f.fund, p: Number(f.pct) }); });
    const here_ = pid && inScen(rows, sid, pid);
    const phases = here_ ? rows.phases.filter((x) => x.scenario_id === sid && x.initiative_id === pid).sort((a, b) => a.fy - b.fy || a.seq - b.seq)
      .map((x) => ({ label: x.label || '', fy: x.fy, cost: Number(x.cost), status: x.status, actual: x.actual_cost == null ? null : Number(x.actual_cost), funding: fundBy[x.id] || [] }))
      : [{ fy: cfg.start, cost: null, funding: [{ b: 'save', p: 100 }] }];
    const yearly = here_ ? (rows.recurring || []).filter((r) => r.scenario_id === sid && r.initiative_id === pid)
      .map((r) => ({ kind: r.kind, fund: r.fund, amount: Number(r.annual_amount), first: r.first_fy, last: r.last_fy, grows: r.grows_with })) : [];
    return `<h3>One-time costs (phases)</h3>
      <p class="small muted">Costs in today’s dollars; the plan adds inflation. A phase starts with one fund; add up to three and the split is shared evenly, then adjust it. A program with only yearly costs can have no phases.</p>
      <div class="scroll"><table class="data phases"><thead><tr><th>Phase name</th><th>Year</th><th>Cost, $</th><th>Paid from</th><th>Status</th><th></th></tr></thead>
        <tbody data-phase-body>${phases.map((ph) => phaseRowHtml(ph, cfg)).join('')}</tbody></table></div>
      <div><button type="button" class="btn small" data-action="addPhaseRow">Add a phase</button></div>
      <template data-phase-template>${phaseRowHtml({ fy: cfg.start, funding: [{ b: 'save', p: 100 }] }, cfg)}</template>
      <h3>Yearly costs</h3>
      <p class="small muted">Costs that repeat every year, such as a salary, supplies or a subscription. Costs paid from SAVE, PPEL, V-PPEL or grants come off that fund each year in the plan. General-fund costs are shown as commitments; they’ll count once the general-fund model arrives.</p>
      <div class="scroll"><table class="data phases"><thead><tr><th>What</th><th>Paid from</th><th>Per year, $</th><th>From</th><th>Until</th><th>Grows with</th><th></th></tr></thead>
        <tbody data-yearly-body>${yearly.map((r) => yearlyRowHtml(r, cfg)).join('')}</tbody></table></div>
      <div><button type="button" class="btn small" data-action="addYearlyRow">Add a yearly cost</button></div>
      <template data-yearly-template>${yearlyRowHtml({ kind: 'salary', fund: 'general', first: cfg.start + 1, grows: 'none' }, cfg)}</template>`;
  }
  function renderEditor(pid) {
    const rows = ED.rows, sid = ED.sid, dec = ED.mode === 'decisions';
    const sc = rows.scenarios.find((x) => x.id === sid), i = pid ? rows.initiatives.find((x) => x.id === pid) || {} : {};
    const inThis = !!(pid && sid && inScen(rows, sid, pid));
    const plans = pid ? rows.scenarios.filter((x) => inScen(rows, x.id, pid)) : [];
    const others = plans.filter((x) => x.id !== sid).length;
    const notHere = dec ? [] : rows.initiatives.filter((x) => !inScen(rows, sid, x.id));
    const opt = (list, v) => list.map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('');
    const title = dec ? (pid ? esc(i.name || 'Initiative') : 'Add an initiative') : inThis ? 'Edit initiative' : pid ? 'Add to this scenario' : 'Add an initiative';
    const note = dec
      ? (pid ? (plans.length ? `In ${plans.map((x) => `“${esc(x.name)}”`).join(', ')}.` : 'Not in a plan yet.') : 'Add its details now; costs and a scenario are optional.')
      : `In “${esc(sc.name)}”.${others ? ` The details at the top are shared with ${others} other scenario${others === 1 ? '' : 's'}; phases and yearly costs are this scenario’s own.` : ''}`;
    modal(`<form class="stack" data-form="saveProject" data-id="${esc(pid || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${title}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <p class="small muted">${note}</p>
      ${!inThis && notHere.length ? `<label class="field">Initiative<select data-pick-init aria-label="Initiative">
          <option value="">A new initiative</option>${notHere.map((x) => `<option value="${esc(x.id)}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <span class="hint">Pick one already on the initiatives list, or start a new one.</span></label>` : ''}
      <div class="fgrid">
        <label class="field">Name<input name="name" maxlength="120" value="${esc(i.name || '')}" required></label>
        <label class="field">Type<select name="type">${opt(INIT_TYPES, i.type || 'capital')}</select></label>
        <label class="field">Status<select name="status">${opt(INIT_STATUS, i.status || 'proposed')}</select></label>
        <label class="field">Priority<select name="tier">${opt([['', 'Not set'], ['must', 'Must-have'], ['strategic', 'Strategic'], ['nice', 'Nice to have']], HGRanking.tierOf(i).tier)}</select></label>
        <label class="field">Focus area<input name="area" maxlength="40" value="${esc(i.focus_area || '')}" placeholder="Facilities, Safety & security …"></label>
        <label class="field">Cost<select name="conf"><option value="estimate" ${i.cost_confidence !== 'firm' ? 'selected' : ''}>Estimate</option><option value="firm" ${i.cost_confidence === 'firm' ? 'selected' : ''}>Firm (bid or quote)</option></select></label>
        <label class="field">Condition<select name="cond">${['', 'good', 'fair', 'poor', 'critical'].map((v) => `<option value="${v}" ${(i.condition || '') === v ? 'selected' : ''}>${v ? v[0].toUpperCase() + v.slice(1) : 'Not rated'}</option>`).join('')}</select></label>
        <label class="field">Remaining life, years<input name="life" inputmode="numeric" value="${i.remaining_life == null ? '' : i.remaining_life}"></label>
        ${dec ? `
        <label class="field">Owner<input name="owner_name" maxlength="80" value="${esc(i.owner_name || '')}" placeholder="Name or role"></label>
        <label class="field">Strategic priority<select name="priority_id"><option value="">None</option>${(rows.priorities || []).map((p) => `<option value="${esc(p.id)}" ${i.priority_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          ${(rows.priorities || []).length ? '' : '<span class="hint">Strategic priorities come from Direction (Phase 5).</span>'}</label>
        <label class="field">Board approved it on<input name="approved_on" type="date" value="${esc(i.approved_on || '')}"></label>` : ''}
      </div>
      ${dec ? `<label class="field">Description<textarea name="description" maxlength="2000">${esc(i.description || '')}</textarea></label>
      <div class="costs-box"><h3>Costs</h3>
        ${ED.cfg ? `<label class="field">Apply to scenario<select data-ed-scenario aria-label="Apply to scenario">
            <option value="" ${!sid ? 'selected' : ''}>Details only: not in a plan yet</option>
            ${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''} ${x.is_locked ? 'disabled' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}${x.is_locked ? ' (locked)' : ''}${pid && inScen(rows, x.id, pid) ? ' · already in it' : ''}</option>`).join('')}</select>
            <span class="hint">Pick a scenario to add or change this initiative’s one-time and yearly costs there. Locked scenarios can’t be changed; copy one on the capital plan to make an unlocked version.</span></label>`
          : '<p class="small muted">Set up Starting numbers (Settings) before adding costs; the plan’s years come from there.</p>'}
        <div data-cost-section>${costSectionHtml(pid)}</div></div>`
      : costSectionHtml(pid)}
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${!dec && inThis ? '<span class="spacer" style="flex:1"></span><button type="button" class="btn danger" data-action="removeProject" data-id="' + esc(pid) + '">Remove from this scenario</button>' : ''}</div>
    </form>`);
  }
  function readProject(form) {
    const errs = [], v = (n) => (form.querySelector(`[name="${n}"]`) || {}).value || '';
    const name = v('name').trim(); if (!name) errs.push('Give the initiative a name.');
    const life = toNum(v('life')); if (life !== null && (isNaN(life) || life < 0 || !Number.isInteger(life))) errs.push('Remaining life must be a whole number of years.');
    const phases = [...form.querySelectorAll('[data-phase-body] [data-phase-row]')].map((tr, k) => {
      const g = (n) => tr.querySelector(`[name="${n}"]`).value;
      const cost = toNum(g('cost')); if (cost === null || isNaN(cost) || cost < 0) errs.push(`Phase ${k + 1}: enter the cost in dollars.`);
      const funding = [...tr.querySelectorAll('[data-src]')].map((r) => ({ b: r.querySelector('[name=src]').value, p: toNum(r.querySelector('[name=pct]').value) }));
      if (!funding.length) errs.push(`Phase ${k + 1}: choose at least one fund.`);
      if (new Set(funding.map((f) => f.b)).size !== funding.length) errs.push(`Phase ${k + 1}: the same fund appears twice.`);
      if (funding.length === 1 && funding[0].p === null) funding[0].p = 100;
      if (funding.some((f) => f.p === null || isNaN(f.p) || f.p <= 0)) errs.push(`Phase ${k + 1}: give each fund a percentage.`);
      else if (Math.abs(funding.reduce((a, f) => a + f.p, 0) - 100) > 0.01) errs.push(`Phase ${k + 1}: the percentages add to ${funding.reduce((a, f) => a + f.p, 0)}%, not 100%.`);
      const status = g('status'), actual = toNum(g('actual'));
      if (actual !== null && (isNaN(actual) || actual < 0)) errs.push(`Phase ${k + 1}: actual cost must be a number of dollars.`);
      return { label: g('label').trim().slice(0, 80) || null, fy: Number(g('fy')), cost, funding, status, actual: status === 'done' && actual !== null && !isNaN(actual) ? actual : null };
    });
    const yearly = [...form.querySelectorAll('[data-yearly-body] [data-yearly-row]')].map((tr, k) => {
      const g = (n) => tr.querySelector(`[name="${n}"]`).value;
      const amount = toNum(g('y_amount')); if (amount === null || isNaN(amount) || amount <= 0) errs.push(`Yearly cost ${k + 1}: enter the amount per year in dollars.`);
      const first = Number(g('y_first')), last = g('y_last') === '' ? null : Number(g('y_last'));
      if (last != null && last < first) errs.push(`Yearly cost ${k + 1}: it ends before it starts.`);
      return { kind: g('y_kind'), fund: g('y_fund'), amount, first, last, grows: g('y_grows') };
    });
    if (ED.sid && !phases.length && !yearly.length) errs.push('Add a one-time phase, a yearly cost, or both, or choose “Details only”.');
    if (phases.length > HGUploads.MAX_PH) errs.push(`An initiative can have at most ${HGUploads.MAX_PH} phases.`);
    const extra = {};
    if (form.querySelector('[name=owner_name]')) Object.assign(extra, { owner_name: v('owner_name').trim() || null,
      priority_id: v('priority_id') || null, approved_on: v('approved_on') || null, description: v('description').trim() || null });
    return { errs, name, type: v('type') || 'capital', status: v('status') || 'proposed', tier: v('tier') || null, area: v('area').trim() || null, conf: v('conf'), cond: v('cond') || null, life, phases, yearly, extra };
  }
  async function saveProject(form) {
    const box = form.querySelector('[data-form-errors]'), r = readProject(form);
    if (r.errs.length) { box.hidden = false; box.innerHTML = r.errs.map(esc).join('<br>'); return; }
    const rows = ED.rows, d = S.district.id, sid = ED.sid, sc = rows.scenarios.find((x) => x.id === sid); let iid = form.dataset.id || null;
    const fields = Object.assign({ name: r.name.slice(0, 120), type: r.type, status: r.status, tier: r.tier, engine_priority: ({ must: 'High', strategic: 'Med', nice: 'Low' })[r.tier] || null, focus_area: r.area, cost_confidence: r.conf, condition: r.cond, remaining_life: r.life }, r.extra);
    const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ');
    if (!iid) {
      const same = rows.initiatives.find((x) => norm(x.name) === norm(r.name));
      if (same && ED.mode === 'decisions') { box.hidden = false; box.textContent = `There’s already an initiative called “${same.name}”. Click it in the list to edit it.`; return; }
      if (same && sid && inScen(rows, sid, same.id)) { box.hidden = false; box.textContent = `“${same.name}” is already in this scenario. Click it on the plan to edit it.`; return; }
      if (same) { iid = same.id; await HG.db.update('initiative', `id=eq.${iid}`, fields); }
      else { iid = crypto.randomUUID(); await HG.db.insert('initiative', Object.assign({ id: iid, district_id: d }, fields)); }
    } else {
      await HG.db.update('initiative', `id=eq.${iid}`, fields);
    }
    if (sid) {
      if (!inScen(rows, sid, iid)) {
        const rank = new Set(rows.phases.filter((ph) => ph.scenario_id === sid).map((ph) => ph.initiative_id)).size + 1;
        await HG.db.upsert('scenario_initiative', [{ scenario_id: sid, initiative_id: iid, district_id: d, rank, included: true }], 'scenario_id,initiative_id');
      }
      // save the new version first; remove the old rows only once that has worked, so a failure loses nothing
      const oldPhases = rows.phases.filter((x) => x.scenario_id === sid && x.initiative_id === iid).map((x) => x.id);
      const oldYearly = (rows.recurring || []).filter((x) => x.scenario_id === sid && x.initiative_id === iid).map((x) => x.id);
      const phases = [], funding = [];
      r.phases.forEach((ph, k) => {
        const pid = crypto.randomUUID();
        phases.push({ id: pid, district_id: d, scenario_id: sid, initiative_id: iid, seq: k + 1, label: ph.label, fy: ph.fy, cost: ph.cost, status: ph.status, actual_cost: ph.actual });
        ph.funding.forEach((f) => funding.push({ phase_id: pid, district_id: d, fund: f.b, pct: f.p }));
      });
      if (phases.length) { await HG.db.insert('phase', phases); await HG.db.insert('phase_funding', funding); }
      if (r.yearly.length) await HG.db.insert('recurring_cost', r.yearly.map((y) => ({ district_id: d, scenario_id: sid, initiative_id: iid, kind: y.kind, fund: y.fund,
        first_fy: y.first, last_fy: y.last, annual_amount: y.amount, grows_with: y.grows })));
      if (oldPhases.length) await HG.db.removeAll('phase', `id=in.(${oldPhases.map(enc).join(',')})`);
      if (oldYearly.length) await HG.db.removeAll('recurring_cost', `id=in.(${oldYearly.map(enc).join(',')})`);
    }
    closeModal(); toast('Saved', sid ? `${r.name} in “${sc.name}”.` : r.name); here();
  }
  async function removeProject(el) {
    const rows = ED.rows, iid = el.dataset.id, sid = ED.sid, sc = rows.scenarios.find((x) => x.id === sid);
    const name = (rows.initiatives.find((x) => x.id === iid) || {}).name || 'this initiative';
    if (!confirm(`Remove ${name} from “${sc.name}”? Other scenarios keep it.`)) return;
    await HG.db.removeAll('phase', `scenario_id=eq.${sid}&initiative_id=eq.${iid}`);
    await HG.db.removeAll('recurring_cost', `scenario_id=eq.${sid}&initiative_id=eq.${iid}`);
    await HG.db.removeAll('scenario_initiative', `scenario_id=eq.${sid}&initiative_id=eq.${iid}`);
    closeModal(); toast('Removed', `${name} is no longer in “${sc.name}”.`); here();
  }

  function openFinancingEditor(id) {
    const cfg = CAP.inputs.cfg, x = id ? CAP.rows.financing.find((f) => f.id === id) : null, f = x || { kind: 'go', issue_fy: cfg.start + 1, rate: 0.045, years: 20 };
    modal(`<form class="stack" data-form="saveFinancing" data-id="${esc(id || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${id ? 'Edit financing' : 'Add a bond, lease or campaign'}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <div class="fgrid">
        <label class="field">Name<input name="name" maxlength="60" value="${esc(f.name || '')}" placeholder="Series 2029 GO bond"></label>
        <label class="field">Kind<select name="kind">${[['go', 'General-obligation bond (debt service levy; needs a vote)'], ['rev', 'SAVE revenue bond (repaid from SAVE)'], ['lease', 'Lease-purchase'], ['gift', 'Campaign or gift (no repayment)']].map(([k, v]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field">Money arrives in<select name="fy">${cfg.years.map((fy) => `<option value="${fy}" ${fy === Number(f.issue_fy) ? 'selected' : ''}>FY${fy}</option>`).join('')}</select></label>
        <label class="field">Amount, $<input name="amount" inputmode="decimal" value="${f.amount == null ? '' : Number(f.amount).toLocaleString('en-US')}"></label>
        <label class="field">Interest rate, %<input name="rate" inputmode="decimal" value="${+(Number(f.rate || 0) * 100).toFixed(3)}"><span class="hint">Leave 0 for a gift</span></label>
        <label class="field">Years to repay<input name="years" inputmode="numeric" value="${f.years || 0}"></label>
        <label class="field">A lease is repaid from<select name="repay"><option value="ppel" ${f.repay_from !== 'save' ? 'selected' : ''}>PPEL</option><option value="save" ${f.repay_from === 'save' ? 'selected' : ''}>SAVE</option></select><span class="hint">Only used for a lease-purchase</span></label>
      </div>
      <p class="small muted">Payments start the year after the money arrives. Campaign/bond phases draw on this money first.</p>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${id ? `<span style="flex:1"></span><button type="button" class="btn danger" data-action="removeFinancing" data-id="${esc(id)}">Remove</button>` : ''}</div>
    </form>`);
  }
  async function saveFinancing(form) {
    const box = form.querySelector('[data-form-errors]'), v = (n) => form.querySelector(`[name="${n}"]`).value, errs = [];
    const kind = v('kind'), amount = toNum(v('amount')), rate = toNum(v('rate')), years = toNum(v('years'));
    if (amount === null || isNaN(amount) || amount <= 0) errs.push('Enter the amount in dollars.');
    if (rate === null || isNaN(rate) || rate < 0 || rate > 20) errs.push('Interest rate must be between 0% and 20%.');
    if (years === null || isNaN(years) || !Number.isInteger(years) || years < 0 || years > 40) errs.push('Years to repay must be a whole number from 0 to 40.');
    if (kind !== 'gift' && years === 0) errs.push('A bond or lease needs years to repay.');
    if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return; }
    const row = { name: v('name').trim() || ({ go: 'GO bond', rev: 'SAVE revenue bond', lease: 'Lease-purchase', gift: 'Campaign' })[kind], kind,
      issue_fy: Number(v('fy')), amount, rate: kind === 'gift' ? 0 : +(rate / 100).toFixed(4), years: kind === 'gift' ? 0 : years,
      repay_from: kind === 'rev' ? 'save' : kind === 'lease' ? v('repay') : kind === 'gift' ? 'none' : 'levy' };
    const id = form.dataset.id;
    if (id) await HG.db.update('financing', `id=eq.${enc(id)}`, row);
    else await HG.db.insert('financing', Object.assign({ district_id: S.district.id, scenario_id: CAP.scenarioId }, row));
    closeModal(); toast('Saved', row.name); here();
  }

  async function scenarioAction(kind) {
    const sc = CAP.sc, filter = `id=eq.${sc.id}`;
    if (kind === 'copy') {
      const name = (prompt('Name the copy', `${sc.name} (copy)`) || '').trim(); if (!name) return;
      const id = await HG.db.rpc('copy_scenario', { p_source: sc.id, p_name: name.slice(0, 80) });
      CAP.scenarioId = typeof id === 'string' ? id : (id && id.copy_scenario) || CAP.scenarioId;
      toast('Copied', `“${name}” is a new, unlocked scenario.`);
    } else if (kind === 'rename') {
      const name = (prompt('Rename the scenario', sc.name) || '').trim(); if (!name || name === sc.name) return;
      await HG.db.update('scenario', filter, { name: name.slice(0, 80) });
    } else if (kind === 'lock') {
      if (!confirm(`Lock “${sc.name}”? Nobody can change it until an admin unlocks it.`)) return;
      await HG.db.update('scenario', filter, { is_locked: true });
    } else if (kind === 'unlock') {
      await HG.db.update('scenario', filter, { is_locked: false });
    } else if (kind === 'board') {
      if (!confirm(`Make “${sc.name}” the board version? The public link keeps showing what was last published until you publish again.`)) return;
      const old = CAP.rows.scenarios.find((x) => x.is_board_version);
      if (old) await HG.db.update('scenario', `id=eq.${old.id}`, { is_board_version: false });
      await HG.db.update('scenario', filter, { is_board_version: true });
    } else if (kind === 'delete') {
      if (!confirm(`Delete “${sc.name}” and its phases and financing? Projects stay in other scenarios. This can’t be undone.`)) return;
      await HG.db.remove('scenario', filter);
      CAP.scenarioId = null;
    }
    here();
  }
  async function saveLevers() {
    const L = CAP.levers;
    await HG.db.update('scenario', `id=eq.${CAP.scenarioId}`, {
      lever_vppel: !!L.vppel, lever_sf2472: !!L.sf, lever_ppel_growth: +Number(L.pg).toFixed(4),
      lever_grant_yield: +Number(L.gy).toFixed(4), lever_save_trend: +Number(L.sg).toFixed(4), lever_inflation: +Number(L.infl).toFixed(4) });
    toast('Levers saved', `“${CAP.sc.name}” now uses these settings.`); here();
  }

  // ---------------------------------------------------------------- uploads: projects and balances
  const UP = { kind: null, file: null, rows: null, parsed: null, startFY: null, years: null, hasBoard: false, scenarioCount: 0 };
  const STATUS_LABEL = { uploaded: 'Uploaded', review: 'Waiting for review', applied: 'Applied', discarded: 'Discarded', superseded: 'Replaced by a later upload' };
  async function vUploads(c) {
    const d = c.district.id;
    const [rows, set, scs] = await Promise.all([
      HG.db.select('import_batch', `select=id,kind,period_end,file_name,storage_path,status,row_count,uploaded_at,applied_at&district_id=eq.${d}&order=uploaded_at.desc&limit=100`),
      HG.db.select('district_settings', `select=plan_start_fy,plan_years&district_id=eq.${d}`),
      HG.db.select('scenario', `select=id,is_board_version&district_id=eq.${d}`),
    ]);
    UP.startFY = set[0] ? set[0].plan_start_fy : null; UP.years = set[0] ? set[0].plan_years : null;
    UP.hasBoard = scs.some((x) => x.is_board_version); UP.scenarioCount = scs.length;
    UP.kind = null; UP.file = null; UP.rows = null; UP.parsed = null;
    const kinds = [c.plan && ['projects', 'Projects'], c.finance && ['balances', 'Fund balances']].filter(Boolean);
    const later = [
      c.finance && nb('Monthly GL export', 'Monthly GL upload', 3), c.finance && nb('Budget', 'Budget upload', 3),
      c.plan && nb('Goals', 'Goals upload', 5), (c.plan || c.finance) && nb('Measure results', 'Measure results upload', 5), c.plan && nb('Survey results', 'Survey upload', 5),
    ].filter(Boolean);
    return `
      ${kinds.length ? `<div class="card"><h3>Upload a file</h3>
        <div class="inline-form">
          <label class="field">What’s in it<select data-upload-kind>${kinds.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field">File (.csv or .xlsx)<input type="file" data-upload-file accept=".csv,.xlsx,.txt"></label>
        </div>
        <p class="small muted" style="margin-top:10px">Nothing changes until you review what HighGround read and click Apply. The original file is kept.
          Templates: <a href="#" data-action="downloadTemplate" data-kind="projects">projects</a>, <a href="#" data-action="downloadTemplate" data-kind="balances">fund balances</a>.</p>
        ${c.plan && !UP.startFY ? `<div class="notice">Projects need the plan’s years first: set up <a href="#/d/${enc(c.district.slug)}/settings/setup">Starting numbers</a>.</div>` : ''}
      </div>` : '<p class="muted">Your role can see uploads but not add them.</p>'}
      <div id="upload-review"></div>
      <div class="card"><h3>History</h3>${table([
        { label: 'Kind', get: (r) => KIND[r.kind] || r.kind },
        { label: 'File', html: (r) => (r.storage_path ? `<a href="#" data-action="downloadUpload" data-path="${esc(r.storage_path)}" data-name="${esc(r.file_name)}">${esc(r.file_name)}</a>` : esc(r.file_name)) },
        { label: 'Rows', num: true, get: (r) => r.row_count },
        { label: 'Status', get: (r) => STATUS_LABEL[r.status] || r.status },
        { label: 'Uploaded', get: (r) => day(r.uploaded_at) },
      ], rows, 'Nothing uploaded yet.')}</div>
      ${later.length ? `<div class="card"><h3>Other uploads</h3><div class="row">${later.join('')}</div></div>` : ''}`;
  }
  async function readUpload() {
    const kindEl = document.querySelector('[data-upload-kind]'), fileEl = document.querySelector('[data-upload-file]');
    const box = document.getElementById('upload-review');
    if (!fileEl || !fileEl.files.length) { box.innerHTML = ''; return; }
    UP.kind = kindEl.value; UP.file = fileEl.files[0];
    if (UP.file.size > 10 * 1024 * 1024) throw new UserError('That file is over 10 MB. Project and balance lists are usually far smaller; check it’s the right file.');
    UP.rows = await HGUploads.readTable(UP.file);
    if (UP.kind === 'projects') {
      if (!UP.startFY) throw new UserError('Set up Starting numbers first, so HighGround knows which years the plan covers.');
      UP.parsed = HGUploads.parseProjects(UP.rows, UP.startFY, UP.years || 10);
    } else UP.parsed = HGUploads.parseBalances(UP.rows);
    box.innerHTML = reviewHtml();
  }
  function reviewHtml() {
    const P = UP.parsed, errs = P.issues.filter((i) => i.l === 'e'), warns = P.issues.filter((i) => i.l === 'w');
    const issues = `${errs.length ? `<div class="notice error"><b>${errs.length} problem${errs.length === 1 ? '' : 's'} to fix before this can be applied:</b><br>${errs.map((i) => esc(i.m)).join('<br>')}</div>` : ''}
      ${warns.length ? `<div class="notice warn"><b>${warns.length === 1 ? '1 thing HighGround assumed. Check it:' : warns.length + ' things HighGround assumed. Check them:'}</b><br>${warns.map((i) => esc(i.m)).join('<br>')}</div>` : ''}`;
    if (UP.kind === 'projects') {
      const fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
      const list = P.projects.map((p) => ({ p, total: p.phases.reduce((a, ph) => a + ph.cost, 0) }));
      const grand = list.reduce((a, x) => a + x.total, 0);
      const firstScenario = UP.scenarioCount === 0;
      const canBoard = S.role === 'admin' || S.isStaff;
      return `<div class="card"><h3>Review: ${esc(UP.file.name)}</h3>
        <p>${P.projects.length} project${P.projects.length === 1 ? '' : 's'}, ${list.reduce((a, x) => a + x.p.phases.length, 0)} phases, ${fmt(grand)} in today’s dollars, FY${UP.startFY}–FY${UP.startFY + (UP.years || 10) - 1}.</p>
        ${issues}
        ${table([
          { label: 'Project', get: (x) => x.p.name },
          { label: 'Phases', html: (x) => x.p.phases.map((ph) => `FY${UP.startFY + ph.year}: ${fmt(ph.cost)} <span class="muted">(${ph.funding.map((f) => `${HGEngine.BUCKET_NAMES[f.b]}${f.p !== 100 ? ' ' + f.p + '%' : ''}`).join(', ')})</span>`).join('<br>') },
          { label: 'Priority', get: (x) => HGUploads.TIER_WORD[x.p.tier] || '' }, { label: 'Focus area', get: (x) => x.p.area },
          { label: 'Cost', get: (x) => (x.p.est ? 'Estimate' : 'Firm') },
          { label: 'Total', num: true, get: (x) => fmt(x.total) },
        ], list, 'No projects found.')}
        ${errs.length ? '' : `<div class="inline-form" style="margin-top:12px">
          <label class="field">Name the new scenario<input data-upload-scenario value="${esc(firstScenario ? 'District baseline' : 'Uploaded ' + day(new Date()))}" maxlength="80"></label>
          ${canBoard && !UP.hasBoard ? '<label class="row"><input type="checkbox" data-upload-board checked> Make it the board version</label>' : ''}</div>
          <p class="small muted">${firstScenario ? 'This becomes the district’s first scenario.' : 'This is added as a new scenario; existing scenarios aren’t changed.'}</p>`}
        <div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-action="applyUpload" ${errs.length ? 'disabled' : ''}>Apply</button>
          <button type="button" class="btn" data-action="cancelUpload">Cancel</button></div></div>`;
    }
    const F = P.found, fmt = (v) => (v == null ? '' : '$' + Math.round(v).toLocaleString('en-US'));
    return `<div class="card"><h3>Review: ${esc(UP.file.name)}</h3>${issues}
      ${table([{ label: 'Fund', get: (r) => r.n }, { label: 'Balance', num: true, get: (r) => fmt(r.v) }],
        [['save', 'SAVE'], ['ppel', 'PPEL'], ['vppel', 'V-PPEL'], ['grants', 'Grants and donations']].filter(([k]) => F[k] != null).map(([k, n]) => ({ n, v: F[k] })), 'No balances found.')}
      ${errs.length ? '' : `<div class="inline-form" style="margin-top:12px"><label class="field">Balances as of<input type="date" data-upload-asof value="${esc(P.asOf || '')}"></label></div>
        <p class="small muted">${P.asOf ? 'Date read from the file. ' : 'The file has no date: enter it. '}Funds missing from the file are saved as $0 for this date.</p>`}
      <div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-action="applyUpload" ${errs.length ? 'disabled' : ''}>Apply</button>
        <button type="button" class="btn" data-action="cancelUpload">Cancel</button></div></div>`;
  }
  async function applyUpload() {
    if (!UP.parsed || UP.parsed.issues.some((i) => i.l === 'e')) return;
    const d = S.district, batchId = crypto.randomUUID();
    const kind = UP.kind === 'projects' ? 'projects' : 'balances';
    let asOf = null;
    if (kind === 'balances') {
      asOf = (document.querySelector('[data-upload-asof]') || {}).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) throw new UserError('Enter the date the balances are as of.');
    }
    const scName = kind === 'projects' ? ((document.querySelector('[data-upload-scenario]') || {}).value || '').trim() : '';
    if (kind === 'projects' && !scName) throw new UserError('Give the new scenario a name.');
    const board = !!(document.querySelector('[data-upload-board]') || {}).checked;
    const safe = UP.file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80) || 'upload.csv';
    const path = `${d.id}/imports/${batchId}/${safe}`;
    await HG.storage.upload('district-files', path, UP.file);
    await HG.db.insert('import_batch', { id: batchId, district_id: d.id, kind, file_name: UP.file.name, storage_path: path, status: 'review',
      row_count: UP.rows.length, period_end: asOf, fiscal_year: asOf ? HGEngine.fyOfDate(asOf) : null });
    let createdScenario = null;
    try {
      for (let i = 0; i < UP.rows.length; i += 500) {
        await HG.db.insert('import_row', UP.rows.slice(i, i + 500).map((r, k) => ({ batch_id: batchId, district_id: d.id, row_no: i + k + 1, data: r })));
      }
      const issues = UP.parsed.issues.map((x) => ({ batch_id: batchId, district_id: d.id, row_no: x.row || null, severity: x.l === 'e' ? 'error' : 'warning', message: x.m }));
      if (issues.length) await HG.db.insert('import_issue', issues);
      if (kind === 'projects') {
        const existing = await HG.db.select('initiative', `select=id,name&district_id=eq.${d.id}`);
        const byName = new Map(existing.map((x) => [x.name.toLowerCase().replace(/\s+/g, ' '), x.id]));
        const newInits = [], idFor = new Map();
        UP.parsed.projects.forEach((p) => {
          const key = p.name.toLowerCase().replace(/\s+/g, ' ');
          let id = byName.get(key);
          if (!id) { id = crypto.randomUUID(); byName.set(key, id);
            newInits.push({ id, district_id: d.id, name: p.name, type: 'capital', status: 'proposed', tier: p.tier || null, engine_priority: p.pri || null, focus_area: p.area || null,
              cost_confidence: p.est ? 'estimate' : 'firm', condition: p.cond ? p.cond.toLowerCase() : null, remaining_life: p.life == null ? null : p.life }); }
          idFor.set(p, id);
        });
        if (newInits.length) await HG.db.insert('initiative', newInits);
        createdScenario = crypto.randomUUID();
        await HG.db.insert('scenario', { id: createdScenario, district_id: d.id, name: scName.slice(0, 80), is_board_version: board && !UP.hasBoard });
        await HG.db.insert('scenario_initiative', UP.parsed.projects.map((p, i) => ({ scenario_id: createdScenario, initiative_id: idFor.get(p), district_id: d.id, rank: i + 1, included: true })));
        const phases = [], funding = [];
        UP.parsed.projects.forEach((p) => p.phases.forEach((ph, k) => {
          const pid = crypto.randomUUID();
          phases.push({ id: pid, district_id: d.id, scenario_id: createdScenario, initiative_id: idFor.get(p), seq: k + 1, fy: UP.startFY + ph.year,
            cost: ph.cost, status: ph.status || 'planned', actual_cost: ph.actual == null ? null : ph.actual });
          ph.funding.forEach((f) => funding.push({ phase_id: pid, district_id: d.id, fund: f.b, pct: f.p }));
        }));
        await HG.db.insert('phase', phases);
        await HG.db.insert('phase_funding', funding);
      } else {
        const F = UP.parsed.found;
        await HG.db.upsert('fund_balance', ['save', 'ppel', 'vppel', 'grants'].map((fund) => ({ district_id: d.id, fund, as_of: asOf, amount: F[fund] || 0,
          source: 'upload', import_batch_id: batchId })), 'district_id,fund,as_of');
      }
      await HG.db.rpc('apply_import', { p_batch: batchId });
    } catch (err) {
      if (createdScenario) { try { await HG.db.remove('scenario', `id=eq.${createdScenario}`); } catch (e) { /* already gone */ } }
      try { await HG.db.update('import_batch', `id=eq.${batchId}`, { status: 'discarded', notes: String(err.message || err).slice(0, 500) }); } catch (e) { /* keep the original error */ }
      throw err;
    }
    toast('Upload applied', kind === 'projects' ? `“${scName}” is ready on the capital plan.` : `Balances as of ${day(asOf)} saved.`);
    if (kind === 'projects') { CAP.key = d.id; CAP.scenarioId = createdScenario; go(`#/d/${enc(d.slug)}/resources/capital`); }
    else here();
  }
  function saveText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
    const pubs = await HG.db.select('publication', `select=id,kind,title,published_at,is_current,withdrawn_at&district_id=eq.${c.district.id}&order=published_at.desc&limit=20`);
    const link = `${HG.appUrl()}#/p/${enc(c.district.slug)}`;
    const current = pubs.find((p) => p.kind === 'board_plan' && p.is_current && !p.withdrawn_at);
    const history = pubs.filter((p) => p.kind === 'board_plan');
    return `
      <div class="card"><h3>Public link</h3>
        ${c.district.public_link_enabled
          ? `<p>Anyone with this link sees the published board version, with what-if levers they can move. They can’t change anything, and they see nothing else: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>`
          : '<p>The public link is turned off for this district (Settings, District).</p>'}
        <p>${current ? `Showing <b>${esc(current.title)}</b>, published ${esc(day(current.published_at))}.` : '<b>Nothing is published.</b> The link says so.'}</p>
        <div class="row">
          ${c.admin && c.district.public_link_enabled ? '<button type="button" class="btn primary" data-action="publishBoard">Publish the board version</button>' : ''}
          ${c.admin && current ? `<button type="button" class="btn danger" data-action="withdrawBoard" data-id="${esc(current.id)}">Take it down</button>` : ''}
          ${current ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open the public page</a>` : ''}
        </div>
        ${c.admin ? '' : '<p class="small muted">Only a district admin can publish.</p>'}</div>
      <div class="card"><h3>Publish history</h3>${table([
        { label: 'Version', get: (p) => p.title },
        { label: 'Published', get: (p) => day(p.published_at) },
        { label: 'Status', get: (p) => (p.withdrawn_at ? 'Taken down' : p.is_current ? 'On the link now' : 'Replaced') },
      ], history, 'Nothing published yet.')}</div>
      <div class="row">${c.admin ? nb('Publish the community page', 'Publishing the community page', 4) : ''}</div>
      ${wip({ title: 'Community page: not built yet', phase: 4, items: ['Choose what’s public: what you told us, what we planned, what we delivered', 'Changes since the last publish', 'Unapproved proposals held back automatically'], uses: 'publication, public_publication()' })}`;
  }
  const BACKUP_TABLES = ['district_settings', 'fund_balance', 'debt_obligation', 'assumption_set', 'priority', 'outcome', 'measure', 'measure_value',
    'survey', 'survey_result', 'initiative', 'scenario', 'scenario_initiative', 'phase', 'phase_funding', 'recurring_cost', 'financing',
    'project_request', 'import_batch', 'publication', 'report_snapshot'];
  async function vExports(c) {
    const rows = await loadCapitalRows(c.district);
    const opts = rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.is_board_version ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('');
    return `
      <div class="card"><h3>Projects, as a spreadsheet</h3>
        <p>One scenario’s projects in the same layout as the upload template, so you can edit them in Excel and upload them back as a new scenario.</p>
        ${rows.scenarios.length && rows.settings ? `<div class="inline-form"><label class="field">Scenario<select data-export-scenario>${opts}</select></label>
          <button type="button" class="btn primary" data-action="exportProjects">Download .csv</button></div>` : '<p class="muted">No scenarios yet.</p>'}</div>
      <div class="card"><h3>Every scenario’s phases</h3>
        <p>All scenarios in one spreadsheet, one row per phase, with each fund’s share in dollars. Useful for comparing scenarios in Excel.</p>
        ${rows.scenarios.length ? '<button type="button" class="btn" data-action="exportPhases">Download .csv</button>' : '<p class="muted">No scenarios yet.</p>'}</div>
      <div class="card"><h3>Full backup of the district’s plan</h3>
        <p>Everything about the plan in one file: starting numbers, balances, debt, projects, scenarios, phases, funding, financing, goals, measures, surveys, uploads and publishing history. Keep it somewhere safe.</p>
        <p class="small muted">Leaves out people and access (members, invitations, requests) and the activity log.</p>
        <button type="button" class="btn" data-action="exportBackup">Download backup (.json)</button></div>
      <div class="row">${nb('Restore from a backup', 'Restoring a backup', 2)}</div>`;
  }
  function saveFile(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const fileStem = () => `${S.district.slug}-${new Date().toISOString().slice(0, 10)}`;
  async function exportProjects() {
    const rows = await loadCapitalRows(S.district);
    const sid = document.querySelector('[data-export-scenario]').value, sc = rows.scenarios.find((x) => x.id === sid);
    const inp = HGCapital.buildInputs(rows, sid);
    const TIERS = new Map(rows.initiatives.map((i) => [i.id, HGRanking.tierOf(i).tier]));
    inp.projects.forEach((p) => { p.tier = TIERS.get(String(p.id)) || ''; });
    saveFile(`${fileStem()}-${sc.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv`, HGUploads.projectsToCSV(inp.projects, inp.cfg.start));
  }
  async function exportPhases() {
    const rows = await loadCapitalRows(S.district);
    const INIT = new Map(rows.initiatives.map((i) => [i.id, i])), SC = new Map(rows.scenarios.map((x) => [x.id, x]));
    const F = {}; rows.funding.forEach((f) => { (F[f.phase_id] = F[f.phase_id] || {})[f.fund] = Number(f.pct); });
    const funds = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp', 'general'];
    const out = [['Scenario', 'Board version', 'Locked', 'Project', 'Priority', 'Focus area', 'FY', 'Cost (today’s $)', 'Status', 'Actual cost',
      ...funds.map((k) => (HGEngine.BUCKET_NAMES[k] || 'General fund') + ' $')]];
    rows.phases.slice().sort((a, b) => (SC.get(a.scenario_id).name.localeCompare(SC.get(b.scenario_id).name)) || a.fy - b.fy).forEach((ph) => {
      const sc = SC.get(ph.scenario_id), i = INIT.get(ph.initiative_id) || {}, f = F[ph.id] || {};
      out.push([sc.name, sc.is_board_version ? 'Yes' : '', sc.is_locked ? 'Yes' : '', i.name, HGUploads.TIER_WORD[HGRanking.tierOf(i).tier] || '', i.focus_area || '', ph.fy, Number(ph.cost),
        ph.status, ph.actual_cost == null ? '' : Number(ph.actual_cost), ...funds.map((k) => (f[k] ? Math.round(Number(ph.cost) * f[k] / 100) : ''))]);
    });
    saveFile(`${fileStem()}-all-phases.csv`, HGUploads.toCSV(out));
  }
  async function exportBackup() {
    const d = S.district, data = {};
    for (const t of BACKUP_TABLES) data[t] = await HG.db.selectAll(t, `select=*&district_id=eq.${d.id}`);
    const { allowed_domains, domain_role, ...district } = d;
    const backup = { kind: 'HighGround district backup', version: 1, exported_at: new Date().toISOString(), exported_by: S.user.email,
      engine: HGEngine.VERSION, district, tables: data };
    saveFile(`${fileStem()}-backup.json`, JSON.stringify(backup, null, 1), 'application/json');
    toast('Backup downloaded', `${Object.values(data).reduce((a, x) => a + x.length, 0).toLocaleString()} rows from ${BACKUP_TABLES.length} tables.`);
  }

  // ---------------------------------------------------------------- activity (audit log)
  const TABLE_NAMES = { district: 'District', district_member: 'Member', invitation: 'Invitation', district_settings: 'Starting numbers',
    debt_obligation: 'Debt', fund_balance: 'Fund balance', initiative: 'Project', scenario: 'Scenario', phase: 'Phase', phase_funding: 'Fund split',
    recurring_cost: 'Yearly cost', financing: 'Financing', priority: 'Priority', outcome: 'Outcome', measure: 'Measure', measure_value: 'Measure result',
    import_batch: 'Upload', gl_account: 'GL account', publication: 'Publication' };
  const QUIET = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'id', 'district_id']);
  const showVal = (v) => (v === null || v === undefined || v === '' ? '(blank)' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));
  async function vActivity(c, more) {
    if (!c.admin) return '<div class="notice">Only a district admin can see the activity log.</div>';
    const limit = 100;
    const rows = await HG.db.select('audit_log', `select=*&district_id=eq.${c.district.id}&order=at.desc&limit=${limit}${ACT.before ? '&at=lt.' + encodeURIComponent(ACT.before) : ''}`);
    const actors = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
    const prof = actors.length ? await HG.db.select('profile', `select=user_id,full_name,email&user_id=in.(${actors.map(enc).join(',')})`) : [];
    const P = Object.fromEntries(prof.map((p) => [p.user_id, p.full_name || p.email]));
    const label = (r) => { const x = r.new_row || r.old_row || {}; return x.name || x.title || x.email || x.fund || (x.fy ? 'FY' + x.fy : '') || ''; };
    const changes = (r) => {
      if (r.action !== 'update') return r.action === 'insert' ? 'Added' : 'Removed';
      const o = r.old_row || {}, n = r.new_row || {};
      const keys = Object.keys(n).filter((k) => !QUIET.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
      return keys.length ? keys.map((k) => `${esc(k.replace(/_/g, ' '))}: ${esc(showVal(o[k]))} → <b>${esc(showVal(n[k]))}</b>`).join('<br>') : 'No visible change';
    };
    const list = (ACT.rows = (ACT.before ? ACT.rows : []).concat(rows));
    return `<div class="card">${table([
        { label: 'When', get: (r) => new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
        { label: 'Who', get: (r) => (r.actor ? P[r.actor] || 'Willow Holler staff' : 'System') },
        { label: 'What', get: (r) => `${TABLE_NAMES[r.table_name] || r.table_name}${label(r) ? ': ' + label(r) : ''}` },
        { label: 'Change', html: (r) => (r.action === 'update' ? changes(r) : esc(changes(r))) },
      ], list, 'No changes recorded yet.')}
      ${rows.length === limit ? `<div style="margin-top:10px"><button type="button" class="btn small" data-action="activityMore" data-before="${esc(rows[rows.length - 1].at)}">Show older</button></div>` : ''}</div>
      <p class="small muted">Kept automatically for every change to the plan, people and settings. Nobody, including admins, can edit or delete it.</p>`;
  }
  const ACT = { before: null, rows: [] };


  // ------------------------------------------------------------------ views: Settings
  async function vDistrict(c) {
    const d = c.district;
    let dom = null;
    try { dom = (await HG.db.select('district', `select=allowed_domains,domain_role&id=eq.${d.id}`))[0] || null; } catch (e) { dom = null; }
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
          ${dom ? `<label class="field">Automatic access for these email domains<input name="allowed_domains" value="${esc((dom.allowed_domains || []).join(', '))}" placeholder="ironwoodvalley.k12.ia.us" ${dis}>
            <span class="hint">Anyone who confirms an address at one of these domains gets access without an invitation. Use only the district’s own domains; public services like Gmail are refused. Separate several with commas.</span></label>
          <label class="field">They get<select name="domain_role" ${dis}><option value="viewer" ${dom.domain_role !== 'board' ? 'selected' : ''}>Viewer access</option><option value="board" ${dom.domain_role === 'board' ? 'selected' : ''}>Board-member access</option></select></label>` : ''}
          <p class="small muted">Link id: <b>${esc(d.slug)}</b> (set when the district is created)</p>
          ${c.admin ? '<div><button class="btn primary" type="submit">Save changes</button></div>' : '<p class="small muted">Only a district admin can change these.</p>'}
        </form></div>
      <div class="row">${c.admin ? nb('Upload a logo', 'Logo upload', 1) : ''}${c.finance ? `<a class="btn" href="#/d/${enc(d.slug)}/settings/setup">Starting numbers</a>` : ''}</div>
      ${wip({ phase: 1, items: ['Logo'], uses: 'storage bucket district-public' })}`;
  }
  async function vPeople(c) {
    const d = c.district.id;
    const [mem, inv] = await Promise.all([
      HG.db.select('district_member', `select=user_id,role,created_at&district_id=eq.${d}&order=created_at`),
      c.admin ? HG.db.select('invitation', `select=*&district_id=eq.${d}&accepted_at=is.null&order=created_at.desc`) : Promise.resolve([]),
    ]);
    let reqs = [];
    if (c.admin) { try { reqs = await HG.db.select('access_request', `select=id,email,message,created_at&district_id=eq.${d}&status=eq.pending&order=created_at`); } catch (e) { reqs = []; } }
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
        <p class="small muted" style="margin-top:10px">HighGround emails them a link to ${esc(HG.appUrl())}. They must create their account with the invited address.</p></div>
      ${reqs.length ? `<div class="card"><h3>Asking for access</h3>${table([
        { label: 'Email', get: (q) => q.email },
        { label: 'Message', get: (q) => q.message },
        { label: 'Asked', get: (q) => day(q.created_at) },
        { label: 'Role', html: (q) => `<select data-req-role="${esc(q.id)}" aria-label="Role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === 'viewer' ? 'selected' : ''}>${v}</option>`).join('')}</select>` },
        { label: '', html: (q) => `<button type="button" class="btn small primary" data-action="approveRequest" data-id="${esc(q.id)}" data-email="${esc(q.email)}">Approve</button>
            <button type="button" class="btn small danger" data-action="declineRequest" data-id="${esc(q.id)}">Decline</button>` },
      ], reqs, '')}</div>` : ''}
      <div class="card"><h3>Waiting to accept</h3>${table([
        { label: 'Email', get: (i) => i.email },
        { label: 'Role', get: (i) => ROLE[i.role] },
        { label: 'Invited', get: (i) => day(i.created_at) },
        { label: 'Emailed', get: (i) => (i.last_sent_at ? day(i.last_sent_at) + (i.sent_count > 1 ? ` (${i.sent_count} times)` : '') : 'Not yet') },
        { label: 'Expires', get: (i) => day(i.expires_at) },
        { label: '', html: (i) => `<button type="button" class="btn small" data-action="resendInvite" data-id="${esc(i.id)}">Send again</button>
            <button type="button" class="btn small danger" data-action="cancelInvite" data-id="${esc(i.id)}">Cancel</button>` },
      ], inv, 'No open invitations.')}</div>` : '<p class="small muted">Only a district admin can invite people or change roles.</p>'}
      <details class="small muted"><summary>What each role can do</summary>
        <p><b>Admin</b>: everything, including people, settings, publishing and unlocking scenarios. <b>Business manager</b>: financial uploads, balances, debt, settings. <b>Superintendent</b> and <b>Editor</b>: initiatives, scenarios, goals, project and goal uploads. <b>Board member</b> and <b>Viewer</b>: read everything in the district.</p></details>`;
  }
  async function sendInvite(id, email) {
    try {
      const r = await HG.fn('send-invitation', { invitation_id: id });
      if (r && r.status === 'accepted') toast('Access started', `${email} already had an account, so they have access now.`);
      else toast('Invitation emailed', `Sent to ${email}.`);
    } catch (err) {
      toast('Invitation saved, but not emailed', `${err.message} Tell them to create an account at ${HG.appUrl()} with ${email}.`, 'notbuilt');
    }
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
      <div class="card"><h3>Two-step sign-in</h3>${(() => {
        const on = ((S.user && S.user.factors) || []).find((x) => x.status === 'verified');
        return on ? `<p><b>On.</b> After your password, HighGround asks for a code from your authenticator app.</p>
            <button type="button" class="btn danger" data-action="mfaOff" data-id="${esc(on.id)}">Turn it off</button>`
          : `<p>After your password, HighGround will also ask for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and similar).</p>
            <button type="button" class="btn primary" data-action="mfaOn">Turn on two-step sign-in</button>`;
      })()}</div>`;
  }
  async function vBuilt() {
    const rows = [];
    ALL.forEach((s) => s.tabs.forEach((t) => rows.push({ s: s.label, t: t.label, status: t.status, phase: t.phase })));
    rows.push({ s: 'Sign-in', t: 'Email and password, confirmation, reset', status: 'live' });
    rows.push({ s: 'Public link', t: 'Board version with what-if levers (community page later)', status: 'partial', phase: 4 });
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
    S.staffDistricts = rows;
    frame({ slug: null, sectionId: 'staff', body: `
      <div class="page-head"><div><h1>Willow Holler</h1><div class="lede">Every district, and new ones.</div></div><div class="right">${badge('live')}</div></div>
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      <div class="card"><h3>Districts</h3>${table([
        { label: 'District', html: (r) => `<a href="#/d/${enc(r.slug)}/overview/today">${esc(r.name)}</a>` },
        { label: 'Link id', get: (r) => r.slug }, { label: 'State', get: (r) => r.state },
        { label: 'Demo', get: (r) => (r.is_demo ? 'Demo' : '') }, { label: 'Created', get: (r) => day(r.created_at) },
      ], rows, 'No districts yet. Add the first one below; start with a fictional demo district.')}</div>
      ${demoLoaderHtml(rows)}
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


  // ---------------------------------------------------------------- starting numbers (district_settings, balances, debt)
  const toNum = (v) => { if (v == null) return null; const t = String(v).replace(/[$,\s]/g, ''); if (t === '') return null; const x = Number(t); return isFinite(x) ? x : NaN; };
  const moneyIn = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const pctIn = (v) => (v == null || v === '' ? '' : +(Number(v) * 100).toFixed(2));
  /* light-touch checks on the starting numbers: warnings, never blocks */
  const SAVE_PER_STUDENT = { fy: 2026, amount: 1358 };   // statewide FY2026 SAVE ≈ $652.7M ÷ 480,665 students (LSA fiscal note, SF 2472)
  function setupChecks(form) {
    const num = (n) => { const el = form.querySelector(`[name="${n}"]`); return el ? toNum(el.value) : null; };
    const val = (n) => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
    const warn = [], tip = [];
    const pr = num('ppel_receipts'), rate = num('ppel_rate'), tv = num('taxable_valuation'), av = num('actual_valuation');
    if (pr > 0 && tv > 0 && rate > 0) {
      const exp = rate * tv / 1000;
      if (Math.abs(pr - exp) / exp > 0.15) warn.push(`PPEL receipts ($${Math.round(pr).toLocaleString()}) don’t match the PPEL rate × taxable valuation (about $${Math.round(exp).toLocaleString()}). Check the valuation and rate against the certified budget; receipts that include an income surtax will be higher.`);
    } else if (pr > 0 && tv > 0) {
      const implied = pr / (tv / 1000);
      if (implied > 0.34) warn.push(`PPEL receipts and taxable valuation imply $${implied.toFixed(2)} per $1,000, above the $0.33 a board can levy without a vote. Check the valuation, or whether receipts include an income surtax.`);
      else tip.push('Add the PPEL rate from the certified budget, so receipts can be checked against it.');
    }
    if (av > 0 && tv > 0 && av < tv) warn.push('Actual (100%) valuation is lower than taxable valuation. Actual valuation is normally the larger figure; check they aren’t swapped.');
    const sr = num('save_receipts'), en = num('enrollment');
    if (sr > 0 && en > 0) {
      const per = sr / en, ratio = per / SAVE_PER_STUDENT.amount;
      if (ratio < 0.8 || ratio > 1.2) warn.push(`SAVE receipts work out to $${Math.round(per).toLocaleString()} per student; SAVE is shared statewide at about $${SAVE_PER_STUDENT.amount.toLocaleString()} per student (FY${SAVE_PER_STUDENT.fy}). Check the receipts and the certified enrollment.`);
    }
    if (sr > 0 && !val('save_receipts_fy')) warn.push('Say which fiscal year the SAVE receipts are for. The SF 2472 reduction is scaled from that year; without it, HighGround assumes the year before the plan starts.');
    if (!form.querySelectorAll('[data-debt-body] [data-debt-row]').length) tip.push('No existing debt entered. If the district has SAVE revenue bonds, PPEL loans or lease-purchases, add them; otherwise the plan overstates what SAVE and PPEL can pay for.');
    const asOf = val('as_of');
    if (asOf) {
      const d = new Date(asOf + 'T12:00:00'), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (d.getDate() !== last) tip.push('Balances are usually taken at a month-end, or at the 30 June close, so they match the general ledger.');
    }
    if (!av) tip.push('Add the actual (100%) valuation and general-obligation debt outstanding to see the 5% debt limit.');
    return { warn, tip };
  }
  function renderSetupChecks(form) {
    const box = form.querySelector('[data-setup-checks]'); if (!box) return;
    const { warn, tip } = setupChecks(form);
    box.hidden = !warn.length && !tip.length;
    box.innerHTML = `<h3>Worth a second look</h3>
      ${warn.length ? `<ul class="warn">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${tip.length ? `<ul class="tip">${tip.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="small muted">These are checks, not errors: you can still save.</p>`;
  }
  async function vSetup(c) {
    const d = c.district.id;
    const [set, bal, debts] = await Promise.all([
      HG.db.select('district_settings', `select=*&district_id=eq.${d}`),
      HG.db.select('fund_balance', `select=fund,as_of,amount&district_id=eq.${d}&order=as_of.desc`),
      HG.db.select('debt_obligation', `select=*&district_id=eq.${d}&order=final_fy`),
    ]);
    const s = set[0] || {};
    const asOf = bal.length ? bal[0].as_of : '';
    const B = {}; bal.filter((b) => b.as_of === asOf).forEach((b) => { B[b.fund] = b.amount; });
    const dis = c.finance ? '' : 'disabled';
    const f = (name, label, value, hint, kind) => `<label class="field">${esc(label)}
      <input name="${name}" ${kind === 'int' ? 'inputmode="numeric"' : 'inputmode="decimal"'} value="${esc(value)}" ${dis} autocomplete="off">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
    const debtRow = (x) => `<tr data-debt-row data-id="${esc(x.id || '')}">
      <td><input name="debt_name" value="${esc(x.name || '')}" ${dis} aria-label="Obligation"></td>
      <td><select name="debt_fund" ${dis} aria-label="Paid from">${[['save', 'SAVE'], ['ppel', 'PPEL'], ['debt_levy', 'Debt service levy']].map(([k, v]) => `<option value="${k}" ${x.fund === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input name="debt_annual" inputmode="decimal" value="${esc(moneyIn(x.annual_payment))}" ${dis} aria-label="Payment per year"></td>
      <td><input name="debt_final" inputmode="numeric" value="${esc(x.final_fy || '')}" ${dis} aria-label="Final fiscal year" placeholder="2033"></td>
      <td>${c.finance ? '<button type="button" class="btn small danger" data-action="removeDebtRow">Remove</button>' : ''}</td></tr>`;
    return `
      ${c.finance ? '' : '<div class="notice">Only a business manager or admin can change these numbers.</div>'}
      ${(() => { setTimeout(() => { const sf = document.querySelector('form[data-form=saveSetup]'); if (sf) renderSetupChecks(sf); }, 0); return ''; })()}
      <form class="stack setup" data-form="saveSetup" novalidate>
        <div class="card checks" data-setup-checks hidden></div>
        <div class="card"><h3>Plan</h3><div class="fgrid">
          ${f('plan_years', 'Years in the plan', s.plan_years || 10, '5 to 15', 'int')}
          ${f('enrollment', 'Certified enrollment', s.enrollment == null ? '' : s.enrollment, 'From the certified enrollment (Iowa Department of Education); used for per-pupil figures', 'int')}
          ${f('enrollment_year', 'Enrollment year', s.enrollment_year || '', 'For example 2025-26')}
          ${f('construction_inflation', 'Construction inflation, % a year', pctIn(s.construction_inflation || 0), 'Applied to future phases')}</div></div>

        <div class="card"><h3>Fund balances</h3><div class="fgrid">
          <label class="field">Balances as of<input name="as_of" type="date" value="${esc(asOf)}" ${dis}><span class="hint">Use 30 June for a year-end close. The plan starts in the fiscal year this date belongs to.</span></label>
          ${f('bal_save', 'SAVE balance, $', moneyIn(B.save), 'From the general ledger, or the audited 30 June balance')}${f('bal_ppel', 'PPEL balance, $', moneyIn(B.ppel))}
          ${f('bal_vppel', 'V-PPEL balance, $', moneyIn(B.vppel))}${f('bal_grants', 'Grants and donations on hand, $', moneyIn(B.grants))}</div>
          <p class="small muted">Saving with a new date adds a new set of balances and keeps the earlier ones.</p></div>

        <div class="card"><h3>SAVE (Secure an Advanced Vision for Education)</h3><div class="fgrid">
          ${f('save_receipts', 'SAVE receipts per year, $', moneyIn(s.save_receipts), 'A full year’s receipts, from the general ledger or the audit')}
          ${f('save_receipts_fy', 'Those receipts are for fiscal year', s.save_receipts_fy || '', 'For example 2026', 'int')}
          ${f('save_ongoing', 'Ongoing SAVE commitments per year, $', moneyIn(s.save_ongoing || 0), 'Yearly costs already paid from SAVE, not debt')}
          ${f('save_trend', 'SAVE receipts trend, % a year', pctIn(s.save_trend || 0), 'Negative if receipts are falling')}
          <label class="row"><input type="checkbox" name="sf2472" ${s.sf2472 === false ? '' : 'checked'} ${dis}> Apply the SF 2472 SAVE reduction</label></div></div>

        <div class="card"><h3>PPEL (Physical Plant and Equipment Levy)</h3><div class="fgrid">
          ${f('ppel_receipts', 'PPEL receipts per year, $', moneyIn(s.ppel_receipts), 'From the certified budget or the general ledger')}
          ${f('ppel_ongoing', 'Ongoing PPEL commitments per year, $', moneyIn(s.ppel_ongoing || 0))}
          ${f('ppel_growth', 'Taxable valuation growth, % a year', pctIn(s.ppel_growth == null ? 0.03 : s.ppel_growth))}
          ${f('ppel_rate', 'PPEL rate, $ per $1,000', s.ppel_rate == null ? '' : s.ppel_rate, 'From the certified budget (Iowa Department of Management); used to check receipts')}
          ${f('taxable_valuation', 'Taxable valuation, $', moneyIn(s.taxable_valuation), 'For tax estimates: the valuation the county auditor certifies for the debt service levy')}
          ${f('actual_valuation', 'Actual (100%) valuation, $', moneyIn(s.actual_valuation), 'From the county auditor; used for the 5% debt limit')}
          ${f('go_outstanding', 'General-obligation debt outstanding, $', moneyIn(s.go_outstanding), 'Optional')}</div></div>

        <div class="card"><h3>Tax estimates</h3>
          <p class="small muted">Used for “what it means for taxpayers.” Farmland is taxed on its productivity value, which the county assessor sets; it is much lower than the market price.</p><div class="fgrid">
          ${f('tax_home_value', 'Example home value, $', moneyIn(s.tax_home_value == null ? 150000 : s.tax_home_value), 'Assessed value of a typical home in the district')}
          ${f('ag_value_per_acre', 'Assessed farmland value per acre, $', moneyIn(s.ag_value_per_acre), 'Optional; from the county assessor (productivity value)')}</div></div>

        <div class="card"><h3>V-PPEL (voter-approved PPEL)</h3><div class="fgrid">
          <label class="field">Status<select name="vppel_status" ${dis}>${[['none', 'None'], ['proposed', 'Proposed (needs a vote)'], ['active', 'Active']].map(([k, v]) => `<option value="${k}" ${(s.vppel_status || 'none') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${f('vppel_annual', 'V-PPEL receipts per year, $', moneyIn(s.vppel_annual))}
          ${f('vppel_first_fy', 'First fiscal year', s.vppel_first_fy || '', '', 'int')}
          ${f('vppel_last_fy', 'Last fiscal year', s.vppel_last_fy || '', 'Up to 10 years after the first', 'int')}</div></div>

        <div class="card"><h3>Grants and donations</h3><div class="fgrid">
          ${f('grants_avg', 'Average received per year, $', moneyIn(s.grants_avg || 0))}
          ${f('grants_yield', 'Share that goes to capital projects, %', pctIn(s.grants_yield == null ? 0.75 : s.grants_yield))}</div></div>

        <div class="card"><h3>Existing debt</h3>
          <p class="small muted">Payments already committed. SAVE and PPEL payments come out of those funds; debt service levy payments don’t affect the capital plan.</p>
          <div class="scroll"><table class="data debt"><thead><tr><th>Obligation</th><th>Paid from</th><th>Payment per year, $</th><th>Final fiscal year</th><th></th></tr></thead>
          <tbody data-debt-body>${debts.map(debtRow).join('')}</tbody></table></div>
          ${c.finance ? '<div style="margin-top:10px"><button type="button" class="btn small" data-action="addDebtRow">Add an obligation</button></div>' : ''}
          <template data-debt-template>${debtRow({ fund: 'save' })}</template></div>

        <div class="notice error" data-setup-errors hidden></div>
        ${c.finance ? '<div class="row"><button class="btn primary" type="submit">Save starting numbers</button><span class="small muted">The capital plan updates as soon as these are saved.</span></div>' : ''}
      </form>`;
  }
  function readSetup(form) {
    const errs = [];
    const v = (n) => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
    const money = (n, label, required) => { const x = toNum(v(n)); if (x === null) { if (required) errs.push(`${label} is needed.`); return null; } if (isNaN(x) || x < 0) { errs.push(`${label} must be a number of dollars.`); return null; } return x; };
    const pctv = (n, label, lo, hi) => { const x = toNum(v(n)); if (x === null) return null; if (isNaN(x) || x < lo || x > hi) { errs.push(`${label} must be between ${lo}% and ${hi}%.`); return null; } return +(x / 100).toFixed(4); };
    const intv = (n, label, lo, hi) => { const x = toNum(v(n)); if (x === null) return null; if (isNaN(x) || !Number.isInteger(x) || x < lo || x > hi) { errs.push(`${label} must be a whole number from ${lo} to ${hi}.`); return null; } return x; };
    const asOf = v('as_of');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) errs.push('Choose the date the balances are as of.');
    const settings = {
      plan_years: intv('plan_years', 'Years in the plan', 5, 15) || 10,
      enrollment: intv('enrollment', 'Enrollment', 0, 100000),
      enrollment_year: v('enrollment_year').trim() || null,
      construction_inflation: pctv('construction_inflation', 'Construction inflation', 0, 25) || 0,
      save_receipts: money('save_receipts', 'SAVE receipts', true),
      save_receipts_fy: intv('save_receipts_fy', 'The SAVE receipts year', 2000, 2100),
      save_ongoing: money('save_ongoing', 'Ongoing SAVE commitments') || 0,
      save_trend: pctv('save_trend', 'SAVE trend', -25, 25) || 0,
      sf2472: !!form.querySelector('[name="sf2472"]').checked,
      ppel_receipts: money('ppel_receipts', 'PPEL receipts', true),
      ppel_ongoing: money('ppel_ongoing', 'Ongoing PPEL commitments') || 0,
      ppel_growth: pctv('ppel_growth', 'Valuation growth', -25, 25),
      ppel_rate: (() => { const x = toNum(v('ppel_rate')); if (x === null) return null; if (isNaN(x) || x < 0 || x > 5) { errs.push('PPEL rate must be dollars per $1,000, like 0.33.'); return null; } return x; })(),
      taxable_valuation: money('taxable_valuation', 'Taxable valuation'),
      tax_home_value: money('tax_home_value', 'Example home value') || 150000,
      ag_value_per_acre: money('ag_value_per_acre', 'Assessed farmland value per acre'),
      actual_valuation: money('actual_valuation', 'Actual valuation'),
      go_outstanding: money('go_outstanding', 'General-obligation debt outstanding'),
      vppel_status: v('vppel_status') || 'none',
      vppel_annual: money('vppel_annual', 'V-PPEL receipts'),
      vppel_first_fy: intv('vppel_first_fy', 'V-PPEL first year', 2000, 2100),
      vppel_last_fy: intv('vppel_last_fy', 'V-PPEL last year', 2000, 2100),
      grants_avg: money('grants_avg', 'Average grants') || 0,
      grants_yield: pctv('grants_yield', 'Share of grants to capital', 0, 100),
    };
    if (settings.ppel_growth == null) settings.ppel_growth = 0.03;
    if (settings.grants_yield == null) settings.grants_yield = 0.75;
    if (settings.vppel_status !== 'none') {
      if (!settings.vppel_annual) errs.push('Enter V-PPEL receipts per year, or set the status to None.');
      if (!settings.vppel_first_fy || !settings.vppel_last_fy) errs.push('Enter the first and last V-PPEL years.');
      else if (settings.vppel_last_fy < settings.vppel_first_fy) errs.push('The last V-PPEL year is before the first.');
    }
    const startFY = HGEngine.fyOfDate(asOf);
    if (startFY) settings.plan_start_fy = startFY;
    const balances = ['save', 'ppel', 'vppel', 'grants'].map((fund) => ({ fund, amount: money('bal_' + fund, { save: 'SAVE balance', ppel: 'PPEL balance', vppel: 'V-PPEL balance', grants: 'Grants on hand' }[fund], fund === 'save' || fund === 'ppel') }));
    const debts = [...form.querySelectorAll('[data-debt-body] [data-debt-row]')].map((tr, i) => {
      const g = (n) => tr.querySelector(`[name="${n}"]`).value;
      const name = g('debt_name').trim(), annual = toNum(g('debt_annual')), fy = toNum(g('debt_final'));
      if (!name && annual === null && fy === null) return null;   // empty row: ignore
      if (!name) errs.push(`Debt row ${i + 1}: give it a name.`);
      if (annual === null || isNaN(annual) || annual < 0) errs.push(`Debt row ${i + 1}: enter the payment per year.`);
      if (fy === null || isNaN(fy) || !Number.isInteger(fy) || fy < 2000 || fy > 2100) errs.push(`Debt row ${i + 1}: enter the final fiscal year, like 2033.`);
      return { id: tr.dataset.id || null, name, fund: g('debt_fund'), annual_payment: annual, final_fy: fy };
    }).filter(Boolean);
    return { errs, asOf, settings, balances, debts };
  }
  async function saveSetup(form) {
    const box = form.querySelector('[data-setup-errors]');
    const r = readSetup(form);
    if (r.errs.length) { box.hidden = false; box.innerHTML = r.errs.map(esc).join('<br>'); box.scrollIntoView({ block: 'center' }); return; }
    box.hidden = true;
    const d = S.district.id;
    await HG.db.upsert('district_settings', [Object.assign({ district_id: d }, r.settings)], 'district_id');
    await HG.db.upsert('fund_balance', r.balances.map((b) => ({ district_id: d, fund: b.fund, as_of: r.asOf, amount: b.amount || 0, source: 'manual' })), 'district_id,fund,as_of');
    const existing = await HG.db.select('debt_obligation', `select=id&district_id=eq.${d}`);
    const keep = new Set(r.debts.filter((x) => x.id).map((x) => x.id));
    for (const x of existing) if (!keep.has(x.id)) await HG.db.remove('debt_obligation', `id=eq.${enc(x.id)}`);
    for (const x of r.debts) {
      const row = { name: x.name, fund: x.fund, annual_payment: x.annual_payment, final_fy: x.final_fy };
      if (x.id) await HG.db.update('debt_obligation', `id=eq.${enc(x.id)}`, row);
      else await HG.db.insert('debt_obligation', Object.assign({ district_id: d }, row));
    }
    toast('Starting numbers saved', 'The capital plan now uses them.');
    here();
  }

  // ---------------------------------------------------------------- publishing the board version
  async function publicationPayload(d) {
    const rows = await loadCapitalRows(d);
    const board = rows.scenarios.find((x) => x.is_board_version);
    if (!rows.settings) throw new UserError('Set up the starting numbers first (Settings, Starting numbers).');
    if (!board) throw new UserError('Choose a board version first. Making a scenario the board version arrives with scenario editing.');
    const inp = HGCapital.buildInputs(rows, board.id);
    return { board, payload: {
      v: 1, engine: HGEngine.VERSION, scenario: { name: board.name },
      settings: inp.cfg.settings, stored: inp.stored, notes: inp.notes, tax: inp.tax,
      projects: inp.projects.map((p) => ({ id: p.id, name: p.name, pri: p.pri, est: p.est, area: p.area, cond: p.cond, life: p.life,
        phases: p.phases.map((ph) => ({ cost: ph.cost, year: ph.year, funding: ph.funding, status: ph.status, actual: ph.actual, label: ph.label })) })),
    } };
  }
  async function publishBoard() {
    const d = S.district;
    if (!d.public_link_enabled) throw new UserError('The public link is turned off for this district. Turn it on in Settings, District.');
    const { board, payload } = await publicationPayload(d);
    if (!confirm(`Publish “${board.name}” to the public link? Anyone with the link will see it.`)) return;
    await HG.db.insert('publication', { district_id: d.id, kind: 'board_plan', title: board.name, scenario_id: board.id, payload });
    toast('Published', 'The public link now shows this version.');
    here();
  }
  async function withdrawBoard(el) {
    if (!confirm('Take the plan off the public link? The link will say nothing is published.')) return;
    await HG.db.update('publication', `id=eq.${enc(el.dataset.id)}`, { withdrawn_at: new Date().toISOString(), is_current: false });
    toast('Taken down', 'The public link no longer shows a plan.');
    here();
  }

  // ---------------------------------------------------------------- demo data (fictional)
  function demoLoaderHtml(rows) {
    const demos = rows.filter((r) => r.is_demo);
    if (!demos.length || !window.HG_DEMOS) return '';
    return `<div class="card"><h3>Demo data</h3>
      <p class="small muted">Fictional figures for demonstrations. <b>Load</b> fills an empty demo district. <b>Reset</b> erases a demo district’s plan and loads the data set again, then republishes its board version so the public demo link works straight away. People and access are never touched, and only districts marked as demos can be reset.</p>
      <div class="inline-form">
        <label class="field">Demo district<select data-demo-district>${demos.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
        <label class="field">Data set<select data-demo-set>${Object.entries(window.HG_DEMOS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name)} (${v.enrollment.toLocaleString()} students)</option>`).join('')}</select></label>
        <button type="button" class="btn primary" data-action="loadDemo">Load into an empty district</button>
        <button type="button" class="btn danger" data-action="resetDemo">Reset to this demo</button></div></div>`;
  }
  async function loadDemo(el) {
    const card = el.closest('.card');
    const did = card.querySelector('[data-demo-district]').value, set = card.querySelector('[data-demo-set]').value;
    const d = (S.staffDistricts || []).find((x) => x.id === did) || S.districts.find((x) => x.id === did) || { id: did };
    if (!d.is_demo) throw new UserError('Demo data can only go into a demo district.');
    const [a, b, c2] = await Promise.all([
      HG.db.select('district_settings', `select=district_id&district_id=eq.${did}`),
      HG.db.select('scenario', `select=id&district_id=eq.${did}&limit=1`),
      HG.db.select('initiative', `select=id&district_id=eq.${did}&limit=1`)]);
    if (a.length || b.length || c2.length) throw new UserError('That district already has plan data. Demo data only goes into an empty demo district.');
    const R = HGCapital.demoRows(window.HG_DEMOS[set], did, () => crypto.randomUUID());
    await writeDemo(d, set);
    toast('Demo data loaded', `${window.HG_DEMOS[set].name} figures are in ${d.name || 'the district'}.`);
    go(`#/d/${enc(d.slug)}/resources/capital`);
  }
  async function writeDemo(d, set) {
    const did = d.id, R = HGCapital.demoRows(window.HG_DEMOS[set], did, () => crypto.randomUUID());
    const order = ['district_settings', 'fund_balance', 'debt_obligation', 'initiative', 'scenario', 'scenario_initiative', 'phase', 'phase_funding', 'recurring_cost', 'financing'];
    try {
      for (const t of order) if (R[t].length) await HG.db.insert(t, R[t]);
      for (const sid of R.lock) await HG.db.update('scenario', `id=eq.${sid}`, { is_locked: true });
    } catch (err) {
      // undo what went in, so the district is empty again
      for (const t of ['scenario', 'initiative', 'debt_obligation', 'fund_balance', 'district_settings']) {
        try { await HG.db.remove(t, `district_id=eq.${did}`); } catch (e) { /* nothing to remove */ }
      }
      throw err;
    }
  }
  /* erase a demo district's plan and load a data set again, then republish its board version */
  async function resetDemo(el) {
    const card = el.closest('.card');
    const did = card.querySelector('[data-demo-district]').value, set = card.querySelector('[data-demo-set]').value;
    const d = S.districts.find((x) => x.id === did) || (S.staffDistricts || []).find((x) => x.id === did);
    if (!d || !d.is_demo) throw new UserError('Only a demo district can be reset.');
    if (!confirm(`Erase everything in ${d.name}’s plan (starting numbers, balances, debt, initiatives, scenarios, uploads and publishing history) and load ${window.HG_DEMOS[set].name} again? People and access stay as they are.`)) return;
    for (const t of ['publication', 'scenario', 'initiative', 'debt_obligation', 'fund_balance', 'import_batch', 'district_settings']) {
      await HG.db.removeAll(t, `district_id=eq.${did}`);
    }
    await writeDemo(d, set);
    let published = false;
    if (d.public_link_enabled) {
      try {
        const { board, payload } = await publicationPayload(d);
        await HG.db.insert('publication', { district_id: did, kind: 'board_plan', title: board.name, scenario_id: board.id, payload });
        published = true;
      } catch (e) { console.warn('HighGround: demo republish skipped:', e); }
    }
    toast('Demo reset', `${d.name} is back to the ${window.HG_DEMOS[set].name.replace(/ Community School District$/, '')} demo${published ? ', and its board version is on the public link again' : ''}.`);
    here();
  }

  function renderNoDistrict() {
    S.district = null;
    frame({ slug: null, body: `
      <div class="page-head"><div><h1>Welcome to HighGround</h1><div class="lede">You’re signed in as ${esc(S.user.email)}.</div></div></div>
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      <div class="card"><h3>You don’t have access to a district yet</h3>
        <p>Ask your district’s HighGround admin to invite <b>${esc(S.user.email)}</b>. Access starts as soon as they do.</p>
        <div class="row"><button type="button" class="btn primary" data-action="recheck">Check again</button></div></div>
      <div class="card"><h3>Or ask a district for access</h3>
        <p class="small muted">The district’s link id is the last part of its HighGround link, for example <b>ironwood-valley</b>.</p>
        <form class="stack" data-form="requestAccess">
          <label class="field">District link id<input name="slug" required pattern="[a-zA-Z0-9\\-]{2,40}" autocomplete="off"></label>
          <label class="field">Message to the district’s admins<textarea name="message" maxlength="1000" placeholder="Who you are and why you need access"></textarea></label>
          <div><button class="btn" type="submit">Ask for access</button></div></form></div>` });
    flash = null;
  }

  // ------------------------------------------------------------------ public page (no account)
  async function renderPublic(slug) {
    const p = await HG.db.rpc('public_publication', { p_slug: slug, p_kind: 'board_plan' }, { auth: false });
    const d = p && p.district;
    let body = `<div class="card"><h2>Nothing published here yet</h2><p>This link doesn’t have a published plan. If you expected one, ask the district.</p></div>`;
    if (p && p.payload && p.payload.settings) {
      const cfg = HGEngine.makeConfig(p.payload.settings);
      const stored = p.payload.stored || {};
      CAP.pub = true; CAP.key = null; CAP.editable = false; CAP.sc = null;
      CAP.inputs = { cfg, projects: HGEngine.cleanList(p.payload.projects || [], cfg), stored, levers: HGEngine.leversOf(stored, cfg), notes: [], tax: p.payload.tax || {} };
      CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers));
      body = `
        <div class="page-head"><div><h1>${esc(d.name)}</h1>
          <div class="lede">Capital plan: ${esc(p.payload.scenario ? p.payload.scenario.name : p.title || 'board version')}, published ${esc(day(p.published_at))}</div></div></div>
        ${d.is_demo ? '<div class="notice">Demo district: every name and figure is made up.</div>' : ''}
        <div id="cap-results">${capResultsHtml()}</div>
        <div class="cap-grid"><div class="card" id="cap-levers">${capLeversHtml()}</div><div class="card" id="cap-fin">${capFinHtml()}</div></div>
        <div class="card" id="cap-tax">${capTaxHtml()}</div>
        <div id="cap-filters">${capFiltersHtml()}</div>
      <div id="cap-years">${capYearsHtml()}</div>
        <p class="small muted">This is the version the district published. Moving the levers shows what would change; it doesn’t change the district’s plan.</p>`;
    }
    app.innerHTML = `
      <div class="main">
        <header class="topbar"><span class="brand pub-brand">${LOGO_COLOR}<span class="small muted">powered by Willow Holler</span></span>
          <span class="spacer"></span><a class="btn small" href="#/signin">Sign in</a></header>
        <main class="content">${body}</main>
      </div>`;
  }

  // ------------------------------------------------------------------ sign-in screens
  function authFrame(inner) {
    app.innerHTML = `<div class="auth">
      <aside class="auth-side"><a class="brand auth-brand" href="#/signin">${LOGO_LIGHT}</a>
        <p>Strategy, decisions, capital planning and accountability for Iowa school districts.</p>
        <p class="small">Powered by Willow Holler.</p></aside>
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
  function renderTwoStep() {
    authFrame(`<h1>Two-step sign-in</h1>
      <p>Enter the 6-digit code from your authenticator app.</p>
      <form class="stack" data-form="twoStep">
        <label class="field">Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus></label>
        <button class="btn primary" type="submit">Continue</button></form>
      <div class="links"><a href="#" data-action="signOut">Sign out</a></div>`);
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
    app.innerHTML = `<div class="auth"><aside class="auth-side"><span class="brand auth-brand">${LOGO_LIGHT}</span></aside>
      <main class="auth-main"><div class="auth-card"><h1>Not connected yet</h1>
        <p>This copy of HighGround doesn’t know which database to use.</p>
        <p>Open <b>config.js</b> and fill in the Supabase project address and its <b>publishable</b> key (Supabase: Project Settings, API Keys). Never put the secret key there.</p>
        <p class="small muted">See SETUP.md, step 8.</p></div></main></div>`;
  }
  function renderFatal(err) {
    console.error(err);
    app.innerHTML = `<div class="auth"><aside class="auth-side"><span class="brand auth-brand">${LOGO_LIGHT}</span></aside>
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
    async editSet(el) { openSetEditor(el.dataset.id || null); },
    async starterSets() { await starterSets(); },
    async deleteSet(el) { if (!confirm('Delete this assumption set? Scenarios using it go back to the starting numbers.')) return; await HG.db.remove('assumption_set', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Deleted'); here(); },
    async capView(el) { CAP.view = el.dataset.v; document.getElementById('cap-filters').innerHTML = capFiltersHtml(); document.getElementById('cap-years').innerHTML = capYearsHtml(); },
    async capClearFilters() { CAP.filter = {}; document.getElementById('cap-filters').innerHTML = capFiltersHtml(); document.getElementById('cap-years').innerHTML = capYearsHtml(); },
    async capDownload() { capDownload(); },
    async openScenario(el) { CAP.key = S.district.id; CAP.scenarioId = el.dataset.id; go(`#/d/${enc(S.district.slug)}/resources/capital`); },
    async exportProjects() { await exportProjects(); },
    async exportPhases() { await exportPhases(); },
    async exportBackup() { await exportBackup(); },
    async activityMore(el) { ACT.before = el.dataset.before; const v = document.getElementById('view'); v.innerHTML = await vActivity(ctx()); },
    async resendInvite(el) { const inv = el.closest('tr').querySelector('td').textContent; await sendInvite(el.dataset.id, inv); here(); },
    async approveRequest(el) {
      const role = document.querySelector(`[data-req-role="${el.dataset.id}"]`).value;
      await HG.db.insert('invitation', { district_id: S.district.id, email: el.dataset.email, role });
      await HG.db.update('access_request', `id=eq.${enc(el.dataset.id)}`, { status: 'approved', decided_by: S.user.id, decided_at: new Date().toISOString() });
      toast('Approved', `${el.dataset.email} now has ${ROLE[role].toLowerCase()} access.`); here();
    },
    async declineRequest(el) {
      if (!confirm('Decline this request?')) return;
      await HG.db.update('access_request', `id=eq.${enc(el.dataset.id)}`, { status: 'declined', decided_by: S.user.id, decided_at: new Date().toISOString() });
      toast('Declined'); here();
    },
    async mfaOn() {
      for (const f of ((S.user && S.user.factors) || []).filter((x) => x.status !== 'verified')) { try { await HG.auth.mfa.unenroll(f.id); } catch (e) { /* stale */ } }
      const e = await HG.auth.mfa.enroll();
      const qr = e.totp && e.totp.qr_code ? (String(e.totp.qr_code).startsWith('data:') ? e.totp.qr_code : 'data:image/svg+xml;utf8,' + encodeURIComponent(e.totp.qr_code)) : '';
      modal(`<form class="stack" data-form="mfaConfirm" data-id="${esc(e.id)}">
        <div class="row" style="justify-content:space-between"><h2 id="modal-title">Turn on two-step sign-in</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
        <p>1. In your authenticator app, add an account by scanning this code.</p>
        ${qr ? `<img src="${esc(qr)}" alt="QR code for your authenticator app" width="200" height="200" style="background:#fff;padding:8px;border:1px solid var(--border);border-radius:8px">` : ''}
        <p class="small muted">Can’t scan? Enter this key instead: <code>${esc((e.totp && e.totp.secret) || '')}</code></p>
        <label class="field">2. Enter the 6-digit code it shows<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
        <div class="row"><button type="submit" class="btn primary">Turn it on</button><button type="button" class="btn" data-action="closeModal">Cancel</button></div></form>`);
    },
    async mfaOff(el) {
      if (!confirm('Turn off two-step sign-in? Signing in will need only your password.')) return;
      await HG.auth.mfa.unenroll(el.dataset.id); await loadContext(true); toast('Two-step sign-in is off'); here();
    },
    async editProject(el) { openProjectEditor(el.dataset.id || null); },
    async rankMove(el) { await rankMove(el); },
    async rankScenario() { await rankScenario(); },
    async addFund(el) {
      const cell = el.parentElement.querySelector('[data-srcs]'), used = [...cell.querySelectorAll('[name=src]')].map((x) => x.value);
      if (used.length >= 3) return;
      cell.insertAdjacentHTML('beforeend', fundRowHtml({ b: (FUNDS.find(([k]) => !used.includes(k)) || FUNDS[0])[0], p: null }));
      rebalanceFunds(cell);
    },
    async removeFund(el) { const cell = el.closest('[data-srcs]'); if (cell.querySelectorAll('[data-src]').length <= 1) return; el.closest('[data-src]').remove(); rebalanceFunds(cell); },
    async addToScenario(el) {
      const sid = document.querySelector('[data-addto-sc]').value;
      CAP.key = S.district.id; CAP.scenarioId = sid; CAP.openEditor = el.dataset.id;
      closeModal(); go(`#/d/${enc(S.district.slug)}/resources/capital`);
    },
    async editInitiative(el) { openDecisionEditor(el.dataset.id || null); },
    async iniStatus(el) { INI.status = el.dataset.v; here(); },
    async removeProject(el) { await removeProject(el); },
    async addPhaseRow() { const t = document.querySelector('[data-phase-template]'); document.querySelector('[data-phase-body]').insertAdjacentHTML('beforeend', t.innerHTML); },
    async removePhaseRow(el) { el.closest('[data-phase-row]').remove(); },
    async addYearlyRow() { const t = document.querySelector('[data-yearly-template]'); document.querySelector('[data-yearly-body]').insertAdjacentHTML('beforeend', t.innerHTML); },
    async removeYearlyRow(el) { el.closest('[data-yearly-row]').remove(); },
    async closeModal() { closeModal(); },
    async editFinancing(el) { openFinancingEditor(el.dataset.id || null); },
    async removeFinancing(el) { if (!confirm('Remove this financing from the scenario?')) return; await HG.db.remove('financing', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Removed'); here(); },
    async copyScenario() { await scenarioAction('copy'); },
    async renameScenario() { await scenarioAction('rename'); },
    async lockScenario() { await scenarioAction('lock'); },
    async unlockScenario() { await scenarioAction('unlock'); },
    async makeBoard() { await scenarioAction('board'); },
    async deleteScenario() { await scenarioAction('delete'); },
    async saveLevers() { await saveLevers(); },
    async applyUpload() { await applyUpload(); },
    async cancelUpload() { const f = document.querySelector('[data-upload-file]'); if (f) f.value = ''; document.getElementById('upload-review').innerHTML = ''; UP.parsed = null; },
    async downloadTemplate(el) { if (el.dataset.kind === 'projects') saveText('highground-projects-template.csv', HGUploads.projectTemplate(UP.startFY || 2027)); else saveText('highground-balances-template.csv', HGUploads.balanceTemplate()); },
    async downloadUpload(el) { const b = await HG.storage.download('district-files', el.dataset.path); const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = el.dataset.name || 'upload'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); },
    async publishBoard() { await publishBoard(); },
    async withdrawBoard(el) { await withdrawBoard(el); },
    async addDebtRow() { const t = document.querySelector('[data-debt-template]'); document.querySelector('[data-debt-body]').insertAdjacentHTML('beforeend', t.innerHTML); },
    async removeDebtRow(el) { const f = el.closest('form'); el.closest('[data-debt-row]').remove(); renderSetupChecks(f); },
    async capReset() { if (CAP.pub) { CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers)); const el = document.getElementById('cap-levers'); if (el) el.innerHTML = capLeversHtml(); capRefresh(); } else { capLoadScenario(); here(); } },
    async resetDemo(el) { await resetDemo(el); },
    async loadDemo(el) { await loadDemo(el); },
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
    async saveSet(f, form) { await saveSet(f, form); },
    async twoStep(f) { await HG.auth.mfa.verify(S.mfaFactor, f.code); S.mfaFactor = null; S.loaded = false; document.getElementById('toasts').innerHTML = ''; go('#/'); },
    async mfaConfirm(f, form) { await HG.auth.mfa.verify(form.dataset.id, f.code); closeModal(); await loadContext(true); toast('Two-step sign-in is on', 'From now on you’ll enter a code after your password.'); here(); },
    async requestAccess(f, form) {
      const r = await HG.db.rpc('request_access', { p_slug: f.slug.trim(), p_message: (f.message || '').trim() });
      if (r === 'member') { await loadContext(true); return go('#/'); }
      form.reset(); toast('Request sent', 'If that district uses HighGround, its admins will see your request. You’ll have access as soon as one approves it.');
    },
    async saveProject(f, form) { await saveProject(form); },
    async saveFinancing(f, form) { await saveFinancing(form); },
    async saveSetup(f, form) { await saveSetup(form); },
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
        ...(f.allowed_domains !== undefined ? { allowed_domains: String(f.allowed_domains).split(/[\s,;]+/).map((x) => x.trim().replace(/^@/, '')).filter(Boolean), domain_role: f.domain_role || 'viewer' } : {}),
      });
      await loadContext(true); toast('Saved'); here();
    },
    async invite(f, form) {
      const email = f.email.trim().toLowerCase();
      const [inv] = await HG.db.insert('invitation', { district_id: S.district.id, email, role: f.role });
      form.reset(); await sendInvite(inv.id, email); here();
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
    if (e.target.matches && e.target.matches('[data-modal]')) { closeModal(); return; }
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
  document.addEventListener('input', (e) => {
    const cq = e.target.closest('[data-cap-filter=q]');
    if (cq) { CAP.filter = Object.assign({}, CAP.filter, { q: cq.value }); document.getElementById('cap-years').innerHTML = capYearsHtml(); return; }
    const sf = e.target.closest('form[data-form=saveSetup]');
    if (sf) renderSetupChecks(sf);
    const pc = e.target.closest('[data-srcs] [name=pct]');
    if (pc) {   // with two funds, the other one makes up the rest
      const rows = [...pc.closest('[data-srcs]').querySelectorAll('[name=pct]')], v = toNum(pc.value);
      if (rows.length === 2 && v !== null && !isNaN(v) && v >= 0 && v <= 100) rows.find((x) => x !== pc).value = +(100 - v).toFixed(2);
    }
    const lv = e.target.closest('input[type=range][data-lever]');
    if (lv && CAP.inputs) { CAP.levers[lv.dataset.lever] = Number(lv.value); capRefresh(); }
  });
  document.addEventListener('change', (e) => {
    const lc = e.target.closest('input[type=checkbox][data-lever]');
    if (lc && CAP.inputs) { CAP.levers[lc.dataset.lever] = lc.checked; capRefresh(); return; }
    if (e.target.closest('[data-upload-file]') || (e.target.closest('[data-upload-kind]') && document.querySelector('[data-upload-file]').files.length)) { run(readUpload); return; }
    const cp = e.target.closest('[data-cmp-pick]');
    if (cp) {
      const on = [...document.querySelectorAll('[data-cmp-pick]:checked')].map((x) => x.value);
      if (on.length > 3) { cp.checked = false; toast('Up to three', 'Untick one to add another.', 'notbuilt'); return; }
      if (!on.length) { cp.checked = true; return; }
      CMP.ids = on; document.getElementById('cmp-table').innerHTML = compareTableHtml(); return;
    }
    const rs2 = e.target.closest('[data-rank-sid]');
    if (rs2) { RK.sid = rs2.value; return here(); }
    const rt = e.target.closest('[data-rank-tier]');
    if (rt) { run(async () => { await HG.db.update('initiative', `id=eq.${enc(rt.dataset.rankTier)}`, { tier: rt.value || null, engine_priority: ({ must: 'High', strategic: 'Med', nice: 'Low' })[rt.value] || null }); here(); }, rt); return; }
    const es = e.target.closest('[data-ed-scenario]');
    if (es) { ED.sid = es.value || null; const f = es.closest('form'); f.querySelector('[data-cost-section]').innerHTML = costSectionHtml(f.dataset.id || null); return; }
    const pk = e.target.closest('[data-pick-init]');
    if (pk) { openProjectEditor(pk.value || null); return; }
    const isd = e.target.closest('[data-ini-sid]');
    if (isd) { INI.sid = isd.value; return here(); }
    const it = e.target.closest('[data-ini-type]');
    if (it) { INI.type = it.value; return here(); }
    const wy = e.target.closest('[data-why]');
    if (wy) { CMP[wy.dataset.why] = wy.value; document.getElementById('cmp-why').innerHTML = whyHtml(); return; }
    const cset = e.target.closest('[data-cap-set]');
    if (cset) {
      const name = cset.value ? cset.options[cset.selectedIndex].text : 'the starting numbers';
      if (!confirm(`Use ${name} for “${CAP.sc.name}”? Its levers will follow ${cset.value ? 'the set' : 'the starting numbers'} (any levers saved on this scenario are cleared).`)) { cset.value = CAP.inputs.set ? CAP.inputs.set.id : ''; return; }
      run(async () => {
        await HG.db.update('scenario', `id=eq.${CAP.scenarioId}`, { assumption_set_id: cset.value || null, lever_ppel_growth: null, lever_grant_yield: null, lever_save_trend: null, lever_inflation: null });
        toast('Assumptions changed', `“${CAP.sc.name}” now uses ${name}.`); here();
      }, cset);
      return;
    }
    const cf = e.target.closest('select[data-cap-filter]');   // the search box updates as you type, not on change
    if (cf) { CAP.filter = Object.assign({}, CAP.filter, { [cf.dataset.capFilter]: cf.value }); document.getElementById('cap-years').innerHTML = capYearsHtml(); return; }
    const cs = e.target.closest('[data-cap-scenario]');
    if (cs) { CAP.scenarioId = cs.value; return here(); }
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
