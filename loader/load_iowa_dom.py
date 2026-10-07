#!/usr/bin/env python3
"""Load three Iowa Department of Management school files into Supabase (part 19's tables).

    DATABASE_URL=postgresql://...  python3 load_iowa_dom.py                      # find the files, load new or changed ones
    python3 load_iowa_dom.py --only valuation --force                             # one kind, even if unchanged
    python3 load_iowa_dom.py --file valuation=vals.xlsx --file aidlevy=al.xlsx --file unspent=uab.xlsx --dry-run

  valuation  "School District Assessed & Taxable Valuations by Class, AY____-FY____.xlsx" (FY2023 on)
             sheets Assessed/Taxable x Non-TIF/TIF (the "_Combined" versions, which add subdistricts, when present);
             header row has 'DistrictNumber'; 'Valuation With G&E Utilities', '100% Ag Land', 'Taxable Residential' ...
  aidlevy    "Aid and Levy, Tax Certification, and Program Summary, FY ____.xlsx" (FY2018 on)
             sheet Data_AidAndLevy: one row per district ('Dist'), one column per worksheet line (L101, L203, L519 ...)
  unspent    "Unspent Authorized Budget Report" (one workbook, every year)
             sheet data_UAB: FiscalYear, Dist, ... 'Other Miscellaneous Income', 'Expenditures',
             'Maximum Authorized Budget', 'Unspent Authorized Budget'

Layouts VERIFIED 2026-10-08 against the FY2023, FY2025 and FY2027 valuation files, the FY2019, FY2023 and FY2027 Aid and
Levy files and the Unspent Authorized Budget report (FY2008-2026). The Department lists the files in published Google
Sheets (dom.iowa.gov/schools -> School Data). Only districts the annual-report data knows (ia_district) are loaded.
Runs in the "Iowa public data" GitHub workflow after the annual reports. Needs Python 3.9+, openpyxl and psql.
Uses DATABASE_URL: never put the password in a file.
"""
import argparse, csv, hashlib, io, json, os, re, subprocess, sys, tempfile, urllib.request

LISTS = {
    "valuation": "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuaISQczqNcsNYTXs6Z0J6JwZsiqSXCJ1yCdE0Tz-fIa_jFgsXtuS3BPv48v-WOoPDOZuB9RntA90W/pub?output=csv",
    "aidlevy": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRiYjnBa3QKdUCdT4EitQCHqM_jy-4SNrjx64xk9qg8TWuLGwJXnZXDTLGZxUPXdKhWClOC2tFMVpzX/pub?output=csv",
}
NAME_RE = {
    "valuation": r"School District Assessed & Taxable Valuations by Class, AY\d{4}-FY(\d{4})\.xlsx$",
    "aidlevy": r"Aid and Levy, Tax Certification, and Program Summary, FY ?(\d{4})\.xlsx$",
}
FIRST_FY = {"valuation": 2019, "aidlevy": 2018, "unspent": 2015}
SCHOOLS_PAGE = "https://dom.iowa.gov/schools"
UNSPENT_ID = "19rG7pafGN8WWd9mpJTKizfyQpLsvz-pY"     # used when the page link can't be found
UA = {"User-Agent": "HighGround public-data loader (Willow Holler; hello@willowholler.com)"}


def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            return r.read()
    except Exception as e:
        raise SystemExit(f"Couldn't download {url}: {e!r}. Download the file by hand and run with --file kind=path.")


def drive_url(u):
    m = re.search(r"(?:id=|/d/)([\w-]{20,})", u)
    return f"https://drive.google.com/uc?id={m.group(1)}&export=download" if m else u


