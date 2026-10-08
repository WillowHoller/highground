#!/usr/bin/env python3
"""Load two outside reference figures into Supabase (part 19's ia_reference and ia_home_value).

    DATABASE_URL=postgresql://...  CENSUS_API_KEY=...  python3 load_reference.py
    python3 load_reference.py --dry-run                 # fetch and print, no database

  construction_inflation  U.S. Bureau of Labor Statistics, Producer Price Index by industry: new school building
                          construction (series PCU236222236222). The yearly rate over the last three years (latest month
                          against the same month three years earlier). Public API v1, no key needed.
  ia_home_value           U.S. Census Bureau, American Community Survey 5-year estimates, table B25077 (median value of
                          owner-occupied housing units), for every Iowa unified school district. Needs a free Census API
                          key in CENSUS_API_KEY (a GitHub secret); without one this part is skipped. The Census Bureau names
                          districts ("Adair-Casey Community School District, Iowa"); they are matched to the state's
                          district list by name, and any that don't match are listed.

Runs in the "Iowa public data" GitHub workflow after the annual reports (ia_district must exist). Needs Python 3.9+
and psql. DATABASE_URL and CENSUS_API_KEY stay in GitHub secrets: never put them in a file.
"""
import argparse, csv, datetime, json, os, re, subprocess, tempfile, urllib.request

BLS_SERIES = "PCU236222236222"
BLS_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
CENSUS = "https://api.census.gov/data/{y}/acs/acs5?get=NAME,B25077_001E,B25077_001M&for=school%20district%20(unified):*&in=state:19"
UA = {"User-Agent": "HighGround public-data loader (Willow Holler; support@willowholler.com)", "Content-Type": "application/json"}
# Census name -> the state's district number, for names that don't match on their own (add here as they turn up)
ALIASES = {}


