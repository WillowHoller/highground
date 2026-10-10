# HighGround update, 9 Oct (i): editor tidy-ups

This package includes everything in 09g and 09h. Install it in place of either one if you haven't installed them yet.

## What changes

- **Project editor:**
  - "Add a phase", "Add a yearly cost" and "Add another" (debt) sit clear of the table above them.
  - The next section starts with breathing room.
- **Actual cost box:** it only appears once a phase's status is **Done**, and its hint now reads "Actual cost" instead of being cut off.
- **Editor text:** the Yearly costs note no longer says General Fund costs will count "once the general-fund model arrives". They already go into the five-year General Fund forecast.
- **Swipe hint:** "Swipe the table sideways…" no longer shows on a computer for an empty table.
- **Account menu:** the stray "Admins" tag next to "Preview as board member" is gone. Only admins see that item anyway.

## Install

1. **Database:** only if you haven't run part 23 yet. Open Supabase → **SQL Editor → New query**, paste `23_fund_options.sql`, and click **Run**. You should see 2 rows, both PASS.
2. **GitHub:** go to **github.com/WillowHoller/highground** → **Add file → Upload files**.
   1. Drag in everything except STEPS.md (18 files).
   2. Commit message: `Editor tidy-ups`
   3. Click **Commit changes**.
3. After about 2 minutes, open the app in a private/incognito window.

## Checked before sending

- **Browser tests:** 431 pass, 0 fail. A new test checks that "Add a phase" sits at least 8px below the table.
- **Unit tests:** all pass.
