# HighGround update, 9 Oct (b): the next layer, plus your fixes

About 5 minutes. **No database step**: just the files. It goes on top of this morning's update (the new layout), which you've already installed.

## 1. GitHub

1. Go to **github.com/WillowHoller/highground**, then **Add file → Upload files**.
2. Open this folder. Select **everything except STEPS.md** (6 files) and drag them onto the page:
   `app.js`, `styles.css`, `capital.js`, `direction.js`, `uploads.js`, `test_ui.py`
3. In the first box under "Commit changes", type: `Next layer: scenario picker, presenting, templates, fixes`
4. Click **Commit changes**.
5. Wait about 2 minutes, then open HighGround in a **private/incognito** window (on the phone too).

## 2. What's new, and what to try

**Fixes you reported**
- **Phone scrolling:**
  - Following a link inside a pop-up (Help, Search) left the page locked, so it wouldn't scroll. Fixed.
  - The two-tone stripe behind the page on phones is gone.
- **Sizes:**
  - The menu is smaller and fits on a laptop screen without scrolling.
  - Text, headings, cards and numbers are back to a normal size.
- **Search** now sits on the right, between the demo tag and Help.
- **Public preview:** "Preview" on the community page now opens at the top.
- **All funds → Funding vs. committed:** under each fund's bar there's now a key in the same colors, in the same order, with the amounts.
- **Wording:**
  - "Settlement" is now **"Total package increase"** (or "negotiated raise"), with a "?" definition.
  - The debt-levy note now explains itself: those bonds are paid by their own property tax, not from SAVE or PPEL.
  - "Month-end export" is now **"month-end general ledger (GL) export"**, with a "?" explaining how it differs from the check register.

**New**
- **Adding an initiative:** costs and phases are open straight away, approved or not.
  - They go into the scenario on screen if it can be changed.
  - If every scenario is locked, they go into a **working copy of the board version**, made when you save. The board version stays as adopted.
  - Leave the cost blank if you don't know it yet.
- **Click a measure to see it:** an off-track measure on Home, a measure on Priorities, or a measure in the District plan opens **Track → Measures** at that measure, highlighted.
- **Templates with instructions:** every template you can download now has a second sheet, **"How to fill this in"**. It covers what each column takes, with examples, and where to upload it. This covers:
  - projects, fund balances, goals, measure results, the community survey and the staff list;
  - the **survey template, which is simpler:** Kind, Item, Score or %, How many mentioned it, and Priority it relates to.
- **One scenario across the app:** a **Scenario** picker in the top bar. It changes Initiatives, Ranking, the capital plan and the General Fund together. Screens that always use the board version say "Board version". Board members never get the picker.
- **Initiatives and Ranking are one screen:** Plan → Initiatives has **List | Ranked** at the top right.
- **Present** (the screen icon next to Help), for a board meeting:
  - The menus disappear, the type gets bigger, and it shows the **board's view**, with no editing buttons or setup notes.
  - Move between screens with the bar at the bottom or the ← → keys. **Esc** or **Exit** ends it.
  - Try it on Money → Capital plan.
- **Old dates flagged (the 8 Oct "n" update, now included):** balances from before July 1, 2026 mean the plan starts in a year that has already ended. Starting numbers, the setup wizard and Home now say so. The enrollment labels say which October 1 count it is and which year it funds.

## Checked before sending
- **Browser tests:** 423 pass, 0 fail. These cover the menu fitting a 1366×768 laptop, phone scrolling after a pop-up, the preview opening at the top, presenting, the scenario picker, List/Ranked, measure links, new-initiative costs, and the funds key.
- **Unit tests:** all 20 test files pass.
