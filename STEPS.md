# HighGround update, 14 Oct (c): choosing where costs go, and clearer fund splits

Builds on 14 Oct (b). **No database change.** Upload to GitHub: `app.js`, `styles.css`, `test_ui.py`, `STEPS.md`. Then republish Bridger Hollow's community page (Share → Community page → Publish) so the new note appears. Then Cmd+Option+R in Safari.

## Where an initiative's costs go
- The picker is now **"Save its costs to"**, in three plain groups:
  - **Working scenarios: try ideas without changing the adopted plan.** A new initiative goes here by default.
  - **A new working copy of the adopted plan** (made when you save).
  - **The adopted plan: the board's approved version.** Listed separately and never chosen for you.
- The line under the picker says what the choice means. For the adopted plan: "This is the adopted plan, the version the board approved. It feeds Home, Rank & fund, the board report and the public page…"
- **Saving to the adopted plan asks first:** "Change the adopted plan? … Saving X here changes what Home, Rank & fund and the board report show… The public page keeps the last published version until an admin publishes again. To try it out first, click Cancel and choose a new working copy."
  - If it's locked, an admin's save **unlocks it just long enough to save, then locks it again**. No more "go unlock it on the Capital plan first".
  - Anyone who isn't an admin sees it as "(admin only)" and is pointed to a working scenario or a working copy.
- **The Capital plan, on the locked adopted plan,** now has an **Add an initiative** button too; it opens the same picker.

## Splitting a cost: phases vs. funds
Your screenshot: three phases of $32M, $32M and $64M, each with a 25/25/50 "%" that was meant to split the project between funds. The % box only ever meant "this phase's share from this fund".
- **With one fund, there's no % box at all.** The fund pays the whole phase.
- **With two or three funds,** each share shows its dollars as you type ("25 % = $8,000,000"), and the column says "add a fund to split this phase's cost".
- **A running total under the phases:** "Total one-time cost: $128,000,000 in 3 phases" with a tag per fund ("SAVE $32,000,000 · PPEL $32,000,000 · Grants/Donations $64,000,000"), so either way of entering it is easy to check.
- If shares don't add to 100%, the message says why: "they split one phase between funds, not the project between phases."
- So, for one project paid 25% SAVE / 25% PPEL / 50% grants in one year: **one phase, $128M, three funds at 25/25/50** — or three phases with one fund each, as you entered it. Both now show the same totals.

## Community page: why the chart shows only levies
Not a bug in the chart, but it was far too easy to miss. Publishing **holds back initiatives the board hasn't approved** (the "Hold back" box, on by default). In Bridger Hollow every campaign, bond and booster project is still an idea, a proposal or being analysed (CTE and ag addition, track, turf), so the community version has only levy-funded projects. The board version has them all.
- **Share → Community page** now lists exactly what's held back, with each one's status and funds ("CTE and ag building addition · being analysed · SAVE + campaign/bond"), and says how to show them: approve them on Initiatives, or untick Hold back, then publish again.
- **The public page** now says at the top: "This page shows what the board has approved. 8 more initiatives are still being considered and aren't shown, including 3 that would be paid partly by a campaign, bond or boosters." (Counts only: no names of unapproved items go public.)
- The public page also only changes when an admin publishes again; it doesn't follow edits to the board version on its own.

## Tests
Unit: 27 files pass. Browser: 483 checks, all pass (new: picker groups and default, confirm-and-relock on the adopted plan, no % with one fund, dollars per share, running total, clearer split message).
