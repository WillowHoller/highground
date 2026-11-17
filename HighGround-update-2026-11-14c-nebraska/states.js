/* HighGround — state packs: everything that differs by state, in one place.

   GUARDRAIL (Leslie, 11 Nov 2026). Code outside this file must not hard-code a state's fund names, laws, rates, units or
   calendar. Read them from the district's pack:  HGStates.pack(code)  or, in the browser, HGStates.current().
   guardrail_test.js counts Iowa fund names and "Iowa" in every other file and fails if any count goes up.

   Fund SLOTS. The database, the engine and the screens keep six capital slots and two others:
     save   — a shared state revenue for capital (Iowa: SAVE, the statewide 1¢ sales tax)
     ppel   — the board-set capital levy           (Iowa: PPEL;  Nebraska: Special Building Fund)
     vppel  — a second capital levy, for set years (Iowa: V-PPEL; Nebraska: QCPUF levy)
     grants, boost (boosters), camp (campaign/bond) — the same everywhere
     general (General Fund), debt_levy (the levy that repays general-obligation bonds)
   A pack turns slots on or off and names them. A slot that is off ({ on: false }) never shows and never collects.
   This keeps every stored row valid as it is (no migration of fund keys) while each state reads in its own words.

   Each value carries a status, the same tags as the research files: verified (checked against a source), recalled
   (general knowledge; confirm before selling on it), assumed (a modeling choice).

   Pure: no page access. In the browser it is window.HGStates; in node, require('./states.js'). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGStates = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ Iowa (pack #1: today's behavior, unchanged) */
  const IA = {
    code: 'IA', name: 'Iowa', adj: 'Iowa', status: 'live',
    agency: 'Iowa Department of Education', association: 'IASB (Iowa Association of School Boards)',
    districtNumberLabel: 'Iowa district number',
    /* fiscal year 1 July – 30 June, named for the year it ends (FY2027 = Jul 2026 – Jun 2027) */
    fyStartMonth: 7,
    rate: { per: 1000, label: 'per $1,000', short: '$/1,000', digits: 2 },
    funds: {
      save: { on: true, label: 'SAVE', long: 'SAVE (statewide sales tax)', method: 'shared_revenue',
        uses: 'School infrastructure: building, remodeling, repairing and equipping school buildings and sites, technology and safety, plus SAVE revenue bonds and property-tax relief, as the district’s revenue purpose statement allows.' },
      ppel: { on: true, label: 'PPEL', long: 'PPEL (board-approved levy)', method: 'rate_levy', maxRate: 0.33 },
      vppel: { on: true, label: 'V-PPEL', long: 'V-PPEL (voter-approved levy)', method: 'flat_years', voter: true, maxRate: 1.34, maxYears: 10 },
      grants: { on: true, label: 'Grants/Donations', long: 'Grants and donations' },
      boost: { on: true, label: 'Boosters', long: 'Boosters' },
      camp: { on: true, label: 'Campaign/Bond', long: 'Campaign or bond' },
      general: { on: true, label: 'General Fund', long: 'General Fund' },
      debt_levy: { on: true, label: 'Debt service levy', long: 'Debt service levy' },
    },
    /* which fund may pay for what (engine.legality). Iowa Code 298.3 (PPEL, V-PPEL), 423F.3 (SAVE). Rule C4, checked 10 Oct 2026. */
    legal: {
      funds: ['save', 'ppel', 'vppel'],
      yearly: { salary: 'no', benefits: 'no', supplies: 'no', activities: 'no', contract: 'check', other: 'check' },
      type: { capital: 'ok', technology: 'check', program: 'check', other: 'check', staff: 'no', curriculum: 'no' },
      cite: { save: 'Iowa Code 423F.3', ppel: 'Iowa Code 298.3', vppel: 'Iowa Code 298.3' },
      okNote: { save: 'SAVE uses must be covered by the district’s revenue purpose statement.' },
      checkNote: { save: '; the revenue purpose statement must cover it' },
    },
    defaultFund: 'save',   // a phase with no fund given
    financing: ['go', 'rev', 'lease', 'gift'],
    debt: { limitShare: 0.05, limitBasis: 'actual', vote: 0.60, voteStatus: 'recalled' },
    features: { sf2472: true, saveBond: true, prefill: true, peers: true, car: true, gfIowa: true, dataSources: true },
    gf: 'IA', tax: 'IA',
    /* Iowa uniform chart of accounts: fund codes */
    glFunds: { '10': 'general', '33': 'save', '36': 'ppel', '40': 'debt_levy', '31': 'other', '32': 'other' },
    balanceCodes: { save: '33', ppel: '36', vppel: '36' },
    say: null,   // Iowa is the language the screens are written in: nothing to change
  };

  /* ------------------------------------------------------------------ Nebraska (pack #2; rules confirmed 12 Nov 2026)
     Status of each rule: see 34/35_*.sql rule_value rows and STATES.md. Sources:
       Neb. Rev. Stat. 79-1091 (fiscal year Sept 1 – Aug 31), 10-702 (bonds: a majority of electors voting), 77-201(2)
       (ag land 75% of actual value; 50% for school bond levies approved by voters on or after 1 Jan 2022), 79-10,120
       (Special Building Fund, ≤14¢), 79-10,110.02 (hazard / accessibility / life-safety / school-safety-infrastructure levy,
       ≤3¢ with 79-10,110, ≤10 years, no vote, bonds not a general obligation), 79-1027 (allowable reserve 45/35/25/20% of the
       General Fund budget, counting depreciation and employee benefit funds), NDE Rule 2 003.03B (Depreciation Fund: board-
       designated reserve funded by General Fund transfers for costly capital outlay), NDE 2025/26 AFR master code list
       (fund numbers), NDE property tax request authority certification 2026/27 (prior years' unused authority carries). */
  const NE = {
    code: 'NE', name: 'Nebraska', adj: 'Nebraska', status: 'preview',
    agency: 'Nebraska Department of Education', association: 'NASB (Nebraska Association of School Boards)',
    districtNumberLabel: 'NDE agency ID (county-district number, like 01-0003-000)',
    districtNumberPattern: '^\\d{2}-\\d{4}-\\d{3}$',
    fyStartMonth: 9,   // Neb. Rev. Stat. 79-1091 [verified]
    rate: { per: 100, label: 'per $100', short: '¢/$100', digits: 4 },
    funds: {
      /* the shared-revenue slot holds Nebraska's Depreciation Fund: a reserve the board builds by General Fund transfers */
      save: { on: true, label: 'Depreciation', long: 'Depreciation Fund', method: 'gf_transfer',
        uses: 'Buying costly capital items over time (buses, equipment, technology, building work) so the cost doesn’t fall on one year’s taxes. Filled by transfers from the General Fund; the board designates its uses (NDE Rule 2). Its balance counts toward the General Fund’s allowable reserve (79-1027).' },
      ppel: { on: true, label: 'Special Building', long: 'Special Building Fund', method: 'lid_shared', maxRate: 0.14,
        uses: 'Acquiring sites, buying existing buildings, and building, remodeling, equipping and furnishing school buildings and additions (79-10,120). Up to 14¢ per $100, inside the $1.05 lid. Building projects can’t be paid from the General Fund.' },
      vppel: { on: true, label: 'QCPUF', long: 'Qualified Capital Purpose Undertaking Fund levy', method: 'flat_years', voter: false, maxRate: 0.03, maxYears: 10,
        uses: 'Only abating environmental hazards, accessibility barriers, life-safety code violations and hazards, mold, and school safety infrastructure concerns in existing buildings and grounds; not new buildings, additions or other remodeling (79-10,110.02). Up to 3¢ per $100 for up to 10 years, adopted by the board without a vote.' },
      grants: { on: true, label: 'Grants/Donations', long: 'Grants and donations' },
      boost: { on: true, label: 'Boosters', long: 'Boosters' },
      camp: { on: true, label: 'Campaign/Bond', long: 'Campaign or bond' },
      general: { on: true, label: 'General Fund', long: 'General Fund' },
      debt_levy: { on: true, label: 'Bond Fund levy', long: 'Bond Fund levy' },
    },
    legal: {
      funds: ['save', 'ppel', 'vppel'],
      yearly: { salary: 'no', benefits: 'no', supplies: 'no', activities: 'no', contract: 'check', other: 'check' },
      type: { capital: 'ok', technology: 'check', program: 'check', other: 'check', staff: 'no', curriculum: 'no' },
      /* QCPUF pays only for its named purposes; the Depreciation Fund is for capital outlay, technology hardware included */
      typeByFund: { vppel: { capital: 'check' }, save: { technology: 'ok' } },
      cite: { save: 'NDE Rule 2, 003.03B', ppel: 'Neb. Rev. Stat. 79-10,120', vppel: 'Neb. Rev. Stat. 79-10,110.02' },
      okNote: { save: 'The board designates what the Depreciation Fund is for (NDE Rule 2); check this purchase is one of them.' },
      checkNote: { vppel: '; QCPUF pays only for hazards, accessibility, life-safety and school safety infrastructure in existing buildings' },
      checkText: { vppel: 'QCPUF pays only to abate environmental hazards, accessibility barriers, life-safety code violations and hazards, mold, or school safety infrastructure concerns in existing buildings and grounds, not new buildings or additions ({cite}). Confirm with the business office that this project qualifies.' },
    },
    defaultFund: 'ppel',
    financing: ['go', 'lease', 'gift'],   // no SAVE-style revenue bond
    /* no school debt limit: the school bond statutes (10-701 to 10-719) set no cap on bonded debt, and voter-approved bond levies
       are outside the levy limits (77-3442(1)); checked 14 Nov 2026 [verified]. What limits a bond is the vote and the levy */
    debt: { limitShare: null, limitBasis: null, limitStatus: 'verified', limitCite: 'Neb. Rev. Stat. 10-701 to 10-719 (no limit); 77-3442(1)', vote: 0.50, voteStatus: 'verified', voteCite: 'Neb. Rev. Stat. 10-702' },
    features: { sf2472: false, saveBond: false, prefill: true, peers: true, car: false, gfIowa: false, dataSources: true, teeosa: true },
    prefill: 'NE',
    gf: 'NE', tax: 'NE',
    /* the three limits (NDE, verified): the $1.05 levy lid on General + Special Building; the Special Building levy ≤14¢;
       property tax request authority on General + Special Building: 3% base growth plus membership, LEP and poverty growth,
       plus 4–7% with a 70% board vote; prior years' unused authority is added each year (NDE 2026/27 certification, column
       "Prior Years Unused Property Tax Authority"). QCPUF (≤3¢) and the Bond Fund are outside the lid. */
    lid: { levy: 1.05, sbMax: 0.14, qcpufMax: 0.03, baseGrowth: 0.03, boardVote: 0.70,
      boardBump: [[471, 0.07], [3044, 0.06], [10000, 0.05], [Infinity, 0.04]],
      /* Special Building: 14¢ by the board (79-10,120; the statute has said 14¢ since at least 2006, and a full-text search of
         the Revised Statutes on 14 Nov 2026 found no 17.5¢ school levy). NDE's budget instructions and budgeting FAQ say
         "14¢ or 17.5¢ with a vote of their patrons": that vote is a levy override (77-3444: a majority of voters, at most
         five years, "for building construction, remodeling, or site acquisition"), so HighGround models the 17.5¢ only
         inside a levy override's years. A new override doesn't raise the property tax request authority unless 60% of voters
         also approve exceeding it (79-3405(1)); overrides approved before 1 Jan 2024 keep their authority (79-3405(3)). */
      sbVoterMax: 0.175, sbVoterStatus: 'recalled', sbVoterCite: 'NDE 2026/27 budget instructions and budgeting FAQ; levy override, Neb. Rev. Stat. 77-3444',
      overrideMaxYears: 5, overrideCite: 'Neb. Rev. Stat. 77-3444', overrideAuthorityVote: 0.60,
      /* base growth percentage (79-3402(3), School District Property Tax Limitation Act; verified against NDE's 2026/27
         certification): 3% + the yearly rise in fall membership × 1 (average rise ≥3% a year over the preceding three years
         and ≥150 students), × 0.7 (average ≥3%), else × 0.4; + the rise in LEP students ÷ membership × 0.15; + the rise in
         poverty students ÷ membership × 0.15. A fall counts as 0. */
      growthRule: { base: 0.03, tiers: [[0.03, 150, 1], [0.03, 0, 0.7]], otherFactor: 0.4, lepFactor: 0.15, povertyFactor: 0.15, cite: 'Neb. Rev. Stat. 79-3402(3)' } },
    /* allowable General Fund reserve (79-1027), counting the Depreciation and Employee Benefit funds, by average daily membership */
    reserve: [[471, 0.45], [3044, 0.35], [10000, 0.25], [Infinity, 0.20]],
    /* TEEOSA (Tax Equity and Educational Opportunities Support Act) constants, 2026/27 certification (NDE FAQ, verified) */
    teeosa: { localEffortRate: 1.00, foundationPerStudent: 1500, foundationResourceShare: 0.60, checked: '2026-11-12' },
    hide: ['[name="save_receipts_fy"]', '[name="sf2472"]', '[data-lever="sf"]', 'option[value="rev"]', '[name="actual_valuation"]', '[data-st-only="IA"]'],
    /* NDE 2025/26 AFR master code list, by fund [verified]: 01 General, 02 Depreciation, 03 Employee Benefit, 04 Contingency,
       05 Activity, 06 Nutrition, 07 Bond, 08 Special Building, 09 QCPUF, 10 Cooperative, 12 Student Fee */
    glFunds: { '01': 'general', '02': 'save', '03': 'other', '04': 'other', '05': 'other', '06': 'other', '07': 'debt_levy', '08': 'ppel', '09': 'vppel', '10': 'other', '12': 'other' },
    balanceCodes: { save: '02', ppel: '08', vppel: '09' },
    say: [
      [/SAVE, PPEL, V-PPEL/g, 'Depreciation, Special Building, QCPUF'],
      [/SAVE, PPEL and V-PPEL/g, 'Depreciation, Special Building and QCPUF'],
      [/SAVE, PPEL or V-PPEL/g, 'Depreciation, Special Building or QCPUF'],
      [/SAVE\/PPEL\/V-PPEL/g, 'Depreciation/Special Building/QCPUF'],
      [/SAVE revenue[- ]bonds?( room)?/g, 'revenue bond'],
      [/SAVE receipts trend/g, 'Depreciation transfers, change a year'], [/SAVE receipts change/g, 'Depreciation transfers change'],
      [/SAVE receipts/g, 'Depreciation transfers'], [/SAVE balance/g, 'Depreciation balance'], [/SAVE bond room/g, 'Revenue bond room'],
      [/Secure an Advanced Vision for Education/g, 'Depreciation Fund'],
      [/[Vv]oter-approved PPEL/g, 'QCPUF levy'], [/a new V-PPEL\b/g, 'a new QCPUF levy'], [/\bV-PPEL\b/g, 'QCPUF'],
      [/, spending authority and what/g, ' and what'], [/spending authority/g, 'budget authority'],
      [/the purchases the vote names/g, 'the purchases the board’s resolution names'],
      [/whatever the ballot measure names, often devices or buses/g, 'hazard, accessibility, life-safety and safety work'],
      [/\bPPEL valuation growth\b/g, 'Valuation growth'],
      [/\bPPEL\b/g, 'Special Building'], [/\bSAVE\b/g, 'Depreciation'],
      [/Iowa Code 298\.3/g, 'Neb. Rev. Stat. 79-10,120'], [/Iowa Code 423F\.3/g, 'NDE Rule 2'],
      [/debt service levy/g, 'Bond Fund levy'], [/Debt service levy/g, 'Bond Fund levy'],
      [/per \$1,000/g, 'per $100'], [/\$\/1,000/g, '¢/$100'],
      [/Certified Annual Report/g, 'Annual Financial Report'],
      [/\bAEA\b/g, 'ESU'],
      [/the Iowa Department of Management/g, 'the county assessor'], [/Iowa Department of Management/g, 'county assessor'],
      [/Iowa law/g, 'Nebraska law'], [/Iowa’s/g, 'Nebraska’s'], [/\bIowa\b/g, 'Nebraska'],
      [/Solvency ratio/g, 'Fund balance ratio'], [/solvency ratio/g, 'fund balance ratio'],
      [/General Fund solvency/g, 'General Fund balance ratio'], [/Solvency target/g, 'Fund balance target'],
      [/\bSolvency\b/g, 'Fund balance ratio'], [/\bsolvency\b/g, 'fund balance ratio'],
      [/IPERS/g, 'school retirement'], [/\bISFIS\b/g, 'school finance advisors'],
      [/\bCertified enrollment\b/g, 'Enrollment (fall membership)'], [/\bcertified enrollment\b/g, 'fall membership'],
      [/The CSIP itself is filed with the Department of Education in CASA/g, 'The continuous improvement plan itself is reviewed through NDE’s Rule 10 accreditation process'],
      [/Academic goals \(CSIP\)/g, 'Improvement goals (Rule 10)'], [/state CSIP goals/g, 'Rule 10 improvement goals'], [/\(CSIP\)/g, '(Rule 10)'], [/\bCSIP\b/g, 'Rule 10'],
      [/Iowa Administrative Code 281-12\.8/g, '92 NAC 10'],
    ],
  };

  const PACKS = { IA, NE };
  const DEFAULT = 'IA';
  let CURRENT = DEFAULT;

  const pack = (code) => PACKS[String(code || '').toUpperCase()] || PACKS[DEFAULT];
  const has = (code) => !!PACKS[String(code || '').toUpperCase()];
  const list = () => Object.values(PACKS).map((p) => ({ code: p.code, name: p.name, status: p.status }));
  /** the pack the screens use now (the browser shows one district at a time) */
  const use = (code) => { CURRENT = has(code) ? String(code).toUpperCase() : DEFAULT; return PACKS[CURRENT]; };
  const current = () => PACKS[CURRENT];

  const fund = (k, code) => (pack(code || CURRENT).funds[k] || { on: true, label: k, long: k });
  const label = (k, code) => fund(k, code).label;
  const longLabel = (k, code) => fund(k, code).long || fund(k, code).label;
  const on = (k, code) => fund(k, code).on !== false;
  /** [key, label] pairs for a picker, in the order given, leaving out funds the state doesn't have */
  const pairs = (keys, code, long) => keys.filter((k) => on(k, code)).map((k) => [k, long ? longLabel(k, code) : label(k, code)]);
  /** "Special Building, QCPUF and grants": the state's capital funds, in words */
  function capList(code, opts) {
    const o = opts || {}, ks = ['save', 'ppel', 'vppel', 'grants'].concat(o.gf ? ['general'] : []).filter((k) => on(k, code));
    const ws = ks.map((k) => (k === 'grants' ? 'grants' : k === 'general' ? 'the General Fund' : label(k, code)));
    return ws.length < 2 ? ws.join('') : ws.slice(0, -1).join(', ') + (o.or ? ' or ' : ' and ') + ws[ws.length - 1];
  }
  const defaultFund = (code) => pack(code || CURRENT).defaultFund || 'save';
  const feature = (name, code) => !!pack(code || CURRENT).features[name];

  /** a screen's HTML in the state's words. Iowa (and any pack without a list) comes back unchanged. */
  function say(html, code) {
    const p = pack(code || CURRENT);
    if (!p.say || html == null) return html;
    let s = String(html);
    p.say.forEach(([re, to]) => { s = s.replace(re, to); });
    return s;
  }

  /* fiscal years by the state's calendar. Named for the year they end. The last day before the year starts counts as
     the next year's opening balance (Iowa: a 30 June close; Nebraska: a 31 August close). */
  function fyOfDate(iso, code) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], sm = pack(code || CURRENT).fyStartMonth || 7;   // no state given: the one on screen
    if (sm === 1) return y;
    if (mo >= sm) return y + 1;
    const lastDay = new Date(Date.UTC(y, sm - 1, 0)).getUTCDate();   // last day of the month before the year starts
    if (mo === sm - 1 && d === lastDay) return y + 1;
    return y;
  }
  /** the first and last day of a fiscal year, as ISO dates */
  function fyRange(fy, code) {
    const sm = pack(code || CURRENT).fyStartMonth || 7;
    const start = new Date(Date.UTC(sm === 1 ? fy : fy - 1, sm - 1, 1)), end = new Date(Date.UTC(sm === 1 ? fy + 1 : fy, sm - 1, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** "June 30" / "August 31": the day a fiscal year closes */
  function closeDay(code) { const sm = pack(code || CURRENT).fyStartMonth || 7, mi = (sm + 10) % 12; return `${MONTHS[mi]} ${new Date(Date.UTC(2001, mi + 1, 0)).getUTCDate()}`; }

  /** Nebraska's board-approved extra growth (70% vote), by average daily membership */
  /** the month the fiscal year starts (1–12) */
  const fyStartMonth = (code) => pack(code || CURRENT).fyStartMonth || 7;
  function boardBump(adm, code) {
    const L = pack(code).lid; if (!L) return 0;
    const n = Number(adm) || 0; for (const [cap, pct] of L.boardBump) if (n <= cap) return pct;
    return 0;
  }

  /** Nebraska's allowable General Fund reserve share (79-1027) for an average daily membership; null where none */
  function reserveShare(adm, code) {
    const R = pack(code || CURRENT).reserve; if (!R) return null;
    const n = Number(adm) || 0; for (const [cap, pct] of R) if (n <= cap) return pct;
    return null;
  }
  return { PACKS, DEFAULT, reserveShare, defaultFund, pack, has, list, use, current, fund, label, longLabel, on, pairs, capList, feature, say, fyOfDate, fyRange, closeDay, fyStartMonth, boardBump };
});
