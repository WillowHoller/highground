# HighGround update, 15 Oct (e): live community surveys, less tidy demo figures, new Priorities page, community blueprint

(e) includes everything in (a) to (d). **This one has SQL** (step 1).

## Install
1. **Supabase → SQL Editor:** paste `30_live_survey.sql` and Run. Every line of the result should say PASS. Do this **before** step 2.
2. **GitHub → the HighGround repository → Add file → Upload files.** Drag in:
   - `app.js`, `styles.css`, `plan.js`, `demo_data.js`
   - `STEPS.md`, `30_live_survey.sql` (to keep it with the others)
   - Tests: `test_ui.py`, `plan_test.js`, `actuals_test.js`, `demo_test.js`, `packet_test.js`, `report_test.js`

   Commit to `main`.
3. **Tidy up (recommended):** delete the nine `HighGround-update-2026-10-…` folders from the repository. GitHub Pages publishes everything in the repository, so old copies of the app are reachable on the web. Open each folder in GitHub → the **…** menu → **Delete directory**.
4. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app from the app switcher and reopen it.
5. **Republish the community page** (Share → Community page → Publish) so it shows the blueprint.
6. **Reset Bridger Hollow** (Admin Portal → the demo districts box → **Reset to this demo**) to load the new figures.
7. **Logo:** if Bridger Hollow's logo still looks small, upload it again on Settings → District.


## New in (e): live community surveys
Plan → Community input now runs surveys inside HighGround (the old way, typing in results from a survey run elsewhere, still works under "Surveys run elsewhere").
- **Start a survey:** name it, optionally a closing date and a note at the top, and choose what it asks (any mix):
  - **How are we doing?** a 1–5 rating for each priority;
  - **Ideas we're considering:** 1–5 support for the initiatives that aren't approved yet (you tick which);
  - **Your ideas:** an open box, optionally tagged to a priority.
  **Open it now** or save it as a draft.
