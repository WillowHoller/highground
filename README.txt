HighGround update, 25 Nov 2026: community page header and width, white Home panel

Upload these three files to the repo root, replacing the old ones:
  app.js, styles.css, test_ui.py
No database changes. changes.diff shows every changed line.
(Yesterday's README.txt and changes.diff in the repo root can be deleted; they aren't used.)

Community page (#/p/<district>)
- Taller header with room for the logo: up to 76px tall / 300px wide on a computer,
  52px on a phone, with a larger district name.
- No "Back to HighGround" bar. Everyone, signed in or not, sees the same public page.
  The app's "Open the community page" buttons open it in a new tab.
- The page uses the window's width, centred (up to 1680px), at every size, and the
  header's logo lines up with the content's left edge.
- Phones: the priority cards stack instead of swiping sideways, and the spending chart
  fits the screen instead of scrolling.

Home
- The big "is the plan working" panel is always the white panel, whatever the
  district color. The brand color stays in the top bar only.

Tested: unit tests pass; browser test 646 pass. The one failure ("phone sign-in ...
card stays put") was failing before these changes.
