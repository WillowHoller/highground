# HighGround

Strategy, decisions, capital planning and accountability for Iowa school districts. By Willow Holler.

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
demo_data.js          three FICTIONAL demo districts (Harvest Plains, Ironwood Valley, Lakeshore Heights)
styles.css            HighGround design tokens
01_tables.sql         database: tables                       (run in the Supabase SQL editor, in order)
02_security.sql       database: access rules, invitations, audit log, app functions
03_storage.sql        database: file storage
04_iowa_rules.sql     database: Iowa rule values with source status
05_verify_setup.sql   check: structure (9 rows PASS)
06_access_test.sql    check: access rules as six test users (13 rows PASS)
test_ui.py            browser test against a simulated Supabase (Playwright)
engine_test.js        node engine_test.js: engine vs. the working planner, 32 cases
capital_test.js       node capital_test.js: demo data through database-shaped rows and back, 32 cases
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
