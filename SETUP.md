# HighGround — setting up GitHub and Supabase (fresh start)

About an hour. You click; nothing here needs code. Supabase and GitHub menu names change from time to time, so a label may differ slightly from what's written here.

**Before you start:** have a password manager open. You'll create one secret (the database password) that must never go in a file, an email or a chat.

---

## 1. GitHub: create the repository

1. Go to github.com → the **WillowHoller** organization → **New repository**.
2. Name **HighGround**. Visibility **Private** (the engine is the valuable part; don't publish it). Don't add a README; this package has one.
3. On the empty repo page choose **uploading an existing file**. Drag in every file from this package. There are no folders. `.gitignore` and `.nojekyll` are optional; skip them if they don't come through. Commit to `main`.

## 2. Supabase: create the project

1. supabase.com → organization **WillowHoller** → **New project**.
2. Name **highground**. Region: **East US (Ohio)**, the closest to Iowa.
3. Database password: press **Generate**, save it in your password manager, never anywhere else.
4. If you see security options: keep **Data API** on and **automatic RLS** on. "Automatically expose new tables" can be either; the SQL sets permissions itself.
5. Plan: Free is fine for building. **Upgrade to Pro before any real district signs in.** Free projects pause after about a week idle, and paid plans add daily backups.

## 3. Build the database

In the project: **SQL Editor → New query**. For each file below, copy everything, paste, press **Run**, and wait for "Success". Run them in order, once.

| Order | File | What it does |
|---|---|---|
| 1 | `01_tables.sql` | All 36 tables |
| 2 | `02_security.sql` | Who can see and change what; invitations; audit log |
| 3 | `03_storage.sql` | File storage for uploads, attachments, logos |
| 4 | `04_iowa_rules.sql` | SF 2472 and other Iowa values, each marked verified / recalled / assumed |
| 5 | `07_signin.sql` … `14_general_fund.sql` | Later parts, in number order. Each ends with its own PASS check |
| 6 | `15_state_peer_data.sql` | Iowa school finance data for peer comparisons (filled monthly by the "Iowa public data" GitHub workflow; see `PUBLIC_DATA.md`) |
| 7 | `16_registers_and_peer_settings.sql` | Linking a district to its Iowa district number, peer settings, and monthly check-register questions |
| 8 | `17_levy_rates.sql` | Property tax levy rates by district (Department of Management), including voter-approved PPEL |
| 8b | `18_need_by.sql` | The year each initiative is needed by (used by the ranking and its suggestions) |
| 8c | `19_dom_school_data.sql` | Valuations, Aid and Levy worksheet lines and unspent balances (Department of Management), median home values (Census Bureau), construction prices (BLS), and `ia_prefill_more` for setup |
| 8d | `20_health_checks.sql` | The daily health check (`hg_health_check`) and its run log; see `MONITORING.md` |
| 9 | `05_verify_setup.sql` | Checks the structure. **All 10 rows should say PASS.** |
| 10 | `06_access_test.sql` | Signs in as six test people and tries allowed and forbidden things, then deletes them. **All 18 rows should say PASS.** |

If step 1–4 shows an error, stop and send Claude the full message. If 5 or 6 shows a FAIL or an error, send a screenshot of the result.

## 4. Sign-in settings (email and password)

**Authentication → Sign In / Providers → Email:**
- Email provider: **on**.
- **Confirm email: on.** This one is essential. Access is granted by matching an invitation to a *confirmed* email; with it off, anyone could sign up as your business manager's address and take their seat.
- Secure email change: **on**. Secure password change: **on**.
- Minimum password length: **8** (the app checks the same). Password requirements: **lowercase, uppercase letters, digits and symbols** (the app checks the same).
- Leaked-password protection: turn on if your plan offers it (Pro).

**Authentication → Sign In / Providers (general):** "Allow new users to sign up" **on**. Anyone can make an account, but an account alone sees nothing; only an invitation from a district admin (or you) opens a district.

**Authentication → Multi-Factor:** enable **TOTP** (authenticator apps). The app will offer it; requiring it for admins comes later.

**Authentication → URL Configuration:**
- Site URL: the address the app will live at. Until it's hosted, use `https://highground.willowholler.com/` and change it later.
- Redirect URLs: add the same address, plus `http://localhost:8000/**` for testing.

## 5. Email sending (required before real users)

Supabase's built-in email is for testing only: it sends a handful of messages an hour and may deliver only to your own team's addresses. Confirmation and password-reset emails to districts need your own sender.

1. You need a domain for Willow Holler (for example `willowholler.com`), with DNS access.
2. Pick a sender service: **Resend** or **Postmark** are simplest; Google Workspace's SMTP relay works if you use Workspace.
3. Add the DNS records it gives you (SPF, DKIM). Then **Authentication → Emails → SMTP settings**: enter host, port, user, password, and a sender like `HighGround <no-reply@willowholler.com>`.
4. **Authentication → Emails → Templates:** reword "Confirm signup", "Reset password" and "Change email address" to say HighGround.
5. **Authentication → Rate limits:** raise the email limit once SMTP works.

## 6. Make yourself Willow Holler staff

1. **Authentication → Users → Add user → Create new user.** Use a **Willow Holler address** if you have one, not a personal one. Set a strong password; tick auto-confirm.
2. SQL Editor, new query, replace the address, and run it once:

   ```sql
   insert into public.platform_admin (user_id)
   select id from auth.users where email = 'you@willowholler.com';
   ```

3. Then delete that query from the SQL Editor's sidebar (hover it, open its … menu, choose delete). Supabase keeps queries there automatically, and this one contains your email.

After that, the `platform_admin` row is the only place your email lives. Nothing in the repository contains it.

## 7. Keys: what goes where

**Project Settings → API Keys.**
- **Publishable key** (`sb_publishable_…`) and the project URL go in the app. They're designed to be public; the access rules do the protecting.
- **Secret key** (`sb_secret_…`) and the **database password**: never in the repository, the app, an email or a chat. If one leaks, rotate it in this screen.

## 8. Connect the app to the database

In GitHub, open `config.js` → pencil icon (edit). Replace the two placeholders with the project URL (`https://….supabase.co`) and the **publishable** key from step 7. Commit.

## 9. Put the app online

**GitHub → HighGround → Settings → Pages.** Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save. After a minute or two it's at `https://highground.willowholler.com/`.

GitHub Pages from a **private** repository needs a paid GitHub plan for the organization. Two alternatives: make the repository public for now (nothing secret is in it, and the engine isn't in it yet), or host on Netlify or Cloudflare Pages, which can publish a private repository on a free plan. Decide before the engine moves in.

If the address differs from the one in step 4, update **Authentication → URL Configuration** to match, or confirmation and reset links will go to the wrong place.

## 10. First sign-in

1. Open the address and sign in with the staff account from step 6.
2. **Willow Holler** (bottom of the left rail) → **Add a district**. Start with a fictional demo district, tick *Demo district*, and optionally enter a first admin's email.
3. To try the other roles, invite test addresses from **Settings → People** and create those accounts from a private browser window. Invitations aren't emailed yet; the person creates an account with the invited address, confirms it, and has access.
4. **Help → What's built** lists every screen and whether it works.

## 12. Sign-in update (database)

In **SQL Editor → New query**, paste all of `07_signin.sql` and click **Run**. The result is a five-row table; every row should say **PASS**. Do this *before* uploading the app files that use it.

## 13. Invitation emails (server function)

The app asks a small Supabase function to send invitation emails, so the Postmark token never reaches a browser.

1. **Edge Functions** (left sidebar) → **Deploy a new function** → **Via Editor**.
2. Name it exactly `send-invitation`.
3. Delete the template code, paste in all of `send-invitation.ts`, and click **Deploy function**. It takes 10–30 seconds.
   Then open the function's **Details** and switch off **Enforce JWT Verification**. Browsers send an unsigned check before the real request, and Supabase's built-in check would turn it away. The function verifies the caller itself and sends only for that district's admins.
4. **Edge Functions → Secrets**: add a secret named `POSTMARK_SERVER_TOKEN` whose value is your Postmark **Server API token** (Postmark → your server → API Tokens). Save. No redeploy is needed.
5. Optional secrets: `APP_URL` if the app moves to its own address (default `https://highground.willowholler.com/`; set it anyway), and `MAIL_FROM` (default `HighGround <no-reply@willowholler.com>`).
6. Test: **Settings → People → Invite someone** with an address you can check. Until Postmark approves the account, only willowholler.com addresses receive mail.

If the email can’t be sent, the app says why and keeps the invitation, so the person can still create an account with the invited address.

## 11. What's ready, and what isn't

**Ready after these steps:** the database for districts, people and roles; initiatives, scenarios, phases, funding and yearly costs; goals and measures; monthly GL, budget and balance uploads with review and apply; surveys (totals and themes); suggestions; attachments; publishing; the audit log; file storage.

**The app today** is the HighGround shell: sign-in (create account, confirm email, reset password), the six sections and their tabs, the district picker, people and invitations, district details, your account, and the Willow Holler page for adding districts. Screens that read real tables show live data. Everything else is marked: a badge on each screen (Live, Partly built, Not built yet), orange dashed panels describing what's coming and in which phase, and dashed buttons that say "not built yet" when clicked.

**Not built:** the capital plan and engine (Phase 1), uploads (Phases 1, 3 and 5), editing initiatives and scenarios (Phases 1 and 2), reports and publishing (Phases 1 and 4), the general fund (Phase 6). Today's Horizon planner stays where it is until the engine moves in.

**Retiring the old setup:** keep the `horizon` project and `Horizon` repo until HighGround runs, then archive the repo and delete the project. The old project's member table and setup SQL still hold your personal email; deleting the project removes it.
