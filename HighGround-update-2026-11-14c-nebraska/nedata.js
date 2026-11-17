/* HighGround — Nebraska public data (NDE) for one district, turned into the setup forms' figures.
   Input: ne_prefill(agency) from part 35 (NDE Statistical Information, the state aid certification, the property tax request
   authority certification and the Annual Financial Report). Output: rows to compare with the district's own figures, the
   Starting numbers fields, and the General Fund fields (TEEOSA included). Pure functions. Tests: nebraska_test.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGNeData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const r0 = (v) => (n(v) == null ? null : Math.round(n(v)));
  const sy = (fy) => `${fy - 1}/${String(fy).slice(2)}`;

  /** ne_prefill → { ne: true, fiscal_year, source, rows: [[label, state, settingKey, kind]], values: {field: value}, gf: {...}, teeosa: {...} } */
  function adapt(raw) {
    if (!raw || !raw.agency_id) return null;
    const st = raw.stat || {}, aid = raw.aid || {}, pta = raw.pta || {}, afr = raw.afr || {};
    const B = afr.balances || {}, R = afr.receipts || {}, G = afr.general || {}, D = afr.debt_payments || {};
    const fy = afr.fiscal_year || st.fiscal_year || null;
    const rows = [], values = {};
    const add = (label, v, key, kind) => { if (n(v) != null || typeof v === 'string') rows.push([label, typeof v === 'string' ? v : n(v), key || null, kind || 'money']); };
    /* fall membership is NDE's count; formula students (TEEOSA) are on the General Fund screen */
    if (st.fiscal_year) add(`Fall membership, ${sy(st.fiscal_year)} (NDE)`, st.mem_total, 'enrollment', 'count');
    if (afr.fiscal_year) {
      add(`Depreciation Fund cash, August 31, ${afr.fiscal_year}`, B.save, 'bal_save');
      add(`Special Building Fund cash, August 31, ${afr.fiscal_year}`, B.ppel, 'bal_ppel');
      add(`QCPUF cash, August 31, ${afr.fiscal_year}`, B.vppel, 'bal_vppel');
      add(`Transfers into the Depreciation Fund, ${sy(afr.fiscal_year)}`, R.save, 'save_receipts');
      add(`Special Building receipts (not bonds or loans), ${sy(afr.fiscal_year)}`, R.ppel, 'ppel_receipts');
      add(`QCPUF receipts (not bonds), ${sy(afr.fiscal_year)}`, R.vppel, 'vppel_annual');
      add(`General Fund cash, August 31, ${afr.fiscal_year}`, B.general, null);
      if (n(B.employee_benefit) > 0) add(`Employee Benefit Fund cash, August 31, ${afr.fiscal_year}`, B.employee_benefit, null);
      if (n(B.contingency) > 0) add(`Contingency Fund cash, August 31, ${afr.fiscal_year}`, B.contingency, null);
    }
    if (st.fiscal_year) {
      add(`Valuation, ${sy(st.fiscal_year)}`, st.valuation, 'taxable_valuation');
      add(`Special Building levy, ${sy(st.fiscal_year)}, per $100`, st.sb_levy, 'ppel_rate', 'rate');
      add(`General Fund levy, ${sy(st.fiscal_year)}, per $100`, st.gen_levy, 'lid_gf_rate', 'rate');
      add(`QCPUF levy, ${sy(st.fiscal_year)}, per $100`, st.qcpuf_levy, null, 'rate');
      add(`Bond Fund levy, ${sy(st.fiscal_year)}, per $100`, st.bond_levy, null, 'rate');
    }
    if (pta.fiscal_year) {
      add(`Property tax request authority, ${sy(pta.fiscal_year)}`, pta.authority, 'lid_authority');
      add(`Prior years’ unused authority (in that figure), ${sy(pta.fiscal_year)}`, pta.prior_unused, 'lid_carry');
      /* NDE's rate for the certified year is already in that year's authority: shown, not used as every year's growth */
      add(`Base growth rate, ${sy(pta.fiscal_year)}`, pta.base_growth_rate, null, 'pct');
      if (n(pta.g_member) != null) add(`  of which fall membership, ${sy(pta.fiscal_year)}`, pta.g_member, null, 'pct');
      if (n(pta.g_lep) != null || n(pta.g_poverty) != null) add(`  of which English learners and poverty, ${sy(pta.fiscal_year)}`, (n(pta.g_lep) || 0) + (n(pta.g_poverty) || 0), null, 'pct');
      if (n(pta.board_pct) > 0) add(`Extra growth with a 70% board vote, ${sy(pta.fiscal_year)}`, pta.board_pct, null, 'pct');
    }
    if (n(D.ppel) > 0) add(`Special Building debt payments, ${sy(afr.fiscal_year)}`, D.ppel, null);
    if (n(D.debt_levy) > 0) add(`Bond Fund payments, ${sy(afr.fiscal_year)}`, D.debt_levy, null);
    /* K-12 fall membership, oldest first, for the base growth formula (79-3402(3)); the change ahead starts as the average of
       the last three years' change, kept between −5% and +5% */
    const hist = (raw.mem_hist || []).filter((h) => n(h.k12) > 0).sort((a, b) => a.fiscal_year - b.fiscal_year);
    if (hist.length >= 2) {
      add(`K-12 fall membership, ${sy(hist[0].fiscal_year)} to ${sy(hist[hist.length - 1].fiscal_year)}`, hist.map((h) => Math.round(n(h.k12)).toLocaleString('en-US')).join(', '), null, 'text');
      values.lid_mem_hist = hist.map((h) => Math.round(n(h.k12))).join(', ');
      const k = hist.length - 1, back = Math.min(3, k);
      let avg = 0; for (let j = 0; j < back; j++) avg += n(hist[k - j].k12) / n(hist[k - j - 1].k12) - 1;
      values.lid_mem_growth = Math.round(Math.max(-0.05, Math.min(0.05, avg / back)) * 10000) / 10000;
    }
    /* the English learner and poverty part ahead: the average of NDE's last three certified parts (the student counts behind
       them aren't published by district, so this is the closest public figure) */
    const ph = (raw.pta_hist || []).filter((h) => n(h.g_lep) != null || n(h.g_poverty) != null).sort((a, b) => a.fiscal_year - b.fiscal_year).slice(-3);
    if (ph.length) {
      const lp = ph.reduce((t, h) => t + (n(h.g_lep) || 0) + (n(h.g_poverty) || 0), 0) / ph.length;
      values.lid_lep_pov = Math.round(lp * 10000) / 10000;
      add(`English learner and poverty part, average of NDE’s ${ph.length === 1 ? sy(ph[0].fiscal_year) : `${sy(ph[0].fiscal_year)}–${sy(ph[ph.length - 1].fiscal_year)}`} certifications`, lp, null, 'pct');
    }
    /* the adopted budget (NDE's LC-2 submissions): this year's valuation, General Fund and Special Building tax requests, and any
       levy override; newer than the statistics and certifications above, so its figures win */
    const lc = raw.lc2 || {};
    if (lc.fiscal_year) {
      add(`Certified valuation, ${sy(lc.fiscal_year)} (adopted budget)`, lc.valuation, 'taxable_valuation');
      add(`General Fund property tax request, ${sy(lc.fiscal_year)} (adopted budget)`, lc.gf_request, null);
      add(`Special Building property tax request, ${sy(lc.fiscal_year)} (adopted budget)`, lc.sb_request, null);
      if (n(lc.valuation) > 0 && n(lc.gf_request) != null) add(`General Fund levy, ${sy(lc.fiscal_year)}, per $100 (request ÷ valuation)`, Math.round(n(lc.gf_request) / n(lc.valuation) * 100 * 1e4) / 1e4, 'lid_gf_rate', 'rate');
      /* the authority the budget could use this year: NDE's certified figure, plus what a 70% board vote added (79-3405(2)) and
         what voters approved above it (79-3405(1)); a pre-2024 levy override's own authority is added by the override itself */
      const boardX = n(lc.board_extra) > 0 ? n(lc.board_extra) : 0, voteX = n(lc.pta_vote) > 0 ? n(lc.pta_vote) : 0;
      if (n(lc.pta) > 0) add(`Property tax request authority, ${sy(lc.fiscal_year)} (adopted budget${boardX || voteX ? ', with the increases below' : ''})`, n(lc.pta) + boardX + voteX, 'lid_authority');
      if (boardX) add(`Added by a 70% board vote (79-3405(2)), ${sy(lc.fiscal_year)}`, boardX, null);
      if (voteX) add(`Added by a 60% vote of the patrons (79-3405(1)), ${sy(lc.fiscal_year)}`, voteX, null);
      if (n(lc.ov_authority) > 0) add(`Authority from the levy override (approved before 2024, 79-3405(3)), ${sy(lc.fiscal_year)}`, lc.ov_authority, null);
      if (n(lc.unused_pta) > 0) add(`Unused authority after this year’s request, ${sy(lc.fiscal_year)}`, lc.unused_pta, null);
      if (n(lc.override_levy) > 0) add(`Levy override above $1.05${n(lc.override_first) && n(lc.override_last) ? `, ${sy(n(lc.override_first))} to ${sy(n(lc.override_last))}` : ''}, per $100`, lc.override_levy, null, 'rate');
    }
    rows.forEach(([, v, key, kind]) => { if (key && v != null && typeof v === 'number') values[key] = kind === 'money' ? r0(v) : kind === 'count' ? Math.round(v) : v; });
    /* the authority NDE certifies already includes the prior years' unused part: HighGround adds the carry each year itself, so
       the first-year authority it starts from is the certified figure less the carry */
    if (values.lid_authority != null && values.lid_carry != null) values.lid_authority = Math.max(0, values.lid_authority - values.lid_carry);
    if (n(st.qcpuf_levy) > 0) values.vppel_status = 'active';
    if (lc.fiscal_year && n(lc.override_levy) > 0) {
      values.lid_ov_cents = Math.round(n(lc.override_levy) * 1000) / 10;
      if (n(lc.override_first)) values.lid_ov_first = n(lc.override_first);
      if (n(lc.override_last)) values.lid_ov_last = n(lc.override_last);
      if (n(lc.ov_authority) > 0) values.lid_ov_authority = true;   // NDE added the override to the authority: approved before 2024
    }
    /* the board took the extra growth this year: assume it keeps doing so (the box can be cleared) */
    if (lc.fiscal_year && (n(lc.board_extra) > 0 || n(lc.board_vote) === 1)) values.lid_board_bump = true;
    if (st.fiscal_year && n(st.mem_total) != null) values.enrollment_year = `${st.fiscal_year - 1}-${String(st.fiscal_year).slice(2)}`;
    /* General Fund (gf_inputs) and TEEOSA (gf_inputs.teeosa) */
    const gf = {};
    if (afr.fiscal_year) {
      gf.fund_balance = r0(B.general);
      gf.property_tax = r0(G.property_tax);
      gf.state_aid = r0(G.state_aid);
      gf.other_state = n(G.other_state) != null || n(G.sped) != null ? r0(Math.max(0, (n(G.other_state) || 0))) : null;
      const other = n(G.revenue) != null ? n(G.revenue) - (n(G.property_tax) || 0) - (n(G.state_aid) || 0) - (n(G.other_state) || 0) - (n(G.other_financing) || 0) : null;
      gf.misc_income = other == null ? null : r0(Math.max(0, other));
      gf.expenditures = r0(G.expenditures);
      /* Employee Benefit and Contingency funds (AFR funds 03 and 04): last year's balance, transfer in and payouts as a start */
      const FU = afr.funds || {}, fund = (bal, tr, paid) => { const o = { balance: r0(bal), transfer: r0(tr), use: r0(paid) }; Object.keys(o).forEach((k) => { if (!(o[k] > 0)) delete o[k]; }); return Object.keys(o).length ? o : null; };
      const eb = fund(B.employee_benefit, FU.eb_transfer, FU.eb_paid), cont = fund(B.contingency, FU.cont_transfer, FU.cont_paid);
      if (eb || cont) gf.funds = Object.assign({}, eb ? { eb } : {}, cont ? { cont } : {});
    }
    /* the certification's General Fund tax asking is the year before it (2026/27's certification shows 2025/26's LC-2):
       newer than the AFR's collections, and labeled with its year so the adopted budget's figure can replace it */
    if (pta.fiscal_year && n(pta.gf_ask) != null) { gf.property_tax = r0(pta.gf_ask); gf.property_tax_fy = pta.fiscal_year - 1; }
    if (lc.fiscal_year && n(lc.gf_request) != null) { gf.property_tax = r0(lc.gf_request); gf.property_tax_fy = lc.fiscal_year; gf.property_tax_adopted = true; }
    /* NDE's certified General Fund budget authority (79-1023) and its parts, and the allowable reserve % */
    const bd = raw.budget || {};
    if (bd.fiscal_year && n(bd.authority) > 0) {
      gf.budget = { fiscal_year: bd.fiscal_year, authority: r0(bd.authority), unused: r0(bd.unused) || 0, prior_adjusted: r0(bd.adjusted), sped: r0(bd.sped),
        excluded: r0((n(bd.sgf) || 0) + (n(bd.gfle) || 0)), method: bd.method || null, reserve_pct: n(bd.reserve_pct) };
      add(`General Fund budget authority, ${sy(bd.fiscal_year)} (${{ B: 'budget-based', F: 'formula needs', SGA: 'student growth' }[bd.method] || 'certified'})`, bd.authority, null);
      if (n(bd.unused) > 0) add(`Unused budget authority carried forward, ${sy(bd.fiscal_year)}`, bd.unused, null);
      if (n(bd.reserve_pct) > 0) add(`Allowable reserve, ${sy(bd.fiscal_year)}`, n(bd.reserve_pct) / 100, null, 'pct');
    }
    /* the adopted budget against the authority: districts that budget their whole authority keep the base growing (so unused
       authority doesn't pile up); the first year's special education and exclusions are the adopted ones */
    if (gf.budget && lc.fiscal_year === gf.budget.fiscal_year) {
      if (n(lc.adj_budget) != null && n(lc.budget_authority) > 0) {
        gf.budget.mode = n(lc.adj_budget) >= n(lc.budget_authority) * 0.995 ? 'authority' : 'spending';
        add(`Adopted General Fund budget under the limit, ${sy(lc.fiscal_year)}`, lc.adj_budget, null);
      }
      if (n(lc.sped) != null) gf.budget.sped = r0(lc.sped);
      if (n(lc.sgf) != null || n(lc.gfle) != null) gf.budget.excluded = r0((n(lc.sgf) || 0) + (n(lc.gfle) || 0));
      if (n(lc.reserve_pct) > 0) gf.budget.reserve_pct = n(lc.reserve_pct);
    }   // this year's request beats last year's collections
    let teeosa = null;
    if (aid.fiscal_year) {
      teeosa = { need: r0(aid.formula_need), local: r0(aid.local_effort), option: r0(aid.option_funding), itr: r0(aid.income_tax), other: r0(aid.other_receipts),
        students: n(aid.formula_students) == null ? null : Math.round(n(aid.formula_students) * 100) / 100, fiscal_year: aid.fiscal_year, calc_aid: r0(aid.calc_aid) };
      /* what NDE pays this year: the calculated aid plus the correction for last year's aid, recalculated with final data
         (79-1065; NDE's "Calculation of Prior Year Correction") */
      const pyc = n(aid.prior_year_corr);
      if (pyc != null) teeosa.pyc = r0(pyc);
      if (n(aid.sga) > 0) teeosa.sga0 = r0(aid.sga);   // this year's student growth adjustment: corrected two years on (79-1007.20(3))
      gf.state_aid = r0(n(aid.calc_aid) + (pyc || 0));
      if (teeosa.students != null) gf.enrollment = teeosa.students;
      /* for a student growth adjustment: basic funding per formula student (A2) and fall membership */
      if (n(aid.basic_funding) > 0 && n(aid.formula_students) > 0) {
        teeosa.bfps = Math.round(n(aid.basic_funding) / n(aid.formula_students));
        if (gf.budget) gf.budget.sga = { students: 0, bfps: teeosa.bfps, fm: n(st.mem_total) || null };
        add(`Basic funding per formula student, ${sy(aid.fiscal_year)} (for a student growth adjustment)`, teeosa.bfps, null);
      }
      if (n(aid.sga) > 0) add(`Student growth adjustment in this year’s need, ${sy(aid.fiscal_year)}`, aid.sga, null);
      if (pyc) add(`Correction for last year’s aid, paid with ${sy(aid.fiscal_year)}’s (79-1065)`, pyc, null);
    }
    const sources = [st.source || (st.fiscal_year && `NDE Statistical Information ${sy(st.fiscal_year)}`), aid.source, pta.source, afr.source].filter(Boolean);
    return { ne: true, agency_id: raw.agency_id, name: raw.name, fiscal_year: fy, source: sources.join('. '), rows, values, gf, teeosa,
      /* the shape the shared screens read, so shared code keeps working */
      balances: { save: B.save, ppel: B.ppel, vppel: B.vppel }, receipts: { save: R.save, ppel: R.ppel, vppel: R.vppel },
      latest_enrollment: st.fiscal_year ? { certified: st.mem_total, fiscal_year: st.fiscal_year } : {} };
  }

  /** one sentence for the General Fund screen: what the state's figures say */
  function gfItems(a, fmt) {
    if (!a) return [];
    const g = a.gf || {}, t = a.teeosa, f = fmt || ((v) => '$' + Math.round(v).toLocaleString('en-US'));
    return [g.property_tax != null ? `General Fund property tax asking ${f(g.property_tax)}${g.property_tax_adopted ? ` (${sy(g.property_tax_fy)} adopted budget)` : g.property_tax_fy ? ` (${sy(g.property_tax_fy)}; use the adopted budget’s for the first plan year if you have it)` : ''}` : '',
      t ? `${sy(t.fiscal_year)} TEEOSA: need ${f(t.need)}, local effort ${f(t.local)}, ${t.students} formula students, calculated aid ${f(t.calc_aid)}${t.pyc ? `, ${t.pyc > 0 ? 'plus' : 'less'} last year’s correction ${f(Math.abs(t.pyc))}: ${f(t.calc_aid + t.pyc)} to be paid` : ''}` : g.state_aid != null ? `state aid ${f(g.state_aid)}` : '',
      g.other_state != null ? `other state aid ${f(g.other_state)}` : '', g.misc_income != null ? `other income ${f(g.misc_income)}` : '',
      g.fund_balance != null ? `General Fund cash ${f(g.fund_balance)} at August 31, ${a.fiscal_year}` : '',
      g.budget ? `${sy(g.budget.fiscal_year)} budget authority ${f(g.budget.authority)}` : '',
      g.funds && g.funds.eb ? `Employee Benefit Fund ${f(g.funds.eb.balance || 0)}` : '', g.funds && g.funds.cont ? `Contingency Fund ${f(g.funds.cont.balance || 0)}` : ''].filter(Boolean);
  }

  const AGENCY = /^\d{2}-\d{4}-\d{3}$/;
  /** "1-3-0" or "01-0003-000" or "010003000" → "01-0003-000"; null if it can't be an agency ID */
  function agencyId(s) {
    const t = String(s || '').trim();
    if (AGENCY.test(t)) return t;
    const d = t.replace(/\D/g, '');
    if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    const p = t.split(/[-\s]+/);
    if (p.length === 3 && p.every((x) => /^\d+$/.test(x)) && p[0].length <= 2 && p[1].length <= 4 && p[2].length <= 3) return `${p[0].padStart(2, '0')}-${p[1].padStart(4, '0')}-${p[2].padStart(3, '0')}`;
    return null;
  }

  return { adapt, gfItems, agencyId };
});
