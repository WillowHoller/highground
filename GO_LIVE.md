# HighGround — before the first real district goes live

Decisions deferred during the build, and launch tasks.

## Status, 30 Sept 2026

- **Phase 1 built and verified** (milestones 0–6).
- **Phase 2 Decisions and Resources built** (1 Oct 2026): scenario comparison, initiatives with yearly costs, ranking and the funding line, tax impact, assumption sets, capital-plan table and filters. The general-fund forecast stays in Phase 6.
- **Phase 3 Monthly actuals and Progress built** (1 Oct 2026): monthly GL import with remembered account matching, project actuals and progress on the adopted plan, budget vs. actual vs. forecast, month-to-month comparison, ledger reminder. **Needs a real district's export** to confirm column detection and account suggestions.
- **Phase 6 General Fund built** (1 Oct 2026): five-year forecast (enrollment × cost per pupil with state aid and the 101% guarantee; staff by group with settlement, health and turnover; solvency; spending authority and unspent balance; new money vs. settlement), adopted budget upload, assumption sets covering the General Fund, the General Fund in Summary and the board report.
- **Phase 5 Direction built** (1 Oct 2026): priorities, outcomes and measures with status; automatic measures; community survey with themes; goals, results and survey uploads; Overview dashboard; search.
- **Phase 4 Reports and community built** (1 Oct 2026): monthly board report with what changed, decision packets, the branded community page with unapproved proposals held back and a publish log. Remaining Phase 1 work is operations, below.
- **Postmark approved (8 Oct 2026).** Next: the Supabase Pro upgrade and the settings that follow it, which were waiting on this.
- **Deliberately deferred:** staging (set up when the first real district's data is needed, not before; no point paying yet) and a private repository (wanted, but not yet). Work through this list before any district outside Willow Holler signs in. Any new chat with Claude: read this file first when "going live" comes up.

## Decisions to revisit

- [ ] **Engine visibility.** Accepted during build (29 Sept 2026): `engine.js` runs in the browser, so anyone can read it at the site's address, signed in or not, and the repo is public. Options before launch: accept; minify (cheap, deters casual copying only); or move the engine to a Supabase Edge Function for signed-in users (truly hidden, but each lever change becomes a server round trip).
- [ ] **SAVE revenue-bond room formula.** Kept as the working planner has it (29 Sept 2026): SAVE receipts ÷ 1.20 coverage, *then* minus existing SAVE debt; ongoing SAVE commitments ignored. The spec says coverage applies *after* existing debt. Confirm which one boards should see, ideally with a bond advisor. Code: `saveBondCapacity` in `engine.js`.
- [ ] **Fund-use notes on Resources → All funds.** Plain-language summaries of what SAVE (Iowa Code ch. 423F), PPEL (§298.3), V-PPEL and grants may pay for, written from general knowledge on 30 Sept 2026. Have a school attorney or the Iowa DE confirm the wording. Text: `FUND_RULES` in `app.js`.
- [ ] **Decide on the unused “project requests” table** (no screen uses it; it's kept in backups). Keep for a future feature or drop.
- [ ] **Validate the General Fund forecast with at least two business managers before any board sees it** (roadmap requirement). Compare its first year with each district's certified budget and its unspent balance with the Department of Management's report; confirm the simplifications (combined district cost ≈ regular program + other formula funding; turnover savings; health per FTE). Update the state cost per pupil and state aid rate each spring when the Legislature sets them (`gf.js`, `RULES`).
- [ ] **Starting-number checks:** the statewide SAVE amount per student (FY2026 ≈ $1,358, in `app.js`, `SAVE_PER_STUDENT`) should be refreshed each year.
- [ ] **Tax impact rules (tax.js), checked 1 Oct 2026.** Residential and farmland rollbacks (FY2027: 44.5345% and 59.4401%), the homestead credit to exemption change (SF 2472), and the 65+ exemption. Have a school-finance professional confirm the method, especially which taxable valuation a district's debt service levy uses (TIF increment), and **update the rollbacks every November** when the state issues its order.
- [ ] **Recalled Iowa rules.** Confirm the values marked "recalled" in `04_iowa_rules.sql` (PPEL and V-PPEL rate caps, V-PPEL term, 60% referendum, 5% debt limit) with the Iowa DE or DOM, a bond counsel, or the School Finance Formula.
- [ ] **Password minimum.** Set to 8 characters with all four character types. Revisit if districts ask, or once two-step sign-in is required.

## Accounts and services

- [ ] **Supabase: upgrade to Pro** *(next: Postmark is approved)* ($25/month for the organization; the $10 compute credit covers one project). Retire or pause the old `horizon` project first, or it adds about $10/month. Leave the spending cap on.
- [ ] **Backups checked** *(after the Pro upgrade)*: Database → Backups lists daily backups (Pro keeps 7 days). Download a full backup from Reports → Exports monthly; it's your own copy, and Supabase's backups don't include uploaded files.
- [ ] **Staging copy** (second Supabase project and repo, about $10/month). *Deferred by decision: set up when the first real district's data is needed.*
- [ ] **Supabase: leaked-password protection on** (Pro). *(after the Pro upgrade)* Authentication → Sign In / Providers.
- [ ] **Supabase: email rate limit.** Custom SMTP starts at 30 emails an hour; raise it in Authentication → Rate Limits before onboarding several districts at once.
- [ ] **Supabase: consider CAPTCHA** on sign-up (Supabase's main advice against sign-up abuse).
- [x] **Postmark: account approved.** *Done 8 Oct 2026: mail now reaches any address.*
- [x] **Postmark: DKIM and Return-Path both verified** for willowholler.com. *Done: invitation emails arrive at willowholler.com.*
- [x] **Postmark: token hygiene.** The first Server API token was shown in a screenshot and replaced; make sure only the new one is active. *Done: replaced after the screenshot.*
- [ ] **Supabase email templates** reworded for HighGround (Confirm signup, Reset password, Change email).
- [ ] **Staff account email** moved from personal Gmail to a Willow Holler address (Authentication → Users). Personal email must not remain in the new system.
- [x] **Old `horizon` Supabase project retired.** It held a personal email address. *Done 30 Sept 2026.*
- [ ] **Old `Horizon` GitHub repo archived** (GitHub → the repo → Settings → Danger Zone → Archive). Its setup SQL contains a personal email address.

## Hosting and websites

- [x] **Marketing site live** at www.willowholler.com and /highground (repository `willowholler-site`, GitHub Pages). *Done 1 Oct 2026.*
- [ ] **Privacy policy and terms of use** pages on the website, before the first district signs up.
- [x] **willowholler.com without the www** now redirects to www with GitHub's certificate (A records point to GitHub Pages; OpenSRS forwarding turned off). *Done 1 Oct 2026.*
- [x] **www.willowholler.com certificate:** issued by GitHub Pages; Enforce HTTPS on. *Done 1 Oct 2026.*
- [ ] **Zoho Sites retired:** domain removed from Zoho Sites and any paid plan cancelled. Zoho Mail stays.

- [x] **App moved to highground.willowholler.com.** *Done 1 Oct 2026:* GitHub custom domain, CNAME record, Supabase Site URL and redirect, `APP_URL` secret.
- [ ] **Remove the old redirect URL** (`willowholler.github.io/highground/`) from Supabase → URL Configuration after a week or two of the new address working.
- [ ] **Private repository (the `highground` app only; `willowholler-site` stays public).** *Decided: go private, but not yet.* Public during build. When it goes private, GitHub Pages needs a paid GitHub plan for the organization, or hosting moves to Netlify or Cloudflare Pages.

## Product

- [x] **Invitation emails working** (built 30 Sept 2026): `send-invitation` deployed, `POSTMARK_SERVER_TOKEN` secret set, a real invitation received outside willowholler.com after Postmark approval. *Function deployed and verified 30 Sept 2026. Postmark approved 8 Oct 2026: send one test invitation to an outside address to confirm.*
- [ ] **Two-step sign-in required for admins.** Offered to everyone since 30 Sept 2026. Requiring it means database rules that check the session's assurance level (`aal2`) for admin actions; decide, then build.
- [ ] **Email-domain allow-list reviewed** for each district: only the district's own domains, and the role is right.
- [ ] **Setup screen, project upload, saving scenarios.** Phase 1 items still marked "Not built yet".
- [ ] **Demo districts** clearly marked, and no real district's name next to invented numbers anywhere, including screenshots and the storyboard image.
- [ ] **No student data** anywhere. Survey results are totals and themes only.

## Tests to run before launch

- [ ] `05_verify_setup.sql` and `06_access_test.sql` in the Supabase SQL editor: all PASS.
- [ ] `node engine_test.js` and `node capital_test.js`: 0 differences.
- [ ] `python3 test_ui.py`: all PASS.
- [ ] A real sign-up with a non-Willow Holler address receives its confirmation email (after Postmark approval).
