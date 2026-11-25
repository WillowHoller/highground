# States in HighGround

HighGround started as an Iowa product. From 11 Nov 2026, each state's funds, laws, rates, units, calendar and words live in **one file, `states.js`**. Every other file reads them from there.

## The guardrail

- **Never hard-code a state's fund names, laws, rates, units or fiscal year anywhere except `states.js`.** Use these instead:
  - `HGStates.label('ppel')` and `HGStates.on('save')`;
  - `HGStates.feature('prefill')`;
  - `HGStates.pack(code)`.
- **`guardrail_test.js` enforces it.** It counts SAVE, PPEL, V-PPEL, Iowa, SF 2472, "per $1,000" and the July–June dates in every app file. It **fails if any count goes up** from `guardrail_baseline.json`.
- When you remove some, run `node guardrail_test.js --update` to lock in the lower numbers. Over time the counts should fall toward zero.

## Fund slots (no data migration)

The database keeps the same fund keys. A state's pack names each slot, or turns it off.

| Slot | Iowa | Nebraska |
|---|---|---|
| `save` | SAVE (statewide 1¢ sales tax) | Depreciation Fund (a reserve filled by General Fund transfers) |
| `ppel` | PPEL (board levy, $0.33/$1,000) | Special Building Fund (≤14¢/$100, inside the $1.05 lid) |
| `vppel` | V-PPEL (voter levy, ≤$1.34, ≤10 years) | QCPUF levy (board-adopted, ≤3¢, ≤10 years, outside the lid; hazards, accessibility, life safety, mold and school safety only) |
| `grants`, `boost`, `camp`, `general` | same | same |
| `debt_levy` | Debt service levy | Bond Fund levy |

## What a pack holds

- Fund names and on/off.
- Each fund's capacity method:
  - `shared_revenue`;
  - `rate_levy`;
  - `flat_years`;
  - `lid_shared` (Nebraska).
- Fund rules (what each fund may pay for) and citations.
- Financing kinds.
- Debt limit and the vote needed.
- Fiscal-year start month.
- Rate unit (per $1,000 or per $100).
- Features:
  - SF 2472;
  - SAVE bond room;
  - the state data prefill;
  - peers.
- GL fund codes.
- **`say`**: the screens' Iowa words in that state's words.
- **`hide`**: Iowa-only fields the screens leave out.

Iowa has no `say` or `hide`, so Iowa screens are exactly as before.

## How the screens change by state

- **Which state a district uses:** `district.state`, always. A real district's state is chosen when it's added in the Admin Portal; the Districts table shows it read-only.
- **Demo districts (24 Nov 2026):** switch a demo's state for whichever state you're demoing in, from the demo tag in the top bar (staff) or **Change…** in the Admin Portal's Districts table. You can load that state's demo data set (Bridger Hollow for Iowa, Prairie Fork for Nebraska; this erases the demo plan first, as Reset does) or keep the current figures.
- **A demo data set carries its state.** Loading it into a demo district moves the district to that state.
- **The old staff-only "State view"** (a browser-wide override with a banner on every screen) was removed on 24 Nov 2026. Its saved setting is cleared the next time the app loads.
- **How the words change (`stateApply` in app.js):** for a non-Iowa district, a watcher puts every screen into the state's words as it is drawn, and removes the `hide` fields.
- **Where the math differs, it's real code:**
  - `engine.lidRoom` for Nebraska's three limits;
  - `tax.impactFlat` for per-$100 tax, with farmland at 75% (50% for bonds);
  - `gf.forecastNE`: property tax + state aid + other income, and a fund balance ratio;
  - Nebraska forms for Starting numbers and the General Fund.

## Nebraska: built, confirmed, and still open (12 Nov 2026)

**Confirmed against the statute or NDE (rule_value status `verified`, parts 34–35):**
- September 1 – August 31 fiscal year (Neb. Rev. Stat. 79-1091).
- Bonds pass with a majority of the electors voting (10-702).
- Farmland at 75% of actual value; 50% for school bond levies approved on or after 1 Jan 2022 (77-201(2)).
- Special Building Fund ≤14¢ inside the $1.05 lid (79-10,120); QCPUF ≤3¢ with 79-10,110 levies, up to 10 years, no vote (79-10,110.02).
- Allowable reserve 45/35/25/20% of the General Fund budget by size, counting Depreciation and Employee Benefit (79-1027).
- NDE fund numbers (01 General … 08 Special Building, 09 QCPUF) and account layout (fund-type-function-object), from the 2025/26 AFR code list.
- TEEOSA: reproduces NDE's 2026/27 certified aid to the dollar for three districts (`nebraska_test.js`).

