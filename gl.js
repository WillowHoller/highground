/* HighGround — reading a month-end general-ledger export (Iowa Uniform Financial Accounting).
   Iowa account codes (Iowa Department of Education, Iowa Chart of Account Coding):
     expenditures   fund–facility–function–program–project–object   (2-4-4-3-4-3 digits)
     revenues       fund–facility–program–project–source             (2-4-3-4-4)
     balance sheet  fund–facility–program–project–account            (2-4-3-4-3)
   Funds: 10 General, 31–32 Capital Projects (GO bonds), 33 SAVE, 36 PPEL (board and voter-approved), 40 Debt Service.
   A capital fund's balance at month end = its fund-equity accounts + year-to-date revenue − year-to-date spending.
   Pure; tested by gl_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGGL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FUND_OF = { '10': 'general', '33': 'save', '36': 'ppel', '40': 'debt_levy', '31': 'other', '32': 'other' };
  const FUND_NAME = { general: 'General Fund', save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants', debt_levy: 'Debt Service', other: 'Other' };
  const FUNCTION_NAME = { 1: 'Instruction', 2: 'Support services', 3: 'Noninstructional', 4: 'Facilities acquisition and construction', 5: 'Debt service', 6: 'Other financing uses' };

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** money from a cell: 1,234.56 · $1,234 · (1,234.56) · -1234 · 1234- */
  function money(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).trim(); if (!s || s === '-') return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    s = s.replace(/[$,\s]/g, '');
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = Number(s); return neg ? -n : n;
  }

  /* ---------- which column is which ---------- */
  const COLS = {
    account: [/^(account|acct)( (no|number|code|string|#))?$/, /^gl account$/, /^account code$/, /^full account$/],
    description: [/^(description|account description|desc|account name|title|name)$/],
    ytd: [/^(ytd|year to date)( (actual|amount|activity|expended|received))?$/, /^actual ytd$/, /^ytd actual$/, /^actual$/],
    month: [/^(mtd|month to date|current month|month|period|this month)( (actual|amount|activity))?$/],
    budget: [/^(budget|amended budget|adopted budget|appropriation|original budget|current budget)$/],
    encumbered: [/^(encumbered|encumbrance|encumbrances|encumb|open po|outstanding encumbrance)s?$/],
    balance: [/^(ending balance|balance|current balance|end balance)$/],
    fund: [/^fund( code)?$/], facility: [/^facility( code)?$/], function: [/^function( code)?$/], program: [/^program( code)?$/],
    project: [/^project( code)?$/], object: [/^object( code)?$/], source: [/^source( code)?$/], acct: [/^balance sheet account$/, /^bs account$/],
  };
  /** find the header row and each column; returns { header, cols, missing } */
  function detectLayout(rows) {
    let best = null;
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const cells = (rows[r] || []).map(norm), cols = {};
      cells.forEach((c, i) => {
        if (!c) return;
        for (const [k, pats] of Object.entries(COLS)) if (cols[k] == null && pats.some((p) => p.test(c))) { cols[k] = i; break; }
      });
      const score = Object.keys(cols).length + (cols.account != null || cols.fund != null ? 3 : 0) + (cols.ytd != null || cols.balance != null ? 3 : 0);
      if (!best || score > best.score) best = { header: r, cols, score };
    }
    const cols = best ? best.cols : {};
    const missing = [];
    if (cols.account == null && cols.fund == null) missing.push('account');
    if (cols.ytd == null && cols.balance == null) missing.push('ytd');
    return { header: best ? best.header : 0, cols, missing };
  }

  /* ---------- Iowa account codes ---------- */
  function splitCode(code) {
    const raw = String(code == null ? '' : code).trim();
    let segs = raw.split(/[^0-9A-Za-z]+/).filter(Boolean);
    if (segs.length === 1 && /^\d+$/.test(segs[0])) {   // digits run together: try the standard lengths
      const d = segs[0], cut = (lens) => { const out = []; let i = 0; for (const n of lens) { out.push(d.slice(i, i + n)); i += n; } return out; };
      if (d.length === 20) segs = cut([2, 4, 4, 3, 4, 3]);
      else if (d.length === 17) segs = cut([2, 4, 3, 4, 4]);
      else if (d.length === 16) segs = cut([2, 4, 3, 4, 3]);
    }
    const p = { code: raw, fund: segs[0] || '' };
    if (segs.length >= 6) Object.assign(p, { kind: 'expenditure', facility: segs[1], function: segs[2], program: segs[3], project: segs[4], object: segs[5] });
    else if (segs.length === 5 && segs[4].length === 4) Object.assign(p, { kind: 'revenue', facility: segs[1], program: segs[2], project: segs[3], source: segs[4] });
    else if (segs.length === 5) Object.assign(p, { kind: 'balance', facility: segs[1], program: segs[2], project: segs[3], account: segs[4] });
    else p.kind = 'unknown';
    if (p.fund.length === 1) p.fund = '0' + p.fund;
    return p;
  }
  /** what HighGround suggests an account is; the business manager confirms new ones */
  function suggest(parts) {
    const fund = FUND_OF[parts.fund] || 'other';
    if (parts.kind === 'expenditure') return { account_type: 'expenditure', maps_to: 'expense', mapped_fund: fund, sign: 1 };
    if (parts.kind === 'revenue') return { account_type: 'revenue', maps_to: 'revenue', mapped_fund: fund, sign: 1 };
    if (parts.kind === 'balance') {
      const equity = /^7/.test(parts.account || '');
      return { account_type: 'balance_sheet', maps_to: equity ? 'fund_balance' : 'ignore', mapped_fund: fund, sign: 1 };
    }
    return { account_type: 'other', maps_to: 'unmapped', mapped_fund: FUND_OF[parts.fund] || null, sign: 1 };
  }
  function describe(parts) {
    const f = FUND_NAME[FUND_OF[parts.fund]] || (parts.fund ? `Fund ${parts.fund}` : '');
    if (parts.kind === 'expenditure') return `${f} spending${FUNCTION_NAME[(parts.function || '')[0]] ? ', ' + FUNCTION_NAME[parts.function[0]].toLowerCase() : ''}`;
    if (parts.kind === 'revenue') return `${f} revenue`;
    if (parts.kind === 'balance') return /^7/.test(parts.account || '') ? `${f} fund balance` : `${f} balance sheet`;
    return f || 'Not recognised';
  }

  /* ---------- the export, line by line ---------- */
  function parse(rows, layout) {
    const L = layout || detectLayout(rows), c = L.cols, lines = [], issues = [];
    const get = (row, k) => (c[k] == null ? '' : row[c[k]]);
    for (let r = L.header + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      let code = String(get(row, 'account') || '').trim();
      if (!code && c.fund != null) code = ['fund', 'facility', 'function', 'program', 'project', 'object', 'source', 'acct'].map((k) => String(get(row, k) || '').trim()).filter(Boolean).join('-');
      if (!code || !/\d/.test(code)) continue;              // blank lines, titles, subtotal labels
      if (/total/i.test(String(get(row, 'description') || '')) && !/\d{2}/.test(code.replace(/\D/g, '').slice(0, 2))) continue;
      const parts = splitCode(code);
      const ytd = money(get(row, 'ytd')), bal = money(get(row, 'balance'));
      const line = { row: r + 1, code, parts, description: String(get(row, 'description') || '').trim(),
        ytd: ytd != null ? ytd : bal, month: money(get(row, 'month')), budget: money(get(row, 'budget')), encumbered: money(get(row, 'encumbered')) };
      if (line.ytd == null && line.month == null && line.budget == null) { issues.push({ row: line.row, level: 'warn', text: `Line ${line.row} (${code}) has no amounts, so it was skipped.` }); continue; }
      lines.push(line);
    }
    const seen = new Map();
    lines.forEach((l) => { if (seen.has(l.code)) issues.push({ row: l.row, level: 'error', text: `Account ${l.code} appears twice (lines ${seen.get(l.code)} and ${l.row}). Export one line per account.` }); else seen.set(l.code, l.row); });
    if (!lines.length) issues.push({ level: 'error', text: 'No account lines were found. Check that the file is the month-end export with one line per account.' });
    return { lines, issues, layout: L };
  }

  /** split lines into accounts already matched last time and new ones, each new one with a suggestion */
  function reconcile(lines, accounts) {
    const byCode = new Map((accounts || []).map((a) => [a.code, a]));
    const known = [], fresh = [];
    lines.forEach((l) => {
      const a = byCode.get(l.code);
      if (a && !a.needs_review) known.push({ line: l, account: a });
      else fresh.push({ line: l, account: a || null, suggestion: a ? { account_type: a.account_type, maps_to: a.maps_to, mapped_fund: a.mapped_fund, sign: a.sign } : suggest(l.parts), about: describe(l.parts) });
    });
    return { known, fresh };
  }

  /** each fund's month-end balance from the matched accounts: equity + revenue − spending */
  function balances(lines, mappingByCode) {
    const out = {};
    lines.forEach((l) => {
      const m = mappingByCode[l.code]; if (!m || !m.mapped_fund || l.ytd == null) return;
      const f = (out[m.mapped_fund] = out[m.mapped_fund] || { equity: 0, revenue: 0, spending: 0, hasEquity: false, accounts: 0 });
      const v = l.ytd * (m.sign || 1);
      if (m.maps_to === 'fund_balance') { f.equity += v; f.hasEquity = true; f.accounts++; }
      else if (m.maps_to === 'revenue') { f.revenue += v; f.accounts++; }
      else if (m.maps_to === 'expense' || m.maps_to === 'initiative') { f.spending += v; f.accounts++; }
    });
    Object.values(out).forEach((f) => { f.balance = f.equity + f.revenue - f.spending; });
    return out;
  }

  /** a fictional month-end export for the Bridger Hollow demo (30 Sept 2026), Iowa-style codes */
  function sampleExport() {
    const L = [
      ['Account', 'Description', 'Month to Date', 'Year to Date', 'Budget', 'Encumbered'],
      ['10-0000-000-0000-760', 'General Fund - unassigned fund balance (beginning)', '', '2,184,300.00', '', ''],
      ['10-0000-000-0000-1110', 'Property tax levy', '412,880.15', '1,104,226.40', '4,950,000.00', ''],
      ['10-0000-000-0000-3111', 'State foundation aid', '601,775.00', '1,805,325.00', '7,350,000.00', ''],
      ['10-0109-1100-100-0000-111', 'Elementary teacher salaries', '402,115.22', '804,230.44', '4,820,000.00', ''],
      ['10-0109-1100-100-0000-211', 'Elementary teacher benefits - IPERS', '38,201.95', '76,403.90', '455,000.00', ''],
      ['10-0000-2600-000-0000-622', 'Electricity', '24,806.17', '71,144.02', '310,000.00', '4,200.00'],
      ['33-0000-000-0000-101', 'SAVE - cash', '', '1,201,882.36', '', ''],
      ['33-0000-000-0000-760', 'SAVE - restricted fund balance (beginning)', '', '1,420,000.00', '', ''],
      ['33-0000-000-0000-1013', 'SAVE receipts', '98,412.00', '295,236.00', '1,180,640.00', ''],
      ['33-0000-4700-000-1001-450', 'High school roof, sections A-B - construction', '186,400.00', '262,750.00', '410,000.00', '147,250.00'],
      ['33-0000-4700-000-1002-450', 'Secure entry vestibules - construction', '61,300.00', '138,900.00', '210,000.00', '71,100.00'],
      ['33-0000-2600-000-0000-341', 'Building security monitoring', '1,500.00', '4,500.00', '18,000.00', ''],
      ['36-0000-000-0000-760', 'PPEL - restricted fund balance (beginning)', '', '990,000.00', '', ''],
      ['36-0000-000-0000-1170', 'PPEL levy (board-approved)', '11,333.00', '34,000.00', '136,000.00', ''],
      ['36-0000-000-0000-1171', 'PPEL levy (voter-approved)', '34,333.00', '103,000.00', '412,000.00', ''],
      ['36-0000-2700-000-0000-733', 'Route bus replacement', '0.00', '148,000.00', '148,000.00', ''],
      ['36-0000-2230-000-1003-734', '1:1 Chromebook refresh - devices', '82,500.00', '159,800.00', '165,000.00', '5,200.00'],
      ['36-0000-5000-000-0000-831', 'Bus lease-purchase - principal', '0.00', '31,000.00', '62,000.00', ''],
      ['40-0000-000-0000-760', 'Debt Service - fund balance (beginning)', '', '96,400.00', '', ''],
      ['40-0000-000-0000-1111', 'Debt service levy', '24,580.00', '73,740.00', '295,000.00', ''],
      ['40-0000-5100-000-0000-832', 'GO bonds Series 2016 - interest', '0.00', '0.00', '61,000.00', ''],
      ['', 'Report total', '', '', '', ''],
    ];
    return L;
  }

  return { money, detectLayout, splitCode, suggest, describe, parse, reconcile, balances, sampleExport, FUND_OF, FUND_NAME };
});
