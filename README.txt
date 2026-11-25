HighGround update, 24 Nov 2026: brand-colored header, neutral demo tag, demo state

Upload these four files to the repo root, replacing the old ones:
  app.js, styles.css, test_ui.py, STATES.md
No database changes. changes.diff shows every line that changed.

What changed
- Top bar takes the district's brand color. Text, icons, the HighGround wordmark and the
  demo tag switch light/dark by contrast. No brand color = HighGround green.
- Demo tag is neutral (never the brand color): "Demo · Iowa" for staff (click to switch
  state), "Demo district" for everyone else.
- The staff-only "State view" override and its banner are gone. Every district follows
  its own state. The old saved setting clears itself on next load.
- Demo districts: switch state from the demo tag or Admin Portal > Districts > Change...
  Either load that state's demo data (Prairie Fork for Nebraska, Bridger Hollow for Iowa)
  or keep the current figures. Real districts' state is read-only in the table.

Tested: all unit tests and guardrail pass; browser test 643 pass. The one failure
("phone sign-in ... card stays put") fails the same way on the code before this change.
