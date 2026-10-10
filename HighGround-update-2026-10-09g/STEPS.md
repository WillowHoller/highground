# HighGround update, 9 Oct (g): "whichever fund has room"

About 6 minutes: one database step, then the files. It includes everything from 09b–09f, so if you skipped any of those, this covers them. If you never ran `22_menu_logo.sql`, run it first.

## What changes

### A project can list funds to choose from, not just a split

A phase can now be paid from **whichever fund has room**, in the order you list them, for example "SAVE, then PPEL" or "PPEL, then Grants, then Campaign/bond".

- **In the editor:** under **Paid from**, add a second (or third) fund. A new box appears:
  - **Split the cost**: what it did before (60% SAVE, 40% PPEL).
  - **Whichever has room, in this order**: the funds are numbered 1, 2, 3, and the percentages disappear.
- **How the plan picks:**
  - Each year, it works down the list of initiatives.
  - Each phase is paid **in full** from its first choice that has room.
  - If none has room, it goes to the fund with the most room, and the shortfall shows in the gap as usual.
  - Boosters and Campaign/bond have no yearly limit, so as a last choice they always catch it.
- **On Projects by year:** the card shows the fund the plan used, plus the other choices in a dashed outline ("Grants · or PPEL"). A ↺ means the first choice was full that year. Point at it for the reason.
- **What uses the plan's pick:** the decision packet uses it too. The District plan lists the choices, for example "SAVE or PPEL".
- **Uploads:** write "SAVE or PPEL" in **Funding source** and leave **Funding %** blank. The template has an example row (Playground equipment), and its instructions explain it.
- **The demo:** Ironwood Valley's playground surfacing is now "Grants or PPEL".

Check with the business manager that a project fits each fund's rules. The **?** next to **Paid from** says so too.

### Home

The contour lines behind the welcome text are replaced with a faint, layered ridgeline that fades in from the right.

## 1. Database (Supabase), about 2 minutes

1. Open **supabase.com**, go to the **HighGround** project, and click **SQL Editor → New query**.
2. Open `23_fund_options.sql` in Notepad, select everything (Ctrl+A), copy it, paste it into Supabase, and click **Run**.
3. You should see **2 rows, both PASS**.

If Supabase warns about "destructive operations", that's the line that replaces the Copy scenario function. Run it anyway; no data changes.

If anything says FAIL or shows red error text, stop and send me a screenshot.

## 2. GitHub, about 4 minutes

1. Go to **github.com/WillowHoller/highground** → **Add file → Upload files**.
2. Drag in **everything except STEPS.md** (16 files):
   - **App:** `app.js`, `styles.css`, `engine.js`, `capital.js`, `uploads.js`, `plan.js`, `packet.js`, `compare.js`, `direction.js`, `demo_data.js`
   - **Database:** `23_fund_options.sql`
   - **Tests:** `test_ui.py`, `uploads_test.js`, `yearly_test.js`, `fundchoice_test.js`
   - **Docs:** `SETUP.md`
3. Commit message: `Fund choices: whichever has room`
4. Click **Commit changes**.
5. After about 2 minutes, open the app in a **private/incognito** window.

## 3. Try it

1. In the demo, go to **Money → Capital plan** and look at FY2029. **Playground surfacing** shows **Grants · or PPEL**.
2. Pick an unlocked scenario and open a project.
3. Under **Paid from**, click **Add a fund**, choose a second fund, and set the box to **Whichever has room, in this order**.
4. Save. The year cards show which fund the plan used.

## Checked before sending

- **Browser tests:** 428 pass, 0 fail. New tests cover:
  - the chips on the year cards;
  - the editor opening in "whichever has room";
  - saving fund choices;
  - uploads with "SAVE or PPEL".
- **Unit tests:** all 21 files pass. New tests check:
  - the plan takes the first choice with room, then the next;
  - a phase goes to the fund with the most room when none fits;
  - Campaign/bond catches what's left as a last choice;
  - higher-ranked projects choose first;
  - plans without choices give exactly the same numbers as before.
