/* HighGround — reading a check register (the monthly list of bills paid) for the board-question checks.
   Same rules as loader/import_register.py, so a file reads the same whether staff or the district loads it.
   Columns are matched by header name. If the export has one account string and no separate fund / function /
   object columns, it is split with an ASSUMED Iowa layout: first 2-digit group = fund, first non-zero 4-digit
   group = function, last non-zero 3-digit group = object.
   Pure functions. Tests: register_test.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGRegister = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FIELDS = ['pay_date', 'check_no', 'vendor_no', 'vendor_name', 'invoice_no', 'description', 'account', 'fund', 'func', 'obj', 'amount', 'method'];
  const GUESSES = {
    pay_date: ['check date', 'pay date', 'payment date', 'date', 'warrant date', 'posted'],
    check_no: ['check no', 'check number', 'check #', 'check', 'warrant', 'reference', 'ref'],
    vendor_no: ['vendor no', 'vendor number', 'vendor #', 'vendor id', 'payee id', 'vendor code'],
    vendor_name: ['vendor name', 'vendor', 'payee', 'name', 'paid to'],
    invoice_no: ['invoice no', 'invoice number', 'invoice #', 'invoice'],
    description: ['description', 'desc', 'memo', 'line description', 'purpose', 'comment'],
    account: ['account', 'account number', 'account code', 'gl account', 'acct', 'account no'],
    fund: ['fund'], func: ['function', 'func'], obj: ['object', 'obj'],
    amount: ['amount', 'check amount', 'payment amount', 'net amount', 'total', 'amt'],
    method: ['method', 'payment type', 'type', 'pay type'],
  };
  const LABEL = { pay_date: 'Date', check_no: 'Check number', vendor_no: 'Vendor number', vendor_name: 'Vendor name', invoice_no: 'Invoice number', description: 'Description',
    account: 'Account', fund: 'Fund', func: 'Function', obj: 'Object', amount: 'Amount', method: 'Payment method' };
  const key = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

  /** the header row: the first of the first 15 rows with at least 3 filled cells (exports often have title lines) */
  function headerRow(rows) {
    for (let i = 0; i < Math.min(15, rows.length); i++) if ((rows[i] || []).filter((c) => String(c == null ? '' : c).trim()).length >= 3) return i;
    return 0;
  }
  /** { field: column index }, from header names; overrides { field: index } win */
  function matchColumns(header, overrides) {
    const hk = header.map(key), out = Object.assign({}, overrides || {}), used = new Set(Object.values(out));
    for (const f of FIELDS) {
      if (f in out) continue;
      for (const g of GUESSES[f]) {   // exact header first, then "starts with"
        let i = hk.findIndex((h, k) => !used.has(k) && h === g);
        if (i < 0) i = hk.findIndex((h, k) => !used.has(k) && h.startsWith(g + ' '));
        if (i >= 0) { out[f] = i; used.add(i); break; }
      }
    }
    return out;
  }
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000).toISOString().slice(0, 10);
    const s = String(v).trim().split(/[ T]/)[0]; let m;
    const pad = (x) => String(x).padStart(2, '0'), yr = (y) => (String(y).length === 2 ? (Number(y) > 70 ? '19' : '20') + y : String(y));
    if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) return `${yr(m[3])}-${pad(m[1])}-${pad(m[2])}`;
    const d = new Date(String(v).trim());   // "Sep 3, 2026", "03-Sep-2026"
    return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim().replace(/[$,\s]/g, '');
    const neg = /^\(.*\)$/.test(s) || /-$/.test(s);
    s = s.replace(/[()]/g, '').replace(/-$/, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const x = Number(s); return neg ? -x : x;
  }
  /** ASSUMED Iowa layout; { fund, func, obj } or nulls */
  function splitAccount(acct) {
    const t = String(acct || '').split(/[^0-9]+/).filter(Boolean);
    return {
      fund: t[0] && t[0].length === 2 ? t[0] : null,
      func: t.slice(1).find((x) => x.length === 4 && x !== '0000') || null,
      obj: t.slice(1).reverse().find((x) => x.length === 3 && x !== '000') || null,
    };
  }
  const monthEnd = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

  /** rows (arrays) → { header, cols, lines, skipped, issues, months: [{ period_end, lines, total }] } */
  function parse(rows, overrides) {
    const h = headerRow(rows), header = (rows[h] || []).map((c) => String(c == null ? '' : c)), cols = matchColumns(header, overrides);
    const issues = [];
    if (cols.vendor_name == null) issues.push({ l: 'e', m: 'HighGround couldn’t find the vendor (payee) column. Choose it under “Columns”.' });
    if (cols.amount == null) issues.push({ l: 'e', m: 'HighGround couldn’t find the amount column. Choose it under “Columns”.' });
    if (cols.pay_date == null) issues.push({ l: 'e', m: 'HighGround couldn’t find the check date column. Choose it under “Columns”.' });
    const lines = []; let skipped = 0, noDate = 0, split = 0;
    if (!issues.length) {
      rows.slice(h + 1).forEach((r, k) => {
        const g = (f) => (cols[f] != null && r[cols[f]] != null ? String(r[cols[f]]).trim() : '');
        const amount = parseAmount(cols.amount != null ? r[cols.amount] : null), vendor = g('vendor_name');
        if (amount == null || !vendor || /^(grand )?totals?\b/i.test(vendor)) { skipped++; return; }
        let fund = g('fund') || null, func = g('func') || null, obj = g('obj') || null;
        if (g('account') && !(fund && func && obj)) { const s = splitAccount(g('account')); if (!fund && s.fund) split++; fund = fund || s.fund; func = func || s.func; obj = obj || s.obj; }
        const pay_date = parseDate(cols.pay_date != null ? r[cols.pay_date] : null);
        if (!pay_date) noDate++;
        lines.push({ line_no: k + 1, pay_date, check_no: g('check_no') || null, vendor_no: g('vendor_no') || null, vendor_name: vendor.slice(0, 200), invoice_no: g('invoice_no') || null,
          description: g('description') || null, account: g('account') || null, fund, func, obj, amount: Math.round(amount * 100) / 100, method: g('method') || null });
      });
      if (!lines.length) issues.push({ l: 'e', m: 'No payments found: no rows with both a vendor and an amount.' });
      if (noDate) issues.push({ l: 'e', m: `${noDate} payment${noDate === 1 ? ' has' : 's have'} no date HighGround can read. Each payment needs its check date to be put in the right month.` });
      if (split) issues.push({ l: 'w', m: `Fund, function and object were read from the account number (first two digits = fund) for ${split} payment${split === 1 ? '' : 's'}. Check a few against the export.` });
      if (cols.vendor_no == null) issues.push({ l: 'w', m: 'No vendor-number column, so a vendor whose name changes can’t be spotted. Include vendor numbers in the export if you can.' });
      if (cols.invoice_no == null) issues.push({ l: 'w', m: 'No invoice-number column: duplicate payments are found by amount and date only.' });
    }
    const by = new Map();
    lines.filter((l) => l.pay_date).forEach((l) => { const pe = monthEnd(l.pay_date); if (!by.has(pe)) by.set(pe, []); by.get(pe).push(l); });
    const months = [...by.keys()].sort().map((pe) => ({ period_end: pe, lines: by.get(pe), total: by.get(pe).reduce((a, l) => a + l.amount, 0) }));
    return { header, headerIndex: h, cols, lines, skipped, issues, months };
  }

  /** rows for the register_line table */
  const toRows = (lines, batchId, districtId) => lines.map((l) => Object.assign({ batch_id: batchId, district_id: districtId }, ...FIELDS.map((f) => ({ [f]: l[f] == null ? null : l[f] })), { line_no: l.line_no }));

  const RULE_NAME = { new_vendor: 'New vendor', vendor_name_change: 'Vendor name changed', lookalike_vendor: 'Look-alike vendor', duplicate_payment: 'Possible duplicate',
    near_threshold: 'Just under the bid threshold', split_purchase: 'Possible split purchase', vendor_spike: 'Unusually large for this vendor', account_spike: 'Unusual for this account',
    restricted_fund_use: 'Restricted fund', round_amount: 'Round amount', weekend_date: 'Weekend date', missing_info: 'Missing description or account' };
  const SEVERITY = { concern: 'Look closely', question: 'Question', info: 'For information' };

  return { FIELDS, LABEL, GUESSES, headerRow, matchColumns, parseDate, parseAmount, splitAccount, monthEnd, parse, toRows, RULE_NAME, SEVERITY };
});
