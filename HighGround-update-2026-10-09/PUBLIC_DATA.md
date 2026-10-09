# Iowa public data, peer callouts and check registers

**Current setup (7 Oct 2026):** database parts `15_state_peer_data.sql` and `16_registers_and_peer_settings.sql`; the loader in `loader/`; the monthly workflow `.github/workflows/iowa-public-data.yml` (repository secret `DATABASE_URL`). The history below explains how it was built and checked. References to `sql/…` files, `tenant_id` and `cip_*` describe the first version, which part 16 replaced with HighGround's own districts and roles.

## What it does

1. **Loads the state's data into Supabase.** `loader/load_iowa_car.py` reads the Department of Education's Certified Annual Report (CAR) workbooks, FY2019 on, plus certified enrollment. `loader/load_iowa_datahub.py` keeps FY2017–2018 from the Iowa Data Hub. A GitHub Action checks for new or changed files on the 3rd of every month.
2. **Peer callouts.** `ia_benchmark(state number, year, …, district)` returns every measure with the peer average, median and rank. When a number is unusual, it adds a one-line callout. Peers are districts in the same enrollment band.
3. **Check-register questions.** `register_check()` turns twelve rules into plain-English questions for the business office. Answered questions are kept.
4. **Onboarding prefill.** `ia_prefill(state number)` returns the latest year-end figures:
   - General Fund balance by class, revenue, spending and AEA flowthrough;
   - SAVE, PPEL and Debt Service ending balances;
   - SAVE and PPEL revenue;
   - certified enrollment.

5. **Levy rates.** `loader/load_iowa_levy.py` reads the Department of Management's "School Tax Rates, FY ____" files (FY2019 on) into `ia_levy_rate` (part 17). It runs in the same monthly workflow. `ia_levy(state number)` returns a district's latest rates, including **voter-approved PPEL** and regular PPEL.

6. **Valuations, Aid and Levy, unspent balances.** `loader/load_iowa_dom.py` reads three Department of Management sources (part 19):
   - "School District Assessed & Taxable Valuations by Class" (FY2023 on) into `ia_valuation`: taxable and 100% valuation with TIF and utilities, farmland and homes on their own;
   - "Aid and Levy, Tax Certification, and Program Summary" (FY2018 on) into `ia_aid_levy`: every worksheet line (L101 budget enrollment, L203 district cost per pupil, L519 combined district cost …);
   - the "Unspent Authorized Budget Report" (FY2015 on) into `ia_unspent`.

   `ia_prefill_more(state number)` combines these with the annual reports: valuation growth, the district's own rollbacks, the General Fund formula figures, the unspent balance and miscellaneous income, the SAVE trend, ongoing SAVE and PPEL spending (3-year average leaving out construction, debt and transfers), debt payments, gifts and grants to the capital funds by year, General Fund salaries and benefits, and the year the V-PPEL started.

7. **Construction prices and home values.** `loader/load_reference.py` (part 19):
   - the U.S. Bureau of Labor Statistics producer price index for new school building construction (series PCU236222236222, public API, no key) → `ia_reference` key `construction_inflation`: the yearly rise over the last three years;
   - the U.S. Census Bureau's American Community Survey 5-year median value of owner-occupied homes (B25077) for every Iowa unified school district → `ia_home_value`. This needs a free Census API key in the `CENSUS_API_KEY` GitHub secret; without it the step says so and skips. Census names are matched to `ia_district` by name; any that don't match are listed in the log (add them to `ALIASES`).

   Either part failing (a busy service) is logged and skipped; it never fails the monthly run.

## In the app

- **Settings → District** (admins): the **Iowa district number**, with "Find" to look it up by name (`ia_district_search`). Saved as `district.state_district_id`. Everything below needs it.
- **Money → Capital plan, General fund, All funds**: a small "Compared with districts your size" card. It lists only that screen's flagged numbers:
  - Funds shows all-funds, Management and Nutrition;
  - General fund shows the General Fund;
  - Capital plan shows SAVE and PPEL.

  Nothing shows when nothing is unusual. The year is the latest Actual year in the state data. Code: `peers.js`.
- **Home → Needs attention**: one line when numbers stand out, and one when register questions are open.
- **Settings → Starting numbers** and **General Fund starting figures**: "From the state's data" with a **Fill in** button. Nothing is saved until the person clicks Save. The guided setup uses the same figures.
  - Starting numbers also fills: valuations and their growth, the SAVE trend, ongoing SAVE/PPEL spending, the grants average (3, 5 or 10 years, chosen on the card), the V-PPEL balance (split by the two rates) and its first year (last year assumed 10 years later), and debt rows for funds with payments in the annual report (the final year still has to be added).
  - General Fund starting figures also fills: budget enrollment, district cost per pupil and other formula funding (Aid and Levy), miscellaneous income and its growth and the unspent balance (Unspent Authorized Budget), other spending and benefits % (annual report). It shows General Fund salaries by kind as a check.
  - **Fill from a staff list**: an Excel or CSV export from payroll (Group, FTE, Annual salary, district health insurance) becomes the staff groups, averaged per FTE. Template: `HGGF.ROSTER_TEMPLATE`.
  - The card shows the PPEL rates. When the state lists a voter-approved PPEL, Fill in sets V-PPEL to Active.
  - The annual report has one PPEL fund for both levies. Fill in splits its revenue between PPEL and V-PPEL by the two rates. That split is an estimate, and the card says so.
  - The setup checks warn when the state's levy file and the V-PPEL setting disagree.
