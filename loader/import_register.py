#!/usr/bin/env python3
"""Import a check register (CSV) for one district and run the board-question checks.

    python3 import_register.py --tenant demo --file aug_2026.csv                      # one month
    python3 import_register.py --tenant demo --file fy2026_all.csv --split-monthly    # a year at once
    python3 import_register.py --tenant demo --file x.csv --dry-run                   # show the column match only

For staff backfills of past months. Uses DATABASE_URL and psql like the Data Hub loader, so it
bypasses row-level security: only Willow Holler staff should run it. Districts will upload
through the app, which writes the same tables as the signed-in user.

Column matching is by header name (see GUESSES). Override with --map field="Header Name".
If the export has one account string and no separate fund/function/object columns, the account
is split with an ASSUMED Iowa layout: first 2-digit group = fund, first non-zero 4-digit group =
function, last non-zero 3-digit group = object. Check the dry-run output against a real export.
"""
import argparse, collections, csv, datetime as dt, json, os, re, subprocess, sys, tempfile

FIELDS = ["pay_date", "check_no", "vendor_no", "vendor_name", "invoice_no", "description",
          "account", "fund", "func", "obj", "amount", "method"]
GUESSES = {
    "pay_date":    ["check date", "pay date", "payment date", "date", "warrant date", "posted"],
    "check_no":    ["check no", "check number", "check #", "check", "warrant", "reference", "ref"],
    "vendor_no":   ["vendor no", "vendor number", "vendor #", "vendor id", "payee id", "vendor code"],
    "vendor_name": ["vendor name", "vendor", "payee", "name", "paid to"],
    "invoice_no":  ["invoice no", "invoice number", "invoice #", "invoice"],
    "description": ["description", "desc", "memo", "line description", "purpose", "comment"],
    "account":     ["account", "account number", "account code", "gl account", "acct", "account no"],
    "fund":        ["fund"],
    "func":        ["function", "func"],
    "obj":         ["object", "obj"],
    "amount":      ["amount", "check amount", "payment amount", "net amount", "total", "amt"],
    "method":      ["method", "payment type", "type", "pay type"],
}


def key(h):
    return re.sub(r"[^a-z0-9#]+", " ", h.lower()).strip()


def match_columns(header, overrides):
    hk = [key(h) for h in header]
    out = {}
    for f, name in overrides.items():
        if key(name) not in hk:
            raise SystemExit(f'--map {f}="{name}": no such column. Columns: {header}')
        out[f] = hk.index(key(name))
    used = set(out.values())
    for f in FIELDS:
        if f in out:
            continue
        for g in GUESSES[f]:            # exact header first, then "starts with"
            hits = [i for i, h in enumerate(hk) if i not in used and h == g]
            hits = hits or [i for i, h in enumerate(hk) if i not in used and h.startswith(g + " ")]
            if hits:
                out[f] = hits[0]; used.add(hits[0]); break
    for need in ("vendor_name", "amount"):
        if need not in out:
            raise SystemExit(f"Couldn't find the {need} column. Columns: {header}. Use --map {need}=\"...\"")
    return out


def parse_date(s):
    s = (s or "").strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%Y/%m/%d", "%m-%d-%Y", "%d-%b-%Y", "%b %d, %Y"):
        try:
            return dt.datetime.strptime(s.split(" ")[0] if fmt.count(" ") == 0 else s, fmt).date()
        except ValueError:
            pass
    return None


