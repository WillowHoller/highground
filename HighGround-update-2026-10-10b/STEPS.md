# HighGround update, 10 Oct (b): Rank & fund in the spotlight

**This one package replaces 09g–09j and the first 10 Oct package.** If you installed any of them, installing this one is still safe.

## New: Rank & fund

Ranking, Year by year, Ways to fit more and What would it take? used to be hidden behind Initiatives → Ranked. They now have their own place:

- **Its own menu item:** Plan → **Rank & fund**, right after Initiatives.
- **Four tools across the top**, each phrased as the question a board asks:
  - **Where does the money run out?** The ranked list and the funding line.
  - **When can each be paid for?** Year by year: what waits, and how long.
  - **How can we fit more?** Single moves that fund more, with a count of how many were found.
  - **What would it take?** Fund one initiative by a year you pick.

  Each tool has its own link, so you can bookmark it or send it to someone. For example, `…/plan/ranking/fit` opens "How can we fit more?".
- **Home** shows a call-out for planners: "The money runs out at #12 of 16 initiatives. 3 ways to fit more found", with an **Open Rank & fund** button.
- **The Capital plan** shows the same call-out whenever there's a gap to close.
- **Initiatives → Ranked** still works and leads to Rank & fund.
- **Search** ("fit more", "what would it take", "rank") goes straight to the right tool.
- **A fix found along the way:** if you switch screens quickly, a slower screen can no longer load over the one you just opened.

## What changes

### From 9 Oct (in case you haven't installed them)

- **Fund choices:** a project can be paid from whichever fund has room, for example "SAVE, then PPEL".
- **Layout:** spacing fixes, the menu logo centered when the menu is shrunk, and the General Fund what-if boxes on one line.
- **Unspent balance:** the General Fund forecast applies the 35% cap on unspent balance carried forward (SF 2472).
- **Editor:** tidy-ups in the project editor.

### New in this update

- **Home says "the plan":**
  - "The plan is $3.02M short."
  - The Needs attention lines and the Gap tile say "the plan" too.
  - The setup step is called **Adopted plan**.
- **Definitions (?) open right beside the ?.** The box follows the page when you scroll and closes with ×, Esc, or a click elsewhere.
- **Several focus areas per initiative:**
  - The editor has tick boxes, plus a box for new areas.
  - The initiative shows under each area's filter, on both Initiatives and the Capital plan.
  - Uploads take several areas with commas, for example "Academics, Staffing".
- **Initiatives list:**
  - A **Search initiatives** box that narrows the list as you type.
  - Picking an initiative from the top-bar search reliably opens it, however long the list takes to load.
- **No other district's name, ever, on the peer comparison or its details.**
  - The source now reads "From the district's Certified Annual Report to the state, FY2025".
  - If a demo district is linked to a real district's Iowa number, Settings → District says so without naming it, and tells you to clear the number.
- **Peer comparison heading:** "Unusual vs. districts your size", with a count. A plain line under it says these numbers are far outside what similar districts report: worth asking about, not necessarily a problem.
- **General Fund what-if boxes:**
  - Letters, symbols or impossible values ("2s-", 400) turn the box red with a short message.
  - The forecast ignores them until the value is a real number.
- **"Encumbered" is now "On order"** on screens, with a **?** saying it means purchase orders and contracts signed but not paid yet (what accounting reports call "encumbered"). The ledger upload still recognizes an "Encumbered" column.
- **Approved but not in the adopted plan:**
  - If you save an approved initiative to a scenario that isn't the adopted plan, the message says so. If the adopted plan is locked, it also says how to add it.
  - The Initiatives list says "Approved, but not in the adopted plan (District baseline) yet; it's locked, so unlock it on the Capital plan".
  - The scenario picker labels the **adopted plan**.
- **Guided setup is always reachable:**
  - "Open the guided setup" sits beside "Start this step" on Home, and there's a **Guided setup** button on the Settings page.
  - If you hide the setup steps, a one-line reminder stays on Home with links to show them again or open the guided setup.

## 1. Database (Supabase)

Open **SQL Editor → New query**. For each file, paste it in, click **Run**, and check the result.

| File | When | You should see |
|---|---|---|
| `23_fund_options.sql` | If you haven't run it yet | 2 rows, both PASS |
| `24_focus_areas.sql` | Now | 1 row, PASS |

## 2. GitHub

1. Go to **github.com/WillowHoller/highground** → **Add file → Upload files**.
2. Drag in everything except STEPS.md (21 files).
3. Commit message: `10 Oct update`
4. Click **Commit changes**.
5. After about 2 minutes, open the app in a private/incognito window.

## Bridger Hollow showing Logan-Magnolia's numbers

Nothing in HighGround links a demo district to a real one. Someone typed or picked Logan-Magnolia's Iowa district number in **Bridger Hollow → Settings → District**, probably while trying out the "Find the number by name" box.

To fix it:
1. Open **Bridger Hollow → Settings → District**.
2. Clear the **Iowa district number** box.
3. Click **Save**.

The peer comparison and the state figures then go away for Bridger Hollow.

## Checked before sending

- **Browser tests:** 439 pass, 0 fail.
- **Unit tests:** all pass.
