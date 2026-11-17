/* HighGround: Nebraska through the engine, taxes and the General Fund (11 Nov 2026). Run: node nebraska_test.js
   Uses the fictional Prairie Fork demo. Iowa is checked separately by engine_test.js (golden, 0 differences). */
const E = require('./engine.js'), C = require('./capital.js'), T = require('./tax.js'), G = require('./gf.js'), D = require('./demo_data.js'), S = require('./states.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.5 : tol);
let i = 0; const demo = D['prairie-fork'], R = C.demoRows(demo, 'dNE', () => 'id' + (++i));
const rows = { district: { name: demo.name, state: 'NE' }, settings: R.district_settings[0], balances: R.fund_balance, debts: R.debt_obligation, scenarios: R.scenario,
  initiatives: R.initiative, phases: R.phase, funding: R.phase_funding, financing: R.financing, recurring: R.recurring_cost, scenario_initiative: R.scenario_initiative, assumption_sets: [] };
check('demo is Nebraska and stores its lid figures', demo.state === 'NE' && R.district_settings[0].state_inputs && R.district_settings[0].state_inputs.lid.gfRate === 0.82);
check('demo ledger: September, October and November month-ends (fiscal year starts September 1)', R.import_batch.map((x) => x.period_end).join() === '2026-09-30,2026-10-31,2026-11-30' && R.import_batch.every((x) => x.fiscal_year === 2027));
check('demo ledger: NDE account codes (fund-type-code-object) and Nebraska funds', R.gl_account.every((a) => /^\d{2}-[12]-\d{5}-\d{3}$/.test(a.code)) && R.gl_account.some((a) => a.code === '01-1-03110-000') && R.gl_account.some((a) => a.code.startsWith('08-1-')) && R.gl_account.some((a) => a.mapped_fund === 'save'));
check('demo ledger: the Depreciation transfer leaves the General Fund and arrives in the Depreciation Fund', R.gl_account.some((a) => a.code === '01-2-08000-911') && R.gl_account.some((a) => a.code === '02-1-05200-000'));
S.use('NE'); const Bg = require('./budget.js'), lastB = R.import_batch[2], SUM = Bg.summarize(R.gl_account, R.gl_amount.filter((a) => a.batch_id === lastB.id), lastB.period_end, 'budget'); S.use('IA');
check('demo ledger: budget vs. actual reads it, a quarter of the Nebraska year gone by November 30', SUM.gone === 0.25 && SUM.funds.some((f) => f.key === 'general' && Object.keys(f.byFunction).length >= 8));
const base = R.scenario.find((x) => x.is_board_version), b = C.buildInputs(rows, base.id), cfg = b.cfg, L = b.levers;
check('settings carry the state', cfg.state === 'NE' && cfg.settings.state === 'NE');
check('31 August balances open FY2027 (September–August year)', cfg.start === 2027 && cfg.f0 === 1);
check('the SAVE slot is the Depreciation Fund: its balance and planned General Fund transfers', cfg.open.save === 760000 && cfg.saveInc === 150000 && near(E.inflow(cfg, 'save', 3, L), 150000));
check('Depreciation transfers have no SF 2472 cut and no SAVE bond room', near(E.receiptsIn(cfg, 'save', 5, L), 150000) && E.saveBondCapacity(cfg, L, 0.045, 20, 1.2).pv === 0);
// unused property tax authority carries forward
const cfgC = E.makeConfig(Object.assign({}, cfg.settings, { lid: Object.assign({}, cfg.settings.lid, { carry: 100000 }) }));
const c0 = E.lidRoom(cfgC, 0, L), c1 = E.lidRoom(cfgC, 1, L);
check('carry-forward: prior unused authority adds to this year’s room', near(c0.byAuth, 6866000 + 100000 - 6396000) && c0.carryIn === 100000);
check('carry-forward: what a year leaves unused carries into the next', near(c1.carryIn, 6866000 + 100000 - 6396000 - c0.receipts) && near(c1.byAuth, 6866000 * 1.03 + c1.carryIn - 6396000 * 1.03, 1));
check('carry-forward in the demo: year 0 is held by the rate, so its unused authority lifts year 1', near(E.lidRoom(cfg, 1, L).carryIn, (6866000 - 6396000) - 468000));
check('no SF 2472 in Nebraska', L.sf === false);
// the lid: year 0 limited by the rate, later years by the request authority (3%) while valuation grows 4%
const y0 = E.lidRoom(cfg, 0, L), y5 = E.lidRoom(cfg, 5, L);
check('year 0: Special Building = rate × valuation (6¢ on $780M)', near(y0.receipts, 0.06 * 780000000 / 100) && y0.limit === 'rate', y0);
check('year 0: authority room = authority − General Fund levy', near(y0.byAuth, 6866000 - 0.82 * 780000000 / 100));
check('year 5: the request authority binds (grows 3%, valuation 4%)', y5.limit === 'authority' && near(y5.receipts, (6866000 - 6396000) * Math.pow(1.03, 5), 1), y5);
check('lid room: $1.05 less the General Fund levy', near(y0.byLid, 1.05 * 780000000 / 100 - 6396000));
check('receiptsIn(ppel) uses the lid', near(E.receiptsIn(cfg, 'ppel', 5, L), y5.receipts));
// no lid figures: receipts grow with valuation, as in Iowa
const cfg2 = E.makeConfig(Object.assign({}, cfg.settings, { lid: {}, ppel: Object.assign({}, cfg.settings.ppel, { rate: null }) }));
check('without lid figures, receipts grow with valuation', near(E.receiptsIn(cfg2, 'ppel', 2, L), 468000 * 1.04 * 1.04, 1));
const cfg3 = E.makeConfig(Object.assign({}, cfg.settings, { lid: Object.assign({}, cfg.settings.lid, { boardBump: true }) }));
check('board bump: 6% more growth for a 640-student district (472–3,044)', near(cfg3.lid.growth, 0.09, 1e-9));
// a rate above 14¢ is held to 14¢
const cfg4 = E.makeConfig(Object.assign({}, cfg.settings, { lid: {}, ppel: Object.assign({}, cfg.settings.ppel, { rate: 0.20 }) }));
check('Special Building rate held to 14¢', near(E.receiptsIn(cfg4, 'ppel', 0, L), 0.14 * 780000000 / 100));
// whole plan
const r = E.compute(b.projects, L, cfg);
check('board version runs: the shop addition is the gap', r.overflow < 0.5 && r.gap > 4e6 && r.gap < 5e6, r.gap);
const noq = C.buildInputs(rows, R.scenario.find((x) => x.name === 'Without the QCPUF levy').id), r2 = E.compute(noq.projects, noq.levers, noq.cfg);
check('without the QCPUF levy the safety projects run over', r2.overflow > 1e5);
const bond = C.buildInputs(rows, R.scenario.find((x) => /bond/.test(x.name)).id), r3 = E.compute(bond.projects, bond.levers, bond.cfg);
check('the bond covers the shop', r3.financed === 3800000 && r3.gap < 1e6);
check('Nebraska has no debt limit check and no SAVE bond room', E.goDebtRoom(cfg, L) === null && E.saveBondCapacity(cfg, L, 0.045, 20, 1.2).pv === 0);
check('no SAVE revenue bond: a "rev" entry reads as GO', E.cleanFin([{ kind: 'rev', amount: 1 }], cfg)[0].kind === 'go');
// fund rules
const issues = E.checkLegal(b.projects, L, 'NE');
check('QCPUF projects are flagged to confirm they qualify', issues.filter((x) => x.fund === 'vppel').length === 3 && issues.every((x) => x.level === 'check'));
check('QCPUF wording names its purposes', /accessibility barriers, life-safety/.test(issues.find((x) => x.fund === 'vppel').text));
check('Special Building can’t pay salaries', E.legality('ppel', { kind: 'salary' }, 'NE').level === 'no' && /Special Building can’t/.test(E.legality('ppel', { kind: 'salary' }, 'NE').text));
check('Iowa rules unchanged', E.legality('save', { type: 'capital' }, 'IA').text === 'SAVE uses must be covered by the district’s revenue purpose statement.');
check('a phase with no fund defaults to Special Building', E.cleanPhases([{ cost: 1, year: 0 }], cfg)[0].funding[0].b === 'ppel' && E.cleanPhases([{ cost: 1, year: 0 }], E.makeConfig({}))[0].funding[0].b === 'save');
// mid-year balances: September–August year
const fr = E.firstYearFraction('2026-10-31', 'NE');
check('balances at 31 Oct: 10 of 12 months left', fr.months === 10 && near(fr.f * 12, 10, 0.01), fr);
// taxes: per $100, homes at full value, farmland 75% (50% for bonds)
const im = T.impact(bond.cfg, bond.levers, bond.tax), pk = im.peak;
check('tax: rate per $100', im.per === 100 && near(pk.rate, pk.added / (pk.valuation / 100), 1e-9));
check('tax: a $210,000 home pays value ÷ 100 × rate', near(pk.home, 210000 / 100 * pk.rate, 1e-6));
const goR = pk.go / (pk.valuation / 100), qR = pk.vppel / (pk.valuation / 100);
check('tax: farmland at 50% for the bond and 75% for QCPUF', near(pk.farm100k, 100000 / 100 * (goR * 0.5 + qR * 0.75), 1e-6));
// General Fund
const gf = demo.settings.gf, run = G.forecastFor('NE', gf, gf.assume, [2027, 2028, 2029, 2030, 2031]);
const y = run.years[0];
check('GF: revenue = property tax + TEEOSA aid + other state aid + other income', near(y.revenue, 6396000 + y.stateAid + 250000 + 900000));
check('GF: TEEOSA for the demo: no equalization aid (resources above need), foundation aid $1,500 × 600, plus income tax', y.teeosa.eq === 0 && near(y.stateAid, 1500 * 600 + 60000));
// TEEOSA reproduces NDE's 2026/27 certification (State Aid Calculated by System, rows for three districts)
[['Kenesaw', 5422530, 6105849, 285765, 43222, 819713, 237907, 158605, 7492456, 0, 725499],
 ['Hastings', 47967508, 19082107, 0, 554474, 10018193, 2900796, 1933864, 32555570, 15411938, 20801072],
 ['Adams Central', 15274155, 25869243, 340719, 242098, 3774967, 860609, 573740, 31087636, 0, 2017166]].forEach(([n, need, local, option, itr, other, fIn, fOut, res, eq, calc]) => {
  const t = G.teeosa({ need, local, option, itr, other, students: (fIn + fOut) / 1500 }, 0, {});
  check(`TEEOSA matches NDE for ${n}: resources, equalization aid and calculated aid`, near(t.resources, res, 1) && near(t.eq, eq, 1) && near(t.aid, calc, 1), [t.resources, t.eq, t.aid]);
});
const rr = G.forecastNE(gf, gf.assume, [2027, 2028], { 2027: 0, 2028: 0 }, { reserveShare: 0.35, otherReserve: { 2027: 5e6, 2028: 5e6 } });
check('GF: the allowable reserve (79-1027) is flagged when General + Depreciation balances pass 35% of the budget', rr.flags.reserveOver.length === 2 && near(rr.years[0].reserveAllowed, 0.35 * rr.years[0].spending, 1e-6));
check('GF: property tax grows with the authority (3%)', near(run.years[2].propertyTax, 6396000 * 1.03 * 1.03, 1));
check('GF: fund balance ratio = balance ÷ revenue', near(y.solvency, y.balance / y.revenue, 1e-12));
check('GF: no Iowa spending authority', y.authority === null && run.flags.negativeUnspent.length === 0 && run.state === 'NE');
check('GF: Iowa still gets Iowa’s forecast', G.forecastFor('IA', D['bridger-hollow'].settings.gf, D['bridger-hollow'].settings.gf.assume, [2027, 2028]).years[0].dcpp > 0);

// NDE public data (part 35's ne_prefill) → the setup forms (nedata.js); peers wording (peers.js)
const N = require('./nedata.js'), PR = require('./peers.js');
const raw = { agency_id: '99-0001-000', name: 'PRAIRIE FORK PUBLIC SCHOOLS',
  stat: { fiscal_year: 2026, valuation: 612345678, gen_levy: 0.8123, sb_levy: 0.045, qcpuf_levy: 0.01, bond_levy: 0.0911, mem_total: 600, source: 'NDE Statistical Information 2025/26' },
  aid: { fiscal_year: 2027, formula_need: 8300000, local_effort: 6123457, option_funding: 0, income_tax: 60000, other_receipts: 900000, formula_students: 600.12, calc_aid: 1636615, source: 'NDE 2026/27 state aid certification' },
  pta: { fiscal_year: 2027, gf_ask: 4145194, authority: 5126579, prior_unused: 440433, base_growth_rate: 0.0695, board_pct: 0.07, source: 'NDE 2026/27 PTA certification' },
  afr: { fiscal_year: 2025, balances: { general: 3016870, save: 790628, ppel: 936270, vppel: 124836, employee_benefit: 0 }, receipts: { ppel: 676195, vppel: 187254, save: 156045 },
    general: { revenue: 10298970, property_tax: 6283412, state_aid: 998688, sped: 416120, other_state: 624180, other_financing: 72821, expenditures: 9830835 },
    debt_payments: { ppel: 75942, debt_levy: 348500 }, source: 'NDE Annual Financial Report, 2024/25' } };
const ad = N.adapt(raw);
check('NDE prefill: balances and receipts land in the Depreciation, Special Building and QCPUF slots', ad.values.bal_save === 790628 && ad.values.bal_ppel === 936270 && ad.values.bal_vppel === 124836 && ad.values.save_receipts === 156045 && ad.values.ppel_receipts === 676195 && ad.values.vppel_annual === 187254, ad.values);
check('NDE prefill: fall membership, valuation and levies', ad.values.enrollment === 600 && ad.values.taxable_valuation === 612345678 && ad.values.ppel_rate === 0.045 && ad.values.lid_gf_rate === 0.8123 && ad.values.enrollment_year === '2025-26');
check('NDE prefill: authority without the carry, and the carry on its own (HighGround adds the carry back each year)', ad.values.lid_authority === 5126579 - 440433 && ad.values.lid_carry === 440433 && ad.values.lid_growth === undefined);
check('NDE prefill: a QCPUF levy on the books makes QCPUF active', ad.values.vppel_status === 'active');
check('NDE prefill: TEEOSA figures and formula students for the General Fund', ad.teeosa.need === 8300000 && ad.teeosa.local === 6123457 && ad.teeosa.students === 600.12 && ad.gf.enrollment === 600.12 && ad.gf.state_aid === 1636615);
check('NDE prefill: General Fund property tax is this year’s request; other income = revenue less tax, aid, other state aid and financing', ad.gf.property_tax === 4145194 && ad.gf.misc_income === Math.round(10298970 - 6283412 - 998688 - 624180 - 72821) && ad.gf.fund_balance === 3016870);
check('NDE prefill: the year-end is August 31 in every label, and the Employee Benefit row is left out at $0', ad.rows.filter((r) => /cash/.test(r[0])).every((r) => /August 31/.test(r[0])) && !ad.rows.some((r) => /Employee Benefit/.test(r[0])));
check('NDE prefill: the shape Iowa screens read', ad.balances.ppel === 936270 && ad.receipts.save === 156045 && ad.latest_enrollment.certified === 600 && ad.fiscal_year === 2025);
const tz = G.teeosa({ need: ad.teeosa.need, local: ad.teeosa.local, option: 0, itr: ad.teeosa.itr, other: ad.teeosa.other, students: ad.teeosa.students }, 0, {});
check('NDE prefill: the filled TEEOSA figures reproduce the certified aid', near(tz.aid, raw.aid.calc_aid, 2), tz);
check('NDE prefill: no district, no figures', N.adapt(null) === null && N.adapt({}) === null && N.adapt({ agency_id: 'x' }).rows.length === 0);
check('NDE agency IDs: typed loosely, stored the NDE way', N.agencyId('01-0003-000') === '01-0003-000' && N.agencyId('010003000') === '01-0003-000' && N.agencyId('1-3-0') === '01-0003-000' && N.agencyId('0003') === null);
check('NDE GF summary sentence', N.gfItems(ad).some((x) => /TEEOSA: need \$8,300,000/.test(x)));
const pr = [{ measure_key: 'exp|Special Building|TOTAL', fund: 'Special Building', line: 'TOTAL', grp: 'main', flag: 'high', callout: 'x', unit: 'per_pupil' },
  { measure_key: 'bal|General|RESERVE_PCT', fund: 'General', line: 'RESERVE_PCT', grp: 'main', flag: 'low', callout: 'y', unit: 'pct' }];
check('peers: Nebraska capital funds show on the capital screen', PR.pick(pr, 'capital').length === 1 && PR.label(pr[0]) === 'Special Building Fund · total spending');
check('peers: Nebraska reserve label and NDE source line', /Depreciation and Employee Benefit/.test(PR.label(pr[1])) && /Annual Financial Report to NDE/.test(PR.cardHtml(pr, { fy: 2025, source: 'the district’s Annual Financial Report to NDE', basis: 'NDE fall membership' })));
check('peers: the overview line names the state', /similar Nebraska districts/.test(PR.overviewLine(pr, 'Nebraska')) && /similar Iowa districts/.test(PR.overviewLine(pr)));

// ---- 12 Nov (b): the base growth formula, Special Building to 17.5¢ by vote, the school tax credit, Employee Benefit and Contingency funds
const RULE = S.pack('NE').lid.growthRule;
const kg = E.authorityGrowth(RULE, [253, 259, 246, 238], 22 / 238, 0.6 / 238 * 0.15 * 0 + 0.0025210084, 2);
check('base growth: NDE’s formula gives NDE’s 2026/27 rate for a district (membership 238 → 260 × 0.4, plus poverty)', near(kg[1], 0.069495798319, 1e-9), kg);
check('base growth: ×0.7 when membership grew ≥3% a year for three years', near(E.authorityGrowth(RULE, [1000, 1040, 1080, 1120], 0.04, 0, 2)[1], 0.03 + 0.04 * 0.7, 1e-9));
check('base growth: ×1 when that is also ≥150 students', near(E.authorityGrowth(RULE, [3000, 3100, 3200, 3300], 0.04, 0, 2)[1], 0.07, 1e-9));
check('base growth: a falling membership adds nothing (3%)', near(E.authorityGrowth(RULE, [500, 490, 480], -0.02, 0, 2)[1], 0.03, 1e-12));
const lidS = (extra) => { const st = JSON.parse(JSON.stringify(demo.settings)); st.state = 'NE'; st.balances.asOf = '2026-08-31'; st.lid = Object.assign({}, st.lid, extra); return E.makeConfig(st, '2026-11-12'); };
const cF = lidS({ growth: null, memHist: [600, 610, 620, 640], memGrowth: 0.01, lepPov: 0.001 }), cX = lidS({});
check('lid: no growth typed + fall membership → NDE’s formula each year', cF.lid.formula && near(cF.lid.growthPath[1], 0.03 + 0.01 * 0.4 + 0.001, 1e-12) && near(cF.lid.authF[3], Math.pow(1.035, 3), 1e-9));
check('lid: a growth typed by hand is used every year (as before)', !cX.lid.formula && near(cX.lid.authF[2], 1.03 * 1.03, 1e-12));
check('lid: the authority each year follows the path', near(E.lidRoom(cF, 2, {pg: 0.04}).authority, 6866000 * cF.lid.authF[2], 1e-6));
const cV = lidS({ sbVoter: true }); const stV = JSON.parse(JSON.stringify(demo.settings)); stV.ppel.rate = 0.17;
check('Special Building: up to 17.5¢ with voter approval, still inside the lid and the authority', cV.lid.sbMax === 0.175 && cX.lid.sbMax === 0.14 && cV.lid.sbVoter);
const rV = E.lidRoom(Object.assign({}, cV, { lid: Object.assign({}, cV.lid, { sbRate: 0.17 }) }), 0, { pg: 0 }), rX = E.lidRoom(Object.assign({}, cX, { lid: Object.assign({}, cX.lid, { sbRate: 0.17 }) }), 0, { pg: 0 });
check('Special Building: a 17¢ rate counts in full with the vote, 14¢ without', near(rV.byRate, 0.17 * 780000000 / 100) && near(rX.byRate, 0.14 * 780000000 / 100));
// the school tax credit (77-7305): QCPUF levies get it, bond levies don't
const tq = T.impact(bond.cfg, { vppel: true, fin: [] }, bond.tax), tb = T.impact(bond.cfg, bond.levers, bond.tax);
const yq = tq.taxed[0];
check('tax credit: a new QCPUF levy costs a home about (1 − 26.2%) after the credit', yq && near(yq.homeNet, yq.home * (1 - 0.262), 1e-6) && tq.credit.share === 0.262, yq);
const yb = tb.taxed.find((x) => x.go > 0 && !x.vppel) || tb.taxed.find((x) => x.go > 0);
const goPart = yb.go / (yb.valuation / 100), qPart = yb.vppel / (yb.valuation / 100);
check('tax credit: a bond levy gets none of it', near(yb.homeNet, 210000 / 100 * (goPart + qPart * (1 - 0.262)), 1e-6));
const tOwn = T.impact(bond.cfg, { vppel: true, fin: [] }, Object.assign({}, bond.tax, { creditShare: 0.3 }));
check('tax credit: the district can enter its county’s share', near(tOwn.taxed[0].homeNet, tOwn.taxed[0].home * 0.7, 1e-6) && tOwn.credit.own);
check('tax credit: farmland after the credit (75% of value, non-bond part)', near(yq.farm100kNet, yq.farm100k * (1 - 0.262), 1e-6));
// Employee Benefit and Contingency funds in the General Fund forecast
const gfE = Object.assign({}, gf, { funds: { eb: { balance: 200000, transfer: 50000, use: 80000 }, cont: { balance: 100000, transfer: 20000, use: 600000 } } });
const rE = G.forecastNE(gfE, gf.assume, [2027, 2028, 2029], {}, { reserveShare: 0.35, otherReserve: {} }), r0 = G.forecastNE(gf, gf.assume, [2027, 2028, 2029], {}, { reserveShare: 0.35, otherReserve: {} });
const e0 = rE.years[0], z0 = r0.years[0];
check('EB: transfers in count as General Fund spending; benefits it pays come off', near(e0.spending, z0.spending + 50000 + 20000 - 80000, 1e-6));
check('EB: its balance grows by the transfer less the benefits, and counts toward the allowable reserve', near(e0.ebBalance, 170000, 1e-6) && near(e0.reserve, e0.balance + 170000, 1e-6));
check('Contingency: pays only what it has; payouts over 5% of spending are flagged (79-1072)', near(e0.contUse, 120000, 1e-6) && near(e0.contBalance, 0, 1e-6) && rE.flags.contShort.includes(2027) && rE.funds);
const rC = G.forecastNE(Object.assign({}, gf, { funds: { cont: { balance: 2e6, use: 600000 } } }), gf.assume, [2027], {}, {});
check('Contingency: a payout above 5% of General Fund spending is flagged', rC.flags.contOver.includes(2027) === (600000 > 0.05 * rC.years[0].spending));
check('Contingency: not in the allowable reserve', near(rC.years[0].reserve, rC.years[0].balance, 1e-6));
const rP = G.forecastNE(Object.assign({}, gf, { ptax_growth: null }), gf.assume, [2027, 2028, 2029], {}, { authorityGrowth: [0, 0.05, 0.04] });
check('GF: property tax follows the authority’s formula growth when it has none of its own', near(rP.years[2].propertyTax, rP.years[0].propertyTax * 1.05 * 1.04, 1e-6));
const raw2 = JSON.parse(JSON.stringify(raw)); raw2.mem_hist = [{ fiscal_year: 2023, k12: 246 }, { fiscal_year: 2024, k12: 238 }, { fiscal_year: 2025, k12: 238 }, { fiscal_year: 2026, k12: 260 }];
raw2.afr.balances.employee_benefit = 120000; raw2.afr.balances.contingency = 50000; raw2.afr.funds = { eb_transfer: 30000, eb_paid: 25000, cont_transfer: 0, cont_paid: 0 };
raw2.pta.g_member = 0.0369; raw2.pta.g_lep = 0; raw2.pta.g_poverty = 0.0025;
const ad2 = N.adapt(raw2);
check('NDE prefill: K-12 fall membership for the formula, and the change ahead as the last three years’ average', ad2.values.lid_mem_hist === '246, 238, 238, 260' && near(ad2.values.lid_mem_growth, ((238 / 246 - 1) + 0 + (260 / 238 - 1)) / 3, 1e-4) && ad2.values.lid_growth === undefined);
check('NDE prefill: the certified year’s growth shown with its parts', ad2.rows.some((r) => /of which fall membership/.test(r[0]) && r[1] === 0.0369));
check('NDE prefill: Employee Benefit and Contingency funds for the General Fund', ad2.gf.funds.eb.balance === 120000 && ad2.gf.funds.eb.transfer === 30000 && ad2.gf.funds.eb.use === 25000 && ad2.gf.funds.cont.balance === 50000 && !('transfer' in ad2.gf.funds.cont));

// ---- General Fund budget authority (79-1023, 79-1025, 79-1030)
check('budget authority: NDE’s three methods give its certified figure (formula needs: 110% of need less SPED × 1.025)', near(Math.max(4925739 * 1.025, 4925739 + 0, 5422530 * 1.10 - 875000 * 1.025), 5067908, 1));
const z = G.forecastNE(gf, gf.assume, [2027], {}, {}).years[0];
const B0 = { authority: z.spending - 900000 - 100000 + 50000, unused: 120000, prior_adjusted: (z.spending - 1e6) / 1.03, sped: 900000, excluded: 100000, reserve_pct: 45 };
const rB = G.forecastNE(Object.assign({}, gf, { budget: B0 }), gf.assume, [2027, 2028, 2029, 2030, 2031], {}, { reserveShare: 0.35 });
const b0 = rB.years[0], b1 = rB.years[1];
const rS = G.forecastNE(Object.assign({}, gf, { budget: Object.assign({}, B0, { mode: 'spending' }) }), gf.assume, [2027, 2028], {}, {});
check('budget authority: the first year is NDE’s; spending under the limit leaves out SPED and exclusions', near(b0.budgetAuthority, B0.authority) && near(b0.budgetRestricted, b0.spending - 1e6, 1e-6) && near(b0.budgetRoom, B0.authority + Math.min(0.02 * B0.prior_adjusted, 120000) - b0.budgetRestricted, 1e-6));
const need1 = b1.teeosa ? b1.teeosa.need * 1.10 - 900000 * 1.025 : -Infinity;
check('budget authority: later years grow by the greater of 2.5% of last year’s adjusted budget and the formula-needs method', near(rS.years[1].budgetAuthority, Math.max(rS.years[0].budgetRestricted * 1.025, rS.years[1].teeosa ? rS.years[1].teeosa.need * 1.10 - 900000 * 1.025 : -Infinity), 1e-6));
check('budget authority: budgeting what it spends leaves unused authority, which carries forward', near(rS.years[0].budgetUnused, 120000 + (B0.authority - rS.years[0].budgetRestricted), 1e-6) && rS.budgetMode === 'spending');
check('budget authority: budgeting the whole authority (the default, as most districts do) adds no unused authority and grows the base 2.5%', rB.budgetMode === 'authority' && near(b0.budgetUnused, 120000, 1e-6) && near(b0.budgetAdopted, B0.authority, 1e-6)
  && near(b1.budgetAuthority, Math.max(B0.authority * 1.025, need1), 1e-6));
check('budget authority: NDE’s reserve % replaces the size rule', rB.reserveShare === 0.45 && rB.reserveFromNDE);
const rO = G.forecastNE(Object.assign({}, gf, { budget: Object.assign({}, B0, { authority: z.spending * 0.8, unused: 0 }) }), gf.assume, [2027, 2028], {}, {});
check('budget authority: spending above it is flagged (and counts as passing the spending limit)', rO.flags.budgetOver.includes(2027) && rO.flags.negativeUnspent.includes(2027));
const rN = G.forecastNE(gf, gf.assume, [2027], {}, {});
check('budget authority: none entered, no check', !rN.budget && rN.years[0].budgetAuthority === null && rN.flags.budgetOver.length === 0);
const raw3 = JSON.parse(JSON.stringify(raw)); raw3.budget = { fiscal_year: 2027, authority: 5067908, method: 'F', reserve_pct: 45, formula_need: 5422530, gfbe: 6195000, sgf: 303275, sped: 875000, gfle: 90986, adjusted: 4925739, two_pct: 98514.78, unused: 0 };
const ad3 = N.adapt(raw3);
check('NDE prefill: the certified budget authority and its parts for the General Fund', ad3.gf.budget.authority === 5067908 && ad3.gf.budget.prior_adjusted === 4925739 && ad3.gf.budget.sped === 875000 && ad3.gf.budget.excluded === 303275 + 90986 && ad3.gf.budget.reserve_pct === 45 && ad3.rows.some((r) => /budget authority, 2026\/27 \(formula needs\)/.test(r[0])));

// ---- review round 1: a QCPUF bond repaid from the QCPUF levy; uploads in Nebraska's words; fiscal-year dates
const cQ = lidS({}); const LQ = { vppel: true, fin: [{ name: 'QCPUF bond', kind: 'lease', fy: 2028, amount: 500000, rate: 0.04, years: 10, repay: 'vppel' }] };
const finQ = E.makeLevers ? null : null;
const st0 = JSON.parse(JSON.stringify(demo.settings)); st0.state = 'NE'; st0.balances.asOf = '2026-08-31'; st0.vppel.status = 'active';
const cA = E.makeConfig(st0, '2026-11-12'), Lq = Object.assign({}, b.levers, { vppel: true, fin: [{ name: 'QCPUF bond', kind: 'lease', fy: 2028, amount: 500000, rate: 0.04, years: 10, repay: 'vppel' }] });
const Lq2 = Object.assign({}, Lq, { fin: E.cleanFinancing ? E.cleanFinancing(Lq.fin) : Lq.fin.map((f) => Object.assign({}, f)) });
const dq = E.inflow(cA, 'vppel', 3, Lq2) - E.inflow(cA, 'vppel', 3, Object.assign({}, Lq2, { fin: [] }));
check('QCPUF bond: its payments come out of the QCPUF levy', near(dq, -E.pmt(500000, 0.04, 10), 1));
const U = require('./uploads.js'); S.use('NE');
const tpl = U.parseCSV(U.projectTemplate(2027)), btpl = U.parseCSV(U.balanceTemplate());
check('uploads: Nebraska’s project template uses its funds', tpl.slice(1).some((r) => r[4] === 'Special Building') && tpl.slice(1).every((r) => !/\bSAVE\b|\bPPEL\b|V-PPEL/.test(r.join(' '))));
check('uploads: Nebraska’s balance template has NDE fund numbers', btpl[0][1] === 'Nebraska fund number' && btpl.some((r) => r[0] === 'Special Building Fund' && r[1] === '08') && btpl.some((r) => r[0] === 'Depreciation Fund' && r[1] === '02'));
const pb = U.parseBalances([['Fund', 'Fund number', 'Balance'], ['Depreciation Fund', '02', '760000'], ['Special Building', '', '1,150,000'], ['', '09', '120000']]);
check('uploads: Nebraska balances read by name or NDE fund number', pb.found.save === 760000 && pb.found.ppel === 1150000 && pb.found.vppel === 120000, pb);
const pp = U.parseProjects([U.parseCSV(U.projectTemplate(2027))[0], ['Roof', '', 'FY2027', '100000', '', '', '', '', '', '', 'Must-have', 'Facilities', 'Estimate']], 2027, 10);
check('uploads: a project with no fund defaults to Special Building in Nebraska', pp.projects[0].phases[0].funding[0].b === 'ppel', pp.issues);
const Dn = require('./direction.js');
check('measures: FY2027 ends August 31, 2027 in Nebraska', Dn.periodEnd('FY2027') === '2027-08-31');
S.use('IA');
check('measures: and June 30 in Iowa', Dn.periodEnd('FY2027') === '2027-06-30');
check('uploads: Iowa’s templates unchanged', U.parseCSV(U.balanceTemplate())[0][1] === 'Iowa fund code' && U.parseCSV(U.projectTemplate(2027))[1][4] === 'SAVE');

// ---- 14 Nov: the student growth adjustment (79-1007.20, 79-1023(2)(b)); formula need's 100–112% band (79-1007.11)
const SGx = { students: 60, bfps: 18000, fm: 600 };
const rG = G.forecastNE(Object.assign({}, gf, { budget: Object.assign({}, B0, { sga: SGx }) }), Object.assign({}, gf.assume, { enroll: 0 }), [2027, 2028], {}, {});
const sgaWant = 18000 * (60 - 25) + 0.5 * 18000 * 25;
check('SGA: basic funding per formula student × (growth − the greater of 25 or 1% of membership) + half of it × that threshold', near(rG.years[1].sga, sgaWant, 1e-6) && rG.years[0].sga === 0);
check('SGA: it adds to TEEOSA need and can set the budget authority (method SGA)', near(rG.years[1].teeosa.need - G.forecastNE(Object.assign({}, gf, { budget: B0 }), Object.assign({}, gf.assume, { enroll: 0 }), [2027, 2028], {}, {}).years[1].teeosa.need, sgaWant, 1e-6)
  && rG.years[1].budgetAuthority >= B0.authority + sgaWant - 1e-6);
check('SGA: growth at or under the threshold gives none', G.forecastNE(Object.assign({}, gf, { budget: Object.assign({}, B0, { sga: { students: 20, bfps: 18000, fm: 600 } }) }), gf.assume, [2027, 2028], {}, {}).years[1].sga === 0);
const tLow = G.teeosa({ need: 1e6, local: 0, students: 100, need_growth: -0.05 }, 2, {}), tHigh = G.teeosa({ need: 1e6, local: 0, students: 100, need_growth: 0.20 }, 1, {});
check('TEEOSA: formula need never falls below last year’s or rises more than 12% (79-1007.11)', near(tLow.need, 1e6, 1e-6) && near(tHigh.need, 1.12e6, 1e-6));

// ---- 14 Nov: a levy override for buildings (77-3444; the 17.5¢ Special Building), authority vote (79-3405)
const stO = JSON.parse(JSON.stringify(demo.settings)); stO.state = 'NE'; stO.balances.asOf = '2026-08-31'; stO.ppel.rate = 0.175;
stO.lid = Object.assign({}, stO.lid, { gfRate: 0.95, authority: 99e6, override: { cents: 3.5, first: 2028, last: 2040 } });
const cO = E.makeConfig(stO, '2026-11-12'), cN = E.makeConfig(Object.assign({}, stO, { lid: Object.assign({}, stO.lid, { override: null }) }), '2026-11-12');
check('override: at most five years', cO.lid.override.last === 2032);
const oy = E.lidRoom(cO, 1, { pg: 0 }), ny = E.lidRoom(cN, 1, { pg: 0 }), o0 = E.lidRoom(cO, 0, { pg: 0 });
check('override: in its years the lid rises by it and Special Building can reach 17.5¢', oy.override && near(oy.byLid - ny.byLid, 0.035 * 780000000 / 100, 1) && near(oy.byRate, 0.175 * 780000000 / 100, 1) && near(ny.byRate, 0.14 * 780000000 / 100, 1));
check('override: not before its first year', !o0.override && near(o0.byRate, 0.14 * 780000000 / 100, 1));
const stA = JSON.parse(JSON.stringify(stO)); stA.lid.authority = 6e6; const cA2 = E.makeConfig(stA, '2026-11-12');
const stB = JSON.parse(JSON.stringify(stA)); stB.lid.override.authorityVote = true; const cB2 = E.makeConfig(stB, '2026-11-12');
check('override: without a 60% authority vote the request authority doesn’t rise; with it, it does', near(E.lidRoom(cA2, 1, { pg: 0 }).authority, E.lidRoom(Object.assign({}, cA2, { lid: Object.assign({}, cA2.lid, { override: null }) }), 1, { pg: 0 }).authority, 1e-6)
  && near(E.lidRoom(cB2, 1, { pg: 0 }).authority - E.lidRoom(cA2, 1, { pg: 0 }).authority, 0.035 * 780000000 / 100, 1));
const tO = T.impact(cO, { fin: [] }, { valuation: 780000000, homeValue: 210000 });
const t1 = tO.taxed.find((x) => x.fy === 2028);
check('override: taxpayers see the extra Special Building levy, with no school tax credit', tO.hasOverride && t1 && t1.override > 0 && near(t1.homeNet, t1.home, 1e-6));

// ---- 14 Nov: the adopted budget (NDE's LC-2) and NDE's certified English learner and poverty parts
const raw4 = JSON.parse(JSON.stringify(raw3));
raw4.lc2 = { fiscal_year: 2027, valuation: 626635675, gf_request: 4487374, sb_request: 120000, pta: 5126579, unused_pta: 639205, budget_authority: 5067908, adj_budget: 5067908, sped: 1160000, sgf: 337592, gfle: 0, reserve_pct: 45, override_levy: 0 };
raw4.pta_hist = [{ fiscal_year: 2025, g_lep: 0, g_poverty: 0.001 }, { fiscal_year: 2026, g_lep: 0.002, g_poverty: 0 }, { fiscal_year: 2027, g_lep: 0, g_poverty: 0.0025 }];
raw4.aid.basic_funding = 7200000; raw4.aid.formula_students = 600;
const ad4 = N.adapt(raw4);
check('LC-2: the adopted General Fund request, this year’s valuation and the General Fund levy from them', ad4.gf.property_tax === 4487374 && ad4.gf.property_tax_fy === 2027 && ad4.values.taxable_valuation === 626635675 && ad4.values.lid_gf_rate === Math.round(4487374 / 626635675 * 100 * 1e4) / 1e4);
check('LC-2: budgeted at the whole authority → that mode; adopted SPED and exclusions for the first year', ad4.gf.budget.mode === 'authority' && ad4.gf.budget.sped === 1160000 && ad4.gf.budget.excluded === 337592);
check('NDE’s English learner and poverty part ahead: the average of the last three certifications', near(ad4.values.lid_lep_pov, (0.001 + 0.002 + 0.0025) / 3, 1e-4));
check('student growth adjustment inputs: basic funding per formula student from NDE', ad4.gf.budget.sga.bfps === 12000 && ad4.gf.budget.sga.students === 0);
const raw5 = JSON.parse(JSON.stringify(raw4)); raw5.lc2.adj_budget = 4.5e6; raw5.lc2.override_levy = 0.035; raw5.lc2.override_first = 2027; raw5.lc2.override_last = 2031;
const ad5 = N.adapt(raw5);
check('LC-2: budgeted under the authority → “what it plans to spend”; a levy override fills the override fields', ad5.gf.budget.mode === 'spending' && ad5.values.lid_ov_cents === 3.5 && ad5.values.lid_ov_last === 2031);
check('debt: Nebraska sets no school debt limit (verified)', S.pack('NE').debt.limitShare === null && S.pack('NE').debt.limitStatus === 'verified');

// ---- 14 Nov (b): the correction for last year's aid (79-1065) and the student growth correction (79-1007.20(3))
const gfT = gf.teeosa ? gf : null;
if (gfT) {
  const yrs5 = [2027, 2028, 2029, 2030, 2031];
  const noC = G.forecastNE(gf, gf.assume, yrs5, {}, {});
  const wC = G.forecastNE(Object.assign({}, gf, { teeosa: Object.assign({}, gf.teeosa, { pyc: 25000 }) }), gf.assume, yrs5, {}, {});
  check('prior year correction: added to the first year’s aid only', near(wC.years[0].stateAid - noC.years[0].stateAid, 25000) && near(wC.years[1].stateAid, noC.years[1].stateAid) && wC.years[0].priorCorrection === 25000);
  /* NDE's this-year SGA (no estimate given: backed out), the plan expecting no growth: a cut two years on, at most the adjustment */
  const tS = Object.assign({}, gf.teeosa, { sga0: 400000, bfps: 18000, need: gf.teeosa.need });
  const fS = G.forecastNE(Object.assign({}, gf, { teeosa: tS, budget: undefined }), Object.assign({}, gf.assume, { enroll: 0 }), yrs5, {}, {});
  check('SGA correction: none in the first two years; two years on, (actual − estimated growth) × basic funding, no bigger than the adjustment',
    fS.years[0].sgaCorr === 0 && fS.years[1].sgaCorr === 0 && fS.years[2].sgaCorr < 0 && fS.years[2].sgaCorr >= -400000 - 1e-6 && fS.years[3].sgaCorr === 0, JSON.stringify(fS.years.map((y) => y.sgaCorr)));
  const tN = G.forecastNE(Object.assign({}, gf, { teeosa: Object.assign({}, tS, { sga0: 0 }), budget: undefined }), Object.assign({}, gf.assume, { enroll: 0 }), yrs5, {}, {});
  check('SGA correction: it comes off formula need that year', near(tN.years[2].teeosa.need - fS.years[2].teeosa.need, -fS.years[2].sgaCorr, 1e-6));
  /* growth that came as estimated: no correction */
  const fm = 600, e = 0.1, th = Math.max(25, 0.01 * fm), est = fm * e, sga0 = 18000 * (est - th) + 0.5 * 18000 * th;
  const fE = G.forecastNE(Object.assign({}, gf, { enrollment: fm, teeosa: Object.assign({}, tS, { sga0 }), budget: undefined }), Object.assign({}, gf.assume, { enroll: e }), yrs5, {}, {});
  check('SGA correction: growth as estimated gives none', near(fE.years[2].sgaCorr, 0, 1e-6), String(fE.years[2].sgaCorr));
}
const raw6 = JSON.parse(JSON.stringify(raw4));
raw6.aid.prior_year_corr = -5012; raw6.aid.sga = 90000;
raw6.lc2 = Object.assign({}, raw6.lc2, { board_vote: 1, board_extra: 300000, pta_vote: 0, override_levy: 0.09, override_first: 2024, override_last: 2028, ov_authority: 560000 });
const ad6 = N.adapt(raw6);
check('NDE prefill: last year’s correction is in the aid to be paid, kept for the first year; this year’s SGA kept for its correction',
  ad6.teeosa.pyc === -5012 && ad6.gf.state_aid === Math.round(raw6.aid.calc_aid) - 5012 && ad6.teeosa.sga0 === 90000);
check('LC-2: a 70% board vote is in the first year’s authority and ticks the board box; a pre-2024 override ticks “authority too”',
  ad6.values.lid_board_bump === true && ad6.values.lid_ov_authority === true && ad6.values.lid_ov_first === 2024 && ad6.values.lid_ov_cents === 9
  && ad6.values.lid_authority === Math.max(0, 5126579 + 300000 - (ad6.values.lid_carry || 0)));
check('LC-2: no board vote, no override → neither box', N.adapt(raw4).values.lid_board_bump === undefined && N.adapt(raw4).values.lid_ov_authority === undefined);
console.log(`nebraska tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