def find_files(kind):
    """[(fy or None, file_name, url)] newest first."""
    if kind == "unspent":
        fid = UNSPENT_ID
        try:
            page = fetch(SCHOOLS_PAGE).decode("utf-8", "replace")
            m = re.search(r'href="([^"]*drive\.google\.com[^"]*)"[^>]*>[^<]*Unspent', page, flags=re.I) \
                or re.search(r'Unspent[^<]{0,200}</[^>]+>\s*(?:<[^>]+>\s*)*<a[^>]+href="([^"]*drive\.google\.com[^"]*)"', page, flags=re.I)
            if m:
                fid = re.search(r"(?:id=|/d/)([\w-]{20,})", m.group(1)).group(1)
        except SystemExit:
            pass
        return [(None, "Unspent Authorized Budget Report.xlsx", drive_url(fid))]
    text = fetch(LISTS[kind]).decode("utf-8-sig", "replace")
    out = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2:
            continue
        m = re.match(NAME_RE[kind], row[0].strip(), flags=re.I)
        if m and int(m.group(1)) >= FIRST_FY[kind] and "drive.google" in row[1]:
            out.append((int(m.group(1)), row[0].strip(), drive_url(row[1].strip())))
    return sorted(out, reverse=True)


def district_id(v):
    s = str(v if v is not None else "").strip()
    if not re.fullmatch(r"\d{1,4}(\.0)?", s):
        return None
    n = int(float(s))
    return f"{n:04d}" if 0 < n < 8000 else None


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except ValueError:
        return None


norm = lambda h: re.sub(r"\s+", " ", str(h or "")).strip().lower()


def header_at(rows, want, limit=12):
    for i, r in enumerate(rows[:limit]):
        heads = [norm(x) for x in r]
        if want in heads:
            return i, heads
    return None, None


# ---------------------------------------------------------------- valuation
def parse_valuation(path, fy_hint=None):
    """{de: {taxable, taxable_tif, assessed, assessed_tif, ag_assessed, ag_taxable, res_assessed, res_taxable}}, fy"""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    names = {norm(n): n for n in wb.sheetnames}
    out, fy = {}, fy_hint
    for basis in ("assessed", "taxable"):
        for tif in ("non-tif", "tif"):
            sheet = names.get(f"{basis} {tif}_combined") or names.get(f"{basis} {tif}")
            if not sheet:
                raise SystemExit(f"{path}: no '{basis} {tif}' sheet (sheets: {wb.sheetnames}). The layout may have changed.")
            rows = list(wb[sheet].iter_rows(values_only=True))
            hi, heads = header_at(rows, "districtnumber")
            if hi is None:
                raise SystemExit(f"{path} / {sheet}: no 'DistrictNumber' header.")
            col = lambda pred: next((i for i, h in enumerate(heads) if pred(h)), None)
            c_de, c_fy = heads.index("districtnumber"), col(lambda h: h == "fiscalyear")
            c_tot = col(lambda h: h.startswith("valuation with"))
            c_ag = col(lambda h: h.endswith(" ag land"))
            c_res = col(lambda h: h.endswith(" residential"))
            if None in (c_tot, c_ag, c_res):
                raise SystemExit(f"{path} / {sheet}: missing a valuation, ag land or residential column: {heads}")
            key = ("assessed" if basis == "assessed" else "taxable") + ("" if tif == "non-tif" else "_tif")
            for r in rows[hi + 1:]:
                if not r or c_de >= len(r):
                    continue
                de = district_id(r[c_de])
                if not de:
                    continue
                if c_fy is not None and fy is None and num(r[c_fy]):
                    fy = int(num(r[c_fy]))
                d = out.setdefault(de, {})
                d[key] = (d.get(key) or 0) + (num(r[c_tot]) or 0)
                b = "ag_assessed" if basis == "assessed" else "ag_taxable"
                d[b] = (d.get(b) or 0) + (num(r[c_ag]) or 0)
                b = "res_assessed" if basis == "assessed" else "res_taxable"
                d[b] = (d.get(b) or 0) + (num(r[c_res]) or 0)
    return out, fy


# ---------------------------------------------------------------- aid and levy
def parse_aidlevy(path):
    """{de: {"L101": 692.6, ...}}"""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    sheet = next((n for n in wb.sheetnames if norm(n) == "data_aidandlevy"), None)
    if not sheet:
        raise SystemExit(f"{path}: no Data_AidAndLevy sheet (sheets: {wb.sheetnames}).")
    it = wb[sheet].iter_rows(values_only=True)
    first = [next(it, ()) for _ in range(5)]
    hi, heads = header_at(first, "dist", 5)
    if hi is None or "l101" not in heads:
        raise SystemExit(f"{path} / {sheet}: no header with 'Dist' and 'L101'.")
    c_de = heads.index("dist")
    lcols = [(i, h.upper()) for i, h in enumerate(heads) if re.fullmatch(r"l\d{3,4}", h)]
    out = {}
    for r in first[hi + 1:] + list(it):
        if not r or c_de >= len(r):
            continue
        de = district_id(r[c_de])
        if not de:
            continue
        out[de] = {k: num(r[i]) for i, k in lcols if i < len(r) and num(r[i]) is not None}
    return out