- **Share it:** the open survey shows its link (highground.willowholler.com/#/s/your-district) with **Copy link**, and a ready-to-paste newsletter paragraph. While it's open, the community page shows a "Take the survey" box at the top.
- **Answering:** no sign-in, phone-friendly, big 1–5 buttons. No names, emails or addresses are asked. One answer per device (a random id the browser keeps, not a fingerprint). An optional "I am a…" (parent, staff, community member, student).
- **Results as they come in:** average rating per priority, support per idea (highest first), the ideas people wrote, and who answered. Labelled "open input, not a scientific poll".
- **Close and save the results:** stores the averages (never individual answers) so they show on Priorities and, when you next publish, on the community page under "What you told us".
- **Reminders:** Home and Community input say "Time to ask the community" when the last survey is older than the district's setting: **every quarter by default**, or monthly, every six months, yearly, or off (a district admin changes it on Community input).

**Security (the reason for the SQL):** this is the first time people who aren't signed in can write anything. They can't touch any table: answers go only through one database function that checks the survey is open, limits the size of each answer, keeps one answer per device and caps a survey at 5,000 answers a day. Only people who can plan in the district can read the answers.
**Not included yet:** a bot check (Cloudflare Turnstile, free) and reminder emails. Both need a small server-side piece; worth adding before a district promotes a survey widely.

## New in (d)
- **Bridger Hollow's figures are less tidy.** Costs are no longer round thousands: the roof is $407,850 and $461,300, the boiler $628,900, the CTE addition $184,600 then $2,386,000, the bus rises a little each year ($146,500 to $191,400), and so on. The FFA teacher is $67,400 and supplies $7,350 a year. The story is the same: the money still runs out after #7, the same three flags explain it, and the gap is $3.77M (was $3.82M). Every reset gives the same district, so the screens, flyer and tests stay predictable.
- **A non-FFA example of a first-year cost plus yearly costs:** the secure entry vestibules (already in the demo) are $213,480 from SAVE in FY2027, then $17,650 a year from SAVE (monitoring and maintenance) and, new, **$6,480 a year from the General Fund** for a visitor check-in subscription. It shows up in Rank & fund, the General Fund forecast and the initiative's editor.
- **Community page:** the band now counts approved work separately from proposals ("12 approved or under way · 3 proposed, still being considered").
- The made-up ledger follows each year's planned costs, so actual spending scales with the new figures.

## New in (c)
### Priorities (Plan → Priorities)
- **A card per priority across the top**: its number and name in its own colour, one big number ("2 of 3 measures on track") with status dots, a red line only when something is off track, and chips for its initiatives and the community's importance score.
- **Click a card** and the detail below changes in place (no reload):
  - **Needs attention** first (off-track measures and overdue updates), or one green line saying nothing does;
  - each **outcome** with its measures, one line each: latest → target, a progress bar from where it started, a small trend line, and a status pill in the same colours as Budget vs. actual;
  - the **initiatives serving it** as small cards with status and cost, and their total.
- The ▲▼ arrows moved behind **Arrange priorities** (planners only). Board members and viewers see a clean page.
- On phones the cards swipe sideways and the detail stacks underneath.

### Community page = the district blueprint
When the district publishes (Share → Community page → Publish), the page now opens with:
1. a band in the district's colour with the plan's name and three big numbers (priorities, measures on track, initiatives);
2. **Our focus**: the priority cards, with why each matters;
3. **What you told us**: the latest survey (if included);
4. **What we're doing**: initiatives by priority, then what's finished;
5. **How we're doing**: each priority's measures (latest, target, progress, status);
6. **How it's paid for**: the capital plan exactly as before, levers and tax impact included.

Links at the top jump to each section. A new box on the publish card, **Include the district blueprint**, is ticked by default. The hold-back rule applies: proposals still under consideration never appear. **The live community page changes only when you publish again**; pages published before this update look as they did.

# Earlier in this update: 15 Oct (b)

This replaces the first 15 Oct package. If you already installed that one, install this over it: same files, plus the changes under "New in (b)".

Builds on 14 Oct (f), the version in your highground-main download. **No SQL.**

**Important:** the 14 Oct (g) package (new chart colours, warning-icon fix, demo check register) was never installed: your repository has its test file but not its app.js, capital.js or styles.css. **Don't install 14 Oct (g) now**: it would undo this update. This update includes its colours and the warning fix. Its demo check register isn't included (the check register is hidden for now anyway); if you want it back later, send Claude the 14g folder to merge.

## New in (b)
- **District plan (Share → District plan), on screen:** a designed page instead of a report.
  - A band in the district's colour with the plan's name, and four big numbers: approved initiatives, one-time cost, yearly cost, and what's still to find (or "Paid for").
  - One coloured card per goal: why it matters, "2 of 3 measures on track" with dots, each measure with its latest value, target and a progress bar from where it started.
  - Initiatives as cards by status; the years as a bar timeline; each capital fund as two bars (money to spend, planned spending).
  - **Print or save as PDF still produces the full tables**, as before.
- **Budget vs. actual, every table speaks the same colours:** Every fund has a budget-used bar and coloured status pills (On pace, Running ahead, Over by …; revenue On budget, Ahead by …, Short by …), labelled columns and the key. The held-back card's status is a pill too.
- **The name is the link, everywhere:** measures, assumption sets, financing (bonds, leases, campaigns) and priorities now open their editor from the name, like initiatives and scenarios. The "Edit" links at the far right are gone. On Measures, the Record button stays, under a "Result" heading.

## Not yet changed (next packages)
- The community survey (collected in HighGround, with reminders).
- The demo data refresh (Bridger Hollow less tidy; vestibules with a yearly General Fund cost).

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
- Browser: **540 pass, 0 fail** (was 507 pass, 5 fail on the downloaded code: four expected the 14g demo check register, one was a phone overflow on All funds, now fixed). New checks cover each change above, plus one that the check register is hidden by default.
