#!/usr/bin/env python3
"""Import a check register (CSV) for one district and run the board-question checks.

    python3 import_register.py --district ironwood-valley --file fy2026_all.csv --split-monthly   # a year at once
    python3 import_register.py --district ironwood-valley --file sept.csv --month 2026-09        # one month
    python3 import_register.py --district ironwood-valley --file x.csv --dry-run                 # column match only

For Willow Holler staff backfilling past months (districts upload month by month in the app:
Progress → Uploads → "Check register"). Each month becomes an applied upload of kind
'check_register', exactly like an app upload, then every month is checked in date order.
Uses DATABASE_URL and psql, so it runs as the database owner: staff only.

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


# Supabase stops any one statement after a couple of minutes; refreshing every year's measures takes longer,
# so this loader's own session (not the app's) turns that limit off.
def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input="set statement_timeout = 0;\n" + sql, text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--district", required=True, help="the district's link id (slug), e.g. ironwood-valley")
    ap.add_argument("--file", required=True)
    ap.add_argument("--month", help="YYYY-MM, when the file is one month (default: the month of its latest date)")
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

    def month_end(d):
        return ((d.replace(day=1) + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1))
    groups = collections.OrderedDict()
    if a.split_monthly:
        for l in sorted(lines, key=lambda l: l["pay_date"] or dt.date.min):
            if not l["pay_date"]:
                raise SystemExit(f"--split-monthly needs a date on every line (line {l['line_no']})")
            groups.setdefault(month_end(l["pay_date"]), []).append(l)
    else:
        if a.month:
            pe = month_end(dt.date.fromisoformat(a.month + "-01"))
        else:
            dates = [l["pay_date"] for l in lines if l["pay_date"]]
            if not dates:
                raise SystemExit("No dates in the file: pass --month YYYY-MM")
            pe = month_end(max(dates))
        groups[pe] = lines

    db = os.environ.get("DATABASE_URL") or sys.exit("Set DATABASE_URL")
    did = psql(db, f"select id from public.district where slug = {lit(a.district)};").splitlines()
    if not did or not did[-1]:
        raise SystemExit(f"No district with the link id {a.district!r}")
    did = did[-1]
    work = tempfile.mkdtemp(prefix="reg_")
    for pe, ls in groups.items():
        path = os.path.join(work, f"{pe}.csv")
        # an earlier upload of the same month is replaced, as in the app
        bid = psql(db, f"""update public.import_batch set status = 'superseded'
  where district_id = {lit(did)} and kind = 'check_register' and period_end = {lit(pe)} and status in ('uploaded','review','applied');
insert into public.import_batch (district_id, kind, period_end, file_name, status, row_count, notes, applied_at)
values ({lit(did)}, 'check_register', {lit(pe)}, {lit(os.path.basename(a.file))}, 'applied', {len(ls)}, 'Loaded by import_register.py', now())
returning id;""").splitlines()[-1]
        with open(path, "w", newline="") as o:
            w = csv.writer(o)
            w.writerow(["batch_id", "district_id", "line_no"] + FIELDS)
            for l in ls:
                w.writerow([bid, did, l["line_no"]] + ["" if l[f] is None else l[f] for f in FIELDS])
        psql(db, f"\\copy public.register_line (batch_id, district_id, line_no, {', '.join(FIELDS)}) "
                 f"from '{path}' with (format csv, header true, null '')\n")
        print(f"Loaded {pe:%B %Y}: {len(ls)} payments", flush=True)

    if not a.no_check:
        res = psql(db, f"select public.register_check_all({lit(did)})::text;")
        for r in json.loads(res.splitlines()[-1]):
            print(f"  checked {r['period_end']}: {r['open_flags']} open questions {r['by_rule']}")


if __name__ == "__main__":
    main()