def get_json(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def construction_inflation():
    """{value, detail, source} or None"""
    y = datetime.date.today().year
    try:
        j = get_json(BLS_URL, {"seriesid": [BLS_SERIES], "startyear": str(y - 4), "endyear": str(y)})
    except Exception:
        j = get_json(BLS_URL + BLS_SERIES)
    if j.get("status") != "REQUEST_SUCCEEDED":
        raise SystemExit(f"BLS: {j.get('status')} {j.get('message')}")
    pts = {(int(d["year"]), int(d["period"][1:])): float(d["value"])
           for d in j["Results"]["series"][0]["data"] if re.fullmatch(r"M(0[1-9]|1[0-2])", d["period"])}
    if not pts:
        raise SystemExit("BLS: no monthly values")
    ly, lm = max(pts)
    for back in (3, 2, 1):
        base = (ly - back, lm)
        if base in pts:
            rate = (pts[(ly, lm)] / pts[base]) ** (1 / back) - 1
            return {"value": round(rate, 4),
                    "detail": {"latest": {"year": ly, "month": lm, "index": pts[(ly, lm)]},
                               "base": {"year": base[0], "month": lm, "index": pts[base]}, "years": back},
                    "source": f"U.S. Bureau of Labor Statistics, Producer Price Index: new school building construction "
                              f"({BLS_SERIES}), {MONTHS[lm]} {base[0]} to {MONTHS[lm]} {ly}"}
    raise SystemExit("BLS: not enough history for a yearly rate")


def name_key(s):
    s = str(s or "").lower().replace("&", " and ")
    s = re.sub(r",\s*iowa$", "", s.strip())
    s = re.sub(r"\b(community|comm)\b\s*(school\s+district|school|sd|csd)?\b|\bschool\s+district\b|\bcsd\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def home_values(key, districts):
    """[(de, acs_year, median, margin, census_name)], unmatched names, acs_year"""
    this = datetime.date.today().year
    last_err = None
    for y in range(this - 1, this - 5, -1):
        try:
            rows = get_json(CENSUS.format(y=y) + f"&key={key}")
            break
        except Exception as e:
            last_err = e
    else:
        raise SystemExit(f"Census: no ACS 5-year data found for {this - 4}-{this - 1}: {last_err!r}")
    head, rows = rows[0], rows[1:]
    ci = {h: i for i, h in enumerate(head)}
    by_key = {}
    for de, name in districts:
        by_key.setdefault(name_key(name), de)
    out, unmatched = [], []
    for r in rows:
        nm = r[ci["NAME"]]
        k = name_key(nm)
        de = ALIASES.get(nm) or by_key.get(k)
        if not de and len(k) >= 4:   # one name a shortened form of the other ("A-H-S-T" / "AHSTW"), only when unambiguous
            near = [d for kk, d in by_key.items() if len(kk) >= 4 and (kk.startswith(k) or k.startswith(kk))]
            de = near[0] if len(near) == 1 else None
        if not de:
            unmatched.append(nm)
            continue
        med = r[ci["B25077_001E"]]
        moe = r[ci["B25077_001M"]]
        med = float(med) if med not in (None, "") and float(med) > 0 else None
        moe = float(moe) if moe not in (None, "") and float(moe) > 0 else None
        out.append((de, y, med, moe, nm))
    return out, unmatched, y


def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input="set statement_timeout = 0;\n" + sql,
                       text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip()


def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = os.environ.get("DATABASE_URL")
    if not db and not a.dry_run:
        raise SystemExit("Set DATABASE_URL (or use --dry-run).")

    # outside services can be busy: a failure here is reported and skipped, never fails the monthly run
    try:
        ci = construction_inflation()
        print(f"construction inflation: {ci['value'] * 100:.1f}% a year ({ci['source']})", flush=True)
    except (Exception, SystemExit) as e:
        ci = None
        print(f"construction inflation: skipped this month ({e})", flush=True)
    if ci and not a.dry_run:
        psql(db, f"""insert into public.ia_reference (key, value, detail, source) values
  ('construction_inflation', {ci['value']}, {lit(json.dumps(ci['detail']))}::jsonb, {lit(ci['source'])})
  on conflict (key) do update set value = excluded.value, detail = excluded.detail, source = excluded.source, loaded_at = now();""")

    key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        print("home values: skipped (add a free Census API key as the CENSUS_API_KEY secret to load them)", flush=True)
        return
    districts = [] if a.dry_run else [tuple(l.split("|", 1)) for l in psql(db, "select de_district || '|' || name from public.ia_district;").splitlines() if "|" in l]
    if a.dry_run and not districts:
        districts = [("0018", "Adair-Casey")]
    try:
        rows, unmatched, y = home_values(key, districts)
    except (Exception, SystemExit) as e:
        print(f"home values: skipped this month ({e})", flush=True)
        return
    print(f"home values: ACS {y - 4}-{y}, {len(rows)} districts matched, {len(unmatched)} not matched", flush=True)
    if unmatched:
        print("   not matched (add to ALIASES in load_reference.py if they should be): " + "; ".join(unmatched[:40]), flush=True)
    if a.dry_run:
        for r in rows[:3]:
            print("   ", r)
        return
    src = f"U.S. Census Bureau, American Community Survey {y - 4}-{y} 5-year estimates, median value of owner-occupied homes (B25077)"
    p = os.path.join(tempfile.mkdtemp(prefix="ref_"), "home.csv")
    with open(p, "w", newline="") as o:
        w = csv.writer(o)
        for de, yr, med, moe, nm in rows:
            w.writerow([de, yr, "" if med is None else round(med), "" if moe is None else round(moe), nm, src])
    n = psql(db, f"""create temp table _h (de_district text, acs_year int, median_value numeric, margin numeric, census_name text, source text);
\\copy _h from '{p}' with (format csv, null '')
begin;
delete from public.ia_home_value;
insert into public.ia_home_value (de_district, acs_year, median_value, margin, census_name, source)
select distinct on (h.de_district) h.* from _h h join public.ia_district d on d.de_district = h.de_district order by h.de_district;
insert into public.ia_load_run (kind, source_url, sha256, rows_read, rows_loaded, years, status)
select 'home_value', 'api.census.gov acs5 B25077', null, {len(rows)}, count(*), {lit(str(y))}, 'ok' from public.ia_home_value;
commit;
select count(*) from public.ia_home_value;""").splitlines()[-1]
    print(f"home values: {n} districts in the database", flush=True)


if __name__ == "__main__":
    main()
