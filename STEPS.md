# HighGround update, 14 Oct (d): dollar-flow checks on random districts, and two fixes they found

Builds on 14 Oct (c). **No database change.**

## Two fixes (found by the new checks)
1. **Funding vs. committed: this year's debt payment.** When the balances are from partway through a year, Starting numbers lets you say whether this year's debt payment is still to pay, already paid, or spread over the year. The plan used that choice; the Funding vs. committed bars always assumed "spread", so their debt bar was off by up to about $250k in the first year. Now they match the plan.
2. **"Whichever has room" with a campaign and boosters.** A campaign or bond was treated as always having room, even with nothing financed in the scenario, so a phase that could use PPEL, a campaign *or boosters* could land on the unfinanced campaign and add its whole cost to the gap, when boosters were right there. Raising costs could even lower the gap. Now, among choices that leave the levy funds equally short, the one that leaves less to an unfinanced campaign wins. A campaign is still the last resort when nothing else can pay, and when the scenario has a bond that covers it, it's used as before.

The Bridger Hollow and Ironwood demo figures don't change.

## New checks
- **`dollarflow_test.js`: 1,200 random districts and plans (5,000 nightly).** Rules money must always obey:
  - every dollar of every phase is charged to exactly one place;
  - each fund's year rolls into the next (start + receipts − spending = next start, or a shortfall);
  - the gap = unpaid campaign money + fund shortfalls;
  - more receipts never raise the gap; higher costs or one more project never lower it;
  - doubling every dollar doubles the gap (no hidden fixed amounts);
  - Funding vs. committed adds up to receipts minus what the plan gets;
  - everything above the funding line fits, the first below doesn't, and filling in only funds what fits;
  - the General Fund balance rolls forward, and a new cost never raises solvency.
  With the two old bugs put back, it fails at once (checked).
- **Every screen agrees:** the browser test now reads the board version's gap and 10-year need on Home, the Capital plan, the summary and Rank & fund, and fails if any differs from the engine.
- **Nightly on GitHub:** `.github/workflows/nightly-checks.yml` runs all the calculation tests every night, and on every upload, with a new random seed. If anything fails, GitHub emails you; the log names the broken rule and the SEED to replay it.

## Install (GitHub only)
1. **Add file → Upload files:** `engine.js`, `capital.js`, `dollarflow_test.js`, `fundchoice_test.js`, `test_ui.py`, `STEPS.md`. Commit.
2. **The nightly check:** **Add file → Create new file**. In the name box type exactly `.github/workflows/nightly-checks.yml` (the slashes make the folders). Open `nightly-checks.yml` from the package in TextEdit, copy everything, paste it in, and **Commit**.
3. Open the repository's **Actions** tab: a "Nightly checks" run starts within a minute. A green tick means everything passed. The first run also shows if any older test file is missing from the repository.
4. Cmd+Option+R in Safari.

## Tests
Unit: 28 files pass (new: dollarflow; fundchoice +2). Engine golden cases: 32, 0 differences. Browser: 484 checks, all pass.
