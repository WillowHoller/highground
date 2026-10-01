# HighGround — before the first real district goes live

Decisions deferred during the build, and launch tasks. Work through this list before any district outside Willow Holler signs in. Any new chat with Claude: read this file first when "going live" comes up.

## Decisions to revisit

- [ ] **Engine visibility.** Accepted during build (29 Sept 2026): `engine.js` runs in the browser, so anyone can read it at the site's address, signed in or not, and the repo is public. Options before launch: accept; minify (cheap, deters casual copying only); or move the engine to a Supabase Edge Function for signed-in users (truly hidden, but each lever change becomes a server round trip).
- [ ] **SAVE revenue-bond room formula.** Kept as the working planner has it (29 Sept 2026): SAVE receipts ÷ 1.20 coverage, *then* minus existing SAVE debt; ongoing SAVE commitments ignored. The spec says coverage applies *after* existing debt. Confirm which one boards should see, ideally with a bond advisor. Code: `saveBondCapacity` in `engine.js`.
- [ ] **Recalled Iowa rules.** Confirm the values marked "recalled" in `04_iowa_rules.sql` (PPEL and V-PPEL rate caps, V-PPEL term, 60% referendum, 5% debt limit) with the Iowa DE or DOM, a bond counsel, or the School Finance Formula.
- [ ] **Password minimum.** Set to 8 characters with all four character types. Revisit if districts ask, or once two-step sign-in is required.

## Accounts and services

- [ ] **Supabase: upgrade to Pro.** Free projects pause after about a week idle and have no daily backups.
- [ ] **Supabase: leaked-password protection on** (Pro). Authentication → Sign In / Providers.
- [ ] **Supabase: email rate limit.** Custom SMTP starts at 30 emails an hour; raise it in Authentication → Rate Limits before onboarding several districts at once.
- [ ] **Supabase: consider CAPTCHA** on sign-up (Supabase's main advice against sign-up abuse).
- [ ] **Postmark: account approved.** Until approval, only willowholler.com addresses receive mail.
- [ ] **Postmark: DKIM and Return-Path both verified** for willowholler.com.
- [ ] **Postmark: token hygiene.** The first Server API token was shown in a screenshot and replaced; make sure only the new one is active.
- [ ] **Supabase email templates** reworded for HighGround (Confirm signup, Reset password, Change email).
- [ ] **Staff account email** moved from personal Gmail to a Willow Holler address (Authentication → Users). Personal email must not remain in the new system.
- [ ] **Old `horizon` project deleted** and the old `Horizon` repo archived. They still hold a personal email address.

## Hosting

- [ ] **App address.** Decide on `app.willowholler.com` (or similar): a CNAME to `willowholler.github.io` in OpenSRS, the custom domain set in GitHub Pages, and Supabase URL Configuration updated to match.
- [ ] **Repo visibility and plan.** Public during build. Decide whether to go private (GitHub Pages then needs a paid plan, or move hosting to Netlify or Cloudflare Pages).

## Product

- [ ] **Invitation emails working** (built 30 Sept 2026): `send-invitation` deployed, `POSTMARK_SERVER_TOKEN` secret set, a real invitation received outside willowholler.com after Postmark approval.
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
