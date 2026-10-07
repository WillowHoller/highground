# HighGround

Strategy, decisions, capital planning and accountability for Iowa school districts, by Willow Holler. Live at **highground.willowholler.com**.

The app is plain HTML, CSS and JavaScript with no build step; GitHub Pages serves this repository as it is. Data, sign-in and access rules live in Supabase.

## Where to start

| File | What it's for |
|---|---|
| `SETUP.md` | Setting up GitHub and Supabase from scratch, and the order to run the SQL files |
| `GO_LIVE.md` | What must be done before the first real district signs in. Read this first when "going live" comes up |
| `DATABASE.md` | What each table holds, in plain language |
| `PUBLIC_DATA.md` | The Iowa state data: peer comparisons, the state prefill, check-register questions, and the monthly loader |

## What's in the repository

- **`01_…` to `18_…sql`**: the database, run in the order SETUP.md gives. `05_verify_setup.sql` and `06_access_test.sql` check it: every row should say PASS.
- **`index.html`, `app.js`, `styles.css`**: the app itself.
- **Other `.js` files**: the engines (capital plan, General Fund, taxes, uploads, ledger, reports, peers, check registers). Each has a matching `_test.js`.
- **`test_ui.py`**: a browser test of every screen against a simulated database.
- **`loader/`** and **`.github/workflows/`**: the monthly load of Iowa public data. It uses the repository secret `DATABASE_URL`.
- **`config.js`**: the Supabase address and the **publishable** key only.

## Keys and passwords

- Only the publishable key (`sb_publishable_…`) may appear in this repository.
- The secret key and the database password never go in any file, email or chat.
- The database password lives only in the GitHub secret `DATABASE_URL`.

## Data rules

- No student data.
- Demo districts are fictional. A real district's name never appears next to invented numbers.
