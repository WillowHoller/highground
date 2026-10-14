# HighGround update, 14 Oct (f): what each fund holds back each year, pay applications, and the 14d dollar-flow fixes

Builds on 14 Oct (c), the version in your highground-main download. **This one package also includes two packages made in other sessions today, so install only this one:**
- **14 Oct (d)**, the dollar-flow checks and two fixes: its own files, unchanged.
- **The HighGround half of `home-screen-icons-2026-10-14`**: the home-screen icon, manifest and `index.html`. Its other half, `2-willowholler-site`, is for the Willow Holler website repository and isn't included here; install that one separately as its README says.

## Install, in this order
1. **Supabase → SQL Editor → New query:** paste all of `29_holdback_contracts.sql` and click **Run**. Five rows should say **PASS**. Run it before step 2, because the new app saves these columns. Running it twice is safe.
2. **GitHub → the HighGround repository → Add file → Upload files.** Drag in:
   - `app.js`, `engine.js`, `capital.js`, `actuals.js`, `report.js`, `contract.js` (new), `index.html`, `styles.css`
   - Home-screen icon: `manifest.webmanifest`, `apple-touch-icon.png`, `highground-icon-192.png`, `highground-icon-512.png`
   - `29_holdback_contracts.sql`, `STEPS.md`, `DATABASE.md`, `SETUP.md`
   - Tests: `test_ui.py`, `fundchoice_test.js`, `report_test.js`, `contract_test.js` (new), `holdback_test.js` (new), `dollarflow_test.js` (new)

   Commit to `main`.
3. **The nightly check:** in GitHub, choose **Add file → Create new file**. Name it `.github/workflows/nightly-checks.yml`; typing the slashes makes the folders. Paste in the contents of `nightly-checks.yml` from this package and commit.
4. In Safari, press **Cmd+Option+R** on the app.

## What's new

### Held back each year
This used to be called "Ongoing commitments".
- **One figure per fund, by default, as a % of each year's receipts.** It comes off the top of SAVE, PPEL or V-PPEL before anything goes to projects. It covers recurring costs (technology, buses, maintenance) and a cushion for things nobody has listed yet.
- **New districts start from the state's figure.** Fill in and the setup wizard put in the state's three-year average of spending outside building projects, debt and transfers, as a % of receipts rounded to the nearest half point (for example 12.5%). A % shrinks automatically when SAVE falls under SF 2472. A dollar amount stays fixed, and it's still available.
- **Existing districts keep exactly what they had.** A dollar amount stays a dollar amount.
- **"Split it into recurring costs and a cushion"** is optional. Recurring costs are in $ a year and the cushion is a % of receipts, and both are held back.
  - Ticking it moves the whole figure into the cushion, with recurring at $0.
  - Unticking it adds the two back together.
- **Track → Budget vs. actual** has a new **Held back each year** card. For each fund it shows:
  - what's held back this year;
  - "used so far": spending not linked to an initiative, plus what's on order, leaving out debt payments and transfers;
  - expected by now, and what's left;
  - on pace, running ahead or over.

  It also calls out building and site spending (function 4xxx) that isn't linked to an initiative, so it isn't counted against both the holdback and a project.
- **The board report** gets one line per fund ("SAVE: $150k held back for FY2027 … $61k used through Sep 30 (on pace)"). "What changed" mentions it when a fund passes its holdback.
- The wording now says "held back" everywhere it used to say "ongoing commitments": the double-count check, Funding vs. committed, fund notes and setup checks.

### Contracts and pay applications
On **Track → Initiative progress**, open an initiative:
1. **Add the contract:**
   - contractor;
   - original contract sum;
   - owner's contingency;
   - start and completion dates.
2. **Each month, add the pay application:** four totals from its summary page.
   - contract sum to date;
   - work completed to date;
   - retainage held;
   - contingency left.
   - It's checked before saving. For example, retainage can't be more than the work completed, and a warning appears if work completed went down since the last pay app.
3. **The card then shows:**
   - % complete, against what the dates suggest;
   - projected final cost (the contract plus all the contingency left), against the board version's cost;
   - contingency used;
   - change orders;
   - ledger vs. pay apps: retainage isn't treated as a difference, and a ledger that counts retainage as spent is recognised too;
   - still to pay;
   - the full history of pay apps.

   Problems are spelled out ("Contingency is 60% used with the work 28% complete"), and the progress table flags them next to the initiative.
4. **The board report** gets a "Contracted projects" section with one sentence per contract.

Pay-app figures are **never added** to spending. They're a check against the ledger, which already shows what was paid.

Contracts are included in backups and restores. They're removed with their initiative.

### Help
- Every new field and column has a **?** that explains it: held back, split, recurring costs, cushion, used so far, contract, contract sum, work completed, retainage, contingency, projected final cost, ledger vs. pay apps, and schedule.
- Help on Starting numbers, Initiative progress and Budget vs. actual explains the new parts.
- The Guide has new "How do I…" lines and the business manager's monthly steps.
- Search finds "holdback", "cushion", "pay app", "retainage" and similar words.

### The 14d dollar-flow fixes (from the 14d package, included as is)
- **Funding vs. committed** now uses each debt's timing ("still to pay", "already paid" or "spread") for the first year, the way the plan does.
- **"Whichever has room"** no longer treats a campaign with no money raised as having room. Boosters come before it. A campaign is used only when money has been raised that year, or as the last resort.
- **`dollarflow_test.js`** (14d's own) checks 1,200 random districts:
  - every dollar charged lands in a fund;
  - funds roll forward;
  - gap = unfunded + over capacity;
  - Funding vs. committed agrees with the plan;
  - holding back more never lowers the gap;
  - more receipts never raise it;
  - and more.

  The nightly workflow runs 5,000 districts with a new random seed each night and emails you if anything fails.

## Tests
- Unit tests: 30 files, all pass. New: contract 32, holdback 19. 14d's dollar flow passes 1,200 districts, and 3,000 more on a second seed. Added to existing: fund choice (14d's tests and mine together), report +7.
- Golden engine cases: 32 unchanged.
- Browser: **510 pass, 0 fail** (was 483). This includes 14d's "every screen shows the same gap" checks.
- SQL 29 was run twice on a local copy of the full database (parts 01–28 first): all PASS. Access checks:
  - a business manager can write;
  - a board member can read but not write;
  - another district sees nothing;
  - a password-only session sees nothing where two-step sign-in is required.
