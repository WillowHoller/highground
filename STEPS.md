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
  Colour appears only on the small status dot; only "Off track" is in red. The red "Needs attention" box, progress bars, trend lines and coloured pills are gone from this view (the cards already flag what's off track).
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
  - The unlabelled last column is gone. Its flags (over plan, contract problems) sit under the initiative's name; "No spending yet" is dropped.
  - Account linking: accounts that look like one initiative's (same project code, or its name in the description) come first. Broad accounts fold away as **routine spending**, which counts against what the fund holds back each year.
- **Budget vs. actual:** spending-by-function bars are coloured (green on pace, orange running ahead of the year, red forecast over budget) with one key under the table; the last column only speaks up when something is over.
- **Check register: hidden.** No menu item, upload type, Home line or search entry. The code, tables and rules stay; one switch in app.js (`SWITCH.register`) brings it back.
- **Initiative types** renamed for what the money buys (the stored values don't change, so fund-rule checks work as before): Building, site or major equipment · Technology · Program or service · Staff or hire · Curriculum or instructional materials · Other. Academics, Safety & security and the like stay in **Focus area**. The field is now "What it buys", with a ? that explains the difference.
- **Phones, All funds:** two cards no longer run 2 px past the edge.
- **Chart colours (from 14 Oct (g)):** red only for shortfalls. Campaign/bond needed is violet, financed is gold, over capacity is orange.

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