- **Settings → Uploads → "Check register (bills paid)"** (business managers and admins). One file can hold a month or a whole year; it is split by month. Each month becomes an applied `import_batch` and replaces an earlier upload of the same month. The checks then run. Code: `register.js`, with the same column rules as `loader/import_register.py`.
- **Track → Check register**: the month's questions, most serious first. Business managers and admins can:
  - answer a question, or mark it "Not a concern";
  - mark a new vendor as expected;
  - set the district's bid threshold, which turns on the two threshold checks.

  Superintendents, editors, viewers and board members can read the questions but not change them. Board members reach this screen from Home line; their menu stays short.

## Matching a district: by ID, not name

Every state row carries the **Department of Education district number** (`de_district`, 4 digits, e.g. `0009`). A HighGround district is linked once, in Settings → District. Names drift ("Logan-Magnolia" vs "Logan Magnolia") and change when districts reorganize; the number doesn't. If two districts merge, the new district gets a new number and the history stays under the old numbers. Linking both is a later feature.

## Setup

See SETUP.md: parts 15 and 16, then the `DATABASE_URL` secret and the "Iowa public data" workflow. The database password lives only in that GitHub secret. It is never in a file.

## Callout rules (table `benchmark_rule`; a district can override)

- **High / low:** at or above the 90th percentile, or at or below the 10th, of at least 8 peers. Gaps under $25/pupil (or 2 points for balance %) are ignored.
- **Jump:** the change from last year beats the peers' median change by 25 points or more, and by at least $50/pupil. A prior year under $50/pupil isn't used as a base.
- **One callout per number:** if the General Fund line and the all-funds line are the same dollars, only the broader one is flagged.
- **Units:** dollars per pupil, using enrollment inferred from the state's own per-pupil column. The `bal|<fund>|ENDING_PCT` measures are instead ending balance as a % of that fund's spending.

Measure keys look like `exp|General|Student Transportation`, `exp|ALL|TOTAL`, `rev|ALL|State Foundation Aid` and `bal|General|SOLVENCY`. There's no separate benchmarks page.

## Register rules (table `register_rule`; defaults in the rows with no district)

| Rule | Asks about | Severity |
|---|---|---|
| vendor_name_change | same vendor number, new name | concern |
| duplicate_payment | same invoice number again, or same amount to the same vendor within 45 days | concern / question |
| lookalike_vendor | new vendor whose name is ≥ 0.6 similar to an existing one | question |
| new_vendor | first payment to a vendor (skips vendors marked expected in `vendor_note`) | info, or question at $10k+ |
| near_threshold, split_purchase | just under, or split around, the bid threshold. **Off until a district sets its threshold**: I didn't assume one | question |
| vendor_spike | month total over 3× the vendor's typical month (last 12 months), and $5k+ more | question |
| account_spike | fund + function total +50% and $10k+ vs the same month last year | question |
| restricted_fund_use | salary/benefit objects (1xx/2xx) charged to SAVE (33) or PPEL (36). **Assumed** code lists: confirm with a business manager | question |
| round_amount, weekend_date, missing_info | round $5k+ amounts, weekend dates, no description or account | info |

Other functions:

- `register_summary(import)`: totals by fund, top 10 vendors with their plain-English labels, and flag counts.
- `vendor_note`: the vendor dictionary. Mark a vendor `expected` and it stops being "new".

**Account codes:** when an export has a single account string, it is split into fund, function and object. Both the app and `import_register.py` do this, and the layout is assumed. The upload review warns when it was used. For staff backfills, run `import_register.py --dry-run` on a real export first.

## Tested (local PostgreSQL 16 with Supabase role stand-ins), 2026-10-06

- The migration runs clean twice.
- Loader: synthetic files in the real layout (70 fictional districts, FY2017–2027) loaded in about 15 s. Unchanged files are skipped on rerun.
- `ia_benchmark`: about 30 ms per call. It caught both planted outliers (transportation +125%, maintenance +78% with a jump).
- Register: a fictional year of 105 lines. All 12 rules fired on the planted June problems, and there were zero flags in the routine months.
- Access: a member of another district sees 0 lines and 0 flags, and anonymous users can't read registers.

**Not tested:**

- **The live state files.** This session couldn't download them. Columns and values were checked against the Data Hub's own preview.
- **A real district's register export.**
- **The GitHub Action.** It has never run on GitHub.

**Storage (estimated):** the full state history, about 1M source rows of which roughly half are zeros and dropped, plus stored measures, is about 150–250 MB. That fits in the Free plan's 500 MB but uses a third to half of it.
