# HighGround: daily health checks

Every morning (about 6:40 a.m. Central) the **Daily health check** GitHub workflow (`.github/workflows/daily-health.yml`) runs `loader/health_check.py`. Each check is **ok**, **warn** or **fail**.

| Area | What it checks |
|---|---|
| connections | The website answers and serves the same `app.js` as GitHub. Supabase sign-in and data API answer, and a signed-out visitor gets no districts back. The invitation email function is deployed. Every outside source the monthly data pull uses answers: the Department of Education pages, the Department of Management file lists and a Drive download, BLS, and the Census key. |
| code | Every calculation test in the repository (`*_test.js`) passes. |
| structure | Every table has its access rules on, signed-out visitors can read no table, and the functions the app needs exist. |
| data | The monthly public-data workflow finished in the last 35 days, and nothing in it failed. Each source has the years it should have by now. |
| ties | Numbers from different state files agree: regular and voted PPEL dollars = rate × taxable valuation (with TIF), and the valuation file = Aid and Levy lines 6.1 and 15.18. Every district's own plan is consistent: phase funding adds to 100%, there is one board version, phases sit in their own district's scenarios, there are no negative balances, and every Iowa number is known. The setup pre-fill answers quickly. |
| people | There is at least one Willow Holler staff member, and every district has an admin. |

## Who hears about it

- **Email** to admin@willowholler.com through Postmark (`POSTMARK_SERVER_TOKEN` GitHub secret):
  - when anything fails;
  - the first morning everything is fixed again;
  - every Monday, as a weekly summary.
- **GitHub** marks the run failed and emails the account that owns the workflow, so a failure is reported even if Postmark is down.
- **In the app:** Willow Holler page → **System health** shows the latest run, what failed, the warnings, and a dot for each of the last 14 days. Only staff can see it (`hg_health_run`, part 20).
- If the check itself stops running, the System health card says so after 36 hours.

## Changing it

- Database checks live in `public.hg_health_check()` (part 20). Add a check by adding a `return query select area, name, status, detail` block.
- Connection and code checks live in `loader/health_check.py`.
- The recipient is `HEALTH_EMAIL_TO` in `daily-health.yml`.
- To run the check now: GitHub → Actions → Daily health check → Run workflow.
