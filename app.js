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
      HG.db.select('district_member', `select=role,district:district_id(id,slug,name,short_name,state,county,brand_color,logo_path,is_demo,public_link_enabled)&user_id=eq.${enc(u.id)}`),
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
      S.landing = true;
      return go(`#/d/${enc(first.slug)}/${homePath(roleIn(first))}`, flash);
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
      { id: 'today', label: 'Today', status: 'live', lede: 'How the district is doing, and what needs attention.', render: vOverview },
    ] },
    { id: 'direction', label: 'Direction', tabs: [
      { id: 'priorities', label: 'Priorities', status: 'live', lede: 'The strategic plan: priorities and the outcomes behind them.', render: vPriorities },
      { id: 'measures', label: 'Measures', status: 'live', lede: 'How each outcome is measured, and its results over time.', render: vMeasures },
      { id: 'community', label: 'Community', status: 'live', lede: 'What the community told us, and where it shows up in the plan.', render: vCommunity },
    ] },
    { id: 'decisions', label: 'Decisions', tabs: [
      { id: 'initiatives', label: 'All initiatives', status: 'live', lede: 'Everything that costs money: projects, programs, hires.', render: vInitiatives },
      { id: 'ranking', label: 'Ranking & funding line', status: 'live', lede: 'Force-rank initiatives and see where the money runs out.', render: vRanking },
      { id: 'scenarios', label: 'Scenarios', status: 'live', lede: 'Different ways to pay for the plan, side by side.', render: vScenarios },
    ] },
    { id: 'resources', label: 'Resources', tabs: [
      { id: 'summary', label: 'Funds', status: 'live', lede: 'Every fund at a glance, from the board version.', render: vResSummary },
      { id: 'general', label: 'General fund', status: 'live', lede: 'Five-year General Fund forecast: solvency, spending authority and settlements.', render: vGeneralFund },
      { id: 'capital', label: 'Capital plan', status: 'live', lede: 'Projects by year, split across Iowa’s capital funds, with the gap to close.', render: vCapital },
    ] },
    { id: 'progress', label: 'Progress', tabs: [
      { id: 'initiatives', label: 'Initiatives', status: 'live', lede: 'Each initiative against the adopted plan: spending, phases and dates.', render: vProgInitiatives },
      { id: 'actuals', label: 'Budget vs. actual', status: 'live', lede: 'Each fund’s budget, actual and year-end forecast, from the monthly ledger.', render: vActuals },
      { id: 'uploads', label: 'Uploads', status: 'live', lede: 'Every file brought in, and what happened to it.', render: vUploads },
    ] },
    { id: 'reports', label: 'Reports', tabs: [
      { id: 'board', label: 'Board reports', status: 'live', lede: 'Monthly board report, capital summary, decision packets.', render: vBoardReports },
      { id: 'community', label: 'Community page', status: 'live', lede: 'What the public link shows.', render: vCommunityPage },
    ] },
  ];
  const FOOT = [
    { id: 'settings', label: 'Settings', tabs: [
      { id: 'district', label: 'District', status: 'live', lede: 'Name, link and look, and the numbers the plan starts from.', render: vDistrict },
      { id: 'setup', label: 'Starting numbers', status: 'live', lede: 'What the capital plan starts from: receipts, balances and existing debt.', render: vSetup },
      { id: 'people', label: 'People', status: 'live', lede: 'Who can see and change this district.', render: vPeople },
      { id: 'activity', label: 'Activity', status: 'live', lede: 'Every change: who, when, and what it was before.', render: vActivity },
      { id: 'assumptions', label: 'Assumption sets', status: 'live', lede: 'Base, Conservative and Growth: the world the plan has to survive.', render: vAssumptions },
      { id: 'exports', label: 'Exports', status: 'live', lede: 'Download the district’s data, for spreadsheets or backup.', render: vExports },
      { id: 'account', label: 'Your account', status: 'live', lede: 'Your name, password and sign-in security.', render: vAccount },
    ] },
    { id: 'help', label: 'Help', tabs: [
      { id: 'guide', label: 'Guide', status: 'live', lede: 'How to do the common things, and what the terms mean.', render: vGuide },
      { id: 'built', label: 'What’s built', status: 'live', lede: 'Every screen, and whether it works yet (Willow Holler staff).', render: vBuilt },
    ] },
  ];
  const ALL = [...SECTIONS, ...FOOT];

  // ------------------------------------------------------------------ frame
  /* ---- each screen leads with the answer: a sentence it sets while rendering, shown at the top ---- */
  const PAGE = { lead: null };
  const setLead = (html) => { PAGE.lead = html; };
  /** a section folded behind a summary line: open for people who edit, closed for board members and viewers */
  const fold = (c, title, html, startOpen) => (html ? `<details class="fold" ${startOpen != null ? (startOpen ? 'open' : '') : (c.plan || c.finance ? 'open' : '')}><summary>${title}</summary><div class="stack">${html}</div></details>` : '');
  /** screens that moved in the simplification; old links still work */
  const MOVED = { 'resources/funds': 'resources/summary', 'progress/measures': 'direction/measures', 'resources/assumptions': 'settings/assumptions', 'reports/exports': 'settings/exports' };

  /* ---- what each role sees in the menu (permissions are unchanged; a direct link still opens) ---- */
  const BOARD_VIEW = { overview: ['today'], direction: ['priorities', 'measures'], resources: ['summary', 'general', 'capital'], reports: ['board', 'community'], settings: ['account'], help: ['guide'] };
  const LEAD_VIEW = { overview: ['today'], direction: null, decisions: null, resources: ['summary', 'general', 'capital'], progress: ['initiatives', 'actuals', 'uploads'],
    reports: ['board', 'community'], settings: ['assumptions', 'account'], help: ['guide'] };
  const FINANCE_VIEW = { overview: ['today'], direction: ['measures'], progress: ['uploads', 'actuals', 'initiatives'], resources: ['summary', 'general', 'capital'], reports: ['board'],
    settings: ['setup', 'exports', 'account'], help: ['guide'] };
  const VIEWS = { board: BOARD_VIEW, viewer: BOARD_VIEW, superintendent: LEAD_VIEW, editor: LEAD_VIEW, business_manager: FINANCE_VIEW };
  const showAllKey = () => `highground-show-all-${(S.user && S.user.id) || ''}`;
  function showAll() { try { return localStorage.getItem(showAllKey()) === '1'; } catch (e) { return false; } }
  function visibleTabs(section) {
    const tabs = section.tabs.filter((t) => t.id !== 'built' || S.isStaff);   // “What’s built” is for Willow Holler staff
    const v = VIEWS[S.role];
    if (S.isStaff || S.role === 'admin' || !v || showAll()) return tabs;
    if (!(section.id in v)) return [];
    const want = v[section.id];
    return want === null ? tabs : want.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
  }
  /** where each role starts: board members and viewers on the latest board report */
  const homePath = (role) => (['board', 'viewer'].includes(role) ? 'reports/board' : 'overview/today');
  function frame({ slug, sectionId, body }) {
    const d = S.district;
    const navLink = (s) => { const vt = visibleTabs(s); if (!vt.length) return ''; return `<a href="#/d/${enc(slug)}/${s.id}/${vt[0].id}" ${s.id === sectionId ? 'aria-current="page"' : ''}>${esc(s.label)}${s.tabs.every((t) => t.status === 'wip') ? '<span class="dot" title="Not built yet"></span>' : ''}</a>`; };
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
            ${slug ? '<button type="button" class="btn small" data-action="openSearch" aria-label="Search this district">Search</button>' : ''}
            <span class="spacer"></span>
            ${S.districts.length ? `<label class="chip">${d ? (d.logo_path ? `<span class="tile logo"><img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt=""></span>` : `<span class="tile" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>`) : ''}
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
    if (MOVED[`${sectionId}/${tabId}`]) return go(`#/d/${enc(slug)}/${MOVED[`${sectionId}/${tabId}`]}`);
    try { localStorage.setItem('highground-last-district', d.slug); } catch (e) {}
    const section = ALL.find((s) => s.id === sectionId) || SECTIONS[0];
    const tab = section.tabs.find((t) => t.id === tabId) || section.tabs[0];
    const shown = visibleTabs(section), barTabs = shown.some((t) => t.id === tab.id) ? shown : shown.concat([tab]);
    const tabs = barTabs.length > 1
      ? `<nav class="tabs" aria-label="${esc(section.label)}">${barTabs.map((t) => `<a href="#/d/${enc(slug)}/${section.id}/${t.id}" ${t.id === tab.id ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>` : '';
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
    PAGE.lead = null;
    try { const html = await tab.render(ctx()); view.innerHTML = (PAGE.lead ? `<p class="lead">${PAGE.lead}</p>` : '') + html; }
    catch (err) {
      view.innerHTML = `<div class="notice error">${esc(err instanceof HG.NotBuiltError ? err.message : 'This screen couldn’t load: ' + (err.message || err))}</div>`;
      if (!(err instanceof HG.NotBuiltError)) console.error(err);
    }
  }

  // ------------------------------------------------------------------ views: Overview
  async function vOverview(c) {
    const d = c.district, D = await loadDirection(d), rows = D.rows, f = HGReport.fmt;
    const [batches, mem, acts, latestRep] = await Promise.all([
      HG.db.select('import_batch', `select=id,kind,status,uploaded_at,period_end&district_id=eq.${d.id}&order=uploaded_at.desc&limit=50`).catch(() => []),
      HG.db.select('district_member', `select=user_id&district_id=eq.${d.id}`).catch(() => []),
      c.admin ? HG.db.select('audit_log', `select=table_name,action,actor,at,new_row,old_row&district_id=eq.${d.id}&order=at.desc&limit=8`).catch(() => []) : Promise.resolve([]),
      HG.db.select('report_snapshot', `select=id,period_end,title&district_id=eq.${d.id}&kind=eq.board_monthly&order=period_end.desc&limit=1`).catch(() => []),
    ]);
    const board = rows.scenarios.find((x) => x.is_board_version);
    let gap = null;
    if (board && rows.settings) { const bi = HGCapital.buildInputs(rows, board.id); gap = HGEngine.compute(bi.projects, bi.levers, bi.cfg).gap; }
    const lastBal = (fund) => (D.balances || []).filter((b) => b.fund === fund).sort((x, y) => (x.as_of < y.as_of ? 1 : -1))[0] || null;
    const gl = batches.filter((b) => b.kind === 'gl_monthly' && b.status === 'applied' && b.period_end).sort((x, y) => (x.period_end < y.period_end ? 1 : -1))[0] || null;
    const ms = D.measures.map((m) => ({ m, x: D.st.get(m.id) })), on = ms.filter((y) => y.x.state === 'ontrack' || y.x.state === 'met').length;
    const off = ms.filter((y) => y.x.state === 'offtrack'), owed = ms.filter((y) => y.x.owed);
    const pending = rows.initiatives.filter((i) => ['idea', 'proposed', 'analysis'].includes(i.status || 'proposed'));
    const inBoard = (id) => board && (rows.phases.some((p) => p.scenario_id === board.id && p.initiative_id === id) || (rows.recurring || []).some((r) => r.scenario_id === board.id && r.initiative_id === id));
    const approvedOut = rows.initiatives.filter((i) => ['approved', 'underway'].includes(i.status) && board && !inBoard(i.id));
    const link = (path, text) => `<a href="#/d/${enc(d.slug)}/${path}">${text}</a>`;
    const tile = (label, value, sub) => `<div class="card tile-card"><div class="small muted">${label}</div><div class="stat">${value}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    const attention = [
      ...off.map((y) => `${esc(y.m.name)} is off track (${link('direction/measures', 'measures')}).`),
      owed.length ? `${owed.length} measure${owed.length === 1 ? ' has' : 's have'} an update owed (${link('direction/measures', 'record results')}).` : '',
      ...approvedOut.map((i) => `${esc(i.name)} is approved but not in the board version (${link('decisions/initiatives', 'decisions')}).`),
      !board && rows.scenarios.length ? `No scenario is the board version yet (${link('resources/capital', 'capital plan')}).` : '',
      !rows.settings ? `Starting numbers aren’t set up yet (${link('settings/setup', 'starting numbers')}).` : '',
    ].filter(Boolean);
    const sb = lastBal('save'), pb = lastBal('ppel');
    setLead((gap == null ? '' : gap > 0.5 ? `The board version is <b>${f(gap)}</b> short. ` : 'The board version is fully paid for. ')
      + (attention.length ? `<b>${attention.length}</b> thing${attention.length === 1 ? ' needs' : 's need'} attention.` : 'Nothing needs attention right now.'));
    return `
      ${ledgerNote(c, batches)}
      <div class="grid tiles">
        ${tile('Gap to close ' + def('gap'), gap == null ? '—' : f(gap), board ? esc(board.name) : 'no board version yet')}
        ${tile('SAVE balance ' + def('save'), sb ? f(Number(sb.amount)) : '—', sb ? 'as of ' + esc(day(sb.as_of)) : '')}
        ${tile('PPEL balance ' + def('ppel'), pb ? f(Number(pb.amount)) : '—', pb ? 'as of ' + esc(day(pb.as_of)) : '')}
        ${tile('Ledger', gl ? 'Through ' + esc(day(gl.period_end).replace(/, \d{4}$/, '')) : 'None yet', gl ? 'monthly GL' : (c.finance ? link('progress/uploads', 'upload the month-end export') : ''))}
        ${tile('Measures on track ' + def('measure_status'), D.measures.length ? `${on} of ${D.measures.length}` : '—', D.measures.length ? `${off.length} off track` : link('direction/measures', 'add measures'))}
        ${tile('Decisions ahead', pending.length, pending.length ? 'not yet approved' : '')}
        ${tile('Latest board report', latestRep[0] ? esc(day(latestRep[0].period_end).replace(/, \d{4}$/, '')) : 'None yet', latestRep[0] ? link('reports/board', 'open reports') : link('reports/board', 'create one'))}
        ${tile('People with access', mem.length, `${rows.initiatives.length} initiatives · ${rows.scenarios.length} scenarios`)}
      </div>
      <div class="card"><h3>Needs attention</h3>${attention.length ? `<ul>${attention.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="ok">Nothing needs attention right now.</p>'}</div>
      ${D.priorities.length ? `<div class="card"><h3>The strategic plan</h3><table class="data"><tbody>${D.priorities.map((p) => { const pm = ms.filter((y) => y.m.priority_id === p.id), pon = pm.filter((y) => ['ontrack', 'met'].includes(y.x.state)).length;
        return `<tr><td>${esc(p.name)}</td><td>${pm.length ? `${pon} of ${pm.length} measures on track` : '<span class="muted">no measures yet</span>'}</td><td class="small">${(() => { const n = rows.initiatives.filter((i) => i.priority_id === p.id).length; return `${n} initiative${n === 1 ? '' : 's'}`; })()}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
      ${c.admin && acts.length ? `<div class="card"><h3>Recent changes</h3><ul>${acts.map((a2) => { const x = a2.new_row || a2.old_row || {}; return `<li>${esc(TABLE_NAMES[a2.table_name] || a2.table_name)}${x.name ? ': ' + esc(x.name) : ''} <span class="small muted">· ${a2.action === 'insert' ? 'added' : a2.action === 'delete' ? 'removed' : 'changed'} ${esc(day(a2.at))}</span></li>`; }).join('')}</ul>
        <p class="small">${link('settings/activity', 'All activity')}</p></div>` : ''}`;
  }


  // ------------------------------------------------------------------ views: Direction
  /* ---- search: initiatives, priorities, measures, scenarios and reports in this district ---- */
  const SRCH = { key: null, items: [] };
  async function openSearch() {
    const d = S.district;
    {   // rebuilt every time, so something added a moment ago is found
      const D = await loadDirection(d), reps = await HG.db.select('report_snapshot', `select=id,kind,title,period_end&district_id=eq.${d.id}&order=period_end.desc&limit=50`).catch(() => []);
      SRCH.items = [].concat(
        D.rows.initiatives.map((i) => ({ k: 'initiative', id: i.id, name: i.name, what: 'Initiative' })),
        D.priorities.map((p) => ({ k: 'priority', id: p.id, name: p.name, what: 'Priority' })),
        D.measures.map((m) => ({ k: 'measure', id: m.id, name: m.name, what: 'Measure' })),
        D.rows.scenarios.map((x) => ({ k: 'scenario', id: x.id, name: x.name, what: x.is_board_version ? 'Scenario · board version' : 'Scenario' })),
        reps.map((r) => ({ k: 'report', id: r.id, name: r.title || 'Report', what: r.kind === 'decision_packet' ? 'Decision packet' : 'Board report' })));
      SRCH.key = d.id;
    }
    modal(`<div class="stack"><div class="row" style="justify-content:space-between"><h2 id="modal-title">Search ${esc(d.short_name || d.name)}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <input type="search" data-search placeholder="Initiatives, priorities, measures, scenarios, reports" aria-label="Search" style="height:42px;border:1px solid var(--border);border-radius:8px;padding:0 12px;font:inherit">
      <div data-search-results>${searchResults('')}</div></div>`);
    setTimeout(() => { const el = document.querySelector('[data-search]'); if (el) el.focus(); }, 0);
  }
  function searchResults(q) {
    const t = q.trim().toLowerCase();
    if (!t) return '<p class="small muted">Start typing.</p>';
    const hits = SRCH.items.filter((x) => x.name.toLowerCase().includes(t)).slice(0, 15);
    return hits.length ? `<ul class="srch">${hits.map((x) => `<li><a href="#" data-action="searchGo" data-k="${x.k}" data-id="${esc(x.id)}">${esc(x.name)}</a> <span class="small muted">· ${esc(x.what)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing matches.</p>';
  }

  /* ---- the strategic plan: priorities, outcomes, measures ---- */
  async function loadDirection(d) {
    const rows = await loadCapitalRows(d), q = (t, extra) => HG.db.selectAll(t, `select=*&district_id=eq.${d.id}${extra || ''}`).catch(() => []);
    const [outcomes, measures, values, surveys, results, balances, reports] = await Promise.all([q('outcome', '&order=position'), q('measure', '&order=name'), q('measure_value'),
      q('survey', '&order=closed_on.desc.nullslast,created_at.desc'), q('survey_result', '&order=position'), q('fund_balance'),
      HG.db.select('report_snapshot', `select=period_end,payload->plan&district_id=eq.${d.id}&kind=eq.board_monthly&order=period_end`).catch(() => [])]);
    const priorities = (rows.priorities || []).slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    // automatic measures: values worked out from HighGround's own data, never typed in
    const board = rows.scenarios.find((x) => x.is_board_version);
    let auto = { phases: [], balances, reports: reports.map((r) => ({ period_end: r.period_end, payload: { plan: r.plan } })), inflation: 0, startFY: null };
    if (board && rows.settings) { const bi = HGCapital.buildInputs(rows, board.id); auto = Object.assign(auto, { phases: rows.phases.filter((p) => p.scenario_id === board.id), inflation: bi.levers.infl, startFY: bi.cfg.start }); }
    const valuesOf = (m) => (m.auto_metric ? HGDirection.autoValues(m.auto_metric, auto) : values.filter((v) => v.measure_id === m.id));
    const st = new Map(measures.map((m) => { const x = HGDirection.status(m, valuesOf(m)); if (m.auto_metric) x.owed = false; return [m.id, x]; }));
    return { rows, priorities, outcomes, measures, values, st, surveys, results, balances, reports };
  }
  const STATE_CLASS = { met: 'st-done', ontrack: 'st-approved', offtrack: 'st-declined-red', tracking: 'st-proposed', nodata: 'st-proposed' };
  const stateBadge = (x) => `<span class="st ${STATE_CLASS[x.state]}">${HGDirection.STATE_NAME[x.state]}</span>${x.owed ? ' <span class="st st-owed">Update owed</span>' : ''}`;
  const mVal = (m, v) => {
    if (v == null) return '';
    const n = Number(v), num = n.toLocaleString('en-US', { maximumFractionDigits: 2 }), u = m.unit || '';
    if (u === '%') return num + '%';
    if (u === '$') return '$' + num;
    return u ? `${num} ${n === 1 && /s$/.test(u) ? u.slice(0, -1) : u}` : num;   // 1 building, 3 buildings
  };
  function spark(m, x) {
    const v = x.values; if (v.length < 2) return '';
    const ys = v.map((p) => p.value).concat(m.target_value != null ? [Number(m.target_value)] : []), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const W = 110, H = 28, X = (i) => 2 + (i / (v.length - 1)) * (W - 4), Y = (y) => H - 3 - ((y - lo) / span) * (H - 6);
    const pts = v.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const tgt = m.target_value != null ? `<line x1="0" x2="${W}" y1="${Y(Number(m.target_value)).toFixed(1)}" y2="${Y(Number(m.target_value)).toFixed(1)}" stroke="#C9A24A" stroke-dasharray="3 3"/>` : '';
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend for ${esc(m.name)}">${tgt}<polyline fill="none" stroke="#2F6B4F" stroke-width="2" points="${pts}"/><circle cx="${X(v.length - 1).toFixed(1)}" cy="${Y(v[v.length - 1].value).toFixed(1)}" r="2.6" fill="#2F6B4F"/></svg>`;
  }

  async function vPriorities(c) {
    const D = await loadDirection(c.district); DIR.D = D;
    const rows = D.rows, board = rows.scenarios.find((x) => x.is_board_version);
    const costOf = (id) => (board ? rows.phases.filter((p) => p.scenario_id === board.id && p.initiative_id === id).reduce((t, p) => t + Number(p.cost), 0) : 0);
    const STATUS = Object.fromEntries(INIT_STATUS), f = HGReport.fmt;
    const unlinked = rows.initiatives.filter((i) => !i.priority_id && !['declined', 'deferred'].includes(i.status)).length;
    if (D.priorities.length) { const linked = rows.initiatives.filter((i) => i.priority_id).length;
      setLead(`${D.priorities.length} priorit${D.priorities.length === 1 ? 'y' : 'ies'}, served by <b>${linked}</b> initiative${linked === 1 ? '' : 's'}${unlinked ? `; ${unlinked} not linked to a priority yet` : ''}.`); }
    if (!D.priorities.length) return `<div class="card"><h3>No priorities yet</h3><p>Start with the strategic plan’s priorities: the few things the district most wants to achieve. Each gets outcomes and measures, and initiatives link to the priority they serve.</p>
      ${c.plan ? '<div class="row"><button type="button" class="btn primary" data-action="editPriority" data-id="">Add a priority</button><label class="btn">Upload goals<input type="file" data-dir-upload="goals" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="goals">template</a></div>' : ''}<div id="dir-upload"></div></div>`;
    return `<div id="dir-upload"></div>
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editPriority" data-id="">Add a priority</button>' : ''}
        <a class="btn" href="#/d/${enc(c.district.slug)}/direction/measures">Measures</a>
        ${c.plan ? '<label class="btn">Upload goals<input type="file" data-dir-upload="goals" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="goals">template</a>' : ''}
        ${unlinked ? `<span class="small muted">${unlinked} initiative${unlinked === 1 ? ' isn’t' : 's aren’t'} linked to a priority yet. <a href="#/d/${enc(c.district.slug)}/decisions/initiatives">Link them on Decisions</a>.</span>` : ''}</div>
      ${D.priorities.map((pr, k) => {
        const outs = D.outcomes.filter((o) => o.priority_id === pr.id), ms = D.measures.filter((m) => m.priority_id === pr.id), inits = rows.initiatives.filter((i) => i.priority_id === pr.id);
        return `<div class="card prio"><div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><div class="small muted">Priority ${k + 1}</div><h3 style="margin:2px 0">${esc(pr.name)}</h3>${pr.statement ? `<p>${esc(pr.statement)}</p>` : ''}
            ${(() => { const sv = D.surveys[0], imp = sv && D.results.find((r) => r.survey_id === sv.id && r.kind === 'importance' && r.priority_id === pr.id && r.value != null);
              return imp ? `<div class="small">Community importance: <b>${Number(imp.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>${Number(imp.value) <= 5 ? ' out of 5' : ''} <span class="muted">· ${esc(sv.name)}</span></div>` : ''; })()}</div>
          ${c.plan ? `<div class="row moves"><button type="button" class="btn small" data-action="prioMove" data-id="${esc(pr.id)}" data-d="-1" ${k ? '' : 'disabled'} aria-label="Move up">▲</button><button type="button" class="btn small" data-action="prioMove" data-id="${esc(pr.id)}" data-d="1" ${k < D.priorities.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button><button type="button" class="btn small" data-action="editPriority" data-id="${esc(pr.id)}">Edit</button></div>` : ''}</div>
          <div class="pgrid">
            <div><div class="small muted">Outcomes</div>${outs.length ? `<ul>${outs.map((o) => `<li>${esc(o.name)}</li>`).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</div>
            <div><div class="small muted">Measures</div>${ms.length ? `<ul>${ms.map((m) => `<li>${esc(m.name)} ${stateBadge(D.st.get(m.id))}</li>`).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</div>
            <div><div class="small muted">Initiatives serving it</div>${inits.length ? `<ul>${inits.map((i) => `<li>${esc(i.name)} <span class="small muted">· ${esc(STATUS[i.status || 'proposed'])}${costOf(i.id) ? ' · ' + f(costOf(i.id)) : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">None linked.</p>'}</div>
          </div></div>`; }).join('')}`;
  }
  const DIR = { D: null };
  function openPriorityEditor(id) {
    const D = DIR.D, pr = id ? D.priorities.find((x) => x.id === id) : { name: '', statement: '' };
    const outs = id ? D.outcomes.filter((o) => o.priority_id === id) : [];
    modal(`<form class="stack" data-form="savePriority" data-id="${esc(id || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${id ? 'Edit priority' : 'Add a priority'}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <label class="field">Priority<input name="name" maxlength="120" value="${esc(pr.name)}" required placeholder="Every graduate ready for what’s next"></label>
      <label class="field">What it means <span class="small muted">(optional)</span><textarea name="statement" maxlength="600">${esc(pr.statement || '')}</textarea></label>
      <div class="field"><span>Outcomes <span class="small muted">(one per line; the results that would show this priority is being achieved)</span></span>
        <textarea name="outcomes" rows="4" placeholder="Graduation and readiness&#10;Career and technical pathways">${esc(outs.map((o) => o.name).join('\n'))}</textarea></div>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${id ? `<span style="flex:1"></span><button type="button" class="btn danger" data-action="deletePriority" data-id="${esc(id)}">Delete</button>` : ''}</div></form>`);
  }
  async function savePriority(f, form) {
    const D = DIR.D, d = S.district.id, name = (f.name || '').trim(), box = form.querySelector('[data-form-errors]');
    if (!name) { box.hidden = false; box.textContent = 'Name the priority.'; return; }
    let id = form.dataset.id;
    if (id) await HG.db.update('priority', `id=eq.${enc(id)}`, { name: name.slice(0, 120), statement: (f.statement || '').trim() || null });
    else { id = crypto.randomUUID(); await HG.db.insert('priority', { id, district_id: d, name: name.slice(0, 120), statement: (f.statement || '').trim() || null, position: D.priorities.length + 1 }); }
    // outcomes: keep those still listed (by name), add new ones, remove the rest
    const want = String(f.outcomes || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12);
    const have = D.outcomes.filter((o) => o.priority_id === id);
    for (const o of have) if (!want.includes(o.name)) await HG.db.remove('outcome', `id=eq.${enc(o.id)}`);
    const add = want.filter((w) => !have.some((o) => o.name === w));
    if (add.length) await HG.db.insert('outcome', add.map((w) => ({ district_id: d, priority_id: id, name: w.slice(0, 200), position: want.indexOf(w) + 1 })));
    closeModal(); toast('Saved', name); here();
  }

  async function vMeasures(c) {
    const D = await loadDirection(c.district); DIR.D = D;
    if (!D.priorities.length) return `<div class="card"><h3>Add priorities first</h3><p>Measures sit under a priority (and optionally one of its outcomes).</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/direction/priorities">Priorities</a></div>`;
    const CAD = { monthly: 'Monthly', quarterly: 'Quarterly', semester: 'Each semester', annual: 'Yearly' };
    const counts = { met: 0, ontrack: 0, offtrack: 0, owed: 0 };
    D.measures.forEach((m) => { const x = D.st.get(m.id); if (counts[x.state] != null) counts[x.state]++; if (x.owed) counts.owed++; });
    const canRec = c.plan || c.finance, offNames = D.measures.filter((m) => D.st.get(m.id).state === 'offtrack').map((m) => esc(m.name));
    setLead(D.measures.length ? `<b>${counts.met + counts.ontrack} of ${D.measures.length}</b> measures are on track or met${offNames.length ? `; off track: ${offNames.join(', ')}` : ''}.` : 'No measures yet.');
    const owed = D.measures.filter((m) => D.st.get(m.id).owed), byOwner = {};
    owed.forEach((m) => { (byOwner[m.owner_name || 'No owner'] = byOwner[m.owner_name || 'No owner'] || []).push(m); });
    return `
      ${owed.length ? `<div class="card"><h3>Updates owed</h3>${Object.entries(byOwner).map(([o, list]) => `<p><b>${esc(o)}</b>: ${list.map((m) => `${esc(m.name)} <span class="small muted">(due ${esc(day(D.st.get(m.id).due))})</span>`).join(', ')}</p>`).join('')}</div>` : ''}
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editMeasure" data-id="">Add a measure</button>' : ''}
        ${canRec ? '<label class="btn">Upload results<input type="file" data-dir-upload="results" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="results">template</a>' : ''}

        <span class="small muted">${D.measures.length} measure${D.measures.length === 1 ? '' : 's'}: ${counts.met} met, ${counts.ontrack} on track, ${counts.offtrack} off track${counts.owed ? `, ${counts.owed} with an update owed` : ''}.</span></div>
      ${D.priorities.map((pr) => { const ms = D.measures.filter((m) => m.priority_id === pr.id); const outs = new Map(D.outcomes.map((o) => [o.id, o.name]));
        return `<div class="card"><h3>${esc(pr.name)}</h3>${ms.length ? `<div class="scroll"><table class="data"><thead><tr><th>Measure</th><th>Start → target</th><th>Latest</th><th>Status</th><th>Toward target</th><th>Owner</th><th>Updates</th><th></th></tr></thead><tbody>
          ${ms.map((m) => { const x = D.st.get(m.id); return `<tr><td>${esc(m.name)}${m.outcome_id ? `<br><span class="small muted">${esc(outs.get(m.outcome_id) || '')}</span>` : ''}</td>
            <td>${mVal(m, m.baseline_value)} <span class="small muted">${esc(m.baseline_period || '')}</span> → <b>${mVal(m, m.target_value)}</b> <span class="small muted">${esc(m.target_period || '')}</span>${m.better === 'down' ? '<br><span class="small muted">lower is better</span>' : ''}</td>
            <td>${x.latest ? `${mVal(m, x.latest.value)} <span class="small muted">${esc(x.latest.period)}</span>` : ''} ${spark(m, x)}</td>
            <td>${stateBadge(x)}</td>
            <td>${x.progress != null ? `<span class="ubar"><i style="width:${(x.progress * 100).toFixed(0)}%"></i></span> <span class="small muted">${Math.round(x.progress * 100)}%</span>` : ''}</td>
            <td>${esc(m.owner_name || '')}</td><td class="small">${m.auto_metric ? '<span class="st st-approved">Updates itself</span>' : `${esc(CAD[m.cadence] || '')}${x.due ? `<br><span class="muted">next by ${esc(day(x.due))}</span>` : ''}`}</td>
            <td class="nowrap">${canRec && !m.auto_metric ? `<button type="button" class="btn small" data-action="recordResult" data-id="${esc(m.id)}">Record</button>` : ''} ${c.plan ? `<a href="#" data-action="editMeasure" data-id="${esc(m.id)}">Edit</a>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">No measures yet.</p>'}</div>`; }).join('')}
      <div id="dir-upload"></div>
      <p class="small muted">On track: at or ahead of a straight path from the starting point to the target. Update owed: no result within the measure’s cadence, plus a month. Saving a result for a period that already has one replaces it.</p>`;
  }
  function openMeasureEditor(id) {
    const D = DIR.D, m = id ? D.measures.find((x) => x.id === id) : { better: 'up', cadence: 'annual', is_public: true, priority_id: D.priorities[0].id };
    const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${v === k ? 'selected' : ''}>${esc(t)}</option>`).join('');
    modal(`<form class="stack" data-form="saveMeasure" data-id="${esc(id || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${id ? 'Edit measure' : 'Add a measure'}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <div class="fgrid">
        <label class="field">How it’s updated<select name="auto_metric" data-me-auto><option value="">Results typed in or uploaded</option>${Object.entries(HGDirection.AUTO).map(([k, a]) => `<option value="${k}" ${m.auto_metric === k ? 'selected' : ''}>Automatically: ${esc(a.name)}</option>`).join('')}</select></label>
        <label class="field">Measure<input name="name" maxlength="160" value="${esc(m.name || '')}" required placeholder="Four-year graduation rate"></label>
        <label class="field">Priority<select name="priority_id" data-me-prio>${opt(D.priorities.map((p) => [p.id, p.name]), m.priority_id)}</select></label>
        <label class="field">Outcome <span class="small muted">(optional)</span><select name="outcome_id"><option value="">None</option>${opt(D.outcomes.filter((o) => o.priority_id === m.priority_id).map((o) => [o.id, o.name]), m.outcome_id)}</select></label>
        <label class="field">Unit<input name="unit" maxlength="20" value="${esc(m.unit || '')}" placeholder="%, $, students, days"></label>
        <label class="field">Better is<select name="better">${opt([['up', 'Higher'], ['down', 'Lower']], m.better === 'down' ? 'down' : 'up')}</select></label>
        <label class="field">Starting point<input name="baseline_value" inputmode="decimal" value="${m.baseline_value == null ? '' : m.baseline_value}"></label>
        <label class="field">…in<input name="baseline_period" maxlength="20" value="${esc(m.baseline_period || '')}" placeholder="2024-25"></label>
        <label class="field">Target<input name="target_value" inputmode="decimal" value="${m.target_value == null ? '' : m.target_value}"></label>
        <label class="field">…by<input name="target_period" maxlength="20" value="${esc(m.target_period || '')}" placeholder="2028-29"></label>
        <label class="field">Owner<input name="owner_name" maxlength="80" value="${esc(m.owner_name || '')}" placeholder="Name or role"></label>
        <label class="field">Updated<select name="cadence">${opt([['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semester', 'Each semester'], ['annual', 'Yearly']], m.cadence || 'annual')}</select></label>
        <label class="row" style="align-self:end"><input type="checkbox" name="is_public" ${m.is_public !== false ? 'checked' : ''}> Can appear on the community page</label>
      </div>
      <p class="small muted">Periods can be written as a school year (2025-26), a fiscal year (FY2027), a month (2026-09) or a year (2026).</p>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${id ? `<span style="flex:1"></span><button type="button" class="btn danger" data-action="deleteMeasure" data-id="${esc(id)}">Delete</button>` : ''}</div></form>`);
  }
  async function saveMeasure(f, form) {
    const box = form.querySelector('[data-form-errors]'), errs = [], num = (v) => (String(v || '').trim() === '' ? null : toNum(v));
    const auto = f.auto_metric || null;
    const row = { auto_metric: auto, source: auto ? HGDirection.AUTO[auto].source : 'manual', name: (f.name || '').trim().slice(0, 160), priority_id: f.priority_id, outcome_id: f.outcome_id || null, unit: (f.unit || '').trim() || null, better: f.better,
      baseline_value: num(f.baseline_value), baseline_period: (f.baseline_period || '').trim() || null, target_value: num(f.target_value), target_period: (f.target_period || '').trim() || null,
      owner_name: (f.owner_name || '').trim() || null, cadence: f.cadence, is_public: !!f.is_public };
    if (!row.name) errs.push('Name the measure.');
    ['baseline_value', 'target_value'].forEach((k) => { if (row[k] != null && isNaN(row[k])) errs.push(`${k === 'baseline_value' ? 'Starting point' : 'Target'} must be a number.`); });
    ['baseline_period', 'target_period'].forEach((k) => { if (row[k] && !HGDirection.periodEnd(row[k])) errs.push(`“${row[k]}” isn’t a period HighGround can read: use 2025-26, FY2027, 2026-09 or 2026.`); });
    if (row.baseline_period && row.target_period && HGDirection.periodEnd(row.target_period) <= HGDirection.periodEnd(row.baseline_period)) errs.push('The target date must come after the starting point.');
    if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return; }
    const id = form.dataset.id;
    if (id) await HG.db.update('measure', `id=eq.${enc(id)}`, row); else await HG.db.insert('measure', Object.assign({ district_id: S.district.id }, row));
    closeModal(); toast('Saved', row.name); here();
  }

  async function vProgMeasures(c) {
    const D = await loadDirection(c.district); DIR.D = D;
    if (!D.measures.length) return `<div class="card"><h3>No measures yet</h3><p>Add measures under Direction, then record their results here.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/direction/measures">Measures</a></div>`;
    const can = c.plan || c.finance, owed = D.measures.filter((m) => D.st.get(m.id).owed);
    const byOwner = {}; owed.forEach((m) => { (byOwner[m.owner_name || 'No owner'] = byOwner[m.owner_name || 'No owner'] || []).push(m); });
    return `
      ${owed.length ? `<div class="card"><h3>Updates owed</h3>${Object.entries(byOwner).map(([o, list]) => `<p><b>${esc(o)}</b>: ${list.map((m) => `${esc(m.name)} <span class="small muted">(due ${esc(day(D.st.get(m.id).due))})</span>`).join(', ')}</p>`).join('')}</div>` : '<div class="notice ok">Every measure is up to date.</div>'}
      ${can ? '<div class="row"><label class="btn">Upload results<input type="file" data-dir-upload="results" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="results">template</a></div><div id="dir-upload"></div>' : ''}
      <div class="card"><h3>Record results</h3><div class="scroll"><table class="data"><thead><tr><th>Measure</th><th>Latest</th><th>Trend</th><th>Status</th>${can ? '<th>Period</th><th>Result</th><th>Note</th><th></th>' : ''}</tr></thead><tbody>
        ${D.measures.map((m) => { const x = D.st.get(m.id); return `<tr data-mv="${esc(m.id)}"><td>${esc(m.name)}<br><span class="small muted">${esc(m.owner_name || '')}</span></td>
          <td>${x.latest ? `${mVal(m, x.latest.value)} <span class="small muted">${esc(x.latest.period)}</span>` : '<span class="muted">none</span>'}</td><td>${spark(m, x)}</td><td>${stateBadge(x)}</td>
          ${can ? (m.auto_metric ? '<td colspan="4"><span class="st st-approved">Updates itself</span> <span class="small muted">from HighGround’s own data</span></td>'
            : `<td><input name="period" maxlength="20" value="${esc(HGDirection.nextPeriod(m))}" style="width:90px"></td><td><input name="value" inputmode="decimal" style="width:90px" placeholder="${esc(m.unit || '')}"></td>
            <td><input name="note" maxlength="300" style="width:180px"></td><td><button type="button" class="btn small" data-action="saveResult">Save</button></td>`) : ''}</tr>`; }).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:6px">Saving a result for a period that already has one replaces it. Periods: 2025-26, FY2027, 2026-09 or 2026.</p></div>`;
  }
  function openRecord(id) {
    const m = DIR.D.measures.find((x) => x.id === id), x = DIR.D.st.get(id);
    modal(`<form class="stack" data-form="saveRecord" data-id="${esc(id)}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">Record a result</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <p><b>${esc(m.name)}</b>${x.latest ? ` <span class="small muted">· latest ${mVal(m, x.latest.value)} (${esc(x.latest.period)})</span>` : ''}</p>
      <div class="fgrid"><label class="field">Period<input name="period" maxlength="20" value="${esc(HGDirection.nextPeriod(m))}"><span class="hint">2025-26, FY2027, 2026-09 or 2026</span></label>
        <label class="field">Result${m.unit ? `, ${esc(m.unit)}` : ''}<input name="value" inputmode="decimal" required></label></div>
      <label class="field">Note <span class="small muted">(optional)</span><input name="note" maxlength="300"></label>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button></div></form>`);
  }
  async function saveRecord(f, form) {
    const box = form.querySelector('[data-form-errors]'), period = (f.period || '').trim(), value = toNum(f.value);
    const err = !HGDirection.periodEnd(period) ? `“${period}” isn’t a period HighGround can read: use 2025-26, FY2027, 2026-09 or 2026.` : value === null || isNaN(value) ? 'Enter the result as a number.' : '';
    if (err) { box.hidden = false; box.textContent = err; return; }
    await HG.db.upsert('measure_value', [{ district_id: S.district.id, measure_id: form.dataset.id, period, period_end: HGDirection.periodEnd(period), value, note: (f.note || '').trim() || null }], 'measure_id,period');
    closeModal(); toast('Result saved', `${period}: ${value}`); here();
  }
  async function saveResult(el) {
    const tr = el.closest('[data-mv]'), v = (n) => tr.querySelector(`[name=${n}]`).value.trim();
    const period = v('period'), value = toNum(v('value'));
    if (!HGDirection.periodEnd(period)) throw new UserError(`“${period}” isn’t a period HighGround can read: use 2025-26, FY2027, 2026-09 or 2026.`);
    if (value === null || isNaN(value)) throw new UserError('Enter the result as a number.');
    await HG.db.upsert('measure_value', [{ district_id: S.district.id, measure_id: tr.dataset.mv, period, period_end: HGDirection.periodEnd(period), value, note: v('note') || null }], 'measure_id,period');
    toast('Result saved', `${period}: ${value}`); here();
  }
  async function vCommunity(c) {
    const D = await loadDirection(c.district); DIR.D = D;
    const P = Object.fromEntries(D.priorities.map((p) => [p.id, p.name])), I = Object.fromEntries(D.rows.initiatives.map((i) => [i.id, i.name]));
    const sel = (r, field, list, none) => c.plan ? `<select data-sr-link="${esc(r.id)}" data-f="${field}" aria-label="Link">${`<option value="">${none}</option>` + list.map(([k, v]) => `<option value="${esc(k)}" ${r[field] === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : esc((field === 'priority_id' ? P : I)[r[field]] || '');
    const surveyCard = (sv) => {
      const rs = D.results.filter((r) => r.survey_id === sv.id), imp = rs.filter((r) => r.kind === 'importance'), themes = rs.filter((r) => r.kind === 'theme').sort((x, y) => (y.mentions || 0) - (x.mentions || 0)), qs = rs.filter((r) => r.kind === 'question');
      const maxM = Math.max(1, ...themes.map((t) => t.mentions || 0));
      return `<div class="card"><div class="row" style="justify-content:space-between"><div><h3 style="margin:0">${esc(sv.name)}</h3>
          <div class="small muted">${sv.closed_on ? 'Closed ' + esc(day(sv.closed_on)) : ''}${sv.response_count != null ? ` · ${sv.response_count.toLocaleString('en-US')} responses` : ''}</div>${sv.notes ? `<p class="small">${esc(sv.notes)}</p>` : ''}</div>
          ${c.plan ? `<div class="row"><label class="btn small">Upload results<input type="file" data-dir-upload="survey" data-survey="${esc(sv.id)}" accept=".csv,.xlsx" hidden></label><button type="button" class="btn small" data-action="editSurvey" data-id="${esc(sv.id)}">Edit</button></div>` : ''}</div>
        ${imp.length ? `<h4>How important each priority is</h4><table class="data"><tbody>${imp.map((r) => `<tr><td>${esc(r.label)}</td><td><span class="ubar"><i style="width:${Math.min(100, (Number(r.value) / (Number(r.value) <= 5 ? 5 : 100)) * 100)}%"></i></span> <b>${Number(r.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></td><td>${sel(r, 'priority_id', D.priorities.map((p) => [p.id, p.name]), 'Not linked')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${themes.length ? `<h4>Themes</h4><table class="data"><thead><tr><th>What people said</th><th>Mentions</th><th>Priority</th><th>Initiative</th></tr></thead><tbody>${themes.map((r) => `<tr><td>${esc(r.label)}</td>
          <td><span class="ubar"><i style="width:${((r.mentions || 0) / maxM * 100).toFixed(0)}%"></i></span> ${r.mentions == null ? '' : r.mentions}</td><td>${sel(r, 'priority_id', D.priorities.map((p) => [p.id, p.name]), '—')}</td><td>${sel(r, 'initiative_id', D.rows.initiatives.map((i) => [i.id, i.name]), '—')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${qs.length ? `<h4>Questions</h4><table class="data"><tbody>${qs.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.value == null ? '' : Number(r.value).toLocaleString('en-US') + (Number(r.value) <= 100 ? '%' : '')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${!rs.length ? '<p class="muted">No results yet. Upload them from a spreadsheet.</p>' : ''}</div>`;
    };
    return `
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editSurvey" data-id="">Add a survey</button>' : ''} <a href="#" class="small" data-action="dirTemplate" data-k="survey">survey results template</a>
        <span class="small muted">Results are kept as totals and themes, never individual answers.</span></div>
      <div id="dir-upload"></div>
      ${D.surveys.length ? D.surveys.map(surveyCard).join('') : '<div class="card"><h3>No surveys yet</h3><p>Add the district’s community survey, then upload its results: how important each priority is, and the themes people raised with how often.</p></div>'}`;
  }
  function openSurveyEditor(id) {
    const sv = id ? DIR.D.surveys.find((x) => x.id === id) : {};
    modal(`<form class="stack" data-form="saveSurvey" data-id="${esc(id || '')}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">${id ? 'Edit survey' : 'Add a survey'}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <div class="fgrid"><label class="field">Name<input name="name" maxlength="120" value="${esc(sv.name || '')}" placeholder="Community survey, spring 2026" required></label>
        <label class="field">Opened<input type="date" name="opened_on" value="${esc(sv.opened_on || '')}"></label><label class="field">Closed<input type="date" name="closed_on" value="${esc(sv.closed_on || '')}"></label>
        <label class="field">Responses<input name="response_count" inputmode="numeric" value="${sv.response_count == null ? '' : sv.response_count}"></label></div>
      <label class="field">Notes<textarea name="notes" maxlength="600">${esc(sv.notes || '')}</textarea></label>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>
        ${id ? `<span style="flex:1"></span><button type="button" class="btn danger" data-action="deleteSurvey" data-id="${esc(id)}">Delete</button>` : ''}</div></form>`);
  }
  async function saveSurvey(f, form) {
    const box = form.querySelector('[data-form-errors]'), name = (f.name || '').trim(), rc = toNum(f.response_count);
    if (!name) { box.hidden = false; box.textContent = 'Name the survey.'; return; }
    if (rc !== null && (isNaN(rc) || rc < 0)) { box.hidden = false; box.textContent = 'Responses must be a whole number.'; return; }
    const row = { name: name.slice(0, 120), opened_on: f.opened_on || null, closed_on: f.closed_on || null, response_count: rc === null ? null : Math.round(rc), notes: (f.notes || '').trim() || null };
    const id = form.dataset.id;
    if (id) await HG.db.update('survey', `id=eq.${enc(id)}`, row); else await HG.db.insert('survey', Object.assign({ district_id: S.district.id }, row));
    closeModal(); toast('Saved', name); here();
  }

  /* ---- spreadsheets for the plan: goals, measure results, survey results ---- */
  const DIRUP = { kind: null, parsed: null, survey: null };
  const DIR_TEMPLATES = {
    goals: [['Priority', 'Outcome', 'Measure', 'Unit', 'Better', 'Start', 'Start period', 'Target', 'Target period', 'Owner', 'Cadence'],
      ['Every graduate ready for what’s next', 'Graduation and readiness', 'Four-year graduation rate', '%', 'Higher', '88', '2024-25', '94', '2028-29', 'Principal, high school', 'Yearly'],
      ['Safe, modern places to learn', 'Safe and secure buildings', 'Buildings with a secure entry', 'buildings', 'Higher', '1', '2024-25', '3', '2026-27', 'Facilities director', 'Yearly']],
    results: [['Measure', 'Period', 'Result', 'Note'], ['Four-year graduation rate', '2025-26', '89.6', ''], ['Chronic absence', '2025-26', '12.4', 'Spring semester']],
    survey: [['Kind', 'Label', 'Value', 'Mentions', 'Priority'], ['Importance', 'Safe, modern places to learn', '4.7', '', ''], ['Theme', 'Elementary classrooms are crowded', '', '141', 'Safe, modern places to learn'], ['Question', 'Would support a bond for a CTE building', '58', '', '']],
  };
  async function dirUploadRead(input) {
    const kind = input.dataset.dirUpload, file = input.files[0]; if (!file) return;
    const rows = await HGUploads.readTable(file), D = DIR.D || (DIR.D = await loadDirection(S.district));
    DIRUP.kind = kind; DIRUP.survey = input.dataset.survey || null;
    DIRUP.parsed = kind === 'goals' ? HGDirection.parseGoals(rows) : kind === 'results' ? HGDirection.parseResults(rows, D.measures) : HGDirection.parseSurvey(rows, D.priorities);
    const P = DIRUP.parsed, errs = P.issues.filter((i) => i.l === 'e'), warns = P.issues.filter((i) => i.l !== 'e');
    const what = kind === 'goals' ? (() => { const pr = new Set(P.items.map((x) => x.priority)), ms = P.items.filter((x) => x.measure).length; return `${pr.size} priorit${pr.size === 1 ? 'y' : 'ies'} and ${ms} measure${ms === 1 ? '' : 's'}; ones that already exist by name are kept, new ones added`; })()
      : kind === 'results' ? `${P.items.length} result${P.items.length === 1 ? '' : 's'}; a period that already has a result is replaced` : `${P.items.length} survey result${P.items.length === 1 ? '' : 's'}`;
    document.getElementById('dir-upload').innerHTML = `<div class="card"><h3>Review: ${esc(file.name)}</h3><p>${esc(what)}.</p>
      ${errs.length ? `<div class="notice error">${errs.slice(0, 10).map((x) => esc(x.m)).join('<br>')}</div>` : ''}${warns.length ? `<div class="notice">${warns.slice(0, 10).map((x) => esc(x.m)).join('<br>')}</div>` : ''}
      <div class="row"><button type="button" class="btn primary" data-action="dirUploadApply" ${errs.length || !P.items.length ? 'disabled' : ''}>Apply</button><button type="button" class="btn" data-action="dirUploadCancel">Cancel</button></div></div>`;
    input.value = '';
  }
  async function dirUploadApply() {
    const d = S.district.id, D = DIR.D, P = DIRUP.parsed, norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (DIRUP.kind === 'goals') {
      const prio = new Map(D.priorities.map((p) => [norm(p.name), p.id])), outc = new Map(D.outcomes.map((o) => [o.priority_id + '|' + norm(o.name), o.id])), meas = new Set(D.measures.map((m) => norm(m.name)));
      let pos = D.priorities.length;
      for (const it of P.items) {
        let pid = prio.get(norm(it.priority));
        if (!pid) { pid = crypto.randomUUID(); prio.set(norm(it.priority), pid); await HG.db.insert('priority', { id: pid, district_id: d, name: it.priority.slice(0, 120), position: ++pos }); }
        let oid = null;
        if (it.outcome) { oid = outc.get(pid + '|' + norm(it.outcome)); if (!oid) { oid = crypto.randomUUID(); outc.set(pid + '|' + norm(it.outcome), oid); await HG.db.insert('outcome', { id: oid, district_id: d, priority_id: pid, name: it.outcome.slice(0, 200) }); } }
        if (it.measure && !meas.has(norm(it.measure))) { meas.add(norm(it.measure));
          await HG.db.insert('measure', { district_id: d, priority_id: pid, outcome_id: oid, name: it.measure.slice(0, 160), unit: it.unit, better: it.better, baseline_value: it.start, baseline_period: it.startPeriod,
            target_value: it.target, target_period: it.targetPeriod, owner_name: it.owner, cadence: it.cadence, source: 'manual', is_public: true }); }
      }
    } else if (DIRUP.kind === 'results') {
      await HG.db.upsert('measure_value', P.items.map((x) => ({ district_id: d, measure_id: x.measure.id, period: x.period, period_end: x.period_end, value: x.value, note: x.note })), 'measure_id,period');
    } else {
      const sid = DIRUP.survey; if (!sid) throw new UserError('Choose which survey these results belong to.');
      const start = D.results.filter((r) => r.survey_id === sid).length;
      await HG.db.insert('survey_result', P.items.map((x, k) => ({ district_id: d, survey_id: sid, kind: x.kind, label: x.label, value: x.value, mentions: x.mentions, position: start + k + 1, priority_id: x.priority_id, initiative_id: null })));
    }
    const what = DIRUP.kind === 'results' ? (P.items.length === 1 ? 'result' : 'results') : (P.items.length === 1 ? 'survey result' : 'survey results');
    toast('Upload applied', DIRUP.kind === 'goals' ? 'The priorities, outcomes and measures from the spreadsheet are in.' : `${P.items.length} ${what} added.`); DIRUP.parsed = null; here();
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
    { const go2 = (counts.approved || 0) + (counts.underway || 0), wait = (counts.idea || 0) + (counts.proposed || 0) + (counts.analysis || 0);
      setLead(`${rows.initiatives.length} initiatives: <b>${go2}</b> approved or underway, <b>${wait}</b> waiting for a decision${counts.done ? `, ${counts.done} done` : ''}.`); }
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
      ${(() => { setLead(summary.replace(/<\/?b>/g, (m) => m)); return ''; })()}<div class="card">
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
    if (all.length > 1) {
      const gaps = all.map((x) => ({ x, g: HGCompare.metrics(HGCompare.run(rows, x.id)).gap })).sort((a, b2) => a.g - b2.g), bv = gaps.find((y) => y.x.is_board_version);
      setLead(`Of ${all.length} scenarios, <b>${esc(gaps[0].x.name)}</b> leaves the smallest gap (${fmtK(gaps[0].g)})${bv && bv.x.id !== gaps[0].x.id ? `; the board version leaves ${fmtK(bv.g)}` : ''}.`);
    }
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
  /** each capital fund's balance at the end of each year: one line per fund */
  function fundsChart(paths, funds) {
    const COLORS = { save: '#3E6190', ppel: '#2F6B4F', vppel: '#8A5A00', grants: '#7A4E8C' };
    const ys = paths[funds[0]].years, n = ys.length, W = 660, H = 220, padL = 56, padR = 16;
    const all = funds.flatMap((k) => paths[k].years.map((y) => y.end)), hi = Math.max(1, ...all);
    const X = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR), Y = (v) => H - 26 - (v / hi) * (H - 44);
    const ticks = [0, 0.5, 1].map((t) => t * hi);
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Each capital fund's balance at the end of each year">
      ${ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#E4E0D6"/><text x="${padL - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#5A6660">${fmtK(v)}</text>`).join('')}
      ${funds.map((k) => `<polyline fill="none" stroke="${COLORS[k]}" stroke-width="2.5" points="${paths[k].years.map((y, i) => `${X(i).toFixed(1)},${Y(y.end).toFixed(1)}`).join(' ')}"/>`).join('')}
      ${ys.map((y, i) => (i % 2 === 0 || n <= 6 ? `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#5A6660">FY${y.fy}</text>` : '')).join('')}</svg></div>
      <p class="small">${funds.map((k) => `<span style="color:${COLORS[k]}">●</span> ${esc(FUND_NAMES[k])}`).join(' &nbsp; ')}</p>`;
  }
  async function vResSummary(c) {
    const b = await boardRun(c.district);
    if (b.none) return notReady(c, b);
    const { sc, inp, r, paths } = b, cfg = inp.cfg, fmt = fmtK;
    b.rows = b.rows || (await loadCapitalRows(c.district));
    const byY = HGCapital.recurByYear(inp.levers, cfg), recY = byY.find((y) => y.total > 0.5), rec = recY ? recY.total : 0;
    const funds = HGCapital.CAP_FUNDS.filter((k) => k !== 'vppel' || cfg.vStatus !== 'none' || paths[k].open > 0);
    // the main fund closest to running out (grants are small and left out)
    const lowest = funds.filter((k) => k !== 'grants').map((k) => ({ k, p: paths[k] })).sort((x, y) => x.p.low - y.p.low)[0];
    const gfr = gfRun(b.rows, sc.id), gy = gfr ? gfr.R.years : null;
    setLead(`${r.gap > 0.5 ? `The plan is <b>${fmtK(r.gap)}</b> short` : 'The capital plan is fully paid for'} over FY${cfg.start}–FY${cfg.start + cfg.n - 1}.`
      + (lowest ? ` ${esc(FUND_NAMES[lowest.k])} is at its lowest, ${fmtK(lowest.p.low)}, in FY${lowest.p.lowFY}.` : '')
      + (gy ? ` General Fund solvency goes from ${pct1(gy[0].solvency)} to ${pct1(gy[gy.length - 1].solvency)} over five years.` : ''));
    const detail = await vFunds(c);
    return `
      <p class="small muted">From <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}, FY${cfg.start}–FY${cfg.start + cfg.n - 1}. <a href="#/d/${enc(c.district.slug)}/resources/capital">Open the capital plan</a></p>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">10-year capital need</div><div class="stat">${fmtK(r.need)}</div></div>
        <div class="card tile-card"><div class="small muted">Paid by levies and grants</div><div class="stat">${fmtK(r.levyFunded)}</div></div>
        <div class="card tile-card ${r.gap > 0.5 ? 'gap' : ''}"><div class="small muted">Gap to close</div><div class="stat">${fmtK(r.gap)}</div></div>
        <div class="card tile-card"><div class="small muted">Yearly costs committed</div><div class="stat">${rec ? fmtK(rec) : '$0'}</div><div class="small muted">${recY ? `programs and hires, FY${recY.fy}` : 'programs and hires, per year'}</div></div>
      </div>
      <div class="card"><h3>Capital fund balances</h3>${fundsChart(paths, funds)}</div>
      ${fold(c, 'Capital funds: the numbers', `<div class="card">${table([
        { label: 'Fund', get: (k) => FUND_NAMES[k] },
        { label: `Starting balance`, num: true, get: (k) => fmt(paths[k].open) },
        { label: '10-year receipts', num: true, get: (k) => fmt(paths[k].receipts) },
        { label: '10-year spending', num: true, get: (k) => fmt(paths[k].spend) },
        { label: 'Short by', num: true, html: (k) => (paths[k].over > 0.5 ? `<b class="gaptext">${fmt(paths[k].over)}</b>` : '') },
        { label: 'Lowest balance', num: true, get: (k) => `${fmt(paths[k].low)} (FY${paths[k].lowFY})` },
        { label: `Ending FY${cfg.start + cfg.n - 1}`, num: true, get: (k) => fmt(paths[k].end) },
      ], funds, '')}
      <p class="small muted" style="margin-top:8px">“Short by” is spending planned on a fund beyond what it has that year; it counts toward the gap.</p></div>`, false)}
      ${(() => { const g = gfRun(b.rows, sc.id); if (!g) return `<div class="card"><h3>General Fund</h3><p class="muted">Not set up yet. ${c.finance ? `<a href="#/d/${enc(c.district.slug)}/resources/general">Enter the starting figures</a>.` : ''}</p></div>`;
        const ys = g.R.years, a1 = ys[0], z = ys[ys.length - 1], low = ys.reduce((m, y) => (y.solvency < m.solvency ? y : m), ys[0]);
        return `<div class="card"><h3>General Fund</h3><div class="grid tiles">
          <div class="card tile-card"><div class="small muted">Solvency ratio</div><div class="stat">${pct1(a1.solvency)} → ${pct1(z.solvency)}</div><div class="small muted">lowest ${pct1(low.solvency)} in FY${low.fy}</div></div>
          <div class="card tile-card"><div class="small muted">Unspent balance ratio</div><div class="stat">${pct1(a1.unspentRatio)} → ${pct1(z.unspentRatio)}</div></div>
          <div class="card tile-card"><div class="small muted">Ending fund balance, FY${z.fy}</div><div class="stat">${fmtK(z.balance)}</div></div>
          <div class="card tile-card"><div class="small muted">Staff share of spending</div><div class="stat">${pct1(a1.staffShare)}</div></div></div>
          <p class="small muted" style="margin-top:8px">Five-year forecast, planning estimates. <a href="#/d/${enc(c.district.slug)}/resources/general">Open the General Fund</a></p></div>`; })()}
      ${fold(c, 'Each fund, year by year: balances, receipts, spending, debt and rules', detail, false)}`;
  }
  /* ---- the General Fund forecast ---- */
  const GF = { key: null, sid: null, over: {} };
  function gfAssume(rows, sc, gfi) {
    const set = sc && sc.assumption_set_id ? (rows.assumption_sets || []).find((x) => x.id === sc.assumption_set_id) : null;
    const base = Object.assign({}, HGGF.DEFAULTS, (gfi && gfi.assume) || {});
    const pick = (col, k) => (set && set[col] != null ? Number(set[col]) : base[k]);
    return { a: { ssa: pick('state_aid_growth', 'ssa'), enroll: pick('enrollment_change_pct', 'enroll'), settle: pick('settlement_pct', 'settle'), health: pick('health_growth', 'health'), inflation: base.inflation }, set };
  }
  function gfRun(rows, scId, over) {
    const gfi = rows.settings && rows.settings.gf_inputs;
    if (!gfi || !rows.settings) return null;
    const sc = rows.scenarios.find((x) => x.id === scId) || rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0] || null;
    const { a, set } = gfAssume(rows, sc, gfi), A = Object.assign({}, a, over || {});
    let years = [], extra = {};
    if (sc) {
      const bi = HGCapital.buildInputs(rows, sc.id), L = Object.assign({}, bi.levers, { settle: A.settle });
      years = bi.cfg.years.slice(0, 5);
      years.forEach((fy) => { extra[fy] = HGEngine.recurIn(bi.cfg, 'general', fy - bi.cfg.start, L); });
    } else { const s0 = rows.settings.plan_start_fy || 2027; years = [0, 1, 2, 3, 4].map((k) => s0 + k); }
    const g = Object.assign({}, gfi, over && over.turnover != null ? { turnover_savings: over.turnover } : {});
    return { gfi: g, sc, set, a: A, base: a, R: HGGF.forecast(g, A, years, extra), extra };
  }
  const pct1 = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  function gfChart(R) {
    const ys = R.years, W = 640, H = 200, pad = 34, n = ys.length;
    const vals = ys.flatMap((y) => [y.solvency, y.unspentRatio]).filter((v) => v != null);
    const lo = Math.min(0, ...vals), hi = Math.max(0.2, ...vals), X = (i) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2), Y = (v) => H - 24 - ((v - lo) / (hi - lo)) * (H - 40);
    const line = (k, color) => `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${ys.map((y, i) => `${X(i).toFixed(1)},${Y(y[k] || 0).toFixed(1)}`).join(' ')}"/>${ys.map((y, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(y[k] || 0).toFixed(1)}" r="3" fill="${color}"/>`).join('')}`;
    const band = `<rect x="${pad}" width="${W - pad * 2}" y="${Y(0.10).toFixed(1)}" height="${(Y(0.05) - Y(0.10)).toFixed(1)}" fill="#E6F0EA"/>`;
    const grid = [0, 0.05, 0.10, 0.15, 0.20].filter((v) => v >= lo && v <= hi).map((v) => `<line x1="${pad}" x2="${W - pad}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#E4E0D6"/><text x="${pad - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#5A6660">${(v * 100).toFixed(0)}%</text>`).join('');
    const zero = lo < 0 ? `<line x1="${pad}" x2="${W - pad}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#B42318"/>` : '';
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Solvency ratio and unspent balance ratio by year">${band}${grid}${zero}${line('solvency', '#1E3A2F')}${line('unspentRatio', '#C9A24A')}
      ${ys.map((y, i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#5A6660">FY${y.fy}</text>`).join('')}</svg></div>
      <p class="small"><span style="color:#1E3A2F">●</span> Solvency ratio &nbsp; <span style="color:#C9A24A">●</span> Unspent balance ratio &nbsp; <span class="muted">shaded: the 5–10% range many districts aim for</span></p>`;
  }
  function gfResultsHtml(run) {
    const R = run.R, ys = R.years, first = ys[0], last = ys[ys.length - 1], f = HGReport.fmt, FL = R.flags;
    const lowest = (k) => ys.reduce((m, y) => (y[k] != null && (m == null || y[k] < m[k]) ? y : m), null);
    const ls = lowest('solvency'), lu = lowest('unspentRatio');
    const flags = [
      FL.negativeUnspent.length ? `<li class="gaptext">Spending passes spending authority in FY${FL.negativeUnspent.join(', FY')}. Iowa law requires a corrective plan; two years in a row brings state review.</li>` : '',
      FL.lowSolvency.length ? `<li class="gaptext">Solvency falls below 5% in FY${FL.lowSolvency.join(', FY')}.</li>` : '',
      FL.lowUnspent.length && !FL.negativeUnspent.length ? `<li>The unspent balance ratio falls below 5% in FY${FL.lowUnspent.join(', FY')}.</li>` : '',
      FL.deficit.length ? `<li>Spending exceeds revenue in ${FL.deficit.length === ys.length ? 'every year' : 'FY' + FL.deficit.join(', FY')}.</li>` : '',
      FL.guarantee.length ? `<li>The 101% budget guarantee applies in FY${FL.guarantee.join(', FY')} (enrollment falls faster than funding grows).</li>` : '',
    ].filter(Boolean);
    const extraYears = ys.filter((y) => y.extra > 0.5);
    const y2 = ys[1];
    const leadTxt = `Solvency ${last.solvency < first.solvency ? 'slides' : 'rises'} from <b>${pct1(first.solvency)}</b> to <b>${pct1(last.solvency)}</b> over five years`
      + (FL.negativeUnspent.length ? `, and spending passes spending authority in FY${FL.negativeUnspent[0]}.` : FL.deficit.length === ys.length ? ', with spending above revenue every year.' : '.')
      + (y2 && y2.affordableSettlement != null ? ` Next year’s new money covers about a ${(y2.affordableSettlement * 100).toFixed(1)}% settlement.` : '');
    return `<p class="lead">${leadTxt}</p>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">Solvency ratio ${def('solvency')}</div><div class="stat">${pct1(first.solvency)} → ${pct1(last.solvency)}</div><div class="small muted">FY${first.fy} to FY${last.fy}; lowest ${pct1(ls.solvency)} in FY${ls.fy}</div></div>
        <div class="card tile-card"><div class="small muted">Unspent balance ratio ${def('unspent')}</div><div class="stat">${pct1(first.unspentRatio)} → ${pct1(last.unspentRatio)}</div><div class="small muted">lowest ${pct1(lu.unspentRatio)} in FY${lu.fy}</div></div>
        <div class="card tile-card"><div class="small muted">Ending fund balance, FY${last.fy}</div><div class="stat">${f(last.balance)}</div><div class="small muted">unassigned and assigned</div></div>
        <div class="card tile-card"><div class="small muted">Revenue vs. spending, FY${last.fy}</div><div class="stat">${f(last.net)}</div><div class="small muted">${last.net < 0 ? 'spending more than revenue' : 'revenue covers spending'}</div></div>
      </div>
      ${flags.length ? `<div class="card"><h3>Watch</h3><ul>${flags.join('')}</ul></div>` : ''}
      <div class="card"><h3>Solvency and spending authority</h3>${gfChart(R)}</div>
      <div class="card"><h3>New money vs. a settlement</h3><p class="small muted">New money is what the formula adds each year (state supplemental aid and enrollment). Each 1% of settlement costs salaries plus benefits.</p>
        <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">New money</th><th class="num">Each 1% of settlement costs</th><th class="num">A ${(run.a.settle * 100).toFixed(1)}% settlement costs</th><th class="num">Settlement the new money covers</th></tr></thead><tbody>
          ${ys.slice(1).map((y) => `<tr><td>FY${y.fy}</td><td class="num">${f(y.newMoney)}</td><td class="num">${f(y.costPerPoint)}</td><td class="num">${f(y.settlementCost)}</td><td class="num"><b>${y.affordableSettlement == null ? '' : (y.affordableSettlement * 100).toFixed(1) + '%'}</b></td></tr>`).join('')}
        </tbody></table></div></div>
      <details class="fold" ${GF.ctx && (GF.ctx.plan || GF.ctx.finance) ? 'open' : ''}><summary>Year by year</summary><div class="card"><div class="scroll"><table class="data gftable"><thead><tr><th></th>${ys.map((y) => `<th class="num">FY${y.fy}</th>`).join('')}</tr></thead><tbody>
        ${[['Enrollment', (y) => Math.round(y.enrollment).toLocaleString('en-US')], ['District cost per pupil', (y) => '$' + Math.round(y.dcpp).toLocaleString('en-US')],
          ['Regular program', (y) => f(y.regular) + (y.guarantee > 0.5 ? '*' : '')], ['Other state formula funding', (y) => f(y.other)], ['Miscellaneous income', (y) => f(y.misc)], ['<b>Revenue</b>', (y) => `<b>${f(y.revenue)}</b>`],
          ['Staff (salaries, benefits, health)', (y) => f(y.staff)], ['Other spending', (y) => f(y.nonstaff)], ...(extraYears.length ? [['The plan’s yearly costs', (y) => (y.extra ? f(y.extra) : '')]] : []), ['<b>Spending</b>', (y) => `<b>${f(y.spending)}</b>`],
          ['Revenue less spending', (y) => `<span class="${y.net < 0 ? 'gaptext' : ''}">${f(y.net)}</span>`], ['Ending fund balance', (y) => f(y.balance)], ['Solvency ratio', (y) => pct1(y.solvency)],
          ['Spending authority', (y) => f(y.authority)], ['Unspent balance', (y) => `<span class="${y.unspent < 0 ? 'gaptext' : ''}">${f(y.unspent)}</span>`], ['Unspent balance ratio', (y) => pct1(y.unspentRatio)], ['Staff share of spending', (y) => pct1(y.staffShare)],
        ].map(([l, fn]) => `<tr><td>${l}</td>${ys.map((y) => `<td class="num">${fn(y)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${FL.guarantee.length ? '<p class="small muted">* includes the 101% budget guarantee.</p>' : ''}
      <p class="small muted" style="margin-top:6px">Planning estimates, not the state’s official calculation. FY2027 uses the enacted 2% state supplemental aid ($8,148 state cost per pupil, SF 2201). Solvency = unassigned and assigned balance ÷ revenue less AEA flowthrough. Spending authority = regular program and other formula funding + miscellaneous income + last year’s unspent balance. Figures checked ${esc(day(HGGF.RULES.checked))}.</p></div></details>`;
  }
  async function vGeneralFund(c) {
    const rows = await loadCapitalRows(c.district);
    if (GF.key !== c.district.id) { GF.key = c.district.id; GF.sid = null; GF.over = {}; }
    GF.rows = rows; GF.ctx = c;
    const caution = '<div class="notice">Planning estimates. Check the starting figures and results with the business manager before sharing them with the board.</div>';
    if (!rows.settings) return caution + notReady(c, { rows });
    const gfi = rows.settings.gf_inputs;
    if (!gfi) return `${caution}<div class="card"><h3>Set up the General Fund</h3><p>The forecast needs a few starting figures: enrollment, cost per pupil, other revenue, staff by group, other spending, and the fund balance and unspent balance from the last audit.</p>
      ${c.finance ? '<button type="button" class="btn primary" data-action="gfEdit">Enter starting figures</button>' : '<p class="muted">The business office enters these.</p>'}</div>`;
    const run = gfRun(rows, GF.sid, GF.over); GF.run = run;
    const lv = (k, label, v, hint) => `<label class="field">${label}<input data-gf-lever="${k}" inputmode="decimal" value="${(v * 100).toFixed(2).replace(/\.?0+$/, '')}" style="width:90px"><span class="hint">${hint}</span></label>`;
    return `${caution}
      <div class="row">
        ${rows.scenarios.length ? `<label class="chip"><span class="small muted">Scenario</span><select data-gf-sc aria-label="Scenario">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${run.sc && x.id === run.sc.id ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>` : ''}
        <span class="small muted">Assumptions: ${run.set ? esc(run.set.name) : 'the General Fund defaults'}${Object.keys(GF.over).length ? ', with what-if changes' : ''}.</span>
        ${c.finance ? '<button type="button" class="btn" data-action="gfEdit">Starting figures</button>' : ''}</div>
      ${fold(c, 'What-if: state aid, enrollment, settlement, health insurance', `<div class="card"><div class="gflevers">
        ${lv('ssa', 'State aid growth, %', run.a.ssa, 'after FY2027’s enacted 2%')}${lv('enroll', 'Enrollment change, %', run.a.enroll, 'a year')}${lv('settle', 'Settlement, %', run.a.settle, 'salary increase a year')}
        ${lv('health', 'Health insurance growth, %', run.a.health, 'a year')}${lv('inflation', 'Other spending growth, %', run.a.inflation, 'a year')}${lv('turnover', 'Turnover savings, %', run.gfi.turnover_savings || 0, 'newer staff on lower pay')}
      </div><div class="row"><button type="button" class="btn small" data-action="gfReset">Reset to the scenario’s assumptions</button></div></div>`)}
      <div id="gf-results">${gfResultsHtml(run)}</div>`;
  }
  function openGfEditor() {
    const st = GF.rows.settings, g = st.gf_inputs || { enrollment: st.enrollment || null, dcpp: HGGF.RULES.scpp[2027], misc_growth: 0.01, turnover_savings: 0.01,
      staff: [{ name: 'Teachers', benefits: 0.1709 }, { name: 'Support staff', benefits: 0.1709 }, { name: 'Administrators', benefits: 0.1709 }], assume: Object.assign({}, HGGF.DEFAULTS) };
    const money2 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));
    const pc = (v) => (v == null ? '' : +(Number(v) * 100).toFixed(2));
    const f = (n, l, v, h) => `<label class="field">${l}<input name="${n}" inputmode="decimal" value="${esc(v)}">${h ? `<span class="hint">${h}</span>` : ''}</label>`;
    const staffRow = (x) => `<tr data-gf-staff><td><input name="s_name" value="${esc(x.name || '')}" style="width:140px"></td><td><input name="s_fte" inputmode="decimal" value="${x.fte == null ? '' : x.fte}" style="width:70px"></td>
      <td><input name="s_salary" inputmode="decimal" value="${money2(x.salary)}" style="width:100px"></td><td><input name="s_benefits" inputmode="decimal" value="${pc(x.benefits)}" style="width:70px"></td>
      <td><input name="s_health" inputmode="decimal" value="${money2(x.health)}" style="width:90px"></td><td><button type="button" class="btn small" data-action="gfStaffRemove" aria-label="Remove">×</button></td></tr>`;
    const A = Object.assign({}, HGGF.DEFAULTS, g.assume || {});
    modal(`<form class="stack" data-form="saveGf" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">General Fund starting figures</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <p class="small muted">For the first year of the plan. The certified budget, the Certified Annual Report and the Department of Management’s unspent balance report have most of these.</p>
      <div data-gf-hint></div>
      <h3>Revenue</h3><div class="fgrid">
        ${f('enrollment', 'Certified enrollment (budget enrollment)', g.enrollment == null ? '' : g.enrollment)}${f('dcpp', 'District cost per pupil, $', money2(g.dcpp), 'FY2027 state cost per pupil: $8,148')}
        ${f('other_formula', 'Other state formula funding, $', money2(g.other_formula), 'Categorical supplements, special education and similar')}${f('misc_income', 'Miscellaneous income, $', money2(g.misc_income), 'Local, federal and other income')}
        ${f('misc_growth', 'Miscellaneous income growth, % a year', pc(g.misc_growth))}${f('aea_flowthrough', 'AEA flowthrough, $', money2(g.aea_flowthrough), 'Left out of revenue for the solvency ratio')}</div>
      <h3>Spending</h3><div class="scroll"><table class="data"><thead><tr><th>Staff group</th><th>FTE</th><th>Average salary, $</th><th>Benefits, % of salary</th><th>Health insurance per FTE, $</th><th></th></tr></thead>
        <tbody data-gf-staff-body>${(g.staff || []).map(staffRow).join('')}</tbody></table></div>
      <template data-gf-staff-template>${staffRow({ benefits: 0.1709 })}</template>
      <div class="row"><button type="button" class="btn small" data-action="gfStaffAdd">Add a staff group</button><label class="row small"><input type="checkbox" name="fte_follow_enrollment" ${g.fte_follow_enrollment ? 'checked' : ''}> Staff numbers follow enrollment</label></div>
      <div class="fgrid">${f('nonstaff', 'Other spending, $ a year', money2(g.nonstaff), 'Supplies, services, utilities, transportation and the rest')}${f('turnover_savings', 'Turnover savings, % a year', pc(g.turnover_savings), 'Experienced staff replaced by newer staff on lower pay')}</div>
      <h3>Balances</h3><div class="fgrid">${f('fund_balance', 'Unassigned and assigned fund balance, $', money2(g.fund_balance), 'At the start of the plan')}${f('unspent', 'Unspent balance (spending authority), $', money2(g.unspent), 'From the Department of Management’s report')}</div>
      <h3>Default assumptions</h3><p class="small muted">Used when a scenario’s assumption set leaves them blank.</p><div class="fgrid">
        ${f('a_ssa', 'State aid growth, %', pc(A.ssa))}${f('a_enroll', 'Enrollment change, %', pc(A.enroll))}${f('a_settle', 'Settlement, %', pc(A.settle))}${f('a_health', 'Health insurance growth, %', pc(A.health))}${f('a_inflation', 'Other spending growth, %', pc(A.inflation))}</div>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button></div></form>`);
    gfHint();
  }
  async function gfHint() {
    // help: what the latest ledger or adopted budget says, so the business manager can split it into these fields
    const d = S.district, box = document.querySelector('[data-gf-hint]'); if (!box) return;
    try {
      const [acc, bl] = await Promise.all([HG.db.selectAll('gl_account', `select=id,fund_code,object_code,account_type&district_id=eq.${d.id}`), HG.db.selectAll('budget_line', `select=account_id,fiscal_year,amount&district_id=eq.${d.id}&version=eq.adopted`).catch(() => [])]);
      const A = new Map(acc.map((x) => [x.id, x])), fy = GF.rows.settings.plan_start_fy;
      let lines = bl.filter((x) => x.fiscal_year === fy).map((x) => Object.assign({}, A.get(x.account_id) || {}, { budget: x.amount })), from = `the adopted FY${fy} budget`;
      if (!lines.length) {
        const bt = await HG.db.select('import_batch', `select=id,period_end&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc&limit=1`);
        if (bt[0]) { const am = await HG.db.selectAll('gl_amount', `select=account_id,budget_amount&batch_id=eq.${bt[0].id}`); lines = am.map((x) => Object.assign({}, A.get(x.account_id) || {}, { budget: x.budget_amount })); from = `the budget column of the ${day(bt[0].period_end)} ledger`; }
      }
      const b = HGGF.fromBudget(lines);
      if (b.revenue || b.total) box.innerHTML = `<div class="notice ok small">From ${esc(from)}: General Fund revenue ${HGReport.fmt(b.revenue)}; staff spending (objects 1xx–2xx) ${HGReport.fmt(b.staff)}; other spending ${HGReport.fmt(b.nonstaff)}. Use these to check your figures add up.</div>`;
    } catch (e) { /* no ledger or budget yet */ }
  }
  async function saveGf(f, form) {
    const box = form.querySelector('[data-form-errors]'), errs = [], n = (v) => { const x = toNum(v); return x === null ? null : x; }, p = (v) => { const x = toNum(v); return x === null ? null : x / 100; };
    const staff = [...form.querySelectorAll('[data-gf-staff]')].map((tr) => { const v = (k) => tr.querySelector(`[name=${k}]`).value; return { name: v('s_name').trim() || 'Staff', fte: n(v('s_fte')), salary: n(v('s_salary')), benefits: p(v('s_benefits')), health: n(v('s_health')) }; })
      .filter((x) => x.fte || x.salary);
    const g = { enrollment: n(f.enrollment), dcpp: n(f.dcpp), other_formula: n(f.other_formula), misc_income: n(f.misc_income), misc_growth: p(f.misc_growth), aea_flowthrough: n(f.aea_flowthrough),
      nonstaff: n(f.nonstaff), turnover_savings: p(f.turnover_savings), fund_balance: n(f.fund_balance), unspent: n(f.unspent), fte_follow_enrollment: !!f.fte_follow_enrollment, staff,
      assume: { ssa: p(f.a_ssa), enroll: p(f.a_enroll), settle: p(f.a_settle), health: p(f.a_health), inflation: p(f.a_inflation) } };
    if (!(g.enrollment > 0)) errs.push('Enter certified enrollment.');
    if (!(g.dcpp > 0)) errs.push('Enter the district cost per pupil.');
    if (!staff.length) errs.push('Add at least one staff group with FTE and average salary.');
    Object.entries(g).forEach(([k, v]) => { if (typeof v === 'number' && isNaN(v)) errs.push(`${k.replace(/_/g, ' ')} must be a number.`); });
    staff.forEach((x) => { if ([x.fte, x.salary, x.benefits, x.health].some((v) => v != null && isNaN(v))) errs.push(`${x.name}: numbers only.`); });
    Object.keys(g.assume).forEach((k) => { if (g.assume[k] == null) delete g.assume[k]; });
    if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return; }
    await HG.db.update('district_settings', `district_id=eq.${S.district.id}`, { gf_inputs: g });
    closeModal(); toast('Saved', 'General Fund starting figures.'); here();
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
    const funds4 = ['save', 'ppel', 'vppel', 'grants', 'debt_levy', 'general'].filter((f) => bal.some((x) => x.fund === f));
    const dates = [...new Set(bal.map((x) => x.as_of))].sort().reverse().slice(0, 12);
    const SRC = { manual: 'Typed in', upload: 'Balances upload', gl_import: 'Monthly GL' };
    const history = dates.length > 1 ? `<div class="card"><h3>Balances month by month</h3><div class="scroll"><table class="data"><thead><tr><th>As of</th>${funds4.map((f) => `<th class="num">${esc(FUND_NAMES[f] || ({ debt_levy: 'Debt Service', general: 'General Fund' })[f] || f)}</th>`).join('')}<th>From</th></tr></thead><tbody>
      ${dates.map((dt) => { const at = bal.filter((x) => x.as_of === dt); return `<tr><td>${esc(day(dt))}</td>${funds4.map((f) => { const r = at.find((x) => x.fund === f); return `<td class="num">${r ? money(r.amount) : ''}</td>`; }).join('')}<td class="small muted">${esc([...new Set(at.map((x) => SRC[x.source] || x.source))].join(', '))}</td></tr>`; }).join('')}
    </tbody></table></div><p class="small muted" style="margin-top:6px">The most recent date is the one the capital plan starts from.</p></div>` : '';
    if (b.none) return top + history + notReady(c, b);
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
    return top + history + `
      <p class="small muted">Year by year from <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}. <a href="#/d/${enc(c.district.slug)}/resources/capital">Change it on the capital plan</a></p>
      ${funds.map(fundCard).join('')}
      <div class="card"><h3>Borrowing room</h3>
        <p>SAVE revenue bonds: about <b>${fmtK(cap.pv)}</b>, based on the lowest year (FY${cap.fy}), 1.20 coverage, 20 years at 4.5%.</p>
        <p>${go != null ? `General-obligation bonds: about <b>${fmtK(go)}</b> left under the debt limit (5% of actual valuation, less GO debt outstanding). A GO bond also needs 60% of voters.` : 'General-obligation limit: add the district’s actual (100%) valuation in Starting numbers to see it.'}</p></div>
      <p class="small muted">Fund rules are a plain-language guide, not legal advice. Confirm a specific use with the district’s attorney or the Iowa Department of Education.</p>`;
  }
  // ---------------------------------------------------------------- capital plan (live engine)
  const CAP = { key: null, rows: null, scenarioId: null, inputs: null, levers: null, pub: false };
  // money: rounded ($3.02M, $420k) on summaries, tiles and sentences; exact dollars in accounting tables (ledger, budget, spending)
  const fmtK = (v) => HGReport.fmt(v);
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
      ${CAP.sc.is_locked && (c.plan || c.finance) ? `<div class="notice">This scenario is locked, so it can’t be changed${c.admin ? '. Unlock it to edit.' : '. A district admin can unlock it.'} Copy it to try changes.</div>` : ''}
      ${CAP.inputs.notes.length ? `<div class="notice">${CAP.inputs.notes.map(esc).join('<br>')}</div>` : ''}
      <p class="lead" id="cap-lead">${capLeadHtml()}</p>
      <div id="cap-results">${capResultsHtml()}</div>
      ${fold(c, 'What-if and financing', `<div class="cap-grid">
        <div class="card" id="cap-levers">${capLeversHtml()}</div>
        <div class="card" id="cap-fin">${capFinHtml()}</div>
      </div>`)}
      ${fold(c, 'What it means for taxpayers', `<div class="card" id="cap-tax">${capTaxHtml()}</div>`)}
      ${fold(c, 'Projects by year', `<div id="cap-filters">${capFiltersHtml()}</div>
      <div id="cap-years">${capYearsHtml()}</div>
      ${CAP.editable ? '<div class="row"><button type="button" class="btn primary" data-action="editProject" data-id="">Add an initiative</button></div>' : ''}
      <div id="cap-yearly">${capYearlyHtml()}</div>`)}
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
      : `<p class="small muted">Assumptions: starting numbers. <a href="#/d/${enc(S.district.slug)}/settings/assumptions">Make assumption sets</a> to stress-test the plan.</p>`;
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

  function capLeadHtml() {
    const r = capCompute(), cfg = CAP.inputs.cfg, yrs = HGCapital.yearSummary(r, cfg);
    const worst = yrs.reduce((m, y) => ((y.campNeeded + y.over) > (m ? m.campNeeded + m.over : 0) ? y : m), null);
    return `${esc(CAP.sc ? CAP.sc.name : 'The plan')}: <b>${fmtK(r.need)}</b> of projects over ${cfg.n} years. Levies and grants cover ${fmtK(r.levyFunded)}${r.financed > 0.5 ? `, borrowing or gifts ${fmtK(r.financed)}` : ''}; `
      + (r.gap > 0.5 ? `<b>${fmtK(r.gap)}</b> is left to close${worst ? `, mostly in FY${worst.fy}` : ''}.` : 'nothing is left to close.');
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
    const cl = document.getElementById('cap-lead'); if (cl) cl.innerHTML = capLeadHtml();
    LEVERS.forEach((l) => { const el = document.querySelector(`[data-lever-val="${l.k}"]`); if (el) el.textContent = l.show(CAP.levers[l.k]); });
  }
  const SET_FIELDS = [
    ['construction_inflation', 'Construction inflation', 'How fast project costs rise each year'],
    ['save_trend', 'SAVE receipts trend', 'Negative if SAVE is expected to fall (enrollment, sales tax)'],
    ['ppel_growth', 'PPEL valuation growth', 'Growth in taxable valuation, which drives PPEL and tax rates'],
    ['grant_yield', 'Grant yield to capital', 'Share of grants and gifts that goes to capital projects'],
    ['settlement_pct', 'Salary settlements', 'How fast yearly staff costs grow'],
    ['state_aid_growth', 'State aid growth', 'State supplemental aid after FY2027 (General Fund)'],
    ['enrollment_change_pct', 'Enrollment change', 'A year (General Fund)'],
    ['health_growth', 'Health insurance growth', 'A year (General Fund)'],
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
`;
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
  const PI = { key: null, fy: null, open: null };
  async function vProgInitiatives(c) {
    const d = c.district, rows = await loadCapitalRows(d);
    if (!rows.settings || !rows.scenarios.length) return notReady(c, { rows });
    const board = rows.scenarios.find((x) => x.is_board_version);
    if (!board) return `<div class="card"><h3>No board version yet</h3><p>Progress is tracked against the plan the board adopted. On the capital plan, make one scenario the board version.</p>
      <a class="btn primary" href="#/d/${enc(d.slug)}/resources/capital">Capital plan</a></div>`;
    const [accounts, batches] = await Promise.all([
      HG.db.selectAll('gl_account', `select=*&district_id=eq.${d.id}`).catch(() => []),
      HG.db.select('import_batch', `select=id,kind,status,period_end,fiscal_year&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc`).catch(() => []),
    ]);
    const latest = HGActuals.latestByYear(batches), batchIds = Object.values(latest).map((x) => x.id);
    const sugg = c.finance ? HGActuals.suggestLinks(accounts, rows.initiatives) : [];
    const wanted = accounts.filter((a) => a.initiative_id).map((a) => a.id).concat(sugg.map((x) => x.account.id));
    const amounts = batchIds.length && wanted.length
      ? await HG.db.selectAll('gl_amount', `select=batch_id,account_id,ytd_amount,encumbered,budget_amount&batch_id=in.(${batchIds.join(',')})&account_id=in.(${wanted.join(',')})`).catch(() => []) : [];
    const act = HGActuals.actuals(accounts, amounts, batches);
    const inp = HGCapital.buildInputs(rows, board.id), cfg = inp.cfg;
    if (PI.key !== d.id) { PI.key = d.id; PI.fy = null; PI.open = null; }
    const fys = Object.keys(latest).map(Number).sort((x, y) => y - x);
    const fy = PI.fy || fys[0] || cfg.start;
    PI.ctx = { rows, board, inp, act, accounts, amounts, latest, fy, sugg };
    const plan = HGActuals.planned(inp.projects, inp.levers, cfg, fy);
    const INIT = new Map(rows.initiatives.map((i) => [i.id, i])), STATUS = Object.fromEntries(INIT_STATUS);
    const ids = [...new Set(inp.projects.map((p) => String(p.id)).concat(Object.keys(act.byInitiative)))].filter((id) => INIT.has(id));
    const fmt = (v) => '$' + Math.round(v || 0).toLocaleString('en-US');
    const through = act.through[fy];
    const items = ids.map((id) => {
      const i = INIT.get(id), p = inp.projects.find((x) => String(x.id) === id), a = (act.byInitiative[id] || {})[fy] || null;
      const phases = p ? p.phases : [], done = phases.filter((ph) => ph.status === 'done').length;
      const pl = plan[id] || 0, spent = a ? a.spent : 0, encd = a ? a.encumbered : 0;
      let note = '';
      if (pl > 0.5 && spent + encd > pl * 1.05) note = `<span class="gaptext">Over plan by ${fmt(spent + encd - pl)}</span>`;
      else if (pl < 0.5 && spent > 0.5) note = '<span class="gaptext">Spending, but nothing planned this year</span>';
      else if (pl > 0.5 && through && spent + encd < 0.5) note = '<span class="muted">No spending yet</span>';
      return { id, i, p, phases, done, pl, spent, encd, a, note };
    }).filter((x) => x.pl > 0.5 || x.a || x.phases.some((ph) => cfg.start + ph.year === fy));
    items.sort((x, y) => (y.pl - x.pl) || x.i.name.localeCompare(y.i.name));
    const tot = items.reduce((t, x) => ({ pl: t.pl + x.pl, spent: t.spent + x.spent, encd: t.encd + x.encd }), { pl: 0, spent: 0, encd: 0 });
    { const flagged = items.filter((x) => /gaptext/.test(x.note)).length;
      setLead(items.length ? `In FY${fy}, <b>${fmtK(tot.spent)}</b> spent and ${fmtK(tot.encd)} committed, against ${fmtK(tot.pl)} planned${flagged ? `; <b>${flagged}</b> initiative${flagged === 1 ? ' needs' : 's need'} a look` : ''}.` : `Nothing is planned or spent in FY${fy}.`); }
    const nameOf = (id) => (INIT.get(id) || {}).name || '';
    const linkCard = c.finance && sugg.length ? `<div class="card"><h3>Link spending to initiatives</h3>
      <p class="small muted">Capital-fund spending accounts from the monthly ledger that aren’t linked to an initiative yet. Linking counts their spending toward that initiative; it doesn’t change the fund balances.</p>
      <div class="scroll"><table class="data"><thead><tr><th>Account</th><th>Description</th><th>Initiative</th><th></th></tr></thead><tbody>
        ${sugg.map((x) => `<tr><td><code>${esc(x.account.code)}</code></td><td>${esc(x.account.description || '')}</td>
          <td><select data-pi-link="${esc(x.account.id)}" aria-label="Initiative for ${esc(x.account.code)}"><option value="">Not an initiative</option>${rows.initiatives.map((i) => `<option value="${esc(i.id)}" ${i.id === x.initiativeId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
            ${x.initiativeId ? `<br><span class="small muted">Suggested: ${esc(x.why)}</span>` : ''}</td>
          <td><button type="button" class="btn small" data-action="piLink" data-id="${esc(x.account.id)}">Link</button></td></tr>`).join('')}
      </tbody></table></div>
      ${sugg.some((x) => x.initiativeId) ? '<div style="margin-top:10px"><button type="button" class="btn primary" data-action="piLinkAll">Link all suggested</button></div>' : ''}</div>` : '';
    const detail = (x) => {
      const ph = rows.phases.filter((r) => r.scenario_id === board.id && r.initiative_id === x.id).sort((a2, b2) => a2.fy - b2.fy || a2.seq - b2.seq);
      const linked = accounts.filter((a) => a.initiative_id === x.id);
      const canEdit = c.plan || c.finance;
      return `<tr class="pidetail"><td colspan="9"><div class="stack" style="gap:10px">
        ${ph.length ? `<table class="data"><thead><tr><th>Year</th><th>Phase</th><th class="num">Planned (today’s $)</th><th>Status</th><th>Started</th><th>Finished</th><th class="num">Actual cost</th><th></th></tr></thead><tbody>
          ${ph.map((r) => { const ledger = ((act.byInitiative[x.id] || {})[r.fy] || {}).spent; return `<tr data-pi-phase="${esc(r.id)}">
            <td>FY${r.fy}</td><td>${esc(r.label || '')}</td><td class="num">${fmt(r.cost)}</td>
            <td>${canEdit ? `<select name="status">${[['planned', 'Planned'], ['underway', 'Underway'], ['done', 'Done']].map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : esc(r.status)}</td>
            <td>${canEdit ? `<input type="date" name="start" value="${esc(r.start_date || '')}">` : esc(r.start_date || '')}</td>
            <td>${canEdit ? `<input type="date" name="done" value="${esc(r.done_date || '')}">` : esc(r.done_date || '')}</td>
            <td class="num">${canEdit ? `<input name="actual" inputmode="decimal" value="${r.actual_cost == null ? '' : Number(r.actual_cost).toLocaleString('en-US')}" placeholder="When done">` : (r.actual_cost == null ? '' : fmt(r.actual_cost))}
              ${canEdit && ledger ? `<br><a href="#" class="small" data-action="piUseLedger" data-amount="${Math.round(ledger * 100) / 100}">Use the ledger: ${fmt(ledger)}</a>` : ''}</td>
            <td>${canEdit ? '<button type="button" class="btn small" data-action="piSavePhase">Save</button>' : ''}</td></tr>`; }).join('')}
        </tbody></table>` : '<p class="muted">No one-time phases in the board version.</p>'}
        <div class="small"><b>Linked spending accounts:</b> ${linked.length ? linked.map((a) => `<code>${esc(a.code)}</code> ${esc(a.description || '')}${c.finance ? ` <a href="#" data-action="piUnlink" data-id="${esc(a.id)}">Unlink</a>` : ''}`).join(' · ') : '<span class="muted">none yet</span>'}</div>
        <p class="small muted">The board version stays locked: recording progress changes only status, dates and actual cost, and each change is in the activity log. A finished phase’s actual cost replaces its estimate in the capital plan.</p>
      </div></td></tr>`;
    };
    return `
      <div class="row">
        <label class="chip"><span class="small muted">Fiscal year</span><select data-pi-fy aria-label="Fiscal year">${cfg.years.map((y) => `<option value="${y}" ${y === fy ? 'selected' : ''}>FY${y}${act.through[y] ? '' : ' (no ledger yet)'}</option>`).join('')}</select></label>
        <span class="small muted">${through ? `Spending from the monthly ledger through ${esc(day(through))}.` : `No monthly ledger for FY${fy} yet.${c.finance ? ` <a href="#/d/${enc(d.slug)}/progress/uploads">Upload the month-end export</a>.` : ''}`} Against <b>${esc(board.name)}</b>, the board version.</span>
      </div>
      ${linkCard}
      <div class="card"><div class="scroll"><table class="data pitable"><thead><tr><th>Initiative</th><th>Priority</th><th>Status</th><th>Phases done</th><th class="num">Planned FY${fy}</th><th class="num">Spent</th><th class="num">Encumbered</th><th class="num">Remaining</th><th></th></tr></thead><tbody>
        ${items.map((x) => `<tr><td><a href="#" data-action="piOpen" data-id="${esc(x.id)}" aria-expanded="${PI.open === x.id}">${esc(x.i.name)}</a></td>
          <td>${esc(HGUploads.TIER_WORD[HGRanking.tierOf(x.i).tier] || '')}</td><td><span class="st st-${esc(x.i.status || 'proposed')}">${esc(STATUS[x.i.status || 'proposed'])}</span></td>
          <td>${x.phases.length ? `${x.done} of ${x.phases.length}` : '<span class="muted">yearly only</span>'}</td>
          <td class="num">${fmt(x.pl)}</td><td class="num">${x.a ? fmt(x.spent) : '<span class="muted">—</span>'}</td><td class="num">${x.a ? fmt(x.encd) : ''}</td>
          <td class="num">${x.pl > 0.5 ? fmt(x.pl - x.spent - x.encd) : ''}</td><td>${x.note}</td></tr>${PI.open === x.id ? detail(x) : ''}`).join('') || '<tr><td colspan="9" class="muted">Nothing planned or spent in this year.</td></tr>'}
      </tbody>${items.length ? `<tfoot><tr><th colspan="4">${items.length} initiative${items.length === 1 ? '' : 's'}</th><th class="num">${fmt(tot.pl)}</th><th class="num">${fmt(tot.spent)}</th><th class="num">${fmt(tot.encd)}</th><th class="num">${fmt(tot.pl - tot.spent - tot.encd)}</th><th></th></tr></tfoot>` : ''}</table></div>
      <p class="small muted" style="margin-top:8px">Planned is the board version’s cost for the year, with inflation (finished phases at their actual cost). Spent and encumbered come from spending accounts linked to each initiative. Click an initiative to record progress.</p></div>`;
  }
  async function piSavePhase(el) {
    const tr = el.closest('[data-pi-phase]'), v = (n) => tr.querySelector(`[name=${n}]`).value;
    const status = v('status'), actual = toNum(v('actual'));
    if (actual !== null && (isNaN(actual) || actual < 0)) throw new UserError('Actual cost must be a number of dollars.');
    if (status === 'done' && actual === null) throw new UserError('Enter the actual cost when a phase is done (use the ledger amount if it’s right).');
    await HG.db.rpc('set_phase_progress', { p_phase: tr.dataset.piPhase, p_status: status, p_start: v('start') || null, p_done: v('done') || null, p_actual: status === 'done' ? actual : null });
    toast('Progress saved', status === 'done' ? 'The phase is done; its actual cost now counts in the capital plan.' : 'Saved.'); here();
  }
  async function piLink(id, initiativeId) {
    await HG.db.update('gl_account', `id=eq.${enc(id)}`, initiativeId ? { initiative_id: initiativeId, maps_to: 'initiative' } : { initiative_id: null, maps_to: 'expense' });
  }


  /* business staff: is the monthly ledger current? */
  function ledgerNote(c, batches) {
    if (!c.finance) return '';
    const gl = (batches || []).filter((b) => b.kind === 'gl_monthly' && b.status === 'applied' && b.period_end).sort((x, y) => (x.period_end < y.period_end ? 1 : -1));
    const st = HGBudget.ledgerStatus(gl.length ? gl[0].period_end : null);
    const link = `<a href="#/d/${enc(c.district.slug)}/progress/uploads">Upload the month-end export</a>`;
    if (!st.has) return `<div class="notice">Bring in the business office’s month-end export each month to keep balances, spending and budget current. ${link}.</div>`;
    if (!st.stale) return '';
    return `<div class="notice">The ledger is through ${esc(day(gl[0].period_end))}. The close for ${esc(day(st.nextMonthEnd))} is usually ready by now. ${link} to keep balances current.</div>`;
  }
  const BA = { key: null, fy: null, method: 'budget', fund: null };
  async function vActuals(c) {
    const d = c.district;
    const batches = await HG.db.select('import_batch', `select=id,kind,status,period_end,fiscal_year&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc`).catch(() => []);
    const latest = HGActuals.latestByYear(batches), fys = Object.keys(latest).map(Number).sort((x, y) => y - x);
    if (!fys.length) return `<div class="card"><h3>No monthly ledger yet</h3><p>Budget against actual comes from the business office’s month-end export: its budget, year-to-date and encumbered columns.</p>
      ${c.finance ? `<a class="btn primary" href="#/d/${enc(d.slug)}/progress/uploads">Upload a month-end export</a>` : '<p class="muted">It appears once the business office uploads one.</p>'}</div>`;
    if (BA.key !== d.id) { BA.key = d.id; BA.fy = null; BA.fund = null; BA.late = null; BA.early = null; }
    const fy = BA.fy && latest[BA.fy] ? BA.fy : fys[0], batch = latest[fy];
    const [accounts, amounts] = await Promise.all([
      HG.db.selectAll('gl_account', `select=id,code,fund_code,function_code,maps_to,mapped_fund,sign&district_id=eq.${d.id}`),
      HG.db.selectAll('gl_amount', `select=account_id,ytd_amount,budget_amount,encumbered&batch_id=eq.${batch.id}`),
    ]);
    const S = HGBudget.summarize(accounts, amounts, batch.period_end, BA.method);
    // compare two months: the later defaults to this year's latest, the earlier to the import before it
    const all = batches.slice().sort((x, y) => (x.period_end < y.period_end ? 1 : -1));
    const late = all.find((b) => b.id === BA.late) || batch;
    const early = all.find((b) => b.id === BA.early && b.id !== late.id) || all.find((b) => b.period_end < late.period_end) || null;
    let cmpHtml = '';
    if (early) {
      const [amtE, amtL] = await Promise.all([
        HG.db.selectAll('gl_amount', `select=account_id,ytd_amount,budget_amount,encumbered&batch_id=eq.${early.id}`),
        late.id === batch.id ? Promise.resolve(amounts) : HG.db.selectAll('gl_amount', `select=account_id,ytd_amount,budget_amount,encumbered&batch_id=eq.${late.id}`),
      ]);
      const cm = HGBudget.compareMonths(accounts, amtE, amtL, early, late);
      const f$ = (v) => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
      const chg = (v) => (Math.abs(v) < 0.5 ? '<span class="muted">no change</span>' : `<span class="small">${v > 0 ? '+' : '−'}$${Math.round(Math.abs(v)).toLocaleString('en-US')}</span>`);
      const opt = (sel) => all.map((b) => `<option value="${esc(b.id)}" ${b.id === sel ? 'selected' : ''}>${esc(day(b.period_end))}</option>`).join('');
      cmpHtml = `<div class="card"><h3>Compare two months</h3>
        <div class="inline-form"><label class="field">Earlier<select data-ba="early">${opt(early.id)}</select></label><label class="field">Later<select data-ba="late">${opt(late.id)}</select></label></div>
        ${cm.sameYear ? '' : '<p class="small">These months are in different fiscal years. Year-to-date figures restart each July, so compare them side by side rather than by the change.</p>'}
        <div class="scroll"><table class="data"><thead><tr><th>Fund</th><th class="num">Received, ${esc(day(early.period_end))}</th><th class="num">${esc(day(late.period_end))}</th><th class="num">Change</th>
          <th class="num">Spent, ${esc(day(early.period_end))}</th><th class="num">${esc(day(late.period_end))}</th><th class="num">Change</th><th class="num">Encumbered now</th></tr></thead><tbody>
          ${cm.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${f$(r.received.early)}</td><td class="num">${f$(r.received.late)}</td><td class="num">${cm.sameYear ? chg(r.received.change) : ''}</td>
            <td class="num">${f$(r.spent.early)}</td><td class="num">${f$(r.spent.late)}</td><td class="num">${cm.sameYear ? chg(r.spent.change) : ''}</td><td class="num">${f$(r.encumbered.late)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }
    const fund = S.funds.find((f) => f.key === BA.fund) || S.funds.find((f) => f.key === 'general') || S.funds[0];
    const fmt = (v) => (v == null ? '' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US'));
    const pctTxt = (v) => (v == null ? '' : Math.round(v * 100) + '%');
    { const gfund = S.funds.find((f2) => f2.key === 'general'), over = S.funds.filter((f2) => f2.spending.budget && f2.spending.variance > 0.5);
      setLead(`Through ${esc(day(batch.period_end))}, ${pctTxt(S.gone)} of the year:` + (gfund && gfund.revenue.budget ? ` the General Fund has received <b>${pctTxt(gfund.revenue.used)}</b> of its revenue budget and spent or committed <b>${pctTxt(gfund.spending.used)}</b> of its spending budget.` : ' see each fund below.')
        + (over.length ? ` ${over.map((f2) => esc(f2.name)).join(' and ')} ${over.length === 1 ? 'is' : 'are'} forecast over budget.` : '')); }
    const bar = (used, spending) => used == null ? '' : `<span class="ubar" title="${pctTxt(used)} of budget; ${pctTxt(S.gone)} of the year gone">
      <i style="width:${Math.min(100, Math.max(0, used * 100)).toFixed(1)}%" class="${spending && used > S.gone + 0.1 ? 'hot' : ''}"></i><b style="left:${(S.gone * 100).toFixed(1)}%"></b></span>`;
    const spendVar = (o) => (!o.budget ? '' : o.variance > 0.5 ? `<span class="gaptext">over by ${fmt(o.variance)}</span>` : o.variance < -0.5 ? `<span class="ok">under by ${fmt(-o.variance)}</span>` : '<span class="muted">on budget</span>');
    const revVar = (o) => (!o.budget ? '' : o.variance < -0.5 ? `<span class="gaptext">short by ${fmt(-o.variance)}</span>` : o.variance > 0.5 ? `<span class="ok">ahead by ${fmt(o.variance)}</span>` : '<span class="muted">on budget</span>');
    const fns = Object.entries(fund ? fund.byFunction : {}).sort((x, y) => x[0].localeCompare(y[0]));
    return `
      <div class="row">
        <label class="chip"><span class="small muted">Fiscal year</span><select data-ba="fy" aria-label="Fiscal year">${fys.map((y) => `<option value="${y}" ${y === fy ? 'selected' : ''}>FY${y}</option>`).join('')}</select></label>
        <label class="chip"><span class="small muted">Forecast</span><select data-ba="method" aria-label="Forecast method"><option value="budget" ${BA.method === 'budget' ? 'selected' : ''}>Budget, unless already exceeded</option><option value="pace" ${BA.method === 'pace' ? 'selected' : ''}>Rest of the year at the budget’s pace</option><option value="straight" ${BA.method === 'straight' ? 'selected' : ''}>Straight line from this year so far</option></select></label>
        <span class="small muted">From the ledger through <b>${esc(day(batch.period_end))}</b>: ${pctTxt(S.gone)} of the fiscal year gone.</span>
      </div>
      ${ledgerNote(c, batches)}
      ${S.hasBudget ? '' : '<div class="notice">This month’s export has no budget column, so only actuals show. Include the budget in the export (most systems can), and HighGround will compare against it.</div>'}
      <div class="card"><h3>Every fund</h3><div class="scroll"><table class="data"><thead><tr><th>Fund</th><th class="num">Revenue budget</th><th class="num">Received</th><th class="num">Year-end forecast</th><th></th><th class="num">Spending budget</th><th class="num">Spent</th><th class="num">Encumbered</th><th class="num">Year-end forecast</th><th></th></tr></thead><tbody>
        ${S.funds.map((f) => `<tr><td><a href="#" data-action="baFund" data-k="${esc(f.key)}">${esc(f.name)}</a></td>
          <td class="num">${fmt(f.revenue.budget)}</td><td class="num">${fmt(f.revenue.actual)}</td><td class="num">${fmt(f.revenue.forecast)}</td><td class="small">${revVar(f.revenue)}</td>
          <td class="num">${fmt(f.spending.budget)}</td><td class="num">${fmt(f.spending.actual)}</td><td class="num">${fmt(f.spending.encumbered)}</td><td class="num">${fmt(f.spending.forecast)}</td><td class="small">${spendVar(f.spending)}</td></tr>`).join('')}
      </tbody></table></div></div>
      ${fund ? `<div class="card"><h3>${esc(fund.name)}</h3>
        <div class="grid tiles">
          <div class="card tile-card"><div class="small muted">Revenue received</div><div class="stat">${fmt(fund.revenue.actual)}</div><div class="small muted">of ${fmt(fund.revenue.budget)} budgeted · ${pctTxt(fund.revenue.used)}</div>${bar(fund.revenue.used, false)}</div>
          <div class="card tile-card"><div class="small muted">Revenue forecast</div><div class="stat">${fmt(fund.revenue.forecast)}</div><div class="small">${revVar(fund.revenue)}</div></div>
          <div class="card tile-card"><div class="small muted">Spent and encumbered</div><div class="stat">${fmt(fund.spending.actual + fund.spending.encumbered)}</div><div class="small muted">of ${fmt(fund.spending.budget)} budgeted · ${pctTxt(fund.spending.used)}</div>${bar(fund.spending.used, true)}</div>
          <div class="card tile-card"><div class="small muted">Spending forecast</div><div class="stat">${fmt(fund.spending.forecast)}</div><div class="small">${spendVar(fund.spending)}</div></div>
        </div>
        ${fns.length ? `<h3 style="margin-top:14px">Spending by function</h3><div class="scroll"><table class="data batable"><thead><tr><th>Function</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Encumbered</th><th class="num">Available</th><th>Used vs. year gone</th><th class="num">Year-end forecast</th><th></th></tr></thead><tbody>
          ${fns.map(([k, x]) => `<tr><td>${esc(x.name)}</td><td class="num">${fmt(x.budget)}</td><td class="num">${fmt(x.actual)}</td><td class="num">${fmt(x.encumbered)}</td><td class="num">${fmt(x.available)}</td>
            <td>${bar(x.used, true)} <span class="small muted">${pctTxt(x.used)}</span></td><td class="num">${fmt(x.forecast)}</td><td class="small">${spendVar(x)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
        <p class="small muted" style="margin-top:8px">The bar is budget used (spent plus encumbered); the line marks how much of the year has gone. ${BA.method === 'budget' ? 'Forecast: the budget, unless spending plus encumbrances (or revenue received) has already passed it.' : BA.method === 'pace' ? 'Forecast: actual so far plus the budget’s share for the rest of the year; suits steady items such as salaries, not front-loaded projects.' : 'Forecast: this year so far, extended to twelve months. Lumpy items, such as property taxes received in autumn and spring, can mislead this method.'}</p></div>` : ''}
      ${cmpHtml}`;
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
          ${(rows.priorities || []).length ? '' : '<span class="hint">Add strategic priorities on Direction → Priorities.</span>'}</label>
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
        ${dec && pid ? `<button type="button" class="btn" data-action="pkFromEditor" data-id="${esc(pid)}">Decision packet</button>` : ''}
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
    const kinds = [c.finance && ['gl_monthly', 'Monthly GL export'], c.plan && ['projects', 'Projects'], c.finance && ['budget', 'Adopted budget (by account)'], c.finance && ['balances', 'Fund balances only (if you can’t export the ledger)']].filter(Boolean);
    const later = [
      c.plan && `<a class="btn" href="#/d/${enc(c.district.slug)}/direction/priorities">Goals (on Direction → Priorities)</a>`, (c.plan || c.finance) && `<a class="btn" href="#/d/${enc(c.district.slug)}/direction/measures">Measure results (on Direction → Measures)</a>`,
      c.plan && `<a class="btn" href="#/d/${enc(c.district.slug)}/direction/community">Survey results (on Direction → Community)</a>`,
    ].filter(Boolean);
    return `
      ${ledgerNote(c, rows)}
      ${kinds.length ? `<div class="card"><h3>Upload a file</h3>
        <div class="inline-form">
          <label class="field">What’s in it<select data-upload-kind>${kinds.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field">File (.csv or .xlsx)<input type="file" data-upload-file accept=".csv,.xlsx,.txt"></label>
        </div>
        <p class="small muted" style="margin-top:10px">Nothing changes until you review what HighGround read and click Apply. The original file is kept.
          Templates: <a href="#" data-action="downloadTemplate" data-kind="projects">projects</a>, <a href="#" data-action="downloadTemplate" data-kind="balances">fund balances</a>${c.finance ? ', <a href="#" data-action="downloadTemplate" data-kind="gl">a sample month-end GL export</a> (fictional)' : ''}.</p>
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
    if (UP.file.size > 10 * 1024 * 1024) throw new UserError('That file is over 10 MB. Month-end exports and project lists are usually far smaller; check it’s the right file.');
    UP.rows = await HGUploads.readTable(UP.file);
    if (UP.kind === 'projects') {
      if (!UP.startFY) throw new UserError('Set up Starting numbers first, so HighGround knows which years the plan covers.');
      UP.parsed = HGUploads.parseProjects(UP.rows, UP.startFY, UP.years || 10);
    } else if (UP.kind === 'gl_monthly' || UP.kind === 'budget') {
      const d = S.district.id;
      const [accounts, set] = await Promise.all([
        HG.db.selectAll('gl_account', `select=*&district_id=eq.${d}`),
        HG.db.select('district_settings', `select=gl_layout&district_id=eq.${d}`).catch(() => []),
      ]);
      UP.gl = { accounts, saved: (set[0] && set[0].gl_layout) || null, sel: {}, cols: null };
      glParse();
    } else UP.parsed = HGUploads.parseBalances(UP.rows);
    box.innerHTML = reviewHtml();
  }
  /* ---- monthly GL export: columns, new accounts, balances preview ---- */
  const GL_MAPS = [['fund_balance', 'Fund balance'], ['revenue', 'Revenue'], ['expense', 'Spending'], ['ignore', 'Leave out'], ['unmapped', 'Decide later']];
  const GL_FUNDS = [['save', 'SAVE'], ['ppel', 'PPEL'], ['vppel', 'V-PPEL'], ['grants', 'Grants'], ['general', 'General Fund'], ['debt_levy', 'Debt Service'], ['other', 'Other']];
  const GL_COLS = [['account', 'Account code'], ['description', 'Description'], ['month', 'Month to date'], ['ytd', 'Year to date'], ['budget', 'Budget'], ['encumbered', 'Encumbered']];
  const normCell = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function glParse() {
    const G = UP.gl, detected = HGGL.detectLayout(UP.rows);
    let layout = detected;
    const headerCells = (UP.rows[detected.header] || []).map(normCell);
    if (G.cols) layout = { header: detected.header, cols: G.cols };
    else if (G.saved && JSON.stringify(G.saved.headerCells) === JSON.stringify(headerCells)) layout = { header: detected.header, cols: G.saved.cols, remembered: true };
    layout.missing = [];
    if (layout.cols.account == null && layout.cols.fund == null) layout.missing.push('account');
    if (UP.kind === 'budget' ? layout.cols.budget == null : (layout.cols.ytd == null && layout.cols.balance == null)) layout.missing.push(UP.kind === 'budget' ? 'budget' : 'ytd');
    G.layout = layout; G.headerCells = headerCells;
    G.P = HGGL.parse(UP.rows, layout);
    G.rec = HGGL.reconcile(G.P.lines, G.accounts);
    G.rec.fresh.forEach((f) => { if (!G.sel[f.line.code]) G.sel[f.line.code] = Object.assign({}, f.suggestion); });
    const issues = G.P.issues.map((i) => ({ l: i.level === 'error' ? 'e' : 'w', m: i.text, row: i.row }));
    layout.missing.forEach((k) => issues.unshift({ l: 'e', m: k === 'account' ? 'HighGround couldn’t find the account-code column. Choose it under “Columns”.' : k === 'budget' ? 'HighGround couldn’t find the budget column. Choose it under “Columns”.' : 'HighGround couldn’t find the year-to-date amount column. Choose it under “Columns”.' }));
    UP.parsed = { issues };
  }
  function glMapping() {
    const G = UP.gl, m = {};
    G.rec.known.forEach((k) => { m[k.line.code] = { maps_to: k.account.maps_to, mapped_fund: k.account.mapped_fund, sign: k.account.sign }; });
    Object.assign(m, G.sel);
    return m;
  }
  function glBalancesHtml() {
    const G = UP.gl, B = HGGL.balances(G.P.lines, glMapping()), asOf = (document.querySelector('[data-upload-asof]') || {}).value;
    const order = ['save', 'ppel', 'vppel', 'grants', 'debt_levy', 'general'].filter((f) => B[f]);
    if (!order.length) return '<p class="muted">No accounts are matched to a fund yet.</p>';
    const fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
    return `<div class="scroll"><table class="data"><thead><tr><th>Fund</th><th class="num">Fund balance accounts</th><th class="num">+ Revenue, year to date</th><th class="num">− Spending, year to date</th><th class="num">= Balance${asOf ? ' at ' + esc(day(asOf)) : ''}</th><th></th></tr></thead><tbody>
      ${order.map((f) => { const x = B[f]; return `<tr><td>${HGGL.FUND_NAME[f]}</td><td class="num">${fmt(x.equity)}</td><td class="num">${fmt(x.revenue)}</td><td class="num">${fmt(x.spending)}</td><td class="num"><b>${fmt(x.balance)}</b></td>
        <td>${x.hasEquity ? '<span class="st st-approved">Will update</span>' : '<span class="small muted">Won’t update: no fund-balance account matched</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:6px">Check these against the business office’s own fund balance report before applying. Applying makes them the plan’s balances as of that date.</p>`;
  }
  function glReviewHtml() {
    const G = UP.gl, errs = UP.parsed.issues.filter((i) => i.l === 'e'), warns = UP.parsed.issues.filter((i) => i.l !== 'e');
    const last = new Date(); last.setDate(0);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const colOpt = (k) => `<option value="">Not in this file</option>${G.headerCells.map((h, i) => `<option value="${i}" ${G.layout.cols[k] === i ? 'selected' : ''}>${esc((UP.rows[G.layout.header] || [])[i] || 'Column ' + (i + 1))}</option>`).join('')}`;
    const opt = (list, v) => list.map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('');
    const fmt = (v) => (v == null ? '' : '$' + Math.round(v).toLocaleString('en-US'));
    return `<div class="card"><h3>Review: ${esc(UP.file.name)}</h3>
      ${UP.kind === 'budget' ? `<div class="inline-form"><label class="field">Budget for<select data-upload-fy>${[0, 1, 2].map((k) => { const y = (UP.startFY || new Date().getFullYear() + 1) + k - 1; return `<option value="${y}" ${k === 1 ? 'selected' : ''}>FY${y}</option>`; }).join('')}</select></label></div>`
        : `<div class="inline-form"><label class="field">Month-end date<input type="date" data-upload-asof value="${iso(last)}"></label></div>`}
      ${errs.length ? `<div class="notice error">${errs.map((e) => esc(e.m)).join('<br>')}</div>` : ''}
      ${warns.length ? `<div class="notice">${warns.slice(0, 8).map((e) => esc(e.m)).join('<br>')}${warns.length > 8 ? `<br>and ${warns.length - 8} more` : ''}</div>` : ''}
      <details ${G.layout.missing.length ? 'open' : ''}><summary>Columns${G.layout.remembered ? ': the same layout as last time' : ''}</summary>
        <div class="fgrid" style="margin-top:8px">${GL_COLS.map(([k, l]) => `<label class="field">${l}<select data-gl-col="${k}">${colOpt(k)}</select></label>`).join('')}</div>
        <p class="small muted">HighGround remembers these for next month.</p></details>
      <h3 style="margin-top:14px">${G.rec.fresh.length ? `${G.rec.fresh.length} new account${G.rec.fresh.length === 1 ? '' : 's'} to check` : 'No new accounts'}</h3>
      <p class="small muted">${G.rec.known.length ? `${G.rec.known.length} account${G.rec.known.length === 1 ? '' : 's'} matched from earlier months. ` : ''}${G.rec.fresh.length ? 'HighGround suggests what each new account is from its Iowa account code; change any that are wrong. You won’t be asked about these again.' : ''}</p>
      ${(() => {
        if (!G.rec.fresh.length) return '';
        const row = (f) => { const s2 = G.sel[f.line.code], c = esc(f.line.code); return `<tr><td><code>${c}</code></td><td>${esc(f.line.description)}</td><td class="small">${esc(f.about)}</td><td class="num">${fmt(f.line.ytd)}</td>
          <td><select data-gl-map="${c}" aria-label="Use ${c} as">${opt(GL_MAPS, s2.maps_to)}</select></td>
          <td><select data-gl-fund="${c}" aria-label="Fund for ${c}">${opt(GL_FUNDS, s2.mapped_fund || 'other')}</select></td>
          <td><input type="checkbox" data-gl-sign="${c}" ${s2.sign === -1 ? 'checked' : ''} aria-label="Amounts for ${c} are negative in this export"></td></tr>`; };
        // group by HighGround's first suggestion, so a long first month is a scan: unrecognised accounts open, the rest folded
        const MAPN = Object.fromEntries(GL_MAPS), groups = new Map();
        G.rec.fresh.forEach((f) => { const k = f.suggestion.maps_to === 'unmapped' ? 'unmapped' : `${f.suggestion.mapped_fund || 'other'}|${f.suggestion.maps_to}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
        const order = ['save', 'ppel', 'vppel', 'grants', 'debt_levy', 'general', 'other'], mapOrder = ['fund_balance', 'revenue', 'expense', 'ignore'];
        const keys = [...groups.keys()].sort((x, y) => (x === 'unmapped' ? -1 : y === 'unmapped' ? 1 : 0) || (order.indexOf(x.split('|')[0]) - order.indexOf(y.split('|')[0])) || (mapOrder.indexOf(x.split('|')[1]) - mapOrder.indexOf(y.split('|')[1])));
        const head = '<thead><tr><th>Account</th><th>Description</th><th>Looks like</th><th class="num">Year to date</th><th>Use as</th><th>Fund</th><th>Negative in this export</th></tr></thead>';
        return keys.map((k) => { const list = groups.get(k), [fund, maps] = k.split('|');
          const title = k === 'unmapped' ? `Not recognised: ${list.length} account${list.length === 1 ? '' : 's'} to decide` : `${HGGL.FUND_NAME[fund] || fund}: ${MAPN[maps].toLowerCase()}, ${list.length} account${list.length === 1 ? '' : 's'}`;
          return `<details class="glgroup" ${k === 'unmapped' || G.rec.fresh.length <= 25 ? 'open' : ''}><summary>${esc(title)}</summary>
            <div class="scroll"><table class="data glmap">${head}<tbody>${list.map(row).join('')}</tbody></table></div></details>`; }).join('');
      })()}
      <h3 style="margin-top:14px">${UP.kind === 'budget' ? 'What this budget says' : 'Balances this export gives'}</h3>
      <div id="gl-balances">${UP.kind === 'budget' ? budgetSummaryHtml() : glBalancesHtml()}</div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn primary" data-action="applyUpload" ${errs.length ? 'disabled' : ''}>Apply</button>
        <button type="button" class="btn" data-action="cancelUpload">Cancel</button></div></div>`;
  }
  function budgetSummaryHtml() {
    const G = UP.gl, M = glMapping();
    const lines = G.P.lines.map((l) => ({ fund_code: l.parts.fund, object_code: l.parts.object || l.parts.source || '', account_type: (G.accounts.find((a) => a.code === l.code) || {}).account_type || HGGL.suggest(l.parts).account_type, budget: M[l.code] && M[l.code].maps_to === 'ignore' ? null : l.budget }));
    const b = HGGF.fromBudget(lines), f = HGReport.fmt;
    return `<p>General Fund in this budget: revenue <b>${f(b.revenue)}</b>; staff spending (objects 1xx–2xx) <b>${f(b.staff)}</b>; other spending <b>${f(b.nonstaff)}</b>.</p><p class="small muted">Applying saves it as the adopted budget for that year. The General Fund’s starting figures show these totals as a check.</p>`;
  }
  function reviewHtml() {
    if (UP.kind === 'gl_monthly' || UP.kind === 'budget') return glReviewHtml();
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
    const kind = UP.kind === 'projects' ? 'projects' : UP.kind === 'gl_monthly' ? 'gl_monthly' : UP.kind === 'budget' ? 'budget' : 'balances';
    const budgetFY = kind === 'budget' ? Number((document.querySelector('[data-upload-fy]') || {}).value) : null;
    let asOf = null;
    if (kind === 'balances' || kind === 'gl_monthly') {   // a budget is for a fiscal year, not a date
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
      row_count: UP.rows.length, period_end: asOf, fiscal_year: budgetFY || (asOf ? HGEngine.fyOfDate(asOf) : null) });
    let createdScenario = null;
    try {
      for (let i = 0; i < UP.rows.length; i += 500) {
        await HG.db.insert('import_row', UP.rows.slice(i, i + 500).map((r, k) => ({ batch_id: batchId, district_id: d.id, row_no: i + k + 1, data: r })));
      }
      const issues = UP.parsed.issues.map((x) => ({ batch_id: batchId, district_id: d.id, row_no: x.row || null, severity: x.l === 'e' ? 'error' : 'warning', message: x.m }));
      if (issues.length) await HG.db.insert('import_issue', issues);
      if (kind === 'gl_monthly' || kind === 'budget') {
        const G = UP.gl, fy = budgetFY || HGEngine.fyOfDate(asOf), idOf = new Map(G.accounts.map((a) => [a.code, a.id]));
        const fresh = G.rec.fresh.map((f) => { const sel = G.sel[f.line.code], p = f.line.parts, id = (f.account && f.account.id) || crypto.randomUUID(); idOf.set(f.line.code, id);
          return { id, district_id: d.id, code: f.line.code, fund_code: p.fund || null, facility_code: p.facility || null, function_code: p.function || null, program_code: p.program || null,
            project_code: p.project || null, object_code: p.object || p.source || p.account || null, description: f.line.description || null,
            account_type: HGGL.suggest(p).account_type, maps_to: sel.maps_to, mapped_fund: sel.mapped_fund || null, sign: sel.sign === -1 ? -1 : 1,
            needs_review: sel.maps_to === 'unmapped', first_seen_batch: batchId }; });
        if (fresh.length) await HG.db.upsert('gl_account', fresh, 'district_id,code');
        if (kind === 'budget') {
          const bl = G.P.lines.filter((l) => l.budget != null).map((l) => ({ district_id: d.id, account_id: idOf.get(l.code), fiscal_year: fy, version: 'adopted', amount: l.budget, import_batch_id: batchId }));
          for (let i = 0; i < bl.length; i += 500) await HG.db.upsert('budget_line', bl.slice(i, i + 500), 'account_id,fiscal_year,version');
          UP.glUpdated = null; UP.budgetFY = fy;
        } else {
        const amounts = G.P.lines.map((l) => ({ district_id: d.id, batch_id: batchId, account_id: idOf.get(l.code), fiscal_year: fy, period_end: asOf,
          month_amount: l.month, ytd_amount: l.ytd, budget_amount: l.budget, encumbered: l.encumbered }));
        for (let i = 0; i < amounts.length; i += 500) await HG.db.insert('gl_amount', amounts.slice(i, i + 500));
        await HG.db.update('district_settings', `district_id=eq.${d.id}`, { gl_layout: { headerCells: G.headerCells, cols: G.layout.cols } });
        const B = HGGL.balances(G.P.lines, glMapping());
        UP.glUpdated = ['save', 'ppel', 'vppel', 'grants', 'debt_levy', 'general'].filter((f) => B[f] && B[f].hasEquity).map((f) => HGGL.FUND_NAME[f]);
        }
      } else if (kind === 'projects') {
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
            cost: ph.cost, status: ph.status || 'planned', actual_cost: ph.actual == null ? null : ph.actual, label: ph.label || null });
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
    toast('Upload applied', kind === 'projects' ? `“${scName}” is ready on the capital plan.`
      : kind === 'budget' ? `The adopted FY${UP.budgetFY} budget is in.`
      : kind === 'gl_monthly' ? `The ledger for ${day(asOf)} is in.${UP.glUpdated.length ? ` Balances updated: ${UP.glUpdated.join(', ')}.` : ' No fund balances changed.'}` : `Balances as of ${day(asOf)} saved.`);
    if (kind === 'projects') { CAP.key = d.id; CAP.scenarioId = createdScenario; go(`#/d/${enc(d.slug)}/resources/capital`); }
    else here();
  }
  function saveText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------------------------------------------ views: Reports
  const RP = { key: null, open: null };
  async function vBoardReports(c) {
    const d = c.district;
    if (RP.key !== d.id) { RP.key = d.id; RP.open = null; }
    let [snaps, batches] = await Promise.all([
      HG.db.select('report_snapshot', `select=id,kind,title,period_end,created_at,payload&district_id=eq.${d.id}&kind=in.(board_monthly,decision_packet)&order=period_end.desc,created_at.desc`),
      HG.db.select('import_batch', `select=id,period_end&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc&limit=1`).catch(() => []),
    ]);
    const packets = snaps.filter((x) => x.kind === 'decision_packet');
    if (S.landing && !RP.open) { const latest = snaps.find((x) => x.kind === 'board_monthly'); if (latest) RP.open = latest.id; }
    S.landing = false;
    RP.snaps = snaps = snaps.filter((x) => x.kind !== 'decision_packet');
    if (RP.open) {
      const pk = packets.find((x) => x.id === RP.open);
      if (pk) return packetHtml(c, pk);
      const snap = snaps.find((x) => x.id === RP.open);
      if (snap) {
        const prev = snaps.filter((x) => x.period_end < snap.period_end || (x.period_end === snap.period_end && x.created_at < snap.created_at))[0] || null;
        return reportHtml(c, snap, prev);
      }
    }
    const last = new Date(); last.setDate(0);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const dflt = batches[0] ? batches[0].period_end : iso(last);
    return `
      ${c.plan || c.finance ? `<div class="card"><h3>Create a board report</h3>
        <p class="small muted">Built entirely from HighGround: the board version, fund balances, the month’s ledger, progress on initiatives and decisions ahead. It’s saved exactly as it was made, and the next report compares itself with it.</p>
        <div class="inline-form"><label class="field">Month end<input type="date" data-rp-date value="${esc(dflt)}"></label>
          <button type="button" class="btn primary" data-action="rpCreate">Create the report</button></div>
        ${batches[0] ? `<p class="small muted">The latest monthly ledger is through ${esc(day(batches[0].period_end))}.</p>` : '<p class="small muted">No monthly ledger yet: the report will leave out budget vs. actual and spending.</p>'}</div>` : ''}
      <div class="card"><h3>Board reports</h3>${table([
        { label: 'Month end', html: (r) => `<a href="#" data-action="rpOpen" data-id="${esc(r.id)}">${esc(day(r.period_end))}</a>` },
        { label: 'Report', get: (r) => r.title },
        { label: 'Board version', get: (r) => (r.payload && r.payload.scenario ? r.payload.scenario.name : '') },
        { label: 'Made', get: (r) => day(r.created_at) },
      ], snaps, 'No board reports yet.')}</div>
      <div class="card"><h3>Decision packets</h3>
        <p class="small muted">One initiative on one page: its costs by fund and year, its effect on the gap and on taxpayers, and where it falls on the funding line. Saved as it was made.</p>
        ${c.plan || c.finance ? await packetFormHtml(c) : ''}
        ${table([
          { label: 'Initiative', html: (r) => `<a href="#" data-action="rpOpen" data-id="${esc(r.id)}">${esc(r.payload.initiative.name)}</a>` },
          { label: 'Against', get: (r) => r.payload.scenario.name },
          { label: 'Made', get: (r) => day(r.created_at) },
        ], packets, 'No decision packets yet.')}</div>`;
  }
  async function packetFormHtml(c) {
    const rows = await loadCapitalRows(c.district);
    if (!rows.scenarios.length) return '<p class="muted">Make a scenario first.</p>';
    const board = rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0];
    return `<div class="inline-form">
      <label class="field">Initiative<select data-pk-init>${rows.initiatives.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></label>
      <label class="field">Against<select data-pk-sc>${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === board.id ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>
      <button type="button" class="btn" data-action="pkCreate">Make the packet</button></div>`;
  }
  async function makePacket(initiativeId, scenarioId) {
    const d = S.district, rows = await loadCapitalRows(d);
    const sc = rows.scenarios.find((x) => x.id === scenarioId) || rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0];
    if (!sc) throw new UserError('Make a scenario first; the packet is measured against one.');
    const payload = HGPacket.build(rows, initiativeId, sc.id), id = crypto.randomUUID(), today = new Date().toISOString().slice(0, 10);
    await HG.db.insert('report_snapshot', { id, district_id: d.id, kind: 'decision_packet', title: `Decision packet: ${payload.initiative.name}`.slice(0, 200), period_end: today, scenario_id: sc.id, payload });
    RP.key = d.id; RP.open = id; toast('Packet made', payload.initiative.name);
    go(`#/d/${enc(d.slug)}/reports/board`); here();
  }
  function packetHtml(c, snap) {
    const P = snap.payload, f = HGReport.fmt, I = P.initiative, STATUS = Object.fromEntries(INIT_STATUS), TYPE = Object.fromEntries(INIT_TYPES);
    const FN = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants and donations', boost: 'Boosters', camp: 'Campaign or bond' };
    const sumCol = (k) => P.byFund.reduce((t, r) => t + r.values[k], 0);
    return `<div class="report">
      <div class="row noprint"><a href="#" data-action="rpClose">← All reports</a><span style="flex:1"></span>
        <button type="button" class="btn" data-action="rpPrint">Print or save as PDF</button>
        ${c.admin ? `<button type="button" class="btn danger" data-action="rpDelete" data-id="${esc(snap.id)}">Delete</button>` : ''}</div>
      <div class="rhead"><div class="small muted">Decision packet · ${esc(day(snap.created_at))}</div><h2>${esc(I.name)}</h2>
        <div class="small muted">${esc(TYPE[I.type] || I.type)} · ${esc(STATUS[I.status] || I.status)}${I.tier ? ' · ' + esc(HGUploads.TIER_WORD[I.tier]) : ''}${I.owner ? ' · Owner: ' + esc(I.owner) : ''}${I.area ? ' · ' + esc(I.area) : ''}</div>
        ${I.priority ? `<div class="small">Strategic priority: ${esc(I.priority)}</div>` : ''}
        ${I.description ? `<p style="margin-top:8px">${esc(I.description)}</p>` : ''}</div>
      ${P.inScenario ? '' : `<div class="notice">${esc(I.name)} isn’t in “${esc(P.scenario.name)}”, so it has no costs there.</div>`}
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">One-time cost, all years</div><div class="stat">${f(P.oneTimeAll)}</div><div class="small muted">in each year’s dollars</div></div>
        <div class="card tile-card"><div class="small muted">Yearly cost${P.recur.length ? `, FY${P.years[1]}` : ''}</div><div class="stat">${P.recur.length ? f(P.yearly[1] || 0) : 'None'}</div></div>
        <div class="card tile-card"><div class="small muted">Gap with it / without it</div><div class="stat">${f(P.gap.with)}</div><div class="small">${Math.abs(P.gap.effect) < 0.5 ? '<span class="muted">no effect on the gap</span>' : `without it: ${f(P.gap.without)} <span class="${P.gap.effect > 0 ? 'gaptext' : 'ok'}">(${P.gap.effect > 0 ? 'adds' : 'saves'} ${f(Math.abs(P.gap.effect))})</span>`}</div></div>
        <div class="card tile-card"><div class="small muted">Funding line</div><div class="stat">${P.fundingLine ? '#' + P.fundingLine.position + ' of ' + P.fundingLine.of : '—'}</div><div class="small">${P.fundingLine ? (P.fundingLine.above && P.fundingLine.outsideOnly ? (P.fundingLine.camp ? 'paid by a campaign or bond' : 'paid by boosters') : P.fundingLine.above ? '<span class="ok">fits</span>' : P.fundingLine.fitsAlone ? 'below the line, but would fit on its own' : '<span class="gaptext">below the line</span>') : ''}</div></div>
      </div>
      <div class="card"><h3>Costs by fund and year</h3><p class="small muted">Against “${esc(P.scenario.name)}”${P.scenario.board ? ', the board version' : ''}, in each year’s dollars.</p>
        <div class="scroll"><table class="data"><thead><tr><th>Paid from</th>${P.years.map((y) => `<th class="num">FY${y}</th>`).join('')}<th class="num">Five years</th></tr></thead><tbody>
          ${P.byFund.map((r) => `<tr><td>${esc(FN[r.fund] || r.fund)}</td>${r.values.map((v) => `<td class="num">${v ? f(v) : ''}</td>`).join('')}<td class="num"><b>${f(r.inWindow)}</b></td></tr>`).join('')}
          ${P.yearly.some((v) => v > 0.5) ? `<tr><td>Yearly costs</td>${P.yearly.map((v) => `<td class="num">${v ? f(v) : ''}</td>`).join('')}<td class="num"><b>${f(P.yearly.reduce((a, v) => a + v, 0))}</b></td></tr>` : ''}
        </tbody><tfoot><tr><th>Total</th>${P.years.map((y, k) => `<th class="num">${f(sumCol(k) + (P.yearly[k] || 0))}</th>`).join('')}<th class="num">${f(P.byFund.reduce((t, r) => t + r.inWindow, 0) + P.yearly.reduce((a, v) => a + v, 0))}</th></tr></tfoot></table></div>
        ${P.recur.length ? `<p class="small" style="margin-top:6px">Yearly costs: ${P.recur.map((r) => `${esc(r.kind)} ${f(r.amount)} a year from ${FN[r.fund] || ({ general: 'the General Fund', other: 'other sources' })[r.fund] || r.fund}, FY${r.first}${r.last ? '–FY' + r.last : ' onward'}`).join('; ')}.</p>` : ''}</div>
      <div class="card"><h3>Effect on the plan</h3>
        ${P.lows.length ? `<table class="data"><thead><tr><th>Fund it draws on</th><th class="num">Lowest balance with it</th><th class="num">Without it</th></tr></thead><tbody>
          ${P.lows.map((l) => `<tr><td>${esc(FN[l.fund] || l.fund)}</td><td class="num">${f(l.with)} <span class="small muted">FY${l.withFY}</span></td><td class="num">${f(l.without)} <span class="small muted">FY${l.withoutFY}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">It doesn’t draw on SAVE, PPEL, V-PPEL or grants.</p>'}
        <p class="small" style="margin-top:8px">${P.tax.hasValuation ? (Math.abs(P.tax.with - P.tax.without) < 0.5 ? 'It doesn’t change the added property tax.' : `Added property tax at its highest: $${Math.round(P.tax.with).toLocaleString('en-US')} a year for a $${Math.round(P.tax.homeValue).toLocaleString('en-US')} home with it, $${Math.round(P.tax.without).toLocaleString('en-US')} without.`) : ''}</p>
        ${P.flags.length ? `<p class="small"><b>Funding-line flags:</b> ${P.flags.map(esc).join(' ')}</p>` : ''}</div>
      ${P.others.length ? `<div class="card"><h3>In other scenarios</h3><ul>${P.others.map((o) => `<li>${esc(o.name)}${o.board ? ' (board version)' : ''}: ${f(o.cost)} one-time${o.years.length ? ' in FY' + o.years.join(', ') : ''}${o.yearly ? `, ${f(o.yearly)} a year` : ''} <span class="small muted">(today’s dollars)</span></li>`).join('')}</ul></div>` : ''}
      <p class="small muted">Made by HighGround on ${esc(day(snap.created_at))} from the district’s own data. Figures are as they stood that day.</p>
    </div>`;
  }
  function reportHtml(c, snap, prev) {
    const P = snap.payload, Q = prev ? prev.payload : null, ch = HGReport.changes(P, Q), f = HGReport.fmt;
    const delta = (a, b, goodUp) => { if (b == null || Math.abs(a - b) < 0.5) return ''; const up = a > b; return `<div class="small ${up === goodUp ? 'ok' : 'gaptext'}">${up ? '▲' : '▼'} ${f(Math.abs(a - b))} since ${esc(day(Q.periodEnd))}</div>`; };
    const bal = (k) => (P.balances[k] ? P.balances[k].amount : null), pbal = (k) => (Q && Q.balances[k] ? Q.balances[k].amount : null);
    const gen = (P.budget || []).find((x) => x.key === 'general');
    const STATUS = Object.fromEntries(INIT_STATUS);
    return `<div class="report">
      <div class="row noprint"><a href="#" data-action="rpClose">← All board reports</a><span style="flex:1"></span>
        <button type="button" class="btn" data-action="rpPrint">Print or save as PDF</button>
        ${c.admin ? `<button type="button" class="btn danger" data-action="rpDelete" data-id="${esc(snap.id)}">Delete</button>` : ''}</div>
      <div class="rhead"><div class="small muted">${esc(P.district)}</div><h2>Board report · ${esc(day(P.periodEnd))}</h2>
        <div class="small muted">Board version: ${esc(P.scenario.name)} · ${P.ledgerThrough ? `Ledger through ${esc(day(P.ledgerThrough))}` : 'No monthly ledger in this report'} · Fiscal year ${P.fiscalYear}</div></div>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">Gap to close ${def('gap')}</div><div class="stat">${f(P.plan.gap)}</div>${Q ? delta(P.plan.gap, Q.plan.gap, false) : ''}</div>
        <div class="card tile-card"><div class="small muted">SAVE balance</div><div class="stat">${bal('save') == null ? '—' : f(bal('save'))}</div>${Q && bal('save') != null ? delta(bal('save'), pbal('save'), true) : ''}</div>
        <div class="card tile-card"><div class="small muted">PPEL balance</div><div class="stat">${bal('ppel') == null ? '—' : f(bal('ppel'))}</div>${Q && bal('ppel') != null ? delta(bal('ppel'), pbal('ppel'), true) : ''}</div>
        <div class="card tile-card"><div class="small muted">General Fund spending forecast</div><div class="stat">${gen ? f(gen.spending.forecast) : '—'}</div>${gen && gen.spending.budget ? `<div class="small muted">budget ${f(gen.spending.budget)}</div>` : ''}</div>
      </div>
      <div class="card"><h3>What changed${ch.first ? '' : ` since ${esc(day(ch.since))}`}</h3><ul>${ch.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><h3>The capital plan</h3>
        <p>${esc(P.scenario.name)}, FY${P.plan.start}–FY${P.plan.start + P.plan.years - 1}: <b>${f(P.plan.need)}</b> of capital need; levies and grants pay <b>${f(P.plan.levyFunded)}</b>${P.plan.financed > 0.5 ? `, borrowing or gifts <b>${f(P.plan.financed)}</b>` : ''}; <b class="${P.plan.gap > 0.5 ? 'gaptext' : ''}">${f(P.plan.gap)}</b> left to close.</p>
        ${P.gf ? `<p class="small"><b>General Fund:</b> solvency ${(P.gf.solvency * 100).toFixed(1)}% this year, lowest ${(P.gf.lowest * 100).toFixed(1)}% in FY${P.gf.lowestFY} on the five-year forecast; unspent balance ratio ${(P.gf.unspentRatio * 100).toFixed(1)}%.${P.gf.flags && P.gf.flags.negativeUnspent.length ? ` <span class="gaptext">Spending passes spending authority in FY${P.gf.flags.negativeUnspent.join(', FY')}.</span>` : ''}</p>` : ''}
        ${P.tax ? `<p class="small">Added property tax at its highest (FY${P.tax.fy}): about <b>$${Math.round(P.tax.home).toLocaleString('en-US')} a year</b> for a $${Math.round(P.tax.homeValue).toLocaleString('en-US')} home.</p>` : ''}</div>
      ${(P.budget || []).length ? `<div class="card"><h3>Funds</h3><div class="scroll"><table class="data"><thead><tr><th>Fund</th><th class="num">Balance</th><th class="num">Revenue budget</th><th class="num">Received</th><th class="num">Spending budget</th><th class="num">Spent</th><th class="num">Encumbered</th><th class="num">Spending forecast</th></tr></thead><tbody>
        ${P.budget.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${P.balances[x.key] ? f(P.balances[x.key].amount) : ''}</td><td class="num">${f(x.revenue.budget)}</td><td class="num">${f(x.revenue.actual)}</td><td class="num">${f(x.spending.budget)}</td><td class="num">${f(x.spending.actual)}</td><td class="num">${f(x.spending.encumbered)}</td><td class="num">${f(x.spending.forecast)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
      <div class="card"><h3>Initiatives this year</h3>${(P.progress || []).length ? `<div class="scroll"><table class="data"><thead><tr><th>Initiative</th><th>Status</th><th>Phases done</th><th class="num">Planned FY${P.fiscalYear}</th><th class="num">Spent</th><th class="num">Encumbered</th></tr></thead><tbody>
        ${P.progress.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(STATUS[x.status] || x.status)}</td><td>${x.phases ? `${x.phasesDone} of ${x.phases}` : ''}</td><td class="num">${f(x.planned)}</td><td class="num">${x.spent ? f(x.spent) : ''}</td><td class="num">${x.encumbered ? f(x.encumbered) : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nothing planned or spent this year.</p>'}</div>
      <div class="card"><h3>Decisions ahead</h3>${(P.pending || []).length ? `<p class="small muted">${P.pendingCount} initiative${P.pendingCount === 1 ? '' : 's'} not yet approved, largest first.</p><ul>${P.pending.map((x) => `<li>${esc(x.name)} <span class="small muted">· ${esc(STATUS[x.status] || x.status)}${x.cost ? ' · ' + f(x.cost) + ' in the board version' : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No proposals waiting.</p>'}</div>
      <p class="small muted">Made by HighGround on ${esc(day(snap.created_at))} from the district’s own data, with no hand editing. Figures are as they stood at the month end and don’t change afterwards.</p>
    </div>`;
  }
  async function rpCreate() {
    const d = S.district, date = (document.querySelector('[data-rp-date]') || {}).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new UserError('Choose the month end the report is for.');
    const rows = await loadCapitalRows(d), board = rows.scenarios.find((x) => x.is_board_version);
    if (!board) throw new UserError('Choose a board version on the capital plan first; the report is built from it.');
    const [batches, accounts, balances] = await Promise.all([
      HG.db.select('import_batch', `select=id,kind,status,period_end,fiscal_year&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc`).catch(() => []),
      HG.db.selectAll('gl_account', `select=*&district_id=eq.${d.id}`).catch(() => []),
      HG.db.select('fund_balance', `select=fund,as_of,amount&district_id=eq.${d.id}`),
    ]);
    const batch = batches.find((b) => b.period_end <= date) || null;
    const amounts = batch ? await HG.db.selectAll('gl_amount', `select=account_id,batch_id,ytd_amount,budget_amount,encumbered&batch_id=eq.${batch.id}`) : [];
    const g = gfRun(rows, board.id), ys = g ? g.R.years : null;
    const gf = ys ? (() => { const low = ys.reduce((m, y) => (y.solvency < m.solvency ? y : m), ys[0]); return { solvency: ys[0].solvency, lowest: low.solvency, lowestFY: low.fy, unspentRatio: ys[0].unspentRatio, endBalance: ys[ys.length - 1].balance, endFY: ys[ys.length - 1].fy, flags: g.R.flags }; })() : null;
    const payload = HGReport.build({ district: d, rows, periodEnd: date, batch, accounts, amounts, batches: batch ? [batch] : [], balances, gf });
    const id = crypto.randomUUID();
    const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    await HG.db.insert('report_snapshot', { id, district_id: d.id, kind: 'board_monthly', title: `Board report, ${label}`, period_end: date, scenario_id: board.id, batch_id: batch ? batch.id : null, payload });
    RP.open = id; toast('Report made', `Board report for ${label}.`); here();
  }


  async function vCommunityPage(c) {
    const d = c.district;
    const pubs = await HG.db.select('publication', `select=id,kind,title,published_at,published_by,is_current,withdrawn_at,payload&district_id=eq.${d.id}&kind=eq.board_plan&order=published_at.desc&limit=30`);
    const link = `${HG.appUrl()}#/p/${enc(d.slug)}`, current = pubs.find((p) => p.is_current && !p.withdrawn_at);
    const who = [...new Set(pubs.map((p) => p.published_by).filter(Boolean))];
    const prof = who.length ? await HG.db.select('profile', `select=user_id,full_name,email&user_id=in.(${who.map(enc).join(',')})`).catch(() => []) : [];
    const NAME = Object.fromEntries(prof.map((x) => [x.user_id, x.full_name || x.email]));
    if (CP.key !== d.id) { CP.key = d.id; CP.note = null; CP.holdBack = true; CP.survey = true; }
    let draft = null;
    if (c.admin && d.public_link_enabled) {
      try { draft = (await publicationPayload(d, { holdBack: CP.holdBack, note: '', survey: CP.survey })).payload; } catch (e) { draft = { error: e.message }; }
    }
    const lastNote = current && current.payload ? current.payload.note || '' : (pubs[0] && pubs[0].payload ? pubs[0].payload.note || '' : '');
    const f = HGReport.fmt;
    return `
      <div class="card"><h3>Public link</h3>
        ${d.public_link_enabled
          ? `<p>Anyone with this link sees the published board version, with what-if levers they can move. They can’t change anything, and they see nothing else: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>`
          : '<p>The public link is turned off for this district (Settings, District).</p>'}
        <p>${current ? `Showing <b>${esc(current.title)}</b>, published ${esc(day(current.published_at))}${current.payload && current.payload.heldBack ? ` (${current.payload.heldBack} unapproved held back)` : ''}.` : '<b>Nothing is published.</b> The link says so.'}</p>
        <div class="row">
          ${c.admin && current ? `<button type="button" class="btn danger" data-action="withdrawBoard" data-id="${esc(current.id)}">Take it down</button>` : ''}
          ${current ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open the public page</a>` : ''}
        </div>
        ${c.admin ? '' : '<p class="small muted">Only a district admin can publish.</p>'}</div>
      ${draft ? (draft.error ? `<div class="notice">${esc(draft.error)}</div>` : `<div class="card"><h3>Publish the community page</h3>
        <label class="field">A note to the community <span class="small muted">(optional)</span><textarea data-pub-note maxlength="1500" placeholder="A few sentences about where the plan stands and what the board is deciding next.">${esc(CP.note != null ? CP.note : lastNote)}</textarea></label>
        <label class="row"><input type="checkbox" data-pub-hold ${CP.holdBack ? 'checked' : ''}> Hold back initiatives the board hasn’t approved (ideas, proposals, items being analysed, deferred or declined)</label>
        <label class="row"><input type="checkbox" data-pub-survey ${CP.survey ? 'checked' : ''}> Include “What you told us”: the latest community survey’s priorities and top themes${draft.survey ? ` (${esc(draft.survey.name)})` : CP.survey ? ' <span class="small muted">(no survey yet: add one on Direction → Community)</span>' : ''}</label>
        <p class="small">${draft.shownCount} initiative${draft.shownCount === 1 ? '' : 's'} will show${draft.heldBack ? `; ${draft.heldBack} held back` : ''}. ${draft.holdBack && Math.abs(draft.gap.public - draft.gap.board) > 0.5 ? `The public page’s gap is ${f(draft.gap.public)}; the full board version’s is ${f(draft.gap.board)}.` : `Gap to close: ${f(draft.gap.public)}.`}${draft.done.length ? ` ${draft.done.length} finished phase${draft.done.length === 1 ? '' : 's'} listed under “What we’ve finished.”` : ''}</p>
        ${!draft.shownCount ? '<div class="notice">Nothing would show: every initiative in the board version is still unapproved. Untick “Hold back”, or approve initiatives first.</div>' : ''}
        <div class="row"><button type="button" class="btn" data-action="previewPublic">Preview</button><button type="button" class="btn primary" data-action="publishBoard" ${draft.shownCount ? '' : 'disabled'}>Publish</button></div></div>`) : ''}
      <div class="card"><h3>Publish log</h3>${table([
        { label: 'Published', get: (p) => new Date(p.published_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
        { label: 'By', get: (p) => NAME[p.published_by] || '' },
        { label: 'Version', get: (p) => p.title },
        { label: 'What showed', get: (p) => (p.payload && p.payload.v >= 2 ? `${p.payload.shownCount} initiative${p.payload.shownCount === 1 ? '' : 's'}${p.payload.heldBack ? `, ${p.payload.heldBack} held back` : ''}${p.payload.note ? ', with a note' : ''}` : 'Whole board version') },
        { label: 'Status', get: (p) => (p.withdrawn_at ? 'Taken down' : p.is_current ? 'On the link now' : 'Replaced') },
      ], pubs, 'Nothing published yet.')}</div>
`;
  }
  const CP = { holdBack: true, note: null, survey: true };
  async function previewPublic() {
    const d = S.district, { board, payload } = await publicationPayload(d, publishOpts());
    const html = publicBodyHtml(d, { payload, title: board.name, published_at: new Date().toISOString() });
    modal(`<div class="stack"><div class="row" style="justify-content:space-between"><h2 id="modal-title">Preview: what the public will see</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <div class="pubpreview">${html}</div></div>`);
  }

  const BACKUP_TABLES = ['district_settings', 'fund_balance', 'debt_obligation', 'assumption_set', 'priority', 'outcome', 'measure', 'measure_value',
    'survey', 'survey_result', 'initiative', 'scenario', 'scenario_initiative', 'phase', 'phase_funding', 'recurring_cost', 'financing',
    'project_request', 'import_batch', 'gl_account', 'gl_amount', 'budget_line', 'publication', 'report_snapshot'];
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
      ${c.admin ? `<div class="card"><h3>Restore from a backup</h3>
        <p>Put the district’s plan back to how it was in a backup file made here. Everything in the plan is replaced with the backup’s contents; people, access and the activity log are not touched.</p>
        <p class="small muted">Only a backup of this district can be restored. Before anything is replaced, HighGround downloads a fresh backup of the plan as it is now.</p>
        <input type="file" accept="application/json,.json" data-restore-file hidden>
        <button type="button" class="btn" data-action="restorePick">Choose a backup file</button>
        <div data-restore-review></div></div>` : ''}`;
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
    toast('Backup downloaded', `The whole plan, as one file. Keep it somewhere safe.`);
  }

  const RESTORE = { data: null };
  // order matters: parents before the rows that point to them
  const RESTORE_ORDER = ['district_settings', 'assumption_set', 'priority', 'outcome', 'measure', 'measure_value', 'survey', 'survey_result', 'initiative', 'scenario',
    'scenario_initiative', 'phase', 'phase_funding', 'recurring_cost', 'financing', 'import_batch', 'gl_account', 'gl_amount', 'budget_line', 'fund_balance', 'debt_obligation',
    'project_request', 'publication', 'report_snapshot'];
  // everything in a district's plan, children first; used by restore and by the demo reset (people and access are never touched)
  const ERASE_ORDER = ['publication', 'report_snapshot', 'project_request', 'budget_line', 'gl_amount', 'gl_account', 'scenario', 'measure', 'outcome', 'survey', 'initiative', 'priority', 'assumption_set',
    'debt_obligation', 'fund_balance', 'import_batch', 'district_settings'];
  async function restoreRead(file) {
    const box = document.querySelector('[data-restore-review]');
    let b; try { b = JSON.parse(await file.text()); } catch (e) { throw new UserError('That file isn’t a HighGround backup (it couldn’t be read).'); }
    if (!b || b.kind !== 'HighGround district backup' || !b.tables) throw new UserError('That file isn’t a HighGround backup.');
    if (!b.district || b.district.id !== S.district.id) throw new UserError(`That backup is from ${b.district && b.district.name ? '“' + b.district.name + '”' : 'another district'}. Only a backup of ${S.district.name} can be restored here.`);
    RESTORE.data = b;
    const counts = [['scenario', 'scenario', 'scenarios'], ['initiative', 'initiative', 'initiatives'], ['phase', 'phase', 'phases'], ['recurring_cost', 'yearly cost', 'yearly costs'],
      ['financing', 'financing item', 'financing items'], ['fund_balance', 'fund balance', 'fund balances'], ['debt_obligation', 'debt', 'debts'], ['gl_amount', 'ledger amount', 'ledger amounts'], ['report_snapshot', 'report', 'reports'], ['assumption_set', 'assumption set', 'assumption sets']]
      .map(([t, one, many]) => { const n = (b.tables[t] || []).length; return `${n} ${n === 1 ? one : many}`; }).join(' · ');
    box.innerHTML = `<div class="notice" style="margin-top:12px"><p><b>Backup from ${esc(new Date(b.exported_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</b>${b.exported_by ? `, made by ${esc(b.exported_by)}` : ''}.</p>
      <p class="small">${counts}.</p>
      <button type="button" class="btn danger" data-action="restoreRun">Replace the plan with this backup</button></div>`;
  }
  async function restoreRun() {
    const b = RESTORE.data, d = S.district;
    if (!b) return;
    const typed = prompt(`This replaces ${d.name}’s whole plan with the backup. A backup of the current plan downloads first.\n\nTo confirm, type ${d.slug} (the end of the district’s web address).`);
    if ((typed || '').trim().toLowerCase() !== d.slug) { toast('Not restored', 'What you typed didn’t match, so nothing changed.', 'notbuilt'); return; }
    await exportBackup();   // the safety net, before anything is erased
    try { await restoreWrite(b, d); }
    catch (err) {
      RESTORE.data = null;
      throw new UserError(`The restore stopped partway (${err.message}). The plan may be incomplete. Restore again using the backup that downloaded just before it started.`);
    }
    RESTORE.data = null;
    toast('Plan restored', `${d.name} is back to the backup from ${new Date(b.exported_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}.`);
    here();
  }
  async function restoreWrite(b, d) {
    for (const t of ERASE_ORDER) await HG.db.removeAll(t, `district_id=eq.${d.id}`);
    const locked = [];
    const clean = (t, r) => {
      const x = Object.assign({}, r, { district_id: d.id });
      delete x.created_by; delete x.updated_by;                                  // the person restoring becomes the creator
      if ('owner_user_id' in x) x.owner_user_id = null;                          // accounts in the backup may no longer exist
      if (t === 'project_request' && 'user_id' in x) x.user_id = null;
      if (t === 'scenario') { if (x.is_locked) locked.push(x.id); x.is_locked = false; }   // lock again once its contents are back
      return x;
    };
    for (const t of RESTORE_ORDER) {
      let rows = (b.tables[t] || []).map((r) => clean(t, r));
      // every row in a batch must carry the same fields (an older backup may lack a newer one)
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] === undefined ? null : r[k]])));
      for (let k = 0; k < rows.length; k += 500) await HG.db.insert(t, rows.slice(k, k + 500));
    }
    for (const id of locked) await HG.db.update('scenario', `id=eq.${id}`, { is_locked: true });
  }

  // ---------------------------------------------------------------- activity (audit log)
  const TABLE_NAMES = { assumption_set: 'Assumption set', report_snapshot: 'Report', scenario_initiative: 'Ranking', survey: 'Survey', survey_result: 'Survey result',
    budget_line: 'Adopted budget', gl_amount: 'Ledger amount', project_request: 'Project request', initiative_note: 'Note', attachment: 'Attachment', access_request: 'Access request',
    profile: 'Profile', district: 'District', district_member: 'Member', invitation: 'Invitation', district_settings: 'Starting numbers',
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
  async function uploadLogo(file) {
    const d = S.district;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new UserError('Use a PNG, JPEG or WebP image.');
    if (file.size > 2 * 1024 * 1024) throw new UserError('That image is over 2 MB. Save a smaller copy and try again.');
    const path = `${d.id}/logo-${Date.now()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
    await HG.storage.replace('district-public', path, file);
    const old = d.logo_path;
    await HG.db.update('district', `id=eq.${d.id}`, { logo_path: path });
    if (old) { try { await HG.storage.remove('district-public', [old]); } catch (e) { /* the old file can stay */ } }
    await loadContext(true); toast('Logo updated'); here();
  }
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
      <div class="card"><h3>Logo</h3>
        <div class="row" style="align-items:center;gap:18px">
          ${d.logo_path ? `<img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt="${esc(d.name)} logo" class="logo-preview">` : `<span class="tile big" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>`}
          <div class="stack" style="gap:6px">
            <p class="small muted">Shown in the district menu and on the public board page. PNG, JPEG or WebP, up to 2 MB; a square image works best.</p>
            ${c.admin ? `<div class="row"><label class="btn">${d.logo_path ? 'Replace logo' : 'Upload a logo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo-file hidden></label>
              ${d.logo_path ? '<button type="button" class="btn danger" data-action="removeLogo">Remove</button>' : ''}</div>` : '<p class="small muted">A district admin can change it.</p>'}
          </div></div></div>
      <div class="row">${c.finance ? `<a class="btn" href="#/d/${enc(d.slug)}/settings/setup">Starting numbers</a>` : ''}</div>`;
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
  function showAllHtml(c) {
    if (S.isStaff || c.role === 'admin' || !VIEWS[c.role]) return '';
    return `<div class="card"><h3>Your menu</h3><p class="small muted">HighGround shows the screens most useful to your role. You can see every screen instead; what you’re allowed to change stays the same.</p>
      <label class="row"><input type="checkbox" data-show-all ${showAll() ? 'checked' : ''}> Show every screen</label></div>`;
  }
  async function vAccount(c) {
    const p = S.profile || {};
    return `${showAllHtml(c)}
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
  /* ---- plain-English definitions, used by the Guide and by the little “?” buttons beside terms ---- */
  const TERMS = {
    save: ['SAVE', 'Secure an Advanced Vision for Education: Iowa’s statewide one-cent sales tax for school buildings, equipment and technology. It’s shared by student count, can pay for projects directly, and can back revenue bonds.'],
    ppel: ['PPEL', 'Physical Plant and Equipment Levy: a property tax for buildings, equipment, buses and technology. A school board can levy up to 33 cents per $1,000 of taxable value without a vote.'],
    vppel: ['V-PPEL', 'Voter-approved PPEL: the same uses as PPEL, up to $1.34 per $1,000 of taxable value, for up to 10 years after a public vote.'],
    board_version: ['Board version', 'The scenario the board adopted. Board reports, progress tracking and the community page all use it. It’s usually locked so it can’t change by accident.'],
    scenario: ['Scenario', 'One version of the plan: which projects happen, when, and how they’re paid for. Scenarios can be copied and compared.'],
    gap: ['Gap to close', 'Capital costs in the plan that SAVE, PPEL, V-PPEL and grants can’t cover. Closing it takes a campaign or bond, changes to the plan, or both.'],
    funding_line: ['Funding line', 'Where the money runs out when initiatives are paid for in priority order: everything above it fits; everything below it needs another source or a later year.'],
    encumbered: ['Encumbered', 'Money already committed by a purchase order or contract but not yet paid out.'],
    solvency: ['Solvency ratio', 'The General Fund’s cushion: unassigned and assigned fund balance divided by General Fund revenue (less AEA flowthrough). Many districts aim for 5–10%.'],
    authority: ['Spending authority', 'The most a district may spend from the General Fund in a year: formula funding, plus miscellaneous income, plus unspent balance carried forward.'],
    unspent: ['Unspent balance', 'Spending authority not used, carried into next year. Spending more than the authority requires a corrective plan; two years in a row brings state review.'],
    guarantee: ['Budget guarantee', 'Iowa’s formula guarantees at least 101% of last year’s regular program funding, which matters most when enrollment falls.'],
    ssa: ['State supplemental aid', 'The yearly percentage increase in per-student funding, set by the Legislature. It is 2% for FY2027 ($8,148 state cost per pupil).'],
    dcpp: ['District cost per pupil', 'The per-student amount the school funding formula provides: the state cost per pupil plus any district adjustment.'],
    go_bond: ['General obligation bond', 'Borrowing approved by voters (60% in Iowa), repaid by a property tax called the debt service levy.'],
    rev_bond: ['Revenue bond', 'Borrowing repaid from SAVE receipts. It usually needs a public hearing rather than a vote.'],
    rollback: ['Rollback', 'The share of a property’s assessed value that is actually taxed. The state sets it each year by property type.'],
    assumptions: ['Assumption set', 'The outlook a scenario plans for: inflation, revenue growth, enrollment, settlements and health insurance. Base, Conservative and Growth are common sets.'],
    measure_status: ['Measure status', 'On track: at or ahead of a straight path from the starting point to the target. Off track: behind it. Met: the target is reached. Update owed: no result within the measure’s schedule.'],
    fiscal_year: ['Fiscal year', 'July 1 to June 30, named for the year it ends: FY2027 runs from July 2026 to June 2027.'],
    turnover: ['Turnover savings', 'When experienced staff leave and newer staff join on lower pay, total salaries grow a little slower than the settlement.'],
  };
  /** a small “?” beside a term; tapping it shows the definition */
  const def = (key) => (TERMS[key] ? `<button type="button" class="defn" data-action="define" data-term="${key}" aria-label="What is ${esc(TERMS[key][0])}?">?</button>` : '');
  async function vGuide(c) {
    const r = c.role, link = (path, text) => `<a href="#/d/${enc(c.district.slug)}/${path}">${text}</a>`;
    const start = ['board', 'viewer'].includes(r) && !c.staff ? [
      `Each month, open the latest ${link('reports/board', 'board report')}: what changed, the capital plan, the funds, progress and decisions ahead.`,
      `Before a vote, read the ${link('reports/board', 'decision packet')} for that initiative: its costs, its effect on the plan and where it falls on the funding line.`,
      `For the bigger picture, see ${link('resources/summary', 'Resources')} (the money) and ${link('direction/priorities', 'Direction')} (the strategic plan and its measures).`]
      : r === 'business_manager' ? [
      `Each month, upload the month-end ledger on ${link('progress/uploads', 'Uploads')}, check the balances it shows, and apply it.`,
      `Then link any new spending accounts to initiatives on ${link('progress/initiatives', 'Progress → Initiatives')}, and check ${link('progress/actuals', 'Budget vs. actual')}.`,
      `Create the month’s ${link('reports/board', 'board report')}. Keep ${link('settings/setup', 'Starting numbers')} and the ${link('resources/general', 'General Fund')} figures current.`]
      : [
      `Start on ${link('overview/today', 'Overview')}: what needs attention, and where the plan stands.`,
      `Shape the plan on ${link('decisions/initiatives', 'Decisions')} (initiatives, ranking, scenarios) and the ${link('resources/capital', 'capital plan')}.`,
      `Keep ${link('direction/priorities', 'Direction')} current, then ${link('reports/board', 'report to the board')} and ${link('reports/community', 'publish to the community')}.`];
    const tasks = [
      ['See where the money runs out', 'Decisions → Ranking & funding line'], ['Compare two versions of the plan', 'Decisions → Scenarios'],
      ['Test a different future (inflation, settlements, enrollment)', 'the what-if levers on the capital plan and the General Fund'], ['See what a bond would cost a homeowner', 'the capital plan’s “What it means for taxpayers”'],
      ['Record a measure’s result', 'Direction → Measures'], ['Share the plan with the public', 'Reports → Community page'], ['Find anything', 'Search, at the top of every page'],
    ];
    return `
      <div class="card"><h3>Where to start</h3><ol>${start.map((x) => `<li>${x}</li>`).join('')}</ol>
        <p class="small muted">The menu shows the screens most useful to your role. To see every screen, use Account → Your menu.</p></div>
      <div class="card"><h3>How do I…</h3><table class="data"><tbody>${tasks.map(([q, a]) => `<tr><td>${esc(q)}</td><td class="small">${esc(a)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>What the terms mean</h3><dl class="glossary">${Object.values(TERMS).sort((x, y) => x[0].localeCompare(y[0])).map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
        <p class="small muted">Iowa figures were checked on ${esc(day(HGGF.RULES.checked))}. HighGround is a planning tool; confirm decisions with the district’s auditor, attorney or financial advisor.</p></div>
      <div class="card"><h3>Questions</h3><p>Email <a href="mailto:hello@willowholler.com">hello@willowholler.com</a>.</p></div>`;
  }
  async function vBuilt() {
    const rows = [];
    ALL.forEach((s) => s.tabs.forEach((t) => rows.push({ s: s.label, t: t.label, status: t.status, phase: t.phase })));
    rows.push({ s: 'Sign-in', t: 'Email and password, confirmation and reset; invitations by email; two-step sign-in; access requests', status: 'live' });
    // the public link is the community page: take its status from that screen, so this row can't go stale
    const cp = ALL.find((x) => x.id === 'reports').tabs.find((x) => x.id === 'community');
    rows.push({ s: 'Public link', t: 'District-branded board version with what-if levers; unapproved proposals held back', status: cp.status, phase: cp.phase });
    return `<div class="card">${table([
      { label: 'Section', get: (r) => r.s }, { label: 'Screen', get: (r) => r.t },
      { label: 'Status', html: (r) => badge(r.status) }, { label: 'Rest arrives', get: (r) => (r.status === 'live' ? '' : r.phase ? 'Phase ' + r.phase : '') },
    ], rows, '')}</div>
`;
  }

  // ------------------------------------------------------------------ Willow Holler staff
  async function renderStaff() {
    S.district = null; S.role = null;
    const rows = await HG.db.select('district', 'select=id,slug,name,state,is_demo,public_link_enabled,logo_path,created_at&order=name');
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
  const APPROVED = ['approved', 'underway', 'done'];
  async function publicationPayload(d, opts) {
    const o = Object.assign({ holdBack: true, note: '', survey: false }, opts || {});
    const rows = await loadCapitalRows(d);
    const board = rows.scenarios.find((x) => x.is_board_version);
    if (!rows.settings) throw new UserError('Set up the starting numbers first (Settings, Starting numbers).');
    if (!board) throw new UserError('Choose a board version first: on the capital plan, make one scenario the board version.');
    const inp = HGCapital.buildInputs(rows, board.id), INIT = new Map(rows.initiatives.map((i) => [i.id, i]));
    const shown = (id) => !o.holdBack || APPROVED.includes((INIT.get(String(id)) || {}).status || 'proposed');
    const projects = inp.projects.filter((p) => shown(p.id));
    const stored = Object.assign({}, inp.stored, { recur: (inp.stored.recur || []).filter((r) => shown(r.initiative_id)) });
    const ids = new Set(inp.projects.map((p) => String(p.id)).concat((inp.stored.recur || []).map((r) => String(r.initiative_id))));
    const heldBack = [...ids].filter((id) => !shown(id)).length;
    const done = rows.phases.filter((ph) => ph.scenario_id === board.id && ph.status === 'done' && shown(ph.initiative_id))
      .map((ph) => ({ name: (INIT.get(ph.initiative_id) || {}).name || '', label: ph.label || '', fy: ph.fy, done_date: ph.done_date || null }))
      .sort((x, y) => String(y.done_date || '').localeCompare(String(x.done_date || '')));
    const gapOf = (pr, st) => HGEngine.compute(pr, HGEngine.leversOf(st, inp.cfg), inp.cfg).gap;
    let survey = null;
    if (o.survey) {
      const [svs, res] = await Promise.all([HG.db.select('survey', `select=*&district_id=eq.${d.id}&order=closed_on.desc.nullslast,created_at.desc&limit=1`).catch(() => []),
        HG.db.selectAll('survey_result', `select=*&district_id=eq.${d.id}`).catch(() => [])]);
      if (svs[0]) {
        const sv = svs[0], rs = res.filter((r) => r.survey_id === sv.id), PN = Object.fromEntries((rows.priorities || []).map((p) => [p.id, p.name]));
        survey = { name: sv.name, closed_on: sv.closed_on, responses: sv.response_count,
          importance: rs.filter((r) => r.kind === 'importance' && r.value != null).map((r) => ({ label: r.label, value: Number(r.value) })),
          themes: rs.filter((r) => r.kind === 'theme').sort((x, y) => (y.mentions || 0) - (x.mentions || 0)).slice(0, 6).map((r) => ({ label: r.label, mentions: r.mentions,
            priority: PN[r.priority_id] || null, initiative: r.initiative_id && shown(r.initiative_id) ? (INIT.get(r.initiative_id) || {}).name || null : null })) };
      }
    }
    return { board, payload: {
      v: 2, engine: HGEngine.VERSION, scenario: { name: board.name },
      settings: inp.cfg.settings, stored, notes: inp.notes, tax: inp.tax,
      note: String(o.note || '').trim().slice(0, 1500), holdBack: !!o.holdBack, survey, heldBack, shownCount: ids.size - heldBack, done: done.slice(0, 20),
      gap: { public: gapOf(projects, stored), board: gapOf(inp.projects, inp.stored) },
      projects: projects.map((p) => ({ id: p.id, name: p.name, pri: p.pri, est: p.est, area: p.area, cond: p.cond, life: p.life,
        phases: p.phases.map((ph) => ({ cost: ph.cost, year: ph.year, funding: ph.funding, status: ph.status, actual: ph.actual, label: ph.label })) })),
    } };
  }
  function publishOpts() {
    return { holdBack: !!(document.querySelector('[data-pub-hold]') || {}).checked, note: (document.querySelector('[data-pub-note]') || {}).value || '', survey: !!(document.querySelector('[data-pub-survey]') || {}).checked };
  }
  async function publishBoard() {
    const d = S.district;
    if (!d.public_link_enabled) throw new UserError('The public link is turned off for this district. Turn it on in Settings, District.');
    const { board, payload } = await publicationPayload(d, publishOpts());
    if (!payload.shownCount) throw new UserError('Nothing would show: every initiative in the board version is still unapproved. Untick “Hold back” or approve initiatives first.');
    if (!confirm(`Publish to the public link? Anyone with it will see ${payload.shownCount} initiative${payload.shownCount === 1 ? '' : 's'}.`)) return;
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
    const order = ['district_settings', 'fund_balance', 'debt_obligation', 'priority', 'outcome', 'measure', 'measure_value', 'initiative', 'scenario', 'scenario_initiative', 'phase', 'phase_funding', 'recurring_cost', 'financing', 'survey', 'survey_result'];
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
    if (!confirm(`Erase everything in ${d.name}’s plan (starting numbers, balances, debt, the strategic plan, initiatives, scenarios, assumption sets, the monthly ledger, uploads, reports and publishing history) and load ${window.HG_DEMOS[set].name} again? People and access stay as they are.`)) return;
    for (const t of ERASE_ORDER) await HG.db.removeAll(t, `district_id=eq.${did}`);
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
  function publicBodyHtml(d, p) {
    const P = p.payload, cfg = HGEngine.makeConfig(P.settings), stored = P.stored || {};
    CAP.pub = true; CAP.key = null; CAP.editable = false; CAP.sc = null; CAP.filter = {}; CAP.view = 'cards';
    CAP.inputs = { cfg, projects: HGEngine.cleanList(P.projects || [], cfg), stored, levers: HGEngine.leversOf(stored, cfg), notes: [], tax: P.tax || {} };
    CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers));
    const accent = /^#[0-9a-f]{6}$/i.test(d.brand_color || '') ? d.brand_color : '#1E3A2F';
    return `
      <div class="pubhead" style="border-top:6px solid ${accent}">
        ${d.logo_path ? `<img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt="${esc(d.name)} logo" class="pub-dlogo-lg">` : `<span class="pub-mono" style="background:${accent}">${esc((d.short_name || d.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase())}</span>`}
        <div><h1>${esc(d.name)}</h1><div class="lede">Capital plan: ${esc(P.scenario ? P.scenario.name : p.title || 'board version')}, published ${esc(day(p.published_at))}</div></div></div>
      ${d.is_demo ? '<div class="notice">Demo district: every name and figure is made up.</div>' : ''}
      ${P.note ? `<div class="card pubnote"><p>${esc(P.note).replace(/\n+/g, '</p><p>')}</p></div>` : ''}
      ${P.survey ? `<div class="card"><h3>What you told us</h3><p class="small muted">${esc(P.survey.name)}${P.survey.responses ? ` · ${Number(P.survey.responses).toLocaleString('en-US')} responses` : ''}</p>
        ${P.survey.importance.length ? `<table class="data"><tbody>${P.survey.importance.map((r) => `<tr><td>${esc(r.label)}</td><td><span class="ubar"><i style="width:${Math.min(100, r.value / (r.value <= 5 ? 5 : 100) * 100)}%"></i></span> <b>${r.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>${r.value <= 5 ? ' out of 5' : ''}</td></tr>`).join('')}</tbody></table>` : ''}
        ${P.survey.themes.length ? `<h4>What came up most</h4><ul>${P.survey.themes.map((t) => `<li>${esc(t.label)}${t.mentions ? ` <span class="small muted">· ${t.mentions} mentions</span>` : ''}${t.initiative ? ` <span class="small">→ in the plan: ${esc(t.initiative)}</span>` : t.priority ? ` <span class="small muted">→ ${esc(t.priority)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>` : ''}
      <div id="cap-results">${capResultsHtml()}</div>
      ${(P.done || []).length ? `<div class="card"><h3>What we’ve finished</h3><ul>${P.done.map((x) => `<li>${esc(x.name)}${x.label ? ' · ' + esc(x.label) : ''}${x.done_date ? ` <span class="small muted">· finished ${esc(day(x.done_date))}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      <div class="cap-grid"><div class="card" id="cap-levers">${capLeversHtml()}</div><div class="card" id="cap-fin">${capFinHtml()}</div></div>
      <div class="card" id="cap-tax">${capTaxHtml()}</div>
      <div id="cap-filters">${capFiltersHtml()}</div>
      <div id="cap-years">${capYearsHtml()}</div>
      <p class="small muted">This is the version the district published. Moving the levers shows what would change; it doesn’t change the district’s plan.${P.heldBack ? ` ${P.heldBack} proposal${P.heldBack === 1 ? '' : 's'} still under consideration ${P.heldBack === 1 ? 'isn’t' : 'aren’t'} shown.` : ''}</p>`;
  }
  async function renderPublic(slug) {
    const p = await HG.db.rpc('public_publication', { p_slug: slug, p_kind: 'board_plan' }, { auth: false });
    const d = p && p.district;
    let body = `<div class="card"><h2>Nothing published here yet</h2><p>This link doesn’t have a published plan. If you expected one, ask the district.</p></div>`;
    if (p && p.payload && p.payload.settings) body = publicBodyHtml(d, p);
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
    async gfEdit() { if (!GF.rows) GF.rows = await loadCapitalRows(S.district); openGfEditor(); },
    async gfStaffAdd() { const t = document.querySelector('[data-gf-staff-template]'); document.querySelector('[data-gf-staff-body]').insertAdjacentHTML('beforeend', t.innerHTML); },
    async gfStaffRemove(el) { el.closest('[data-gf-staff]').remove(); },
    async gfReset() { GF.over = {}; here(); },
    async openSearch() { await openSearch(); },
    async define(el) { const t = TERMS[el.dataset.term]; if (t) toast(t[0], t[1]); },
    async searchGo(el) {
      const k = el.dataset.k, id = el.dataset.id, slug = S.district.slug; closeModal();
      if (k === 'initiative') { INI.key = S.district.id; go(`#/d/${enc(slug)}/decisions/initiatives`); setTimeout(() => openDecisionEditor(id), 600); }
      else if (k === 'scenario') { CAP.key = S.district.id; CAP.scenarioId = id; go(`#/d/${enc(slug)}/resources/capital`); }
      else if (k === 'report') { RP.key = S.district.id; RP.open = id; go(`#/d/${enc(slug)}/reports/board`); }
      else if (k === 'priority') go(`#/d/${enc(slug)}/direction/priorities`);
      else if (k === 'measure') go(`#/d/${enc(slug)}/direction/measures`);
    },
    async editSurvey(el) { if (!DIR.D) DIR.D = await loadDirection(S.district); openSurveyEditor(el.dataset.id || null); },
    async deleteSurvey(el) { if (!confirm('Delete this survey and its results?')) return; await HG.db.remove('survey', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Deleted'); here(); },
    async dirTemplate(el) { saveText(`highground-${el.dataset.k}-template.csv`, HGUploads.toCSV(DIR_TEMPLATES[el.dataset.k])); },
    async dirUploadApply() { await dirUploadApply(); },
    async dirUploadCancel() { DIRUP.parsed = null; document.getElementById('dir-upload').innerHTML = ''; },
    async editPriority(el) { if (!DIR.D) DIR.D = await loadDirection(S.district); openPriorityEditor(el.dataset.id || null); },
    async deletePriority(el) { if (!confirm('Delete this priority, its outcomes and its measures? Initiatives linked to it are kept, unlinked.')) return; await HG.db.remove('priority', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Deleted'); here(); },
    async prioMove(el) {
      const list = DIR.D.priorities, k = list.findIndex((x) => x.id === el.dataset.id), j = k + Number(el.dataset.d); if (j < 0 || j >= list.length) return;
      const order = list.map((x) => x.id); [order[k], order[j]] = [order[j], order[k]];
      for (let i = 0; i < order.length; i++) await HG.db.update('priority', `id=eq.${enc(order[i])}`, { position: i + 1 });
      here();
    },
    async editMeasure(el) { if (!DIR.D) DIR.D = await loadDirection(S.district); openMeasureEditor(el.dataset.id || null); },
    async deleteMeasure(el) { if (!confirm('Delete this measure and its recorded results?')) return; await HG.db.remove('measure', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Deleted'); here(); },
    async saveResult(el) { await saveResult(el); },
    async recordResult(el) { if (!DIR.D) DIR.D = await loadDirection(S.district); openRecord(el.dataset.id); },
    async previewPublic() { await previewPublic(); },
    async pkCreate() { await makePacket(document.querySelector('[data-pk-init]').value, document.querySelector('[data-pk-sc]').value); },
    async pkFromEditor(el) { closeModal(); await makePacket(el.dataset.id, null); },
    async rpCreate() { await rpCreate(); },
    async rpOpen(el) { RP.open = el.dataset.id; here(); },
    async rpClose() { RP.open = null; here(); },
    async rpPrint() { window.print(); },
    async rpDelete(el) { if (!confirm('Delete this board report? Later reports will compare with the one before it.')) return; await HG.db.remove('report_snapshot', `id=eq.${enc(el.dataset.id)}`); RP.open = null; toast('Deleted'); here(); },
    async baFund(el) { BA.fund = el.dataset.k; here(); },
    async piOpen(el) { PI.open = PI.open === el.dataset.id ? null : el.dataset.id; here(); },
    async piSavePhase(el) { await piSavePhase(el); },
    async piUseLedger(el) { const tr = el.closest('[data-pi-phase]'); tr.querySelector('[name=actual]').value = Number(el.dataset.amount).toLocaleString('en-US'); tr.querySelector('[name=status]').value = 'done'; },
    async piLink(el) { const sel = document.querySelector(`[data-pi-link="${el.dataset.id}"]`); await piLink(el.dataset.id, sel.value || null); toast(sel.value ? 'Linked' : 'Marked as not an initiative'); here(); },
    async piLinkAll() { const list = PI.ctx.sugg.filter((x) => x.initiativeId); for (const x of list) { const sel = document.querySelector(`[data-pi-link="${x.account.id}"]`); await piLink(x.account.id, (sel && sel.value) || x.initiativeId); } toast('Linked', `${list.length} account${list.length === 1 ? '' : 's'} linked to initiatives.`); here(); },
    async piUnlink(el) { await piLink(el.dataset.id, null); toast('Unlinked'); here(); },
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
    async downloadTemplate(el) {
      if (el.dataset.kind === 'projects') saveText('highground-projects-template.csv', HGUploads.projectTemplate(UP.startFY || 2027));
      else if (el.dataset.kind === 'gl') saveText('highground-sample-gl-export-2026-09-30.csv', HGUploads.toCSV(HGGL.sampleExport()));
      else saveText('highground-balances-template.csv', HGUploads.balanceTemplate());
    },
    async downloadUpload(el) { const b = await HG.storage.download('district-files', el.dataset.path); const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = el.dataset.name || 'upload'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); },
    async publishBoard() { await publishBoard(); },
    async withdrawBoard(el) { await withdrawBoard(el); },
    async addDebtRow() { const t = document.querySelector('[data-debt-template]'); document.querySelector('[data-debt-body]').insertAdjacentHTML('beforeend', t.innerHTML); },
    async removeDebtRow(el) { const f = el.closest('form'); el.closest('[data-debt-row]').remove(); renderSetupChecks(f); },
    async capReset() { if (CAP.pub) { CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers)); const el = document.getElementById('cap-levers'); if (el) el.innerHTML = capLeversHtml(); capRefresh(); } else { capLoadScenario(); here(); } },
    async resetDemo(el) { await resetDemo(el); },
    async removeLogo() {
      if (!confirm('Remove the district’s logo? Its initials will show instead.')) return;
      const old = S.district.logo_path;
      await HG.db.update('district', `id=eq.${S.district.id}`, { logo_path: null });
      try { await HG.storage.remove('district-public', [old]); } catch (e) { /* fine */ }
      await loadContext(true); toast('Logo removed'); here();
    },
    async restorePick() { document.querySelector('[data-restore-file]').click(); },
    async restoreRun() { await restoreRun(); },
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
    async saveGf(f, form) { await saveGf(f, form); },
    async saveSurvey(f, form) { await saveSurvey(f, form); },
    async savePriority(f, form) { await savePriority(f, form); },
    async saveMeasure(f, form) { await saveMeasure(f, form); },
    async saveRecord(f, form) { await saveRecord(f, form); },
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
    const gl2 = e.target.closest('[data-gf-lever]');
    if (gl2) { const v = toNum(gl2.value); if (v !== null && !isNaN(v)) { GF.over[gl2.dataset.gfLever] = v / 100; GF.run = gfRun(GF.rows, GF.sid, GF.over); document.getElementById('gf-results').innerHTML = gfResultsHtml(GF.run); } return; }
    const sq = e.target.closest('[data-search]');
    if (sq) { document.querySelector('[data-search-results]').innerHTML = searchResults(sq.value); return; }
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
    const lf = e.target.closest('[data-logo-file]');
    if (lf && lf.files[0]) { run(() => uploadLogo(lf.files[0]), lf.closest('label')); return; }
    const rf = e.target.closest('[data-restore-file]');
    if (rf && rf.files[0]) { run(() => restoreRead(rf.files[0]), rf); return; }
    const cp = e.target.closest('[data-cmp-pick]');
    if (cp) {
      const on = [...document.querySelectorAll('[data-cmp-pick]:checked')].map((x) => x.value);
      if (on.length > 3) { cp.checked = false; toast('Up to three', 'Untick one to add another.', 'notbuilt'); return; }
      if (!on.length) { cp.checked = true; return; }
      CMP.ids = on; document.getElementById('cmp-table').innerHTML = compareTableHtml(); return;
    }
    const du = e.target.closest('[data-dir-upload]');
    if (du) { run(() => dirUploadRead(du), du); return; }
    const srl = e.target.closest('[data-sr-link]');
    if (srl) { run(async () => { await HG.db.update('survey_result', `id=eq.${enc(srl.dataset.srLink)}`, { [srl.dataset.f]: srl.value || null }); toast('Linked'); }, srl); return; }
    const ma = e.target.closest('[data-me-auto]');
    if (ma && ma.value) { const a = HGDirection.AUTO[ma.value], fm = ma.closest('form'), set = (n, v) => { const el = fm.querySelector(`[name=${n}]`); if (el && !el.value) el.value = v; };
      set('name', a.name); set('unit', a.unit); fm.querySelector('[name=better]').value = a.better; fm.querySelector('[name=cadence]').value = a.cadence; return; }
    const sa = e.target.closest('[data-show-all]');
    if (sa) { try { localStorage.setItem(showAllKey(), sa.checked ? '1' : '0'); } catch (x) {} toast(sa.checked ? 'Every screen shown' : 'Menu for your role', 'The menu has changed.'); return here(); }
    const gsc = e.target.closest('[data-gf-sc]');
    if (gsc) { GF.sid = gsc.value; GF.over = {}; return here(); }
    const mp = e.target.closest('[data-me-prio]');
    if (mp) { const sel = mp.closest('form').querySelector('[name=outcome_id]'); sel.innerHTML = '<option value="">None</option>' + DIR.D.outcomes.filter((o) => o.priority_id === mp.value).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join(''); return; }
    const ph2 = e.target.closest('[data-pub-hold]');
    if (ph2) { CP.holdBack = ph2.checked; CP.note = (document.querySelector('[data-pub-note]') || {}).value; here(); return; }
    const psv = e.target.closest('[data-pub-survey]');
    if (psv) { CP.survey = psv.checked; CP.note = (document.querySelector('[data-pub-note]') || {}).value; here(); return; }
    const rs2 = e.target.closest('[data-rank-sid]');
    if (rs2) { RK.sid = rs2.value; return here(); }
    const rt = e.target.closest('[data-rank-tier]');
    if (rt) { run(async () => { await HG.db.update('initiative', `id=eq.${enc(rt.dataset.rankTier)}`, { tier: rt.value || null, engine_priority: ({ must: 'High', strategic: 'Med', nice: 'Low' })[rt.value] || null }); here(); }, rt); return; }
    const es = e.target.closest('[data-ed-scenario]');
    if (es) { ED.sid = es.value || null; const f = es.closest('form'); f.querySelector('[data-cost-section]').innerHTML = costSectionHtml(f.dataset.id || null); return; }
    const gc = e.target.closest('[data-gl-col]');
    if (gc) { UP.gl.cols = Object.assign({}, UP.gl.layout.cols, { [gc.dataset.glCol]: gc.value === '' ? undefined : Number(gc.value) }); glParse(); document.getElementById('upload-review').innerHTML = reviewHtml(); return; }
    const gm = e.target.closest('[data-gl-map], [data-gl-fund], [data-gl-sign]');
    if (gm) {
      const code = gm.dataset.glMap || gm.dataset.glFund || gm.dataset.glSign, sel = UP.gl.sel[code];
      if (gm.dataset.glMap) sel.maps_to = gm.value; else if (gm.dataset.glFund) sel.mapped_fund = gm.value; else sel.sign = gm.checked ? -1 : 1;
      document.getElementById('gl-balances').innerHTML = UP.kind === 'budget' ? budgetSummaryHtml() : glBalancesHtml(); return;
    }
    const ua = e.target.closest('[data-upload-asof]');
    if (ua && UP.kind === 'gl_monthly' && document.getElementById('gl-balances')) { document.getElementById('gl-balances').innerHTML = glBalancesHtml(); }
    const pk = e.target.closest('[data-pick-init]');
    if (pk) { openProjectEditor(pk.value || null); return; }
    const bs = e.target.closest('[data-ba]');
    if (bs) { BA[bs.dataset.ba] = bs.dataset.ba === 'fy' ? Number(bs.value) : bs.value; if (bs.dataset.ba === 'fy') { BA.late = null; BA.early = null; } return here(); }
    const pf = e.target.closest('[data-pi-fy]');
    if (pf) { PI.fy = Number(pf.value); return here(); }
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
