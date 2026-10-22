# HighGround update, 21 Oct (d): sizes in every window

Same install as (c) below: **install only this package** (it contains (a), (b) and (c)). Sixteen files.

## What changed in (d)
- **A narrow window on a computer now keeps the computer's sizes.**
  - The large 16px text in boxes and pickers (such as "Why the gap differs") and the tall, full-width pickers were meant for phones. They had been switching on whenever the window was under 820px wide, even on a computer.
  - They now apply only on touch screens (phones and tablets). On a computer, every box, picker and button keeps 14px text and 34px height, at any window width.
- In a narrow window, page pickers (Costs from, Type, Focus area …) stay side by side and wrap, instead of stacking full width.
- **Initiatives:** under 1000px wide, the table drops the Owner column (it's in the editor), so the rest fits.
- **Tables that turn into lists in a narrow window:**
  - Labels read properly ("District baseline · board version", not "District baselineboard version").
  - Bulleted lists (such as "What it asks of the community") read left to right under their label.
- Checked at 1440, 1100, 900 and 760px wide on a computer, and on a phone. No page scrolls sideways, and no box, picker or button is oversized.

Tests: browser 581 pass, 0 fail.

---

# HighGround update, 21 Oct (c): spelling, sizes and polish

**Install only this package.** It contains everything in 21 Oct (a) and (b). Sixteen files.

## Install
1. **Supabase → SQL Editor** (skip if you already did it for (b)): paste `33_warning_checks.sql` and Run. The last result should be 4 rows, all **PASS**.
2. **GitHub → Add file → Upload files:** drag in **all 16 files** in this folder, including STEPS.md and the SQL file. Commit to `main`.
3. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app and reopen it.
4. **Reset Bridger Hollow** (Admin Portal → demo districts → Reset to this demo) for its academic goals.

## What changed in (c)
- **American spelling** throughout the app: color, analyzed (the "Being analyzed" status), recognized, labeled, canceled, fall (not autumn).
- **Rank & fund:** "money runs out" sits to the left of the line when the line is near the right end, so it never falls off the card.
- **One size for controls on a computer:** buttons and boxes are 34px tall (small buttons 28px). On a phone they stay larger for fingers.
- **Folds inside a card** (such as "Other accounts, counted as routine spending" on Initiative progress) are a compact line.
- **Community page publishing:**
  - What's held back is a quiet fold ("8 initiatives held back · the board hasn't approved them yet"), not an orange box.
  - Each option's words stay beside its tick box on a narrower window.
  - There's room before Preview and Publish.
  - The raw web address is replaced by Open the community page ↗ and Copy link.
- **Priorities:**
  - When you pick another priority, its card says "Showing below ▾" and points to the detail.
  - The detail takes that priority's color and slides in, with its heading briefly tinted.
  - If the detail is mostly off screen, the page scrolls to it.

Tests: browser 580 pass, 0 fail; all unit tests pass.

---

# HighGround update, 21 Oct (b): one calm list of checks, capital plan drill-down, scenarios, All funds, Share

Builds on 21 Oct (a). **Install (a) first if you haven't**, or just install this: it contains everything in (a). **It has one SQL file.**

## Install
1. **Supabase → SQL Editor:** paste `33_warning_checks.sql` and Run. The last result should be 4 rows, all **PASS**. (Notices about things that "do not exist, skipping" are fine.) Do this **before** uploading.
2. **GitHub → the HighGround repository → Add file → Upload files.** Drag in: `app.js`, `styles.css`, `capital.js`, `compare.js`, `demo_data.js`, `test_ui.py`, `33_warning_checks.sql`, `STEPS.md`. Commit to `main`.
3. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app and reopen it.
4. **Reset Bridger Hollow** (Admin Portal → the demo districts box → Reset to this demo) to load its new academic goals.

## What changed
- **One list of checks, and "Checked with the business office".** The capital plan and Rank & fund had two boxes saying overlapping things ("charges to confirm with the business office" and an orange "Worth a second look: may be counted twice"). They're now one calm, folded list, "N things to check with the business office". Each item is tagged *Fund rules* or *May be counted twice* and has a **Checked with the business office** button.
  - Once someone clicks it, that item stops being flagged, for everyone in the district and in every scenario. It moves to "already checked", with the date and an **Undo**.
  - If that cost later changes (different fund, years or amount), the check comes back by itself.
  - Charges the law doesn't allow at all are still a red error and can't be dismissed.
  - In the initiative editor, a possible double count shows as a quiet note with a × to close it. It doesn't come back while you're working, and it doesn't show at all once the district has marked it as checked.
  - Before step 1 is run, everything still works; only the Checked button says it needs part 33.
- **Rank & fund → When each can be paid for** now says it in words above the chart. For example: "Bus replacement: FY2033 moves to FY2034. That works: it's paid for." and "FY2033 is still $713k short after moving what can wait. Middle school HVAC upgrade can't wait any longer: it's needed by FY2033. To close it: …"
- **Making a scenario.** Every "make a scenario" button (Rank & fund's four, the capital plan's Copy and Leave projects out, the editor's working copy) now stops with a message if the copy fails, instead of saying "Scenario made". A new scenario shows first on Plan → Scenarios, marked **New** and ticked to compare. Before, the comparison kept the three it already had, so a new one looked missing.
- **Scenarios: Leave initiatives out of the comparison.** Tick initiatives to see every scenario without them. The summary then says which scenario, if any, pays for everything that's left. Nothing is saved.
- **Capital plan: click the chart.** Click a year, or a color in it, to see what's in it:
  - each band (levies and grants, boosters, financed, campaign or bond needed, over capacity);
  - the initiatives, grouped by how they're paid, with Edit, **Leave out (what-if)**, **Mark as campaign or bond** and **Remove from scenario**;
  - each fund's room that year.
  
  A year that's over capacity explains the three ways to fix it. The long "Leave projects out" checklist is folded away, because the chart does it now.
- **General fund:** "New money vs. a negotiated raise" is folded away (closed).
- **All funds:** click a fund's bar under "Funding vs. committed" for that fund year by year, what's already committed (debt, held back, yearly costs) and the projects it pays for.
- **Grants and donations** no longer says "after existing debt payments and what's held back". It now says what its receipts are.
- **Budget vs. actual, Every fund** fits without scrolling sideways. Revenue and spending are grouped, and each status sits under its forecast.
- **Share:**
  - Board reports and decision packets are clear, clickable rows with **Open ›**.
  - The community page is a button (**Open the community page ↗** and **Copy link**), not the raw address.
  - The description matches what's on the page.
  - District plan's controls are three steps: *1. Which plan, 2. What to include, 3. Share it*. Renaming the plan is tucked under a link.
- **Demo:** Bridger Hollow has academic (CSIP) goals: a new goal, "Every student reading and doing math at grade level", with FAST and ISASP measures. "Every graduate ready" is now tagged as a CSIP goal too.

Tests: browser 577 pass, 0 fail; all unit tests pass. SQL 33 tested on a local Postgres after parts 01–30: an editor can mark a check, a viewer can read but not change one, and every change goes to the activity log.

---

# HighGround update, 21 Oct: survey page, Community input, Initiatives and the editor, Rank & fund drag and drop

Builds on 15g (what's on GitHub now). **No SQL.** Four files.

## Install
1. **GitHub → the HighGround repository → Add file → Upload files.** Drag in `app.js`, `styles.css`, `test_ui.py` and `STEPS.md`. Commit to `main`.
2. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app and reopen it.

## What changed
- **Survey page (the public link):** one centred column on a computer, as wide as its heading, instead of a narrow strip at the left.
- **Community input:**
  - One list, **Past surveys**, newest first, whether it was run in HighGround or elsewhere (the separate "Surveys run elsewhere" section is gone). The newest survey with results is shown in full (and anything newer, such as an empty one); older surveys fold to one line that opens to their results.
  - Every survey card has **Edit** and **Delete**. A survey nobody answered says so ("Nobody answered this survey before it closed") instead of a table of "no answers yet".
  - Delete asks first, naming the survey; a survey with answers can only be deleted from inside its editor.
  - The "Time to ask the community" reminder is a blue information box, not red (red is for shortfalls).
- **Priorities:** the Measures button is gone (Measures is under Track).
- **Initiatives:**
  - "Add an initiative" and **"Upload initiatives"** (was "Upload projects"), here and on the other screens that offer the upload.
  - The table: name (click it, or the **Edit** button now on every row), with what it buys and its focus areas as plain grey text underneath; status is the only pill; Priority shows the tier with the strategic priority under it; In plans reads "Board version / and 2 others".
- **Initiative editor:**
  - The ? beside "What it buys" sits on the label's line.
  - Needed by and Board approved line up with the other boxes in their rows.
  - **Add a phase** and **Add a yearly cost** sit together on one line at the end of the costs.
  - Yearly costs fit without scrolling sideways on a computer.
  - "May be counted twice" uses the calmer folded style from the capital plan: one amber line, "Worth a second look: this cost may be counted twice", that opens to the explanation in normal text. (The capital plan and Rank & fund already used it.)
  - **Remove from scenario(s):** lists every scenario the initiative is in; tick one or more and click Remove. Locked scenarios are shown but can't be ticked.
- **Rank & fund:** drag a row by the dotted handle at its left to a new place. The ▲ ▼ arrows and typed rank still work; all three save the same way.

Tests: browser 564 pass, 0 fail (13 new checks); all unit tests pass.

---

# HighGround update, 15 Oct (f): survey reminder emails and bot check, live community surveys, less tidy demo figures, new Priorities page, community blueprint

(f) includes everything in (a) to (e). **It has SQL** (steps 1–2) and two optional pieces set up outside GitHub (the end of this file).

## Install
1. **Supabase → SQL Editor:** paste `30_live_survey.sql` and Run. Every line of the result should say PASS (six lines: the surveys, plus retiring priorities). Do this **before** uploading.
2. **Supabase → SQL Editor:** paste `31_survey_reminders.sql` and Run (all PASS). Don't run `32_survey_bot_check.sql` yet: see "Survey bot check" at the end.
3. **GitHub → the HighGround repository → Add file → Upload files.** Drag in:
   - `app.js`, `styles.css`, `plan.js`, `demo_data.js`
   - `STEPS.md`, `30_live_survey.sql`, `31_survey_reminders.sql`, `32_survey_bot_check.sql`, `submit-survey.ts` (kept with the others)
   - Tests: `test_ui.py`, `plan_test.js`, `actuals_test.js`, `demo_test.js`, `packet_test.js`, `report_test.js`, `submit_survey_test.mjs`
   - Open the **loader** folder in GitHub and upload `survey_reminders.py` and `survey_reminders_test.py` there.
   - **The workflow file:** in GitHub open `.github/workflows/daily-health.yml` → the pencil (Edit) → replace everything with this package's `daily-health.yml` (in the `.github/workflows` folder of the zip; on a Mac that folder is hidden in Finder: press Cmd+Shift+. to show it) → Commit.
   - **Don't upload `config.js`** unless you're switching on the bot check (below).

   Commit to `main`.
4. **Tidy up (recommended):** delete the nine `HighGround-update-2026-10-…` folders from the repository. GitHub Pages publishes everything in the repository, so old copies of the app are reachable on the web. Open each folder in GitHub → the **…** menu → **Delete directory**.
5. In Safari, press **Cmd+Option+R**. On the iPhone, close the home-screen app from the app switcher and reopen it.
6. **Republish the community page** (Share → Community page → Publish) so it shows the blueprint.
7. **Reset Bridger Hollow** (Admin Portal → the demo districts box → **Reset to this demo**) to load the new figures.
8. **Logo:** if Bridger Hollow's logo still looks small, upload it again on Settings → District.


## New in (g): write your own survey questions
In the survey editor, under **Your own questions**, click **Add a question** (up to 10). For each, write the question and choose how people answer:
- **1 to 5 rating**
- **Pick one from a list** (type 2 to 8 choices, one per line; the box appears when you choose this)
- **Yes or no**
- **Short written answer** (up to 500 characters)

A survey can be only your own questions: the three built-in sections are now optional. Your questions appear on the survey page after the built-in ones ("A few more questions"), or on their own ("Questions"). Like the rest of the survey, they're fixed once it opens.

Results: an average for ratings, a count and percentage per choice for pick-one and yes/no, and the written answers listed. **Close and save the results** keeps the averages and counts; written answers stay with the answers (visible to planners), never in the published results.

No SQL change for this: the questions are stored with the survey.

## New in (f): survey reminder emails and a bot check
- **Reminder emails.** Every morning, right after the health check, the same GitHub job emails the people who can start a survey (admins, superintendent, editors) when their district is due to ask the community. It follows each district's setting (quarterly unless changed; off means never), skips demo districts, districts with no priorities yet and districts with a survey open, and sends each district at most one reminder every 30 days. One email per person (nobody sees the others' addresses), with a **Start a survey** button straight to Community input. It uses the Postmark account and GitHub secrets the health check already has: nothing new to set up beyond step 2.
  To run it now instead of waiting for the morning: GitHub → Actions → Daily health check → Run workflow (this sends real reminders to any district that's due); the last step's log lists each district it emailed. To only list who would get one, run `python3 loader/survey_reminders.py --dry-run` with DATABASE_URL set.
- **Survey bot check (optional; switch on before promoting a survey widely).** Cloudflare Turnstile, free. Most people see nothing, or one tick box. Answers then go through a small Supabase function that checks Cloudflare's answer before saving. Setup is at the end of this file. Until it's on, surveys work as in (e), with the database's own limits.

## New in (g): write your own survey questions
In the survey editor, under **Your own questions**, click **Add a question** (up to 10). For each, write the question and choose how people answer:
- **1 to 5 rating**
- **Pick one from a list** (type 2 to 8 choices, one per line; the box appears when you choose this)
- **Yes or no**
- **Short written answer** (up to 500 characters)

A survey can be only your own questions: the three built-in sections are now optional. Your questions appear on the survey page after the built-in ones ("A few more questions"), or on their own ("Questions"). Like the rest of the survey, they're fixed once it opens.

Results: an average for ratings, a count and percentage per choice for pick-one and yes/no, and the written answers listed. **Close and save the results** keeps the averages and counts; written answers stay with the answers (visible to planners), never in the published results.

No SQL change for this: the questions are stored with the survey.

## New in (f)
- **Priorities, calmer detail.** The cards across the top are unchanged. The selected priority below is now three plain parts, separated clearly:
  1. the priority (its name and why it matters);
  2. **Outcomes and how we measure them**: each outcome in bold, its measures in a simple table (Measure · Latest · Target · Status);
  3. **Initiatives serving it**: a simple table (Initiative · Status · Cost) with the total.
  Color appears only on the small status dot; only "Off track" is in red. The red "Needs attention" box, progress bars, trend lines and colored pills are gone from this view (the cards already flag what's off track).
- **Edit priorities** replaces Arrange. It lists every priority: click a name to change its name, description or outcomes; ▲▼ to reorder; **Retire** for one the district has achieved or stopped working toward.
- **Retiring a priority** (new; needs the SQL): it leaves the cards, Home, the district plan, reports and the community page (after you next publish). Its measures and initiatives are kept; initiatives linked to it show as not linked to a priority. Retired priorities are listed under Edit priorities with **Bring it back**.
- **Worth a second look:** the box and heading are unchanged; the explanation underneath is normal dark text instead of orange.
- **Community input:** "Time to ask the community" is its own red box at the top of the page, above Ask the community. "Remind us to ask" sits on the same line as Start a survey, at the right.
- **Survey editor:** the Name and Open until boxes line up; "(optional)" sits on the same line as its label (also on the survey page itself).

## New in (e): live community surveys
Plan → Community input now runs surveys inside HighGround (the old way, typing in results from a survey run elsewhere, still works under "Surveys run elsewhere").
- **Start a survey:** name it, optionally a closing date and a note at the top, and choose what it asks (any mix):
  - **How are we doing?** a 1–5 rating for each priority;
  - **Ideas we're considering:** 1–5 support for the initiatives that aren't approved yet (you tick which);
  - **Your ideas:** an open box, optionally tagged to a priority.
  **Open it now** or save it as a draft.
- **Share it:** the open survey shows its link (highground.willowholler.com/#/s/your-district) with **Copy link**, and a ready-to-paste newsletter paragraph. While it's open, the community page shows a "Take the survey" box at the top.
- **Answering:** no sign-in, phone-friendly, big 1–5 buttons. No names, emails or addresses are asked. One answer per device (a random id the browser keeps, not a fingerprint). An optional "I am a…" (parent, staff, community member, student).
- **Results as they come in:** average rating per priority, support per idea (highest first), the ideas people wrote, and who answered. Labeled "open input, not a scientific poll".
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
- **A card per priority across the top**: its number and name in its own color, one big number ("2 of 3 measures on track") with status dots, a red line only when something is off track, and chips for its initiatives and the community's importance score.
- **Click a card** and the detail below changes in place (no reload):
  - **Needs attention** first (off-track measures and overdue updates), or one green line saying nothing does;
  - each **outcome** with its measures, one line each: latest → target, a progress bar from where it started, a small trend line, and a status pill in the same colors as Budget vs. actual;
  - the **initiatives serving it** as small cards with status and cost, and their total.
- The ▲▼ arrows moved behind **Arrange priorities** (planners only). Board members and viewers see a clean page.
- On phones the cards swipe sideways and the detail stacks underneath.

### Community page = the district blueprint
When the district publishes (Share → Community page → Publish), the page now opens with:
1. a band in the district's color with the plan's name and three big numbers (priorities, measures on track, initiatives);
2. **Our focus**: the priority cards, with why each matters;
3. **What you told us**: the latest survey (if included);
4. **What we're doing**: initiatives by priority, then what's finished;
5. **How we're doing**: each priority's measures (latest, target, progress, status);
6. **How it's paid for**: the capital plan exactly as before, levers and tax impact included.

Links at the top jump to each section. A new box on the publish card, **Include the district blueprint**, is ticked by default. The hold-back rule applies: proposals still under consideration never appear. **The live community page changes only when you publish again**; pages published before this update look as they did.

# Earlier in this update: 15 Oct (b)

This replaces the first 15 Oct package. If you already installed that one, install this over it: same files, plus the changes under "New in (b)".

Builds on 14 Oct (f), the version in your highground-main download. **No SQL.**

**Important:** the 14 Oct (g) package (new chart colors, warning-icon fix, demo check register) was never installed: your repository has its test file but not its app.js, capital.js or styles.css. **Don't install 14 Oct (g) now**: it would undo this update. This update includes its colors and the warning fix. Its demo check register isn't included (the check register is hidden for now anyway); if you want it back later, send Claude the 14g folder to merge.

## New in (b)
- **District plan (Share → District plan), on screen:** a designed page instead of a report.
  - A band in the district's color with the plan's name, and four big numbers: approved initiatives, one-time cost, yearly cost, and what's still to find (or "Paid for").
  - One colored card per goal: why it matters, "2 of 3 measures on track" with dots, each measure with its latest value, target and a progress bar from where it started.
  - Initiatives as cards by status; the years as a bar timeline; each capital fund as two bars (money to spend, planned spending).
  - **Print or save as PDF still produces the full tables**, as before.
- **Budget vs. actual, every table speaks the same colors:** Every fund has a budget-used bar and colored status pills (On pace, Running ahead, Over by …; revenue On budget, Ahead by …, Short by …), labeled columns and the key. The held-back card's status is a pill too.
- **The name is the link, everywhere:** measures, assumption sets, financing (bonds, leases, campaigns) and priorities now open their editor from the name, like initiatives and scenarios. The "Edit" links at the far right are gone. On Measures, the Record button stays, under a "Result" heading.

## Still open
- A QR code for the survey link (for printed flyers and posters), if wanted.
- The 14 Oct (g) demo check register, when the check register comes back.

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
  - The unlabeled last column is gone. Its flags (over plan, contract problems) sit under the initiative's name; "No spending yet" is dropped.
  - Account linking: accounts that look like one initiative's (same project code, or its name in the description) come first. Broad accounts fold away as **routine spending**, which counts against what the fund holds back each year.
- **Budget vs. actual:** spending-by-function bars are colored (green on pace, orange running ahead of the year, red forecast over budget) with one key under the table; the last column only speaks up when something is over.
- **Check register: hidden.** No menu item, upload type, Home line or search entry. The code, tables and rules stay; one switch in app.js (`SWITCH.register`) brings it back.
- **Initiative types** renamed for what the money buys (the stored values don't change, so fund-rule checks work as before): Building, site or major equipment · Technology · Program or service · Staff or hire · Curriculum or instructional materials · Other. Academics, Safety & security and the like stay in **Focus area**. The field is now "What it buys", with a ? that explains the difference.
- **Phones, All funds:** two cards no longer run 2 px past the edge.
- **Chart colors (from 14 Oct (g)):** red only for shortfalls. Campaign/bond needed is violet, financed is gold, over capacity is orange.

## Tests
- Unit tests: 30 files, all pass. Golden engine cases: 32, 0 differences (the engine and the money math are unchanged).
- Browser: **551 pass, 0 fail** (was 507 pass, 5 fail on the downloaded code: four expected the 14g demo check register, one was a phone overflow on All funds, now fixed). New checks cover each change above, plus one that the check register is hidden by default.

## Survey bot check: switching it on (optional, about 15 minutes)
Do these in order. Surveys keep working at every step; step 5 is what makes the check required.
1. **Cloudflare** (free account at dash.cloudflare.com) → **Turnstile** → **Add widget**. Name: HighGround surveys. Hostname: `highground.willowholler.com`. Widget mode: **Managed**. Create. Copy the **Site key** and the **Secret key**.
2. **Supabase → Edge Functions → Deploy a new function**, name it exactly `submit-survey`, paste the whole of `submit-survey.ts`, Deploy. In the function's **Settings**, turn **off** "Verify JWT" (visitors aren't signed in; the Cloudflare answer is what's checked). Save.
3. **Supabase → Edge Functions → Secrets → Add:** `TURNSTILE_SECRET_KEY` = the Secret key from step 1. (Supabase supplies the database URL and its own key to the function automatically.)
4. **GitHub → `config.js` → Edit:** paste the Site key between the quotes on the `turnstileSiteKey: ''` line. Commit. Hard-refresh. Open the survey link on your phone: you should see the small Cloudflare check above **Send my answers**, and a test answer should say "Thank you".
5. **Supabase → SQL Editor:** run `32_survey_bot_check.sql` (both lines PASS). From now on answers can only arrive through the checked function.
To switch it off: run the two "undo" lines at the bottom of `32_survey_bot_check.sql`, then empty `turnstileSiteKey` in `config.js`.
