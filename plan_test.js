/* tests for plan.js: node plan_test.js */
const P = require('./plan.js');
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else { fail++; console.log('FAIL', name, info !== undefined ? JSON.stringify(info) : ''); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.5 : t);

const rows = {
  scenarios: [{ id: 'b', name: 'Board version', is_board_version: true }, { id: 'x', name: 'Other' }],
  priorities: [{ id: 'p1', name: 'Every student reads by grade 3', position: 1, csip_goal: true }, { id: 'p2', name: 'Great places to learn', position: 2 }, { id: 'p3', name: 'Keep great teachers', position: 3 }],
  initiatives: [
    { id: 'roof', name: 'High school roof', type: 'capital', status: 'approved', priority_id: 'p2', tier: 'must', owner_name: 'Facilities director', focus_area: 'Facilities' },
    { id: 'gym', name: 'Gym floor', type: 'capital', status: 'proposed', priority_id: 'p2', engine_priority: 'Med' },
    { id: 'read', name: 'K-3 reading curriculum', type: 'curriculum', status: 'underway', priority_id: 'p1', owner_name: 'Curriculum director' },
    { id: 'coach', name: 'Instructional coach', type: 'staff', status: 'approved', priority_id: 'p1' },
    { id: 'mentor', name: 'New teacher mentoring', type: 'program', status: 'done', priority_id: 'p3' },
    { id: 'bus', name: 'Two buses', type: 'other', status: 'done' },
    { id: 'pool', name: 'Pool', type: 'capital', status: 'declined' },
    { id: 'wait', name: 'Auditorium', type: 'capital', status: 'deferred', need_by_fy: 2031 },
  ],
  phases: [
    { id: 'r1', scenario_id: 'b', initiative_id: 'roof', fy: 2027, cost: 400000 }, { id: 'r2', scenario_id: 'b', initiative_id: 'roof', fy: 2028, cost: 600000 },
    { id: 'r9', scenario_id: 'x', initiative_id: 'roof', fy: 2027, cost: 999999 },
    { id: 'g1', scenario_id: 'b', initiative_id: 'gym', fy: 2029, cost: 150000 },
    { id: 'b1', scenario_id: 'b', initiative_id: 'bus', fy: 2027, cost: 260000, status: 'done', actual_cost: 250000, done_date: '2026-08-15' },
    { id: 'far', scenario_id: 'b', initiative_id: 'roof', fy: 2035, cost: 5000000 },
  ],
  funding: [{ phase_id: 'r1', fund: 'save', pct: 50 }, { phase_id: 'r1', fund: 'ppel', pct: 50 }, { phase_id: 'r2', fund: 'save', pct: 100 }, { phase_id: 'b1', fund: 'ppel', pct: 100 }],
  recurring: [{ scenario_id: 'b', initiative_id: 'coach', fund: 'general', first_fy: 2027, last_fy: null, annual_amount: 85000 }],
};
const dir = {
  outcomes: [{ id: 'o1', priority_id: 'p1', name: 'Reading proficiency rises' }],
  measures: [{ id: 'm1', priority_id: 'p1', name: 'Grade 3 reading proficient', target_value: 80, unit: '%' }, { id: 'm2', outcome_id: 'o1', name: 'Grade 2 reading', unit: '%' }],
  st: new Map([['m1', { state: 'ontrack', latest: { value: 72, period: '2025-26' } }]]),
};
const opts = { start: 2027, years: 5 };

