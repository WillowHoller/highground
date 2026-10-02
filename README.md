# HighGround

Strategy, decisions, capital planning and accountability for Iowa school districts. Powered by Willow Holler.

Live at **https://highground.willowholler.com** (GitHub Pages, custom domain). Marketing pages: https://www.willowholler.com (repository `willowholler-site`).

**Status (29 Sept 2026):** database installed; app shell with sign-in, districts and people working; Resources → Capital plan runs the real engine from the database; every unfinished screen marked. See `SETUP.md`, and **Help → What's built** in the app.

## What's here
Every file is at the top level (no folders), so the repository uploads cleanly through the GitHub website.
```
index.html            the app (open it through a web server, not as a file)
config.js             which Supabase project to use (publishable key only)
api.js                sign-in and database calls
app.js                screens, and what's built vs. not
engine.js             Iowa capital funds engine (pure; same math as the working planner)
capital.js            turns database rows into engine inputs; writes demo data
demo_data.js          fictional demo districts; Bridger Hollow (about 925 students) is the main demo, reset from the Willow Holler page
          three FICTIONAL demo districts (Harvest Plains, Ironwood Valley, Lakeshore Heights)
uploads.js            reads project and balance spreadsheets (.csv, .xlsx); templates
compare.js            compares scenarios and explains why their gaps differ
ranking.js            tiers, rank order, the funding line, flags, fund in rank order
actuals.js            project actuals: spending per initiative from linked GL accounts; link suggestions
gl.js                 reads month-end general-ledger exports (Iowa account codes), suggests account matches, computes balances
tax.js                what a scenario adds to property taxes (Iowa rules, sourced; update rollbacks each November)
styles.css            HighGround design tokens
01_tables.sql         database: tables                       (run in the Supabase SQL editor, in order)
02_security.sql       database: access rules, invitations, audit log, app functions
03_storage.sql        database: file storage
04_iowa_rules.sql     database: Iowa rule values with source status
05_verify_setup.sql   check: structure (9 rows PASS)
06_access_test.sql    check: access rules as six test users (13 rows PASS)
07_signin.sql         database: access requests, email-domain allow-list, invitation email tracking (5 rows PASS)
08_phase_names.sql    database: phase names, and copying them with a scenario (2 rows PASS)
09_priority_tiers.sql database: one priority (Must-have / Strategic / Nice to have), converted from High/Med/Low (1 row PASS)
10_tax_impact.sql     database: tax estimate settings and the Iowa rules they use (1 row PASS)
11_gl_import.sql      database: remembers each district's GL export layout; balances from the ledger (2 rows PASS)
12_progress.sql       database: record progress (status, dates, actual cost) on the locked board version (1 row PASS)
send-invitation.ts    Supabase Edge Function: emails invitations through Postmark
send_invitation_test.mjs  node --experimental-strip-types send_invitation_test.mjs
test_ui.py            browser test against a simulated Supabase (Playwright)
engine_test.js        node engine_test.js: engine vs. the working planner, 32 cases
capital_test.js       node capital_test.js: demo data through database-shaped rows and back, 32 cases
actuals_test.js       node actuals_test.js: link suggestions and spending per initiative on the demo
gl_test.js            node gl_test.js: columns, Iowa codes, suggestions and balances, against hand-worked figures
demo_test.js          node demo_test.js: Bridger Hollow demo holds together and tells its story
tax_test.js           node tax_test.js: homestead, rollback and levy arithmetic, worked by hand
ranking_test.js       node ranking_test.js: the funding line and flags on the demo
yearly_test.js        node yearly_test.js: yearly costs (programs, hires), including the FFA case
compare_test.js       node compare_test.js: comparison and "why the gap differs" on the demo
uploads_test.js       node uploads_test.js: parsing rules, and every demo plan through a spreadsheet and back
golden_engine.json    the working planner's own output for the demo districts (what the tests compare against)
SETUP.md              step-by-step GitHub and Supabase setup
GO_LIVE.md            decisions and tasks to finish before the first real district
DATABASE.md           what each table is for
```

## Marking unfinished work
Every screen declares its status in `SECTIONS` in `app.js`: `live`, `partial` or `wip`, with the phase for the rest. Unfinished actions use `nb(label, feature, phase)`, which throws `HG.NotBuiltError` when clicked. Unfinished areas use `wip({...})`, an orange dashed panel. When something gets built, change its status and remove the marker.

## Ground rules
- No student data, ever. Survey results are totals and themes only.
- Demo districts are fictional. Never put a real district's name next to invented numbers.
- Only the Supabase **publishable** key may appear in code. The secret key and database password never go in this repository.
- No personal email addresses in any file.
