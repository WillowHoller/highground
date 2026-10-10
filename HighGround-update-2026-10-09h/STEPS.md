# HighGround update, 9 Oct (h): spacing, menu logo, General Fund fixes

This package includes everything in 09g (fund choices). **If you haven't installed 09g yet, install this one instead.**

## What changes

- **Spacing:** the KPI tiles on the Capital plan and General fund no longer sit right on top of the chart below them. A new test checks 18 screens for cards that nearly touch.
- **Home:** the four shortcut buttons under the welcome sentence are gone. The menu covers them.
- **Shrunk menu:** the district's logo mark is centered over the menu icons.
- **General fund what-if:** all six inputs fit on one row on a computer. Each label is on one line, and the % sits beside its box.
- **General fund chart:**
  - The shaded band is labelled **Solvency target 5–10%** inside the chart.
  - The key says the band applies to the solvency line only.
- **Unspent balance carry-forward cap (SF 2472):**
  - **The rule:** from FY2027, only the lesser of these carries into next year's spending authority:
    - the unspent balance;
    - 35% of the authorized budget from two years earlier (FY2025's for FY2027).
  - **The forecast** now applies the cap. Years before the plan starts are estimated.
  - **Year by year** has a new row: **Unspent balance carried in (35% cap)**.
  - **Watch** lists any year where the cap holds money back.
  - **Definitions:** Unspent balance and Spending authority now explain the cap, and that the School Budget Review Committee can approve more.

## 1. Database: only if you haven't run part 23 yet

If you already installed 09g and ran `23_fund_options.sql`, skip this step.

Otherwise:
1. In Supabase, open **SQL Editor → New query**.
2. Paste `23_fund_options.sql` and click **Run**. You should see 2 rows, both PASS.

## 2. GitHub

1. Go to **github.com/WillowHoller/highground** → **Add file → Upload files**.
2. Drag in **everything except STEPS.md** (18 files).
3. Commit message: `Spacing, menu logo, General Fund cap`
4. Click **Commit changes**.
5. After about 2 minutes, open the app in a private/incognito window.

## Checked before sending

- **Browser tests:** 430 pass, 0 fail. New tests check:
  - the gaps between cards;
  - the logo mark centered when the menu is shrunk.
- **Unit tests:** all pass, including 5 new General Fund tests of the 35% cap:
  - a large balance is capped;
  - the capped year is flagged;
  - turning the cap off carries the whole balance;
  - a normal balance carries in full;
  - later years look back two years.
