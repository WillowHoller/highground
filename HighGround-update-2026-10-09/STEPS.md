# HighGround update, 9 Oct: the new layout

About 10 minutes: one database step, then the files. It's built on the code that's live on GitHub now. You never paste a password or key anywhere.

## What changes

- **The menu is Home plus four areas.** Each area has its own color, and its screens are listed under it.
  - **Plan:** Priorities, Community input, Initiatives, Ranking, Scenarios.
  - **Money:** Capital plan, General fund, All funds.
  - **Track:** Initiative progress, Measures, Budget vs. actual, Check register.
  - **Share:** Board reports, District plan (was "Plans"), Community page.
  - **Settings:** now opens on a page of cards. Uploads moved here.
- **Look:**
  - a dark green bar across the top;
  - a light menu on the left;
  - a warm gray page with white cards;
  - one typeface throughout.
- **Menu behavior:**
  - Point at an area to see its screens beside the menu.
  - The button at the top left, or the **[** key, shrinks the menu to icons. It remembers your choice.
- **Search:** Ctrl K (Cmd K on a Mac) finds screens and features as well as data. Try "what-if" or "starting numbers".
- **Account menu:** your name sits at the bottom of the menu. Click it for Your account and Sign out. Admins also get **Preview as board member**.
- **Logo:** Settings → District can show the district's logo by itself at the top of the menu.
- **Old links and bookmarks still work.** They open the same screen in its new place.

Nothing about the numbers, the data or who can see what has changed.

---

## 1. Database (Supabase), about 3 minutes

1. Open **supabase.com**, go to the **HighGround** project, and click **SQL Editor → New query**.
2. For each file below, in this order:
   1. Open the file in Notepad.
   2. Select everything (Ctrl+A), copy it, and paste it into Supabase.
   3. Click **Run**.

| # | File | What you should see at the bottom |
|---|---|---|
| 1 | `21_improvement_plan.sql` | 3 rows, all **PASS** |
| 2 | `22_menu_logo.sql` | 1 row, **PASS** |

- **Part 21 is from the 8 Oct update.** Run it even if you already did; it's safe to run again and changes no data. If Supabase warns about "destructive operations", that's the line that replaces a check rule, so run it anyway.
- **Part 22 adds one setting:** whether the menu shows the district's logo alone.

If anything says FAIL or shows red error text, stop and send me a screenshot.

---

## 2. GitHub (the app's files), about 5 minutes

1. Go to **github.com/WillowHoller/highground**.
2. Click **Add file → Upload files**.
3. Open this folder. Select **everything except STEPS.md** (8 files) and drag them onto the page:
   - **App:** `app.js`, `styles.css`
   - **Database:** `21_improvement_plan.sql`, `22_menu_logo.sql`
   - **Tests:** `test_ui.py`
   - **Docs:** `SETUP.md`, `GO_LIVE.md`, `PUBLIC_DATA.md`
4. Wait until all of them are listed. In the first box under "Commit changes", type: `New layout: Home, Plan, Money, Track, Share`
5. Click **Commit changes**.

Wait about 2 minutes, then open **highground.willowholler.com** in a **private/incognito** window, so you don't see the old version from your browser's memory.

---

## 3. Try it

- **Menu:**
  - Point at **Share**. Board reports, District plan and Community page show beside the menu. Click one to go there.
  - Press **[**. The menu shrinks to icons, and pointing at an icon still shows its screens. Press **[** again, or click the button at the top left, to bring it back.
- **Home:** scroll to the bottom. **Everything in HighGround** lists every screen you can open.
- **Search:** press **Ctrl K** and type "what-if". It shows **What-if levers, in Money / Capital plan**; click it.
- **Settings:** opens on the cards, with the "Setup is … done" banner at the top.
- **Board preview:**
  1. Click your name at the bottom of the menu, then **Preview as board member**. You see their menu, with a gold banner across the top.
  2. Click **Back to my view**.
- **Logo:** in **Settings → District**, under **Logo**:
  1. Upload a logo if there isn't one yet.
  2. Choose **Logo only**. The logo replaces the IV square and the name at the top of the menu.
  3. Choose **Initials and name** to switch back.
- **Phone:** the ☰ button slides the menu in. Tap an area to open its screens, then tap one.

## Not in this update

- **A scenario picker in the top bar** (from the mockup). Each screen still has its own scenario picker. A single picker for the whole app needs a bigger change to how screens remember the scenario, so it's a separate step.
- **Combining Initiatives and Ranking** into one screen with a switch, as in the mockup. They're still two screens under Plan.

## Checked before sending

- **Browser tests:** 407 pass, 0 fail. These cover every role's menu, old links landing in their new places, the flyouts, the shrunk menu (it survives a reload), Ctrl K, the board preview, the logo option, the Settings cards, and phones at 375 and 390 wide.
- **Unit tests:** all 20 test files pass.
