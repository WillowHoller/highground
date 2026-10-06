# HighGround: Iowa public data, peer callouts, register checks

Built 2026-10-06. **Nothing here is installed in the live Supabase project or the GitHub repo yet.** I couldn't reach either from this session (no database credentials or repo access). The three setup steps below are yours to run.

## What it does

1. **Loads the Iowa Data Hub files into Supabase**: expenditures (dataset 994) and revenues (dataset 995), FY2017 through the latest year. That covers Actual years plus the current re-estimate and the coming budget. A GitHub Action re-checks the files on the 3rd of every month and reloads them only when the state has changed them.
2. **Peer callouts**: `ia_benchmark(district, year)` returns every measure for a district with the peer average, median and rank. It also writes a one-line callout when a number is unusual. Peers default to districts in the same enrollment band, or the district can pick its own. It works for any Iowa district, including prospects and demos, since the data is public.
3. **Register checks**: monthly check registers go in (one month, or a whole year split by month). `register_check()` turns twelve rules into plain-English questions for the business office. Answered questions are never asked again.
4. **Onboarding prefill**: `ia_prefill(district)` returns:
   - ending fund balances by fund, including the SAVE and PPEL funds;
   - revenue by fund;
   - an enrollment estimate.

## Matching a district: by ID, not name

Every Data Hub row carries the **Department of Education district number** (`de_district`, 4 digits, e.g. `0009`), plus the Dept. of Management number and AEA (verified 2026-10-06). New clients are linked once in `district_state_link (tenant_id → de_district)`. Onboarding uses `ia_district_search('logan')` to suggest matches by name, then stores the ID. Names drift ("Logan-Magnolia" vs "Logan Magnolia") and change when districts reorganize; IDs don't. If two districts merge, the new district gets a new number and the history stays under the old numbers. Linking both is a later feature.

## Setup (about 15 minutes, once)

1. **Database.** Supabase → SQL Editor → paste `sql/2026-10-06_public_data_and_register_checks.sql` → Run. It's safe to run twice. The last result lists 15 tables, all with `rls_on = true`.
2. **Repo.** Add these files to willow-holler/highground:
   - `loader/`
   - `sql/`
   - `client/benchmarks.js`
   - `.github/workflows/iowa-public-data.yml`
3. **Secret.** In GitHub, go to Settings → Secrets and variables → Actions → New secret.
   - Name it `DATABASE_URL`.
   - The value is Supabase → Connect → **Session pooler** connection string, with the database password filled in.
   - Then open the Actions tab, choose "Iowa public data", and click Run workflow. The first full load should take a few minutes.

The database password lives only in that GitHub secret. It is never in a file.

## Callout rules (table `benchmark_rule`; a district can override)

- **High / low:** at or above the 90th percentile, or at or below the 10th, of at least 8 peers. Gaps under $25/pupil (or 2 points for balance %) are ignored.
- **Jump:** the change from last year beats the peers' median change by 25 points or more, and by at least $50/pupil. A prior year under $50/pupil isn't used as a base.
- **One callout per number:** if the General Fund line and the all-funds line are the same dollars, only the broader one is flagged.
- **Units:** dollars per pupil, using enrollment inferred from the state's own per-pupil column. The `bal|<fund>|ENDING_PCT` measures are instead ending balance as a % of that fund's spending.

Measure keys look like `exp|General|Student Transportation`, `exp|ALL|TOTAL`, `rev|ALL|State Foundation Aid` and `bal|General|ENDING_PCT`. In the app, add `data-measure="<key>"` to a number and call `HGBench.attachAll()` from `client/benchmarks.js`. Only unusual numbers get a tag, with the sentence on hover. No separate benchmarks page.

## Register rules (table `register_rule`; defaults in row `'*'`)

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

**Account codes:** when an export has a single account string, `import_register.py` splits it as fund, function and object. That layout is assumed. Run `--dry-run` on a real export first.

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