const full = P.build(rows, dir, Object.assign({ view: 'full', items: 'approved' }, opts));
const names = (pl) => pl.list.map((x) => x.id).sort().join(',');
check('full, approved only: completed, in progress and approved, any type, with or without cost', names(full) === 'bus,coach,mentor,read,roof', names(full));
check('groups in order', full.groups.map((g) => g.key).join() === 'done,underway,approved', full.groups.map((g) => g.key));
const roof = full.list.find((x) => x.id === 'roof');
check('cost only from the board version, inside the plan years', near(roof.cost, 1000000), roof.cost);
check('funding split by phase funding', near(roof.byFund.save, 800000) && near(roof.byFund.ppel, 200000) && roof.funding === 'SAVE, PPEL', roof);
check('completion is the board version’s years', roof.completion === 'FY2027–FY2035', roof.completion);
check('columns: priority, owner, category, goal', roof.priority === 'Must-have' && roof.owner === 'Facilities director' && roof.category === 'Capital project · Facilities' && roof.goal === 'Great places to learn');
const bus = full.list.find((x) => x.id === 'bus');
check('finished phases use the actual cost and the done date', near(bus.cost, 250000) && bus.completion === '2026-08-15', bus);
const coach = full.list.find((x) => x.id === 'coach');
check('yearly costs: the amount a year, its fund, ongoing from', near(coach.yearly, 85000) && coach.funding === 'General Fund' && coach.completion === 'Ongoing from FY2027', coach);
const mentor = full.list.find((x) => x.id === 'mentor');
check('no-cost items stay in the full plan', mentor.noCost && mentor.cost === 0);
check('totals count approved work only', near(full.totals.cost, 1250000) && near(full.totals.yearly, 85000) && full.totals.count === 5 && full.totals.noCost === 2 && full.totals.proposedCount === 0, full.totals);

const all = P.build(rows, dir, Object.assign({ view: 'full', items: 'all' }, opts));
check('all items: proposals and deferred shown, declined never', names(all) === 'bus,coach,gym,mentor,read,roof,wait', names(all));
check('proposals labelled and kept out of totals', all.groups.find((g) => g.key === 'proposed').label === 'Proposed, not yet approved by the board' && near(all.totals.cost, 1250000) && near(all.totals.proposedCost, 150000) && all.totals.proposedCount === 2, all.totals);
check('deferred item shows its need-by year', all.list.find((x) => x.id === 'wait').completion === 'Needed by FY2031');
check('tier suggested from the planner priority', all.list.find((x) => x.id === 'gym').priority === 'Strategic');

const cap = P.build(rows, dir, Object.assign({ view: 'capital', items: 'all' }, opts));
check('capital view: capital-fund phases or capital type, not programs or hires', names(cap) === 'bus,gym,roof,wait', names(cap));
check('capital view has no goals section', cap.goals.length === 0);

const csip = P.build(rows, dir, Object.assign({ view: 'csip', items: 'approved' }, opts));
check('CSIP view: only initiatives serving CSIP-tagged priorities', names(csip) === 'coach,read', names(csip));
check('CSIP view: only CSIP goals, with outcomes and measures (through the outcome too)', csip.goals.length === 1 && csip.goals[0].outcomes[0] === 'Reading proficiency rises' && csip.goals[0].measures.length === 2 && csip.goals[0].measures[0].latest === 72 && csip.goals[0].initiatives === 2, csip.goals);

check('full plan goals: every priority, initiatives counted per goal', full.goals.length === 3 && full.goals[1].initiatives === 1 && full.unlinked === 1, full.goals.map((g) => g.initiatives));
check('schedule by year from costed phases', full.schedule.map((y) => y.fy).join() === '2027,2028' && near(full.schedule[0].items.find((x) => x.id === 'roof').cost, 400000), full.schedule);
check('schedule marks proposals', all.schedule.find((y) => y.fy === 2029).items[0].counted === false);

const sh = P.sheet(all);
check('sheet: the district’s columns, a row per item, proposals marked', sh[0][0] === 'Status' && sh[0][1] === 'Initiative' && sh.length === 8 && sh.some((r) => r[0] === 'Proposed (not yet approved)' && r[11] === 'No') && sh.some((r) => r[5] === 'No outside cost'), sh.slice(0, 3));
check('no board version: still lists initiatives, without costs', P.build({ initiatives: rows.initiatives, scenarios: [], priorities: rows.priorities }, null, { view: 'full', items: 'approved' }).list.length === 5);

console.log(`plan tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
