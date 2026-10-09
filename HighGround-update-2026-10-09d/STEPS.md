# HighGround update, 9 Oct (d): logos of any shape

About 3 minutes. **No database step.**

This package includes everything from updates (b) and (c). If you skipped either, this covers them.

## 1. GitHub

1. Go to **github.com/WillowHoller/highground**, then **Add file → Upload files**.
2. Open this folder. Select **everything except STEPS.md** (6 files) and drag them onto the page:
   `app.js`, `styles.css`, `capital.js`, `direction.js`, `uploads.js`, `test_ui.py`
3. In the first box under "Commit changes", type: `Logos of any shape`
4. Click **Commit changes**.
5. Wait about 2 minutes, then open HighGround in a **private/incognito** window.

## 2. Upload the logo again

A logo that's already uploaded isn't changed, so **upload it once more**:

1. Go to **Settings → District**, then **Logo → Replace logo**.
2. Choose the same file.

## What changed

- **Empty margins are cropped on upload.** Most logo files have a wide white or clear border around the artwork, and that was what made yours look tiny. HighGround now crops it away, keeping a little breathing room. It also scales big files down to 800 pixels, and keeps a clear background clear.
- **Every shape gets room in the menu.** The box and border around the logo are gone.
  - A **square badge** (like the Bridger Hollow fox) stands up to 72 pixels tall.
  - A **wide wordmark** fills the menu's width.
  - A **tall crest** stands 72 pixels tall.
  - A very wide, thin banner (8:1 or wider) will look small; a version with the name stacked over two lines works better.
- **Settings → District shows how it will look**, at the menu's real size, next to the upload button.
- **Bigger files allowed:** up to 10 MB (it's resized before it's saved).
- **Small images get a warning.** Anything under 120 pixels gets a note that it may look soft; 400 pixels or more across looks sharp.
- **The public page** shows the logo at its natural shape too.

## Best file to use

- A **PNG with a clear (transparent) background**, at least **400 pixels across**.
- A square or wide version both work.
- Most districts have one on their website, or the communications office can send the "full-color logo PNG".

## Checked before sending
- **Browser tests:** 425 pass, 0 fail, including a new check that white and clear margins are cropped.
- **Unit tests:** all 20 test files pass.
