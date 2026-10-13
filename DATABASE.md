# HighGround database — what each table is for

All district data carries `district_id`, and access rules check it on every row. Fiscal years are integers (2027 = FY2027).

## People and access
| Table | Holds |
|---|---|
| district | Name, link id (slug), state, brand color, logo, demo flag, whether the public link is on |
| profile | Name and email for each account (created automatically at sign-up) |
| platform_admin | Willow Holler staff: every district. Added only in the SQL editor |
| district_member | Who belongs to which district, in which role |
| invitation | Pending invitations by email; become memberships once the email is confirmed |
| access_request | People asking a district admin for access |

Roles: **admin** (people, settings, publishing, unlocking), **business_manager** (financial uploads, settings, debt, balances), **superintendent** and **editor** (initiatives, scenarios, goals, project and goal uploads), **board** and **viewer** (read only).

## Plan inputs
| Table | Holds |
|---|---|
| district_settings | The engine's settings: SAVE, PPEL, V-PPEL, grants, valuation, inflation, plan years. Ongoing (non-project, non-debt) commitments: `save_ongoing`, `ppel_ongoing`, `vppel_ongoing` (part 27) |
| fund_balance | Balances by fund and date: typed in, uploaded, or refreshed from a GL import |
| debt_obligation | Existing SAVE / PPEL / debt-levy payments and final year |
| assumption_set | Base / Conservative / Growth assumptions (capital now; general-fund fields ready for later) |

## Direction (goals)
| Table | Holds |
|---|---|
| priority, outcome | The strategic plan |
| measure | Measure, unit, starting point, target, owner, cadence |
| measure_value | Results over time (typed or uploaded) |
| survey, survey_result | Community survey totals, importance ratings and themes, linked to priorities or initiatives |

## Decisions
| Table | Holds |
|---|---|
| initiative | Anything that costs money: capital, program, staff, curriculum, technology. Status, tier, owner, condition, and the year it's needed by (part 18) |
| scenario | A full version of the plan: levers, lock, board version |
| scenario_initiative | Which initiatives are in a scenario, and their rank |
| phase, phase_funding | One-time costs by fiscal year, split across up to several funds (the engine's phases) |
| recurring_cost | Yearly costs: salaries, benefits, supplies (for programs and hires) |
| financing | Bonds, leases, campaigns in a scenario |
| initiative_note, attachment | Notes, quotes, inspection reports |
| project_request | Suggestions from anyone with an account |

## Uploads and monthly actuals
| Table | Holds |
|---|---|
| import_batch | Every upload: monthly GL, budget, balances, projects, goals, measure results, survey. Status: uploaded → review → applied (or discarded / superseded). Every upload is kept |
| import_row, import_issue | Raw rows for review; warnings and errors to resolve before applying |
| gl_account | The district's chart of accounts, learned from its exports and remembered, with its mapping (fund balance, revenue, expense, initiative, ignore) |
| gl_amount | Month and year-to-date amounts per account per upload |
| budget_line | Budget by account and year (proposed / adopted / amended) |
| gl_current (view) | Only amounts from applied uploads |

Applying a monthly GL upload replaces the earlier upload for the same month and refreshes fund balances from accounts mapped to "fund balance".

## Peer comparisons (Iowa public data, parts 15–16)
| Table | Holds |
|---|---|
| ia_district, ia_district_year | Every Iowa district by its Department of Education number; certified enrollment and size band by year |
| ia_fin, ia_fin_line_def | Spending, revenue and fund balance by fund, function and object, from the state's Certified Annual Reports (FY2019 on) and the Iowa Data Hub (FY2017–2018) |
| ia_measure | Per-pupil and percentage measures per district and year (refreshed by each load) |
| ia_stage, ia_enroll_stage, ia_load_run | The loader's staging tables and its log. Only the loader writes them |
| benchmark_flaggable, benchmark_rule | Which measures can get a callout, and the thresholds (a district can have its own) |
| district_peer | Hand-picked peer districts (none = districts the same size) |
| ia_levy_rate | Each district's property tax rates by year (Department of Management), including regular and voter-approved PPEL (part 17) |
| ia_valuation | Taxable and 100% valuations by district and year, with TIF; farmland and homes on their own (part 19) |
| ia_aid_levy | Each district's Aid and Levy worksheet lines by year, as jsonb (part 19) |
| ia_unspent | Spending authority, miscellaneous income and unspent balance by district and year (part 19) |
| ia_home_value | Median value of owner-occupied homes by district (Census Bureau ACS 5-year), for the tax example (part 19) |
| ia_reference | Outside reference figures, e.g. construction inflation from the BLS school construction price index (part 19) |

`district.state_district_id` links a HighGround district to its Iowa district number. Signed-in users can read the state data; anonymous visitors can't.

## Check registers (part 16)
| Table | Holds |
|---|---|
| register_line | Each payment in an uploaded check register (an `import_batch` of kind `check_register`, one per month) |
| register_flag | Questions the checks raise for the business office, with the answer and who gave it |
| register_rule | Which checks run and their thresholds (defaults, or a district's own, e.g. its bid threshold) |
| vendor_note | The vendor dictionary: plain-language labels, and vendors marked as expected |

Business managers and admins upload registers and answer questions; every member, including board members, can read them.

## Reports and publishing
| Table | Holds |
|---|---|
| report_snapshot | Dated internal reports (monthly board report, decision packet …) |
| publication | What the public link shows: a frozen copy chosen by an admin. Visitors without an account can read only this |

## Rules and history
| Table | Holds |
|---|---|
| rule_value | Iowa values by year (SF 2472 cuts, levy caps …), each marked verified / recalled / assumed with its source |
| audit_log | Every change to key tables: who, when, before and after. Admins can read; nobody can edit |

## Two-step sign-in (part 26)
- `district.require_two_step` (default on; demo districts start off). Only Willow Holler staff can change it (trigger `guard_require_two_step`).
- `two_step_required()`: true for staff and for anyone in a district that requires it. `two_step_ok()`: the session finished two-step sign-in (`aal2`) or doesn't need to.
- Every table with row level security, plus uploaded files (`storage.objects`), has a **restrictive** policy "two-step sign-in" using `two_step_ok()`. It sits on top of the normal rules: a password-only session that should have done two-step sees and changes nothing. Anonymous visitors are unaffected.
- **Adding a table later:** re-run `26_two_step.sql`, or the new table won't have the rule (its check 4 names any table that's missing it).