# ---------------------------------------------------------------- unspent authorized budget
UAB = {"maximum district cost": "max_district_cost", "other miscellaneous income": "misc_income",
       "expenditures": "expenditures", "maximum authorized budget": "max_authorized", "unspent authorized budget": "unspent"}


def parse_unspent(path):
    """{(de, fy): {...}}"""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    sheet = next((n for n in wb.sheetnames if norm(n) == "data_uab"), None)
    if not sheet:
        raise SystemExit(f"{path}: no data_UAB sheet (sheets: {wb.sheetnames}).")
    it = wb[sheet].iter_rows(values_only=True)
    heads = [norm(x) for x in next(it)]
    if "fiscalyear" not in heads or "dist" not in heads:
        raise SystemExit(f"{path} / {sheet}: no FiscalYear / Dist header: {heads}")
    c_fy, c_de = heads.index("fiscalyear"), heads.index("dist")
    cols = {f: heads.index(h) for h, f in UAB.items() if h in heads}
    if len(cols) < len(UAB):
        raise SystemExit(f"{path} / {sheet}: missing columns {set(UAB) - set(heads)}")
    out = {}
    for r in it:
        if not r or max(c_fy, c_de) >= len(r):
            continue
        de, fy = district_id(r[c_de]), num(r[c_fy])
        if not de or not fy or int(fy) < FIRST_FY["unspent"]:
            continue
        out[(de, int(fy))] = {f: num(r[i]) if i < len(r) else None for f, i in cols.items()}
    return out


# ---------------------------------------------------------------- database
# Supabase stops any one statement after a couple of minutes; this loader's own session turns that limit off.
def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input="set statement_timeout = 0;\n" + sql,
                       text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip()


def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def unchanged(db, kind, years, digest):
    return bool(psql(db, f"select 1 from public.ia_load_run where kind = {lit('dom_' + kind)} and years = {lit(years)} "
                         f"and sha256 = {lit(digest)} and status = 'ok' limit 1;"))