**Built:**
- the capital plan with the Depreciation Fund (the `save` slot, filled by General Fund transfers), Special Building and QCPUF;
- the $1.05 lid and the property tax request authority, with prior years' unused authority carried forward each year;
- tax impact per $100; a General Fund forecast with TEEOSA and the 79-1027 reserve check; fund rules; a sample NDE ledger in the Prairie Fork demo;
- **NDE public data (part 35, `loader/load_nebraska.py`, workflow "Nebraska public data"):** Statistical Information (valuation, levies, fall membership), the state aid certification (TEEOSA), the property tax request authority certification, and every district's Annual Financial Report. They fill Starting numbers and the General Fund (`nedata.js`), and give peer callouts against Nebraska districts the same size (`ne_benchmark`, the same rules and card as Iowa's).
- The district number for Nebraska is the NDE agency ID (01-0003-000), found by name in Settings → District.

**Added 12 Nov (b):**
- **Authority growth from NDE's formula** (79-3402(3)), checked against NDE's 2026/27 certification: 3% + the rise in K-12 fall membership × 0.4 / 0.7 / 1, + the LEP and poverty parts. HighGround works it out each plan year from fall membership (filled from NDE's Statistical Information) and the expected change; a growth typed by hand still overrides it. The General Fund's property tax follows the same path.
- **Special Building up to 17.5¢ with voter approval** (a box in Starting numbers). Kept inside the $1.05 lid and the authority.
- **School District Property Tax Relief Credit** (LB 34; 77-7305) in "What it means for taxpayers": a QCPUF levy costs about 74% of its face (26.2% statewide share, or the district's county figure); bond levies get no credit.
- **Employee Benefit and Contingency funds** in the General Fund forecast: transfers in, benefits or losses paid, balances; the Employee Benefit balance counts toward the 79-1027 reserve; Contingency payouts over 5% of General Fund spending are flagged (79-1072). Filled from the AFR (funds 03 and 04).

**Added 12 Nov (c):**
- **General Fund budget authority** (79-1023, 79-1025, 79-1030): NDE's certified figure for the first year (loaded from NDE's "budget factors" file, with its parts), then each year the greater of last year's adjusted budget × 1.025 and 110% of TEEOSA formula need less special education × 1.025. Unused authority carries forward; up to 2% of last year's adjusted budget of it can be used in a year. Spending above it is flagged. NDE's certified allowable reserve % replaces the size rule when loaded.
- **QCPUF bonds:** a lease or QCPUF bond can be repaid from the QCPUF levy (79-10,110.02); part 35 widens `financing.repay_from`.
- **QCPUF limits checked** in Starting numbers: receipts above a 3¢ levy, or more than 10 years.
- **Three review rounds** (every Nebraska screen read in full, plus downloads): fixes to Iowa wording and dates that leaked into Nebraska downloads (project and balance templates, help sheets, every .xlsx export), the fiscal year used for "today" and for measure periods (September–August), uploads that defaulted to the Depreciation Fund, Iowa-only rows on Compare and the board packet, a likely range shown where Nebraska has none, Iowa holdback "typical" ranges, the QCPUF described as needing a vote, NDE source notes, and the General Fund property tax now following the authority's growth when no growth is typed.

**Added 14 Nov (the four open items, checked against the statutes):**
- **The 17.5¢ Special Building is a levy override.** No statute says 17.5¢: 79-10,120 caps Special Building at 14¢, and a full-text search of the statutes finds no 17.5. NDE's figure describes what a patron vote allows. The statute for that vote is 77-3444: a majority of voters can exceed the $1.05 lid for up to 5 years, for general operations and/or building. Starting numbers now has **Levy override** (cents, first year, last year, and a box for "voters also approved exceeding the authority", which 79-3405 requires by 60%, unless the override was approved before 1 Jan 2024). During the override years the lid and Special Building's ceiling (to 17.5¢) rise; the authority rises only with the box; the override levy gets no School District Property Tax Relief Credit. Filled from NDE's LC-2 when a district has one. Status stays `recalled` for the 17.5 figure itself.
- **English learner and poverty part, no longer typed by hand.** NDE doesn't publish the counts by district (the state aid PDFs and A-files carry allowances, not the 79-1003 counts; free and reduced lunch isn't the same measure). HighGround now fills that part with the average of the district's last three NDE certifications (from the PTA files already loaded), shown in Starting numbers. A figure the district types still wins.
- **Budget authority: the student growth adjustment (79-1007.20) and the board's choice.** The authority is now the greatest of last year's budget × 1.025, last year's budget plus the student growth adjustment, and 110% of formula need less SPED × 1.025 (NDE's three methods in 79-1023). The adjustment uses NDE's basic funding per formula student and the expected growth above max(25, 1% of fall membership). Need growth is held between 100% and 112% a year, with the adjustment outside the cap (79-1007.11). New **Budget** choice in the General Fund: "the whole authority" (the default; NDE's LC-2 shows most districts do this, keeping the rest as unused authority) or "what it plans to spend". The adopted year 1 comes from the LC-2 (now loaded: `ne_lc2`).
- **No school debt limit: verified.** Chapter 10, articles 7 (10-701 to 10-719) sets no limit for school bonds; issuing needs a majority vote (10-702; a failed vote waits 6 months). Voter-approved bonds sit outside the levy limits (77-3442(1)). Status `verified`; the go_bond help says so.

