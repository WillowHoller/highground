/* HighGround — talks to Supabase directly (no library).
   Auth: email + password. Data: the REST API, protected by the database's access rules.
   Only the PUBLISHABLE key is used here. The secret key never belongs in the browser. */
(function () {
  const HG = (window.HG = window.HG || {});

  class NotBuiltError extends Error {
    constructor(feature, phase) {
      super(`${feature} isn't built yet${phase ? ` (planned for Phase ${phase})` : ''}.`);
      this.name = 'NotBuiltError'; this.feature = feature; this.phase = phase;
    }
  }
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
  }
  HG.NotBuiltError = NotBuiltError;
  HG.ApiError = ApiError;
  /** Call from any feature that doesn't exist yet. It throws; the app shows the message. */
  HG.notBuilt = (feature, phase) => { throw new NotBuiltError(feature, phase); };

  const cfg = window.HG_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = String(cfg.publishableKey || '');
  HG.configured = /^https:\/\/.+/.test(BASE) && KEY.length > 20 && !/YOUR[-_]/i.test(BASE + KEY);
  HG.supabaseUrl = BASE;
  HG.appUrl = () => location.origin + location.pathname;

  const SESSION_KEY = 'highground-session';
  const load = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } };
  const save = (s) => { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) {} };
  let session = load();

  const toSession = (d) => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Number(d.expires_at) || Math.floor(Date.now() / 1000) + (Number(d.expires_in) || 3600),
    user: d.user || null,
  });

  function friendly(msg, code) {
    const m = String(msg || '');
    if (code === '42501' || /row-level security|permission denied/i.test(m)) return "You don't have permission to do that in this district.";
    if (/invalid login credentials/i.test(m)) return "That email and password don't match an account.";
    if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you, then sign in.';
    if (/already registered|already exists/i.test(m) && !code) return 'An account with that email already exists. Sign in, or reset your password.';
    if (code === '23505') return 'That already exists.';
    if (/at least one character of each|password is known to be weak|weak password/i.test(m)) return 'That password is too weak. Use at least 8 characters, with a lowercase letter, a capital, a number and a symbol.';
    if (/pwned|leaked|breach/i.test(m)) return 'That password has appeared in a data breach. Choose a different one.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
    return m;
  }

  let refreshing = null;
  async function ensureFresh() {
    if (!session || session.expires_at - 60 > Date.now() / 1000) return;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const d = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
          session = { ...toSession(d), user: d.user || session.user };
          save(session);
        } catch (e) {
          session = null; save(null);
          if (HG.onSignedOut) HG.onSignedOut('Your session ended. Sign in again.');
        } finally { refreshing = null; }
      })();
    }
    await refreshing;
  }

  async function call(path, { method = 'GET', body, auth = true, headers = {}, raw = false, blob = false } = {}) {
    if (!HG.configured) {
      throw new ApiError('HighGround is not connected to a database yet. Add the Supabase address and publishable key to config.js.', 0, 'not_configured');
    }
    const h = { apikey: KEY, 'Content-Type': 'application/json', ...headers };
    if (auth && session) { await ensureFresh(); if (session) h.Authorization = 'Bearer ' + session.access_token; }
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(`Can't reach the database at ${BASE}. Check your connection. If it keeps happening, the Supabase project may be paused.`, 0, 'network');
    }
    if (blob && res.ok) return res.blob();
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`;
      const code = data && (data.code || data.error_code);
      throw new ApiError(friendly(msg, code), res.status, code);
    }
    return data;
  }

  HG.auth = {
    get session() { return session; },
    get user() { return session && session.user; },
    async signIn(email, password) {
      const d = await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
      session = toSession(d); save(session); return session;
    },
    /** Returns true if the account is ready now; false if an email confirmation is needed first. */
    async signUp(email, password, fullName) {
      const d = await call('/auth/v1/signup?redirect_to=' + encodeURIComponent(HG.appUrl()),
        { method: 'POST', auth: false, body: { email, password, data: { full_name: fullName || null } } });
      if (d && d.access_token) { session = toSession(d); save(session); return true; }
      return false;
    },
    async sendReset(email) {
      await call('/auth/v1/recover?redirect_to=' + encodeURIComponent(HG.appUrl()), { method: 'POST', auth: false, body: { email } });
    },
    async setPassword(password) {
      const u = await call('/auth/v1/user', { method: 'PUT', body: { password } });
      session.user = u; save(session); return u;
    },
    async currentUser() {
      const u = await call('/auth/v1/user');
      session.user = u; save(session); return u;
    },
    async signOut() {
      try { if (session) await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* signing out locally is enough */ }
      session = null; save(null);
    },
    /** Handles the link in a confirmation or password-reset email (#access_token=…&type=…). */
    async fromLink(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      if (p.get('error_description') || p.get('error')) return { error: (p.get('error_description') || p.get('error')).replace(/\+/g, ' ') };
      if (!p.get('access_token')) return null;
      session = toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
                            expires_in: p.get('expires_in'), expires_at: p.get('expires_at') });
      save(session);
      await HG.auth.currentUser();
      return { type: p.get('type') || '' };
    },
  };

  const qs = (q) => (q ? '?' + q : '');
  const changed = (rows, what) => {
    if (Array.isArray(rows) && rows.length === 0) {
      throw new ApiError(`Nothing was ${what}. You may not have permission, or the item no longer exists.`, 403, '42501');
    }
    return rows;
  };
  const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  /** Private file storage (bucket district-files). Access rules: district members read; planners and finance staff add. */
  HG.storage = {
    upload: (bucket, path, file) => call(`/storage/v1/object/${bucket}/${encPath(path)}`,
      { method: 'POST', body: file, raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' } }),
    download: (bucket, path) => call(`/storage/v1/object/authenticated/${bucket}/${encPath(path)}`, { blob: true }),
  };
  HG.db = {
    select: (table, query) => call(`/rest/v1/${table}${qs(query)}`),
    insert: (table, row) => call(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }),
    update: async (table, filter, patch) => changed(await call(`/rest/v1/${table}?${filter}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } }), 'changed'),
    remove: async (table, filter) => changed(await call(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }), 'removed'),
    /** Insert, or update the existing row with the same key columns (e.g. 'district_id' or 'district_id,fund,as_of'). */
    upsert: (table, rows, onConflict) => call(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }),
    rpc: (fn, args = {}, opts = {}) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, auth: opts.auth !== false }),
  };
})();
