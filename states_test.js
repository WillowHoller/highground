/* HighGround: state packs (11 Nov 2026). Run: node states_test.js
   Every pack has the same shape; Iowa's pack says exactly what the screens said before; Nebraska's words, calendar and limits. */
const S = require('./states.js');
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };
const SLOTS = ['save', 'ppel', 'vppel', 'grants', 'boost', 'camp', 'general', 'debt_levy'];
Object.values(S.PACKS).forEach((P) => {
  check(`${P.code}: has every fund slot`, SLOTS.every((k) => P.funds[k] && typeof P.funds[k].label === 'string'), SLOTS.filter((k) => !P.funds[k]));
  check(`${P.code}: board levy slot is on (every state has one)`, P.funds.ppel.on !== false);
  check(`${P.code}: fiscal year start month 1-12`, P.fyStartMonth >= 1 && P.fyStartMonth <= 12);
  check(`${P.code}: rate unit`, [100, 1000].includes(P.rate.per) && /per \$/.test(P.rate.label));
  check(`${P.code}: legal tables cover every type and yearly kind`, ['capital', 'technology', 'program', 'other', 'staff', 'curriculum'].every((t) => P.legal.type[t])
    && ['salary', 'benefits', 'supplies', 'activities', 'contract', 'other'].every((k) => P.legal.yearly[k]));
  check(`${P.code}: every capital fund under the law has a citation`, P.legal.funds.every((f) => P.legal.cite[f]));
  check(`${P.code}: financing kinds are known`, P.financing.every((k) => ['go', 'rev', 'lease', 'gift'].includes(k)) && P.financing.includes('go'));
  check(`${P.code}: features named`, ['sf2472', 'saveBond', 'prefill', 'peers'].every((k) => typeof P.features[k] === 'boolean'));
  check(`${P.code}: GL fund codes map to slots`, Object.values(P.glFunds).every((v) => SLOTS.concat(['other']).includes(v)));
});
// Iowa: today's names, untouched words
check('IA labels are the ones the screens always used', S.label('save', 'IA') === 'SAVE' && S.label('ppel', 'IA') === 'PPEL' && S.label('vppel', 'IA') === 'V-PPEL' && S.label('grants', 'IA') === 'Grants/Donations');
const sample = 'SAVE, PPEL, V-PPEL and grants pay per $1,000 under Iowa law (Iowa Code 298.3); solvency ratio';
check('IA: say() returns the screen unchanged', S.say(sample, 'IA') === sample);
check('IA: unknown state falls back to Iowa', S.pack('ZZ').code === 'IA' && S.pack().code === 'IA' && !S.has('ZZ') && S.has('ne'));
check('IA: fiscal year July–June', S.fyOfDate('2026-07-01', 'IA') === 2027 && S.fyOfDate('2026-06-30', 'IA') === 2027 && S.fyOfDate('2026-06-29', 'IA') === 2026);
check('IA: closes June 30', S.closeDay('IA') === 'June 30');
check('IA capital list', S.capList('IA') === 'SAVE, PPEL, V-PPEL and grants', S.capList('IA'));
// Nebraska
check('NE: the SAVE slot holds the Depreciation Fund; Special Building and QCPUF', S.on('save', 'NE') && S.label('save', 'NE') === 'Depreciation' && S.label('ppel', 'NE') === 'Special Building' && S.label('vppel', 'NE') === 'QCPUF');
check('NE capital list', S.capList('NE') === 'Depreciation, Special Building, QCPUF and grants', S.capList('NE'));
check('NE pairs', JSON.stringify(S.pairs(['save', 'ppel', 'vppel'], 'NE')) === JSON.stringify([['save', 'Depreciation'], ['ppel', 'Special Building'], ['vppel', 'QCPUF']]));
check('NE: fiscal year September–August', S.fyOfDate('2026-08-31', 'NE') === 2027 && S.fyOfDate('2026-09-01', 'NE') === 2027 && S.fyOfDate('2026-08-30', 'NE') === 2026 && S.fyOfDate('2027-08-31', 'NE') === 2028);
check('NE: closes August 31; FY2027 runs Sep 2026–Aug 2027', S.closeDay('NE') === 'August 31' && S.fyRange(2027, 'NE').start === '2026-09-01' && S.fyRange(2027, 'NE').end === '2027-08-31');
const ne = S.say(sample, 'NE');
check('NE: say() puts the screen in Nebraska’s words', ne === 'Depreciation, Special Building, QCPUF and grants pay per $100 under Nebraska law (Neb. Rev. Stat. 79-10,120); fund balance ratio', ne);
check('NE: say() is idempotent (safe to run twice on a screen)', S.say(ne, 'NE') === ne);
['SAVE or PPEL', 'PPEL or SAVE', 'SAVE and PPEL', 'SAVE, PPEL, V-PPEL, grants, boosters', 'SAVE, PPEL, V-PPEL', 'SAVE/PPEL', 'Voter-approved PPEL', 'SAVE revenue-bond room'].forEach((t) =>
  check(`NE: "${t}" has no Iowa fund left`, !/SAVE|PPEL/.test(S.say(t, 'NE')), S.say(t, 'NE')));
check('NE board bump by size', S.boardBump(300, 'NE') === 0.07 && S.boardBump(471, 'NE') === 0.07 && S.boardBump(472, 'NE') === 0.06 && S.boardBump(5000, 'NE') === 0.05 && S.boardBump(20000, 'NE') === 0.04 && S.boardBump(300, 'IA') === 0);
check('NE: no SAVE revenue bond, no SF 2472; Nebraska’s own prefill and TEEOSA', !S.pack('NE').financing.includes('rev') && !S.feature('sf2472', 'NE') && S.pack('NE').prefill === 'NE' && S.feature('teeosa', 'NE') && !S.feature('teeosa', 'IA'));
check('NE reserve limits (79-1027)', S.reserveShare(300, 'NE') === 0.45 && S.reserveShare(640, 'NE') === 0.35 && S.reserveShare(5000, 'NE') === 0.25 && S.reserveShare(20000, 'NE') === 0.20 && S.reserveShare(300, 'IA') === null);
check('NE default fund is Special Building; Iowa SAVE', S.defaultFund('NE') === 'ppel' && S.defaultFund('IA') === 'save');
check('NE fund codes from the NDE master code list', S.pack('NE').glFunds['02'] === 'save' && S.pack('NE').glFunds['08'] === 'ppel' && S.pack('NE').glFunds['09'] === 'vppel' && S.pack('NE').glFunds['07'] === 'debt_levy');
check('NE lid figures', S.pack('NE').lid.levy === 1.05 && S.pack('NE').lid.sbMax === 0.14 && S.pack('NE').lid.baseGrowth === 0.03);
// the state on screen
S.use('NE'); check('use(NE): current is Nebraska; labels and fiscal year follow it', S.current().code === 'NE' && S.label('ppel') === 'Special Building' && S.fyOfDate('2026-08-31') === 2027 && S.fyStartMonth() === 9);
S.use('xx'); check('use(unknown) falls back to Iowa', S.current().code === 'IA' && S.label('ppel') === 'PPEL');
console.log(`states tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