def parse_amount(s):
    s = (s or "").strip().replace("$", "").replace(",", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def split_account(acct):
    """ASSUMED Iowa layout; returns (fund, func, obj) or Nones."""
    toks = [t for t in re.split(r"[^0-9]+", acct or "") if t]
    fund = toks[0] if toks and len(toks[0]) == 2 else None
    func = next((t for t in toks[1:] if len(t) == 4 and t != "0000"), None)
    obj = next((t for t in reversed(toks[1:]) if len(t) == 3 and t != "000"), None)
    return fund, func, obj


def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input=sql, text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--file", required=True)
    ap.add_argument("--period-start"); ap.add_argument("--period-end")
    ap.add_argument("--split-monthly", action="store_true", help="one import per calendar month of pay_date")
    ap.add_argument("--source", default="register export")
    ap.add_argument("--map", action="append", default=[], help='field="Header Name"')
    ap.add_argument("--no-check", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    overrides = dict(m.split("=", 1) for m in a.map)
    with open(a.file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    # skip title lines above the real header (board-packet exports often have them)
    hdr_i = next((i for i, r in enumerate(rows[:15]) if sum(bool(c.strip()) for c in r) >= 3), 0)
    header, body = rows[hdr_i], rows[hdr_i + 1:]
    cols = match_columns(header, overrides)

    lines, skipped = [], 0
    for n, r in enumerate(body, start=1):
        g = lambda f: r[cols[f]].strip() if f in cols and cols[f] < len(r) else ""
        amt, vendor = parse_amount(g("amount")), g("vendor_name")
        if amt is None or not vendor or vendor.lower().startswith(("total", "grand total")):
            skipped += 1; continue
        fund, func, obj = g("fund") or None, g("func") or None, g("obj") or None
        if g("account") and not (fund and func and obj):
            f2, fn2, o2 = split_account(g("account"))
            fund, func, obj = fund or f2, func or fn2, obj or o2
        lines.append({"line_no": n, "pay_date": parse_date(g("pay_date")), "check_no": g("check_no") or None,
                      "vendor_no": g("vendor_no") or None, "vendor_name": vendor, "invoice_no": g("invoice_no") or None,
                      "description": g("description") or None, "account": g("account") or None,
                      "fund": fund, "func": func, "obj": obj, "amount": amt, "method": g("method") or None})

    print("Column match:", {f: header[i] for f, i in cols.items()})
    print(f"Lines: {len(lines)}  skipped: {skipped}  total: ${sum(l['amount'] for l in lines):,.2f}")
    if a.dry_run:
        for l in lines[:5]:
            print(json.dumps(l, default=str))
        return

    groups = collections.OrderedDict()
    if a.split_monthly:
        for l in sorted(lines, key=lambda l: l["pay_date"] or dt.date.min):
            if not l["pay_date"]:
                raise SystemExit(f"--split-monthly needs a date on every line (line {l['line_no']})")
            m = l["pay_date"].replace(day=1)
            nxt = (m + dt.timedelta(days=32)).replace(day=1)
            groups.setdefault((m, nxt - dt.timedelta(days=1)), []).append(l)
    else:
        dates = [l["pay_date"] for l in lines if l["pay_date"]]
        ps = dt.date.fromisoformat(a.period_start) if a.period_start else (min(dates) if dates else None)
        pe = dt.date.fromisoformat(a.period_end) if a.period_end else (max(dates) if dates else None)
        if not ps or not pe:
            raise SystemExit("No dates in the file: pass --period-start and --period-end")
        groups[(ps, pe)] = lines

    db = os.environ.get("DATABASE_URL") or sys.exit("Set DATABASE_URL")
    work = tempfile.mkdtemp(prefix="reg_")
    import_ids = []
    for (ps, pe), ls in groups.items():
        path = os.path.join(work, f"{ps}.csv")
        with open(path, "w", newline="") as o:
            w = csv.writer(o)
            w.writerow(["import_id", "tenant_id", "line_no"] + FIELDS)
            for l in ls:
                w.writerow([":IMPORT", a.tenant, l["line_no"]] + ["" if l[f] is None else l[f] for f in FIELDS])
        iid = psql(db, f"""insert into public.register_import (tenant_id, period_start, period_end, file_name, source, uploaded_by)
values ({lit(a.tenant)}, {lit(ps)}, {lit(pe)}, {lit(os.path.basename(a.file))}, {lit(a.source)}, 'import_register.py')
returning id;""").splitlines()[-1]
        with open(path) as f:
            data = f.read().replace(":IMPORT", iid)
        with open(path, "w") as f:
            f.write(data)
        psql(db, f"\\copy public.register_line (import_id, tenant_id, line_no, {', '.join(FIELDS)}) "
                 f"from '{path}' with (format csv, header true, null '')\n")
        import_ids.append(iid)
        print(f"Imported {ps} .. {pe}: {len(ls)} lines -> {iid}")

    if not a.no_check:
        res = psql(db, f"select public.register_check_all({lit(a.tenant)})::text;")
        for r in json.loads(res.splitlines()[-1]):
            print(f"  checked {r['period_start']}: {r['open_flags']} open flags {r['by_rule']}")


if __name__ == "__main__":
    main()
