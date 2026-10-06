#!/usr/bin/env python3
"""Load Iowa Data Hub school district expenditures and revenues into Supabase.

    DATABASE_URL=postgresql://...  python3 load_iowa_datahub.py            # download + load if changed
    python3 load_iowa_datahub.py --force                                     # load even if unchanged
    python3 load_iowa_datahub.py --file exp=path.csv --file rev=path.csv     # load local files
    python3 load_iowa_datahub.py --dry-run                                   # download + parse, no database

Needs Python 3.9+ (standard library only) and the psql client. DATABASE_URL is the Supabase
connection string (Project Settings -> Database -> Connection string, session pooler). It holds the
database password: keep it in a GitHub secret or your shell, never in a file.

Source (VERIFIED 2026-10-06): Iowa Department of Management, Iowa Data Hub, CC BY 4.0.
  994  Iowa School District Expenditures by Fiscal Year   ~406k rows, FY2017 on, updated yearly
  995  Iowa School District Revenues by Fiscal Year       ~544k rows, FY2017 on, updated yearly
Each row: district x fiscal year x Actual/ReEstimated/Budget x fund x function (or source).
"""
import argparse, csv, gzip, hashlib, io, json, os, re, subprocess, sys, tempfile, urllib.request, zipfile

SOURCES = {
    "exp": "https://idh-be.iowa.gov/api/v1/datasets/994/rows.csv",
    "rev": "https://idh-be.iowa.gov/api/v1/datasets/995/rows.csv",
}
STAGE_COLS = ["kind", "fiscal_year", "status", "aea", "dom_district", "de_district", "district_name",
              "column_name", "fund", "line", "amount", "per_pupil",
              "enrollment_category", "enrollment_category_number"]

# Header aliases: the API's column names, and the labels the website shows, both map here.
ALIASES = {
    "fiscal_year": "fiscal_year",
    "actual_reestimated_budget": "status",
    "aea": "aea",
    "dist": "dom_district", "dom_district": "dom_district",
    "de_district": "de_district",
    "district_name": "district_name",
    "column_name": "column_name",
    "fund": "fund",
    "source": "line",
    "amount": "amount",
    "amount_per_pupil": "per_pupil", "revenues_per_pupil": "per_pupil", "revenue_per_pupil": "per_pupil",
    "expenditures_per_pupil": "per_pupil",
    "enrollment_category": "enrollment_category",
    "enrollment_category_number": "enrollment_category_number",
}


def norm_header(h):
    k = re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")
    if k in ALIASES:
        return ALIASES[k]
    if "per_pupil" in k:
        return "per_pupil"
    return None


def norm_status(s):
    s = (s or "").strip().lower()
    if s.startswith("act"):
        return "Actual"
    if s.startswith("re"):
        return "ReEstimated"
    if s.startswith("bud"):
        return "Budget"
    return None


def num(s):
    s = (s or "").strip().replace(",", "").replace("$", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def pad_district(s):
    s = (s or "").strip()
    return s.zfill(4) if s.isdigit() else (s or None)


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "HighGround public-data loader (Willow Holler)"})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            f.write(chunk)
    return h.hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _decode(kind, label, data):
    if data[:4] == b"PAR1":
        raise SystemExit(f"[{kind}] {label} is a Parquet file, not CSV; the loader needs updating")
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text, enc = data.decode("utf-16"), "utf-16"
    else:
        try:
            text, enc = data.decode("utf-8-sig"), "utf-8"
        except UnicodeDecodeError:
            text, enc = data.decode("cp1252", errors="replace"), "windows-1252"
    head = text[:160].replace("\r", "\\r").replace("\n", "\\n")
    print(f"[{kind}] {label}: encoding {enc}, {len(data):,} bytes; starts: {head!r}", flush=True)
    if text.lstrip()[:1] in ("<", "{", "["):
        raise SystemExit(f"[{kind}] {label} is not a CSV (looks like HTML or JSON); see 'starts' above")
    return text


def read_texts(kind, src_path):
    """Every CSV in the download, as text: plain, gzip, or a zip of one or more CSVs;
    UTF-8, UTF-16 or Windows-1252."""
    data = open(src_path, "rb").read()
    if data[:2] == b"\x1f\x8b":
        return [_decode(kind, "gzip", gzip.decompress(data))]
    if data[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(data))
        names = [n for n in z.namelist() if not n.endswith("/")]
        print(f"[{kind}] zip holds {len(names)} file(s): {names}", flush=True)
        csvs = [n for n in names if n.lower().endswith((".csv", ".txt"))] or names
        return [_decode(kind, "zip:" + n, z.read(n)) for n in sorted(csvs)]
    return [_decode(kind, "plain", data)]