def load(db, kind, name, years, digest, rows_read, csvp, table, cols, where):
    collist = ", ".join(cols)
    n = psql(db, f"""create temp table _t as select {collist} from public.{table} limit 0;
\\copy _t ({collist}) from '{csvp}' with (format csv, null '')
begin;
delete from public.{table} where {where};
insert into public.{table} ({collist}) select t.* from _t t join public.ia_district d on d.de_district = t.de_district
  on conflict (de_district, fiscal_year) do update set {", ".join(f"{c} = excluded.{c}" for c in cols if c not in ("de_district", "fiscal_year"))}, loaded_at = now();
insert into public.ia_load_run (kind, source_url, sha256, rows_read, rows_loaded, years, status)
select {lit('dom_' + kind)}, {lit(name)}, {lit(digest)}, {rows_read}, count(*), {lit(years)}, 'ok' from public.{table} where {where};
commit;
select count(*) from public.{table} where {where};""").splitlines()[-1]
    return int(n)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["valuation", "aidlevy", "unspent"], action="append")
    ap.add_argument("--file", action="append", default=[], help="kind=path (kind[FY]=path for one year, e.g. aidlevy2027=al.xlsx)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = os.environ.get("DATABASE_URL")
    if not db and not a.dry_run:
        raise SystemExit("Set DATABASE_URL (or use --dry-run).")
    kinds = a.only or ["valuation", "aidlevy", "unspent"]
    work = tempfile.mkdtemp(prefix="dom_")
    local = {}
    for x in a.file:
        k, p = x.split("=", 1)
        m = re.fullmatch(r"(valuation|aidlevy|unspent)(\d{4})?", k)
        if not m:
            raise SystemExit(f"--file {x}: use valuation=, aidlevy= or unspent= (optionally with a year, aidlevy2027=)")
        local.setdefault(m.group(1), []).append((int(m.group(2)) if m.group(2) else None, os.path.basename(p), p))
    for kind in kinds:
        files = local.get(kind) if a.file else find_files(kind)
        if not files:
            print(f"{kind}: no files", flush=True)
            continue
        for fy, name, src in files:
            if src.startswith("http"):
                data = fetch(src)
                if not data.startswith(b"PK"):
                    raise SystemExit(f"{name}: the download wasn't a spreadsheet. Download it by hand and run with --file.")
                p = os.path.join(work, re.sub(r"[^\w.-]+", "_", name))
                open(p, "wb").write(data)
            else:
                p = src
            digest = hashlib.sha256(open(p, "rb").read()).hexdigest()
            csvp = os.path.join(work, f"{kind}_{fy or 'all'}.csv")
            if kind == "valuation":
                vals, vfy = parse_valuation(p, fy)
                fy = fy or vfy
                cols = ["de_district", "fiscal_year", "taxable", "taxable_tif", "assessed", "assessed_tif",
                        "ag_assessed", "ag_taxable", "res_assessed", "res_taxable", "source_file"]
                with open(csvp, "w", newline="") as o:
                    w = csv.writer(o)
                    for de, v in vals.items():
                        w.writerow([de, fy] + [round(v.get(c) or 0) for c in cols[2:-1]] + [name])
                print(f"valuation FY{fy}: {len(vals)} districts ({name})", flush=True)
                if a.dry_run:
                    for de in list(vals)[:2]:
                        print("   ", de, vals[de])
                    continue
                if not a.force and unchanged(db, kind, str(fy), digest):
                    print(f"valuation FY{fy}: unchanged, skipped", flush=True); continue
                n = load(db, kind, name, str(fy), digest, len(vals), csvp, "ia_valuation", cols, f"fiscal_year = {fy}")
            elif kind == "aidlevy":
                if fy is None:
                    m = re.search(r"FY ?(\d{4})", name)
                    fy = int(m.group(1)) if m else None
                if fy is None:
                    raise SystemExit(f"{name}: say which year, e.g. --file aidlevy2027={p}")
                lines = parse_aidlevy(p)
                cols = ["de_district", "fiscal_year", "lines", "source_file"]
                with open(csvp, "w", newline="") as o:
                    w = csv.writer(o)
                    for de, v in lines.items():
                        w.writerow([de, fy, json.dumps(v, separators=(",", ":")), name])
                print(f"aidlevy FY{fy}: {len(lines)} districts ({name})", flush=True)
                if a.dry_run:
                    for de in list(lines)[:2]:
                        print("   ", de, {k: lines[de].get(k) for k in ("L101", "L203", "L403", "L519", "L1903")})
                    continue
                if not a.force and unchanged(db, kind, str(fy), digest):
                    print(f"aidlevy FY{fy}: unchanged, skipped", flush=True); continue
                n = load(db, kind, name, str(fy), digest, len(lines), csvp, "ia_aid_levy", cols, f"fiscal_year = {fy}")
            else:
                rows = parse_unspent(p)
                cols = ["de_district", "fiscal_year", "max_district_cost", "misc_income", "expenditures", "max_authorized",
                        "unspent", "source_file"]
                with open(csvp, "w", newline="") as o:
                    w = csv.writer(o)
                    for (de, yr), v in rows.items():
                        w.writerow([de, yr] + ["" if v.get(c) is None else round(v[c]) for c in cols[2:-1]] + [name])
                yrs = sorted({yr for _, yr in rows})
                print(f"unspent: {len(rows)} district-years, FY{yrs[0] if yrs else '?'}-FY{yrs[-1] if yrs else '?'} ({name})", flush=True)
                if a.dry_run:
                    for k in list(rows)[-2:]:
                        print("   ", k, rows[k])
                    continue
                if not a.force and unchanged(db, kind, "all", digest):
                    print("unspent: unchanged, skipped", flush=True); continue
                n = load(db, kind, name, "all", digest, len(rows), csvp, "ia_unspent", cols, f"fiscal_year >= {FIRST_FY['unspent']}")
            print(f"{kind} {fy or ''}: {n} rows in the database", flush=True)


if __name__ == "__main__":
    main()
