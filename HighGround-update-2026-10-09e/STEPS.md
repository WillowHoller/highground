# HighGround update, 9 Oct (e): cleaner messages, search icon, logo spacing

About 3 minutes. No database step. This package includes everything from 09b, 09c and 09d. If you skipped any of those, run `22_menu_logo.sql` from the 09 package first.

## What changes

- **Messages have three kinds:**
  - **Status notes** (locked, saved, something to fix) are small tinted strips with an icon: blue for information, amber for a warning, red for a problem, green for done.
  - **Explanations** (how the engine counts things) are small grey fine print without a box.
  - **Terms** keep their **?** definitions.
- **Search** is now a magnifying-glass icon in the top bar. Ctrl K still works.
- **Logo in the menu:** it has more room, is centered, and has a line under it.
- **Text runs the full width of the page.** It no longer wraps early or breaks onto new lines.

## Install

1. Go to **github.com/WillowHoller/highground**.
2. Click **Add file → Upload files**.
3. Select **everything in this folder except STEPS.md** (7 files) and drag them onto the page:
   - `app.js`
   - `styles.css`
   - `capital.js`
   - `direction.js`
   - `uploads.js`
   - `test_ui.py`
   - `yearly_test.js`
4. Commit message: `Cleaner messages, search icon, logo spacing`
5. Click **Commit changes**.
6. After about 2 minutes, open **highground.willowholler.com** in a **private/incognito** window.

If your logo still looks off, re-upload it in **Settings → District**. Logos uploaded since 09d are trimmed automatically.

## Try it

- **Money → Capital plan:**
  - The lock note is a slim blue strip.
  - The summary sentence fits on one line.
  - The engine notes are grey fine print near the bottom.
- **Search:** click the magnifying glass at the top right.

## Checked before sending

- **Browser tests:** 425 pass, 0 fail.
- **Unit tests:** all pass.
