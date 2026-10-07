#!/usr/bin/env python3
"""HighGround daily health check. Run by the "Daily health check" GitHub workflow every morning.

    DATABASE_URL=...  POSTMARK_SERVER_TOKEN=...  HEALTH_EMAIL_TO=admin@willowholler.com  python3 loader/health_check.py
    python3 loader/health_check.py --no-email          # check and print only

Four kinds of check, each ok / warn / fail:
  connections  the app's website answers and serves the latest app.js; Supabase sign-in and data API answer; signed-out
               visitors get nothing back; the invitation email function is deployed; every outside source the monthly
               data pull uses is reachable (state pages and file lists, a Drive download, BLS, the Census key)
  code         every calculation test in the repository passes (engine, capital plan, General Fund, ranking, tax ...)
  database     public.hg_health_check(): access rules, data freshness, ties between state files, plan consistency, people
Then: the run is saved to hg_health_run (Willow Holler page → System health); an email goes to HEALTH_EMAIL_TO when anything
fails, when everything is fixed again after a failure, and every Monday as a weekly summary. The workflow fails (and GitHub
notifies too) when anything fails.

Secrets (GitHub → Settings → Secrets and variables → Actions): DATABASE_URL, POSTMARK_SERVER_TOKEN, CENSUS_API_KEY (optional).
Never put them in a file. The Supabase URL and publishable key are read from config.js (they are public by design).
"""
import argparse, datetime, glob, hashlib, html, json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get("HEALTH_SITE", "https://highground.willowholler.com/")
UA = {"User-Agent": "HighGround health check (Willow Holler; hello@willowholler.com)"}
SOURCES = [
    ("Iowa Department of Education: annual report page", "https://educate.iowa.gov/pk-12/operation-support/business-finance/accounting-reporting/certified-annual-report", None),
    ("Iowa Department of Education: certified enrollment page", "https://educate.iowa.gov/pk-12/data/data-collections/certified-enrollment/public-schools", None),
    ("Department of Management: tax rate file list", "https://docs.google.com/spreadsheets/d/e/2PACX-1vS78tJSKEh8IWFHwsLY3oqnyAwZt2XgJKiOftrrAyugpsg4LehiPlEVkYnSMmdGnDNu36-QF1bNt8Lm/pub?output=csv", "School Tax Rates"),
    ("Department of Management: valuation file list", "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuaISQczqNcsNYTXs6Z0J6JwZsiqSXCJ1yCdE0Tz-fIa_jFgsXtuS3BPv48v-WOoPDOZuB9RntA90W/pub?output=csv", "Valuations by Class"),
    ("Department of Management: Aid and Levy file list", "https://docs.google.com/spreadsheets/d/e/2PACX-1vRiYjnBa3QKdUCdT4EitQCHqM_jy-4SNrjx64xk9qg8TWuLGwJXnZXDTLGZxUPXdKhWClOC2tFMVpzX/pub?output=csv", "Aid and Levy"),
    ("U.S. Bureau of Labor Statistics: construction price index", "https://api.bls.gov/publicAPI/v1/timeseries/data/PCU236222236222", "REQUEST_SUCCEEDED"),
]
results = []   # [area, check, status, detail]


def add(area, check, status, detail=""):
    results.append({"area": area, "check": check, "status": status, "detail": str(detail)[:400]})