def parse(kind, src_path, out_path):
    """Normalize the Data Hub CSV into ia_stage columns. Zero amounts are dropped (missing = 0)."""
    stats = {"rows_read": 0, "rows_kept": 0, "zero": 0, "bad": 0, "bad_examples": [], "years": set(), "districts": set()}
    texts = read_texts(kind, src_path)
    with open(out_path, "w", newline="", encoding="utf-8") as o:
      w = csv.writer(o)
      w.writerow(STAGE_COLS)
      for text in texts:
       with io.StringIO(text, newline="") as f:
        rd = csv.reader(f)
        header = next(rd, None)
        if not header:
            continue
        idx = {}
        for i, h in enumerate(header):
            k = norm_header(h)
            if k and k not in idx:
                idx[k] = i
        missing = [k for k in ("fiscal_year", "status", "de_district", "column_name", "amount") if k not in idx]
        if missing:
            raise SystemExit(f"{kind}: header is missing {missing}. Header was: {header}")
        get = lambda row, k: row[idx[k]] if k in idx and idx[k] < len(row) else ""
        for row in rd:
            stats["rows_read"] += 1
            fy = num(get(row, "fiscal_year"))
            st = norm_status(get(row, "status"))
            de = pad_district(get(row, "de_district"))
            amt = num(get(row, "amount"))
            if fy is None or st is None or not de or not get(row, "column_name"):
                stats["bad"] += 1
                if len(stats["bad_examples"]) < 5:
                    stats["bad_examples"].append(row[:9])
                continue
            if not amt:
                stats["zero"] += 1
                continue
            ecn = num(get(row, "enrollment_category_number"))
            pp = num(get(row, "per_pupil"))
            w.writerow([kind, int(fy), st, get(row, "aea").strip(), pad_district(get(row, "dom_district")) or "",
                        de, get(row, "district_name").strip(), get(row, "column_name").strip(),
                        get(row, "fund").strip(), get(row, "line").strip(), amt,
                        "" if pp is None else pp, get(row, "enrollment_category").strip(),
                        "" if ecn is None else int(ecn)])
            stats["rows_kept"] += 1
            stats["years"].add(f"{int(fy)} {st}")
            stats["districts"].add(de)
    stats["years"] = sorted(stats["years"])
    stats["districts"] = len(stats["districts"])
    return stats


def psql(db, sql, capture=False):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input=sql,
                       text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip() if capture else None


def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kinds", default="exp,rev")
    ap.add_argument("--file", action="append", default=[], help="kind=path to use a local CSV instead of downloading")
    ap.add_argument("--force", action="store_true", help="load even if the file hasn't changed since the last load")
    ap.add_argument("--dry-run", action="store_true", help="download and parse only")
    ap.add_argument("--workdir", default=None)
    a = ap.parse_args()

    db = os.environ.get("DATABASE_URL")
    if not db and not a.dry_run:
        raise SystemExit("Set DATABASE_URL (or use --dry-run).")
    local = dict(x.split("=", 1) for x in a.file)
    work = a.workdir or tempfile.mkdtemp(prefix="iadh_")
    summary = []

    for kind in [k.strip() for k in a.kinds.split(",") if k.strip()]:
        url = SOURCES[kind]
        raw = os.path.join(work, f"{kind}_raw.csv")
        if kind in local:
            raw, url = local[kind], "file:" + os.path.basename(local[kind])
            sha = sha_file(raw)
        else:
            print(f"[{kind}] downloading {url}", flush=True)
            sha = download(url, raw)
        print(f"[{kind}] sha256 {sha[:12]}  size {os.path.getsize(raw):,} bytes", flush=True)

        if db and not a.force:
            last = psql(db, f"select sha256 from public.ia_load_run where kind = {lit(kind)} and status = 'ok' "
                            f"order by id desc limit 1;", capture=True)
            if last == sha:
                print(f"[{kind}] unchanged since the last load; skipping (use --force to reload)")
                summary.append({"kind": kind, "skipped": True})
                continue

        stage = os.path.join(work, f"{kind}_stage.csv")
        st = parse(kind, raw, stage)
        print(f"[{kind}] read {st['rows_read']:,}  kept {st['rows_kept']:,}  zero {st['zero']:,}  "
              f"bad {st['bad']:,}  districts {st['districts']}", flush=True)
        print(f"[{kind}] years: {', '.join(st['years'])}", flush=True)
        if st["bad_examples"]:
            print(f"[{kind}] examples of rows skipped as unreadable: {st['bad_examples']}", flush=True)
        if st["rows_kept"] == 0:
            raise SystemExit(f"[{kind}] no usable rows; not loading")
        if a.dry_run:
            summary.append({"kind": kind, **st})
            continue

        cols = ", ".join(STAGE_COLS)
        stage_path = stage.replace("'", "''")
        out = psql(db, f"""
set statement_timeout = 0;
begin;
delete from public.ia_stage where kind = {lit(kind)};
\\copy public.ia_stage ({cols}) from '{stage_path}' with (format csv, header true)
select public.ia_publish({lit(kind)})::text;
insert into public.ia_load_run (kind, source_url, sha256, rows_read, rows_loaded, years, status, message)
values ({lit(kind)}, {lit(url)}, {lit(sha)}, {st['rows_read']}, {st['rows_kept']},
        {lit(', '.join(st['years']))}, 'ok', {lit(json.dumps({'zero': st['zero'], 'bad': st['bad'], 'bad_examples': st['bad_examples']}))});
commit;
""", capture=True)
        print(f"[{kind}] published: {out.splitlines()[-1] if out else ''}", flush=True)
        summary.append({"kind": kind, **st})

    print(json.dumps(summary, default=str))


if __name__ == "__main__":
    main()
