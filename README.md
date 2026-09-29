# HighGround

Strategy, decisions, capital planning and accountability for Iowa school districts. By Willow Holler.

**Status (29 Sept 2026):** database ready to install; app shell with sign-in, districts and people working, and every unfinished screen marked. See `docs/SETUP.md`, and **Help → What's built** in the app.

## What's here
```
index.html                    the app (open it through a web server, not as a file)
config.js                     which Supabase project to use (publishable key only)
app/api.js                    sign-in and database calls
app/app.js                    screens, and what's built vs. not
app/styles.css                HighGround design tokens
tests/ui/test_ui.py           browser test against a simulated Supabase (Playwright)
docs/SETUP.md                 step-by-step GitHub and Supabase setup
docs/DATABASE.md              what each table is for
supabase/sql/01_tables.sql    tables
supabase/sql/02_security.sql  access rules, invitations, audit log, app functions
supabase/sql/03_storage.sql   file storage
supabase/sql/04_iowa_rules.sql Iowa rule values with source status
supabase/tests/               structure check and access test (run in the SQL editor)
```

## Marking unfinished work
Every screen declares its status in `SECTIONS` in `app/app.js`: `live`, `partial` or `wip`, with the phase for the rest. Unfinished actions use `nb(label, feature, phase)`, which throws `HG.NotBuiltError` when clicked. Unfinished areas use `wip({...})`, an orange dashed panel. When something gets built, change its status and remove the marker.

## Ground rules
- No student data, ever. Survey results are totals and themes only.
- Demo districts are fictional. Never put a real district's name next to invented numbers.
- Only the Supabase **publishable** key may appear in code. The secret key and database password never go in this repository.
- No personal email addresses in any file.
