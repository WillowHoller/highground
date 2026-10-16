# HighGround update, 15 Oct (b): screen fixes, check register hidden, clearer money charts, a designed district plan

This replaces the first 15 Oct package. If you already installed that one, install this over it: same files, plus the changes under "New in (b)".

Builds on 14 Oct (f), the version in your highground-main download. **No SQL.**

**Important:** the 14 Oct (g) package (new chart colours, warning-icon fix, demo check register) was never installed: your repository has its test file but not its app.js, capital.js or styles.css. **Don't install 14 Oct (g) now**: it would undo this update. This update includes its colours and the warning fix. Its demo check register isn't included (the check register is hidden for now anyway); if you want it back later, send Claude the 14g folder to merge.

## Install
1. **GitHub → the HighGround repository → Add file → Upload files.** Drag in:
   - `app.js`, `styles.css`, `plan.js`
   - `STEPS.md`
   - Tests: `test_ui.py`, `plan_test.js`

   Commit to `main`.
2. **Tidy up (recommended):** delete the nine `HighGround-update-2026-10-…` folders from the repository. GitHub Pages publishes everything in the repository, so old copies of the app are reachable on the web. Open each folder in GitHub → the **…** menu → **Delete directory**.
3. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app from the app switcher and reopen it.
4. **Logo:** if Bridger Hollow's logo still looks small, upload it again on Settings → District.

## New in (b)
- **District plan (Share → District plan), on screen:** a designed page instead of a report.
  - A band in the district's colour with the plan's name, and four big numbers: approved initiatives, one-time cost, yearly cost, and what's still to find (or "Paid for").
  - One coloured card per goal: why it matters, "2 of 3 measures on track" with dots, each measure with its latest value, target and a progress bar from where it started.
  - Initiatives as cards by status; the years as a bar timeline; each capital fund as two bars (money to spend, planned spending).
  - **Print or save as PDF still produces the full tables**, as before.
- **Budget vs. actual, every table speaks the same colours:** Every fund has a budget-used bar and coloured status pills (On pace, Running ahead, Over by …; revenue On budget, Ahead by …, Short by …), labelled columns and the key. The held-back card's status is a pill too.
- **The name is the link, everywhere:** measures, assumption sets, financing (bonds, leases, campaigns) and priorities now open their editor from the name, like initiatives and scenarios. The "Edit" links at the far right are gone. On Measures, the Record button stays, under a "Result" heading.

## Not yet changed (next packages)
- **The community page** looks the same apart from the Sign in move and the back bar: the published district blueprint (focus, what you told us, what we're doing, how we're doing) is the next build.
- The priorities page redesign and the community survey.

## What changed
- **Warning cards** ("4 costs may be counted twice"): icon, arrow and words on one line.
- **Phones:** when a screen has sub-menu tabs, the breadcrumb, title and description step aside, so content starts near the top.
- **Community page:**
  - No Sign in button in the header; a small line at the foot says "District staff or board member? Sign in".
  - Anyone signed in sees a green "← Back to HighGround" bar at the top. On the iPhone home-screen app the page can open in the app's own window, which has no back button. Residents never see the bar.
- **District logo:** fills the menu's width (up to 104 px tall). Help text next to the upload says what works best.
- **Rank & fund:** the funding-line column is narrower and its labels wrap, so initiative names get the room.
- **Scenarios:** the name is the link (the column of "Open" links is gone); locked scenarios show a lock icon with a tooltip.
- **Scenario pickers:** wider (up to 440 px in the top bar).
- **Funding vs. committed:** the tan area was the empty part of the bar, because every bar was drawn to the scale of the largest fund. Now each bar is its own fund's money, full width. "Left over" is now **"Not committed yet"**, and the heading says how much that is. "Available" is the whole bar: starting balance plus every year's receipts.
- **Initiative progress:**
  - The unlabelled last column is gone. Its flags (over plan, contract problems) sit under the initiative's name; "No spending yet" is dropped.
  - Account linking: accounts that look like one initiative's (same project code, or its name in the description) come first. Broad accounts fold away as **routine spending**, which counts against what the fund holds back each year.
- **Budget vs. actual:** spending-by-function bars are coloured (green on pace, orange running ahead of the year, red forecast over budget) with one key under the table; the last column only speaks up when something is over.
- **Check register: hidden.** No menu item, upload type, Home line or search entry. The code, tables and rules stay; one switch in app.js (`SWITCH.register`) brings it back.
- **Initiative types** renamed for what the money buys (the stored values don't change, so fund-rule checks work as before): Building, site or major equipment · Technology · Program or service · Staff or hire · Curriculum or instructional materials · Other. Academics, Safety & security and the like stay in **Focus area**. The field is now "What it buys", with a ? that explains the difference.
- **Phones, All funds:** two cards no longer run 2 px past the edge.
- **Chart colours (from 14 Oct (g)):** red only for shortfalls. Campaign/bond needed is violet, financed is gold, over capacity is orange.

## Tests
- Unit tests: 30 files, all pass. Golden engine cases: 32, 0 differences (the engine and the money math are unchanged).
- Browser: **525 pass, 0 fail** (was 507 pass, 5 fail on the downloaded code: four expected the 14g demo check register, one was a phone overflow on All funds, now fixed). New checks cover each change above, plus one that the check register is hidden by default.
