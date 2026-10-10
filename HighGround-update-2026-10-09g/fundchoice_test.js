/* HighGround: phases that can use any of several funds ("whichever has room"). Run: node fundchoice_test.js */
const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden_engine.json'), 'utf8'));
const d = Object.values(G.districts)[0], cfg = E.makeConfig(d.settings), L = E.defaultLevers(cfg);
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (info || ''))); if (!ok) fails++; };
const run = (projects) => E.compute(E.cleanList(projects, cfg), L, cfg);
const room0 = (b) => run([]).res[0].avail[b];

// cleaning
const c = E.cleanList([{ id: 'a', name: 'A', phases: [{ cost: 10, year: 0, options: ['save', 'ppel', 'ppel', 'nope'] }] }], cfg)[0].phases[0];
check('options are cleaned: known funds, no repeats, in order', JSON.stringify(c.options) === '["save","ppel"]' && c.funding[0].b === 'save' && c.funding[0].p === 100, JSON.stringify(c));
const one = E.cleanList([{ id: 'a', name: 'A', phases: [{ cost: 10, year: 0, options: ['ppel'], funding: [{ b: 'save', p: 100 }] }] }], cfg)[0].phases[0];
check('a single option is just a fixed fund (the split is used)', !one.options && one.funding[0].b === 'save');

// first choice when it has room
const save0 = room0('save'), ppel0 = room0('ppel');
let r = run([{ id: 'p', name: 'Playground', phases: [{ cost: Math.min(save0, ppel0) / 2, year: 0, options: ['save', 'ppel'] }] }]);
check('takes the first choice when it has room', r.picks.length === 1 && r.picks[0].b === 'save' && r.picks[0].first && r.gap < 0.5, JSON.stringify(r.picks));

// first choice full: moves to the second, and the plan fits
const fill = { id: 'f', name: 'Fill SAVE', phases: [{ cost: save0, year: 0, funding: [{ b: 'save', p: 100 }] }] };
r = run([fill, { id: 'p', name: 'Playground', phases: [{ cost: ppel0 / 2, year: 0, options: ['save', 'ppel'] }] }]);
check('first choice full: uses the second, nothing short', r.picks[0].b === 'ppel' && !r.picks[0].first && r.gap < 0.5, JSON.stringify(r.picks) + ' gap ' + r.gap);
const fixed = run([fill, { id: 'p', name: 'Playground', phases: [{ cost: ppel0 / 2, year: 0, funding: [{ b: 'save', p: 100 }] }] }]);
check('…where the same phase fixed to SAVE would be short', fixed.gap > 0.5, fixed.gap);

// none has room: the one with the most room, shortfall in the gap
r = run([fill, { id: 'p', name: 'Big', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['save', 'ppel'] }] }]);
check('no fund has room: goes to the one with the most room, and the shortfall is in the gap', r.picks[0].b === 'ppel' && !r.picks[0].fits && r.gap > 0.5, JSON.stringify(r.picks));

// boosters / campaign as a last resort always have room
r = run([fill, { id: 'p', name: 'Turf', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['save', 'ppel', 'camp'] }] }]);
check('campaign/bond as the last choice catches what no levy fund can', r.picks[0].b === 'camp' && r.unfunded > 0.5, JSON.stringify(r.picks));

// order: earlier projects choose first
r = run([fill, { id: 'p1', name: 'First', phases: [{ cost: ppel0 * 0.7, year: 0, options: ['ppel', 'grants'] }] }, { id: 'p2', name: 'Second', phases: [{ cost: ppel0 * 0.7, year: 0, options: ['ppel', 'camp'] }] }]);
check('higher in the list chooses first; the next one moves on', r.picks[0].project === 'p1' && r.picks[0].b === 'ppel' && r.picks[1].b === 'camp', JSON.stringify(r.picks));
check('the choice is kept per phase (pick map)', r.pick.size === 2);

// no options anywhere: results unchanged and no picks
r = run([fill]);
check('plans without choices are untouched', r.picks.length === 0 && r.pick.size === 0);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