def fetch(url, headers=None, method="GET", data=None, limit=None, timeout=60):
    """(status, body bytes or b'', final url)"""
    req = urllib.request.Request(url, headers={**UA, **(headers or {})}, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (r.read(limit) if limit else r.read()), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")[:2000], url
    except Exception as e:
        return None, str(e).encode(), url


def config():
    t = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", t).group(1).rstrip("/")
    key = re.search(r"publishableKey:\s*'([^']+)'", t).group(1)
    return url, key


def check_connections():
    st, body, _ = fetch(SITE)
    add("connections", "The website answers", "ok" if st == 200 and b"HighGround" in body else "fail", f"HTTP {st}")
    st, live, _ = fetch(SITE + "app.js?health=" + datetime.date.today().isoformat())
    mine = open(os.path.join(ROOT, "app.js"), "rb").read()
    same = st == 200 and hashlib.sha256(live).hexdigest() == hashlib.sha256(mine).hexdigest()
    add("connections", "The website serves the latest app.js from GitHub", "ok" if same else ("warn" if st == 200 else "fail"),
        "matches" if same else (f"HTTP {st}" if st != 200 else "differs from the repository (a deploy may still be running, or GitHub Pages is stuck)"))

    url, key = config()
    st, body, _ = fetch(url + "/auth/v1/health", {"apikey": key})
    add("connections", "Supabase sign-in service answers", "ok" if st == 200 else "fail", f"HTTP {st}")
    st, body, _ = fetch(url + "/rest/v1/district?select=id&limit=5", {"apikey": key})
    try:
        rows = json.loads(body or b"null")
    except ValueError:
        rows = None
    # a signed-out visitor must get nothing: either an empty list, or "permission denied" (no access to the table at all)
    denied = st in (401, 403) and isinstance(rows, dict) and rows.get("code") == "42501"
    add("connections", "Supabase data API answers, and a signed-out visitor gets no districts",
        "ok" if (st == 200 and rows == []) or denied else "fail",
        "nothing returned" if st == 200 and rows == [] else "refused (no access without signing in)" if denied else f"HTTP {st}: {str(rows)[:120]}")
    st, body, _ = fetch(url + "/functions/v1/send-invitation", {"apikey": key, "Origin": SITE.rstrip("/")}, method="OPTIONS")
    add("connections", "The invitation email function is deployed", "ok" if st == 200 else "fail", f"HTTP {st}")

    for name, src, must in SOURCES:
        st, body, _ = fetch(src, limit=400000)
        ok = st == 200 and (must is None or must.encode() in body)
        add("connections", name, "ok" if ok else "fail", f"HTTP {st}" + ("" if ok or st != 200 else f"; '{must}' not found: the page may have changed"))
        if ok and "Aid and Levy" in name:   # one real Drive download, the first few bytes only
            m = re.search(rb"https://drive\.google\.com/uc\?id=([\w-]+)", body)
            if m:
                st2, b2, _ = fetch(f"https://drive.google.com/uc?id={m.group(1).decode()}&export=download", {"Range": "bytes=0-3"}, limit=4)
                add("connections", "A Department of Management file downloads from Google Drive", "ok" if st2 in (200, 206) and b2.startswith(b"PK") else "fail", f"HTTP {st2}")
    ck = os.environ.get("CENSUS_API_KEY", "").strip()
    if ck:
        y = datetime.date.today().year - 2
        st, body, _ = fetch(f"https://api.census.gov/data/{y}/acs/acs5?get=NAME&for=state:19&key={ck}")
        add("connections", "Census Bureau key works", "ok" if st == 200 and b"Iowa" in body else "fail", f"HTTP {st}")
    else:
        add("connections", "Census Bureau key works", "warn", "no CENSUS_API_KEY secret: home values aren't refreshed")


def check_code():
    tests = sorted(glob.glob(os.path.join(ROOT, "*_test.js")))
    bad = []
    for t in tests:
        r = subprocess.run(["node", t], cwd=ROOT, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            last = (r.stdout + r.stderr).strip().splitlines()[-3:]
            bad.append(os.path.basename(t) + ": " + " / ".join(last))
    add("code", "Every calculation test passes", "ok" if tests and not bad else "fail",
        f"{len(tests)} test files" if not bad else "; ".join(bad))


def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input="set statement_timeout = 0;\n" + sql,
                       text=True, capture_output=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400])
    return r.stdout.strip()


def check_database(db):
    if not db:
        add("database", "Database reachable", "fail", "no DATABASE_URL")
        return
    try:
        out = psql(db, "select coalesce(json_agg(json_build_object('area', area, 'check', check_name, 'status', status, 'detail', detail)), '[]') from public.hg_health_check();")
    except Exception as e:
        add("database", "Database reachable and the health check runs", "fail", e)
        return
    add("database", "Database reachable and the health check runs", "ok", "")
    for x in json.loads(out):
        add(x["area"], x["check"], x["status"], x["detail"] or "")


def previous(db):
    try:
        return psql(db, "select status from public.hg_health_run order by ran_at desc limit 1;") or None
    except Exception:
        return None


def save(db, status, emailed):
    n = {k: sum(1 for x in results if x["status"] == k) for k in ("ok", "warn", "fail")}
    js = json.dumps(results).replace("'", "''")
    psql(db, f"insert into public.hg_health_run (status, n_ok, n_warn, n_fail, checks, emailed) values "
             f"('{status}', {n['ok']}, {n['warn']}, {n['fail']}, '{js}'::jsonb, {str(emailed).lower()});"
             f"delete from public.hg_health_run where ran_at < now() - interval '180 days';")


