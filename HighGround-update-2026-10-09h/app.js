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
  /* a date-only value ('2026-09-30') is a calendar date, not midnight UTC: read it as local noon, or Iowa sees the day before */
  const day = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const ROLE = { admin: 'Admin', business_manager: 'Business manager', superintendent: 'Superintendent', editor: 'Editor', board: 'Board member', viewer: 'Viewer' };
  const KIND = { gl_monthly: 'Monthly general ledger (GL) export', budget: 'Budget', balances: 'Fund balances', projects: 'Projects', goals: 'Goals', measure_values: 'Measure results', survey: 'Survey results', check_register: 'Check register' };
  const STATUS = { live: ['b-live', 'Live'], partial: ['b-partial', 'Partly built'], wip: ['b-wip', 'Not built yet'] };
  const badge = (s) => `<span class="badge ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
  const initials = (s) => (String(s || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();
  /* HighGround's logo: 'light' (cream) on the dark green rail and sign-in panel, colour on light backgrounds */
  /* ---- dates: Iowa's fiscal year runs July 1 to June 30, so October 2026 is in FY2027 ---- */
  const fyNow = () => { const t = new Date(); return t.getMonth() >= 6 ? t.getFullYear() + 1 : t.getFullYear(); };
  /** balances dated before this fiscal year start the plan in a year that has already ended */
  const staleStart = (asOf) => { const fy = asOf && HGEngine.fyOfDate(asOf), now = fyNow();
    return fy && fy < now ? `Balances dated ${day(asOf)} start the plan in FY${fy}, a year that has already ended (it’s FY${now} now). Use balances from June 30, ${now - 1} or later, from the audit or the ledger, so the plan starts this year.` : ''; };
  /** how old the state's annual-report figures are: districts file by September 15 and the state posts them later in the fall */
  const stateAge = (stFY) => { const now = fyNow();
    return stFY && stFY < now - 1 ? `FY${stFY} is the newest year the state has posted. FY${now - 1} reports were due September 15, ${now - 1} and usually appear later in the fall; until then, use newer figures from the district’s own audit or ledger where you have them.` : ''; };
  /** certified enrollment for school year fy-1 to fy is the October 1 count that funds the year after */
  const enrollLabel = (fy) => (fy ? `October 1, ${fy - 1} count (funds FY${fy + 1})` : '');
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

  /**
   * A message in the corner. It stays long enough to read (about a second for every 15 characters, at least 8 seconds),
   * waits while the pointer is over it, and has a close button. opts.sticky: stays until closed (definitions).
   */
  function toast(title, body, kind, opts) {
    const box = document.getElementById('toasts'), o = opts || {};
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '') + (o.sticky ? ' sticky' : '');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = `<button type="button" class="toast-x" aria-label="Close">×</button><b>${esc(title)}</b>${esc(body || '')}`;
    t.querySelector('.toast-x').addEventListener('click', () => t.remove());
    if (o.key) box.querySelectorAll(`[data-toast-key="${o.key}"]`).forEach((x) => x.remove());
    if (o.key) t.dataset.toastKey = o.key;
    box.appendChild(t);
    if (o.sticky) return t;
    let left = Math.max(kind === 'error' ? 12000 : 8000, String(title + (body || '')).length * 65), started = Date.now(), timer;
    const go = () => { started = Date.now(); timer = setTimeout(() => t.remove(), left); };
    t.addEventListener('mouseenter', () => { clearTimeout(timer); left -= Date.now() - started; });
    t.addEventListener('mouseleave', go);
    go();
    return t;
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
    /* menu_logo_only arrived with part 22; before it's run, read the district without it */
    const DCOLS = 'id,slug,name,short_name,state,county,brand_color,logo_path,is_demo,public_link_enabled,state_district_id';
    const memSel = (extra) => HG.db.select('district_member', `select=role,district:district_id(${DCOLS}${extra})&user_id=eq.${enc(u.id)}`);
    const [staff, mems, prof] = await Promise.all([
      HG.db.select('platform_admin', `select=user_id&user_id=eq.${enc(u.id)}`),
      memSel(',menu_logo_only').catch(() => memSel('')),
      HG.db.select('profile', `select=*&user_id=eq.${enc(u.id)}`),
    ]);
    S.isStaff = staff.length > 0;
    S.memberships = mems.filter((m) => m.district);
    S.profile = prof[0] || null;
    S.districts = S.isStaff
      ? await HG.db.select('district', `select=${DCOLS},menu_logo_only&order=name`).catch(() => HG.db.select('district', `select=${DCOLS}&order=name`))
      : S.memberships.map((m) => m.district).sort((a, b) => a.name.localeCompare(b.name));
    S.loaded = true;
  }
  /* an admin (or Willow Holler staff) can preview the district as a board member sees it; permissions in the database are unchanged */
  const staffNow = () => S.isStaff && !S.preview;
  const canPreview = () => S.isStaff || ['admin', 'business_manager', 'superintendent', 'editor'].includes(S.realRole);
  const roleIn = (d) => { const m = S.memberships.find((x) => x.district.id === d.id); return m ? m.role : (S.isStaff ? 'staff' : null); };
  const ctx = () => {
    const r = S.role, staff = staffNow();
    return {
      district: S.district, role: r, staff,
      admin: staff || r === 'admin',
      plan: staff || ['admin', 'superintendent', 'editor'].includes(r),
      finance: staff || ['admin', 'business_manager'].includes(r),
    };
  };

  async function route() {
    const hash = location.hash || '';
    closeModal();   // a dialog never outlives its page (and the page underneath can scroll again)
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
      if (parts[0] === 'd' && parts[1] && parts[2] === 'welcome') return await renderWizard(parts[1], parts[3]);
      if (parts[0] === 'd' && parts[1]) return await renderDistrict(parts[1], parts[2], parts[3]);
      if (!S.districts.length) return S.isStaff ? go('#/staff', flash) : renderNoDistrict();
      let last = null; try { last = localStorage.getItem('highground-last-district'); } catch (e) {}
      // the district used last; otherwise the one where the person has the most responsibility; Willow Holler staff start on their own page
      if (S.isStaff && !S.districts.some((x) => x.slug === last)) return go('#/staff', flash);
      const RANK = { admin: 0, business_manager: 1, superintendent: 1, editor: 2, board: 3, viewer: 4 };
      const first = S.districts.find((x) => x.slug === last) || S.districts.slice().sort((x, y) => (RANK[roleIn(x)] ?? 9) - (RANK[roleIn(y)] ?? 9))[0];
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
  /* Home plus four areas, each with its own colour (styles: --a-home, --a-plan …); setup screens sit under Settings */
  const SECTIONS = [
    { id: 'home', label: 'Home', icon: 'home', tabs: [
      { id: 'today', label: 'Home', status: 'live', lede: 'How the district is doing, and what needs attention.', render: vOverview },
    ] },
    { id: 'plan', label: 'Plan', icon: 'plan', tabs: [
      { id: 'priorities', label: 'Priorities', status: 'live', lede: 'The strategic plan: priorities and the outcomes behind them.', render: vPriorities },
      { id: 'community', label: 'Community input', status: 'live', lede: 'What the community told us, and where it shows up in the plan.', render: vCommunity },
      { id: 'initiatives', label: 'Initiatives', views: [['initiatives', 'List'], ['ranking', 'Ranked']], status: 'live', lede: 'Everything that costs money: projects, programs, hires. Switch to Ranked to force-rank them and see where the money runs out.', render: vInitiatives },
      { id: 'ranking', label: 'Ranking', menu: false, parent: 'initiatives', status: 'live', lede: 'Force-rank initiatives and see where the money runs out.', render: vRanking },
      { id: 'scenarios', label: 'Scenarios', status: 'live', lede: 'Different ways to pay for the plan, side by side.', render: vScenarios },
    ] },
    { id: 'money', label: 'Money', icon: 'money', tabs: [
      { id: 'capital', label: 'Capital plan', status: 'live', lede: 'Projects by year, split across Iowa’s capital funds, with the gap to close.', render: vCapital },
      { id: 'general', label: 'General fund', status: 'live', lede: 'Five-year General Fund forecast: solvency, spending authority and what a negotiated raise costs.', render: vGeneralFund },
      { id: 'summary', label: 'All funds', status: 'live', lede: 'Every fund at a glance, from the board version.', render: vResSummary },
    ] },
    { id: 'track', label: 'Track', icon: 'track', tabs: [
      { id: 'initiatives', label: 'Initiative progress', status: 'live', lede: 'Each initiative against the adopted plan: spending, phases and dates.', render: vProgInitiatives },
      { id: 'measures', label: 'Measures', status: 'live', lede: 'How each outcome is measured, and its results over time.', render: vMeasures },
      { id: 'actuals', label: 'Budget vs. actual', status: 'live', lede: 'Each fund’s budget, actual and year-end forecast, from the monthly ledger.', render: vActuals },
      { id: 'registers', label: 'Check register', status: 'live', lede: 'Questions from the bills paid each month: new vendors, possible duplicates, changed names and more.', render: vRegisters },
    ] },
    { id: 'share', label: 'Share', icon: 'share', tabs: [
      { id: 'board', label: 'Board reports', status: 'live', lede: 'Monthly board report, capital summary, decision packets.', render: vBoardReports },
      { id: 'plans', label: 'District plan', status: 'live', lede: 'The district’s plan in three views: the full plan, academic goals (CSIP) and the capital improvement plan.', render: vPlan },
      { id: 'community', label: 'Community page', status: 'live', lede: 'What the public link shows.', render: vCommunityPage },
    ] },
  ];
  const FOOT = [
    { id: 'settings', label: 'Settings', icon: 'set', tabs: [
      { id: 'overview', label: 'Settings', status: 'live', lede: 'Set these up once. HighGround uses them everywhere else.', render: vSettingsHome },
      { id: 'district', label: 'District', status: 'live', lede: 'Name, link and look, and the numbers the plan starts from.', render: vDistrict },
      { id: 'setup', label: 'Starting numbers', status: 'live', lede: 'What the capital plan starts from: receipts, balances and existing debt.', render: vSetup },
      { id: 'assumptions', label: 'Assumption sets', status: 'live', lede: 'Base, Conservative and Growth: the world the plan has to survive.', render: vAssumptions },
      { id: 'uploads', label: 'Uploads', status: 'live', lede: 'Every file brought in, and what happened to it.', render: vUploads },
      { id: 'people', label: 'People', status: 'live', lede: 'Who can see and change this district.', render: vPeople },
      { id: 'activity', label: 'Activity', status: 'live', lede: 'Every change: who, when, and what it was before.', render: vActivity },
      { id: 'exports', label: 'Exports', status: 'live', lede: 'Download the district’s data, for spreadsheets or backup.', render: vExports },
      { id: 'account', label: 'Your account', status: 'live', lede: 'Your name, password and sign-in security.', render: vAccount },
    ] },
    { id: 'help', label: 'Help', icon: 'help', tabs: [
      { id: 'guide', label: 'Help', status: 'live', lede: 'How to do the common things, and what the terms mean.', render: vGuide },
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
  const MOVED = { 'resources/funds': 'money/summary', 'progress/measures': 'track/measures', 'resources/assumptions': 'settings/assumptions', 'reports/exports': 'settings/exports',
    'overview/today': 'home/today', 'direction/priorities': 'plan/priorities', 'direction/community': 'plan/community', 'direction/measures': 'track/measures',
    'decisions/initiatives': 'plan/initiatives', 'decisions/ranking': 'plan/ranking', 'decisions/scenarios': 'plan/scenarios',
    'resources/summary': 'money/summary', 'resources/general': 'money/general', 'resources/capital': 'money/capital',
    'progress/initiatives': 'track/initiatives', 'progress/actuals': 'track/actuals', 'progress/registers': 'track/registers', 'progress/uploads': 'settings/uploads',
    'reports/board': 'share/board', 'reports/plans': 'share/plans', 'reports/community': 'share/community' };
  /* the old area names, with no screen named: their first screen in the new menu */
  const MOVED_SECTION = { overview: 'home/today', direction: 'plan/priorities', decisions: 'plan/initiatives', resources: 'money/capital', progress: 'track/initiatives', reports: 'share/board' };

  /* ---- what each role sees in the menu (permissions are unchanged; a direct link still opens) ---- */
  const BOARD_VIEW = { home: ['today'], plan: ['priorities'], money: ['capital', 'general', 'summary'], track: ['measures'], share: ['board', 'plans'], settings: ['account'], help: ['guide'] };
  const LEAD_VIEW = { home: ['today'], plan: null, money: ['capital', 'general', 'summary'], track: ['initiatives', 'measures', 'actuals', 'registers'],
    share: ['board', 'plans'], settings: ['overview', 'uploads', 'assumptions', 'account'], help: ['guide'] };
  const FINANCE_VIEW = { home: ['today'], money: ['capital', 'general', 'summary'], track: ['actuals', 'registers', 'initiatives', 'measures'], share: ['board', 'plans'],
    settings: ['overview', 'uploads', 'setup', 'exports', 'account'], help: ['guide'] };
  const VIEWS = { board: BOARD_VIEW, viewer: BOARD_VIEW, superintendent: LEAD_VIEW, editor: LEAD_VIEW, business_manager: FINANCE_VIEW };
  const showAllKey = () => `highground-show-all-${(S.user && S.user.id) || ''}`;
  /* board members and viewers see only their own screens: no "show every screen", no way in by link or address */
  const lockedRole = (role) => ['board', 'viewer'].includes(role) && !staffNow();
  function showAll() { if (lockedRole(S.role)) return false; try { return localStorage.getItem(showAllKey()) === '1'; } catch (e) { return false; } }
  function tabAllowed(sectionId, tabId) {
    const sec = ALL.find((x) => x.id === sectionId); if (!sec) return true;
    return visibleTabs(sec).some((t) => t.id === (tabId || sec.tabs[0].id));
  }
  /** for board members and viewers: links to screens they can't open become plain text */
  function stripHidden(root) {
    if (!root || !lockedRole(S.role)) return;
    root.querySelectorAll('a[href^="#/d/"]').forEach((a) => {
      const [, , , sec, tab] = a.getAttribute('href').split('?')[0].split('/');
      if (sec && sec !== 'welcome' && !tabAllowed(sec, tab)) a.replaceWith(document.createTextNode(a.textContent));
    });
  }
  /**
   * Tables on narrow screens. Every table sits in its own sideways-scrolling box (so it can never push the page);
   * a table that doesn't fit becomes a stacked list on phones when it has six columns or fewer, and wider ones get a
   * visible "swipe" cue and a fading edge until they're scrolled to the end.
   */
  function fitTables(root) {
    if (!root) return;
    root.querySelectorAll('table').forEach((t) => {
      if (t.closest('details:not([open])')) return;   // measured when its fold opens
      let box = t.parentElement;
      if (!box.classList.contains('scroll')) { box = document.createElement('div'); box.className = 'scroll'; t.replaceWith(box); box.appendChild(t); }
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!t.dataset.labelled) {
        t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.tagName === 'TD' && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || ''); }));
        t.dataset.labelled = '1';
      }
      const cols = Math.max(heads.length, ...[...t.querySelectorAll('tbody tr')].slice(0, 3).map((tr) => tr.children.length), 0);
      t.classList.remove('stacked'); box.classList.remove('scroll-more', 'at-end');
      const prev = box.previousElementSibling; if (prev && prev.classList.contains('swipe-hint')) prev.remove();
      if (box.scrollWidth <= box.clientWidth + 2) return;
      if (cols <= 6 && window.matchMedia('(max-width: 820px)').matches) { t.classList.add('stacked'); return; }
      box.classList.add('scroll-more');
      box.insertAdjacentHTML('beforebegin', '<p class="swipe-hint small muted" aria-hidden="true">Swipe the table sideways to see all its columns →</p>');
      if (!box.dataset.watch) { box.dataset.watch = '1'; box.addEventListener('scroll', () => box.classList.toggle('at-end', box.scrollLeft + box.clientWidth >= box.scrollWidth - 4), { passive: true }); }
    });
  }
  document.addEventListener('toggle', (e) => { if (e.target.tagName === 'DETAILS' && e.target.open) fitTables(e.target); }, true);
  { let tm; window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { fitTables(document.getElementById('view')); fitTables(document.querySelector('[data-modal]')); }, 200); }); }
  function visibleTabs(section) {
    const tabs = section.tabs;
    const v = VIEWS[S.role];
    if (staffNow() || S.role === 'admin' || !v || showAll()) return tabs;
    if (!(section.id in v)) return [];
    const want = v[section.id];
    return want === null ? tabs : want.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
  }
  /** where each role starts: board members and viewers on the latest board report */
  const homePath = (role) => (['board', 'viewer'].includes(role) ? 'share/board' : 'home/today');
  /* ---- icons for the menu (stroke icons, drawn in the current colour) ---- */
  const ICON = {
    home: '<path d="M4 10.5 12 4l8 6.5V20h-5v-5h-6v5H4z"/>',
    plan: '<path d="M5 4v16M5 5h11l-2 3.5 2 3.5H5"/>',
    money: '<path d="M4 7h16v10H4z"/><circle cx="12" cy="12" r="2.2"/>',
    track: '<path d="M4 19V9M10 19V5M16 19v-7M3 19h18"/>',
    share: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01"/>',
    staff: '<path d="M4 20c1-4 4-6 8-6s7 2 8 6M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
    present: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>', prev: '<path d="m15 6-6 6 6 6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', up: '<path d="m7 15 5-5 5 5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bld: '<path d="M4 20V8l8-4 8 4v12M9 20v-5h6v5M3 20h18M8 10h.01M12 10h.01M16 10h.01"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.6 2 3 4.4"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h4"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    upload: '<path d="M12 15V4M7 9l5-5 5 5M5 15v4h14v-4"/>', download: '<path d="M12 4v11M7 10l5 5 5-5M5 15v4h14v-4"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>', target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
    report: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>', book: '<path d="M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5z"/><path d="M17 7.5h2v12"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  };
  const icon = (k, size = 16, w = 1.9) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;
  const railKey = 'highground-menu-collapsed';
  const railCollapsed = () => { try { return localStorage.getItem(railKey) === '1'; } catch (e) { return false; } };
  const districtMark = (d, cls) => (d.logo_path ? `<span class="tile logo ${cls || ''}"><img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt=""></span>` : `<span class="tile ${cls || ''}" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>`);
  function frame({ slug, sectionId, tabId, body }) {
    const d = S.district;
    const cur = (() => { const sec = ALL.find((x) => x.id === sectionId), t = sec && sec.tabs.find((x) => x.id === tabId); return t && t.parent ? t.parent : tabId; })();
    const here2 = (s, t) => s.id === sectionId && (!cur || t.id === cur);
    const inMenu = (t) => t.menu !== false;
    const group = (s) => {
      const vt = visibleTabs(s).filter(inMenu); if (!vt.length) return '';
      const on = s.id === sectionId, href = `#/d/${enc(slug)}/${s.id}/${vt[0].id}`;
      if (s.id === 'home') return `<a class="it ${on ? 'on' : ''}" data-area="home" href="${href}" title="Home" ${on ? 'aria-current="page"' : ''}><span class="sq">${icon('home', 14)}</span><span class="tx">Home</span></a><div class="lbl">Workspace</div>`;
      return `<div class="grp ${on ? 'open' : ''}" data-area="${s.id}"><a class="it ${on ? 'on' : ''}" href="${href}" data-area-head="${s.id}" title="${esc(s.label)}" aria-expanded="${on}"><span class="sq">${icon(s.icon, 14)}</span><span class="tx">${esc(s.label)}</span><span class="chev">${icon('chev', 13)}</span></a>
        <div class="kids">${vt.map((t) => `<a href="#/d/${enc(slug)}/${s.id}/${t.id}" ${here2(s, t) ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</div></div>`;
    };
    const foot = (s) => { const vt = visibleTabs(s); if (!vt.length || (s.id === 'settings' && !vt.some((t) => t.id === 'overview'))) return '';
      return `<a class="it ${s.id === sectionId ? 'on' : ''}" data-area="${s.id}" href="#/d/${enc(slug)}/${s.id}/${vt[0].id}" title="${esc(s.label)}" ${s.id === sectionId ? 'aria-current="page"' : ''}><span class="sq">${icon(s.icon, 14)}</span><span class="tx">${esc(s.label)}</span></a>`; };
    const options = S.districts.map((x) => `<option value="${esc(x.slug)}" ${d && x.slug === d.slug ? 'selected' : ''}>${esc(x.name)}${x.is_demo ? ' (demo)' : ''}</option>`).join('');
    const name = (S.profile && S.profile.full_name) || (S.user && S.user.email) || '';
    const roleName = S.preview ? 'Previewing as board member' : S.isStaff && !S.memberships.some((m) => d && m.district.id === d.id) ? 'Willow Holler staff' : (ROLE[S.realRole || S.role] || '');
    const logoOnly = d && d.logo_path && d.menu_logo_only;
    const org = d ? `<div class="org ${logoOnly ? 'lg' : ''}">${logoOnly ? `<img class="org-logo" src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt="${esc(d.name)}">${districtMark(d, 'rm')}`
        : `${districtMark(d)}<span class="tx org-tx"><b>${esc(d.short_name || d.name)}</b><small>${d.is_demo ? 'Demo district' : esc(d.state || 'IA')}</small></span>`}
        ${S.districts.length > 1 ? `<label class="org-switch"><span class="sr-only">Switch district</span><select data-switch aria-label="Switch district"><option value="" selected>Switch district…</option>${S.districts.filter((x) => x.slug !== d.slug).map((x) => `<option value="${esc(x.slug)}">${esc(x.name)}${x.is_demo ? ' (demo)' : ''}</option>`).join('')}</select></label>` : ''}</div>`
      : (S.districts.length ? `<div class="org"><label class="org-switch"><select data-switch aria-label="District"><option value="">Choose a district</option>${options}</select></label></div>` : '');
    app.innerHTML = `
      <div class="frame ${railCollapsed() ? 'rail-collapsed' : ''} ${S.present && slug ? 'presenting' : ''}" id="frame">
        <header class="topbar">
          <button type="button" class="panelbtn" data-action="toggleRail" aria-label="${railCollapsed() ? 'Expand menu' : 'Collapse menu'}" title="${railCollapsed() ? 'Expand menu' : 'Collapse menu'}  [">${icon('panel', 18, 1.8)}</button>
          <button type="button" class="menu-btn" data-action="toggleMenu" aria-expanded="false" aria-controls="rail-menu" aria-label="Menu">${icon('menu', 18, 2)}</button>
          <a class="brand" href="#/" aria-label="HighGround home">${LOGO_LIGHT}</a>
          ${slug ? '<span class="scen-top" id="scenTop"></span>' : ''}
          <span class="spacer"></span>
          ${d && d.is_demo ? '<span class="demo-bar">Demo district · made-up figures</span>' : ''}
          ${slug ? `<button type="button" class="helpbtn searchbtn" data-action="openSearch" aria-label="Search this district" title="Search: screens, initiatives, reports  (Ctrl K)">${icon('search', 18, 1.9)}</button>` : ''}
          ${slug ? `<button type="button" class="helpbtn" data-action="startPresent" aria-label="Present on a big screen" title="Present on a big screen">${icon('present', 18, 1.8)}</button>` : ''}
          ${slug ? `<button type="button" class="helpbtn" data-action="openHelp" aria-label="Help with this screen" title="Help with this screen">${icon('help', 18, 1.8)}</button>` : ''}
        </header>
        <nav class="rail" aria-label="HighGround">
          <div class="rail-menu" id="rail-menu">
            ${org}
            <div class="nav">${slug ? SECTIONS.map(group).join('') : ''}</div>
            <div class="nav nav-foot">
              ${slug ? FOOT.map(foot).join('') : ''}
              ${S.isStaff ? `<a class="it ${sectionId === 'staff' ? 'on' : ''}" data-area="set" href="#/staff" title="Willow Holler" ${sectionId === 'staff' ? 'aria-current="page"' : ''}><span class="sq">${icon('staff', 14)}</span><span class="tx">Willow Holler</span></a>` : ''}
              <div class="userbox">
                <button type="button" class="user" data-action="userMenu" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${esc(initials(name))}</span><span class="tx"><b>${esc(name)}</b><small>${esc(roleName)}</small></span><span class="chev">${icon('up', 14)}</span></button>
                <div class="umenu" role="menu" hidden>
                  <div class="uh"><b>${esc(name)}</b><small>${esc((S.user && S.user.email) || '')}</small></div>
                  ${slug ? `<a role="menuitem" href="#/d/${enc(slug)}/settings/account">Your account</a>` : ''}
                  ${slug && canPreview() ? `<button type="button" role="menuitem" data-action="togglePreview">${S.preview ? 'Exit board member preview' : 'Preview as board member'}<small>Admins</small></button>` : ''}
                  <hr><button type="button" role="menuitem" class="menu-signout" data-action="signOut">Sign out</button>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <div class="main">
          ${S.present && slug ? presentBar(slug, sectionId, tabId) : ''}
          <main class="content" id="content" data-area="${esc(sectionId || 'home')}">${S.preview && slug ? `<div class="preview-bar" role="status">You’re previewing what board members see.<button type="button" class="btn small" data-action="togglePreview">Back to my view</button></div>` : ''}${body}</main>
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
    S.district = d; S.realRole = roleIn(d); if (S.preview && !canPreview()) S.preview = false; S.role = S.preview ? 'board' : S.realRole;
    if (MOVED[`${sectionId}/${tabId}`]) return go(`#/d/${enc(slug)}/${MOVED[`${sectionId}/${tabId}`]}`);
    if (MOVED_SECTION[sectionId] && !tabId) return go(`#/d/${enc(slug)}/${MOVED_SECTION[sectionId]}`);
    try { localStorage.setItem('highground-last-district', d.slug); } catch (e) {}
    const section = ALL.find((s) => s.id === sectionId) || SECTIONS[0];
    const tab = section.tabs.find((t) => t.id === tabId) || section.tabs[0];
    if (lockedRole(S.role) && !tabAllowed(section.id, tab.id)) {
      frame({ slug, sectionId: section.id, body: `<div class="card"><h3>Not part of your view</h3><p>This screen is for the district’s staff. ${S.role === 'board' ? 'Board members' : 'Viewers'} see Home, Priorities, Money, Measures and Share.</p>
        <p><a class="btn primary" href="#/d/${enc(slug)}/${homePath(S.role)}">Go to board reports</a></p></div>` });
      return;
    }
    const menuTab = tab.parent ? section.tabs.find((t) => t.id === tab.parent) || tab : tab;
    const shown = visibleTabs(section).filter((t) => t.menu !== false), barTabs = shown.some((t) => t.id === menuTab.id) ? shown : shown.concat([menuTab]);
    const tabs = barTabs.length > 1
      ? `<nav class="tabs" aria-label="${esc(section.label)}">${barTabs.map((t) => `<a href="#/d/${enc(slug)}/${section.id}/${t.id}" ${t.id === menuTab.id ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>` : '';
    /* one screen, two ways to look at it (Initiatives: List or Ranked) */
    const views = (menuTab.views || []).filter(([id]) => visibleTabs(section).some((t) => t.id === id));
    const viewSwitch = views.length > 1 ? `<div class="seg viewswitch" role="group" aria-label="View">${views.map(([id, label]) => `<a class="btn ${id === tab.id ? 'on' : ''}" href="#/d/${enc(slug)}/${section.id}/${id}" ${id === tab.id ? 'aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</div>` : '';
    const crumb = section.id === 'home' ? `<div class="crumb"><span class="dot"></span>${esc(d.short_name || d.name)}</div>`
      : `<div class="crumb"><span class="dot"></span>${section.id === 'settings' && tab.id === 'overview' ? esc(d.short_name || d.name) : `<a href="#/d/${enc(slug)}/${section.id}/${(shown[0] || tab).id}">${esc(section.label)}</a><span>/</span><span>${esc(menuTab.label)}</span>`}</div>`;
    frame({ slug, sectionId: section.id, tabId: tab.id, body: `
      <div class="page-head${section.id === 'home' ? ' sr-only' : ''}"><div>${crumb}<h1>${esc(menuTab.label)}</h1>
        <div class="lede">${esc(tab.lede)}</div></div>
        <div class="right">${viewSwitch}${tab.status !== 'live' ? badge(tab.status) : ''}${tab.status !== 'live' && tab.phase ? `<span class="small muted">${tab.status === 'wip' ? 'Planned for' : 'Rest in'} Phase ${tab.phase}</span>` : ''}</div></div>
      ${tabs}
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      ${setupBanner(section.id, tab.id)}
      <div id="view" class="stack"><div class="empty">Loading…</div></div>` });
    flash = null;
    const view = document.getElementById('view');
    ACT.before = null;
    PAGE.lead = null;
    try { const html = await tab.render(ctx()); view.innerHTML = (PAGE.lead ? `<p class="lead">${PAGE.lead}</p>` : '') + html; stripHidden(view); fitTables(view); fillScenarioTop(ctx(), section, tab).catch(() => {}); focusMeasure(view); }
    catch (err) {
      view.innerHTML = `<div class="notice error">${esc(err instanceof HG.NotBuiltError ? err.message : 'This screen couldn’t load: ' + (err.message || err))}</div>`;
      if (!(err instanceof HG.NotBuiltError)) console.error(err);
    }
  }

  /* ---- the menu: collapse to icons (remembered), hover flyouts for an area's screens, shortcuts ---- */
  function toggleRail() {
    const f = document.getElementById('frame'); if (!f) return;
    const on = !f.classList.contains('rail-collapsed'); f.classList.toggle('rail-collapsed', on);
    try { localStorage.setItem(railKey, on ? '1' : '0'); } catch (e) {}
    const b = f.querySelector('.panelbtn'); if (b) { const t = on ? 'Expand menu' : 'Collapse menu'; b.setAttribute('aria-label', t); b.title = t + '  ['; }
    hideFly(true);
  }
  /* ---- presenting: for a board meeting on a big screen. The menus go, the type grows, and it shows the board's view
     (no editing, no setup notes). A bar at the bottom moves between screens; Esc or Exit ends it. ---- */
  function presentScreens(slug) {
    const out = [];
    SECTIONS.forEach((s) => visibleTabs(s).filter((t) => t.menu !== false).forEach((t) => out.push({ path: `${s.id}/${t.id}`, label: s.id === 'home' ? 'Home' : `${s.label}: ${t.label}`, area: s.id })));
    return out;
  }
  function presentBar(slug, sectionId, tabId) {
    const list = presentScreens(slug), sec = ALL.find((x) => x.id === sectionId), t = sec && sec.tabs.find((x) => x.id === tabId), cur = `${sectionId}/${t && t.parent ? t.parent : tabId}`;
    const i = list.findIndex((x) => x.path === cur), prev = list[i - 1], next = list[i + 1];
    return `<div class="present-bar" role="toolbar" aria-label="Presenting">
      <button type="button" class="pbtn" data-present-go="${prev ? esc(prev.path) : ''}" ${prev ? '' : 'disabled'} aria-label="Previous screen" title="Previous screen (←)">${icon('prev', 18, 2)}</button>
      <select data-present-pick aria-label="Go to screen">${list.map((x) => `<option value="${esc(x.path)}" ${x.path === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}${i < 0 ? `<option selected>${esc(t ? t.label : '')}</option>` : ''}</select>
      <button type="button" class="pbtn" data-present-go="${next ? esc(next.path) : ''}" ${next ? '' : 'disabled'} aria-label="Next screen" title="Next screen (→)">${icon('chev', 18, 2)}</button>
      <button type="button" class="pbtn exit" data-action="stopPresent" title="Stop presenting (Esc)">${icon('x', 16, 2)}<span>Exit</span></button></div>`;
  }
  async function startPresent() {
    S.present = true; S.presentPrev = S.preview; if (canPreview()) S.preview = true;
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (e) { /* the browser said no: presenting still works in the window */ }
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    S.role = S.preview ? 'board' : S.realRole;
    const ok = parts[0] === 'd' && tabAllowed(parts[2], parts[3]);
    go(ok ? location.hash : `#/d/${enc(parts[1])}/${homePath(S.role)}`);
  }
  function stopPresent() {
    if (!S.present) return;
    S.present = false; S.preview = !!S.presentPrev;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    here();
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.present) stopPresent(); });
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-present-go]'); if (b && b.dataset.presentGo && S.district) go(`#/d/${enc(S.district.slug)}/${b.dataset.presentGo}`); });
  document.addEventListener('change', (e) => { const p = e.target.closest && e.target.closest('[data-present-pick]'); if (p && S.district && p.value.includes('/')) go(`#/d/${enc(S.district.slug)}/${p.value}`); });
  document.addEventListener('keydown', (e) => {
    if (!S.present || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('[data-modal]')) return;
    if (e.key === 'Escape') { stopPresent(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === 'PageUp') {
      const b = document.querySelectorAll('.present-bar [data-present-go]')[e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : 0];
      if (b && b.dataset.presentGo) { e.preventDefault(); b.click(); }
    }
  });
  /* ---- a measure named anywhere (Home, Priorities, the district plan) opens Track → Measures at its row ---- */
  const MFOCUS = { id: null };
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('[data-measure-go]'); if (!a) return;
    MFOCUS.id = a.dataset.measureGo; if (location.hash.endsWith('/track/measures')) { e.preventDefault(); focusMeasure(document.getElementById('view')); } }, true);
  function focusMeasure(view) {
    if (!MFOCUS.id || !view) return;
    const row = view.querySelector(`[data-measure-row="${CSS.escape(MFOCUS.id)}"]`); MFOCUS.id = null; if (!row) return;
    const box = row.closest('details'); if (box) box.open = true;
    row.scrollIntoView({ block: 'center' }); row.classList.remove('focus-row'); void row.offsetWidth; row.classList.add('focus-row');
  }
  const FLY = { el: null, for: null, t: null };
  const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 821px)').matches;
  function hideFly(now) {
    clearTimeout(FLY.t);
    const f = () => { if (FLY.el) FLY.el.remove(); FLY.el = null; FLY.for = null; document.querySelectorAll('.grp.hot').forEach((g) => g.classList.remove('hot')); };
    if (now) f(); else FLY.t = setTimeout(f, 180);
  }
  function showFly(head) {
    const grp = head.closest('.grp'); clearTimeout(FLY.t);
    if (FLY.for === grp.dataset.area && FLY.el) return;
    hideFly(true); FLY.for = grp.dataset.area; grp.classList.add('hot');
    const el = document.createElement('div'); el.className = 'fly'; el.dataset.area = grp.dataset.area; el.setAttribute('role', 'menu');
    el.innerHTML = `<div class="fh"><i></i>${esc(head.querySelector('.tx').textContent)}</div>` + [...grp.querySelectorAll('.kids a')].map((a) => `<a role="menuitem" href="${a.getAttribute('href')}" ${a.getAttribute('aria-current') ? 'aria-current="page"' : ''}>${esc(a.textContent)}</a>`).join('');
    document.body.appendChild(el); FLY.el = el;
    const r = head.getBoundingClientRect(), h = el.offsetHeight;
    el.style.left = (r.right + 6) + 'px'; el.style.top = Math.max(8, Math.min(r.top - 6, window.innerHeight - h - 8)) + 'px';
    el.addEventListener('mouseenter', () => clearTimeout(FLY.t)); el.addEventListener('mouseleave', () => hideFly());
    el.addEventListener('click', (e) => { if (e.target.closest('a')) hideFly(true); });
  }
  document.addEventListener('mouseover', (e) => {
    const rail = e.target.closest && e.target.closest('.rail'); if (!rail || !canHover()) return;
    const head = e.target.closest('[data-area-head]');
    const collapsed = !!document.querySelector('.frame.rail-collapsed');
    if (head && (collapsed || !head.closest('.grp').classList.contains('open'))) { showFly(head); return; }
    if (e.target.closest('.it, .kids, .org, .userbox')) hideFly();
  });
  document.addEventListener('mouseout', (e) => { if (FLY.el && e.target.closest && e.target.closest('.rail') && !(e.relatedTarget && e.relatedTarget.closest && (e.relatedTarget.closest('.rail') || e.relatedTarget.closest('.fly')))) hideFly(); });
  /* on touch screens and from the keyboard, an area's name opens its list in place instead of jumping to its first screen */
  document.addEventListener('click', (e) => {
    const head = e.target.closest && e.target.closest('[data-area-head]');
    if (head) {
      const grp = head.closest('.grp');
      if (!(canHover() && e.detail > 0) && !head.classList.contains('on')) { e.preventDefault(); const open = !grp.classList.contains('open'); grp.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); }
      return;
    }
    const um = document.querySelector('.umenu:not([hidden])');
    if (um && !e.target.closest('.userbox')) { um.hidden = true; const b = document.querySelector('[data-action=userMenu]'); if (b) b.setAttribute('aria-expanded', 'false'); }
    if (e.target.closest && e.target.closest('.rail-menu a[href]') && !e.target.closest('[data-area-head]')) { const rail = document.querySelector('.rail.open'); if (rail) { rail.classList.remove('open'); const mb = document.querySelector('.menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'false'); } }
  }, true);
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K') && S.district && document.getElementById('frame')) { e.preventDefault(); openSearch(); return; }
    if (e.key === '[' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && document.getElementById('frame') && !document.querySelector('[data-modal]')) { e.preventDefault(); if (window.matchMedia('(max-width: 820px)').matches) { const mb = document.querySelector('.menu-btn'); if (mb) mb.click(); } else toggleRail(); }
    if (e.key === 'Escape') { hideFly(true); const um = document.querySelector('.umenu:not([hidden])'); if (um) um.hidden = true; }
  });
  window.addEventListener('hashchange', () => hideFly(true));
  /* the menu never sits scrolled sideways (a focused control or a wide logo can nudge it) */
  document.addEventListener('scroll', (e) => { const r = e.target; if (r && r.classList && r.classList.contains('rail') && r.scrollLeft) r.scrollLeft = 0; }, true);

  // ------------------------------------------------------------------ first-session wizard: three short steps, full screen
  const WIZ_STEPS = [
    { k: 'number', title: 'Find the district in the state’s data', who: (c) => c.admin },
    { k: 'start', title: 'Confirm the starting numbers', who: (c) => c.finance },
    { k: 'gf', title: 'General Fund basics', who: (c) => c.finance },
    { k: 'done', title: 'Done', who: () => true },
  ];
  async function renderWizard(slug, stepKey) {
    const d = S.districts.find((x) => x.slug === slug);
    if (!d) return go('#/');
    S.district = d; S.realRole = roleIn(d); S.role = S.realRole;
    const c = ctx(), steps = WIZ_STEPS.filter((x) => x.who(c));
    if (steps.length < 2) return go(`#/d/${enc(slug)}/home/today`);
    const step = steps.find((x) => x.k === stepKey) || steps[0], i = steps.indexOf(step), next = steps[i + 1];
    WIZ.next = next ? `#/d/${enc(slug)}/welcome/${next.k}` : `#/d/${enc(slug)}/home/today`;
    const mark = d.logo_path ? `<span class="tile logo"><img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt=""></span>` : `<span class="tile" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>`;
    app.innerHTML = `<div class="wiz"><header class="wiz-head">${LOGO_COLOR}<span class="wiz-dist">${mark} ${esc(d.name)}</span><a href="#/d/${enc(slug)}/home/today" class="small">Exit setup</a></header>
      <main class="wiz-main"><ol class="wiz-steps">${steps.map((x, j) => `<li class="${j < i ? 'done' : j === i ? 'on' : ''}">${j < i ? '✓ ' : `${j + 1}. `}${esc(x.title)}</li>`).join('')}</ol>
      <div class="card wiz-card" id="wiz-body"><div class="empty">Loading…</div></div></main></div>`;
    const body = document.getElementById('wiz-body');
    try { body.innerHTML = await wizStepHtml(c, step, slug); if (step.k === 'gf') { await gfHint(); if (GF.prefill) await ACTIONS.gfPrefill(); } }
    catch (err) { body.innerHTML = `<div class="notice error">${esc(err.message || err)}</div>`; }
  }
  const WIZ = { next: null };
  async function wizStepHtml(c, step, slug) {
    const d = c.district;
    if (step.k === 'number') {
      let linked = null;
      if (d.state_district_id) { try { linked = (await HG.db.select('ia_district', `select=name,aea&de_district=eq.${enc(d.state_district_id)}`))[0] || null; } catch (e) { linked = null; } }
      return `<h1>Find ${esc(d.short_name || d.name)} in the state’s data</h1>
        <p>HighGround uses the Iowa Department of Education’s 4-digit district number to fill in your starting numbers and to compare you with districts your size.</p>
        <form class="stack" data-form="wizNumber">
          <div class="inline-form"><label class="field">District name<input data-ia-q value="${esc(d.short_name || '')}" autocomplete="off"></label><button type="button" class="btn" data-action="iaSearch">Find</button></div>
          <div data-ia-results></div>
          <label class="field">Iowa district number<input name="state_district_id" inputmode="numeric" maxlength="4" value="${esc(d.state_district_id || '')}" style="max-width:120px">
            <span class="hint" data-ia-linked>${linked ? `${esc(linked.name)}${linked.aea ? `, AEA ${esc(linked.aea)}` : ''}.` : 'Use Find, or type the number if you know it.'}</span></label>
          <div class="row"><button type="submit" class="btn primary">Save and continue</button><button type="button" class="btn" data-action="wizSkip">Skip for now</button></div></form>`;
    }
    if (step.k === 'start') {
      const [set, bal] = await Promise.all([HG.db.select('district_settings', `select=*&district_id=eq.${d.id}`), HG.db.select('fund_balance', `select=fund,as_of,amount&district_id=eq.${d.id}&order=as_of.desc`)]);
      const s0 = set[0] || {}, st = await statePrefill(d), sp = st ? ppelSplit(st) : {}, lv = st && st.levy, B2 = (st && st.balances) || {}, R2 = (st && st.receipts) || {}, le = (st && st.latest_enrollment) || {};
      const asOf0 = bal.length ? bal[0].as_of : '', B = {}; bal.filter((b) => b.as_of === asOf0).forEach((b) => { B[b.fund] = b.amount; });
      // what's already saved wins; otherwise the state's figures
      const val = (mine, state) => (mine != null && mine !== '' ? mine : state);
      const m = (v) => (v == null || v === '' ? '' : moneyIn(Math.round(Number(v))));
      const voted = lv && Number(lv.voted_ppel) > 0, SF = st ? stateFill(st, 5) : { values: {}, list: [], debts: [] }, sv = SF.values;
      const pctOf = (v) => (v == null || v === '' ? null : pctIn(v));
      /* filled from the state's data without a field of their own here; all are on Settings → Starting numbers */
      const hiddenState = [['save_trend', pctOf(s0.save_trend)], ['ppel_growth', pctOf(s0.ppel_growth)], ['taxable_valuation', s0.taxable_valuation == null ? null : moneyIn(s0.taxable_valuation)],
        ['actual_valuation', s0.actual_valuation == null ? null : moneyIn(s0.actual_valuation)], ['save_ongoing', s0.save_ongoing ? moneyIn(s0.save_ongoing) : null],
        ['ppel_ongoing', s0.ppel_ongoing ? moneyIn(s0.ppel_ongoing) : null], ['grants_avg', s0.grants_avg ? moneyIn(s0.grants_avg) : null],
        ['tax_home_value', s0.tax_home_value ? moneyIn(s0.tax_home_value) : null], ['construction_inflation', pctOf(s0.construction_inflation)]]
        .map(([n, mine]) => [n, mine != null && mine !== '' ? mine : sv[n]]).filter(([, v]) => v != null && v !== '');
      const f = (n, l, v, h) => `<label class="field">${esc(l)}<input name="${n}" inputmode="decimal" value="${esc(v == null ? '' : v)}">${h ? `<span class="hint">${esc(h)}</span>` : ''}</label>`;
      return `<h1>Confirm the starting numbers</h1>
        <p>${st ? `Filled from the state’s annual report (FY${esc(st.fiscal_year)})${lv ? ` and levy rates (FY${esc(lv.fiscal_year)})` : ''}. Change anything you have newer figures for, like this year’s audit.` : 'Enter the district’s figures from the general ledger or the audit.'}</p>
        ${st && stateAge(st.fiscal_year) ? `<div class="notice warn" data-state-age>${esc(stateAge(st.fiscal_year))}</div>` : ''}
        <form class="stack" data-form="wizStart" novalidate>
          <input type="hidden" name="plan_years" value="${esc(s0.plan_years || 10)}"><input type="checkbox" name="sf2472" ${s0.sf2472 === false ? '' : 'checked'} hidden>
          <h3>Balances</h3><div class="fgrid">
            <label class="field">Balances as of<input name="as_of" type="date" value="${esc(val(asOf0, st ? `${st.fiscal_year}-06-30` : ''))}" data-stale-watch><span class="hint gaptext" data-stale-start>${esc(staleStart(val(asOf0, st ? `${st.fiscal_year}-06-30` : '')))}</span></label>
            ${f('bal_save', 'SAVE balance, $', m(val(B.save, B2.save)))}${f('bal_ppel', 'PPEL balance, $', B.ppel != null ? m(B.ppel) : sv.bal_ppel || '', voted ? 'The state reports PPEL and V-PPEL as one fund; this splits it by the two levy rates.' : '')}
            ${f('bal_vppel', 'V-PPEL balance, $', B.vppel != null ? m(B.vppel) : sv.bal_vppel || m(0))}${f('bal_grants', 'Grants and donations on hand, $', m(B.grants || 0))}</div>
          <h3>Receipts each year</h3><div class="fgrid">
            ${f('save_receipts', 'SAVE receipts, $', m(val(s0.save_receipts, R2.save)))}${f('save_receipts_fy', 'For fiscal year', val(s0.save_receipts_fy, st ? st.fiscal_year : ''))}
            ${f('ppel_receipts', 'PPEL receipts, $', m(val(s0.ppel_receipts, sp.regular)))}${f('ppel_rate', 'PPEL rate, $ per $1,000', val(s0.ppel_rate, lv ? Number(lv.regular_ppel) : ''))}</div>
          <h3>Voter-approved PPEL</h3><div class="fgrid">
            <label class="field">Status<select name="vppel_status">${[['none', 'None'], ['proposed', 'Proposed (needs a vote)'], ['active', 'Active']].map(([k, v]) => `<option value="${k}" ${(s0.vppel_status || (voted ? 'active' : 'none')) === k ? 'selected' : ''}>${v}</option>`).join('')}</select>${voted ? '<span class="hint">The state lists a voter-approved PPEL for this district.</span>' : ''}</label>
            ${f('vppel_annual', 'V-PPEL receipts, $', m(val(s0.vppel_annual, sp.voted)))}${f('vppel_first_fy', 'First fiscal year', s0.vppel_first_fy || sv.vppel_first_fy || '', sv.vppel_first_fy && !s0.vppel_first_fy ? 'The first year the state’s levy files show it' : '')}${f('vppel_last_fy', 'Last fiscal year', s0.vppel_last_fy || sv.vppel_last_fy || '', sv.vppel_last_fy && !s0.vppel_last_fy ? 'Assumed: 10 years, the most a vote allows. Check the ballot measure.' : 'From the ballot measure')}</div>
          <h3>Enrollment</h3><div class="fgrid">${f('enrollment', 'Certified enrollment', val(s0.enrollment, le.certified == null ? '' : Math.round(Number(le.certified))), le.fiscal_year ? `The state’s figure is the ${enrollLabel(le.fiscal_year)}.` : '')}${f('enrollment_year', 'Enrollment year', val(s0.enrollment_year, le.fiscal_year ? schoolYear(le.fiscal_year) : ''))}</div>
          ${hiddenState.map(([n, v]) => `<input type="hidden" name="${n}" value="${esc(v)}">`).join('')}
          ${SF.list.length ? `<div class="notice ok small"><b>Also filled in from the state’s data</b> ${def('sources')} (change them later in Settings → Starting numbers):<ul>${SF.list.filter(([l]) => !/payments|paid in/i.test(l)).map(([l, v]) => `<li>${esc(l)}: ${esc(v)}</li>`).join('')}</ul>${st && st.more && st.more.home_value ? `<span class="muted">${CENSUS_NOTICE}</span>` : ''}</div>` : ''}
          <h3>Existing debt paid from SAVE or PPEL</h3>
          <p class="small muted">Revenue bonds and leases already committed. You can add more later in Settings → Starting numbers.</p>
          <div class="scroll"><table class="data debt"><thead><tr><th>Obligation</th><th>Paid from</th><th>Payment per year, $</th><th>Final fiscal year</th><th></th></tr></thead><tbody data-debt-body>${wizDebtRow()}</tbody></table></div>
          ${SF.debts.length ? `<p class="small">The state’s annual report shows ${SF.debts.map((x) => `${esc(x.name)} of $${moneyIn(x.annual)}`).join(', ')} paid last year. Add ${SF.debts.length === 1 ? 'it' : 'each'} above with its final year from the bond or lease schedule.</p>` : ''}
          <template data-debt-template>${wizDebtRow()}</template>
          <div><button type="button" class="btn small" data-action="addDebtRow">Add another</button></div>
          <div class="notice error" data-setup-errors hidden></div>
          <div class="row"><button type="submit" class="btn primary">Save and continue</button><button type="button" class="btn" data-action="wizSkip">Skip for now</button></div></form>`;
    }
    if (step.k === 'gf') {
      GF.rows = await loadCapitalRows(d);
      if (!GF.rows.settings) return `<h1>General Fund basics</h1><p>This step needs the starting numbers first.</p><div class="row"><a class="btn primary" href="#/d/${enc(slug)}/welcome/start">Back to the starting numbers</a><button type="button" class="btn" data-action="wizSkip">Skip for now</button></div>`;
      return `<h1>General Fund basics</h1><p>The five-year General Fund forecast starts here. Figures from the state are filled in where it has them; staff numbers and salaries come from your own records.</p>${openGfEditor({ wizard: true })}`;
    }
    return `<h1>The basics are in</h1>
      <p>Next, bring in the district’s projects: download the template on the Uploads screen, fill it in, and upload it. The “Getting set up” list on Home shows what’s left: the board version, the strategic plan, inviting people and the first board report.</p>
      <div class="row"><a class="btn primary" href="#/d/${enc(slug)}/settings/uploads">Upload projects</a><a class="btn" href="#/d/${enc(slug)}/home/today">Go to Home</a></div>`;
  }
  const wizDebtRow = (x) => `<tr data-debt-row data-id=""><td><input name="debt_name" aria-label="Obligation" placeholder="SAVE revenue bonds, Series 2021" value="${esc((x && x.name) || '')}"></td>
    <td><select name="debt_fund" aria-label="Paid from">${[['save', 'SAVE'], ['ppel', 'PPEL'], ['debt_levy', 'Debt service levy']].map(([k, v]) => `<option value="${k}" ${x && x.fund === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><input name="debt_annual" inputmode="decimal" aria-label="Payment per year" value="${esc(x ? moneyIn(x.annual) : '')}"></td><td><input name="debt_final" inputmode="numeric" aria-label="Final fiscal year" placeholder="2033"></td>
    <td><button type="button" class="btn small danger" data-action="removeDebtRow">Remove</button></td></tr>`;
  // ------------------------------------------------------------------ views: Overview
  async function vOverview(c) {
    const d = c.district, D = await loadDirection(d), rows = D.rows, f = HGReport.fmt;
    const [batches, mem, acts, latestRep, peers] = await Promise.all([
      HG.db.select('import_batch', `select=id,kind,status,uploaded_at,period_end&district_id=eq.${d.id}&order=uploaded_at.desc&limit=50`).catch(() => []),
      HG.db.select('district_member', `select=user_id&district_id=eq.${d.id}`).catch(() => []),
      c.admin ? HG.db.select('audit_log', `select=table_name,action,actor,at,new_row,old_row&district_id=eq.${d.id}&order=at.desc&limit=8`).catch(() => []) : Promise.resolve([]),
      HG.db.select('report_snapshot', `select=id,period_end,title&district_id=eq.${d.id}&kind=eq.board_monthly&order=period_end.desc&limit=1`).catch(() => []),
      loadPeers(d),
    ]);
    const regIds = batches.filter((b) => b.kind === 'check_register' && b.status === 'applied').map((b) => b.id);
    const regOpen = regIds.length ? await HG.db.select('register_flag', `select=id&district_id=eq.${d.id}&status=eq.open&severity=in.(question,concern)&batch_id=in.(${regIds.join(',')})`).catch(() => []) : [];
    const board = rows.scenarios.find((x) => x.is_board_version);
    let gap = null, cr = null;
    if (board && rows.settings) { const bi = HGCapital.buildInputs(rows, board.id); cr = HGEngine.compute(bi.projects, bi.levers, bi.cfg); gap = cr.gap; }
    const lastBal = (fund) => (D.balances || []).filter((b) => b.fund === fund).sort((x, y) => (x.as_of < y.as_of ? 1 : -1))[0] || null;
    const gl = batches.filter((b) => b.kind === 'gl_monthly' && b.status === 'applied' && b.period_end).sort((x, y) => (x.period_end < y.period_end ? 1 : -1))[0] || null;
    const ms = D.measures.map((m) => ({ m, x: D.st.get(m.id) })), on = ms.filter((y) => y.x.state === 'ontrack' || y.x.state === 'met').length;
    const off = ms.filter((y) => y.x.state === 'offtrack'), owed = ms.filter((y) => y.x.owed);
    const pending = rows.initiatives.filter((i) => ['idea', 'proposed', 'analysis'].includes(i.status || 'proposed'));
    const inBoard = (id) => board && (rows.phases.some((p) => p.scenario_id === board.id && p.initiative_id === id) || (rows.recurring || []).some((r) => r.scenario_id === board.id && r.initiative_id === id));
    const approvedOut = rows.initiatives.filter((i) => ['approved', 'underway'].includes(i.status) && board && !inBoard(i.id));
    const pendingIn = board ? pending.filter((i) => inBoard(i.id)) : [];   // not approved, yet counted in the board version's numbers
    const link = (path, text) => `<a href="#/d/${enc(d.slug)}/${path}">${text}</a>`;
    const tile = (label, value, sub, o2 = {}) => `<div class="card tile-card${o2.cls ? ' ' + o2.cls : ''}" data-area="${o2.area || 'home'}"><div class="tl"><span class="ti">${icon(o2.ic || 'home', 14, 2)}</span><span>${label}</span></div><div class="stat">${value}</div>${o2.viz || ''}${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    const AT = (area, ic, html) => html ? { area, ic, html } : '';
    const attention = [
      ...off.map((y) => AT('track', 'alert', `${measureLink(d.slug, y.m)} is off track.`)),
      AT('track', 'target', owed.length ? `${owed.length} measure${owed.length === 1 ? ' has' : 's have'} an update owed (${link('track/measures', 'record results')}).` : ''),
      ...approvedOut.map((i) => AT('plan', 'plan', c.plan ? `${esc(i.name)} is approved but not in the board version (${link('plan/initiatives', 'initiatives')}).` : `${esc(i.name)} is approved but not yet in the board version.`)),
      AT('money', 'money', pendingIn.length ? `${pendingIn.length > 3 ? `${pendingIn.length} initiatives that aren’t approved yet are` : `${pendingIn.map((i) => esc(i.name)).join(', ')} ${pendingIn.length === 1 ? 'isn’t approved yet but is' : 'aren’t approved yet but are'}`} counted in the board version’s numbers`
        + (c.plan ? ` (${link('money/capital', 'capital plan')}). Approve ${pendingIn.length === 1 ? 'it' : 'them'}, or move ${pendingIn.length === 1 ? 'it' : 'them'} to another scenario.` : '.') : ''),
      AT('money', 'money', !board && rows.scenarios.length ? `No scenario is the board version yet (${link('money/capital', 'capital plan')}).` : ''),
      AT('set', 'set', !rows.settings ? (c.finance ? `Starting numbers aren’t set up yet (${link('settings/setup', 'starting numbers')}).` : 'The district’s starting numbers aren’t entered yet.') : ''),
      AT('set', 'clock', rows.settings && rows.settings.plan_start_fy && rows.settings.plan_start_fy < fyNow() ? `The plan starts in FY${rows.settings.plan_start_fy}, a year that has already ended: its balances are from before July 1, ${fyNow() - 1}.`
        + (c.finance ? ` Update them with this year’s figures (${link('settings/setup', 'starting numbers')}).` : ' The business office can update them.') : ''),
      AT('track', 'book', regOpen.length ? (c.finance ? `${regOpen.length} check-register question${regOpen.length === 1 ? ' is' : 's are'} waiting for your answer (${link('track/registers', 'check register')}).`
        : `${regOpen.length} check-register question${regOpen.length === 1 ? ' is' : 's are'} with the business office (${link('track/registers', 'see them')}).`) : ''),
      AT('money', 'users', peers && HGPeers.overviewLine(peers.rows) ? `${esc(HGPeers.overviewLine(peers.rows))} (${link('money/summary', 'funds')}, ${link('money/general', 'General Fund')}).` : ''),
    ].filter(Boolean);
    const sb = lastBal('save'), pb = lastBal('ppel');
    const lead = (gap == null ? '' : gap > 0.5 ? `The board version is <b>${f(gap)}</b> short. ` : 'The board version is fully paid for. ')
      + (attention.length ? `<b>${attention.length}</b> thing${attention.length === 1 ? ' needs' : 's need'} attention.` : 'Nothing needs attention right now.');
    const hour = new Date().getHours(), hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const first = ((S.profile && S.profile.full_name) || '').trim().split(/\s+/)[0];
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const sc = (x) => ({ met: 'met', ontrack: 'on', offtrack: 'off' }[x.state] || 'nd');
    return `
      <section class="home-hero">
        <div class="hh-topo" aria-hidden="true" style="background-image:url(&quot;${TOPO}&quot;)"></div>
        <div class="hh-txt">
          <div class="hh-hi">${hi}${first ? ', ' + esc(first) : ''} <span>· ${esc(today)}</span></div>
          <p class="lead">${lead}</p>
        </div>
      </section>
      ${ledgerNote(c, batches)}
      ${setupCard(c, { rows, D, mem, latestRep })}
      <div class="grid tiles home-tiles">${overviewTiles(c, { tile, f, link, gap, cr, board, sb, pb, gl, D, on, off, pending, latestRep, mem, rows, regOpen })}
      </div>
      <div class="card attn"><h3>Needs attention ${attention.length ? `<span class="count">${attention.length}</span>` : ''}</h3>${attention.length ? `<ul class="attn-list">${attention.map((x) => `<li data-area="${x.area}"><span class="sq">${icon(x.ic, 14, 2)}</span><span>${x.html}</span></li>`).join('')}</ul>` : '<p class="ok">Nothing needs attention right now.</p>'}</div>
      ${D.priorities.length ? `<div class="card"><h3>The strategic plan</h3><div class="prio-grid">${D.priorities.map((p, k) => { const pm = ms.filter((y) => y.m.priority_id === p.id), pon = pm.filter((y) => ['ontrack', 'met'].includes(y.x.state)).length, n = rows.initiatives.filter((i) => i.priority_id === p.id).length;
        return `<a class="prio" href="#/d/${enc(d.slug)}/plan/priorities"><span class="pn">${k + 1}</span><b>${esc(p.name)}</b>
          <span class="pdots" aria-hidden="true">${pm.map((y) => `<i class="${sc(y.x)}" title="${esc(y.m.name)}"></i>`).join('')}</span>
          <span class="small muted">${pm.length ? `${pon} of ${pm.length} measures on track` : 'no measures yet'} · ${n} initiative${n === 1 ? '' : 's'}</span></a>`; }).join('')}</div>
        <div class="pkey small muted"><span><i class="met"></i>met</span><span><i class="on"></i>on track</span><span><i class="off"></i>off track</span><span><i class="nd"></i>no data yet</span></div></div>` : ''}
      ${c.admin && acts.length ? `<div class="card"><h3>Recent changes</h3><ul class="recent">${acts.map((a2) => { const x = a2.new_row || a2.old_row || {}; return `<li><span>${esc(TABLE_NAMES[a2.table_name] || a2.table_name)}${x.name ? ': ' + esc(x.name) : ''}</span> <span class="small muted">${a2.action === 'insert' ? 'added' : a2.action === 'delete' ? 'removed' : 'changed'} ${esc(day(a2.at))}</span></li>`; }).join('')}</ul>
        <p class="small">${link('settings/activity', 'All activity')}</p></div>` : ''}`;
  }
  /* faint layered ridgelines for Home's welcome band, echoing the peak in the HighGround mark */
  const TOPO = (() => {
    const W = 800, H = 200;
    const ridge = (base, amp, seed) => { const pts = [`0,${H}`]; for (let x = 0; x <= W; x += 40) { const t = x / W, y = base - amp * (0.55 * Math.sin(t * 7 + seed) + 0.35 * Math.sin(t * 13 + seed * 2.1) + 0.6 * t); pts.push(`${x},${y.toFixed(1)}`); } pts.push(`${W},${H}`); return pts; };
    const layers = [[120, 70, 1.2, 0.05], [150, 55, 2.6, 0.07], [178, 40, 4.1, 0.09]];
    const polys = layers.map(([b0, a0, sd, o]) => `<polygon points='${ridge(b0, a0, sd).join(' ')}' fill='#2F6B4F' fill-opacity='${o}'/>`).join('');
    const top = ridge(120, 70, 1.2).slice(1, -1).join(' ');
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMaxYMax slice'>${polys}<polyline points='${top}' fill='none' stroke='#2F6B4F' stroke-opacity='.2' stroke-width='1.2' stroke-linejoin='round'/></svg>`);
  })();
  /* small pictures inside the Home tiles */
  const MINI = {
    meter: (part, whole, cls) => { const p = whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0; return `<div class="mini-meter ${cls || ''}"><i style="width:${p.toFixed(1)}%"></i></div>`; },
    spark: (vals, cls) => { if (!vals || vals.length < 2) return ''; const mx = Math.max(...vals, 1), mn = Math.min(...vals, 0), w = 120, h = 26, sx = w / (vals.length - 1);
      const pts = vals.map((v, i) => `${(i * sx).toFixed(1)},${(h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`);
      return `<svg class="mini-spark ${cls || ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="ar" d="M0,${h}L${pts.join('L')}L${w},${h}Z"/><path class="ln" d="M${pts.join('L')}"/></svg>`; },
    segs: (parts) => { const t = parts.reduce((a, x) => a + x[0], 0) || 1; return `<div class="mini-segs">${parts.filter((x) => x[0]).map(([n, cls]) => `<i class="${cls}" style="flex:${n}"></i>`).join('')}</div>`; },
    months: (n) => `<div class="mini-months" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`,
  };

  /* ---- in-page help: what this screen is for and how to use it, opened from any screen (the full Guide stays in Help) ---- */
  const HELP = {
    'home/today': ['The tiles are the numbers to watch for your role; “Needs attention” lists what’s off track or waiting on someone.', 'Click a tile’s link or a line in “Needs attention” to go straight to it.'],
    'plan/priorities': ['Priorities are the few things the district most wants to achieve; each has outcomes, and outcomes have measures.', 'Initiatives link to the priority they serve, so spending can be traced to goals.'],
    'track/measures': ['Each measure has a starting point, a target and a cadence; on track means at or ahead of a straight path to the target.', 'Record a result with “Record result”, or upload many at once.'],
    'plan/community': ['Add the community survey: how important each priority is, and the themes people raised.', 'The latest survey can appear on the public page as “What you told us”.'],
    'plan/initiatives': ['Everything that costs money, in one list: capital projects, programs, hires.', 'Filter by status; open one to change its cost, years, priority, owner or the year it’s needed by.'],
    'plan/ranking': ['Your force rank: #1 is funded first, whatever its priority. Use ▲ ▼ or type a number to move one; “Start from priorities” is a starting point.', '“Year by year” shows when each initiative can be paid for: when a year is short, what can wait moves to the next year, never past its needed-by year.', '“Ways to fit more” lists single moves that fund more; “What would it take?” finds how to fund one initiative by a year you pick. Each can become a new scenario without touching the original.'],
    'plan/scenarios': ['Tick up to three scenarios to compare them side by side.', '“Why the gap differs” shows what each change between two scenarios does to the gap.'],
    'money/summary': ['Every fund from the board version: capital fund balances, what’s available against what’s committed, and the General Fund.', 'Open the folds for the year-by-year numbers.'],
    'money/general': ['A five-year General Fund forecast: solvency, spending authority and what a negotiated raise (the total package increase) costs.', 'Try the what-if levers; nothing is saved. The business office keeps the starting figures current; “Fill these in” uses the public sources listed below.'],
    'money/capital': ['Projects by year, split across the capital funds, and the gap left to close.', '“What-if and financing” tries changes without saving; “Leave projects out” shows the plan without them.', '“What it means for taxpayers” shows the added levy for a typical home and an acre.'],
    'track/initiatives': ['Each initiative this fiscal year: planned, spent and encumbered, from the monthly ledger.', 'Link new spending accounts to initiatives so their spending counts.'],
    'track/actuals': ['Each fund’s budget, actual and year-end forecast from the month-end general ledger (GL) export.'],
    'settings/uploads': ['Bring in the month-end ledger, the check register, the budget, projects or balances.', 'Nothing changes until you review what HighGround read and click Apply; the original file is kept.'],
    'track/registers': ['Questions from the month’s bills: new vendors, possible duplicates, changed names, payments much larger than usual.', 'The business office answers; everyone in the district can read the answers. Set the bid threshold in the settings at the bottom.'],
    'share/board': ['Create the month’s board report: it’s saved exactly as made, and the next one compares itself with it.', 'Decision packets put one initiative on one page for a vote.'],
    'share/community': ['Publish the board version to the public link, with unapproved initiatives held back.', 'Preview first; every publish is logged.'],
    'share/plans': ['One plan, three views: the full plan (named by the district), the academic goals tagged as state CSIP goals, and the capital improvement plan.', 'Choose approved items only, or all items with proposals labelled; totals always count approved work only. Print it, download it for Excel, or save the version the board adopted.'],
    'settings/overview': ['Every setting, grouped, with a line saying where each one stands. The banner at the top shows how much of the district’s setup is done.', 'Click a card to open that setting.'],
    'settings/district': ['The district’s name, look and public link, and its Iowa district number (for peer comparisons and pre-filled numbers).'],
    'settings/setup': ['What the capital plan starts from: receipts, balances and existing debt.', 'If the Iowa district number is set, “Fill in” uses public figures from the state and federal agencies listed below; you can change any of them before saving.'],
    'settings/people': ['Invite people with a role: admin, business manager, superintendent, editor, board member or viewer.'],
    'settings/activity': ['Every change: who, when, and what it was before.'],
    'settings/assumptions': ['Base, Conservative and Growth outlooks a scenario can plan for.'],
    'settings/exports': ['Download the district’s data for spreadsheets or backup.'],
  };
  function openHelp() {
    const parts = location.hash.replace(/^#\/?/, '').split('/'), path = `${parts[2] || 'home'}/${parts[3] || ''}`;
    const sec = ALL.find((x) => x.id === parts[2]) || SECTIONS[0], tab = sec.tabs.find((t) => t.id === parts[3]) || sec.tabs[0];
    const tips = HELP[`${sec.id}/${tab.id}`] || [];
    const terms = [...new Set([...document.querySelectorAll('#view [data-term]')].map((x) => x.dataset.term))].filter((k) => TERMS[k]);
    modal(`<div class="stack"><div class="row" style="justify-content:space-between"><h2 id="modal-title">${sec.tabs.length === 1 || sec.id === 'home' ? esc(tab.label) : `${esc(sec.label)}: ${esc(tab.label)}`}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <p>${esc(tab.lede)}</p>
      ${tips.length ? `<ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${['settings/setup', 'money/general', 'settings/district'].includes(`${sec.id}/${tab.id}`) ? sourcesHtml() : ''}
      ${terms.filter((k) => k !== 'sources').length ? `<h3>Terms on this screen</h3><dl class="terms">${terms.filter((k) => k !== 'sources').map((k) => `<dt>${esc(TERMS[k][0])}</dt><dd>${esc(TERMS[k][1])}</dd>`).join('')}</dl>` : ''}
      <p class="small"><a href="#/d/${enc(S.district.slug)}/help/guide">The full guide</a> · Questions: <a href="mailto:support@willowholler.com">support@willowholler.com</a></p></div>`);
  }
  /* ---- guided setup: the district's first steps, each checked against its own data; each step opens the real screen ---- */
  const SETUP = { step: null };
  function setupSteps(c, o) {
    const d = c.district, rows = o.rows;
    return [
      { k: 'district', who: c.admin, title: 'District details and Iowa number', path: 'settings/district', done: !!d.state_district_id, why: 'Links the district to the state’s data: peer comparisons and pre-filled starting numbers.' },
      { k: 'start', who: c.finance, title: 'Starting numbers', path: 'settings/setup', done: !!rows.settings, why: 'SAVE, PPEL and V-PPEL receipts, balances and existing debt: what the capital plan starts from.' },
      { k: 'projects', who: c.plan, title: 'Projects', path: 'settings/uploads', done: rows.scenarios.length > 0, why: 'Upload the project list (there’s a template) to create the first scenario.' },
      { k: 'board', who: c.admin, title: 'Board version', path: 'money/capital', done: rows.scenarios.some((x) => x.is_board_version), why: 'Mark the scenario the board adopted; reports, progress and the public page follow it.' },
      { k: 'gf', who: c.finance, title: 'General Fund figures', path: 'money/general', done: !!(rows.settings && rows.settings.gf_inputs), why: 'Enrollment, staffing and balances for the five-year General Fund forecast.' },
      { k: 'plan', who: c.plan, title: 'Strategic plan', path: 'plan/priorities', done: (o.D.priorities || []).length > 0, why: 'Priorities and measures, so initiatives link to what they’re for.' },
      { k: 'people', who: c.admin, title: 'Invite people', path: 'settings/people', done: o.mem.length > 1, why: 'The business manager, superintendent and board members, each with the right role.' },
      { k: 'report', who: c.plan || c.finance, title: 'First board report', path: 'share/board', done: o.latestRep.length > 0, why: 'A monthly report built from all of the above.' },
    ];
  }
  function setupCard(c, o) {
    if (!(c.admin || c.plan || c.finance)) return '';
    let hidden = false; try { hidden = localStorage.getItem('highground-setup-hidden-' + c.district.id) === '1'; } catch (e) {}
    const steps = setupSteps(c, o), done = steps.filter((x) => x.done).length;
    if (done === steps.length || hidden) return '';
    const next = steps.find((x) => !x.done && x.who) || null;
    SETUP.steps = steps;
    return `<div class="card setupcard" data-setup-guide><div class="row" style="justify-content:space-between"><h3>Getting set up · ${done} of ${steps.length} done</h3><button type="button" class="btn small" data-action="setupHide">Hide</button></div>
      <div class="setup-bar" aria-hidden="true"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div>
      <ol class="stepper">${steps.map((x, i) => `<li class="${x.done ? 'done' : next && x.k === next.k ? 'next' : ''}"><span class="dot">${x.done ? '✓' : i + 1}</span><span>${esc(x.title)}${x.who || x.done ? '' : ' <span class="small muted">(another role)</span>'}</span></li>`).join('')}</ol>
      ${(c.admin || c.finance) && (!c.district.state_district_id || !o.rows.settings || !o.rows.settings.gf_inputs) ? `<p><b>New here?</b> The guided setup covers the first three steps in about ten minutes, with the state’s figures filled in.</p>
        <div class="row"><a class="btn primary" href="#/d/${enc(c.district.slug)}/welcome">Start the guided setup</a>${next ? `<button type="button" class="btn" data-action="setupGo" data-k="${next.k}">Or go to: ${esc(next.title)}</button>` : ''}</div>`
      : next ? `<p><b>Next: ${esc(next.title)}.</b> ${esc(next.why)}</p><button type="button" class="btn primary" data-action="setupGo" data-k="${next.k}">Start this step</button>` : '<p class="muted">The remaining steps belong to other roles.</p>'}</div>`;
  }
  /** on a step's screen: where you are in setup, and the way on */
  function setupBanner(sectionId, tabId) {
    const st = SETUP.step && SETUP.steps ? SETUP.steps.find((x) => x.k === SETUP.step) : null;
    if (!st || st.path !== `${sectionId}/${tabId}`) return '';
    const i = SETUP.steps.indexOf(st), nx = SETUP.steps.slice(i + 1).find((x) => !x.done && x.who);
    return `<div class="notice ok setupbanner"><b>Setup, step ${i + 1} of ${SETUP.steps.length}: ${esc(st.title)}.</b> ${esc(st.why)}
      <span class="row" style="margin-top:6px">${nx ? `<button type="button" class="btn small primary" data-action="setupGo" data-k="${nx.k}">Next: ${esc(nx.title)}</button>` : ''}<button type="button" class="btn small" data-action="setupBack">Back to setup</button></span></div>`;
  }
  /* Overview tiles by role: what each reader acts on (board: the plan and reserves; business office: the close; planners: everything) */
  function overviewTiles(c, o) {
    const { tile, f, link, gap, cr, board, sb, pb, gl, D, on, off, pending, latestRep, mem, rows, regOpen } = o;
    const bal = (b) => (cr ? cr.res.map((y) => y.carryIn[b] || 0) : null);
    const glMonths = gl ? (() => { const m = new Date(gl.period_end + 'T12:00:00').getMonth(); return ((m - 6 + 12) % 12) + 1; })() : 0;
    const counts = { met: 0, on: 0, off: 0, nd: 0 }; D.measures.forEach((m) => { const x = D.st.get(m.id) || {}; counts[{ met: 'met', ontrack: 'on', offtrack: 'off' }[x.state] || 'nd']++; });
    const T = {
      gap: () => tile('Gap to close ' + def('gap'), gap == null ? '—' : f(gap), board ? (cr && cr.need ? `${Math.round(((cr.need - gap) / cr.need) * 100)}% of ${f(cr.need)} covered · ` : '') + esc(board.name) : 'no board version yet',
        { area: 'money', ic: 'money', cls: gap > 0.5 ? 'gap' : '', viz: cr && cr.need ? MINI.meter(cr.need - gap, cr.need, 'cov') : '' }),
      save: () => tile('SAVE balance ' + def('save'), sb ? f(Number(sb.amount)) : '—', sb ? 'as of ' + esc(day(sb.as_of)) + (cr ? ' · by year' : '') : '', { area: 'money', ic: 'money', viz: MINI.spark(bal('save')) }),
      ppel: () => tile('PPEL balance ' + def('ppel'), pb ? f(Number(pb.amount)) : '—', pb ? 'as of ' + esc(day(pb.as_of)) + (cr ? ' · by year' : '') : '', { area: 'money', ic: 'money', viz: MINI.spark(bal('ppel')) }),
      solvency: () => { const g = board ? gfRun(rows, board.id) : null; if (!g) return ''; const ys = g.R.years; return tile('General Fund solvency ' + def('solvency'), pct1(ys[0].solvency), `${pct1(ys[ys.length - 1].solvency)} by FY${ys[ys.length - 1].fy} ${link('money/general', 'forecast')}`, { area: 'money', ic: 'calc', viz: MINI.spark(ys.map((y) => y.solvency), ys[ys.length - 1].solvency < 0.05 ? 'bad' : '') }); },
      ledger: () => tile('Ledger', gl ? 'Through ' + esc(day(gl.period_end).replace(/, \d{4}$/, '')) : 'None yet', gl ? `monthly GL · ${glMonths} of 12 months` : (c.finance ? link('settings/uploads', 'upload the month-end general ledger export') : ''), { area: 'track', ic: 'book', viz: gl ? MINI.months(glMonths) : '' }),
      nextClose: () => { if (!gl) return ''; const d0 = new Date(gl.period_end + 'T12:00:00'), nx = new Date(d0.getFullYear(), d0.getMonth() + 2, 0); return tile('Next month-end', esc(nx.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), link('settings/uploads', 'upload when it closes'), { area: 'track', ic: 'clock' }); },
      register: () => tile('Check register', regOpen.length ? `${regOpen.length} open` : 'All answered', link('track/registers', regOpen.length ? 'answer questions' : 'open'), { area: 'track', ic: 'book' }),
      measures: () => tile('Measures on track ' + def('measure_status'), D.measures.length ? `${on} of ${D.measures.length}` : '—', D.measures.length ? `${off.length} off track` : (c.plan ? link('track/measures', 'add measures') : 'none yet'),
        { area: 'track', ic: 'target', viz: D.measures.length ? MINI.segs([[counts.met, 'met'], [counts.on, 'on'], [counts.off, 'off'], [counts.nd, 'nd']]) : '' }),
      decisions: () => tile(c.plan ? 'Decisions ahead' : 'Awaiting a decision', pending.length, pending.length ? 'initiatives not yet approved' : '', { area: 'plan', ic: 'plan' }),
      report: () => tile('Latest board report', latestRep[0] ? esc(day(latestRep[0].period_end).replace(/, \d{4}$/, '')) : 'None yet', latestRep[0] ? link('share/board', 'open reports') : (c.admin || c.plan || c.finance ? link('share/board', 'create one') : ''), { area: 'share', ic: 'report' }),
      people: () => tile('People with access', mem.length, `${rows.initiatives.length} initiatives · ${rows.scenarios.length} scenarios`, { area: 'set', ic: 'users' }),
    };
    const order = c.admin || c.staff ? ['gap', 'save', 'ppel', 'ledger', 'measures', 'decisions', 'report', 'people']
      : c.finance ? ['ledger', 'register', 'nextClose', 'save', 'ppel', 'gap', 'solvency', 'report']
      : c.plan ? ['gap', 'save', 'ppel', 'solvency', 'measures', 'decisions', 'report', 'ledger']
      : ['gap', 'save', 'ppel', 'solvency', 'measures', 'decisions', 'report'];
    return order.map((k) => T[k]()).join('');
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
        reps.map((r) => ({ k: 'report', id: r.id, name: r.title || 'Report', what: r.kind === 'decision_packet' ? 'Decision packet' : 'Board report' })),
        screenItems());
      SRCH.key = d.id;
    }
    modal(`<div class="stack"><div class="row" style="justify-content:space-between"><h2 id="modal-title">Search ${esc(d.short_name || d.name)}</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>
      <input type="search" data-search placeholder="Initiatives, priorities, measures, scenarios, reports, screens" aria-label="Search" style="height:42px;border:1px solid var(--border);border-radius:8px;padding:0 12px;font:inherit">
      <div data-search-results>${searchResults('')}</div></div>`);
    setTimeout(() => { const el = document.querySelector('[data-search]'); if (el) el.focus(); }, 0);
  }
  /* screens, and the features inside them, so “what-if” or “starting numbers” finds where they live */
  const FEATURES = [['What-if levers', 'money/capital', 'sliders growth inflation financing'], ['Projects by year', 'money/capital', 'cards table'], ['Leave projects out', 'money/capital', ''],
    ['What it means for taxpayers', 'money/capital', 'tax home farmland acre levy'], ['Gap to close', 'money/capital', 'bond campaign'], ['Year by year funding', 'plan/ranking', 'schedule'],
    ['Ranking (Initiatives, Ranked)', 'plan/ranking', 'force rank order funding line priority'], ['Ways to fit more', 'plan/ranking', 'suggestions'], ['What would it take?', 'plan/ranking', ''], ['Funding line', 'plan/ranking', 'force rank order'], ['Needed-by year', 'plan/initiatives', 'need by deadline'],
    ['Compare scenarios', 'plan/scenarios', 'why the gap differs'], ['Solvency ratio', 'money/general', 'unspent balance forecast settlement total package raise negotiations'], ['Guided setup', 'settings/setup', 'wizard getting set up'],
    ['Fill in from public data', 'settings/setup', 'state census enrollment valuations prefill'], ['Existing debt', 'settings/setup', 'GO bonds obligations'], ['Upload the month-end ledger', 'settings/uploads', 'gl excel csv budget balances'],
    ['Templates', 'settings/uploads', 'excel xlsx'], ['Improvement plan', 'share/plans', 'cip csip timelines'], ['Decision packets', 'share/board', ''], ['Public link', 'share/community', 'publish'],
    ['Possible duplicate payments', 'track/registers', 'vendors bills'], ['Peer comparisons', 'money/summary', 'similar districts state annual report'], ['Glossary', 'help/guide', 'definitions terms sources'],
    ['Logo', 'settings/district', 'brand color'], ['Iowa district number', 'settings/district', ''], ['Invite people', 'settings/people', 'roles']];
  function screenItems() {
    const out = [];
    ALL.forEach((s) => visibleTabs(s).filter((t) => t.menu !== false).forEach((t) => out.push({ k: 'screen', id: `${s.id}/${t.id}`, name: t.label === s.label || s.id === 'home' ? t.label : t.label, what: s.id === 'home' || s.id === 'help' ? 'Screen' : `Screen · ${s.label}`, area: s.id })));
    FEATURES.forEach(([n, path, kw]) => { const [sid, tid] = path.split('/'), sec = ALL.find((x) => x.id === sid), tab = sec && visibleTabs(sec).find((x) => x.id === tid);
      if (tab) out.push({ k: 'screen', id: path, name: n, kw, what: `In ${sec.id === 'help' ? 'Help' : `${sec.label} / ${tab.label}`}`, area: sid }); });
    return out;
  }
  function searchResults(q) {
    const t = q.trim().toLowerCase();
    if (!t) { const sc = SRCH.items.filter((x) => x.k === 'screen' && /^Screen/.test(x.what));
      return `<p class="small muted">Type to search initiatives, priorities, measures, scenarios, reports and screens. Or go to:</p><ul class="srch">${sc.map((x) => `<li><a href="#" data-action="searchGo" data-k="screen" data-id="${esc(x.id)}">${esc(x.name)}</a> <span class="small muted">· ${esc(x.what)}</span></li>`).join('')}</ul>`; }
    const hits = SRCH.items.filter((x) => (x.name + ' ' + (x.kw || '')).toLowerCase().includes(t)).slice(0, 15);
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
  /** a measure's name as a link to its row on Track → Measures (the row is scrolled to and highlighted) */
  const measureLink = (slug, m) => `<a href="#/d/${enc(slug)}/track/measures" data-measure-go="${esc(m.id)}" class="mlink">${esc(m.name)}</a>`;
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
      setLead(`${D.priorities.length} priorit${D.priorities.length === 1 ? 'y' : 'ies'}, served by <b>${linked}</b> initiative${linked === 1 ? '' : 's'}${unlinked && c.plan ? `; ${unlinked} not linked to a priority yet` : ''}.`); }
    if (!D.priorities.length && !c.plan) return '<div class="card"><h3>No strategic plan yet</h3><p>The district hasn’t entered its strategic plan in HighGround yet. Its priorities, outcomes and measures will show here.</p></div>';
    if (!D.priorities.length) return `<div class="card"><h3>No priorities yet</h3><p>Start with the strategic plan’s priorities: the few things the district most wants to achieve. Each gets outcomes and measures, and initiatives link to the priority they serve.</p>
      ${c.plan ? '<div class="row"><button type="button" class="btn primary" data-action="editPriority" data-id="">Add a priority</button><label class="btn">Upload goals<input type="file" data-dir-upload="goals" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="goals">template, with instructions</a></div>' : ''}<div id="dir-upload"></div></div>`;
    return `<div id="dir-upload"></div>
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editPriority" data-id="">Add a priority</button>' : ''}
        <a class="btn" href="#/d/${enc(c.district.slug)}/track/measures">Measures</a>
        ${c.plan ? '<label class="btn">Upload goals<input type="file" data-dir-upload="goals" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="goals">template, with instructions</a>' : ''}
        ${unlinked && c.plan ? `<span class="small muted">${unlinked} initiative${unlinked === 1 ? ' isn’t' : 's aren’t'} linked to a priority yet. <a href="#/d/${enc(c.district.slug)}/plan/initiatives">Link them on Decisions</a>.</span>` : ''}</div>
      ${D.priorities.map((pr, k) => {
        const outs = D.outcomes.filter((o) => o.priority_id === pr.id), ms = D.measures.filter((m) => m.priority_id === pr.id), inits = rows.initiatives.filter((i) => i.priority_id === pr.id);
        return `<div class="card prio"><div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><div class="small muted">Priority ${k + 1}${pr.csip_goal ? ' · <span class="st st-approved">CSIP goal</span>' : ''}</div><h3 style="margin:2px 0">${esc(pr.name)}</h3>${pr.statement ? `<p>${esc(pr.statement)}</p>` : ''}
            ${(() => { const sv = D.surveys[0], imp = sv && D.results.find((r) => r.survey_id === sv.id && r.kind === 'importance' && r.priority_id === pr.id && r.value != null);
              return imp ? `<div class="small">Community importance: <b>${Number(imp.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>${Number(imp.value) <= 5 ? ' out of 5' : ''} <span class="muted">· ${esc(sv.name)}</span></div>` : ''; })()}</div>
          ${c.plan ? `<div class="row moves"><button type="button" class="btn small" data-action="prioMove" data-id="${esc(pr.id)}" data-d="-1" ${k ? '' : 'disabled'} aria-label="Move up">▲</button><button type="button" class="btn small" data-action="prioMove" data-id="${esc(pr.id)}" data-d="1" ${k < D.priorities.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button><button type="button" class="btn small" data-action="editPriority" data-id="${esc(pr.id)}">Edit</button></div>` : ''}</div>
          <div class="pgrid">
            <div><div class="small muted">Outcomes</div>${outs.length ? `<ul>${outs.map((o) => `<li>${esc(o.name)}</li>`).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</div>
            <div><div class="small muted">Measures</div>${ms.length ? `<ul>${ms.map((m) => `<li>${measureLink(c.district.slug, m)} ${stateBadge(D.st.get(m.id))}</li>`).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</div>
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
      <label class="row"><input type="checkbox" name="csip_goal" ${pr.csip_goal ? 'checked' : ''}> One of the district’s state CSIP goals ${def('csip')}</label>
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
    // the CSIP tag needs database part 21; send it only when it's set or the column is already there, so nothing breaks before then
    const old = id ? D.priorities.find((x) => x.id === id) : null, csip = !!f.csip_goal;
    const tag = csip || (old && 'csip_goal' in old) ? { csip_goal: csip } : {};
    if (id) await HG.db.update('priority', `id=eq.${enc(id)}`, { name: name.slice(0, 120), statement: (f.statement || '').trim() || null, ...tag });
    else { id = crypto.randomUUID(); await HG.db.insert('priority', { id, district_id: d, name: name.slice(0, 120), statement: (f.statement || '').trim() || null, position: D.priorities.length + 1, ...tag }); }
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
    if (!D.priorities.length) return `<div class="card"><h3>Add priorities first</h3><p>Measures sit under a priority (and optionally one of its outcomes).</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/plan/priorities">Priorities</a></div>`;
    const CAD = { monthly: 'Monthly', quarterly: 'Quarterly', semester: 'Each semester', annual: 'Yearly' };
    const counts = { met: 0, ontrack: 0, offtrack: 0, owed: 0 };
    D.measures.forEach((m) => { const x = D.st.get(m.id); if (counts[x.state] != null) counts[x.state]++; if (x.owed) counts.owed++; });
    const canRec = c.plan || c.finance, offNames = D.measures.filter((m) => D.st.get(m.id).state === 'offtrack').map((m) => measureLink(c.district.slug, m));
    setLead(D.measures.length ? `<b>${counts.met + counts.ontrack} of ${D.measures.length}</b> measures are on track or met${offNames.length ? `; off track: ${offNames.join(', ')}` : ''}.` : 'No measures yet.');
    const owed = D.measures.filter((m) => D.st.get(m.id).owed), byOwner = {};
    owed.forEach((m) => { (byOwner[m.owner_name || 'No owner'] = byOwner[m.owner_name || 'No owner'] || []).push(m); });
    return `
      ${owed.length ? `<div class="card"><h3>Updates owed</h3>${Object.entries(byOwner).map(([o, list]) => `<p><b>${esc(o)}</b>: ${list.map((m) => `${esc(m.name)} <span class="small muted">(due ${esc(day(D.st.get(m.id).due))})</span>`).join(', ')}</p>`).join('')}</div>` : ''}
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editMeasure" data-id="">Add a measure</button>' : ''}
        ${canRec ? '<label class="btn">Upload results<input type="file" data-dir-upload="results" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="results">template, with instructions</a>' : ''}

        <span class="small muted">${D.measures.length} measure${D.measures.length === 1 ? '' : 's'}: ${counts.met} met, ${counts.ontrack} on track, ${counts.offtrack} off track${counts.owed ? `, ${counts.owed} with an update owed` : ''}.</span></div>
      ${D.priorities.map((pr) => { const ms = D.measures.filter((m) => m.priority_id === pr.id); const outs = new Map(D.outcomes.map((o) => [o.id, o.name]));
        return `<div class="card"><h3>${esc(pr.name)}</h3>${ms.length ? `<div class="scroll"><table class="data"><thead><tr><th>Measure</th><th>Start → target</th><th>Latest</th><th>Status</th><th>Toward target</th><th>Owner</th><th>Updates</th><th></th></tr></thead><tbody>
          ${ms.map((m) => { const x = D.st.get(m.id); return `<tr data-measure-row="${esc(m.id)}" id="measure-${esc(m.id)}"><td><b>${esc(m.name)}</b>${m.outcome_id ? `<br><span class="small muted">${esc(outs.get(m.outcome_id) || '')}</span>` : ''}</td>
            <td>${mVal(m, m.baseline_value)} <span class="small muted nw">${esc(m.baseline_period || '')}</span> → <b>${mVal(m, m.target_value)}</b> <span class="small muted nw">${esc(m.target_period || '')}</span>${m.better === 'down' ? '<br><span class="small muted">lower is better</span>' : ''}</td>
            <td>${x.latest ? `${mVal(m, x.latest.value)} <span class="small muted">${esc(x.latest.period)}</span>` : ''} ${spark(m, x)}</td>
            <td>${stateBadge(x)}</td>
            <td>${x.progress != null ? `<span class="ubar"><i style="width:${(x.progress * 100).toFixed(0)}%"></i></span> <span class="small muted">${Math.round(x.progress * 100)}%</span>` : ''}</td>
            <td>${esc(m.owner_name || '')}</td><td class="small">${m.auto_metric ? '<span class="st st-approved">Updates itself</span>' : `${esc(CAD[m.cadence] || '')}${x.due ? `<br><span class="muted">next by <span class="nw">${esc(day(x.due))}</span></span>` : ''}`}</td>
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
    if (!D.measures.length && !c.plan && !c.finance) return '<div class="card"><h3>No measures yet</h3><p>The district hasn’t set up how it measures its goals yet.</p></div>';
    if (!D.measures.length) return `<div class="card"><h3>No measures yet</h3><p>Add measures first, then record their results here.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/track/measures">Measures</a></div>`;
    const can = c.plan || c.finance, owed = D.measures.filter((m) => D.st.get(m.id).owed);
    const byOwner = {}; owed.forEach((m) => { (byOwner[m.owner_name || 'No owner'] = byOwner[m.owner_name || 'No owner'] || []).push(m); });
    return `
      ${owed.length ? `<div class="card"><h3>Updates owed</h3>${Object.entries(byOwner).map(([o, list]) => `<p><b>${esc(o)}</b>: ${list.map((m) => `${esc(m.name)} <span class="small muted">(due ${esc(day(D.st.get(m.id).due))})</span>`).join(', ')}</p>`).join('')}</div>` : '<div class="notice ok">Every measure is up to date.</div>'}
      ${can ? '<div class="row"><label class="btn">Upload results<input type="file" data-dir-upload="results" accept=".csv,.xlsx" hidden></label> <a href="#" class="small" data-action="dirTemplate" data-k="results">template, with instructions</a></div><div id="dir-upload"></div>' : ''}
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
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editSurvey" data-id="">Add a survey</button>' : ''} <a href="#" class="small" data-action="dirTemplate" data-k="survey">survey results template, with instructions</a>
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
    survey: [['Kind', 'Item', 'Score or %', 'How many mentioned it', 'Priority it relates to'],
      ['Importance', 'Safe, modern places to learn', '4.7', '', ''], ['Importance', 'Every graduate ready for what’s next', '4.5', '', ''],
      ['Theme', 'Elementary classrooms are crowded', '', '141', 'Safe, modern places to learn'], ['Theme', 'More hands-on career classes', '', '96', 'Every graduate ready for what’s next'],
      ['Question', 'Would support a bond for a CTE building (% yes)', '58', '', '']],
  };
  /* ---- every template carries a second sheet, “How to fill this in”: what each column takes, with examples, and what happens on upload.
     Rows starting “## ” are headings. The first sheet is the one HighGround reads. ---- */
  const H2 = (t) => [`## ${t}`, ''];
  const PERIODS = 'A period is a school year (2025-26), a fiscal year (FY2027), a month (2026-09) or a calendar year (2026).';
  const TEMPLATE_HELP = {
    survey: [H2('Community survey results: how to fill this in'),
      ['What it’s for', 'One row for each result from your community survey. HighGround shows them on Plan → Community input, beside the priority each one relates to, and (if you choose) on the public page as “What you told us”.'],
      ['Before you start', 'Delete the example rows on the first sheet. Keep the headings in row 1 as they are.'],
      H2('There are three kinds of row. Use whichever your survey has.'),
      ['Importance', 'A rating of how important something is, usually one row per priority. Item: the priority’s name, spelled as it is in HighGround. Score or %: the average rating (for example 4.7 on a 1–5 scale).'],
      ['Theme', 'Something many people raised in their own words, from the open-ended answers. Item: the theme in a few words. How many mentioned it: the number of people who raised it.'],
      ['Question', 'Any other single result, such as support for a bond or a new program. Item: the question, short. Score or %: the result (58 for 58% yes).'],
      H2('The columns'),
      ['Kind', 'Importance, Theme or Question. If you leave it blank, the row is treated as a Theme.'],
      ['Item', 'Required. What was rated or said (see the three kinds above).'],
      ['Score or %', 'Importance and Question rows: a number, without the % sign. Leave it blank for themes.'],
      ['How many mentioned it', 'Theme rows: a whole number. Leave it blank for the others.'],
      ['Priority it relates to', 'Optional. One of your priorities, spelled as it is in HighGround, so the result shows beside it. Importance rows link to the priority with the same name on their own.'],
      H2('Uploading it'),
      ['Where', 'Plan → Community input. Add the survey first (its name and dates), then use Upload results on that survey.'],
      ['What you’ll see', 'HighGround shows what it read, row by row, with anything it couldn’t use. Nothing is saved until you click Apply.']],
    goals: [H2('Priorities and measures: how to fill this in'),
      ['What it’s for', 'Loads the strategic plan in one go: priorities, the outcomes under them, and the measures that show whether each is working. Priorities, outcomes and measures that already exist (by name) are kept; new ones are added.'],
      ['Before you start', 'Delete the example rows. One row per measure. Repeat the priority (and outcome) on each of its rows. A row with only a priority (or a priority and an outcome) adds just that.'],
      H2('The columns'),
      ['Priority', 'Required. One of the few things the district most wants to achieve, for example “Safe, modern places to learn”.'],
      ['Outcome', 'Optional. What success looks like under that priority, for example “Safe and secure buildings”.'],
      ['Measure', 'What you’ll track, for example “Buildings with a secure entry”.'],
      ['Unit', 'Optional: %, $, students, buildings, days…'],
      ['Better', 'Higher or Lower: which way is good. Graduation rate: Higher. Chronic absence: Lower.'],
      ['Start, Start period', 'Where the measure stood, and when. ' + PERIODS],
      ['Target, Target period', 'Where you want it to be, and by when.'],
      ['Owner', 'Optional: who reports the results, for example “Principal, high school”.'],
      ['Cadence', 'How often a new result comes in: Monthly, Quarterly, Semester or Yearly (blank counts as Yearly).'],
      H2('How status is worked out'),
      ['Met', 'The latest result has reached the target.'],
      ['On track', 'The latest result is at or ahead of a straight line from the start to the target, at that result’s date (within 2% of the distance from start to target).'],
      ['Off track', 'Behind that straight line.'],
      ['Update owed', 'No new result within the cadence plus a month (for a yearly measure, 13 months after the last result).'],
      H2('Uploading it'),
      ['Where', 'Plan → Priorities, Upload goals. HighGround shows what it read before anything is saved.']],
    results: [H2('Measure results: how to fill this in'),
      ['What it’s for', 'Records new results for measures you already have, many at once.'],
      ['Before you start', 'Delete the example rows. One row per result.'],
      H2('The columns'),
      ['Measure', 'Required. The measure’s name exactly as it is in HighGround (Track → Measures lists them).'],
      ['Period', 'Required. When the result is for. ' + PERIODS],
      ['Result', 'Required. A number, without % or $ signs (12.4, not 12.4%).'],
      ['Note', 'Optional, for example “Spring semester” or “State-reported”.'],
      H2('Good to know'),
      ['Replacing', 'A result for a period that already has one replaces it.'],
      ['Measures that update themselves', 'Rows for measures HighGround works out on its own (marked “Updates itself”) are skipped.'],
      ['Where', 'Track → Measures, Upload results. HighGround shows what it read before anything is saved.']],
    projects: [H2('Projects: how to fill this in'),
      ['What it’s for', 'Brings in the capital project list. Each upload becomes a new scenario; nothing already in HighGround changes.'],
      ['Before you start', 'Delete the example rows. One row per project, or one row per phase when a project is done in stages (repeat the project’s name on each phase).'],
      H2('The columns'),
      ['Project', 'Required. The project’s name. Rows with the same name are phases of one project.'],
      ['Phase name', 'Optional, for a project in stages: “Sections A–B”, “Phase 1”.'],
      ['FY', 'Required. The fiscal year it’s paid for: FY2028 or 2028.'],
      ['Estimate', 'Required. The cost in dollars: 185000, $185,000 or 185k. A range (250000-300000) uses the middle and marks the cost as an estimate.'],
      ['Funding source, Funding %', 'Where the money comes from: SAVE, PPEL, V-PPEL, Grants/Donations, Boosters or Campaign/Bond, and its share. Up to three sources (Funding source 2 and 3); the shares should add to 100. One source with no % means 100%.'],
      ['Either fund (“SAVE or PPEL”)', 'When a project could be paid from more than one fund, write them with “or” in Funding source, in the order you’d prefer, and leave Funding % blank: SAVE or PPEL, or PPEL or Grants/Donations or Boosters. The whole phase is paid from the first fund with room that year; the capital plan shows which one it used.'],
      ['Priority', 'Must-have, Strategic or Nice to have. It sets the starting order in the ranking.'],
      ['Focus area', 'Optional, for example Facilities, Safety & security, Technology, Transportation, Activities.'],
      ['Cost confidence (Firm/Estimate)', 'Firm for a bid or contract; Estimate otherwise (blank counts as Estimate).'],
      ['Status', 'Optional: Underway or Complete. Leave blank for planned work.'],
      ['Actual cost', 'For a Complete phase: what it actually cost.'],
      ['Condition', 'Optional: Good, Fair, Poor or Critical.'],
      ['Remaining life (years)', 'Optional: how many years the thing being replaced has left.'],
      H2('Uploading it'),
      ['Where', 'Settings → Uploads, choose Projects. HighGround shows what it read, with anything it couldn’t use, before you click Apply.']],
    balances: [H2('Fund balances: how to fill this in'),
      ['What it’s for', 'The capital funds’ balances on one date, from the ledger or the audit. HighGround uses them as the plan’s starting point.'],
      ['Before you start', 'Keep the fund names in the first column. Fill in Balance and As-of date for each fund the district has; leave the others blank.'],
      H2('The columns'),
      ['Fund', 'The fund’s name, as given. HighGround recognises SAVE, PPEL, V-PPEL and grants by name.'],
      ['Iowa fund code', 'For reference (33 for SAVE, 36 for PPEL and V-PPEL). Optional.'],
      ['Balance', 'The balance in dollars: 2150000 or $2,150,000.'],
      ['As-of date', 'The date of the balances, usually June 30 or a month-end: 2026-06-30. Use the same date on every row. Balances from before this fiscal year start the plan in a year that has already ended, and HighGround will say so.'],
      ['PPEL and V-PPEL', 'The state reports them as one fund (36). If you levy both, split the balance between the two rows.'],
      H2('Uploading it'),
      ['Where', 'Settings → Uploads, choose Fund balances. HighGround shows what it read before anything is saved.']],
    staff: [H2('Staff list: how to fill this in'),
      ['What it’s for', 'Fills in the General Fund forecast’s staff groups. HighGround adds up each group and works out the average salary and health insurance per full-time person. Names are never saved.'],
      ['Before you start', 'Delete the example rows. One row per position, from payroll or the budget.'],
      H2('The columns'),
      ['Position or name', 'Optional, for your own reference. It isn’t saved.'],
      ['Group', 'Required. Use the same few groups throughout, for example Teachers, Paraeducators, Support staff, Administrators.'],
      ['FTE', 'Full-time equivalent: 1 for full time, 0.5 for half time. Blank counts as 1.'],
      ['Annual salary', 'Required. Dollars for the year, for this position as filled (not the full-time rate for a part-time person).'],
      ['District health insurance contribution (annual)', 'Optional. What the district pays for this person’s health insurance in a year. 0 if they don’t take it.'],
      H2('Uploading it'),
      ['Where', 'Money → General fund, Enter (or Edit) the starting figures, then Fill from a staff list.']],
  };
  /** a template: the sheet HighGround reads, then “How to fill this in” */
  function saveTemplate(file, rows, sheet, helpKey) {
    saveFile(file, HGUploads.toXlsx(rows, sheet, TEMPLATE_HELP[helpKey] ? [{ name: 'How to fill this in', rows: TEMPLATE_HELP[helpKey], widths: [30, 100], text: true }] : []), XLSX_TYPE);
  }
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
    INI.key = c.district.id; if (!rows.scenarios.some((x) => x.id === INI.sid)) INI.sid = board ? board.id : null;
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
        ${INIT_STATUS.filter(([k]) => counts[k] || INI.status === k).map(([k, v]) => `<button type="button" class="pipe ${INI.status === k ? 'on' : ''}" data-action="iniStatus" data-v="${k}">${v} <b>${counts[k]}</b></button>`).join('')}
      </div>
      <div class="row">
        ${rows.scenarios.length ? `<label class="chip"><span class="small muted">Costs from</span><select data-ini-sid aria-label="Costs from">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === INI.sid ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>` : ''}
        <label class="chip"><span class="small muted">Type</span><select data-ini-type aria-label="Type"><option value="">All types</option>${INIT_TYPES.map(([k, v]) => `<option value="${k}" ${INI.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${c.plan ? '<button type="button" class="btn primary" data-action="editInitiative" data-id="">Add an initiative</button>' : ''}
        <a class="btn" href="#/d/${enc(c.district.slug)}/settings/uploads">Upload projects</a>
      </div>
      <div class="card">${table([
        { label: 'Initiative', html: (i) => (c.plan ? `<a href="#" data-action="editInitiative" data-id="${esc(i.id)}">${esc(i.name)}</a>` : esc(i.name)) },
        { label: 'Type', get: (i) => TYPE[i.type] || i.type },
        { label: 'Status', html: (i) => `<span class="st st-${esc(i.status || 'proposed')}">${esc(STATUS[i.status || 'proposed'])}</span>` },
        { label: 'In plans', html: (i) => { const pl = plansOf(i.id); const inBoard = board && pl.some((x) => x.id === board.id);
          const warn = (i.status === 'approved' || i.status === 'underway') && board && !inBoard ? `<br><span class="small gaptext">Approved, but not in the board version yet</span>` : '';
          // the board version is what matters; other scenarios collapse to a count (names on hover)
          const others = pl.filter((x) => !(board && x.id === board.id));
          const more = others.length ? `<span class="small muted" title="${esc(others.map((x) => x.name).join(', '))}">${inBoard ? ` · +${others.length} other${others.length === 1 ? '' : 's'}` : others.map((x) => esc(x.name)).join(', ')}</span>` : '';
          return (pl.length ? (inBoard ? 'Board version' : '') + more : '<span class="muted">Not in a plan yet</span>') + warn; } },
        { label: 'Priority', get: (i) => (HGUploads.TIER_WORD[HGRanking.tierOf(i).tier] || '') },
        ...((rows.priorities || []).length ? [{ label: 'Strategic priority', get: (i) => P[i.priority_id] || '' }] : []),
        { label: 'Owner', get: (i) => i.owner_name || '' },
        { label: 'One-time cost', num: true, get: (i) => (oneTime[i.id] ? fmtK(oneTime[i.id]) : '') },
        { label: 'Yearly cost', num: true, get: (i) => (yearly[i.id] ? fmtK(yearly[i.id]) : '') },
      ], list, rows.initiatives.length ? 'Nothing matches these filters.' : 'No initiatives yet. Add one, or upload a project spreadsheet.')}
      ${costSc ? `<p class="small muted" style="margin-top:8px">Costs are from ${esc(costSc.name)}${costSc.is_board_version ? ', the board version' : ''}, in today’s dollars (yearly costs at their starting amount). Change them here or on the capital plan; both edit the same plan.</p>` : ''}</div>`;
  }
  const RK = { key: null, sid: null };
  /* ---- the year-by-year funding line (schedule.js): who waits, by how long, and what's still short ---- */
  function yearsTimeline(S, cfg) {
    const yrs = cfg.years, list = S.items, labelW = 250, colW = 64, rowH = 30, top = 44, W = labelW + yrs.length * colW + 10, H = top + list.length * rowH + 8;
    const X = (fy) => labelW + (fy - cfg.start) * colW + colW / 2;
    const ST = { 'on time': ['#2F6B4F', 'On time'], later: ['#B54708', 'Waits'], short: ['#B42318', 'Short'], outside: ['#8A948F', 'Campaign or boosters'] };
    const head = yrs.map((fy, i) => { const y = S.years[i]; return `<text x="${X(fy)}" y="16" font-size="12" text-anchor="middle" fill="#5A6660">FY${String(fy).slice(2)}</text>
      ${y && y.short > 0.5 ? `<text x="${X(fy)}" y="32" font-size="11" text-anchor="middle" fill="#B42318" font-weight="600">−${esc(fmtK(y.short))}</text>` : ''}`; }).join('');
    const grid = yrs.map((fy) => `<line x1="${X(fy)}" x2="${X(fy)}" y1="${top - 6}" y2="${H - 4}" stroke="#EEEAE0"/>`).join('');
    const rows = list.map((x, r) => {
      const y = top + r * rowH + rowH / 2, [color, word] = ST[x.status];
      const late = x.needBy != null && Math.max(...x.scheduled) > x.needBy;
      const nb = x.needBy && x.needBy >= cfg.start && x.needBy < cfg.start + yrs.length ? `<line x1="${X(x.needBy) + colW / 2 - 4}" x2="${X(x.needBy) + colW / 2 - 4}" y1="${y - 11}" y2="${y + 11}" stroke="#1C2A24" stroke-width="2"><title>${esc(x.name)}: needed by FY${x.needBy}</title></line>` : '';
      const marks = x.scheduled.map((fy, k) => { const from = x.planned[k];
        return `${from !== fy ? `<line x1="${X(from)}" x2="${X(fy) - 9}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="2" stroke-dasharray="3 3"/><circle cx="${X(from)}" cy="${y}" r="6" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(x.name)}: planned FY${from}</title></circle>` : ''}
          <rect x="${X(fy) - 9}" y="${y - 9}" width="18" height="18" rx="4" fill="${color}"><title>${esc(x.name)}: ${esc(word.toLowerCase())}, FY${fy}${from !== fy ? ` (planned FY${from})` : ''}${x.needBy ? `; needed by FY${x.needBy}` : ''}</title></rect>`; }).join('');
      return `<text x="8" y="${y + 4}" font-size="13" fill="#1C2A24">${esc(x.name.length > 34 ? x.name.slice(0, 33) + '…' : x.name)}</text>
        <text x="${labelW - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${late ? '#B42318' : x.status === 'on time' || x.status === 'outside' ? '#5A6660' : color}">${x.status === 'short' ? 'short' : late ? 'after it’s needed' : x.status === 'later' ? `waits ${x.slip} yr${x.slip === 1 ? '' : 's'}` : ''}</text>${nb}${marks}`;
    }).join('');
    return `<div class="scroll"><svg class="yrtimeline" viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 900)}px" role="img" aria-label="Each initiative by year: when it was planned, when the capital funds can pay for it, and the year it is needed by">${grid}${head}${rows}</svg></div>
      <p class="small legend"><span><i style="background:#2F6B4F"></i>On time</span><span><i style="background:#B54708"></i>Waits (still by its needed-by year)</span><span><i style="background:#B42318"></i>Short that year</span><span><i style="background:#8A948F"></i>Campaign or boosters</span><span>○ planned year</span><span>│ needed by</span></p>`;
  }
  async function vRanking(c) {
    const rows = await loadCapitalRows(c.district);
    RK.rows = rows;
    if (!rows.settings || !rows.scenarios.length) return notReady(c, { rows });
    RK.key = c.district.id; if (!rows.scenarios.some((x) => x.id === RK.sid)) RK.sid = (rows.scenarios.find((x) => x.is_board_version) || rows.scenarios[0]).id;
    const sc = rows.scenarios.find((x) => x.id === RK.sid), k = HGRanking.build(rows, RK.sid, { by: RK.by || 'rank' });
    RK.k = k; RK.ctx = c;
    const SG = HGSuggest.suggest(HGCapital.buildInputs(rows, RK.sid), k.items, rows.initiatives); RK.sugg = SG.suggestions;
    const lateIds = new Set(SG.late.map((x) => x.id));
    const canMove = c.plan && !sc.is_locked, TN = HGRanking.TIER_NAME;
    const outside = k.items.filter((x) => x.outside > 0.5);
    const campTotal = outside.reduce((a, x) => a + x.camp, 0), boostTotal = outside.reduce((a, x) => a + x.boost, 0);
    const summary = k.line >= k.items.length
      ? (outside.length ? `<b>Everything planned for SAVE, PPEL, V-PPEL and grants fits</b>, in rank order; ${[campTotal > 0.5 ? `${fmtK(campTotal)} waits on a campaign or bond` : '', boostTotal > 0.5 ? `${fmtK(boostTotal)} on boosters` : ''].filter(Boolean).join(' and ')}.`
        : `<b>Everything fits</b> within SAVE, PPEL, V-PPEL and grants, in rank order.`)
      : `<b>The money runs out at #${k.line + 1}.</b> The first ${k.line} initiative${k.line === 1 ? '' : 's'} (${fmtK(k.aboveCost)}) fit within SAVE, PPEL, V-PPEL and grants; ${k.items.length - k.line} fall below the line.`;
    if (RK.view === 'years') return rankYearsHtml(c, rows, sc, k);
    const tierSel = (x) => c.plan ? `<select data-rank-tier="${esc(x.id)}" aria-label="Priority for ${esc(x.name)}">${HGRanking.TIERS.map((t) => `<option value="${t}" ${x.tier === t ? 'selected' : ''}>${TN[t]}</option>`).join('')}</select>${x.suggested ? '<br><span class="small muted">from the old High/Med/Low</span>' : ''}`
      : `${TN[x.tier]}${x.suggested ? ' <span class="small muted">(suggested)</span>' : ''}`;
    const canStep = (x, d) => { const j = k.items.indexOf(x) + d; return j >= 0 && j < k.items.length; };
    const ranked = (RK.by || 'rank') === 'rank';   // moving only makes sense in the force-rank view
    const row = (x) => `<tr class="${x.above ? '' : 'below'}">
      <td class="num">${canMove && ranked ? `<input class="rankpos" data-rank-to="${esc(x.id)}" inputmode="numeric" value="${x.position}" aria-label="Rank for ${esc(x.name)}">` : `<b>#${x.position}</b>`}</td>
      <td>${tierSel(x)}</td>
      <td>${esc(x.name)}${x.camp > 0.5 ? `<br><span class="small muted">${fmtK(x.camp)} from a campaign or bond</span>` : ''}${x.boost > 0.5 ? `<br><span class="small muted">${fmtK(x.boost)} from boosters</span>` : ''}</td>
      <td>${x.years.length ? 'FY' + x.years.join(', ') : '<span class="muted">yearly only</span>'}${x.needBy ? `<br><span class="small ${lateIds.has(String(x.id)) ? 'gaptext' : 'muted'}">needed by FY${x.needBy}${lateIds.has(String(x.id)) ? ' (planned later)' : ''}</span>` : ''}</td>
      <td class="num">${x.oneTime ? fmtK(x.oneTime) : ''}</td>
      <td class="num">${x.yearly ? fmtK(x.yearly) + '/yr' : ''}</td>
      <td>${x.above && x.outsideOnly ? `<span class="st st-proposed">${x.camp > 0.5 ? 'Campaign or bond' : 'Boosters'}</span>` : x.above ? '<span class="st st-approved">Fits</span>' : x.fitsAlone ? '<span class="st st-proposed">Below the line, but would fit on its own</span>' : '<span class="st st-declined">Below the line</span>'}</td>
      <td class="moves">${canMove && ranked ? `<button type="button" class="btn small" data-action="rankMove" data-id="${esc(x.id)}" data-d="-1" ${canStep(x, -1) ? '' : 'disabled'} aria-label="Move ${esc(x.name)} up">▲</button><button type="button" class="btn small" data-action="rankMove" data-id="${esc(x.id)}" data-d="1" ${canStep(x, 1) ? '' : 'disabled'} aria-label="Move ${esc(x.name)} down">▼</button>` : ''}</td></tr>`;
    const body = k.items.map((x, j) => (j === k.line ? `<tr class="fline"><td colspan="8">Funding line: the money runs out here</td></tr>` : '') + row(x)).join('');
    const ro = k.rankOrder;
    return `
      <div class="row">
        <label class="chip"><span class="small muted">Order by</span><select data-rank-by aria-label="Order by"><option value="rank" ${(RK.by || 'rank') === 'rank' ? 'selected' : ''}>Our rank</option><option value="need" ${RK.by === 'need' ? 'selected' : ''}>When needed, then our rank</option><option value="priority" ${RK.by === 'priority' ? 'selected' : ''}>Grouped by priority</option></select></label>
        <div class="seg" role="group" aria-label="View"><button type="button" class="btn small ${(RK.view || 'list') === 'list' ? 'on' : ''}" data-action="rankView" data-v="list" aria-pressed="${(RK.view || 'list') === 'list'}">Ranked list</button><button type="button" class="btn small ${RK.view === 'years' ? 'on' : ''}" data-action="rankView" data-v="years" aria-pressed="${RK.view === 'years'}">Year by year</button></div>
        ${canMove && ranked && RK.view !== 'years' ? '<button type="button" class="btn small" data-action="rankFromTiers">Start from priorities</button>' : ''}
        <label class="chip"><span class="small muted">Scenario</span><select data-rank-sid aria-label="Scenario">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === RK.sid ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}${x.is_locked ? ' (locked)' : ''}</option>`).join('')}</select></label>
      </div>
      ${(() => { setLead(summary.replace(/<\/?b>/g, (m) => m)); return ''; })()}<div class="card">
        ${outside.length ? `<p class="small">${k.line >= k.items.length ? 'Paid outside the levies' : 'Separately'}, ${[campTotal > 0.5 ? `<b>${fmtK(campTotal)}</b> depends on a campaign or bond` : '', boostTotal > 0.5 ? `<b>${fmtK(boostTotal)}</b> on boosters` : ''].filter(Boolean).join(' and ')}: ${outside.map((x) => `#${x.position} ${esc(x.name)}`).join(', ')}.</p>` : ''}
        <p class="small muted">Priorities say why something matters: <b>must-have</b> (safety, law, failing systems), <b>strategic</b> (moves the strategic plan forward), <b>nice to have</b> (worth doing when money allows). The list is the district’s own force rank: #1 is funded first, whatever its priority. Use ▲ ▼ or type a new number to move one; “Start from priorities” orders the whole list by priority as a starting point.${sc.is_locked ? ' This scenario is locked, so its order can’t change; priorities can, because they belong to the initiative.' : ''}</p></div>
      <div class="card"><div class="scroll"><table class="data ranktable"><thead><tr><th>#</th><th>Priority</th><th>Initiative</th><th>Years</th><th class="num">One-time</th><th class="num">Yearly</th><th>Funding line</th><th></th></tr></thead>
        <tbody>${body}</tbody></table></div></div>
      ${(() => {
        const useful = SG.suggestions.filter((g) => g.funds.length || g.gapChange < -0.5);
        const warn = [...SG.urgentBelow.map((x) => `<li class="gaptext">${esc(x.name)} is below the line but needed by FY${x.needBy}.</li>`), ...(SG.late.length ? [`<li>${SG.late.length} initiative${SG.late.length === 1 ? ' is' : 's are'} planned after the year ${SG.late.length === 1 ? 'it’s' : 'they’re'} needed (marked in the list).</li>`] : [])];
        if (!useful.length && !warn.length) return '';
        return `<div class="card" data-suggest><h3>Ways to fit more</h3>
          ${warn.length ? `<ul>${warn.join('')}</ul>` : ''}
          ${useful.length ? `<p class="small muted">Each is one change, tried against this scenario: the plan rerun with that initiative moved, keeping everything above the line where it is and nothing later than the year it’s needed.</p>
          <ol class="sugg">${useful.map((g) => `<li><b>Move ${esc(g.name)}</b> ${g.delta > 0 ? 'later' : 'earlier'} by ${Math.abs(g.delta)} year${Math.abs(g.delta) === 1 ? '' : 's'} (FY${g.from.join(', FY')} → FY${g.to.join(', FY')}${g.needBy ? `; needed by FY${g.needBy}` : ''}):
            ${g.funds.length ? `funds ${g.funds.map((f) => `<b>${esc(f.name)}</b>`).join(', ')}` : 'funds nothing new'}${g.gapChange < -0.5 ? `${g.funds.length ? ', and ' : ', but '}the gap falls by ${fmtK(-g.gapChange)}` : ''}.
            ${c.plan ? ` <button type="button" class="btn small" data-action="rankSuggest" data-id="${esc(g.id)}">Make a scenario with this</button>` : ''}</li>`).join('')}</ol>` : ''}
          <p class="small muted">Add the year each initiative is needed by in its editor; without one, a remaining life is used.</p></div>`; })()}
      ${k.flags.length ? `<div class="card"><h3>Spent before a higher-ranked need</h3><ul class="flags">${k.flags.slice(0, 12).map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>
        ${k.flags.length > 12 ? `<p class="small muted">and ${k.flags.length - 12} more.</p>` : ''}
        <p class="small muted">Moving the lower-ranked item to a later year, or to another fund, usually fixes this.</p></div>` : ''}
      <div class="card" data-goal><h3>What would it take?</h3>
        <p class="small muted">Pick an initiative and the year it has to be done by. HighGround looks for the smallest change that funds it: ranking it higher, or moving one or two others, never past the year they’re needed by.</p>
        <div class="inline-form"><label class="field">Initiative<select data-goal-id>${k.items.filter((x) => x.project).map((x) => `<option value="${esc(x.id)}" ${!x.above && !RK.goalId ? (RK.goalId = x.id, 'selected') : RK.goalId === x.id ? 'selected' : ''}>#${x.position} ${esc(x.name)}${x.above ? '' : ' (below the line)'}</option>`).join('')}</select></label>
          <label class="field">Done by<select data-goal-fy><option value="">As planned</option>${k.cfg.years.map((fy) => `<option value="${fy}">FY${fy}</option>`).join('')}</select></label>
          <button type="button" class="btn" data-action="goalFind">Find a way</button></div>
        <div id="goal-results"></div></div>
      <div class="card"><h3>Fund in rank order</h3>
        ${ro.deferred.length ? `<p>Keep the ${k.line} initiatives above the line and defer the rest (${fmtK(ro.deferredCost)} one-time${ro.deferredYearly ? `, ${fmtK(ro.deferredYearly)} a year` : ''}): the gap goes from <b>${fmtK(k.current.gap)}</b> to <b>${fmtK(ro.gap)}</b>.</p>
          <p class="small">Deferred: ${ro.deferred.map((x) => esc(x.name)).join(', ')}.</p>
          ${c.plan ? '<button type="button" class="btn primary" data-action="rankScenario">Make a scenario with only what fits</button>' : ''}`
        : `<p>Nothing needs deferring: every initiative fits in rank order.${outside.length ? ` The gap of ${fmtK(k.current.gap)} is the campaign or bond share above that isn’t paid for yet.` : ''}</p>`}</div>`;
  }
  /* ---- goal seek: what would it take to fund one initiative by a year ---- */
  function goalHtml(g, k) {
    const item = k.items.find((x) => String(x.id) === String(RK.goalId)) || {};
    if (!g.options.length) return `<div class="notice ${g.possible ? 'ok' : ''}" style="margin-top:10px">${esc(g.notes.join(' ')) || 'No single change or pair of moves funds it without dropping something else. Look at a campaign, a bond, or a smaller scope.'}</div>`;
    const mv = (m) => `${esc(m.name)} ${m.delta > 0 ? 'later' : 'earlier'} by ${Math.abs(m.delta)} year${Math.abs(m.delta) === 1 ? '' : 's'} (FY${m.from.join(', FY')} → FY${m.to.join(', FY')})`;
    return `${g.notes.length ? `<p class="small" style="margin-top:10px">${esc(g.notes.join(' '))}</p>` : ''}<ol class="sugg">${g.options.map((o, i) => `<li>${o.kind === 'rank'
      ? `<b>Rank it #${o.position}</b>${o.drops.length ? `; then ${o.drops.map((d) => `<b>${esc(d.name)}</b>`).join(', ')} ${o.drops.length === 1 ? 'falls' : 'fall'} below the line` : ''}.`
      : `<b>Move ${o.moves.map(mv).join('</b> and <b>')}</b>; ${esc(item.name || 'it')} then fits at its current rank, and nothing else drops.`}
      ${RK.ctx && RK.ctx.plan ? ` <button type="button" class="btn small" data-action="goalApply" data-i="${i}">Make a scenario with this</button>` : ''}</li>`).join('')}</ol>`;
  }
  function rankYearsHtml(c, rows, sc, k) {
    const inp = HGCapital.buildInputs(rows, RK.sid), cfg = inp.cfg, S = HGSchedule.schedule(inp, k.items); RK.sched = S;
    const waits = S.items.filter((x) => x.status === 'later'), short = S.items.filter((x) => x.status === 'short'), shortYrs = S.years.filter((y) => y.short > 0.5);
    setLead(!waits.length && !short.length ? '<b>Every initiative fits in the year it’s planned</b>, paid from SAVE, PPEL, V-PPEL and grants.'
      : `${short.length ? `<b>${shortYrs.map((y) => `FY${y.fy}`).join(', ')} ${shortYrs.length === 1 ? 'is' : 'are'} short ${fmtK(shortYrs.reduce((a, y) => a + y.short, 0))}</b> even after moving what can wait` : '<b>Everything fits</b>'}${waits.length ? `${short.length ? ';' : ' if'} ${waits.length} initiative${waits.length === 1 ? ' waits' : 's wait'}: ${waits.map((x) => `${esc(x.name)} ${x.slip} year${x.slip === 1 ? '' : 's'}`).join(', ')}` : ''}.`);
    const sel = `<div class="row">
        <label class="chip"><span class="small muted">Scenario</span><select data-rank-sid aria-label="Scenario">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === RK.sid ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>
        <div class="seg" role="group" aria-label="View"><button type="button" class="btn small" data-action="rankView" data-v="list" aria-pressed="false">Ranked list</button><button type="button" class="btn small on" data-action="rankView" data-v="years" aria-pressed="true">Year by year</button></div></div>`;
    return `${sel}
      <div class="card"><h3>When each can be paid for</h3>
        <p class="small muted">Going a year at a time: when the capital funds are short, the initiative that can best wait moves to the next year. That means the lowest in your rank, with room before the year it’s needed by. Nothing moves past its needed-by year, and nothing already underway moves. Campaign and booster projects are shown but don’t compete for levy money.</p>
        ${yearsTimeline(S, cfg)}</div>
      ${waits.length || short.length ? `<div class="card"><h3>What changes</h3>${table([
        { label: 'Initiative', get: (x) => x.name }, { label: 'Priority', get: (x) => HGRanking.TIER_NAME[x.tier] || '' },
        { label: 'Planned', get: (x) => 'FY' + x.planned.join(', FY') }, { label: 'Paid for', html: (x) => x.status === 'short' ? '<span class="gaptext">short</span>' : 'FY' + x.scheduled.join(', FY') },
        { label: 'Needed by', get: (x) => (x.needBy ? 'FY' + x.needBy : '') }], waits.concat(short), '')}
        ${c.plan && S.moves.length ? '<div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-action="rankSchedule">Make a scenario with this timing</button><span class="small muted">The original scenario is unchanged.</span></div>' : ''}</div>` : ''}
      <p class="small muted">Add the year each initiative is needed by in its editor; without one, a capital project’s remaining life is used, and an initiative with neither can wait as long as needed.</p>`;
  }
  async function rankSave(order) {
    await HG.db.upsert('scenario_initiative', order.map((id, n) => ({ scenario_id: RK.sid, initiative_id: id, district_id: S.district.id, rank: n + 1, included: true })), 'scenario_id,initiative_id');
    here();
  }
  async function rankTo(el) {
    const k = RK.k, order = k.items.map((i) => i.id), from = order.indexOf(el.dataset.rankTo), to = Math.round(toNum(el.value));
    if (from < 0 || !(to >= 1)) { el.value = from + 1; return; }
    const [id] = order.splice(from, 1); order.splice(Math.min(order.length, to - 1), 0, id);
    await rankSave(order);
  }
  async function rankMove(el) {
    const k = RK.k, x = k.items.find((i) => i.id === el.dataset.id), j = k.items.indexOf(x), d = Number(el.dataset.d), y = k.items[j + d];
    if (!y) return;
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
    CAP.key = S.district.id; CAP.scenarioId = nid; go(`#/d/${enc(S.district.slug)}/money/capital`);
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
  const notReady = (c, b) => ((!b.rows.settings && !c.finance) || (b.rows.settings && !c.plan && !c.finance)
    ? `<div class="card"><h3>Not set up yet</h3><p>${!b.rows.settings ? 'The business office hasn’t entered the district’s starting numbers yet.' : 'The district’s projects haven’t been entered yet.'} This screen fills in once they are.</p></div>`
    : `<div class="card"><h3>${!b.rows.settings ? 'Starting numbers aren’t set up yet' : 'No scenarios yet'}</h3>
    <p>${!b.rows.settings ? 'Enter the district’s receipts, balances and debt first.' : 'Upload the district’s projects to create its first scenario.'}</p>
    <a class="btn primary" href="#/d/${enc(c.district.slug)}/${!b.rows.settings ? 'settings/setup' : 'settings/uploads'}">${!b.rows.settings ? 'Starting numbers' : 'Upload projects'}</a></div>`);
  /** each capital fund's balance at the end of each year: one line per fund */
  /** charts are drawn narrower on phones so their labels stay readable when scaled to the screen */
  /** [2027, 2028, 2029, 2031] → "FY2027–FY2029, FY2031" */
  const fyRanges = (ys) => { const a = [...new Set(ys.map(Number))].sort((x, y) => x - y), out = []; let s0 = a[0], p = a[0];
    for (let i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } out.push(s0 === p ? `FY${s0}` : `FY${s0}–FY${p}`); s0 = p = a[i]; }
    return out.join(', '); };
  const narrow = () => window.matchMedia('(max-width: 600px)').matches;
  /** a round axis step (1, 2, 2.5 or 5 × a power of ten) near the raw step */
  const niceStep = (raw) => { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return p * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10); };
  function fundsChart(paths, funds) {
    const COLORS = { save: '#3E6190', ppel: '#2F6B4F', vppel: '#6FAF8A', grants: '#8C8577' }, ph = narrow(), fs = ph ? 13 : 11;
    const ys = paths[funds[0]].years, n = ys.length, W = ph ? 400 : 1000, H = ph ? 240 : 260, padL = ph ? 54 : 60, padR = ph ? 10 : 16;
    const all = funds.flatMap((k) => paths[k].years.map((y) => y.end)), step = niceStep(Math.max(1, ...all) / 4), hi = Math.ceil(Math.max(1, ...all) / step) * step;
    const X = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR), Y = (v) => H - 26 - (v / hi) * (H - 44);
    const ticks = Array.from({ length: Math.round(hi / step) + 1 }, (_, i) => i * step);
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Each capital fund's balance at the end of each year">
      ${ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#E4E0D6"/><text x="${padL - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="${fs}" text-anchor="end" fill="#5A6660">${fmtK(v)}</text>`).join('')}
      ${funds.map((k) => `<polyline fill="none" stroke="${COLORS[k]}" stroke-width="2.5" points="${paths[k].years.map((y, i) => `${X(i).toFixed(1)},${Y(y.end).toFixed(1)}`).join(' ')}"/>`).join('')}
      ${ys.map((y, i) => ((ph ? i % 3 === 0 || i === n - 1 : i % 2 === 0) || n <= (ph ? 4 : 6) ? `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="${fs}" text-anchor="middle" fill="#5A6660">FY${y.fy}</text>` : '')).join('')}</svg></div>
      <p class="small">${funds.map((k) => `<span style="color:${COLORS[k]}">●</span> ${esc(FUND_NAMES[k])}`).join(' &nbsp; ')}</p>`;
  }
  /** for each capital fund over the plan: money available (starting balance + receipts) split into what's already committed
      (debt payments, ongoing and yearly costs), the board version's projects, and what's left; anything short shows in red */
  function commitChart(paths, funds, L, cfg) {
    const K = HGCapital.commitments(L, cfg);
    const rows = funds.map((k) => { const p = paths[k], c = K[k], committed = c.debt + c.ongoing + c.yearly, avail = p.open + p.receipts + committed;
      return { k, avail, debt: c.debt, other: c.ongoing + c.yearly, proj: p.spend, left: Math.max(0, avail - committed - p.spend), short: p.over }; });
    const hi = Math.max(1, ...rows.map((r) => Math.max(r.avail, r.debt + r.other + r.proj) + r.short));
    const SEG = [['debt', '#4B5563', 'Debt payments'], ['other', '#9AA5A0', 'Ongoing and yearly costs'], ['proj', '#2F6B4F', 'Board-version projects'], ['left', '#BFDCC9', 'Left over'], ['short', '#B42318', 'Short']];
    /* each fund: its bar, then a key under it with the same colours, in the same order, with the amounts */
    const bars = rows.map((r) => { const segs = SEG.filter(([key]) => r[key] > 0.5);
      return `<div class="cbar-row"><div class="cbar-head"><span class="cbar-name">${esc(FUND_NAMES[r.k])}</span><span class="small muted">${fmtK(r.avail)} available${r.short > 0.5 ? ` · <span class="gaptext">short ${fmtK(r.short)}</span>` : ''}</span></div>
        <div class="cbar" role="img" aria-label="${esc(FUND_NAMES[r.k])}: ${segs.map(([key, , name]) => `${name} ${fmtK(r[key])}`).join(', ')}">${segs.map(([key, color, name]) => `<span style="width:${(100 * r[key] / hi).toFixed(2)}%;background:${color}" title="${esc(name)} ${fmtK(r[key])}"></span>`).join('')}</div>
        <ul class="cbar-key">${segs.map(([key, color, name]) => `<li class="${key === 'short' ? 'gaptext' : ''}"><i style="background:${color}"></i>${name} <b>${fmtK(r[key])}</b></li>`).join('')}</ul></div>`; }).join('');
    return `<div class="cbars">${bars}</div>
      <p class="small muted">Over FY${cfg.start}–FY${cfg.start + cfg.n - 1}. Available = the starting balance plus every year’s receipts. Committed = payments on existing debt and planned borrowing, ongoing commitments, and yearly costs of programs and hires paid from the fund.</p>`;
  }
  /* ---- peer comparisons from the state's annual reports (part 16): only unusual numbers are shown ---- */
  const PEERS = { key: null, data: null };
  async function loadPeers(d) {
    const de = d && d.state_district_id;
    if (!de) return null;
    if (PEERS.key === de + '|' + d.id) return PEERS.data;
    let data = null;
    try {
      const [yr, nm] = await Promise.all([
        HG.db.select('ia_measure', `select=fiscal_year&de_district=eq.${enc(de)}&status=eq.Actual&measure_key=eq.${enc('exp|ALL|TOTAL')}&order=fiscal_year.desc&limit=1`),
        HG.db.select('ia_district', `select=name&de_district=eq.${enc(de)}`)]);
      if (yr[0]) {
        const rows = await HG.db.rpc('ia_benchmark', { p_de: de, p_fy: yr[0].fiscal_year, p_status: 'Actual', p_peer: 'size', p_district: d.id });
        data = { fy: yr[0].fiscal_year, name: nm[0] ? nm[0].name : null, rows: rows || [], peer_group: rows && rows[0] ? rows[0].peer_group : null };
      }
    } catch (e) { data = null; }   // a database without part 16, or no state data yet: no callouts
    PEERS.key = de + '|' + d.id; PEERS.data = data;
    return data;
  }
  async function peersCard(c, screen) {
    const P = await loadPeers(c.district);
    return P ? HGPeers.cardHtml(HGPeers.pick(P.rows, screen), P) : '';
  }

  async function vResSummary(c) {
    const [b, peers] = await Promise.all([boardRun(c.district), peersCard(c, 'funds')]);
    if (b.none) return peers + notReady(c, b);
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
      <p class="small muted">From <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}, FY${cfg.start}–FY${cfg.start + cfg.n - 1}. <a href="#/d/${enc(c.district.slug)}/money/capital">Open the capital plan</a></p>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">10-year capital need</div><div class="stat">${fmtK(r.need)}</div></div>
        <div class="card tile-card"><div class="small muted">Paid by levies and grants</div><div class="stat">${fmtK(r.levyFunded)}</div></div>
        <div class="card tile-card ${r.gap > 0.5 ? 'gap' : ''}"><div class="small muted">Gap to close</div><div class="stat">${fmtK(r.gap)}</div></div>
        <div class="card tile-card"><div class="small muted">Yearly costs committed</div><div class="stat">${rec ? fmtK(rec) : '$0'}</div><div class="small muted">${recY ? `programs and hires, FY${recY.fy}` : 'programs and hires, per year'}</div></div>
      </div>
      ${peers}
      <div class="card"><h3>Capital fund balances</h3>${fundsChart(paths, funds)}</div>
      <div class="card"><h3>Funding vs. committed</h3>${commitChart(paths, funds, inp.levers, cfg)}</div>
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
      ${(() => { const g = gfRun(b.rows, sc.id); if (!g) return `<div class="card"><h3>General Fund</h3><p class="muted">Not set up yet. ${c.finance ? `<a href="#/d/${enc(c.district.slug)}/money/general">Enter the starting figures</a>.` : ''}</p></div>`;
        const ys = g.R.years, a1 = ys[0], z = ys[ys.length - 1], low = ys.reduce((m, y) => (y.solvency < m.solvency ? y : m), ys[0]);
        return `<div class="card"><h3>General Fund</h3><div class="grid tiles">
          <div class="card tile-card"><div class="small muted">Solvency ratio</div><div class="stat">${pct1(a1.solvency)} → ${pct1(z.solvency)}</div><div class="small muted">lowest ${pct1(low.solvency)} in FY${low.fy}</div></div>
          <div class="card tile-card"><div class="small muted">Unspent balance ratio</div><div class="stat">${pct1(a1.unspentRatio)} → ${pct1(z.unspentRatio)}</div></div>
          <div class="card tile-card"><div class="small muted">Ending fund balance, FY${z.fy}</div><div class="stat">${fmtK(z.balance)}</div></div>
          <div class="card tile-card"><div class="small muted">Staff share of spending</div><div class="stat">${pct1(a1.staffShare)}</div></div></div>
          <p class="small muted" style="margin-top:8px">Five-year forecast, planning estimates. <a href="#/d/${enc(c.district.slug)}/money/general">Open the General Fund</a></p></div>`; })()}
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
    // yearly General Fund costs that started by the first year for work already underway or done are probably in the staff groups or other spending already
    const INI = new Map(rows.initiatives.map((i) => [i.id, i]));
    const already = sc && years.length ? [...new Set((rows.recurring || []).filter((r) => r.scenario_id === sc.id && r.fund === 'general' && Number(r.first_fy) <= years[0]
      && ['underway', 'done'].includes((INI.get(r.initiative_id) || {}).status)).map((r) => (INI.get(r.initiative_id) || {}).name || 'An initiative'))] : [];
    return { gfi: g, sc, set, a: A, base: a, R: HGGF.forecast(g, A, years, extra), extra, already };
  }
  const pct1 = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  function gfChart(R) {
    const ph = narrow(), fs = ph ? 13 : 11, ys = R.years, W = ph ? 400 : 1000, H = ph ? 230 : 240, pad = ph ? 36 : 40, n = ys.length;
    const vals = ys.flatMap((y) => [y.solvency, y.unspentRatio]).filter((v) => v != null);
    const lo = Math.min(0, ...vals), hi = Math.max(0.2, ...vals), X = (i) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2), Y = (v) => H - 24 - ((v - lo) / (hi - lo)) * (H - 40);
    const line = (k, color) => `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${ys.map((y, i) => `${X(i).toFixed(1)},${Y(y[k] || 0).toFixed(1)}`).join(' ')}"/>${ys.map((y, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(y[k] || 0).toFixed(1)}" r="3" fill="${color}"/>`).join('')}`;
    const band = `<rect x="${pad}" width="${W - pad * 2}" y="${Y(0.10).toFixed(1)}" height="${(Y(0.05) - Y(0.10)).toFixed(1)}" fill="#E6F0EA"><title>Solvency ratio target: 5–10%</title></rect>`
      + `<text x="${pad + 8}" y="${(Y(0.05) - 6).toFixed(1)}" font-size="${fs}" fill="#2F6B4F" opacity=".85">Solvency target 5–10%</text>`;
    const grid = [0, 0.05, 0.10, 0.15, 0.20].filter((v) => v >= lo && v <= hi).map((v) => `<line x1="${pad}" x2="${W - pad}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#E4E0D6"/><text x="${pad - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="${fs}" text-anchor="end" fill="#5A6660">${(v * 100).toFixed(0)}%</text>`).join('');
    const zero = lo < 0 ? `<line x1="${pad}" x2="${W - pad}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#B42318"/>` : '';
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Solvency ratio and unspent balance ratio by year">${band}${grid}${zero}${line('solvency', '#1E3A2F')}${line('unspentRatio', '#C9A24A')}
      ${ys.map((y, i) => (ph && n > 5 && i % 2 && i !== n - 1 ? '' : `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="${fs}" text-anchor="middle" fill="#5A6660">FY${y.fy}</text>`)).join('')}</svg></div>
      <p class="small"><span style="color:#1E3A2F">●</span> Solvency ratio &nbsp; <span style="color:#C9A24A">●</span> Unspent balance ratio &nbsp; <span class="muted"><span style="display:inline-block;width:12px;height:9px;background:#E6F0EA;border:1px solid #CFE0D5;vertical-align:-1px"></span> the 5–10% solvency target many districts aim for (solvency line only)</span></p>`;
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
      FL.uabCap && FL.uabCap.length ? `<li>The 35% cap on carrying unspent balance forward (SF 2472) holds some back in FY${FL.uabCap.join(', FY')}: ${f(ys.filter((y) => y.uabLost > 0.5).reduce((t, y) => t + y.uabLost, 0))} doesn’t carry into spending authority. The School Budget Review Committee can approve more.</li>` : '',
      FL.guarantee.length ? `<li>The 101% budget guarantee applies in FY${FL.guarantee.join(', FY')} (enrollment falls faster than funding grows).</li>` : '',
      (run.already || []).length ? `<li>${run.already.map(esc).join(', ')}: ${run.already.length === 1 ? 'its' : 'their'} yearly General Fund cost started by FY${ys[0].fy} and the work is underway or done, so it may already be in the staff groups or other spending. If so, it’s counted twice: end the yearly cost before FY${ys[0].fy}, or take it out of the starting figures.</li>` : '',
    ].filter(Boolean);
    const extraYears = ys.filter((y) => y.extra > 0.5);
    const y2 = ys[1];
    const leadTxt = `Solvency ${last.solvency < first.solvency ? 'slides' : 'rises'} from <b>${pct1(first.solvency)}</b> to <b>${pct1(last.solvency)}</b> over five years`
      + (FL.negativeUnspent.length ? `, and spending passes spending authority in FY${FL.negativeUnspent[0]}.` : FL.deficit.length === ys.length ? ', with spending above revenue every year.' : '.')
      + (y2 && y2.affordableSettlement != null ? ` Next year’s new money covers about a ${(y2.affordableSettlement * 100).toFixed(1)}% total package increase.` : '');
    return `<p class="lead">${leadTxt}</p>
      <div class="grid tiles">
        <div class="card tile-card"><div class="small muted">Solvency ratio ${def('solvency')}</div><div class="stat">${pct1(first.solvency)} → ${pct1(last.solvency)}</div><div class="small muted">FY${first.fy} to FY${last.fy}; lowest ${pct1(ls.solvency)} in FY${ls.fy}</div></div>
        <div class="card tile-card"><div class="small muted">Unspent balance ratio ${def('unspent')}</div><div class="stat">${pct1(first.unspentRatio)} → ${pct1(last.unspentRatio)}</div><div class="small muted">lowest ${pct1(lu.unspentRatio)} in FY${lu.fy}</div></div>
        <div class="card tile-card"><div class="small muted">Ending fund balance, FY${last.fy}</div><div class="stat">${f(last.balance)}</div><div class="small muted">unassigned and assigned</div></div>
        <div class="card tile-card"><div class="small muted">Revenue vs. spending, FY${last.fy}</div><div class="stat">${f(last.net)}</div><div class="small muted">${last.net < 0 ? 'spending more than revenue' : 'revenue covers spending'}</div></div>
      </div>
      ${flags.length ? `<div class="card"><h3>Watch</h3><ul>${flags.join('')}</ul></div>` : ''}
      <div class="card"><h3>Solvency and spending authority</h3>${gfChart(R)}</div>
      <div class="card"><h3>New money vs. a negotiated raise ${def('package')}</h3><p class="small muted">New money is what the formula adds each year (state supplemental aid and enrollment). Each 1% of total package increase costs salaries plus benefits.</p>
        <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">New money</th><th class="num">Each 1% of total package costs</th><th class="num">A ${(run.a.settle * 100).toFixed(1)}% total package costs</th><th class="num">Total package the new money covers</th></tr></thead><tbody>
          ${ys.slice(1).map((y) => `<tr><td>FY${y.fy}</td><td class="num">${f(y.newMoney)}</td><td class="num">${f(y.costPerPoint)}</td><td class="num">${f(y.settlementCost)}</td><td class="num"><b>${y.affordableSettlement == null ? '' : (y.affordableSettlement * 100).toFixed(1) + '%'}</b></td></tr>`).join('')}
        </tbody></table></div></div>
      <details class="fold" ${GF.ctx && (GF.ctx.plan || GF.ctx.finance) ? 'open' : ''}><summary>Year by year</summary><div class="card"><div class="scroll"><table class="data gftable"><thead><tr><th></th>${ys.map((y) => `<th class="num">FY${y.fy}</th>`).join('')}</tr></thead><tbody>
        ${[['Enrollment', (y) => Math.round(y.enrollment).toLocaleString('en-US')], ['District cost per pupil', (y) => '$' + Math.round(y.dcpp).toLocaleString('en-US')],
          ['Regular program', (y) => f(y.regular) + (y.guarantee > 0.5 ? '*' : '')], ['Other state formula funding', (y) => f(y.other)], ['Miscellaneous income', (y) => f(y.misc)], ['<b>Revenue</b>', (y) => `<b>${f(y.revenue)}</b>`],
          ['Staff (salaries, benefits, health)', (y) => f(y.staff)], ['Other spending', (y) => f(y.nonstaff)], ...(extraYears.length ? [['The plan’s yearly costs', (y) => (y.extra ? f(y.extra) : '')]] : []), ['<b>Spending</b>', (y) => `<b>${f(y.spending)}</b>`],
          ['Revenue less spending', (y) => `<span class="${y.net < 0 ? 'gaptext' : ''}">${f(y.net)}</span>`], ['Ending fund balance', (y) => f(y.balance)], ['Solvency ratio', (y) => pct1(y.solvency)],
          ['Unspent balance carried in (35% cap)', (y) => f(y.carried) + (y.uabLost > 0.5 ? ` <span class="small gaptext">−${f(y.uabLost)}</span>` : '')], ['Spending authority', (y) => f(y.authority)], ['Unspent balance', (y) => `<span class="${y.unspent < 0 ? 'gaptext' : ''}">${f(y.unspent)}</span>`], ['Unspent balance ratio', (y) => pct1(y.unspentRatio)], ['Staff share of spending', (y) => pct1(y.staffShare)],
        ].map(([l, fn]) => `<tr><td>${l}</td>${ys.map((y) => `<td class="num">${fn(y)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${FL.guarantee.length ? `<p class="small muted">* includes the 101% budget guarantee.${def('guarantee')}</p>` : ''}
      <p class="small muted" style="margin-top:6px">Planning estimates, not the state’s official calculation. FY2027 uses the enacted 2% state supplemental aid ($8,148 state cost per pupil, SF 2201). Solvency = unassigned and assigned balance ÷ revenue less AEA flowthrough. Spending authority = regular program and other formula funding + miscellaneous income + last year’s unspent balance, up to 35% of the authorized budget two years earlier (SF 2472, from FY2027; years before FY${ys[0].fy} are estimated). Figures checked ${esc(day(HGGF.RULES.checked))}.</p></div></details>`;
  }
  async function vGeneralFund(c) {
    const [rows, peers] = await Promise.all([loadCapitalRows(c.district), peersCard(c, 'general')]);
    if (GF.key !== c.district.id) { GF.key = c.district.id; GF.over = {}; }
    GF.rows = rows; GF.ctx = c;
    const caution = c.plan || c.finance ? '<div class="notice">Planning estimates. Check the starting figures and results with the business manager before sharing them with the board.</div>'
      : '<p class="small muted">A five-year planning estimate from the district’s own figures, not the state’s official calculation.</p>';
    if (!rows.settings) return caution + notReady(c, { rows }) + peers;
    const gfi = rows.settings.gf_inputs;
    if (!gfi) return `${caution}${peers}<div class="card"><h3>Set up the General Fund</h3><p>The forecast needs a few starting figures: enrollment, cost per pupil, other revenue, staff by group, other spending, and the fund balance and unspent balance from the last audit.</p>
      ${c.finance ? '<button type="button" class="btn primary" data-action="gfEdit">Enter starting figures</button>' : '<p class="muted">The business office enters these.</p>'}</div>${gfAuto(c)}`;
    const run = gfRun(rows, GF.sid, GF.over); GF.run = run;
    /* label on one line; the % sits beside the box instead of in the label */
    const lv = (k, label, v, hint) => `<label class="field"><span class="fl">${label}</span><span class="pctbox"><input data-gf-lever="${k}" inputmode="decimal" value="${(v * 100).toFixed(2).replace(/\.?0+$/, '')}" aria-label="${label}, %"><span aria-hidden="true">%</span></span><span class="hint">${hint}</span></label>`;
    return `${caution}
      <div class="row">
        ${rows.scenarios.length ? `<label class="chip"><span class="small muted">Scenario</span><select data-gf-sc aria-label="Scenario">${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${run.sc && x.id === run.sc.id ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>` : ''}
        <span class="small muted">Assumptions: ${run.set ? esc(run.set.name) : 'the General Fund defaults'}${Object.keys(GF.over).length ? ', with what-if changes' : ''}.</span>
        ${c.finance ? '<button type="button" class="btn" data-action="gfEdit">Starting figures</button>' : ''}</div>
      ${fold(c, 'What-if: state aid, enrollment, total package increase, health insurance', `<div class="card"><div class="gflevers">
        ${lv('ssa', 'State aid growth', run.a.ssa, 'after FY2027’s 2%')}${lv('enroll', 'Enrollment change', run.a.enroll, 'a year')}${lv('settle', 'Total package increase', run.a.settle, 'salary increase a year')}
        ${lv('health', 'Health insurance growth', run.a.health, 'a year')}${lv('inflation', 'Other spending growth', run.a.inflation, 'a year')}${lv('turnover', 'Turnover savings', run.gfi.turnover_savings || 0, 'newer staff on lower pay')}
      </div><div class="row"><button type="button" class="btn small" data-action="gfReset">Reset to the scenario’s assumptions</button></div></div>`)}
      <div id="gf-results">${gfResultsHtml(run)}</div>
      ${peers}${gfAuto(c)}`;
  }
  /** arriving from Starting numbers → "Use in the General Fund setup": open the editor with the state's figures filled in */
  function gfAuto(c) {
    if (!GF.autoPrefill) return ''; GF.autoPrefill = false;
    if (c.finance) setTimeout(async () => { await openGfEditor(); if (GF.prefill) { await ACTIONS.gfPrefill(); } }, 0);
    return '';
  }
  function openGfEditor(opts) {
    const wiz = !!(opts && opts.wizard), st = GF.rows.settings, g = st.gf_inputs || { enrollment: st.enrollment || null, dcpp: HGGF.RULES.scpp[2027], misc_growth: 0.01, turnover_savings: 0.01,
      staff: [{ name: 'Teachers', benefits: 0.1709 }, { name: 'Support staff', benefits: 0.1709 }, { name: 'Administrators', benefits: 0.1709 }], assume: Object.assign({}, HGGF.DEFAULTS) };
    const money2 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));
    const pc = (v) => (v == null ? '' : +(Number(v) * 100).toFixed(2));
    const f = (n, l, v, h) => `<label class="field">${l}<input name="${n}" inputmode="decimal" value="${esc(v)}">${h ? `<span class="hint">${h}</span>` : ''}</label>`;
    const staffRow = (x) => `<tr data-gf-staff><td><input name="s_name" value="${esc(x.name || '')}" style="width:140px"></td><td><input name="s_fte" inputmode="decimal" value="${x.fte == null ? '' : x.fte}" style="width:70px"></td>
      <td><input name="s_salary" inputmode="decimal" value="${money2(x.salary)}" style="width:100px"></td><td><input name="s_benefits" inputmode="decimal" value="${pc(x.benefits)}" style="width:70px"></td>
      <td><input name="s_health" inputmode="decimal" value="${money2(x.health)}" style="width:90px"></td><td><button type="button" class="btn small" data-action="gfStaffRemove" aria-label="Remove">×</button></td></tr>`;
    const A = Object.assign({}, HGGF.DEFAULTS, g.assume || {});
    GF.staffRow = staffRow;
    const html = `<form class="stack" data-form="${wiz ? 'wizGf' : 'saveGf'}" novalidate>
      ${wiz ? '' : '<div class="row" style="justify-content:space-between"><h2 id="modal-title">General Fund starting figures</h2><button type="button" class="btn small" data-action="closeModal">Close</button></div>'}
      <p class="small muted">For the first year of the plan. The certified budget, the Certified Annual Report and the Department of Management’s unspent balance report have most of these.</p>
      <div data-gf-hint></div>
      <h3>Revenue</h3><div class="fgrid">
        ${f('enrollment', 'Certified enrollment (budget enrollment)', g.enrollment == null ? '' : g.enrollment, 'Tenths are fine here (e.g. 1188.4): state aid is figured on the certified number')}${f('dcpp', 'District cost per pupil, $', money2(g.dcpp), 'FY2027 state cost per pupil: $8,148')}
        ${f('other_formula', 'Other state formula funding, $', money2(g.other_formula), 'Categorical supplements, special education and similar')}${f('misc_income', 'Miscellaneous income, $', money2(g.misc_income), 'Local, federal and other income')}
        ${f('misc_growth', 'Miscellaneous income growth, % a year', pc(g.misc_growth))}${f('aea_flowthrough', 'AEA flowthrough, $', money2(g.aea_flowthrough), 'Left out of revenue for the solvency ratio')}</div>
      <h3>Spending</h3><p class="small muted">One row per group that settles or is paid differently: teachers, support staff (paras, custodial, food service, transportation, office), administrators. Split a group out when its raise or insurance differs (paraeducators, say). Health insurance is the district’s share per FTE. Count health in one place only: the benefits % is FICA (7.65%), IPERS (9.44%) and other benefits <i>besides</i> health; if you leave health blank, the benefits % can include it instead.${def('benefits')}</p><div class="scroll"><table class="data"><thead><tr><th>Staff group</th><th>FTE</th><th>Average salary, $</th><th>Benefits besides health, % of salary</th><th>Health insurance per FTE, $</th><th></th></tr></thead>
        <tbody data-gf-staff-body>${(g.staff || []).map(staffRow).join('')}</tbody></table></div>
      <template data-gf-staff-template>${staffRow({ benefits: 0.1709 })}</template>
      <div class="row"><button type="button" class="btn small" data-action="gfStaffAdd">Add a staff group</button>
        <label class="btn small">Fill from a staff list<input type="file" data-gf-roster accept=".xlsx,.csv" hidden></label><a href="#" class="small" data-action="gfRosterTemplate">template, with instructions</a>
        <label class="row small"><input type="checkbox" name="fte_follow_enrollment" ${g.fte_follow_enrollment ? 'checked' : ''}> Staff numbers follow enrollment</label></div>
      <div data-gf-roster-note></div>
      <div class="fgrid">${f('nonstaff', 'Other spending, $ a year', money2(g.nonstaff), 'Supplies, services, utilities, transportation and the rest')}${f('turnover_savings', 'Turnover savings, % a year', pc(g.turnover_savings), 'Experienced staff replaced by newer staff on lower pay')}</div>
      <h3>Balances</h3><div class="fgrid">${f('fund_balance', 'Unassigned and assigned fund balance, $', money2(g.fund_balance), 'At the start of the plan')}${f('unspent', 'Unspent balance (spending authority), $', money2(g.unspent), 'From the Department of Management’s report')}</div>
      <h3>Default assumptions</h3><p class="small muted">Used when a scenario’s assumption set leaves them blank.</p><div class="fgrid">
        ${f('a_ssa', 'State aid growth', pc(A.ssa))}${f('a_enroll', 'Enrollment change', pc(A.enroll))}${f('a_settle', 'Total package increase', pc(A.settle))}${f('a_health', 'Health insurance growth', pc(A.health), 'Your carrier’s renewal is the best guide; school renewals have run 7–10% lately')}${f('a_inflation', 'Other spending growth', pc(A.inflation))}</div>
      <div class="notice error" data-form-errors hidden></div>
      <div class="row">${wiz ? '<button type="submit" class="btn primary">Save and finish</button><button type="button" class="btn" data-action="wizSkip">Skip for now</button>' : '<button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-action="closeModal">Cancel</button>'}</div></form>`;
    if (wiz) return html;
    modal(html);
    return gfHint();
  }
  /** the state's latest year-end figures for this district (part 16), or null */
  async function statePrefill(d) {
    if (!d || !d.state_district_id) return null;
    const [p, lv, more] = await Promise.all([HG.db.rpc('ia_prefill', { p_de: d.state_district_id }).catch(() => null), HG.db.rpc('ia_levy', { p_de: d.state_district_id }).catch(() => null),
      HG.db.rpc('ia_prefill_more', { p_de: d.state_district_id }).catch(() => null)]);   // part 19; missing until it's installed
    const hasMore = more && Object.keys(more).some((k) => k !== 'de_district');
    const out = p && p.fiscal_year ? p : (lv && lv.fiscal_year) || hasMore ? {} : null;
    if (out && lv && lv.fiscal_year) out.levy = lv;
    if (out && hasMore) out.more = more;
    return out;
  }
  /** the annual report has one PPEL fund for regular and voted PPEL together: split its revenue by the two rates */
  function ppelSplit(st) {
    const R2 = (st && st.receipts) || {}, lv = st && st.levy, total = R2.ppel == null ? null : Number(R2.ppel);
    const reg = lv ? Number(lv.regular_ppel || 0) : null, vot = lv ? Number(lv.voted_ppel || 0) : 0;
    if (total == null || !lv || !(vot > 0) || !(reg + vot > 0)) return { regular: total, voted: null };
    return { regular: total * reg / (reg + vot), voted: total * vot / (reg + vot) };
  }
  const schoolYear = (fy) => `${fy - 1}-${String(fy).slice(2)}`;
  /** grants and gifts to the capital funds: the average of the last n years of the annual reports (years with none count as $0) */
  function grantsAvg(M, n) {
    const car = M && M.car; if (!car || !car.fiscal_year) return null;
    const by = new Map((car.grants || []).map((g) => [Number(g.fy), Number(g.amount) || 0]));
    const ys = []; for (let y = car.fiscal_year; y > car.fiscal_year - n && y >= 2017; y--) ys.push(y);
    return ys.length ? { avg: ys.reduce((t, y) => t + (by.get(y) || 0), 0) / ys.length, years: ys.length, from: ys[ys.length - 1], to: ys[0] } : null;
  }
  /** SAVE receipts trend: yearly change from the oldest to the newest of the last few annual reports, kept between −10% and +10% */
  function saveTrend(M) {
    const h = ((M && M.car && M.car.save_receipts) || []).filter((x) => Number(x.amount) > 0).sort((a, b) => a.fy - b.fy);
    if (h.length < 3) return null;
    const a = h[0], b = h[h.length - 1], g = Math.pow(Number(b.amount) / Number(a.amount), 1 / (b.fy - a.fy)) - 1;
    return { pct: Math.max(-0.1, Math.min(0.1, g)), from: a.fy, to: b.fy };
  }
  /**
   * The state's figures as Starting numbers form values: { values: {field: form text}, debts: [{fund, name, annual}], list: [[label, shown]] }.
   * Regular and voted PPEL share one fund in the annual report: receipts and the balance are split by the two levy rates.
   */
  function stateFill(st, grantYears) {
    const o = {}, debts = [], list = [], M = st.more || {}, B2 = st.balances || {}, R2 = st.receipts || {}, le = st.latest_enrollment || {}, lv = st.levy, sp = ppelSplit(st);
    const voted = lv && Number(lv.voted_ppel) > 0, share = voted && Number(lv.regular_ppel) + Number(lv.voted_ppel) > 0 ? Number(lv.voted_ppel) / (Number(lv.regular_ppel) + Number(lv.voted_ppel)) : 0;
    const mi = (v) => moneyIn(Math.round(Number(v)));
    if (le.certified != null) { o.enrollment = Math.round(Number(le.certified)); if (le.fiscal_year) o.enrollment_year = schoolYear(le.fiscal_year); }
    if (B2.save != null || B2.ppel != null) {
      o.as_of = `${st.fiscal_year}-06-30`;
      if (B2.save != null) o.bal_save = mi(B2.save);
      if (B2.ppel != null) { o.bal_ppel = mi(Number(B2.ppel) * (1 - share)); if (share) o.bal_vppel = mi(Number(B2.ppel) * share); }
    }
    if (R2.save != null) { o.save_receipts = mi(R2.save); o.save_receipts_fy = st.fiscal_year; }
    if (sp.regular != null) o.ppel_receipts = mi(sp.regular);
    if (lv) o.ppel_rate = Number(lv.regular_ppel).toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
    if (voted) {
      o.vppel_status = 'active';
      if (sp.voted != null) o.vppel_annual = mi(sp.voted);
      if (M.vppel && M.vppel.first_fy && !M.vppel.from_start_of_data) { o.vppel_first_fy = M.vppel.first_fy; o.vppel_last_fy = M.vppel.first_fy + 9; }
    }
    const tr = saveTrend(M);
    if (tr) { o.save_trend = pctIn(tr.pct); list.push([`SAVE receipts trend, FY${tr.from}–FY${tr.to}`, `${pctIn(tr.pct)}% a year`]); }
    const V = M.valuation;
    if (V) {
      if (V.taxable) { o.taxable_valuation = mi(V.taxable); list.push([`Taxable valuation, FY${V.fiscal_year} (with TIF and utilities)`, '$' + mi(V.taxable)]); }
      if (V.actual) { o.actual_valuation = mi(V.actual); list.push([`Actual (100%) valuation, FY${V.fiscal_year}`, '$' + mi(V.actual)]); }
      if (V.growth != null) { o.ppel_growth = pctIn(V.growth); list.push([`Taxable valuation growth, FY${V.fiscal_year - V.growth_years}–FY${V.fiscal_year}`, `${pctIn(V.growth)}% a year`]); }
    }
    const HV = M.home_value, CI = M.construction_inflation;
    if (HV && Number(HV.median_value) > 0) { o.tax_home_value = mi(Math.round(Number(HV.median_value) / 1000) * 1000);
      list.push([`Example home: the district’s median home value (Census Bureau, ${HV.acs_year - 4}–${HV.acs_year})`, '$' + o.tax_home_value]); }
    if (CI && CI.value != null) { const v = Math.max(0, Math.min(0.15, Number(CI.value))); o.construction_inflation = pctIn(v);
      list.push(['Construction inflation (school construction prices, last three years)', `${pctIn(v)}% a year`]); }
    const on = (M.car && M.car.ongoing) || {};
    ['save', 'ppel'].forEach((k) => { const x = on[k]; if (x && x.recurring != null) { o[k + '_ongoing'] = mi(Math.max(0, x.recurring));
      list.push([`Ongoing ${k === 'save' ? 'SAVE' : 'PPEL'} spending (average FY${x.from_fy}–FY${x.to_fy}, leaving out construction and debt)`, '$' + mi(Math.max(0, x.recurring)) + ' a year']); } });
    const ga = grantsAvg(M, grantYears || 5);
    if (ga) { o.grants_avg = mi(ga.avg); list.push([`Gifts and grants to the capital funds (average FY${ga.from}–FY${ga.to})`, '$' + mi(ga.avg) + ' a year']); }
    const dp = (M.car && M.car.debt_payments) || {}, DN = { save: ['save', 'SAVE revenue bonds'], ppel: ['ppel', 'PPEL leases or bonds'], debt: ['debt_levy', 'General-obligation bonds'] };
    Object.entries(dp).forEach(([k, amt]) => { if (DN[k] && Number(amt) > 0) { debts.push({ fund: DN[k][0], name: DN[k][1], annual: Math.round(Number(amt)) });
      list.push([`${DN[k][1]}: paid in FY${M.car.fiscal_year}`, '$' + mi(amt)]); } });
    if (o.vppel_first_fy) list.push(['V-PPEL in place since', `FY${o.vppel_first_fy} (last year assumed FY${o.vppel_last_fy}, the 10 years a vote allows: check the ballot)`]);
    return { values: o, debts, list };
  }
  /** the state's figures for the General Fund setup form (budget-year formula figures first, then the latest annual report) */
  function gfStateFill(st) {
    const g = st.general || {}, le = st.latest_enrollment || {}, M = st.more || {}, al = M.aid_levy, un = M.unspent, cg = (M.car && M.car.general) || {};
    const bal = g.unassigned != null || g.assigned != null ? Number(g.unassigned || 0) + Number(g.assigned || 0) : null;
    return { al, un, carFY: M.car && M.car.fiscal_year,
      enrollment: al && al.budget_enrollment != null ? Number(al.budget_enrollment) : le.certified,
      dcpp: al && al.dcpp != null ? Number(al.dcpp) : null,
      other_formula: al && al.other_formula != null ? Math.max(0, Number(al.other_formula)) : null,
      misc_income: un && un.misc_income != null ? Number(un.misc_income) : null,
      misc_growth: un && un.misc_growth != null ? Math.max(-0.05, Math.min(0.1, Number(un.misc_growth))) : null,
      unspent: un && un.unspent != null ? Number(un.unspent) : null,
      fund_balance: bal, aea_flowthrough: g.aea_flowthrough,
      nonstaff: cg.nonstaff != null ? Number(cg.nonstaff) : null,   /* includes AEA flowthrough, as revenue does */
      benefits: cg.benefits_pct != null ? Number(cg.benefits_pct) : null,
      salaries: cg.salaries ? { total: Number(cg.salaries), instruction: Number(cg.sal_instruction || 0), admin: Number(cg.sal_admin || 0), support: Number(cg.sal_support || 0) } : null };
  }
  async function gfHint() {
    // help: what the latest ledger or adopted budget says, so the business manager can split it into these fields
    const d = S.district, box = document.querySelector('[data-gf-hint]'); if (!box) return;
    GF.prefill = null;
    const st = await statePrefill(d), gfi0 = GF.rows && GF.rows.settings && GF.rows.settings.gf_inputs;
    if (st && document.querySelector('[data-gf-hint]') === box) {
      GF.prefill = gfStateFill(st);
      const P = GF.prefill, fm = HGReport.fmt;
      const items = [P.enrollment != null ? `${P.al ? `budget enrollment ${Number(P.enrollment).toLocaleString('en-US')} for FY${esc(P.al.fiscal_year)}` : `certified enrollment ${Number(P.enrollment).toLocaleString('en-US')}`}` : '',
        P.dcpp != null ? `district cost per pupil $${Number(P.dcpp).toLocaleString('en-US')}` : '',
        P.other_formula != null ? `other formula funding ${fm(P.other_formula)}` : '',
        P.misc_income != null ? `miscellaneous income ${fm(P.misc_income)}${P.misc_growth != null ? ` (growing ${pctIn(P.misc_growth)}% a year)` : ''}` : '',
        P.unspent != null ? `unspent balance ${fm(P.unspent)} (FY${esc(P.un.fiscal_year)})` : '',
        P.fund_balance != null ? `unassigned and assigned balance ${fm(P.fund_balance)} at June 30, ${esc(st.fiscal_year)}` : '',
        P.aea_flowthrough != null ? `AEA flowthrough ${fm(P.aea_flowthrough)}` : '',
        P.nonstaff != null ? `other spending ${fm(P.nonstaff)} (FY${esc(P.carFY)})` : '',
        P.benefits != null ? `benefits ${pctIn(P.benefits)}% of salaries (including health insurance)` : ''].filter(Boolean);
      const mine = gfi0 ? HGGF.staffCost(gfi0.staff) : null;
      const sal = P.salaries ? `<br><span class="muted">FY${esc(P.carFY)} General Fund salaries: instruction ${fm(P.salaries.instruction)}, administration ${fm(P.salaries.admin)}, everything else ${fm(P.salaries.support)}. Your staff groups’ FTE × average salary should add up to about ${fm(P.salaries.total)}${P.benefits != null ? `, and salaries plus benefits and health to about ${fm(P.salaries.total * (1 + P.benefits))}` : ''}${mine && mine.total ? ` (saved now: salaries ${fm(mine.salaries)}, all in ${fm(mine.total)})` : ''}.</span>` : '';
      if (items.length) box.insertAdjacentHTML('afterbegin', `<div class="notice ok small" data-gf-state>From the state’s data ${def('sources')}: ${items.join('; ')}.
        <button type="button" class="btn small" data-action="gfPrefill" style="margin-left:6px">Fill these in</button>${sal}<br><span class="muted">Nothing is saved until you click Save. Use the plan’s first-year figures if you have newer ones.</span></div>`);
    }
    try {
      const [acc, bl] = await Promise.all([HG.db.selectAll('gl_account', `select=id,fund_code,object_code,account_type&district_id=eq.${d.id}`), HG.db.selectAll('budget_line', `select=account_id,fiscal_year,amount&district_id=eq.${d.id}&version=eq.adopted`).catch(() => [])]);
      const A = new Map(acc.map((x) => [x.id, x])), fy = GF.rows.settings.plan_start_fy;
      let lines = bl.filter((x) => x.fiscal_year === fy).map((x) => Object.assign({}, A.get(x.account_id) || {}, { budget: x.amount })), from = `the adopted FY${fy} budget`;
      if (!lines.length) {
        const bt = await HG.db.select('import_batch', `select=id,period_end&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc&limit=1`);
        if (bt[0]) { const am = await HG.db.selectAll('gl_amount', `select=account_id,budget_amount&batch_id=eq.${bt[0].id}`); lines = am.map((x) => Object.assign({}, A.get(x.account_id) || {}, { budget: x.budget_amount })); from = `the budget column of the ${day(bt[0].period_end)} ledger`; }
      }
      const b = HGGF.fromBudget(lines);
      const mine = gfi0 ? HGGF.staffCost(gfi0.staff) : null, gap = mine && mine.total && b.staff ? (mine.total - b.staff) / b.staff : null;
      if (b.revenue || b.total) box.insertAdjacentHTML('beforeend', `<div class="notice ${gap != null && Math.abs(gap) > 0.05 ? 'warn' : 'ok'} small">From ${esc(from)}: General Fund revenue ${HGReport.fmt(b.revenue)}; staff spending (objects 1xx–2xx: salaries, and benefits including health) ${HGReport.fmt(b.staff)}; other spending ${HGReport.fmt(b.nonstaff)}. Use these to check your figures add up.${gap != null ? ` Your staff groups come to ${HGReport.fmt(mine.total)}, ${Math.abs(gap) <= 0.05 ? 'within 5% of the budget' : `${(Math.abs(gap) * 100).toFixed(0)}% ${gap > 0 ? 'above' : 'below'} the budget: check for health counted twice, or a group left out`}.` : ''}</div>`);
    } catch (e) { /* no ledger or budget yet */ }
  }
  /** a payroll staff list → the staff groups table (replaces its rows; nothing saved until Save) */
  async function gfRoster(input) {
    const file = input.files[0], form = input.closest('form'), note = form.querySelector('[data-gf-roster-note]'); if (!file) return;
    const R = HGGF.roster(await HGUploads.readTable(file)); input.value = '';
    if (!R.groups.length) { note.innerHTML = `<div class="notice error small">${esc(R.issues[0] || 'No staff found in that file.')}</div>`; return; }
    const keepBen = (form.querySelector('[name=s_benefits]') || {}).value, ben = keepBen ? Number(keepBen) / 100 : 0.1709;
    // a group with health per FTE takes a benefits % without health (FICA and IPERS) when the form's % looks all-in
    form.querySelector('[data-gf-staff-body]').innerHTML = R.groups.map((x) => GF.staffRow({ name: x.name, fte: x.fte, salary: x.salary, health: x.health, benefits: x.health && ben > 0.24 ? 0.1709 : ben })).join('');
    note.innerHTML = `<div class="notice ok small">Read ${R.people} ${R.people === 1 ? 'person' : 'people'} in ${R.groups.length} group${R.groups.length === 1 ? '' : 's'}: ${R.groups.map((x) => `${esc(x.name)} ${x.fte} FTE`).join(', ')}. Averages are per FTE. Check them, then Save.
      ${R.issues.length ? `<br><span class="muted">${R.issues.slice(0, 5).map(esc).join(' ')}${R.issues.length > 5 ? ` and ${R.issues.length - 5} more.` : ''}</span>` : ''}</div>`;
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
    if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return false; }
    await HG.db.update('district_settings', `district_id=eq.${S.district.id}`, { gf_inputs: g });
    const twice = HGGF.healthTwice(staff);
    if (twice.length) toast('Health insurance may be counted twice', `${twice.join(', ')}: the benefits % is over 24% and health insurance per FTE is filled in too. A benefits % that high usually already includes health. Use about 17.09% (FICA and IPERS) with health per FTE, or leave health blank.`, 'error');
    if (form.dataset.form === 'wizGf') return true;
    closeModal(); toast('Saved', 'General Fund starting figures.'); here(); return true;
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
      <div class="row">${c.finance ? `<a class="btn" href="#/d/${enc(c.district.slug)}/settings/setup">Enter balances</a><a class="btn" href="#/d/${enc(c.district.slug)}/settings/uploads">Upload balances</a>` : ''}</div>
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
        { label: 'Start', num: true, get: (y) => fmtK(y.start) },
        { label: 'Receipts', num: true, get: (y) => fmtK(y.receipts) },
        { label: 'Spending', num: true, get: (y) => fmtK(y.spend) },
        { label: 'Short by', num: true, html: (y) => (y.over > 0.5 ? `<b class="gaptext">${fmtK(y.over)}</b>` : '') },
        { label: 'End', num: true, html: (y) => (y.fy === P.lowFY ? `<b>${fmtK(y.end)}</b> <span class="small muted">low</span>` : fmtK(y.end)) },
      ], P.years, '')}
      <p class="small muted">Receipts are after existing debt payments and ongoing commitments${k === 'save' && inp.levers.sf ? ', and after the SF 2472 reduction' : ''}${cfg.f0 < 1 ? `; FY${cfg.start} counts only the part of the year after ${day(cfg.settings.balances.asOf)}` : ''}.</p></div>`; };
    return top + history + `
      <p class="small muted">Year by year from <b>${esc(sc.name)}</b>${sc.is_board_version ? ', the board version' : ''}. <a href="#/d/${enc(c.district.slug)}/money/capital">Change it on the capital plan</a></p>
      ${funds.map(fundCard).join('')}
      <div class="card"><h3>Borrowing room</h3>
        <p>SAVE revenue bonds: about <b>${fmtK(cap.pv)}</b>, based on the lowest year (FY${cap.fy}), 1.20 coverage, 20 years at 4.5%.</p>
        <p>${go != null ? `General-obligation bonds: about <b>${fmtK(go)}</b> left under the debt limit (5% of actual valuation, less GO debt outstanding). A GO bond also needs 60% of voters.` : 'General-obligation limit: add the district’s actual (100%) valuation in Starting numbers to see it.'}</p></div>
      <p class="small muted">Fund rules are a plain-language guide, not legal advice. Confirm a specific use with the district’s attorney or the Iowa Department of Education.</p>`;
  }
  // ---------------------------------------------------------------- capital plan (live engine)
  const CAP = { key: null, rows: null, scenarioId: null, inputs: null, levers: null, pub: false };
  /* ---- one scenario across the screens that show one (Initiatives, Ranking, Capital plan, General fund): choosing it
     on any of them, or in the picker at the top, changes it on all four; a new district starts on its board version ---- */
  const SCN = { dist: null, id: null };
  const scnGet = () => (S.district && SCN.dist === S.district.id ? SCN.id : null);
  const scnSet = (v) => { SCN.dist = S.district ? S.district.id : null; SCN.id = v || null; };
  [[CAP, 'scenarioId'], [RK, 'sid'], [INI, 'sid'], [GF, 'sid']].forEach(([o, k]) => { delete o[k]; Object.defineProperty(o, k, { get: scnGet, set: scnSet, enumerable: true, configurable: true }); });
  const SCN_SCREENS = ['plan/initiatives', 'plan/ranking', 'money/capital', 'money/general'];
  async function fillScenarioTop(c, section, tab) {
    const box = document.getElementById('scenTop'); if (!box || !c.district) return;
    const path = `${section.id}/${tab.id}`, rows = { 'plan/initiatives': INI.rows, 'plan/ranking': RK.rows, 'money/capital': CAP.rows, 'money/general': GF.rows }[path];
    let list = rows && rows.district && rows.district.id === c.district.id ? rows.scenarios : null;
    if (!list) list = await HG.db.select('scenario', `select=id,name,is_board_version&district_id=eq.${c.district.id}&order=name`).catch(() => []);
    if (document.getElementById('scenTop') !== box || !list || !list.length) return;
    const board = list.find((x) => x.is_board_version);
    if (!(SCN_SCREENS.includes(path) && (c.plan || c.finance) && !lockedRole(S.role))) {
      box.innerHTML = board ? `<span class="ctl ro" title="This screen always shows the board version">Board version <b>${esc(board.name)}</b></span>` : ''; return;
    }
    const curId = list.some((x) => x.id === scnGet()) ? scnGet() : (board || list[0]).id;
    box.innerHTML = `<label class="ctl" title="The scenario shown on Initiatives, Ranking, the capital plan and the General Fund">Scenario <select data-top-scenario aria-label="Scenario">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === curId ? 'selected' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}</option>`).join('')}</select></label>`;
  }
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
  const capIn = () => (CAP.out && CAP.out.size ? CAP.inputs.projects.filter((p) => !CAP.out.has(String(p.id))) : CAP.inputs.projects);
  function capCompute() { return HGEngine.compute(capIn(), CAP.levers, CAP.inputs.cfg); }
  /* what-if: leave projects out and see the plan without them; nothing is saved unless it becomes a new scenario */
  function capOutHtml() {
    const cfg = CAP.inputs.cfg, L = CAP.levers, out = CAP.out || new Set();
    const list = CAP.inputs.projects.map((p) => ({ p, total: p.phases.reduce((a, ph) => a + (ph.status === 'done' && ph.actual != null ? ph.actual : ph.cost * Math.pow(1 + L.infl, ph.year)), 0),
      years: [...new Set(p.phases.map((ph) => cfg.start + ph.year))].sort() })).sort((a, b) => b.total - a.total);
    if (!list.length) return '';
    const base = HGEngine.compute(CAP.inputs.projects, L, cfg), now = capCompute(), saved = list.filter((x) => out.has(String(x.p.id))).reduce((a, x) => a + x.total, 0);
    return `<h3>Leave projects out</h3>
      <p class="small muted">Tick a project to see the plan without its one-time costs (yearly costs of programs and hires stay). Nothing is saved${CAP.pub ? '' : ' unless you save it as a new scenario'}.</p>
      ${out.size ? `<p class="lead" style="font-size:15px">Leaving out ${out.size} project${out.size === 1 ? '' : 's'} (${fmtK(saved)}): the gap goes from <b>${fmtK(base.gap)}</b> to <b>${fmtK(now.gap)}</b>.</p>` : ''}
      <div class="outlist">${list.map((x) => `<label class="outrow small"><input type="checkbox" data-cap-out="${esc(x.p.id)}" ${out.has(String(x.p.id)) ? 'checked' : ''}><span>${esc(x.p.name)}<span class="muted outyrs">${esc(fyRanges(x.years))}</span></span><b>${fmtK(x.total)}</b></label>`).join('')}</div>
      ${out.size ? `<div class="row" style="margin-top:10px"><button type="button" class="btn small" data-action="capOutClear">Put them all back</button>${!CAP.pub && CAP.ctx && CAP.ctx.plan ? '<button type="button" class="btn small primary" data-action="capOutSave">Save as a new scenario</button>' : ''}</div>` : ''}`;
  }

  async function vCapital(c) {
    const [rows, peers] = await Promise.all([loadCapitalRows(c.district), peersCard(c, 'capital')]);
    CAP.rows = rows; CAP.pub = false; CAP.ctx = c;
    if (!rows.settings) {
      return `<div class="card"><h3>Starting numbers aren’t set up yet</h3>
        <p>The capital plan needs this district’s SAVE and PPEL receipts, fund balances and existing debt before it can run.</p>
        <div class="row">${c.finance ? `<a class="btn primary" href="#/d/${enc(c.district.slug)}/settings/setup">Set up starting numbers</a>` : '<span class="small muted">A business manager or admin can set these up.</span>'}</div>
        ${S.isStaff && c.district.is_demo ? '<p class="small muted" style="margin-top:10px">This is a demo district: you can fill it with fictional data from the Willow Holler page.</p>' : ''}</div>`;
    }
    if (!rows.scenarios.length && !c.plan) return '<div class="card"><h3>No capital plan yet</h3><p>The district’s projects haven’t been entered yet. The plan shows here once they are.</p></div>';
    if (!rows.scenarios.length) {
      return `<div class="card"><h3>No scenarios yet</h3><p>Upload the district’s project spreadsheet to create its first scenario.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/settings/uploads">Upload projects</a></div>`;
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
        ${rows.scenarios.length > 1 ? `<a class="btn" href="#/d/${enc(c.district.slug)}/plan/scenarios">Compare scenarios</a>` : ''}
      </div>
      ${CAP.sc.is_locked && (c.plan || c.finance) ? `<div class="notice">This scenario is locked, so it can’t be changed${c.admin ? '. Unlock it to edit.' : '. A district admin can unlock it.'} Copy it to try changes.</div>` : ''}
      ${CAP.inputs.notes.length ? `<ul class="fineprint">${CAP.inputs.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="lead" id="cap-lead">${capLeadHtml()}</p>
      <div id="cap-results">${capResultsHtml()}</div>
      ${fold(c, 'What-if and financing', `<div class="cap-grid">
        <div class="card" id="cap-levers">${capLeversHtml()}</div>
        <div class="card" id="cap-fin">${capFinHtml()}</div>
      </div>
      <div class="card" id="cap-out">${capOutHtml()}</div>`)}
      ${fold(c, 'What it means for taxpayers', `<div class="card" id="cap-tax">${capTaxHtml()}</div>`)}
      ${fold(c, 'Projects by year', `<div id="cap-filters">${capFiltersHtml()}</div>
      <div id="cap-years">${capYearsHtml()}</div>
      ${CAP.editable ? '<div class="row"><button type="button" class="btn primary" data-action="editProject" data-id="">Add an initiative</button></div>' : ''}
      <div id="cap-yearly">${capYearlyHtml()}</div>`)}
      ${peers}
      ${(() => { if (CAP.openEditor && CAP.editable) { const id = CAP.openEditor; setTimeout(() => openProjectEditor(id), 0); } CAP.openEditor = null; return ''; })()}
`;
  }
  function capLoadScenario() {
    CAP.sc = CAP.rows.scenarios.find((x) => x.id === CAP.scenarioId);
    CAP.editable = !CAP.pub && !!CAP.ctx && CAP.ctx.plan && !CAP.sc.is_locked;
    CAP.inputs = HGCapital.buildInputs(CAP.rows, CAP.scenarioId);
    CAP.levers = JSON.parse(JSON.stringify(CAP.inputs.levers));
    CAP.out = new Set();
  }
  function capResultsHtml() {
    const cfg = CAP.inputs.cfg, r = capCompute(), yrs = HGCapital.yearSummary(r, cfg);
    const busiest = yrs.reduce((a, y) => (y.total > a.total ? y : a), yrs[0]);
    const enr = cfg.settings.district.enrollment;
    const tiles = [
      ['10-year need', fmtK(r.need), `FY${cfg.start}–FY${cfg.start + cfg.n - 1}`],
      ['Levies & grants', fmtK(r.levyFunded), 'SAVE, PPEL, V-PPEL, grants'],
      (r.financed > 0.5 || r.spentByBucket.boost > 0.5) ? ['Borrowing & gifts', fmtK(r.financed + r.spentByBucket.boost), [r.financed > 0.5 ? `${fmtK(r.financed)} financed` : '', r.spentByBucket.boost > 0.5 ? `${fmtK(r.spentByBucket.boost)} boosters` : ''].filter(Boolean).join(', ')] : null,
      ['Gap to close', fmtK(r.gap), r.gap > 0.5 ? [r.unfunded > 0.5 ? `campaign or bond projects not yet financed${r.overflow > 0.5 ? ` (${fmtK(r.unfunded)})` : ''}` : '', r.overflow > 0.5 ? `${fmtK(r.overflow)} over what the funds can pay` : ''].filter(Boolean).join('; ') : 'Fully paid for in this scenario'],
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
    const moved = CAP.pub && CAP.inputs && JSON.stringify(CAP.levers) !== JSON.stringify(CAP.inputs.levers);
    return `${moved ? '<div class="notice warn whatif-tag"><b>What-if:</b> these figures include your changes to the levers. They are not the published plan. <a href="#" data-action="capReset">Reset</a></div>' : ''}<div class="grid tiles">${tiles.map((t) => `<div class="card tile-card ${t[0] === 'Gap to close' && r.gap > 0.5 ? 'gap' : ''}"><div class="small muted">${esc(t[0])}</div><div class="stat">${esc(t[1])}</div><div class="small muted">${esc(t[2])}</div></div>`).join('')}</div>
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
        out.push({ p, ph, k, tier, area: p.area || init.focus_area || '', fy: cfg.start + ph.year, today: ph.cost, cost, left: !!(CAP.out && CAP.out.has(String(p.id))) });
      });
    });
    return out;
  }
  const capFiltering = () => { const f = CAP.filter || {}; return !!(f.tier || f.fund || f.area || f.q); };
  function capMatch(x) {
    const f = CAP.filter || {};
    if (f.tier && x.tier !== f.tier) return false;
    if (f.fund && !(x.ph.options ? ((CAP.pick && CAP.pick.get(x.ph)) || x.ph.options[0]) === f.fund : x.ph.funding.some((g) => g.b === f.fund))) return false;
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
  /* a phase's funds: a fixed split ("SAVE 60%  PPEL 40%"), or choices in order with the one this plan uses first ("PPEL · or SAVE") */
  function fundChips(ph, pick) {
    if (ph.options && ph.options.length > 1) {
      const use = pick || ph.options[0], rest = ph.options.filter((b) => b !== use);
      const why = `${ph.options.map((b) => FUND_LABEL[b]).join(', then ')}: whichever has room. ${pick ? (pick === ph.options[0] ? `This plan uses ${FUND_LABEL[pick]}, the first choice.` : `This plan uses ${FUND_LABEL[pick]}: ${ph.options.slice(0, ph.options.indexOf(pick)).map((b) => FUND_LABEL[b]).join(' and ')} had no room that year.`) : ''}`;
      return `<span class="chips" title="${esc(why)}"><span class="fchip f-${use}">${FUND_LABEL[use]}${pick && pick !== ph.options[0] ? ' ↺' : ''}</span>${rest.map((b) => `<span class="fchip alt">or ${FUND_LABEL[b]}</span>`).join('')}</span>`;
    }
    return `<span class="chips">${ph.funding.map((f) => `<span class="fchip f-${f.b}">${FUND_LABEL[f.b]}${f.p !== 100 ? ' ' + f.p + '%' : ''}</span>`).join('')}</span>`;
  }
  const fundText = (ph, pick) => (ph.options && ph.options.length > 1
    ? `${FUND_LABEL[pick || ph.options[0]]} (choices: ${ph.options.map((b) => FUND_LABEL[b]).join(', then ')})`
    : ph.funding.map((f) => FUND_LABEL[f.b] + (f.p !== 100 ? ' ' + f.p + '%' : '')).join(' + '));
  function capYearsHtml() {
    const cfg = CAP.inputs.cfg, r = capCompute(); CAP.pick = r.pick;
    const yrs = HGCapital.yearSummary(r, cfg), all = capItems(), shown = all.filter(capMatch);
    const note = capFiltering() ? `<p class="small">Showing ${shown.length} of ${all.length} phases (${fmtK(shown.reduce((a, x) => a + x.cost, 0))}). <a href="#" data-action="capClearFilters">Clear filters</a>${(CAP.view || 'cards') === 'cards' ? ' <span class="muted">Year totals still include everything.</span>' : ''}</p>` : '';
    const chips = (ph) => fundChips(ph, r.pick.get(ph));
    const nameLink = (p) => (CAP.editable ? `<a href="#" data-action="editProject" data-id="${esc(p.id)}">${esc(p.name)}</a>` : esc(p.name));
    if ((CAP.view || 'cards') === 'table') {
      const list = shown.slice().sort((a, b) => a.fy - b.fy || a.p.name.localeCompare(b.p.name));
      const TN = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have', '': '' };
      return `${CAP.pub ? '<h2 style="margin-top:6px">Projects by year</h2>' : ''}${note}
        <div class="card"><div class="scroll"><table class="data captable"><thead><tr><th>Year</th><th>Initiative</th><th>Phase</th><th>Priority</th><th>Focus area</th><th>Paid from</th><th>Status</th><th class="num">Today’s $</th><th class="num">That year’s $</th></tr></thead><tbody>
          ${list.map((x) => `<tr><td>FY${x.fy}</td><td>${nameLink(x.p)}</td><td>${esc(x.ph.label || (x.p.phases.length > 1 ? `${x.k + 1} of ${x.p.phases.length}` : ''))}</td><td>${TN[x.tier] || ''}</td><td>${esc(x.area)}</td><td>${chips(x.ph)}</td>
            <td>${x.ph.status === 'done' ? '<b class="ok">Done</b>' : x.ph.status === 'underway' ? 'Underway' : 'Planned'}</td><td class="num">${fmtK(x.today)}</td><td class="num">${fmtK(x.cost)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nothing matches these filters.</td></tr>'}
          </tbody>${list.length ? `<tfoot><tr><th colspan="7">${list.length} phase${list.length === 1 ? '' : 's'}</th><th class="num">${fmtK(list.reduce((a, x) => a + x.today, 0))}</th><th class="num">${fmtK(list.reduce((a, x) => a + x.cost, 0))}</th></tr></tfoot>` : ''}</table></div>
          <div style="margin-top:10px"><button type="button" class="btn small" data-action="capDownload">Download this table (Excel)</button></div></div>`;
    }
    const cards = yrs.map((y, i) => {
      const items = shown.filter((x) => x.ph.year === i).map((x) => `<li class="${x.left ? 'leftout' : ''}" ${x.left ? 'title="Left out in this what-if"' : ''}><span>${nameLink(x.p)}${x.ph.label ? ` <span class="muted">· ${esc(x.ph.label)}</span>` : x.p.phases.length > 1 ? ` <span class="muted">${x.k + 1}/${x.p.phases.length}</span>` : ''}
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
    return `${CAP.pub ? '<h2 style="margin-top:6px">Projects by year</h2>' : ''}${note}<div class="ygrid">${cards}</div>`;
  }
  function capDownload() {
    const TN = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have', '': '' };
    const list = capItems().filter(capMatch).sort((a, b) => a.fy - b.fy || a.p.name.localeCompare(b.p.name));
    const out = [['FY', 'Initiative', 'Phase', 'Priority', 'Focus area', 'Paid from', 'Status', 'Cost (today’s $)', 'Cost (that year’s $)']];
    const pk = capCompute().pick;
    list.forEach((x) => out.push([x.fy, x.p.name, x.ph.label || '', TN[x.tier] || '', x.area, fundText(x.ph, pk.get(x.ph)),
      x.ph.status || 'planned', Math.round(x.today), Math.round(x.cost)]));
    const name = ((CAP.sc && CAP.sc.name) || 'plan').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    saveXlsx(`${(S.district && S.district.slug) || 'district'}-${name}-projects.xlsx`, out, 'Projects');
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
    const head = CAP.pub ? '<h3>What it means for taxpayers</h3>' : '';   // on the plan screen the fold already says it
    if (!imp.taxed.length) return head + `<p>This scenario adds <b>no property tax</b>: it has no general-obligation bond, and no new V-PPEL.</p>
      <p class="small muted">SAVE revenue bonds, leases paid from PPEL, and campaigns or gifts don’t add a levy.</p>`;
    const first = imp.taxed[0].fy, last = imp.taxed[imp.taxed.length - 1].fy;
    const sources = [imp.hasGO ? 'the debt service levy for a general-obligation bond' : '', imp.newVppel ? 'a new V-PPEL' : ''].filter(Boolean).join(' and ');
    if (!imp.hasValuation) return head + `<p>Adds about <b>${fmtK(imp.taxed[0].added)} a year</b> in property tax from FY${first} (${sources}).</p>
      <p class="small muted">Enter the district’s taxable valuation in Settings, Starting numbers to see the levy rate and what it costs a homeowner and a farmer.</p>`;
    const pk = imp.peak, farmCol = 'Farmland, per $100,000 assessed';
    return head + `<p>Adds ${sources}, FY${first}–FY${last}. At its highest (FY${pk.fy}), about <b>${dollars(pk.home)} a year</b> (${dollars(pk.home / 12)} a month) for a ${homeTxt}, and <b>${dollars(pk.farm100k)}</b> per $100,000 of assessed farmland.</p>
      <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">Added levy</th><th class="num">Rate per $1,000</th><th class="num">${esc(homeTxt)}</th><th class="num">Same home, owner 65+</th><th class="num">${farmCol}</th></tr></thead><tbody>
        ${imp.taxed.map((x) => `<tr><td>FY${x.fy}${x.held ? ' <span class="small muted">*</span>' : ''}</td><td class="num">${fmtK(x.added)}</td><td class="num">$${x.rate.toFixed(4)}</td><td class="num">${dollars(x.home)}</td><td class="num">${dollars(x.home65)}</td><td class="num">${dollars(x.farm100k)}</td></tr>`).join('')}
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
        { label: 'Grows with', get: (r) => ({ none: 'Stays flat', inflation: 'Inflation', settlement: 'Negotiated raises' })[r.grows] },
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
    const co = document.getElementById('cap-out'); if (co) co.innerHTML = capOutHtml();
    LEVERS.forEach((l) => { const el = document.querySelector(`[data-lever-val="${l.k}"]`); if (el) el.textContent = l.show(CAP.levers[l.k]); });
  }
  const SET_FIELDS = [
    ['construction_inflation', 'Construction inflation', 'How fast project costs rise each year'],
    ['save_trend', 'SAVE receipts trend', 'Negative if SAVE is expected to fall (enrollment, sales tax)'],
    ['ppel_growth', 'PPEL valuation growth', 'Growth in taxable valuation, which drives PPEL and tax rates'],
    ['grant_yield', 'Grant yield to capital', 'Share of grants and gifts that goes to capital projects'],
    ['settlement_pct', 'Negotiated raises (total package)', 'How fast yearly staff costs grow'],
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
    const intro = `<p class="small muted">Assumptions describe the world the plan has to survive: inflation, revenue growth, negotiated raises. Scenarios are the district’s choices. Each scenario on the capital plan uses one set; a lever saved on a scenario still wins over its set.</p>`;
    if (!sets.length) return `<div class="card"><h3>No assumption sets yet</h3>${intro}
      ${rows.settings ? (c.plan ? '<div class="row"><button type="button" class="btn primary" data-action="starterSets">Create Base, Conservative and Growth</button><button type="button" class="btn" data-action="editSet" data-id="">Add a set</button></div><p class="small muted" style="margin-top:8px">Base starts from the district’s starting numbers; Conservative and Growth are tougher and easier versions of it. Edit any of them.</p>' : '')
        : `<p>Set up the starting numbers first.</p><a class="btn primary" href="#/d/${enc(c.district.slug)}/settings/setup">Starting numbers</a>`}</div>`;
    return `${intro}
      <div class="row">${c.plan ? '<button type="button" class="btn primary" data-action="editSet" data-id="">Add a set</button>' : ''}<a class="btn" href="#/d/${enc(c.district.slug)}/money/capital">Choose a set for a scenario on the capital plan</a></div>
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
    if (!board && !c.admin) return '<div class="card"><h3>No board version yet</h3><p>Progress is tracked against the plan the board adopted. A district admin marks that scenario as the board version.</p></div>';
    if (!board) return `<div class="card"><h3>No board version yet</h3><p>Progress is tracked against the plan the board adopted. On the capital plan, make one scenario the board version.</p>
      <a class="btn primary" href="#/d/${enc(d.slug)}/money/capital">Capital plan</a></div>`;
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
      setLead(items.length ? `FY${fy} only${through ? `, ledger through ${esc(day(through))}` : ''}: <b>${fmtK(tot.spent)}</b> spent and ${fmtK(tot.encd)} encumbered (open purchase orders), against ${fmtK(tot.pl)} the board version plans for FY${fy}${flagged ? `; <b>${flagged}</b> initiative${flagged === 1 ? ' needs' : 's need'} a look` : ''}.` : `Nothing is planned or spent in FY${fy}.`); }
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
        <span class="small muted">${through ? `Spending from the monthly ledger through ${esc(day(through))}.` : `No month-end general ledger (GL) export for FY${fy} yet ${def('gl')}.${c.finance ? ` <a href="#/d/${enc(d.slug)}/settings/uploads">Upload it</a>.` : ''}`} Against <b>${esc(board.name)}</b>, the board version.</span>
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
    const link = `<a href="#/d/${enc(c.district.slug)}/settings/uploads">Upload the month-end general ledger export</a>`;
    if (!st.has) return `<div class="notice">Bring in the business office’s month-end general ledger (GL) export each month to keep balances, spending and budget current. ${link}.</div>`;
    if (!st.stale) return '';
    return `<div class="notice">The ledger is through ${esc(day(gl[0].period_end))}. The close for ${esc(day(st.nextMonthEnd))} is usually ready by now. ${link} to keep balances current.</div>`;
  }
  const BA = { key: null, fy: null, method: 'budget', fund: null };
  async function vActuals(c) {
    const d = c.district;
    const batches = await HG.db.select('import_batch', `select=id,kind,status,period_end,fiscal_year&district_id=eq.${d.id}&kind=eq.gl_monthly&status=eq.applied&order=period_end.desc`).catch(() => []);
    const latest = HGActuals.latestByYear(batches), fys = Object.keys(latest).map(Number).sort((x, y) => y - x);
    if (!fys.length) return `<div class="card"><h3>No monthly ledger yet</h3><p>Budget against actual comes from the business office’s month-end general ledger (GL) export: its budget, year-to-date and encumbered columns.</p>
      ${c.finance ? `<a class="btn primary" href="#/d/${enc(d.slug)}/settings/uploads">Upload a month-end general ledger export</a>` : '<p class="muted">It appears once the business office uploads one.</p>'}</div>`;
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
  function modal(inner, opts) {
    closeModal();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" data-modal><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${inner}</div></div>`);
    // the title row (title + Close) becomes a header that stays put; the rest scrolls under it on small screens
    const m = document.querySelector('[data-modal] .modal'), body = m && m.firstElementChild, head = body && body.firstElementChild;
    if (head && head.classList.contains('row') && head.querySelector('h2')) {
      const h = document.createElement('div'); h.className = 'modal-head'; m.insertBefore(h, body); h.appendChild(head); body.classList.add('modal-body');
    }
    stripHidden(document.querySelector('[data-modal]')); fitTables(document.querySelector('[data-modal]'));
    document.documentElement.classList.add('modal-open');
    /* start at the top; a form puts the cursor in its first field without scrolling past what's above it */
    const back = document.querySelector('[data-modal]'); back.scrollTop = 0; if (m) m.scrollTop = 0;
    const first = !(opts && opts.noFocus) && document.querySelector('[data-modal] input, [data-modal] select'); if (first) first.focus({ preventScroll: true });
  }
  function closeModal() { document.querySelectorAll('[data-modal]').forEach((m) => m.remove()); document.documentElement.classList.remove('modal-open'); }
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
      <td><select name="y_grows" aria-label="Grows with">${opt([['none', 'Stays flat'], ['inflation', 'Inflation'], ['settlement', 'Negotiated raises (total package)']], r.grows || 'none')}</select></td>
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
    const either = Array.isArray(ph.options) && ph.options.length > 1;
    const funds = (either ? ph.options.map((b) => ({ b, p: null })) : ph.funding && ph.funding.length ? ph.funding : [{ b: 'save', p: 100 }]).slice(0, 3);
    return `<tr data-phase-row>
      <td><input name="label" maxlength="80" value="${esc(ph.label || '')}" placeholder="Name (optional)" aria-label="Phase name"></td>
      <td><select name="fy" aria-label="Fiscal year">${yr(ph.fy || cfg.start)}</select></td>
      <td><input name="cost" inputmode="decimal" value="${ph.cost == null ? '' : Number(ph.cost).toLocaleString('en-US')}" aria-label="Cost in today’s dollars"></td>
      <td><div data-srcs class="${funds.length > 1 ? 'multi' : ''}${either ? ' either' : ''}">${funds.map(fundRowHtml).join('')}</div>
        <select name="fmode" class="fmode" aria-label="How the funds are used" ${funds.length > 1 ? '' : 'hidden'}><option value="split">Split the cost</option><option value="either" ${either ? 'selected' : ''}>Whichever has room, in this order</option></select>
        <button type="button" class="btn small" data-action="addFund" ${funds.length >= 3 ? 'hidden' : ''}>Add a fund</button></td>
      <td><select name="status" aria-label="Status">${[['planned', 'Planned'], ['underway', 'Underway'], ['done', 'Done']].map(([k, v]) => `<option value="${k}" ${(ph.status || 'planned') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input name="actual" inputmode="decimal" value="${ph.actual == null ? '' : Number(ph.actual).toLocaleString('en-US')}" aria-label="Actual cost" placeholder="Actual cost if done"></td>
      <td><button type="button" class="btn small danger" data-action="removePhaseRow" aria-label="Remove this phase">×</button></td></tr>`;
  }
  function rebalanceFunds(cell) {
    const rows = [...cell.querySelectorAll('[data-src]')], split = evenSplit(rows.length);
    rows.forEach((r, i) => { r.querySelector('[name=pct]').value = split[i]; });
    cell.classList.toggle('multi', rows.length > 1);
    const fm = cell.parentElement.querySelector('[name=fmode]'); if (fm) { fm.hidden = rows.length < 2; if (rows.length < 2) { fm.value = 'split'; cell.classList.remove('either'); } }
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
    /* a new initiative can have its costs and phases straight away, approved or not: they go into the scenario on screen when it can
       be changed, otherwise the first one that can, otherwise a working copy of the board version made when it's saved */
    else sid = usable(chosen) ? chosen.id : (rows.scenarios.find(usable) || {}).id || (rows.scenarios.length ? '__new' : null);
    ED.copyFrom = (rows.scenarios.find((x) => x.is_board_version) || chosen || rows.scenarios[0] || {}).id || null;
    ED.sid = ED.cfg ? sid : null;
    renderEditor(pid);
  }
  function costSectionHtml(pid) {
    const rows = ED.rows, cfg = ED.cfg, sid = ED.sid;
    if (!sid || !cfg) return '';
    const fundBy = {}; rows.funding.forEach((f) => { (fundBy[f.phase_id] = fundBy[f.phase_id] || []).push({ b: f.fund, p: Number(f.pct) }); });
    const here_ = pid && inScen(rows, sid, pid);
    const phases = here_ ? rows.phases.filter((x) => x.scenario_id === sid && x.initiative_id === pid).sort((a, b) => a.fy - b.fy || a.seq - b.seq)
      .map((x) => ({ label: x.label || '', fy: x.fy, cost: Number(x.cost), status: x.status, actual: x.actual_cost == null ? null : Number(x.actual_cost), funding: fundBy[x.id] || [], options: Array.isArray(x.fund_options) && x.fund_options.length > 1 ? x.fund_options : null }))
      : [{ fy: cfg.start, cost: null, funding: [{ b: 'save', p: 100 }] }];
    const yearly = here_ ? (rows.recurring || []).filter((r) => r.scenario_id === sid && r.initiative_id === pid)
      .map((r) => ({ kind: r.kind, fund: r.fund, amount: Number(r.annual_amount), first: r.first_fy, last: r.last_fy, grows: r.grows_with })) : [];
    return `<h3>One-time costs (phases)</h3>
      <p class="small muted">Costs in today’s dollars; the plan adds inflation. A phase starts with one fund; add up to three and the split is shared evenly, then adjust it. A program with only yearly costs can have no phases.</p>
      <div class="scroll"><table class="data phases"><thead><tr><th>Phase name</th><th>Year</th><th>Cost, $</th><th>Paid from ${def('fund_choice')}</th><th>Status</th><th></th></tr></thead>
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
        <label class="field">Needed by, fiscal year<input name="need_by" inputmode="numeric" placeholder="2031" value="${i.need_by_fy == null ? '' : i.need_by_fy}"><span class="hint">The latest year it can wait until. Suggestions never move it later.</span></label>
        ${dec ? `
        <label class="field">Owner<input name="owner_name" maxlength="80" value="${esc(i.owner_name || '')}" placeholder="Name or role"></label>
        <label class="field">Strategic priority<select name="priority_id"><option value="">None</option>${(rows.priorities || []).map((p) => `<option value="${esc(p.id)}" ${i.priority_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          ${(rows.priorities || []).length ? '' : '<span class="hint">Add strategic priorities on Plan → Priorities.</span>'}</label>
        <label class="field">Board approved it on<input name="approved_on" type="date" value="${esc(i.approved_on || '')}"></label>` : ''}
      </div>
      ${dec ? `<label class="field">Description<textarea name="description" maxlength="2000">${esc(i.description || '')}</textarea></label>
      <div class="costs-box"><h3>Costs</h3>
        ${ED.cfg ? `<label class="field">Apply to scenario<select data-ed-scenario aria-label="Apply to scenario">
            <option value="" ${!sid ? 'selected' : ''}>Details only: not in a plan yet</option>
            ${rows.scenarios.map((x) => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''} ${x.is_locked ? 'disabled' : ''}>${esc(x.name)}${x.is_board_version ? ' (board version)' : ''}${x.is_locked ? ' (locked)' : ''}${pid && inScen(rows, x.id, pid) ? ' · already in it' : ''}</option>`).join('')}
            ${!pid && ED.copyFrom && rows.scenarios.some((x) => x.is_locked) ? `<option value="__new" ${sid === '__new' ? 'selected' : ''}>A new working copy of “${esc((rows.scenarios.find((x) => x.id === ED.copyFrom) || {}).name || 'the board version')}” (made when you save)</option>` : ''}</select>
            <span class="hint">Costs and phases can go in now, before the board approves it. They’re added to the scenario chosen here; the board version stays as adopted (locked scenarios can’t be changed, so a working copy is made instead).</span></label>`
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
    const needBy = toNum(v('need_by')); if (needBy !== null && (isNaN(needBy) || !Number.isInteger(needBy) || needBy < 2000 || needBy > 2100)) errs.push('Needed by must be a fiscal year, like 2031.');
    /* a phase row left empty (no cost, no name) is ignored, so an initiative can be saved before its cost is known */
    const phases = [...form.querySelectorAll('[data-phase-body] [data-phase-row]')].filter((tr) => { const v = (n) => { const el = tr.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; }; return v('cost') || v('label'); }).map((tr, k) => {
      const g = (n) => tr.querySelector(`[name="${n}"]`).value;
      const cost = toNum(g('cost')); if (cost === null || isNaN(cost) || cost < 0) errs.push(`Phase ${k + 1}: enter the cost in dollars.`);
      let funding = [...tr.querySelectorAll('[data-src]')].map((r) => ({ b: r.querySelector('[name=src]').value, p: toNum(r.querySelector('[name=pct]').value) }));
      if (!funding.length) errs.push(`Phase ${k + 1}: choose at least one fund.`);
      if (new Set(funding.map((f) => f.b)).size !== funding.length) errs.push(`Phase ${k + 1}: the same fund appears twice.`);
      /* "whichever has room": the funds are choices in order, not a split; the first is stored as the plan's default */
      const fm = tr.querySelector('[name=fmode]'), options = fm && fm.value === 'either' && funding.length > 1 ? funding.map((f) => f.b) : null;
      if (options) funding = [{ b: options[0], p: 100 }];
      if (funding.length === 1 && funding[0].p === null) funding[0].p = 100;
      if (funding.some((f) => f.p === null || isNaN(f.p) || f.p <= 0)) errs.push(`Phase ${k + 1}: give each fund a percentage.`);
      else if (Math.abs(funding.reduce((a, f) => a + f.p, 0) - 100) > 0.01) errs.push(`Phase ${k + 1}: the percentages add to ${funding.reduce((a, f) => a + f.p, 0)}%, not 100%.`);
      const status = g('status'), actual = toNum(g('actual'));
      if (actual !== null && (isNaN(actual) || actual < 0)) errs.push(`Phase ${k + 1}: actual cost must be a number of dollars.`);
      return { label: g('label').trim().slice(0, 80) || null, fy: Number(g('fy')), cost, funding, options, status, actual: status === 'done' && actual !== null && !isNaN(actual) ? actual : null };
    });
    const yearly = [...form.querySelectorAll('[data-yearly-body] [data-yearly-row]')].map((tr, k) => {
      const g = (n) => tr.querySelector(`[name="${n}"]`).value;
      const amount = toNum(g('y_amount')); if (amount === null || isNaN(amount) || amount <= 0) errs.push(`Yearly cost ${k + 1}: enter the amount per year in dollars.`);
      const first = Number(g('y_first')), last = g('y_last') === '' ? null : Number(g('y_last'));
      if (last != null && last < first) errs.push(`Yearly cost ${k + 1}: it ends before it starts.`);
      return { kind: g('y_kind'), fund: g('y_fund'), amount, first, last, grows: g('y_grows') };
    });
    if (ED.sid && form.dataset.id && inScen(ED.rows, ED.sid, form.dataset.id) && !phases.length && !yearly.length) errs.push('Add a one-time phase, a yearly cost, or both, or choose “Details only”.');
    if (phases.length > HGUploads.MAX_PH) errs.push(`An initiative can have at most ${HGUploads.MAX_PH} phases.`);
    const extra = {};
    if (form.querySelector('[name=owner_name]')) Object.assign(extra, { owner_name: v('owner_name').trim() || null,
      priority_id: v('priority_id') || null, approved_on: v('approved_on') || null, description: v('description').trim() || null });
    return { errs, name, type: v('type') || 'capital', status: v('status') || 'proposed', tier: v('tier') || null, area: v('area').trim() || null, conf: v('conf'), cond: v('cond') || null, life, needBy, phases, yearly, extra };
  }
  async function saveProject(form) {
    const box = form.querySelector('[data-form-errors]'), r = readProject(form);
    if (r.errs.length) { box.hidden = false; box.innerHTML = r.errs.map(esc).join('<br>'); return; }
    const rows = ED.rows, d = S.district.id; let sid = ED.sid, sc = rows.scenarios.find((x) => x.id === sid), iid = form.dataset.id || null, rankFrom = sid;
    const fields = Object.assign({ name: r.name.slice(0, 120), type: r.type, status: r.status, tier: r.tier, engine_priority: ({ must: 'High', strategic: 'Med', nice: 'Low' })[r.tier] || null, focus_area: r.area, cost_confidence: r.conf, condition: r.cond, remaining_life: r.life },
      // needed-by is part 18; sent only when the database has it (or someone typed one), so an older database still saves
      r.needBy != null || rows.initiatives.some((x) => 'need_by_fy' in x) ? { need_by_fy: r.needBy } : {}, r.extra);
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
    if (sid && !form.dataset.id && !r.phases.length && !r.yearly.length) sid = null;   // no costs yet: details only, in no scenario
    if (sid === '__new') {   // the board version is locked: costs go into a working copy of it, made now
      const src = rows.scenarios.find((x) => x.id === ED.copyFrom), name = `${src ? src.name : 'Board version'} (working copy)`.slice(0, 80);
      const res = await HG.db.rpc('copy_scenario', { p_source: ED.copyFrom, p_name: name }), nid = typeof res === 'string' ? res : res && res.copy_scenario;
      if (!nid) throw new UserError('The working copy couldn’t be made. Try again, or copy the scenario on the capital plan first.');
      sid = nid; rankFrom = ED.copyFrom; sc = { id: nid, name }; CAP.scenarioId = nid;
    }
    if (sid) {
      if (!inScen(rows, sid, iid)) {
        const rank = new Set(rows.phases.filter((ph) => ph.scenario_id === rankFrom).map((ph) => ph.initiative_id)).size + 1;
        await HG.db.upsert('scenario_initiative', [{ scenario_id: sid, initiative_id: iid, district_id: d, rank, included: true }], 'scenario_id,initiative_id');
      }
      // save the new version first; remove the old rows only once that has worked, so a failure loses nothing
      const oldPhases = rows.phases.filter((x) => x.scenario_id === sid && x.initiative_id === iid).map((x) => x.id);
      const oldYearly = (rows.recurring || []).filter((x) => x.scenario_id === sid && x.initiative_id === iid).map((x) => x.id);
      const phases = [], funding = [];
      r.phases.forEach((ph, k) => {
        const pid = crypto.randomUUID();
        phases.push({ id: pid, district_id: d, scenario_id: sid, initiative_id: iid, seq: k + 1, label: ph.label, fy: ph.fy, cost: ph.cost, status: ph.status, actual_cost: ph.actual, ...(ph.options ? { fund_options: ph.options } : {}) });
        ph.funding.forEach((f) => funding.push({ phase_id: pid, district_id: d, fund: f.b, pct: f.p }));
      });
      if (phases.length) { await HG.db.insert('phase', HGCapital.evenKeys(phases)); await HG.db.insert('phase_funding', funding); }
      if (r.yearly.length) await HG.db.insert('recurring_cost', r.yearly.map((y) => ({ district_id: d, scenario_id: sid, initiative_id: iid, kind: y.kind, fund: y.fund,
        first_fy: y.first, last_fy: y.last, annual_amount: y.amount, grows_with: y.grows })));
      if (oldPhases.length) await HG.db.removeAll('phase', `id=in.(${oldPhases.map(enc).join(',')})`);
      if (oldYearly.length) await HG.db.removeAll('recurring_cost', `id=in.(${oldYearly.map(enc).join(',')})`);
    }
    closeModal(); toast('Saved', sid ? `${r.name} in “${sc.name}”.${ED.sid === '__new' ? ' The board version is unchanged.' : ''}` : r.name); here();
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
    const kinds = [c.finance && ['gl_monthly', 'Monthly GL export'], c.finance && ['check_register', 'Check register (bills paid)'], c.plan && ['projects', 'Projects'], c.finance && ['budget', 'Adopted budget (by account)'], c.finance && ['balances', 'Fund balances only (if you can’t export the ledger)']].filter(Boolean);
    const later = [
      c.plan && `<a class="btn" href="#/d/${enc(c.district.slug)}/plan/priorities">Goals (on Plan → Priorities)</a>`, (c.plan || c.finance) && `<a class="btn" href="#/d/${enc(c.district.slug)}/track/measures">Measure results (on Track → Measures)</a>`,
      c.plan && `<a class="btn" href="#/d/${enc(c.district.slug)}/plan/community">Survey results (on Plan → Community input)</a>`,
    ].filter(Boolean);
    return `
      ${ledgerNote(c, rows)}
      ${kinds.length ? `<div class="card"><h3>Upload a file</h3>
        <div class="inline-form">
          <label class="field">What’s in it<select data-upload-kind>${kinds.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field">File (.csv or .xlsx)<input type="file" data-upload-file accept=".csv,.xlsx,.txt"></label>
        </div>
        <p class="small muted" style="margin-top:10px">Nothing changes until you review what HighGround read and click Apply. The original file is kept.
          Templates (each has a “How to fill this in” sheet): <a href="#" data-action="downloadTemplate" data-kind="projects">projects</a>, <a href="#" data-action="downloadTemplate" data-kind="balances">fund balances</a>${c.finance ? ', <a href="#" data-action="downloadTemplate" data-kind="gl">a sample month-end GL export</a> (fictional)' : ''}.</p>
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
    } else if (UP.kind === 'check_register') { UP.regCols = null; regParse(); }
    else UP.parsed = HGUploads.parseBalances(UP.rows);
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
  /* ---- check register: one upload per month of payments ---- */
  function regParse() {
    UP.reg = HGRegister.parse(UP.rows, UP.regCols || undefined);
    UP.parsed = { issues: UP.reg.issues.map((i) => ({ l: i.l, m: i.m })) };
  }
  function regReviewHtml() {
    const P = UP.reg, errs = UP.parsed.issues.filter((i) => i.l === 'e'), warns = UP.parsed.issues.filter((i) => i.l !== 'e');
    const opt = (f) => `<option value="">Not in this file</option>${P.header.map((h, i) => `<option value="${i}" ${P.cols[f] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}`;
    const mon = (pe) => new Date(pe + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `<div class="card"><h3>Review: ${esc(UP.file.name)}</h3>
      ${errs.length ? `<div class="notice error">${errs.map((e) => esc(e.m)).join('<br>')}</div>` : ''}
      ${warns.length ? `<div class="notice warn">${warns.map((e) => esc(e.m)).join('<br>')}</div>` : ''}
      ${P.months.length ? `<p>${P.lines.length} payment${P.lines.length === 1 ? '' : 's'}${P.skipped ? ` (${P.skipped} total or blank row${P.skipped === 1 ? '' : 's'} left out)` : ''}, in ${P.months.length} month${P.months.length === 1 ? '' : 's'}. Each month is saved as its own upload and replaces an earlier upload of the same month.</p>
        ${table([{ label: 'Month', get: (m) => mon(m.period_end) }, { label: 'Payments', num: true, get: (m) => m.lines.length }, { label: 'Total', num: true, get: (m) => money(m.total) }], P.months, '')}` : ''}
      <details ${errs.length ? 'open' : ''}><summary>Columns</summary>
        <div class="fgrid" style="margin-top:8px">${HGRegister.FIELDS.map((f) => `<label class="field">${esc(HGRegister.LABEL[f])}<select data-reg-col="${f}">${opt(f)}</select></label>`).join('')}</div></details>
      ${P.lines.length ? `<details><summary>The first payments, as read</summary>${table([{ label: 'Date', get: (l) => day(l.pay_date + 'T12:00:00') }, { label: 'Vendor', get: (l) => l.vendor_name }, { label: 'Invoice', get: (l) => l.invoice_no || '' },
        { label: 'Fund', get: (l) => l.fund || '' }, { label: 'Function', get: (l) => l.func || '' }, { label: 'Object', get: (l) => l.obj || '' }, { label: 'Amount', num: true, get: (l) => money(l.amount) }], P.lines.slice(0, 8), '')}</details>` : ''}
      <p class="small muted">After applying, HighGround compares each month with the months before it and lists questions for the business office on Track → Check register.</p>
      <div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-action="applyUpload" ${errs.length ? 'disabled' : ''}>Apply</button>
        <button type="button" class="btn" data-action="cancelUpload">Cancel</button></div></div>`;
  }
  async function applyRegister() {
    const d = S.district, P = UP.reg, months = P.months;
    const existing = await HG.db.select('import_batch', `select=period_end&district_id=eq.${d.id}&kind=eq.check_register&status=eq.applied`).catch(() => []);
    const lastNew = months[months.length - 1].period_end, rerunAll = existing.some((b) => b.period_end > lastNew);
    const safe = UP.file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80) || 'register.csv', folder = crypto.randomUUID();
    const path = `${d.id}/imports/${folder}/${safe}`;
    await HG.storage.upload('district-files', path, UP.file);
    const ids = [];
    for (const m of months) {
      const batchId = crypto.randomUUID();
      await HG.db.insert('import_batch', { id: batchId, district_id: d.id, kind: 'check_register', file_name: UP.file.name, storage_path: path, status: 'review',
        row_count: m.lines.length, period_end: m.period_end, fiscal_year: HGEngine.fyOfDate(m.period_end) });
      try {
        const rows = HGRegister.toRows(m.lines, batchId, d.id);
        for (let i = 0; i < rows.length; i += 500) await HG.db.insert('register_line', rows.slice(i, i + 500));
        await HG.db.rpc('apply_import', { p_batch: batchId });
      } catch (err) {
        try { await HG.db.update('import_batch', `id=eq.${batchId}`, { status: 'discarded', notes: String(err.message || err).slice(0, 500) }); } catch (e) { /* keep the original error */ }
        throw err;
      }
      ids.push(batchId);
    }
    let open = 0;
    if (rerunAll) { const r = await HG.db.rpc('register_check_all', { p_district: d.id }); open = (r || []).filter((x) => ids.includes(x.batch_id)).reduce((a, x) => a + (x.open_flags || 0), 0); }
    else for (const id of ids) { const r = await HG.db.rpc('register_check', { p_batch: id }); open += (r && r.open_flags) || 0; }
    REG.batch = ids[ids.length - 1];
    toast('Check register applied', `${P.lines.length} payments in ${months.length} month${months.length === 1 ? '' : 's'}. ${open ? `${open} question${open === 1 ? '' : 's'} to look at.` : 'Nothing stood out.'}`);
    go(`#/d/${enc(d.slug)}/track/registers`);
  }
  function reviewHtml() {
    if (UP.kind === 'gl_monthly' || UP.kind === 'budget') return glReviewHtml();
    if (UP.kind === 'check_register') return regReviewHtml();
    const P = UP.parsed, errs = P.issues.filter((i) => i.l === 'e'), warns = P.issues.filter((i) => i.l === 'w');
    const issues = `${errs.length ? `<div class="notice error"><b>${errs.length} problem${errs.length === 1 ? '' : 's'} to fix before this can be applied:</b><br>${errs.map((i) => esc(i.m)).join('<br>')}</div>` : ''}
      ${warns.length ? `<div class="notice warn"><b>${warns.length === 1 ? '1 thing HighGround assumed. Check it:' : warns.length + ' things HighGround assumed. Check them:'}</b><br>${warns.map((i) => esc(i.m)).join('<br>')}</div>` : ''}`;
    if (UP.kind === 'projects') {
      const fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
      const list = P.projects.map((p) => ({ p, total: p.phases.reduce((a, ph) => a + ph.cost, 0) }));
      const grand = list.reduce((a, x) => a + x.total, 0);
      const firstScenario = UP.scenarioCount === 0;
      const canBoard = S.role === 'admin' || staffNow();
      return `<div class="card"><h3>Review: ${esc(UP.file.name)}</h3>
        <p>${P.projects.length} project${P.projects.length === 1 ? '' : 's'}, ${list.reduce((a, x) => a + x.p.phases.length, 0)} phases, ${fmt(grand)} in today’s dollars, FY${UP.startFY}–FY${UP.startFY + (UP.years || 10) - 1}.</p>
        ${issues}
        ${table([
          { label: 'Project', get: (x) => x.p.name },
          { label: 'Phases', html: (x) => x.p.phases.map((ph) => `FY${UP.startFY + ph.year}: ${fmt(ph.cost)} <span class="muted">(${ph.options ? ph.options.map((b) => HGEngine.BUCKET_NAMES[b]).join(' or ') + ', whichever has room' : ph.funding.map((f) => `${HGEngine.BUCKET_NAMES[f.b]}${f.p !== 100 ? ' ' + f.p + '%' : ''}`).join(', ')})</span>`).join('<br>') },
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
    if (UP.kind === 'check_register') return applyRegister();
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
            cost: ph.cost, status: ph.status || 'planned', actual_cost: ph.actual == null ? null : ph.actual, label: ph.label || null, ...(ph.options && ph.options.length > 1 ? { fund_options: ph.options } : {}) });
          ph.funding.forEach((f) => funding.push({ phase_id: pid, district_id: d.id, fund: f.b, pct: f.p }));
        }));
        await HG.db.insert('phase', HGCapital.evenKeys(phases));
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
    if (kind === 'projects') { CAP.key = d.id; CAP.scenarioId = createdScenario; go(`#/d/${enc(d.slug)}/money/capital`); }
    else here();
  }
  /* ---- Progress → Check register: the questions each month's bills raise ---- */
  const REG = { key: null, batch: null };
  const SEV_ORDER = { concern: 0, question: 1, info: 2 };
  async function vRegisters(c) {
    const d = c.district;
    if (REG.key !== d.id) { REG.key = d.id; REG.batch = null; }
    const batches = await HG.db.select('import_batch', `select=id,period_end,row_count,file_name,applied_at&district_id=eq.${d.id}&kind=eq.check_register&status=eq.applied&order=period_end.desc`);
    if (!batches.length) {
      setLead('No check registers yet.');
      return `<div class="card"><h3>No check registers yet</h3><p>Each month’s check register (the list of bills paid that goes to the board) can be uploaded here. HighGround compares it with earlier months and lists anything worth a question: a first payment to a vendor, a vendor whose name changed, a possible duplicate, a payment much larger than usual.</p>
        ${c.finance ? `<p>Upload a month, or a whole year at once (it is split by month), on <a href="#/d/${enc(d.slug)}/settings/uploads">Uploads</a>: choose “Check register”.</p>` : '<p class="muted">The business office uploads these.</p>'}</div>`;
    }
    if (!batches.some((b) => b.id === REG.batch)) REG.batch = batches[0].id;
    const cur = batches.find((b) => b.id === REG.batch);
    const [flags, sum, allOpen, rules, notes] = await Promise.all([
      HG.db.select('register_flag', `select=id,rule,severity,question,detail,status,response,resolved_at,vendor_key&batch_id=eq.${cur.id}&order=id`),
      HG.db.rpc('register_summary', { p_batch: cur.id }).catch(() => null),
      HG.db.select('register_flag', `select=batch_id&district_id=eq.${d.id}&status=eq.open&severity=in.(question,concern)&batch_id=in.(${batches.map((b) => b.id).join(',')})`).catch(() => []),
      c.finance ? HG.db.select('register_rule', `select=id,district_id,rule,enabled,params&rule=in.(near_threshold,split_purchase)`).catch(() => []) : Promise.resolve([]),
      HG.db.select('vendor_note', `select=vendor_key,expected,plain_label&district_id=eq.${d.id}`).catch(() => []),
    ]);
    REG.rules = rules; REG.flags = flags;
    const expected = new Set(notes.filter((n) => n.expected).map((n) => n.vendor_key));
    const openBy = {}; allOpen.forEach((f) => { openBy[f.batch_id] = (openBy[f.batch_id] || 0) + 1; });
    const mon = (pe) => new Date(pe + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const sorted = flags.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.id - b.id);
    const open = sorted.filter((f) => f.status === 'open'), done = sorted.filter((f) => f.status !== 'open');
    const asks = open.filter((f) => f.severity !== 'info'), fyi = open.filter((f) => f.severity === 'info');
    setLead(`<b>${esc(mon(cur.period_end))}</b>: ${Number(sum && sum.lines || cur.row_count || 0).toLocaleString('en-US')} payments${sum && sum.total != null ? `, ${esc(HGReport.fmt(Number(sum.total)))}` : ''}. `
      + (asks.length ? `<b>${asks.length}</b> question${asks.length === 1 ? '' : 's'} for the business office.` : 'No questions this month.'));
    const qCard = (f) => {
      const canVendor = c.finance && ['new_vendor', 'lookalike_vendor'].includes(f.rule) && f.vendor_key && !expected.has(f.vendor_key);
      return `<div class="regq sev-${esc(f.severity)}" data-reg-flag="${f.id}">
        <div class="row" style="gap:8px"><span class="peer-tag sev-${esc(f.severity)}">${esc(HGRegister.SEVERITY[f.severity] || f.severity)}</span><b>${esc(HGRegister.RULE_NAME[f.rule] || f.rule)}</b></div>
        <p>${esc(f.question)}</p>
        ${f.status !== 'open' ? `<p class="small"><b>${f.status === 'explained' ? 'Answer' : 'Not a concern'}</b>${f.resolved_at ? ` <span class="muted">(${esc(day(f.resolved_at))})</span>` : ''}${f.response ? `: ${esc(f.response)}` : ''}</p>`
          : c.finance ? `<label class="field">Answer<textarea name="response" rows="2" maxlength="2000" placeholder="What it was for, and who approved it"></textarea></label>
            <div class="row"><button type="button" class="btn small primary" data-action="regAnswer" data-id="${f.id}" data-status="explained">Save answer</button>
              <button type="button" class="btn small" data-action="regAnswer" data-id="${f.id}" data-status="dismissed">Not a concern</button>
              ${canVendor ? `<button type="button" class="btn small" data-action="regVendorOk" data-key="${esc(f.vendor_key)}">This vendor is expected</button>` : ''}</div>`
          : '<p class="small muted">Waiting for the business office.</p>'}</div>`;
    };
    const thr = (rules.find((r) => r.district_id === d.id && r.rule === 'near_threshold') || rules.find((r) => r.district_id == null && r.rule === 'near_threshold') || { params: {} }).params.threshold;
    return `
      <div class="row">
        <label class="chip"><span class="small muted">Month</span><select data-reg-month aria-label="Month">${batches.map((b) => `<option value="${esc(b.id)}" ${b.id === cur.id ? 'selected' : ''}>${esc(mon(b.period_end))}${openBy[b.id] ? ` (${openBy[b.id]} open)` : ''}</option>`).join('')}</select></label>
        ${c.finance ? `<a class="btn" href="#/d/${enc(d.slug)}/settings/uploads">Upload a month</a>` : ''}</div>
      <div class="card"><h3>${asks.length ? 'Questions' : 'No questions this month'}</h3>
        ${asks.length ? `<div class="stack">${asks.map(qCard).join('')}</div>` : '<p class="ok">Nothing in this month’s payments stood out against earlier months.</p>'}</div>
      ${fold(c, `For information (${fyi.length})`, fyi.length ? `<div class="card"><div class="stack">${fyi.map(qCard).join('')}</div></div>` : '', false)}
      ${fold(c, `Answered (${done.length})`, done.length ? `<div class="card"><div class="stack">${done.map(qCard).join('')}</div></div>` : '', false)}
      ${sum ? fold(c, 'This month’s payments: largest vendors and funds', `<div class="cap-grid">
        <div class="card"><h3>Largest vendors</h3>${table([{ label: 'Vendor', html: (v) => `${esc(v.vendor)}${v.label ? ` <span class="small muted">${esc(v.label)}</span>` : ''}` }, { label: 'Paid', num: true, get: (v) => money(v.total) }], sum.top_vendors || [], 'None.')}</div>
        <div class="card"><h3>By fund</h3>${table([{ label: 'Fund', get: (x) => x[0] === '?' ? 'Not given' : x[0] }, { label: 'Paid', num: true, get: (x) => money(x[1]) }], Object.entries(sum.by_fund || {}).sort((a, b) => b[1] - a[1]), 'None.')}</div></div>`, false) : ''}
      ${c.finance ? fold(c, 'Settings for these checks', `<div class="card">
        <div class="inline-form"><label class="field">Bid threshold, $<input data-reg-threshold inputmode="decimal" value="${thr ? esc(moneyIn(thr)) : ''}" placeholder="from board policy" style="max-width:160px">
          <span class="hint">From the district’s purchasing policy. With it, HighGround asks about payments just under it and purchases that look split to stay under it. Blank turns those two checks off.</span></label>
          <button type="button" class="btn" data-action="regThreshold">Save and re-check every month</button></div>
        <p class="small muted">Questions already answered are kept. Fund, function and object come from the export’s account number when it has no separate columns.</p></div>`, false) : ''}
      <p class="small muted">These checks look for patterns worth a question; they don’t find fraud or prove anything is wrong. The board still reviews and approves the bills.</p>`;
  }
  /* rows (headings first) → an Excel file the browser downloads */
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function saveXlsx(name, rows, sheet) { saveFile(name, HGUploads.toXlsx(rows, sheet), XLSX_TYPE); }
  function saveText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------------------------------------------ Reports → Plans: the improvement plan in three views (plan.js)
  const PL = { key: null, view: 'full', items: 'approved', years: 5, open: null };
  const planName = (st) => ((st && st.plan_name) || '').trim() || 'District improvement plan';
  /** the board version's capital funds over the plan years: start, receipts, spending, end, lowest; borrowing; the gap */
  function planFunding(rows, board, start, last) {
    if (!board || !rows.settings) return null;
    const bi = HGCapital.buildInputs(rows, board.id), r = HGEngine.compute(bi.projects, bi.levers, bi.cfg), P = HGCapital.fundPaths(r, bi.cfg);
    const funds = ['save', 'ppel', 'vppel', 'grants'].map((k) => {
      const ys = P[k].years.filter((y) => y.fy >= start && y.fy <= last); if (!ys.length) return null;
      const low = ys.reduce((a, y) => (y.end < a.end ? y : a), ys[0]);
      return { k, name: HGPlan.FUND_WORD[k], start: ys[0].start, receipts: ys.reduce((t, y) => t + y.receipts, 0), spend: ys.reduce((t, y) => t + y.spend, 0),
        over: ys.reduce((t, y) => t + y.over, 0), end: ys[ys.length - 1].end, low: low.end, lowFY: low.fy };
    }).filter((x) => x && (x.start || x.receipts || x.spend));
    const KIND = { go: 'General-obligation bond (voter-approved)', rev: 'SAVE revenue bond', lease: 'Lease-purchase', gift: 'Gift or grant' };
    const borrow = (rows.financing || []).filter((x) => x.scenario_id === board.id && Number(x.issue_fy) >= start && Number(x.issue_fy) <= last)
      .map((x) => ({ name: x.name, kind: KIND[x.kind] || x.kind, fy: Number(x.issue_fy), amount: Number(x.amount), years: Number(x.years) }));
    const pending = rows.initiatives.filter((i) => ['idea', 'proposed', 'analysis'].includes(i.status || 'proposed')
      && rows.phases.some((p) => p.scenario_id === board.id && p.initiative_id === i.id)).length;
    return { funds, borrow, gap: r.gap, pending };
  }
  function planHtml(c, plan, extra, saved) {
    const f = HGReport.fmt, d = c.district;
    const T = plan.totals, money = (x) => (x.noCost ? '<span class="muted">No outside cost</span>' : `${x.cost > 0.5 ? f(x.cost) : ''}${x.yearly > 0.5 ? `${x.cost > 0.5 ? '<br>' : ''}${f(x.yearly)} a year` : ''}`);
    const fundList = Object.entries(T.byFund).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(HGPlan.FUND_WORD[k] || k)} ${f(v)}`);
    const yrs = plan.start ? `FY${plan.start}–FY${plan.last}` : '';
    const lead = `<b>${T.count}</b> approved initiative${T.count === 1 ? '' : 's'}${T.cost > 0.5 ? `, <b>${f(T.cost)}</b> in ${esc(yrs || 'the plan')}` : ''}${T.yearly > 0.5 ? ` and ${f(T.yearly)} a year ongoing` : ''}${T.noCost ? `; ${T.noCost} with no outside cost` : ''}.`
      + (plan.items === 'all' && T.proposedCount ? ` ${T.proposedCount} proposal${T.proposedCount === 1 ? '' : 's'} shown${T.proposedCost > 0.5 ? ` (${f(T.proposedCost)})` : ''}, not counted.` : '')
      + (extra && extra.funding && plan.view !== 'csip' ? (extra.funding.gap > 0.5 ? ` The board version is <b>${f(extra.funding.gap)}</b> short.` : ' The board version is fully paid for.') : '');
    const cols = [
      { label: 'Initiative', html: (x) => `<b>${esc(x.name)}</b>${x.counted ? '' : ' <span class="st st-proposed">Proposed</span>'}${x.csip && plan.view !== 'csip' ? ' <span class="st st-approved">CSIP</span>' : ''}` },
      { label: 'Completion', get: (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x.completion) ? day(x.completion) : x.completion) },
      { label: 'Category', get: (x) => x.category }, { label: 'Priority', get: (x) => x.priority },
      { label: 'Cost', num: true, html: money }, { label: 'Funding', get: (x) => x.funding },
      { label: 'Responsible', get: (x) => x.owner }, ...(plan.view === 'capital' ? [] : [{ label: 'Goal', get: (x) => x.goal }]),
    ];
    const goals = plan.goals.length ? `<div class="card"><h3>${plan.view === 'csip' ? 'Academic goals' : 'Goals'}</h3>${plan.goals.map((g, k) => `<div class="plan-goal">
        <div class="small muted">Goal ${k + 1}${g.csip ? ' · <span class="st st-approved">CSIP goal</span>' : ''} · ${g.initiatives} initiative${g.initiatives === 1 ? '' : 's'}</div><h4>${esc(g.name)}</h4>${g.statement ? `<p class="small">${esc(g.statement)}</p>` : ''}
        ${g.outcomes.length ? `<div class="small"><span class="muted">Outcomes:</span> ${g.outcomes.map(esc).join('; ')}</div>` : ''}
        ${g.measures.length ? `<ul class="small">${g.measures.map((m) => `<li>${measureLink(d.slug, m)}${m.latest != null ? `: <b>${esc(mVal(m, m.latest))}</b>${m.period ? ` <span class="muted">(${esc(m.period)})</span>` : ''}` : ''}${m.target != null ? ` <span class="muted">· target ${esc(mVal(m, m.target))}</span>` : ''} <span class="st ${STATE_CLASS[m.state] || 'st-proposed'}">${esc(HGDirection.STATE_NAME[m.state] || '')}</span></li>`).join('')}</ul>` : '<p class="small muted">No measures yet.</p>'}</div>`).join('')}
      ${plan.view === 'csip' ? '<p class="small muted">The CSIP itself is filed with the Department of Education in CASA; this view shows the same goals beside the district’s initiatives and costs.</p>' : ''}</div>` : (plan.view === 'csip' ? `<div class="card"><h3>Academic goals</h3><p>No priorities are tagged as CSIP goals yet.${c.plan ? ` Open a priority on <a href="#/d/${enc(d.slug)}/plan/priorities">Plan → Priorities</a> and tick “One of the district’s state CSIP goals”.` : ''}</p></div>` : '');
    const groups = plan.groups.length ? plan.groups.map((g) => `<div class="card"><h3>${esc(g.label)} <span class="small muted">· ${g.items.length}</span></h3>${table(cols, g.items, '')}</div>`).join('')
      : `<div class="card"><p class="muted">Nothing to show${plan.items === 'approved' ? ' among approved initiatives. Choose “All items” to include proposals' : ''}.</p></div>`;
    const sched = plan.schedule.length ? `<div class="card"><h3>Schedule by year</h3><div class="plan-years">${plan.schedule.map((y) => `<div><h4>FY${y.fy}</h4><ul class="small">${y.items.map((x) => `<li>${esc(x.name)}${x.counted ? '' : ' <span class="muted">(proposed)</span>'}<br><b>${f(x.cost)}</b>${x.funding ? ` <span class="muted">· ${esc(x.funding)}</span>` : ''}</li>`).join('')}</ul></div>`).join('')}</div></div>` : '';
    const F = extra && extra.funding;
    const funding = F && plan.view !== 'csip' && F.funds.length ? `<div class="card"><h3>Capital funds, ${esc(yrs)}</h3>${table([
        { label: 'Fund', get: (x) => x.name }, { label: `Start of FY${plan.start}`, num: true, get: (x) => f(x.start) }, { label: 'Coming in', num: true, get: (x) => f(x.receipts) },
        { label: 'Planned spending', num: true, get: (x) => f(x.spend) }, { label: `End of FY${plan.last}`, num: true, get: (x) => f(x.end) }, { label: 'Lowest', num: true, get: (x) => `${f(x.low)} (FY${x.lowFY})` }], F.funds, '')}
      ${F.borrow.length ? `<p class="small"><b>Borrowing in the plan:</b> ${F.borrow.map((b) => `${esc(b.name)}, ${esc(b.kind)}, ${f(b.amount)} in FY${b.fy}${b.years ? ` over ${b.years} years` : ''}`).join('; ')}.</p>` : ''}
      <p class="small muted">From the board version “${esc(extra.boardName)}” as a whole: spending includes existing debt, ongoing costs and every phase in it${F.pending ? `, including ${F.pending} initiative${F.pending === 1 ? '' : 's'} not yet approved` : ''}.${fundList.length ? ` Approved initiatives in this view: ${fundList.join(', ')}${T.auto > 0.5 ? `, and ${f(T.auto)} the plan assigns across the capital funds` : ''}.` : ''}</p></div>` : '';
    const title = plan.view === 'full' ? (extra.planName) : plan.viewName;
    return `<div class="card plan-head"><div class="small muted">${esc(d.name)}${saved ? ` · saved ${esc(day(saved.created_at))}` : ''}</div><h2 style="margin:4px 0">${esc(title)}</h2>
        <p class="small muted">${esc(yrs)}${plan.board ? ` · costs from the board version “${esc(plan.board.name)}”` : ' · no board version yet, so no costs'} · ${plan.items === 'approved' ? 'approved items only' : 'all items; proposals are labelled and not counted'}</p>
        <p>${lead}</p></div>
      ${goals}${groups}${sched}${funding}
      <p class="small muted">Totals count approved work only (approved, in progress and completed). Costs are the board version’s phases within the plan years, at their planned cost (the actual cost once finished), plus yearly costs.${plan.unlinked ? ` ${plan.unlinked} initiative${plan.unlinked === 1 ? ' isn’t' : 's aren’t'} linked to a goal.` : ''}</p>`;
  }
  async function vPlan(c) {
    const d = c.district;
    if (PL.key !== d.id) { PL.key = d.id; PL.open = null; PL.view = 'full'; PL.items = 'approved'; PL.years = 5; }
    const [D, saved] = await Promise.all([loadDirection(d),
      HG.db.select('report_snapshot', `select=id,title,created_at,payload&district_id=eq.${d.id}&kind=eq.improvement_plan&order=created_at.desc&limit=30`).catch(() => [])]);
    const rows = D.rows, board = rows.scenarios.find((x) => x.is_board_version) || null;
    if (PL.open) {
      const sv = saved.find((x) => x.id === PL.open);
      if (sv) {
        setLead(`Saved ${esc(day(sv.created_at))}: ${esc(sv.title)}.`);
        return `<div class="row noprint"><button type="button" class="btn" data-action="planBack">← Back to the live plan</button><button type="button" class="btn" data-action="rpPrint">Print or save as PDF</button></div>${planHtml(c, sv.payload.plan, sv.payload.extra, sv)}`;
      }
      PL.open = null;
    }
    let start = rows.settings && rows.settings.plan_start_fy ? Number(rows.settings.plan_start_fy) : null;
    if (!start && board && rows.settings) start = HGCapital.buildInputs(rows, board.id).cfg.start;
    if (!start) start = new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const plan = HGPlan.build(rows, D, { view: PL.view, items: PL.items, years: PL.years, start, boardId: board && board.id });
    const extra = { planName: planName(rows.settings), boardName: board ? board.name : '', funding: planFunding(rows, board, start, start + PL.years - 1) };
    PL.last = { plan, extra };
    setLead((PL.view === 'full' ? esc(extra.planName) : esc(plan.viewName)) + `: <b>${plan.totals.count}</b> approved initiative${plan.totals.count === 1 ? '' : 's'}${plan.totals.cost > 0.5 ? `, ${HGReport.fmt(plan.totals.cost)} over ${PL.years} years` : ''}.`);
    const btn = (v, label) => `<button type="button" class="pipe ${PL.view === v ? 'on' : ''}" data-action="planView" data-v="${v}">${label}</button>`;
    const canName = c.admin && rows.settings;
    return `<div class="card noprint"><div class="pipeline" role="group" aria-label="Which plan">${btn('full', esc(extra.planName))}${btn('csip', 'Academic goals (CSIP)')}${btn('capital', 'Capital improvement plan')} ${def('plans')}</div>
        <div class="inline-form" style="margin-top:10px">
          <label class="field">Items<select data-plan-items><option value="approved" ${PL.items === 'approved' ? 'selected' : ''}>Approved only</option><option value="all" ${PL.items === 'all' ? 'selected' : ''}>All items, proposals labelled</option></select></label>
          <label class="field">Years<select data-plan-years>${[5, 10].map((y) => `<option value="${y}" ${PL.years === y ? 'selected' : ''}>${y} years</option>`).join('')}</select></label>
          <button type="button" class="btn" data-action="rpPrint">Print or save as PDF</button><button type="button" class="btn" data-action="planXlsx">Download Excel</button>
          ${c.plan ? '<button type="button" class="btn" data-action="planSave">Save this version</button>' : ''}</div>
        ${canName ? `<form class="inline-form" data-form="savePlanName" style="margin-top:10px"><label class="field">The district’s name for its full plan<input name="plan_name" maxlength="80" value="${esc((rows.settings.plan_name || '').trim())}" placeholder="District improvement plan"></label><button type="submit" class="btn small">Save name</button></form>` : ''}</div>
      ${planHtml(c, plan, extra, null)}
      ${saved.length ? `<div class="card noprint"><h3>Saved versions</h3><p class="small muted">Exactly as they were when saved, for example the version the board adopted.</p>${table([
        { label: 'Saved', html: (r) => `<a href="#" data-action="planOpen" data-id="${esc(r.id)}">${esc(day(r.created_at))}</a>` }, { label: 'Version', get: (r) => r.title }], saved, '')}</div>` : ''}`;
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
    const pubNow = d.public_link_enabled ? (await HG.db.select('publication', `select=published_at&district_id=eq.${d.id}&kind=eq.board_plan&is_current=eq.true&limit=1`).catch(() => []))[0] || null : null;
    const pubUrl = `${HG.appUrl()}#/p/${enc(d.slug)}`;
    const pubCard = d.public_link_enabled ? `<div class="card"><h3>Community page</h3><p>${pubNow ? `Published ${esc(day(pubNow.published_at))}: <a href="${esc(pubUrl)}" target="_blank" rel="noopener">${esc(pubUrl)}</a>` : 'Nothing is published on the public link yet.'}${c.admin ? ` <a href="#/d/${enc(d.slug)}/share/community">Manage</a>` : ''}</p></div>` : '';
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
      ${c.admin ? '' : pubCard}
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
    go(`#/d/${enc(d.slug)}/share/board`); here();
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
        <label class="row"><input type="checkbox" data-pub-survey ${CP.survey ? 'checked' : ''}> Include “What you told us”: the latest community survey’s priorities and top themes${draft.survey ? ` (${esc(draft.survey.name)})` : CP.survey ? ' <span class="small muted">(no survey yet: add one on Plan → Community input)</span>' : ''}</label>
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
      <div class="pubpreview">${html}</div></div>`, { noFocus: true });
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
          <button type="button" class="btn primary" data-action="exportProjects">Download (Excel)</button></div>` : '<p class="muted">No scenarios yet.</p>'}</div>
      <div class="card"><h3>Every scenario’s phases</h3>
        <p>All scenarios in one spreadsheet, one row per phase, with each fund’s share in dollars. Useful for comparing scenarios in Excel.</p>
        ${rows.scenarios.length ? '<button type="button" class="btn" data-action="exportPhases">Download (Excel)</button>' : '<p class="muted">No scenarios yet.</p>'}</div>
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
    saveXlsx(`${fileStem()}-${sc.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.xlsx`, HGUploads.parseCSV(HGUploads.projectsToCSV(inp.projects, inp.cfg.start)), 'Projects');
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
    saveXlsx(`${fileStem()}-all-phases.xlsx`, out, 'All phases');
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
  /**
   * Logos arrive in every shape: square badges, wide wordmarks, tall crests, often with a wide white or clear margin.
   * Before upload: crop away the margin (the colour of the corners, or transparency), keep a 4% breathing space,
   * and scale the longest side down to 800 px. PNG keeps a clear background clear. If anything goes wrong, the original is used.
   */
  async function trimLogo(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const W = img.naturalWidth, H = img.naturalHeight; if (!W || !H) return { blob: file, w: W, h: H };
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, W, H).data, at = (x, y) => (y * W + x) * 4;
      const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => px.slice(at(x, y), at(x, y) + 4));
      const clear = corners.filter((q) => q[3] < 16).length >= 3, bg = corners[0];
      const isBg = (i) => (clear ? px[i + 3] < 16 : px[i + 3] < 16 || (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) < 36));
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isBg(at(x, y))) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return { blob: file, w: W, h: H };   // nothing but background: leave it alone
      const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, 800 / Math.max(cw, ch)), ow = Math.round(cw * k), oh = Math.round(ch * k);
      const o = document.createElement('canvas'); o.width = ow; o.height = oh; const og = o.getContext('2d');
      og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, cw, ch, 0, 0, ow, oh);
      const blob = await new Promise((ok) => o.toBlob(ok, 'image/png'));
      return blob && blob.size < 2 * 1024 * 1024 ? { blob, w: ow, h: oh, trimmed: cw < W || ch < H } : { blob: file, w: W, h: H };
    } catch (e) { return { blob: file }; } finally { URL.revokeObjectURL(url); }
  }
  HG.trimLogo = trimLogo;   // for the browser tests
  async function uploadLogo(file) {
    const d = S.district;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new UserError('Use a PNG, JPEG or WebP image.');
    if (file.size > 10 * 1024 * 1024) throw new UserError('That image is over 10 MB. Save a smaller copy and try again.');
    const t = await trimLogo(file);
    if (t.blob.size > 2 * 1024 * 1024) throw new UserError('That image is still over 2 MB after resizing. Save a smaller copy and try again.');
    if (t.w && t.h && Math.max(t.w, t.h) < 120) toast('That logo is small', `It’s ${t.w}×${t.h} pixels, so it may look soft. A copy at least 400 pixels wide will look sharper.`);
    file = t.blob === file ? file : new File([t.blob], 'logo.png', { type: 'image/png' });
    const path = `${d.id}/logo-${Date.now()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
    await HG.storage.replace('district-public', path, file);
    const old = d.logo_path;
    await HG.db.update('district', `id=eq.${d.id}`, { logo_path: path });
    if (old) { try { await HG.storage.remove('district-public', [old]); } catch (e) { /* the old file can stay */ } }
    await loadContext(true); toast('Logo updated'); here();
  }
  /* ---- Settings: one card per setting, grouped, each with a live line; setup progress on top ---- */
  async function vSettingsHome(c) {
    const d = c.district, vis = visibleTabs(FOOT[0]).map((t) => t.id), q = (t, x) => HG.db.select(t, x).catch(() => []);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [D, mem, sets, ups, acts, latestRep] = await Promise.all([loadDirection(d), q('district_member', `select=role&district_id=eq.${d.id}`),
      q('assumption_set', `select=name&district_id=eq.${d.id}`), q('import_batch', `select=kind,status,uploaded_at,file_name&district_id=eq.${d.id}&order=uploaded_at.desc&limit=1`),
      c.admin ? q('audit_log', `select=id&district_id=eq.${d.id}&at=gte.${encodeURIComponent(monthStart.toISOString())}&limit=500`) : Promise.resolve(null),
      q('report_snapshot', `select=id&district_id=eq.${d.id}&kind=eq.board_monthly&limit=1`)]);
    const steps = setupSteps(c, { rows: D.rows, D, mem, latestRep }), done = steps.filter((x) => x.done).length, left = steps.filter((x) => !x.done);
    const nextMine = left.find((x) => x.who);
    const roles = mem.reduce((m, x) => { m[x.role] = (m[x.role] || 0) + 1; return m; }, {});
    const chips = (list) => `<span class="pips">${list.map((x) => `<i class="${x[1] ? 'on' : ''}">${esc(x[0])}</i>`).join('')}</span>`;
    const dot = (k) => `<span class="sdot ${k || ''}"></span>`;
    const verified = ((S.user && S.user.factors) || []).some((f) => f.status === 'verified');
    const up = ups[0];
    const CARDS = {
      district: ['bld', 'District', 'Name, Iowa district number, public link and the logo shown in the menu.', d.logo_path ? `<img class="lg" src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt="">${d.menu_logo_only ? 'Logo shown in the menu' : 'Logo uploaded'}` : `${dot()}No logo yet`],
      people: ['users', 'People', 'Who can see and change this district, and what each role can do.', chips([[`${(roles.admin || 0)} admin${roles.admin === 1 ? '' : 's'}`, 1], [`${(roles.business_manager || 0) + (roles.superintendent || 0) + (roles.editor || 0)} staff`, 0], [`${(roles.board || 0) + (roles.viewer || 0)} board and viewers`, 0]])],
      setup: ['calc', 'Starting numbers', 'Receipts, fund balances, levy rates and existing debt: what the plan starts from.', D.rows.settings ? `${dot('ok')}Entered` : `${dot('warn')}Not entered yet`],
      assumptions: ['sliders', 'Assumption sets', 'The futures the plan has to survive: enrollment, valuations, inflation.', sets.length ? chips(sets.slice(0, 3).map((x, i) => [x.name, i === 0])) : 'Base only'],
      uploads: ['upload', 'Uploads', 'Ledgers, balances, check registers and project lists, and what happened to each.', up ? `${dot(up.status === 'applied' ? 'ok' : 'warn')}${esc(KIND[up.kind] || up.kind)} · ${esc(day(up.uploaded_at))}` : 'Nothing uploaded yet'],
      activity: ['clock', 'Activity', 'Every change: who made it, when, and what it was before.', acts ? `${acts.length >= 500 ? '500+' : acts.length} change${acts.length === 1 ? '' : 's'} this month` : 'Admins only'],
      exports: ['download', 'Exports', 'Download the district’s data for spreadsheets or backup.', 'Excel or CSV'],
      account: ['user', 'Your account', 'Your name, password and sign-in security.', verified ? `${dot('ok')}Two-step sign-in on` : `${dot()}Two-step sign-in off`],
    };
    const card = (id) => { if (!vis.includes(id) || !CARDS[id]) return ''; const [ic, t, ds, st] = CARDS[id];
      return `<a class="scard" href="#/d/${enc(d.slug)}/settings/${id}"><span class="top2"><span class="sico">${icon(ic, 19, 1.8)}</span><h3>${esc(t)}</h3></span><span class="ds">${esc(ds)}</span><span class="stat2">${st}<span class="go">${icon('arrow', 14)}</span></span></a>`; };
    const group = (title, sub, ids) => { const cards = ids.map(card).filter(Boolean); return cards.length ? `<section class="sgrp"><div class="gh"><h2>${esc(title)}</h2><p>${esc(sub)}</p><span class="n">${cards.length} setting${cards.length === 1 ? '' : 's'}</span></div><div class="scards">${cards.join('')}</div></section>` : ''; };
    const banner = done < steps.length && (c.admin || c.plan || c.finance) ? `<div class="setup-hero"><div><h2>Setup is ${done} of ${steps.length} done</h2>
        <p>${left.length <= 3 ? `Still to do: ${left.map((x) => esc(x.title.toLowerCase())).join(', ')}.` : `${left.length} steps left, starting with ${esc(left[0].title.toLowerCase())}.`}</p></div>
        ${nextMine ? `<button type="button" class="btn" data-action="setupGo" data-k="${nextMine.k}">${done ? 'Finish setup' : 'Start setup'}</button>` : ''}
        <div class="bar"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div></div>` : '';
    SETUP.steps = steps;
    return `${banner}<div class="sgroups">
      ${group('Your district', 'Who you are and who can get in.', ['district', 'people'])}
      ${group('Planning numbers', 'What every forecast and ranking starts from.', ['setup', 'assumptions', 'uploads'])}
      ${group('Records and you', 'History, backups and your own sign-in.', ['activity', 'exports', 'account'])}</div>`;
  }
  async function vDistrict(c) {
    const d = c.district;
    let dom = null;
    try { dom = (await HG.db.select('district', `select=allowed_domains,domain_role&id=eq.${d.id}`))[0] || null; } catch (e) { dom = null; }
    const dis = c.admin ? '' : 'disabled';
    let linked = null;
    if (d.state_district_id) { try { linked = (await HG.db.select('ia_district', `select=de_district,name,aea&de_district=eq.${enc(d.state_district_id)}`))[0] || null; } catch (e) { linked = null; } }
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
          <label class="field">Iowa district number<input name="state_district_id" inputmode="numeric" maxlength="4" value="${esc(d.state_district_id || '')}" placeholder="0000" style="max-width:120px" ${dis}>
            <span class="hint" data-ia-linked>${linked ? `${esc(linked.name)}${linked.aea ? `, AEA ${esc(linked.aea)}` : ''}. ` : d.state_district_id ? 'Not found in the state data yet. ' : ''}The Iowa Department of Education’s 4-digit number. Used to compare with similar districts and to fill starting numbers from the state’s annual report.</span></label>
          ${c.admin ? `<div class="inline-form"><label class="field">Find the number by name<input data-ia-q placeholder="for example, Ames" autocomplete="off"></label><button type="button" class="btn" data-action="iaSearch">Find</button></div><div data-ia-results></div>` : ''}
          <p class="small muted">Link id: <b>${esc(d.slug)}</b> (set when the district is created)</p>
          ${c.admin ? '<div><button class="btn primary" type="submit">Save changes</button></div>' : '<p class="small muted">Only a district admin can change these.</p>'}
        </form></div>
      <div class="card"><h3>Logo</h3>
        <div class="row" style="align-items:center;gap:18px">
          ${d.logo_path ? `<img src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt="${esc(d.name)} logo" class="logo-preview">` : `<span class="tile big" style="background:${esc(d.brand_color || '#1E3A2F')}">${esc(initials(d.short_name || d.name))}</span>`}
          <div class="stack" style="gap:6px">
            <p class="small muted">Shown in the menu and on the public page. Any shape works: wide wordmarks, square badges and tall crests. HighGround crops away empty margins and resizes it when you upload. Best: a PNG with a clear background, at least 400 pixels across. PNG, JPEG or WebP, up to 10 MB.</p>
            ${d.logo_path ? `<div class="logo-try"><span class="small muted">In the menu, logo only:</span><div class="logo-try-box"><img class="org-logo" src="${esc(HG.storage.publicUrl('district-public', d.logo_path))}" alt=""></div></div>` : ''}
            ${c.admin ? `<div class="row"><label class="btn">${d.logo_path ? 'Replace logo' : 'Upload a logo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo-file hidden></label>
              ${d.logo_path ? '<button type="button" class="btn danger" data-action="removeLogo">Remove</button>' : ''}</div>` : '<p class="small muted">A district admin can change it.</p>'}
          </div></div>
        <div class="logo-mode"><b>Show at the top of the menu as</b>
          <div class="radios">
            <label><input type="radio" name="logo_mode" value="name" data-logo-mode ${!d.menu_logo_only || !d.logo_path ? 'checked' : ''} ${c.admin && 'menu_logo_only' in d ? '' : 'disabled'}> Initials and name</label>
            <label><input type="radio" name="logo_mode" value="logo" data-logo-mode ${d.menu_logo_only && d.logo_path ? 'checked' : ''} ${c.admin && d.logo_path && 'menu_logo_only' in d ? '' : 'disabled'}> Logo only</label>
          </div>
          <p class="small muted">${!('menu_logo_only' in d) ? 'Available once database part 22 is installed.' : d.logo_path ? 'Logo only replaces the initials and the district’s name at the top of the menu. A wide logo works best here.' : 'Upload a logo to show it instead of the initials and name.'}</p></div></div>
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
    if (staffNow() || c.role === 'admin' || !VIEWS[c.role] || lockedRole(c.role)) return '';
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
    fund_choice: ['Split or whichever has room', 'With two or three funds, a phase can split its cost between them (60% SAVE, 40% PPEL), or be paid in full from whichever has room that year, in the order listed (SAVE, then PPEL). The capital plan picks the fund each year, working down the list of initiatives, and shows which one it used: a ↺ means the first choice was full. Check with the business manager that the project fits each fund’s rules.'],
    funding_line: ['Funding line', 'Where the money runs out when initiatives are paid for in priority order: everything above it fits; everything below it needs another source or a later year.'],
    gl: ['Month-end general ledger (GL) export', 'The report your finance system produces when a month is closed: every account’s budget, activity for the year to date, encumbrances and ending balance. HighGround reads it for fund balances, budget against actual and spending on initiatives. It is not the check register: that is the list of individual bills paid, which HighGround uses only to raise questions about payments.'],
    encumbered: ['Encumbered', 'Money already committed by a purchase order or contract but not yet paid out.'],
    solvency: ['Solvency ratio', 'The General Fund’s cushion: unassigned and assigned fund balance divided by General Fund revenue (less AEA flowthrough). Many districts aim for 5–10%.'],
    authority: ['Spending authority', 'The most a district may spend from the General Fund in a year: formula funding, plus miscellaneous income, plus the unspent balance carried forward (capped, see Unspent balance).'],
    unspent: ['Unspent balance', 'Spending authority not used in a year. From FY2027 (SF 2472), only part of it carries into next year’s authority: the lesser of the unspent balance and 35% of the authorized budget from two years earlier (FY2025’s for FY2027). The School Budget Review Committee can approve more on request. The forecast applies this cap. Spending more than the authority requires a corrective plan; two years in a row brings state review.'],
    guarantee: ['Budget guarantee', 'Iowa’s budget adjustment (Iowa Code 257.14): regular program funding of at least 101% of the year before’s. It isn’t a one-time cushion: it’s available every year, so with several years of falling enrollment a district can be on it year after year, each year 1% above the last. The board adopts a resolution by May 15 to use it, and the extra is normally paid by local property taxes (for FY2027 the state paid it instead, under SF 2201).'],
    ssa: ['State supplemental aid', 'The yearly percentage increase in per-student funding, set by the Legislature. It is 2% for FY2027 ($8,148 state cost per pupil).'],
    dcpp: ['District cost per pupil', 'The per-student amount the school funding formula provides: the state cost per pupil plus any district adjustment.'],
    go_bond: ['General obligation bond', 'Borrowing approved by voters (60% in Iowa), repaid by a property tax called the debt service levy.'],
    rev_bond: ['Revenue bond', 'Borrowing repaid from SAVE receipts. It usually needs a public hearing rather than a vote.'],
    rollback: ['Rollback', 'The share of a property’s assessed value that is actually taxed. The state sets it each year by property type.'],
    assumptions: ['Assumption set', 'The outlook a scenario plans for: inflation, revenue growth, enrollment, negotiated raises (total package increase) and health insurance. Base, Conservative and Growth are common sets.'],
    measure_status: ['Measure status', 'On track: at or ahead of a straight path from the starting point to the target. Off track: behind it. Met: the target is reached. Update owed: no result within the measure’s schedule.'],
    fiscal_year: ['Fiscal year', 'July 1 to June 30, named for the year it ends: FY2027 runs from July 2026 to June 2027.'],
    csip: ['CSIP goal', 'Iowa requires each district’s comprehensive school improvement plan (CSIP) to set long-range goals in at least reading, math and science, with annual improvement goals and a progress report to the community, the AEA and the Department of Education by September 15 (Iowa Administrative Code 281-12.8). The plan itself is filed in the Department’s CASA system. Tag the priorities that are CSIP goals, and Share → District plan shows them, with their measures and the initiatives behind them, as the academic goals view.'],
    plans: ['The three plan views', 'One plan, three views of it. The full plan has every goal and initiative, with or without a cost. Academic goals (CSIP) has only the priorities tagged as state CSIP goals and the initiatives serving them. The capital improvement plan has the initiatives paid from SAVE, PPEL, V-PPEL, bonds or capital grants and gifts, with the funding picture. Costs come from the board version; totals count approved work only (approved, in progress, completed).'],
    benefits: ['Benefits and health insurance', 'Each staff group costs FTE × (average salary × (1 + benefits %) + health insurance per FTE). The benefits % is the district’s FICA (7.65%), IPERS (9.44% for FY2027) and any other benefits paid as a share of salary, which comes to 17.09% before anything else. Health insurance is a dollar amount per FTE, because it doesn’t rise with salary and grows at its own rate. The state’s annual report lumps health insurance in with benefits, so its benefits % (often 25–35%) already includes health: use it only if you leave health per FTE blank.'],
    package: ['Total package increase', 'The yearly raise agreed with staff in negotiations, as a percent: what boards and associations in Iowa usually call the total package. HighGround grows salaries by it, and the benefits that follow pay (IPERS, FICA); health insurance has its own growth rate.'],
    turnover: ['Turnover savings', 'When experienced staff leave and newer staff join on lower pay, total salaries grow a little slower than the negotiated raise.'],
    sources: ['Where these figures come from', 'Public reports only: the district’s own Certified Annual Report and certified enrollment (Iowa Department of Education); tax rates, valuations, the Aid and Levy worksheet and the unspent balance report (Iowa Department of Management); median home values (U.S. Census Bureau); and school construction prices (U.S. Bureau of Labor Statistics). They’re refreshed monthly. They’re starting points: change any of them, and nothing is used until you save. This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.'],
  };
  /** the public sources behind every pre-filled figure, for the Help panel on setup screens */
  const SOURCES = [
    ['Iowa Department of Education', 'Certified Annual Report: the year-end report each district files (fund balances, SAVE and PPEL receipts and spending, General Fund salaries and benefits, debt payments, gifts and grants). Certified enrollment.'],
    ['Iowa Department of Management', 'School tax rates (regular and voter-approved PPEL); the Aid and Levy worksheet (budget enrollment, district cost per pupil, formula funding); property valuations by class (taxable and 100%, farmland and homes); the Unspent Authorized Budget report (miscellaneous income, unspent balance).'],
    ['U.S. Census Bureau', 'American Community Survey 5-year estimates: the median value of owner-occupied homes in the district, for the tax example.'],
    ['U.S. Bureau of Labor Statistics', 'Producer Price Index for new school building construction: the default for construction inflation.'],
  ];
  const sourcesHtml = () => `<h3>Where the starting figures come from</h3><p class="small">Every figure HighGround fills in comes from a public report the district already files or a public agency publishes. They’re refreshed monthly and are starting points: change any of them, and nothing is used until you save.</p>
    <dl class="terms">${SOURCES.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
    <p class="small muted">Planning assumptions with no public source (health insurance growth, negotiated raises, turnover) start from typical recent Iowa figures and are yours to set.</p>
    <p class="small"><b>${CENSUS_NOTICE}</b></p>`;
  const CENSUS_NOTICE = 'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.';
  /** a small “?” beside a term; tapping it shows the definition */
  const def = (key) => (TERMS[key] ? `<button type="button" class="defn" data-action="define" data-term="${key}" aria-label="${key === 'sources' ? esc(TERMS[key][0]) : `What is ${esc(TERMS[key][0])}?`}">?</button>` : '');
  async function vGuide(c) {
    const r = c.role, link = (path, text) => `<a href="#/d/${enc(c.district.slug)}/${path}">${text}</a>`;
    const start = ['board', 'viewer'].includes(r) && !c.staff ? [
      `Each month, open the latest ${link('share/board', 'board report')}: what changed, the capital plan, the funds, progress and decisions ahead.`,
      `Before a vote, read the ${link('share/board', 'decision packet')} for that initiative: its costs, its effect on the plan and where it falls on the funding line.`,
      `For the bigger picture, see ${link('money/capital', 'Money')} (the capital plan and the funds) and ${link('plan/priorities', 'Plan → Priorities')} (the strategic plan).`]
      : r === 'business_manager' ? [
      `Each month, upload the month-end ledger on ${link('settings/uploads', 'Uploads')}, check the balances it shows, and apply it.`,
      `Then link any new spending accounts to initiatives on ${link('track/initiatives', 'Track → Initiative progress')}, and check ${link('track/actuals', 'Budget vs. actual')}.`,
      `Create the month’s ${link('share/board', 'board report')}. Keep ${link('settings/setup', 'Starting numbers')} and the ${link('money/general', 'General Fund')} figures current.`]
      : [
      `Start on ${link('home/today', 'Home')}: what needs attention, and where the plan stands.`,
      `Shape the plan on ${link('plan/initiatives', 'Plan')} (initiatives, their ranking, scenarios) and the ${link('money/capital', 'capital plan')}.`,
      `Keep ${link('plan/priorities', 'the priorities')} and ${link('track/measures', 'measures')} current, then ${link('share/board', 'report to the board')} and ${link('share/community', 'publish to the community')}.`];
    const tasks = [
      ['See where the money runs out', 'Plan → Initiatives, Ranked'], ['Compare two versions of the plan', 'Plan → Scenarios'],
      ['Test a different future (inflation, negotiated raises, enrollment)', 'the what-if levers on the capital plan and the General Fund'], ['See what a bond would cost a homeowner', 'the capital plan’s “What it means for taxpayers”'],
      ['Record a measure’s result', 'Track → Measures'], ['Share the plan with the public', 'Share → Community page'],
      ['Check the month’s bills for anything unusual', 'Settings → Uploads (Check register), then Track → Check register'], ['Compare with similar Iowa districts', 'add the Iowa district number in Settings → District; unusual numbers then show under Money'], ['Find anything', 'Search, at the top of every page'],
    ];
    return `
      <div class="card"><h3>Where to start</h3><ol>${start.map((x) => `<li>${x}</li>`).join('')}</ol>
        <p class="small muted">The menu shows the screens most useful to your role. To see every screen, use Your account → Your menu, or the list at the bottom of Home.</p>
        ${c.admin || c.plan || c.finance ? '<p class="small"><a href="#" data-action="setupShow">Show the “Getting set up” steps on Home</a></p>' : ''}</div>
      <div class="card"><h3>How do I…</h3><table class="data"><tbody>${tasks.map(([q, a]) => `<tr><td>${esc(q)}</td><td class="small">${esc(a)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>What the terms mean</h3><dl class="glossary">${Object.values(TERMS).sort((x, y) => x[0].localeCompare(y[0])).map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
        <p class="small muted">Iowa figures were checked on ${esc(day(HGGF.RULES.checked))}. HighGround is a planning tool; confirm decisions with the district’s auditor, attorney or financial advisor.</p></div>
      <div class="card">${sourcesHtml()}</div>
      <div class="card"><h3>Questions</h3><p>Email <a href="mailto:support@willowholler.com">support@willowholler.com</a>.</p></div>`;
  }
  // ------------------------------------------------------------------ Willow Holler staff
  /** the daily health check's latest result (part 20; filled by the "Daily health check" GitHub workflow) */
  function healthCard(runs) {
    if (runs == null) return '';
    if (!runs.length) return '<div class="card"><h3>System health</h3><p class="muted">No daily check has run yet. It runs every morning from GitHub (Actions → Daily health check), and you can start it there with “Run workflow”.</p></div>';
    const r = runs[0], W = { ok: 'All clear', warn: 'Working, with warnings', fail: 'Something is broken' }, cls = { ok: 'ok', warn: 'warn', fail: 'error' };
    const list = (k) => (r.checks || []).filter((x) => x.status === k);
    const li = (x) => `<li><b>${esc(x.check)}</b> <span class="muted">(${esc(x.area)})</span>${x.detail ? `: ${esc(x.detail)}` : ''}</li>`;
    const stale = Date.now() - new Date(r.ran_at).getTime() > 36 * 3600 * 1000;
    return `<div class="card" data-health><h3>System health</h3>
      <div class="notice ${stale ? 'error' : cls[r.status]}"><b>${stale ? 'The daily check hasn’t run since ' + esc(day(r.ran_at.slice(0, 10))) : W[r.status]}</b>
        ${stale ? ' Check GitHub → Actions → Daily health check.' : ` · checked ${esc(new Date(r.ran_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}: ${r.n_ok} ok, ${r.n_warn} warnings, ${r.n_fail} failed${r.emailed ? ' · emailed' : ''}`}</div>
      ${list('fail').length ? `<h4>Failed</h4><ul>${list('fail').map(li).join('')}</ul>` : ''}
      ${list('warn').length ? fold(null, `${list('warn').length} warning${list('warn').length === 1 ? '' : 's'}`, `<ul>${list('warn').map(li).join('')}</ul>`, false) : ''}
      ${fold(null, `Everything it checks (${(r.checks || []).length})`, `<ul class="small">${(r.checks || []).map((x) => `<li>${esc(x.status.toUpperCase())} · ${esc(x.area)} · ${esc(x.check)}</li>`).join('')}</ul>`, false)}
      <p class="small muted">Last ${runs.length} days: ${runs.slice().reverse().map((x) => `<span class="hdot ${x.status}" title="${esc(x.ran_at.slice(0, 10))}: ${esc(x.status)}"></span>`).join('')}
        · It runs every morning; any failure is emailed to admin@willowholler.com, and a summary goes out every Monday.</p></div>`;
  }
  /* ---- deleting a district (Willow Holler staff only): a confirmation that names what goes, asks for the link id to be typed,
     and offers the backup first. Files are removed from storage, then the district row; everything else goes with it. ---- */
  async function deleteDistrictAsk(id) {
    const d = (S.staffDistricts || []).find((x) => x.id === id); if (!d) return;
    const n = (t) => HG.db.select(t, `select=id&district_id=eq.${d.id}&limit=1001`).then((r) => r.length).catch(() => null);
    const [mem, ini, sc, up] = await Promise.all([HG.db.select('district_member', `select=user_id&district_id=eq.${d.id}`).then((r) => r.length).catch(() => null), n('initiative'), n('scenario'), n('import_batch')]);
    const cnt = (v, one, many) => (v == null ? '' : `<li><b>${v > 1000 ? '1,000+' : v.toLocaleString('en-US')}</b> ${v === 1 ? one : many}</li>`);
    modal(`<form class="stack" data-form="deleteDistrict" data-id="${esc(d.id)}" novalidate>
      <div class="row" style="justify-content:space-between"><h2 id="modal-title">Delete ${esc(d.name)}?</h2><button type="button" class="btn small" data-action="closeModal">Cancel</button></div>
      ${d.is_demo ? '<p>This is a demo district with fictional figures.</p>' : '<div class="notice error"><b>This is a real district, not a demo.</b> Its people lose access straight away, and its public link stops working.</div>'}
      <p>Everything in it is deleted for good, and can’t be undone:</p>
      <ul>${cnt(mem, 'person with access (their accounts stay; they just lose this district)', 'people with access (their accounts stay; they just lose this district)')}${cnt(ini, 'initiative', 'initiatives')}${cnt(sc, 'scenario', 'scenarios')}${cnt(up, 'uploaded file', 'uploaded files')}
        <li>its strategic plan, measures, survey results, starting numbers, reports, published community page and logo</li></ul>
      <p class="small">Want a copy first? <a href="#/d/${enc(d.slug)}/settings/exports">Download its backup</a> (Settings → Exports) before you delete it.</p>
      <label class="field">To confirm, type the district’s link id: <b>${esc(d.slug)}</b><input name="confirm" autocomplete="off" spellcheck="false" data-delete-confirm="${esc(d.slug)}"></label>
      <div data-form-errors class="notice error" hidden></div>
      <div class="row"><button type="submit" class="btn danger" data-delete-go disabled>Delete this district for good</button><button type="button" class="btn" data-action="closeModal">Cancel</button></div>
    </form>`);
    const inp = document.querySelector('[data-delete-confirm]'); if (inp) inp.focus();
  }
  async function deleteDistrict(form) {
    const d = (S.staffDistricts || []).find((x) => x.id === form.dataset.id); if (!d) return;
    const typed = (form.querySelector('[name=confirm]').value || '').trim();
    if (typed !== d.slug) { const b = form.querySelector('[data-form-errors]'); b.hidden = false; b.textContent = `Type ${d.slug} exactly to confirm.`; return; }
    form.querySelector('[data-delete-go]').disabled = true; form.querySelector('[data-delete-go]').textContent = 'Deleting…';
    // its files first, while the district still exists (storage rules look the district up)
    const paths = [].concat(...await Promise.all(['import_batch', 'attachment', 'report_snapshot'].map((t) =>
      HG.db.select(t, `select=storage_path&district_id=eq.${d.id}&storage_path=not.is.null`).then((r) => r.map((x) => x.storage_path)).catch(() => []))));
    for (let i = 0; i < paths.length; i += 100) { try { await HG.storage.remove('district-files', paths.slice(i, i + 100)); } catch (e) { /* a file that's already gone is fine */ } }
    if (d.logo_path) { try { await HG.storage.remove('district-public', [d.logo_path]); } catch (e) { /* fine */ } }
    await HG.db.remove('district', `id=eq.${d.id}`);
    try { if (localStorage.getItem('highground-last-district') === d.slug) localStorage.removeItem('highground-last-district'); } catch (e) {}
    closeModal(); await loadContext(true);
    flash = `${d.name} was deleted.`; renderStaff();
  }
  async function renderStaff() {
    S.district = null; S.role = null;
    const [rows, health] = await Promise.all([HG.db.select('district', 'select=id,slug,name,state,is_demo,public_link_enabled,logo_path,created_at&order=name'),
      HG.db.select('hg_health_run', 'select=ran_at,status,n_ok,n_warn,n_fail,checks,emailed&order=ran_at.desc&limit=14').catch(() => null)]);
    S.staffDistricts = rows;
    frame({ slug: null, sectionId: 'staff', body: `
      <div class="page-head"><div><h1>Willow Holler</h1><div class="lede">Every district, and new ones.</div></div></div>
      ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}
      ${healthCard(health)}
      <div class="card"><h3>Districts</h3>${table([
        { label: 'District', html: (r) => `<a href="#/d/${enc(r.slug)}/home/today">${esc(r.name)}</a>` },
        { label: 'Link id', get: (r) => r.slug }, { label: 'State', get: (r) => r.state },
        { label: 'Demo', get: (r) => (r.is_demo ? 'Demo' : '') }, { label: 'Created', get: (r) => day(r.created_at) },
        { label: '', html: (r) => `<button type="button" class="btn small danger" data-action="deleteDistrictAsk" data-id="${esc(r.id)}">Delete…</button>` },
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
    const lvs = SETUP_PREFILL.data && SETUP_PREFILL.data.levy, vst = val('vppel_status');
    if (lvs && Number(lvs.voted_ppel) > 0 && vst === 'none') warn.push(`The state lists a voter-approved PPEL of $${Number(lvs.voted_ppel).toFixed(3)} per $1,000 for FY${lvs.fiscal_year}, but V-PPEL is set to None. Set it to Active and enter its receipts and years, or the plan leaves that money out.`);
    if (lvs && !(Number(lvs.voted_ppel) > 0) && vst === 'active') warn.push(`V-PPEL is Active, but the state lists no voter-approved PPEL for FY${lvs.fiscal_year}. Check whether the vote has passed or ended.`);
    if (av > 0 && tv > 0 && av < tv) warn.push('Actual (100%) valuation is lower than taxable valuation. Actual valuation is normally the larger figure; check they aren’t swapped.');
    const sr = num('save_receipts'), en = num('enrollment');
    if (sr > 0 && en > 0) {
      const per = sr / en, ratio = per / SAVE_PER_STUDENT.amount;
      if (ratio < 0.8 || ratio > 1.2) warn.push(`SAVE receipts work out to $${Math.round(per).toLocaleString()} per student; SAVE is shared statewide at about $${SAVE_PER_STUDENT.amount.toLocaleString()} per student (FY${SAVE_PER_STUDENT.fy}). Check the receipts and the certified enrollment.`);
    }
    if (sr > 0 && !val('save_receipts_fy')) warn.push('Say which fiscal year the SAVE receipts are for. The SF 2472 reduction is scaled from that year; without it, HighGround assumes the year before the plan starts.');
    if (!form.querySelectorAll('[data-debt-body] [data-debt-row]').length) tip.push('No existing debt entered. If the district has SAVE revenue bonds, PPEL loans or lease-purchases, add them; otherwise the plan overstates what SAVE and PPEL can pay for.');
    const asOf = val('as_of');
    if (asOf && staleStart(asOf)) warn.push(staleStart(asOf));
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
  const SETUP_PREFILL = { data: null };
  function setupPrefill() {
    const st = SETUP_PREFILL.data, form = document.querySelector('form[data-form=saveSetup]'); if (!st || !form) return;
    const gy = document.querySelector('[data-grant-years]'), F = stateFill(st, gy ? Number(gy.value) : 5);
    Object.entries(F.values).forEach(([n, v]) => { const el = form.querySelector(`[name=${n}]`); if (!el || v == null || v === '') return;
      if (n === 'vppel_status') { if (el.value === 'none') el.value = v; return; }
      el.value = v; });
    // debt payments the annual report shows, for funds that don't have a row yet (the final year has to come from the schedule)
    let added = 0;
    F.debts.forEach((x) => {
      const rows = [...form.querySelectorAll('[data-debt-body] [data-debt-row]')];
      if (rows.some((tr) => tr.querySelector('[name=debt_fund]').value === x.fund && (tr.querySelector('[name=debt_name]').value || tr.querySelector('[name=debt_annual]').value))) return;
      let tr = rows.find((t) => !t.querySelector('[name=debt_name]').value && !t.querySelector('[name=debt_annual]').value);
      if (!tr) { const t = document.querySelector('[data-debt-template]'); if (!t) return; form.querySelector('[data-debt-body]').insertAdjacentHTML('beforeend', t.innerHTML); tr = [...form.querySelectorAll('[data-debt-body] [data-debt-row]')].pop(); }
      tr.querySelector('[name=debt_name]').value = x.name; tr.querySelector('[name=debt_fund]').value = x.fund; tr.querySelector('[name=debt_annual]').value = moneyIn(x.annual); added++;
    });
    renderSetupChecks(form);
    toast('Filled in', `Check the numbers, then click Save starting numbers.${added ? ` Add the final year for the debt ${added === 1 ? 'row' : 'rows'} filled in from the annual report.` : ''}`);
  }
  /** the part-19 figures as compare rows: [label, the state's figure, yours, formatter] */
  function stateMoreRows(st, s, grantYears) {
    const M = st.more || {}, V = M.valuation, on = (M.car && M.car.ongoing) || {}, pf = (v) => `${pctIn(v)}%`, rows = [], tr = saveTrend(M), ga = grantsAvg(M, grantYears);
    if (V && V.taxable) rows.push([`Taxable valuation, FY${V.fiscal_year} (with TIF and utilities)`, Number(V.taxable), s.taxable_valuation]);
    if (V && V.actual) rows.push([`Actual (100%) valuation, FY${V.fiscal_year}`, Number(V.actual), s.actual_valuation]);
    if (V && V.growth != null) rows.push([`Taxable valuation growth a year, FY${V.fiscal_year - V.growth_years}–FY${V.fiscal_year}`, Number(V.growth), s.ppel_growth, pf]);
    if (tr) rows.push([`SAVE receipts trend a year, FY${tr.from}–FY${tr.to}`, tr.pct, s.save_trend, pf]);
    if (on.save) rows.push([`Ongoing SAVE spending a year (average FY${on.save.from_fy}–FY${on.save.to_fy}, estimated)`, Math.max(0, Number(on.save.recurring)), s.save_ongoing]);
    if (on.ppel) rows.push([`Ongoing PPEL spending a year (average FY${on.ppel.from_fy}–FY${on.ppel.to_fy}, estimated)`, Math.max(0, Number(on.ppel.recurring)), s.ppel_ongoing]);
    if (ga) rows.push([`Gifts and grants to the capital funds a year (average FY${ga.from}–FY${ga.to})`, ga.avg, s.grants_avg]);
    if (M.home_value && Number(M.home_value.median_value) > 0) rows.push([`Median home value (Census Bureau, ${M.home_value.acs_year - 4}–${M.home_value.acs_year})`, Number(M.home_value.median_value), s.tax_home_value]);
    if (M.construction_inflation && M.construction_inflation.value != null) rows.push(['School construction prices, yearly rise (last three years)', Number(M.construction_inflation.value), s.construction_inflation, pf]);
    if (M.vppel && M.vppel.first_fy) rows.push(['Voter-approved PPEL levied since', M.vppel.from_start_of_data ? `FY${M.vppel.first_fy} or earlier` : `FY${M.vppel.first_fy}`, s.vppel_first_fy ? `FY${s.vppel_first_fy}` : null]);
    const dp = (M.car && M.car.debt_payments) || {}, DN = { save: 'SAVE debt payments', ppel: 'PPEL debt payments', debt: 'Debt service fund payments' };
    Object.entries(dp).forEach(([k, v]) => { if (DN[k] && Number(v) > 0) rows.push([`${DN[k]}, FY${M.car.fiscal_year}`, Number(v), null]); });
    return rows;
  }
  async function vSetup(c) {
    const d = c.district.id;
    const [set, bal, debts] = await Promise.all([
      HG.db.select('district_settings', `select=*&district_id=eq.${d}`),
      HG.db.select('fund_balance', `select=fund,as_of,amount&district_id=eq.${d}&order=as_of.desc`),
      HG.db.select('debt_obligation', `select=*&district_id=eq.${d}&order=final_fy`),
    ]);
    const s = set[0] || {};
    const st = c.finance ? await statePrefill(c.district) : null;
    SETUP_PREFILL.data = st;
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
      ${st ? (() => { const B2 = st.balances || {}, R2 = st.receipts || {}, le = st.latest_enrollment || {}, setUp = !!s.district_id, sp = ppelSplit(st), lv = st.levy;
        const G2 = st.general || {}, gfb = G2.unassigned != null || G2.assigned != null ? Number(G2.unassigned || 0) + Number(G2.assigned || 0) : null, gi = s.gf_inputs || {};
        /* [label, the state's figure, yours (once set up), formatter] */
        const rowsS = [[`Certified enrollment${le.fiscal_year ? `, ${enrollLabel(le.fiscal_year)}` : ''}`, le.certified, s.enrollment, (v) => Number(v).toLocaleString('en-US')],
          [`SAVE balance, June 30, ${st.fiscal_year}`, B2.save, B.save],
          ...(sp.voted != null && B2.ppel != null ? (() => { const sh = Number(lv.voted_ppel) / (Number(lv.regular_ppel) + Number(lv.voted_ppel));
            return [[`PPEL balance, June 30, ${st.fiscal_year}, regular share (estimated)`, Number(B2.ppel) * (1 - sh), B.ppel], [`V-PPEL balance, June 30, ${st.fiscal_year}, voted share (estimated)`, Number(B2.ppel) * sh, B.vppel]]; })()
            : [[`PPEL balance, June 30, ${st.fiscal_year}`, B2.ppel, B.ppel]]), [`SAVE revenue, FY${st.fiscal_year}`, R2.save, s.save_receipts],
          ...(sp.voted != null ? [[`PPEL revenue, FY${st.fiscal_year}, regular share (estimated)`, sp.regular, s.ppel_receipts], [`V-PPEL revenue, FY${st.fiscal_year}, voted share (estimated)`, sp.voted, s.vppel_annual]] : [[`PPEL revenue, FY${st.fiscal_year}`, R2.ppel, s.ppel_receipts]]),
          ...(lv ? [[`PPEL rates, FY${lv.fiscal_year}, per $1,000 of taxable valuation`, `regular $${Number(lv.regular_ppel).toFixed(3)}; ${Number(lv.voted_ppel) > 0 ? `voter-approved $${Number(lv.voted_ppel).toFixed(3)}` : 'no voter-approved PPEL'}`, s.ppel_rate == null ? null : `regular $${Number(s.ppel_rate).toFixed(3)}; V-PPEL ${s.vppel_status || 'none'}`]] : []),
          ...(gfb != null ? [[`General Fund unassigned and assigned balance, June 30, ${st.fiscal_year}`, gfb, gi.fund_balance], ...(G2.aea_flowthrough != null ? [['AEA flowthrough', G2.aea_flowthrough, gi.aea_flowthrough]] : [])] : []),
          ...stateMoreRows(st, s, SETUP_PREFILL.grantYears || 5)]
          .filter(([, v]) => v != null);
        if (!rowsS.length) return '';
        const fmtv = (r, v) => (v == null || v === '' ? '' : typeof v === 'string' ? esc(v) : esc(r[3] ? r[3](v) : money(v)));
        const differs = (r) => typeof r[1] === 'number' && r[2] != null && r[2] !== '' && Math.abs(Number(r[2]) - r[1]) > 0.1 * Math.max(Math.abs(r[1]), 1);
        const nDiff = setUp ? rowsS.filter(differs).length : 0;
        const hasForm = rowsS.some((r) => !/General Fund|AEA/.test(r[0]));
        const M = st.more || {}, gOpts = [3, 5, 10].map((n) => [n, grantsAvg(M, n)]).filter(([, g]) => g);
        const grantPick = gOpts.length && c.finance ? `<label class="row small">Average gifts and grants over <select data-grant-years>${gOpts.map(([n, g]) => `<option value="${n}" ${n === (SETUP_PREFILL.grantYears || 5) ? 'selected' : ''}>${n === 10 && g.years < 10 ? `${g.years} years (all the state has)` : `${n} years`}: $${moneyIn(Math.round(g.avg))}</option>`).join('')}</select></label>` : '';
        const body = `<div class="card" data-setup-state><h3>From the state’s data ${def('sources')}</h3>
          ${stateAge(st.fiscal_year) ? `<p class="small muted" data-state-age>${esc(stateAge(st.fiscal_year))}</p>` : ''}
          ${setUp ? `<div class="scroll"><table class="data"><thead><tr><th></th><th class="num">State</th><th class="num">Yours</th></tr></thead><tbody>${rowsS.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${fmtv(r, r[1])}</td><td class="num ${differs(r) ? 'gaptext' : ''}">${fmtv(r, r[2])}</td></tr>`).join('')}</tbody></table></div>
            <p class="small muted">Highlighted: more than 10% from the state’s figure. The state’s figures are a year behind and include interest, so some difference is normal.</p>`
          : `<ul>${rowsS.map((r) => `<li>${esc(r[0])}: <b>${fmtv(r, r[1])}</b></li>`).join('')}</ul>`}
          ${grantPick}
          <div class="row">${hasForm ? `<button type="button" class="btn" data-action="setupPrefill">${setUp ? 'Replace the form’s figures with the state’s' : 'Fill in the form with these'}</button>` : ''}${gfb != null && setUp ? '<button type="button" class="btn" data-action="gfFromState">Use in the General Fund setup</button>' : ''}<span class="small muted">Nothing is saved until you click Save.</span></div>
          ${lv && Number(lv.voted_ppel) > 0 ? `<p class="small">The state lists a <b>voter-approved PPEL</b> for FY${esc(lv.fiscal_year)}. Filling in sets V-PPEL to Active and splits the annual report’s PPEL revenue between PPEL and V-PPEL by the two rates. Add the vote’s first and last fiscal years from the ballot measure.</p>` : ''}
          <p class="small muted">${esc([st.source, lv && lv.source, M.valuation && M.valuation.source, M.car && M.car.source].filter(Boolean).join('. '))}.
            Ongoing spending is an estimate: the average of the last three years of SAVE or PPEL spending, leaving out construction, debt payments and transfers.</p>
          ${M.home_value ? `<p class="small"><b>${CENSUS_NOTICE}</b></p>` : ''}</div>`;
        return setUp ? fold(c, `Compare with the state’s annual report${nDiff ? ` · ${nDiff} figure${nDiff === 1 ? '' : 's'} differ` : ''}`, body, false) : body; })()
      : c.finance && !c.district.state_district_id ? `<p class="small muted">${c.admin ? `Add the district’s Iowa district number in <a href="#/d/${enc(c.district.slug)}/settings/district">Settings → District</a> to fill these from the state’s annual report.` : 'Once an admin adds the district’s Iowa district number, these can be filled from the state’s annual report.'}</p>` : ''}
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
          <p class="small muted">Used for “what it means for taxpayers.” Farmland is shown per $100,000 of assessed value (the county assessor’s productivity value, which is much lower than the market price).</p><div class="fgrid">
          ${f('tax_home_value', 'Example home value, $', moneyIn(s.tax_home_value == null ? 150000 : s.tax_home_value), 'Assessed value of a typical home in the district')}</div></div>

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
      enrollment: (() => { const x = toNum(v('enrollment')); if (x === null) return null; if (isNaN(x) || x < 0 || x > 100000) { errs.push('Enrollment must be a number from 0 to 100,000.'); return null; } return Math.round(x); })(),   /* the state certifies tenths (1188.4); store whole pupils */
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
    await persistSetup(r, true);
    toast('Starting numbers saved', 'The capital plan now uses them.');
    here();
  }
  /** save starting numbers; withDebts = the debt rows on the form are the whole list (the wizard leaves debt to the full screen) */
  async function persistSetup(r, withDebts) {
    const d = S.district.id;
    // the guided setup shows only some fields: leave the rest as they are rather than blanking them
    const settings = withDebts ? r.settings : Object.fromEntries(Object.entries(r.settings).filter(([, v]) => v != null));
    await HG.db.upsert('district_settings', [Object.assign({ district_id: d }, settings)], 'district_id');
    await HG.db.upsert('fund_balance', r.balances.map((b) => ({ district_id: d, fund: b.fund, as_of: r.asOf, amount: b.amount || 0, source: 'manual' })), 'district_id,fund,as_of');
    if (!withDebts) { for (const x of r.debts) await HG.db.insert('debt_obligation', Object.assign({ district_id: d }, { name: x.name, fund: x.fund, annual_payment: x.annual_payment, final_fy: x.final_fy })); return; }
    const existing = await HG.db.select('debt_obligation', `select=id&district_id=eq.${d}`);
    const keep = new Set(r.debts.filter((x) => x.id).map((x) => x.id));
    for (const x of existing) if (!keep.has(x.id)) await HG.db.remove('debt_obligation', `id=eq.${enc(x.id)}`);
    for (const x of r.debts) {
      const row = { name: x.name, fund: x.fund, annual_payment: x.annual_payment, final_fy: x.final_fy };
      if (x.id) await HG.db.update('debt_obligation', `id=eq.${enc(x.id)}`, row);
      else await HG.db.insert('debt_obligation', Object.assign({ district_id: d }, row));
    }
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
        phases: p.phases.map((ph) => ({ cost: ph.cost, year: ph.year, funding: ph.funding, options: ph.options, status: ph.status, actual: ph.actual, label: ph.label })) })),
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
    go(`#/d/${enc(d.slug)}/money/capital`);
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
    CAP.pub = true; CAP.key = null; CAP.editable = false; CAP.sc = null; CAP.filter = {}; CAP.view = 'cards'; CAP.out = new Set();
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
      <main class="auth-main"><div class="auth-card"><div class="auth-mobile-brand">${LOGO_COLOR}</div>${inner}</div></main></div>`;
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
    async gfRosterTemplate() { saveTemplate('highground-staff-list-template.xlsx', HGGF.ROSTER_TEMPLATE, 'Staff', 'staff'); },
    async gfReset() { GF.over = {}; here(); },
    async gfPrefill() {
      const P = GF.prefill || {}, form = document.querySelector('form[data-form=saveGf], form[data-form=wizGf]'); if (!form) return;
      const done = [];
      const set = (n, v, kind, label) => { const el = form.querySelector(`[name=${n}]`); if (!el || v == null || isNaN(Number(v))) return;
        el.value = kind === 'pct' ? pctIn(v) : kind === 'raw' ? v : Number(Math.round(v)).toLocaleString('en-US'); if (label) done.push(label); };
      set('enrollment', P.enrollment, 'raw', 'enrollment'); set('dcpp', P.dcpp, null, 'cost per pupil'); set('other_formula', P.other_formula, null, 'other formula funding');
      set('misc_income', P.misc_income, null, 'miscellaneous income'); set('misc_growth', P.misc_growth, 'pct');
      set('aea_flowthrough', P.aea_flowthrough, null, 'AEA flowthrough'); set('fund_balance', P.fund_balance, null, 'fund balance'); set('unspent', P.unspent, null, 'unspent balance');
      set('nonstaff', P.nonstaff, null, 'other spending');
      // the annual report's benefits include health insurance: use its % only where health per FTE is blank, so health isn't counted twice
      let kept = 0;
      if (P.benefits != null) {
        form.querySelectorAll('[data-gf-staff]').forEach((tr) => { const h = toNum(tr.querySelector('[name=s_health]').value); if (h) { kept++; return; } tr.querySelector('[name=s_benefits]').value = pctIn(P.benefits); });
        if (kept < form.querySelectorAll('[data-gf-staff]').length) done.push('benefits % (including health) where health per FTE is blank');
      }
      toast('Filled in', `${done.join(', ')}. Check them, then Save.${kept ? ` Groups with health per FTE keep their benefits % (FICA and IPERS, about 17.09%): the state’s ${pctIn(P.benefits)}% already includes health insurance, so it would be counted twice.` : ''}`);
    },
    async setupPrefill() { setupPrefill(); },
    async setupGo(el) { const st = (SETUP.steps || []).find((x) => x.k === el.dataset.k); if (!st) return; SETUP.step = st.k; go(`#/d/${enc(S.district.slug)}/${st.path}`); },
    async setupBack() { SETUP.step = null; go(`#/d/${enc(S.district.slug)}/home/today`); },
    async wizSkip() { go(WIZ.next); },
    async setupHide() { try { localStorage.setItem('highground-setup-hidden-' + S.district.id, '1'); } catch (e) {} toast('Setup steps hidden', 'Show them again from Help → Guide.'); here(); },
    async setupShow() { try { localStorage.removeItem('highground-setup-hidden-' + S.district.id); } catch (e) {} go(`#/d/${enc(S.district.slug)}/home/today`); },
    async peerDetail(el) {
      const P = PEERS.data; if (!P) return;
      modal(`<div class="row" style="justify-content:flex-end"><button type="button" class="btn small" data-action="closeModal">Close</button></div>${HGPeers.detailHtml(P.rows, el.dataset.key, P)}`);
    },
    async gfFromState() { GF.autoPrefill = true; go(`#/d/${enc(S.district.slug)}/money/general`); },
    async regAnswer(el) {
      const box = el.closest('[data-reg-flag]'), resp = (box.querySelector('[name=response]') || {}).value || '';
      if (el.dataset.status === 'explained' && !resp.trim()) throw new UserError('Write the answer first, or choose “Not a concern”.');
      await HG.db.update('register_flag', `id=eq.${enc(el.dataset.id)}`, { status: el.dataset.status, response: resp.trim() || null, resolved_by: S.user.id, resolved_at: new Date().toISOString() });
      toast(el.dataset.status === 'explained' ? 'Answer saved' : 'Marked as not a concern'); here();
    },
    async regVendorOk(el) {
      await HG.db.upsert('vendor_note', [{ district_id: S.district.id, vendor_key: el.dataset.key, expected: true }], 'district_id,vendor_key');
      toast('Vendor marked as expected', 'It won’t be asked about as new again.');
    },
    async regThreshold() {
      const raw = (document.querySelector('[data-reg-threshold]') || {}).value, v = toNum(raw), d = S.district.id;
      if (v !== null && (isNaN(v) || v <= 0)) throw new UserError('Enter the threshold in dollars, or leave it blank.');
      for (const rule of ['near_threshold', 'split_purchase']) {
        const mine = (REG.rules || []).find((r) => r.district_id === d && r.rule === rule), base = (REG.rules || []).find((r) => r.district_id == null && r.rule === rule) || { params: {} };
        const params = Object.assign({}, base.params, mine ? mine.params : {}, { threshold: v });
        if (mine) await HG.db.update('register_rule', `id=eq.${mine.id}`, { params });
        else await HG.db.insert('register_rule', { district_id: d, rule, enabled: true, params });
      }
      await HG.db.rpc('register_check_all', { p_district: d });
      toast('Saved', v ? `Bid threshold ${money(v)}. Every month re-checked.` : 'Threshold checks off. Every month re-checked.'); here();
    },
    async iaSearch() {
      const q = (document.querySelector('[data-ia-q]') || {}).value || '', box = document.querySelector('[data-ia-results]');
      if (q.trim().length < 2) throw new UserError('Type at least two letters of the district’s name.');
      const hits = await HG.db.rpc('ia_district_search', { q: q.trim() });
      box.innerHTML = hits && hits.length ? `<div class="stack" style="gap:6px">${hits.slice(0, 8).map((h) => `<div class="row"><button type="button" class="btn small" data-action="iaPick" data-de="${esc(h.de_district)}" data-name="${esc(h.name)}">Use ${esc(h.de_district)}</button> ${esc(h.name)}${h.aea ? ` <span class="small muted">AEA ${esc(h.aea)}</span>` : ''}${h.last_fy ? ` <span class="small muted">· state data to FY${esc(h.last_fy)}</span>` : ''}</div>`).join('')}</div>`
        : '<p class="small muted">No Iowa district found by that name. Try part of the name, without “Community School District”.</p>';
    },
    async iaPick(el) {
      const form = el.closest('form'); form.querySelector('[name=state_district_id]').value = el.dataset.de;
      form.querySelector('[data-ia-linked]').textContent = `${el.dataset.name}. Click Save changes to link it.`;
      form.querySelector('[data-ia-results]').innerHTML = '';
    },
    async openSearch() { await openSearch(); },
    async openHelp() { openHelp(); },
    async toggleMenu(el) { const rail = document.querySelector('.rail'), open = !rail.classList.contains('open'); rail.classList.toggle('open', open); el.setAttribute('aria-expanded', String(open)); },
    async toggleRail() { toggleRail(); },
    async startPresent() { await startPresent(); },
    async deleteDistrictAsk(el) { await deleteDistrictAsk(el.dataset.id); },
    async stopPresent() { stopPresent(); },
    async userMenu(el) { const m = el.parentElement.querySelector('.umenu'), open = m.hidden; m.hidden = !open; el.setAttribute('aria-expanded', String(open)); hideFly(true); },
    async togglePreview() {
      S.preview = !S.preview && canPreview();
      toast(S.preview ? 'Previewing as a board member' : 'Back to your view', S.preview ? 'You see what board members see. Nothing about your access has changed.' : '');
      const parts = location.hash.replace(/^#\/?/, '').split('/');
      go(S.preview && parts[0] === 'd' ? `#/d/${enc(parts[1])}/${homePath('board')}` : location.hash);
    },
    async define(el) { const t = TERMS[el.dataset.term]; if (t) toast(t[0], t[1], 'term', { sticky: true, key: 'term' }); },
    async searchGo(el) {
      const k = el.dataset.k, id = el.dataset.id, slug = S.district.slug; closeModal();
      if (k === 'initiative') { INI.key = S.district.id; go(`#/d/${enc(slug)}/plan/initiatives`); setTimeout(() => openDecisionEditor(id), 600); }
      else if (k === 'scenario') { CAP.key = S.district.id; CAP.scenarioId = id; go(`#/d/${enc(slug)}/money/capital`); }
      else if (k === 'report') { RP.key = S.district.id; RP.open = id; go(`#/d/${enc(slug)}/share/board`); }
      else if (k === 'priority') go(`#/d/${enc(slug)}/plan/priorities`);
      else if (k === 'measure') go(`#/d/${enc(slug)}/track/measures`);
      else if (k === 'screen') go(`#/d/${enc(slug)}/${id}`);
    },
    async editSurvey(el) { if (!DIR.D) DIR.D = await loadDirection(S.district); openSurveyEditor(el.dataset.id || null); },
    async deleteSurvey(el) { if (!confirm('Delete this survey and its results?')) return; await HG.db.remove('survey', `id=eq.${enc(el.dataset.id)}`); closeModal(); toast('Deleted'); here(); },
    async dirTemplate(el) { saveTemplate(`highground-${el.dataset.k}-template.xlsx`, DIR_TEMPLATES[el.dataset.k], el.dataset.k[0].toUpperCase() + el.dataset.k.slice(1), el.dataset.k); },
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
    async planView(el) { PL.view = el.dataset.v; here(); },
    async planBack() { PL.open = null; here(); },
    async planOpen(el) { PL.open = el.dataset.id; here(); },
    async planXlsx() {
      const L = PL.last; if (!L) return;
      const name = PL.view === 'full' ? L.extra.planName : L.plan.viewName;
      saveXlsx(`${S.district.slug}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${L.plan.start}.xlsx`, HGPlan.sheet(L.plan), 'Plan');
    },
    async planSave() {
      const L = PL.last; if (!L) return;
      const name = PL.view === 'full' ? L.extra.planName : L.plan.viewName;
      const title = `${name}, FY${L.plan.start}–FY${L.plan.last}, ${L.plan.items === 'approved' ? 'approved items only' : 'all items'}`;
      try {
        await HG.db.insert('report_snapshot', { district_id: S.district.id, kind: 'improvement_plan', title, scenario_id: L.plan.board ? L.plan.board.id : null, payload: { v: 1, opts: { view: PL.view, items: PL.items, years: PL.years }, plan: L.plan, extra: L.extra } });
      } catch (e) {
        if (/check constraint|violates/i.test(e.message || '')) throw new UserError('Saving plan versions needs database update 21 (21_improvement_plan.sql). Run it in Supabase, then try again.');
        throw e;
      }
      toast('Saved', title); here();
    },
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
    async capOutClear() { CAP.out = new Set(); capRefresh(); },
    async capOutSave() {
      const out = [...(CAP.out || [])]; if (!out.length) return;
      const names = CAP.inputs.projects.filter((p) => out.includes(String(p.id))).map((p) => p.name);
      const name = (prompt('Name the new scenario', `${CAP.sc.name} without ${names.length === 1 ? names[0] : names.length + ' projects'}`) || '').trim(); if (!name) return;
      const res = await HG.db.rpc('copy_scenario', { p_source: CAP.sc.id, p_name: name.slice(0, 80) });
      const sid = typeof res === 'string' ? res : res && res.copy_scenario;
      if (!sid) throw new UserError('The copy wasn’t made. Try again.');
      for (const iid of out) {
        await HG.db.removeAll('phase', `scenario_id=eq.${sid}&initiative_id=eq.${enc(iid)}`);
        await HG.db.removeAll('recurring_cost', `scenario_id=eq.${sid}&initiative_id=eq.${enc(iid)}`);
        await HG.db.removeAll('scenario_initiative', `scenario_id=eq.${sid}&initiative_id=eq.${enc(iid)}`);
      }
      CAP.key = S.district.id; CAP.scenarioId = sid; toast('Saved', `“${name}” is a new scenario without ${names.join(', ')}. The original is unchanged.`); here();
    },
    async openScenario(el) { CAP.key = S.district.id; CAP.scenarioId = el.dataset.id; go(`#/d/${enc(S.district.slug)}/money/capital`); },
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
    async rankView(el) { RK.view = el.dataset.v; here(); },
    async goalFind() {
      const id = document.querySelector('[data-goal-id]').value, fy = document.querySelector('[data-goal-fy]').value; RK.goalId = id;
      RK.goal = HGSuggest.goalSeek(HGCapital.buildInputs(RK.rows, RK.sid), RK.k.items, RK.rows.initiatives, id, fy ? Number(fy) : null);
      document.getElementById('goal-results').innerHTML = goalHtml(RK.goal, RK.k);
    },
    async goalApply(el) {
      const g = RK.goal, o = g && g.options[Number(el.dataset.i)], sc = RK.rows.scenarios.find((x) => x.id === RK.sid), t = RK.k.items.find((x) => String(x.id) === String(RK.goalId));
      if (!o || !sc || !t) return;
      const name = (prompt('Name the new scenario', `${sc.name}, funding ${t.name}`) || '').trim(); if (!name) return;
      const res = await HG.db.rpc('copy_scenario', { p_source: sc.id, p_name: name.slice(0, 80) });
      const sid = typeof res === 'string' ? res : res && res.copy_scenario;
      if (!sid) throw new UserError('The copy wasn’t made. Try again.');
      const movePhases = async (iid, mvs) => { for (const m of mvs) await HG.db.update('phase', `scenario_id=eq.${sid}&initiative_id=eq.${enc(iid)}&fy=eq.${m.fy}&status=not.in.(done,underway)`, { fy: m.toFy }); };
      if (g.pulledForward) {   // the target itself has to finish earlier
        const last = Math.max(...t.years), d = g.byFY - last;
        await movePhases(String(t.id), t.years.slice().sort((a, b) => a - b).map((fy) => ({ fy, toFy: fy + d })));
      }
      if (o.kind === 'rank') await HG.db.upsert('scenario_initiative', o.order.map((id, n) => ({ scenario_id: sid, initiative_id: id, district_id: S.district.id, rank: n + 1, included: true })), 'scenario_id,initiative_id');
      else for (const m of o.moves) await movePhases(m.id, (m.delta > 0 ? HGSuggest.moves(m).slice().reverse() : HGSuggest.moves(m)));
      RK.sid = sid; RK.goal = null; toast('Scenario made', `“${name}” funds ${t.name}. The original is unchanged.`); here();
    },
    async rankSchedule() {
      const S = RK.sched, sc = RK.rows.scenarios.find((x) => x.id === RK.sid); if (!S || !S.moves.length || !sc) return;
      const name = (prompt('Name the new scenario', `${sc.name}, year by year`) || '').trim(); if (!name) return;
      const res = await HG.db.rpc('copy_scenario', { p_source: sc.id, p_name: name.slice(0, 80) });
      const sid = typeof res === 'string' ? res : res && res.copy_scenario;
      if (!sid) throw new UserError('The copy wasn’t made. Try again.');
      // all moves go later: latest first, so a phase never lands on a year another phase still has to leave
      for (const m of S.moves.slice().sort((a, b) => b.fromFY - a.fromFY)) await HG.db.update('phase', `scenario_id=eq.${sid}&initiative_id=eq.${enc(m.id)}&fy=eq.${m.fromFY}&status=not.in.(done,underway)`, { fy: m.toFY });
      RK.sid = sid; toast('Scenario made', `“${name}”: ${new Set(S.moves.map((m) => m.id)).size} initiative(s) moved to the year they can be paid for.`); here();
    },
    async rankFromTiers() {
      if (!confirm('Reorder the whole list by priority (must-have, strategic, nice to have), keeping the current order within each? You can then move items across priorities.')) return;
      const T = HGRanking.TIERS, order = RK.k.items.slice().sort((a, b) => (T.indexOf(a.tier) - T.indexOf(b.tier)) || (a.position - b.position)).map((x) => x.id);
      await rankSave(order);
    },
    async rankSuggest(el) {
      const g = (RK.sugg || []).find((x) => x.id === el.dataset.id), sc = RK.rows.scenarios.find((x) => x.id === RK.sid); if (!g || !sc) return;
      const name = (prompt('Name the new scenario', `${sc.name}, ${g.name} to FY${g.to[0]}`) || '').trim(); if (!name) return;
      const res = await HG.db.rpc('copy_scenario', { p_source: sc.id, p_name: name.slice(0, 80) });
      const sid = typeof res === 'string' ? res : res && res.copy_scenario;
      if (!sid) throw new UserError('The copy wasn’t made. Try again.');
      // move this initiative's phases that haven't started, each by the same number of years
      const order = g.delta > 0 ? HGSuggest.moves(g).slice().reverse() : HGSuggest.moves(g);
      for (const m of order) await HG.db.update('phase', `scenario_id=eq.${sid}&initiative_id=eq.${enc(g.id)}&fy=eq.${m.fy}&status=not.in.(done,underway)`, { fy: m.toFy });
      RK.sid = sid; toast('Scenario made', `“${name}”: ${g.name} moved ${g.delta > 0 ? 'later' : 'earlier'} by ${Math.abs(g.delta)} year${Math.abs(g.delta) === 1 ? '' : 's'}. The original is unchanged.`); here();
    },
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
      closeModal(); go(`#/d/${enc(S.district.slug)}/money/capital`);
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
      if (el.dataset.kind === 'projects') saveTemplate('highground-projects-template.xlsx', HGUploads.parseCSV(HGUploads.projectTemplate(UP.startFY || 2027)), 'Projects', 'projects');
      else if (el.dataset.kind === 'gl') saveText('highground-sample-gl-export-2026-09-30.csv', HGUploads.toCSV(HGGL.sampleExport()));
      else saveTemplate('highground-balances-template.xlsx', HGUploads.parseCSV(HGUploads.balanceTemplate()), 'Balances', 'balances');
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
    async deleteDistrict(f, form) { await deleteDistrict(form); },
    async saveGf(f, form) { await saveGf(f, form); },
    async saveSurvey(f, form) { await saveSurvey(f, form); },
    async savePriority(f, form) { await savePriority(f, form); },
    async savePlanName(f) {
      try { await HG.db.update('district_settings', `district_id=eq.${S.district.id}`, { plan_name: String(f.plan_name || '').trim().slice(0, 80) || null }); }
      catch (e) { if (/plan_name|column/i.test(e.message || '')) throw new UserError('Naming the plan needs database update 21 (21_improvement_plan.sql). Run it in Supabase, then try again.'); throw e; }
      toast('Saved', 'The plan’s name.'); here();
    },
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
    async wizNumber(f) {
      const t = String(f.state_district_id || '').trim();
      if (t) {
        if (!/^\d{1,4}$/.test(t)) throw new UserError('The Iowa district number is up to 4 digits, like 0009.');
        const de = t.padStart(4, '0');
        const hit = await HG.db.select('ia_district', `select=de_district&de_district=eq.${de}`).catch(() => []);
        if (!hit.length) throw new UserError(`No Iowa district numbered ${de} in the state data. Use Find to look it up by name.`);
        await HG.db.update('district', `id=eq.${S.district.id}`, { state_district_id: de });
        await loadContext(true);
      }
      go(WIZ.next);
    },
    async wizStart(f, form) {
      const box = form.querySelector('[data-setup-errors]'), r = readSetup(form);
      if (r.errs.length) { box.hidden = false; box.innerHTML = r.errs.map(esc).join('<br>'); box.scrollIntoView({ block: 'center' }); return; }
      // save only what this step shows (or carries hidden): the rest of Starting numbers keeps its values
      r.settings = Object.fromEntries(Object.entries(r.settings).filter(([k]) => k === 'plan_start_fy' || form.querySelector(`[name="${k}"]`)));
      await persistSetup(r, false);
      toast('Starting numbers saved'); go(WIZ.next);
    },
    async wizGf(f, form) { if (await saveGf(f, form)) { toast('General Fund figures saved'); go(WIZ.next); } },
    async saveDistrict(f) {
      let de;
      if (f.state_district_id !== undefined) {
        const t = String(f.state_district_id).trim();
        if (!t) de = null;
        else {
          if (!/^\d{1,4}$/.test(t)) throw new UserError('The Iowa district number is up to 4 digits, like 0009.');
          de = t.padStart(4, '0');
          if (de !== S.district.state_district_id) {
            const hit = await HG.db.select('ia_district', `select=de_district&de_district=eq.${de}`).catch(() => []);
            if (!hit.length) throw new UserError(`No Iowa district numbered ${de} in the state data. Use “Find” to look it up by name.`);
          }
        }
      }
      await HG.db.update('district', `id=eq.${S.district.id}`, {
        ...(de !== undefined ? { state_district_id: de } : {}),
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
    const dc = e.target.closest('[data-delete-confirm]');
    if (dc) { const b = dc.closest('form').querySelector('[data-delete-go]'); if (b) b.disabled = dc.value.trim() !== dc.dataset.deleteConfirm; }
    const sw2 = e.target.closest('[data-stale-watch]');
    if (sw2) { const h = sw2.parentElement.querySelector('[data-stale-start]'); if (h) h.textContent = staleStart(sw2.value); }
    const pc = e.target.closest('[data-srcs] [name=pct]');
    if (pc) {   // with two funds, the other one makes up the rest
      const rows = [...pc.closest('[data-srcs]').querySelectorAll('[name=pct]')], v = toNum(pc.value);
      if (rows.length === 2 && v !== null && !isNaN(v) && v >= 0 && v <= 100) rows.find((x) => x !== pc).value = +(100 - v).toFixed(2);
    }
    const lv = e.target.closest('input[type=range][data-lever]');
    if (lv && CAP.inputs) { CAP.levers[lv.dataset.lever] = Number(lv.value); capRefresh(); }
  });
  document.addEventListener('change', (e) => {
    const fmo = e.target.closest('select[name=fmode]');
    if (fmo) { const cell = fmo.parentElement.querySelector('[data-srcs]'); cell.classList.toggle('either', fmo.value === 'either'); if (fmo.value === 'split') rebalanceFunds(cell); return; }
    const co = e.target.closest('[data-cap-out]');
    if (co && CAP.inputs) { CAP.out = CAP.out || new Set(); if (co.checked) CAP.out.add(co.dataset.capOut); else CAP.out.delete(co.dataset.capOut); capRefresh(); return; }
    const lc = e.target.closest('input[type=checkbox][data-lever]');
    if (lc && CAP.inputs) { CAP.levers[lc.dataset.lever] = lc.checked; capRefresh(); return; }
    if (e.target.closest('[data-upload-file]') || (e.target.closest('[data-upload-kind]') && document.querySelector('[data-upload-file]').files.length)) { run(readUpload); return; }
    const lm = e.target.closest('[data-logo-mode]');
    if (lm) { run(async () => { await HG.db.update('district', `id=eq.${S.district.id}`, { menu_logo_only: lm.value === 'logo' }); await loadContext(true); toast('Saved', lm.value === 'logo' ? 'The menu shows the logo.' : 'The menu shows the initials and name.'); here(); }, lm); return; }
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
    const gr = e.target.closest('[data-gf-roster]');
    if (gr) { run(() => gfRoster(gr), gr); return; }
    const du = e.target.closest('[data-dir-upload]');
    if (du) { run(() => dirUploadRead(du), du); return; }
    const srl = e.target.closest('[data-sr-link]');
    if (srl) { run(async () => { await HG.db.update('survey_result', `id=eq.${enc(srl.dataset.srLink)}`, { [srl.dataset.f]: srl.value || null }); toast('Linked'); }, srl); return; }
    const ma = e.target.closest('[data-me-auto]');
    if (ma && ma.value) { const a = HGDirection.AUTO[ma.value], fm = ma.closest('form'), set = (n, v) => { const el = fm.querySelector(`[name=${n}]`); if (el && !el.value) el.value = v; };
      set('name', a.name); set('unit', a.unit); fm.querySelector('[name=better]').value = a.better; fm.querySelector('[name=cadence]').value = a.cadence; return; }
    const gyr = e.target.closest('[data-grant-years]');
    if (gyr) { SETUP_PREFILL.grantYears = Number(gyr.value); return; }
    const sa = e.target.closest('[data-show-all]');
    if (sa) { try { localStorage.setItem(showAllKey(), sa.checked ? '1' : '0'); } catch (x) {} toast(sa.checked ? 'Every screen shown' : 'Menu for your role', 'The menu has changed.'); return here(); }
    const pli = e.target.closest('[data-plan-items]');
    if (pli) { PL.items = pli.value; return here(); }
    const ply = e.target.closest('[data-plan-years]');
    if (ply) { PL.years = Number(ply.value); return here(); }
    const gsc = e.target.closest('[data-gf-sc]');
    if (gsc) { GF.sid = gsc.value; GF.over = {}; return here(); }
    const mp = e.target.closest('[data-me-prio]');
    if (mp) { const sel = mp.closest('form').querySelector('[name=outcome_id]'); sel.innerHTML = '<option value="">None</option>' + DIR.D.outcomes.filter((o) => o.priority_id === mp.value).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join(''); return; }
    const ph2 = e.target.closest('[data-pub-hold]');
    if (ph2) { CP.holdBack = ph2.checked; CP.note = (document.querySelector('[data-pub-note]') || {}).value; here(); return; }
    const psv = e.target.closest('[data-pub-survey]');
    if (psv) { CP.survey = psv.checked; CP.note = (document.querySelector('[data-pub-note]') || {}).value; here(); return; }
    const rt2 = e.target.closest('[data-rank-to]');
    if (rt2) { run(() => rankTo(rt2), rt2); return; }
    const rb = e.target.closest('[data-rank-by]');
    if (rb) { RK.by = rb.value; return here(); }
    const rs2 = e.target.closest('[data-rank-sid]');
    if (rs2) { RK.sid = rs2.value; return here(); }
    const rt = e.target.closest('[data-rank-tier]');
    if (rt) { run(async () => { await HG.db.update('initiative', `id=eq.${enc(rt.dataset.rankTier)}`, { tier: rt.value || null, engine_priority: ({ must: 'High', strategic: 'Med', nice: 'Low' })[rt.value] || null }); here(); }, rt); return; }
    const es = e.target.closest('[data-ed-scenario]');
    if (es) { ED.sid = es.value || null; const f = es.closest('form'); f.querySelector('[data-cost-section]').innerHTML = costSectionHtml(f.dataset.id || null); return; }
    const rc = e.target.closest('[data-reg-col]');
    if (rc) { const cols = Object.assign({}, UP.reg.cols); if (rc.value === '') delete cols[rc.dataset.regCol]; else cols[rc.dataset.regCol] = Number(rc.value); UP.regCols = cols; regParse(); document.getElementById('upload-review').innerHTML = reviewHtml(); return; }
    const rm = e.target.closest('[data-reg-month]');
    if (rm) { REG.batch = rm.value; return here(); }
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
    const ts = e.target.closest('[data-top-scenario]');
    if (ts) { CAP.scenarioId = ts.value; return here(); }
    const cs = e.target.closest('[data-cap-scenario]');
    if (cs) { CAP.scenarioId = cs.value; return here(); }
    const sw = e.target.closest('[data-switch]');
    if (sw && sw.value) {
      const parts = location.hash.replace(/^#\/?/, '').split('/');
      const tail = parts[0] === 'd' ? parts.slice(2).join('/') : 'home/today';
      return go(`#/d/${enc(sw.value)}/${tail || 'home/today'}`);
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