**Added 14 Nov (b):**
- **Last year's aid correction** (79-1065): each year NDE recalculates last year's aid with final data and pays or takes back the difference with this year's aid ("Calculation of Prior Year Correction"; statewide the corrections net to zero, but a district's can be ±10% or more). It's now loaded (a PDF, read with pdftotext) and added to the first plan year's aid; the General Fund editor shows it. Later years' corrections depend on final data no plan can know, so they're taken as none.
- **Student growth correction** (79-1007.20(3)): two years after a student growth adjustment, NDE adds or takes off (actual − estimated growth) × basic funding per formula student, a cut no bigger than the adjustment, in formula need. HighGround now does this for NDE's certified adjustment (the estimate backed out of it) and for any it forecasts, against the enrollment growth the plan expects.
- **The LC-2's levy override columns:** "Number of years the Levy Override will be in effect (Must between 1 and 5)", "What was the first year…", "What year will this Levy Override expire?", plus "Additional Property Tax Authority due to successful levy override". So the years are the 77-3444 override, and NDE adds an override approved before 2024 to the authority (79-3405(3)). NDE's 2023/24 file wrote the years as school years (2023/24 to 2027/28); later ones as 2023 to 2028 with 5 years, so a plain first year is the year the school year starts and the expiry year the year the last one ends. The loader stores both as HighGround fiscal years; the prefill ticks "authority too" when NDE added it.
- **70% board vote** (79-3405(2)): 152 of 244 districts used it for 2026/27, nearly all taking the most allowed. The LC-2 now fills the first year's authority with it and ticks the board box (assumed to continue; clear it if not).

**Notes found while checking:**
- NDE's budgeting FAQ says the 3¢ QCPUF counts inside the $1.05 lid unless it retires bonds; 77-3442(2)(d)(vi) excludes QCPUF levies. HighGround follows the statute. Worth one question to NDE.
- Corrections for years before the plan's first (the adjustment certified a year earlier) aren't loaded; NDE's prior-year correction already carries most of their effect.

**Still open:**
- The loader hasn't run against NDE from GitHub yet (this workspace can't reach education.ne.gov). Its readers were checked on files laid out exactly like NDE's.
- The 17.5¢ figure rests on NDE's instructions, not a statute (the override itself is 77-3444).
- The English learner and poverty part ahead is a three-year average, not a count.
- The authority is grown as a whole; NDE grows last year's total revenue and then takes off the coming year's state aid, SPED and other revenue. Close when those move together; less so when TEEOSA jumps.
- The credit share is statewide unless the district enters its county's figure.
- Formula need growth (2.5% a year, held to 100–112%) is a planning assumption.
- Bond counsel should still confirm any specific issue; HighGround models no limit because the statutes set none.

## Adding a state

1. Copy the `NE` pack in `states.js`.
2. Set its funds, rules, calendar, rates, `say` and `hide`.
3. Add a capacity method in `engine.js` only if none of the existing ones fit.
4. Add a fictional demo with a `state` field.
5. Add a test like `nebraska_test.js`, and a block in `test_ui.py` that checks no Iowa words leak.
6. Add its rule values to the SQL.