def run_link():
    s, r, i = os.environ.get("GITHUB_SERVER_URL"), os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    return f"{s}/{r}/actions/runs/{i}" if s and r and i else None


def email(status, reason):
    token, to = os.environ.get("POSTMARK_SERVER_TOKEN", "").strip(), os.environ.get("HEALTH_EMAIL_TO", "").strip()
    if not token or not to:
        print("email: not sent (POSTMARK_SERVER_TOKEN or HEALTH_EMAIL_TO missing)")
        return False
    fails = [x for x in results if x["status"] == "fail"]
    warns = [x for x in results if x["status"] == "warn"]
    n_ok = sum(1 for x in results if x["status"] == "ok")
    subj = {"fail": f"HighGround health: {len(fails)} problem{'s need' if len(fails) != 1 else ' needs'} attention",
            "fixed": "HighGround health: all clear again",
            "weekly": f"HighGround health: weekly summary ({'all clear' if not fails else f'{len(fails)} problems'})"}[reason]
    row = lambda x, c: (f"<tr><td style='padding:4px 8px;color:{c};font-weight:600'>{x['status'].upper()}</td><td style='padding:4px 8px'>{html.escape(x['area'])}</td>"
                        f"<td style='padding:4px 8px'>{html.escape(x['check'])}</td><td style='padding:4px 8px;color:#555'>{html.escape(x['detail'])}</td></tr>")
    link = run_link()
    body = (f"<p style='font-family:sans-serif'>{'Something needs attention.' if fails else 'Everything checked out.'} "
            f"{len(fails)} failed, {len(warns)} warnings, {n_ok} ok.</p>"
            + (f"<table style='font-family:sans-serif;font-size:14px;border-collapse:collapse'>{''.join(row(x, '#B42318') for x in fails)}{''.join(row(x, '#9A6700') for x in warns)}</table>" if fails or warns else "")
            + "<p style='font-family:sans-serif;font-size:13px;color:#555'>"
            + (f"<a href='{link}'>This run's log on GitHub</a> · " if link else "")
            + f"<a href='{SITE}#/staff'>HighGround → Willow Holler → System health</a></p>")
    text = subj + "\n\n" + "\n".join(f"{x['status'].upper()}  {x['area']}  {x['check']}  {x['detail']}" for x in fails + warns) + (f"\n\n{link}" if link else "")
    payload = json.dumps({"From": os.environ.get("MAIL_FROM", "HighGround <no-reply@willowholler.com>"), "To": to, "Subject": subj,
                          "HtmlBody": body, "TextBody": text, "MessageStream": "outbound"}).encode()
    st, resp, _ = fetch("https://api.postmarkapp.com/email", {"Accept": "application/json", "Content-Type": "application/json",
                                                                  "X-Postmark-Server-Token": token}, method="POST", data=payload)
    print(f"email to {to}: HTTP {st} {resp[:200]!r}")
    return st == 200


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-email", action="store_true")
    a = ap.parse_args()
    db = os.environ.get("DATABASE_URL")
    for step in (check_connections, check_code):
        try:
            step()
        except Exception as e:
            add(step.__name__.replace("check_", ""), "The check itself ran", "fail", repr(e))
    check_database(db)

    status = "fail" if any(x["status"] == "fail" for x in results) else "warn" if any(x["status"] == "warn" for x in results) else "ok"
    prev = previous(db) if db else None
    reason = "fail" if status == "fail" else "fixed" if prev == "fail" else "weekly" if datetime.date.today().weekday() == 0 else None
    sent = False if a.no_email or not reason else email(status, reason)
    if db:
        try:
            save(db, status, sent)
        except Exception as e:
            print("could not save the run:", e)

    for x in results:
        print(f"{x['status'].upper():5} {x['area']:11} {x['check']}  {x['detail']}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"## HighGround health: {status}\n\n| | Area | Check | Detail |\n|---|---|---|---|\n")
            for x in sorted(results, key=lambda x: {"fail": 0, "warn": 1, "ok": 2}[x["status"]]):
                f.write(f"| {x['status']} | {x['area']} | {x['check']} | {x['detail'].replace('|', '/')} |\n")
    print(f"\nOverall: {status}" + (f"; email: {'sent' if sent else 'not sent'} ({reason})" if reason else ""))
    sys.exit(1 if status == "fail" else 0)


if __name__ == "__main__":
    main()
