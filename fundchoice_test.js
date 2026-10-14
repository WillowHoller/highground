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
// 14 Oct: a campaign with nothing financed doesn't tie with boosters (boosters pay; an unfinanced campaign is all gap)
r = run([fill, { id: 'p', name: 'Turf', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['ppel', 'camp', 'boost'] }] }]);
check('boosters listed after an unfinanced campaign still win: nothing left unpaid', r.picks[0].b === 'boost' && r.unfunded < 0.5, JSON.stringify(r.picks));
{ const L2 = Object.assign({}, L, { fin: E.leversOf({ fin: [{ name: 'Bond', kind: 'go', fy: cfg.start, amount: (ppel0 * 3 + save0) * 2, rate: 0.04, years: 20 }] }, cfg).fin });
  const r2 = E.compute(E.cleanList([fill, { id: 'p', name: 'Turf', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['ppel', 'camp', 'boost'] }] }], cfg), L2, cfg);
  check('…but with a bond in the scenario that covers it, the campaign/bond (listed first) is used', r2.picks[0].b === 'camp' && r2.unfunded < 0.5, JSON.stringify(r2.picks)); }

// order: earlier projects choose first
r = run([fill, { id: 'p1', name: 'First', phases: [{ cost: ppel0 * 0.7, year: 0, options: ['ppel', 'grants'] }] }, { id: 'p2', name: 'Second', phases: [{ cost: ppel0 * 0.7, year: 0, options: ['ppel', 'camp'] }] }]);
check('higher in the list chooses first; the next one moves on', r.picks[0].project === 'p1' && r.picks[0].b === 'ppel' && r.picks[1].b === 'camp', JSON.stringify(r.picks));
check('the choice is kept per phase (pick map)', r.pick.size === 2);

// no options anywhere: results unchanged and no picks
r = run([fill]);
check('plans without choices are untouched', r.picks.length === 0 && r.pick.size === 0);

// 14d: an unfinanced campaign isn't "room": boosters come first when both are choices, in any order
r = run([fill, { id: 'p', name: 'Scoreboard', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['save', 'camp', 'boost'] }] }]);
check('unfinanced campaign vs. boosters: boosters pay, nothing in the gap', r.picks[0].b === 'boost' && r.gap < 0.5, JSON.stringify(r.picks) + ' gap ' + r.gap);
const Lf = Object.assign({}, L, { fin: E.cleanFin([{ kind: 'gift', fy: cfg.start, amount: ppel0 * 3 + save0 + 1 }], cfg) });
r = E.compute(E.cleanList([fill, { id: 'p', name: 'Scoreboard', phases: [{ cost: ppel0 * 3 + save0, year: 0, options: ['save', 'camp', 'boost'] }] }], cfg), Lf, cfg);
check('…but a campaign with money raised this year is used in the order given', r.picks[0].b === 'camp' && r.gap < 0.5, JSON.stringify(r.picks));
const many = Array.from({ length: 10 }, (_, k) => ({ id: 'm' + k, name: 'Item ' + k, phases: [{ cost: ppel0 + save0 + 1000, year: 0, options: ['ppel', 'camp', 'boost'] }] }));
r = run([fill].concat(many));
check('more than 8 choices in a year: boosters before an unfinanced campaign', r.picks.every((x) => x.b !== 'camp') && r.unfunded < 0.5, JSON.stringify(r.picks.map((x) => x.b)));
const dear = run([fill].concat(many.map((p) => Object.assign({}, p, { phases: [{ cost: p.phases[0].cost * 1.1, year: 0, options: p.phases[0].options }] }))));
check('raising costs never lowers the gap here', dear.gap >= r.gap - 0.5, dear.gap + ' < ' + r.gap);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
