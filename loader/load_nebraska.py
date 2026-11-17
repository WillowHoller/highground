#!/usr/bin/env python3
"""Load Nebraska Department of Education (NDE) public school-finance data into Supabase (part 35's tables).

    DATABASE_URL=postgresql://...  python3 load_nebraska.py                  # find the files, load new or changed ones
    python3 load_nebraska.py --only stat --force                              # one kind, even if unchanged
    python3 load_nebraska.py --file stat2026=2526_StatInfo.xls --file aid=2627SA_A1.xlsx --dry-run
    python3 load_nebraska.py --only afr --afr-years 2 --afr-limit 5 --dry-run   # try the AFR pages on five districts

  stat   "Statistical Information for Public School Districts" (one .xls/.xlsx per school year, 2017/18 on): agency ID,
         class, general/bond/special building/QCPUF/total levy, valuation, fall membership (PK, K-12, total).
         A printed report: a title, two header rows (one with 'Agency ID'), county rows, then one row per district.
  aid    State aid certification (TEEOSA), the current year only: "State Aid Calculated by System" (A1: CoDistSch,
         FormulaNeed, Local, OptionFunding, IncomeTaxRebate, OtherReceipts, FoundationIn, TotalResources,
         Found(d)ationOut, EqAid, CalcSA) and "Formula Students in Ascending Order" (A3: agencyid, formulastudents, adjgfoe).
  pta    Property tax request authority certification (2023/24 on): AgencyID, tax askings, total revenue, base growth,
         revenue cap, prior years' unused authority, the authority, the 70% board-vote extra.
  budget Certified budget authority and allowable reserve percentage (budget factors), the current year: authority, method
         (B budget, SGA student growth, F formula needs), reserve %, and the data components (formula need, last year's General
         Fund budget, special grants, special education, lid exclusions, adjusted expenditures, unused budget authority).
  lc2    NDE's statewide LC-2 budget submission totals (sfos.education.ne.gov/FOS/Data/lc2-YYYY.xls), the adopted year: each
         district's General Fund and Special Building property tax requests, budget authority and the adopted budget, unused
         budget and property tax authority, levy overrides, certified valuation and reserves.
  afr    each district's Annual Financial Report page on sfos.education.ne.gov (AFR/AFRDistrict.aspx), every account
         and total (01-1-10000-000 GRAND TOTAL OF ALL RECEIPTS, 01-2-20400-000 TOTAL GENERAL FUND EXPENDITURES,
         08-0-CSHOH-END ...), the newest --afr-years years (default 3). Then refreshes the peer measures.

Layouts VERIFIED 2026-11-12 against the 2021/22-2025/26 StatInfo .xls files, the 2020/21 .xlsx, the 2026/27 A1 and A3
files, the 2024/25-2026/27 PTA certifications and the 2024/25 AFR page. The .xls files are read by this file's own
small reader, so it needs only Python 3.9+, openpyxl and psql. Uses DATABASE_URL: never put the password in a file.
Fiscal years are named for the year they end: 2025/26 = 2026. Public reports only; no student-level data.
"""
import argparse, csv, hashlib, html, io, os, re, struct, subprocess, sys, tempfile, time, urllib.request

NDE = "https://www.education.ne.gov"
PAGES = {
    "stat": NDE + "/fos/statistical-information-for-public-school-districts-levy-and-valuation-information/",
    "aid": NDE + "/fos/state-aid/",
    "pta": NDE + "/fos/budgeting-school-district/property-tax-authority/",
    "budget": NDE + "/fos/budget-factors/",
    "lc2": "https://sfos.education.ne.gov/",
}
AFR_URL = "https://sfos.education.ne.gov/AFR/AFRDistrict.aspx?codistsch={agency}&datayear={dy}&id=1"
UA = {"User-Agent": "HighGround public-data loader (Willow Holler; support@willowholler.com)"}
AGENCY = re.compile(r"^\d{2}-\d{4}-\d{3}$")
FIRST_STAT_FY = 2018


def fetch(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1:
                raise SystemExit(f"Couldn't download {url}: {e!r}. Download the file by hand and run with --file kind=path.")
            time.sleep(5 * (k + 1))


def links(page_html, base=NDE):
    """[(text, absolute url)] for every link on an NDE page."""
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page_html, flags=re.I | re.S):
        u, t = html.unescape(m.group(1)), re.sub(r"<[^>]+>", "", html.unescape(m.group(2))).strip()
        out.append((t, u if u.startswith("http") else base + ("" if u.startswith("/") else "/") + u))
    return out


def school_year_fy(s):
    """'2025/26', '2025/2026', '2526', '20252026' -> 2026."""
    s = str(s)
    m = re.search(r"(20\d\d)\s*[/-]\s*(\d{2}|20\d\d)(?!\d)", s)
    if m:
        return int(m.group(1)) + 1
    m = re.search(r"(20\d\d)(20\d\d)", s)
    if m:
        return int(m.group(2))
    m = re.search(r"(?<!\d)(\d\d)-?(\d\d)(?!\d)", s)
    if m and int(m.group(2)) == (int(m.group(1)) + 1) % 100:
        return 2000 + int(m.group(2))
    return None


def find_files(kind):
    """[(fy, file_name, url, part)] newest first; part is 'a1'/'a3' for aid."""
    page = fetch(PAGES[kind]).decode("utf-8", "replace")
    out = []
    for text, u in links(page, base=re.match(r"https://[^/]+", PAGES[kind]).group(0)):
        name = u.rsplit("/", 1)[-1]
        if kind == "stat" and re.search(r"\.xlsx?$", u, flags=re.I):
            fy = school_year_fy(text) or school_year_fy(name)
            if fy and fy >= FIRST_STAT_FY:
                out.append((fy, name, u, "stat"))
        elif kind == "aid" and re.search(r"\.xlsx$", u, flags=re.I):
            m = re.match(r"(\d\d)(\d\d)SA_(A1|A2|A3)", name, flags=re.I)
            if m:
                out.append((2000 + int(m.group(2)), name, u, m.group(3).lower()))
        elif kind == "aid" and re.search(r"CalcOfPriorYearCorr.*\.pdf$", name, flags=re.I):
            m = re.match(r"(\d\d)(\d\d)SA_", name, flags=re.I)
            if m:
                out.append((2000 + int(m.group(2)), name, u, "pyc"))
        elif kind == "lc2" and re.search(r"lc2-(\d\d)(\d\d)\.xlsx?$", u, flags=re.I):
            m = re.search(r"lc2-(\d\d)(\d\d)\.xlsx?$", u, flags=re.I)
            out.append((2000 + int(m.group(2)), name, u, "lc2"))
        elif kind == "budget" and re.search(r"\.xlsx$", u, flags=re.I) and re.search(r"BudgetAuthority", name, flags=re.I):
            m = re.match(r"(\d\d)(\d\d)", name)
            if m:
                out.append((2000 + int(m.group(2)), name, u, "budget"))
        elif kind == "pta" and re.search(r"\.xlsx$", u, flags=re.I) and re.search(r"P(roperty)?T(ax)?A?(uth|uthority)?.*Cert", name, flags=re.I):
            m = re.match(r"(\d\d)(\d\d)", name)
            if m:
                out.append((2000 + int(m.group(2)), name, u, "pta"))
    seen, uniq = set(), []
    for f in sorted(out, key=lambda f: (f[0], f[3]), reverse=True):
        if (f[0], f[3]) not in seen:
            seen.add((f[0], f[3])); uniq.append(f)
    if kind == "aid":   # only the newest certification: older ones live on another page in other layouts
        top = max((f[0] for f in uniq), default=None)
        uniq = [f for f in uniq if f[0] == top]
    return uniq


# ---------------------------------------------------------------- spreadsheets
def read_xlsx(path):
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}


def read_xls(path):
    """A small reader for Excel 97-2003 (.xls, BIFF8) files: {sheet: rows}. Text, numbers and RK numbers only."""
    b = open(path, "rb").read()
    if b[:8] != bytes.fromhex("d0cf11e0a1b11ae1"):
        raise ValueError(f"{path}: not an Excel 97-2003 file")
    u16 = lambda o: struct.unpack_from("<H", b, o)[0]
    i32 = lambda o: struct.unpack_from("<i", b, o)[0]
    ss = 1 << u16(30)
    sec = lambda n: 512 + n * ss
    difat = [v for v in (i32(76 + 4 * i) for i in range(109)) if v >= 0]
    nd = i32(68)
    while nd >= 0:
        difat += [v for v in (i32(sec(nd) + 4 * i) for i in range(ss // 4 - 1)) if v >= 0]
        nd = i32(sec(nd) + ss - 4)
    fat = [i32(sec(s) + 4 * i) for s in difat for i in range(ss // 4)]

    def chain(s):
        o = []
        while s >= 0 and len(o) < 10 ** 6:
            o.append(s); s = fat[s]
        return o

    stream = None
    for s in chain(i32(48)):
        for k in range(ss // 128):
            o = sec(s) + 128 * k
            nl = u16(o + 64)
            name = b[o:o + max(nl - 2, 0)].decode("utf-16-le", "replace")
            if name.lower() in ("workbook", "book"):
                start, size = i32(o + 116), struct.unpack_from("<I", b, o + 120)[0]
                stream = b"".join(b[sec(x):sec(x) + ss] for x in chain(start))[:size]
    if stream is None:
        raise ValueError(f"{path}: no Workbook stream")
    S = stream
    recs, o = [], 0
    while o + 4 <= len(S):
        t, l = struct.unpack_from("<HH", S, o)
        recs.append((t, o + 4, l)); o += 4 + l

    sst = []
    si = next((k for k, r in enumerate(recs) if r[0] == 0xFC), None)
    if si is not None:
        segs = [recs[si]] + [r for r in _takewhile(lambda r: r[0] == 0x3C, recs[si + 1:])]
        seg, p = 0, segs[0][1] + 8
        end = lambda: segs[seg][1] + segs[seg][2]
        n = struct.unpack_from("<I", S, segs[0][1] + 4)[0]
        for _ in range(n):
            if p >= end():
                seg += 1; p = segs[seg][1]
            cc = struct.unpack_from("<H", S, p)[0]; p += 2
            f = S[p]; p += 1
            rt = sz = 0
            if f & 8:
                rt = struct.unpack_from("<H", S, p)[0]; p += 2
            if f & 4:
                sz = struct.unpack_from("<i", S, p)[0]; p += 4
            parts, got = [], 0
            while got < cc:
                if p >= end():
                    seg += 1; p = segs[seg][1]; f = S[p]; p += 1
                w = 2 if f & 1 else 1
                take = min((end() - p) // w, cc - got)
                parts.append(S[p:p + take * w].decode("utf-16-le" if w == 2 else "latin-1"))
                p += take * w; got += take
            skip = rt * 4 + sz
            while skip > 0:
                if p >= end():
                    seg += 1; p = segs[seg][1]
                t = min(skip, end() - p); p += t; skip -= t
            sst.append("".join(parts))

    def rk(x):
        if x & 2:
            v = x >> 2
            if v & (1 << 29):
                v -= 1 << 30
        else:
            v = struct.unpack("<d", struct.pack("<II", 0, x & 0xFFFFFFFC))[0]
        return v / 100 if x & 1 else v

    names = []
    for t, o, l in recs:
        if t == 0x85:
            n, f = S[o + 6], S[o + 7]
            names.append(S[o + 8:o + 8 + n * (2 if f & 1 else 1)].decode("utf-16-le" if f & 1 else "latin-1"))
    sheets, cur, bofs = {}, None, 0
    for t, o, l in recs:
        if t == 0x809:
            bofs += 1
            if bofs > 1:
                cur = {}; sheets[names[len(sheets)] if len(sheets) < len(names) else f"Sheet{len(sheets) + 1}"] = cur
            continue
        if cur is None:
            continue
        if t == 0xFD:
            r, c, _, k = struct.unpack_from("<HHHI", S, o); cur[(r, c)] = sst[k]
        elif t == 0x203:
            r, c, _, v = struct.unpack_from("<HHHd", S, o); cur[(r, c)] = v
        elif t == 0x27E:
            r, c, _, x = struct.unpack_from("<HHHI", S, o); cur[(r, c)] = rk(x)
        elif t == 0xBD:
            r, c0 = struct.unpack_from("<HH", S, o)
            for j in range((l - 6) // 6):
                cur[(r, c0 + j)] = rk(struct.unpack_from("<I", S, o + 4 + 6 * j + 2)[0])
        elif t == 0x204:
            r, c, _, n = struct.unpack_from("<HHHH", S, o); f = S[o + 8]
            cur[(r, c)] = S[o + 9:o + 9 + n * (2 if f & 1 else 1)].decode("utf-16-le" if f & 1 else "latin-1")
    out = {}
    for name, cells in sheets.items():
        nr = max((r for r, _ in cells), default=-1) + 1
        nc = max((c for _, c in cells), default=-1) + 1
        rows = [[None] * nc for _ in range(nr)]
        for (r, c), v in cells.items():
            rows[r][c] = v
        out[name] = rows
    return out


def _takewhile(pred, it):
    for x in it:
        if not pred(x):
            return
        yield x


def read_book(path):
    with open(path, "rb") as f:
        head = f.read(8)
    if head.startswith(b"PK"):
        return read_xlsx(path)
    if head == bytes.fromhex("d0cf11e0a1b11ae1"):
        return read_xls(path)
    raise ValueError(f"{os.path.basename(path)}: not a spreadsheet (the download may have been a web page)")


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("$", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s in ("", "-", "—"):
        return None
    try:
        return -float(s) if neg else float(s)
    except ValueError:
        return None


def norm(v):
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


# ---------------------------------------------------------------- parsers (each returns plain dicts; tested in nebraska_loader_test.py)
STAT_COLS = [("gen_levy", "general"), ("bond_levy", "bond"), ("sb_levy", "building"), ("qcpuf_levy", "qualified"),
             ("total_levy", "total"), ("valuation", "valuation"), ("mem_pk", "pk"), ("mem_k12", "k-12"), ("mem_total", "total")]


def parse_stat(book, fy_hint=None):
    """-> (fy, {agency: {...}}). Handles the printed .xls report and the 2020/21 .xlsx table."""
    rows = next(iter(book.values()))
    head = [norm(c) for c in (rows[0] if rows else [])]
    if "codistsch" in head:                              # 2020/21: a plain table
        ix = {h: i for i, h in enumerate(head)}
        out, fy = {}, fy_hint
        for r in rows[1:]:
            a = str(r[ix["codistsch"]] or "").strip()
            if not AGENCY.match(a):
                continue
            g = lambda k: num(r[ix[k]]) if k in ix and ix[k] < len(r) else None
            fy = fy or school_year_fy(r[ix["datayear"]] if "datayear" in ix else "")
            out[a] = {"name": str(r[ix["name"]]).strip(), "county": str(r[ix.get("countyname", 0)] or "").strip().title(),
                      "class": str(r[ix["class"]]).strip().split(".")[0], "valuation": g("val"), "gen_levy": g("genlev"),
                      "bond_levy": g("bondlev"), "sb_levy": g("sinklev"), "qcpuf_levy": g("qculev") if "qculev" in ix else g("qcpulev"),
                      "total_levy": None, "mem_pk": g("mem_pk"), "mem_k12": g("mem_k12"), "mem_total": g("mem_total")}
            v = out[a]
            v["total_levy"] = sum(x or 0 for x in (v["gen_levy"], v["bond_levy"], v["sb_levy"], v["qcpuf_levy"]))
        return fy, out
    hi = next((i for i, r in enumerate(rows) if r and any(norm(c) == "agency id" for c in r)), None)
    if hi is None:
        raise ValueError("StatInfo: no 'Agency ID' header row")
    title = " ".join(str(c) for r in rows[:hi] for c in (r or []) if c)
    fy = school_year_fy(re.search(r"(20\d\d/20\d\d|20\d\d/\d\d)", title).group(1)) if re.search(r"20\d\d/\d\d", title) else fy_hint
    hdr = rows[hi]
    hcols = {i: norm(c) for i, c in enumerate(hdr) if c not in (None, "")}
    agency_col = next(i for i, h in hcols.items() if h == "agency id")
    name_col = next((i for i, h in hcols.items() if h == "school district"), 2)
    class_col = next((i for i, h in hcols.items() if h == "code"), None)
    # the levy/valuation/membership headers, left to right; 'total' appears twice (total levy, then total membership)
    wanted, used, cols = list(STAT_COLS), set(), {}
    for key, label in wanted:
        c = next((i for i in sorted(hcols) if hcols[i] == label and i not in used and i > agency_col), None)
        if c is not None:
            used.add(c); cols[key] = c
    hset = set(hcols)

    def pick(r, c):
        for k in (c, c - 1, c + 1):          # the report merges cells, so a value can sit one column off its header
            if k != c and k in hset:
                continue
            if 0 <= k < len(r) and num(r[k]) is not None:
                return num(r[k])
        return None

    out, county = {}, None
    for r in rows[hi + 1:]:
        if not r:
            continue
        cells = [c for c in r if c not in (None, "")]
        a = str(r[agency_col] if agency_col < len(r) else "").strip()
        if not AGENCY.match(a):
            m = re.match(r"^\s*([A-Z][A-Z .'-]+?)\s*\(\s*\d+\s*\)", str(cells[0]) if cells else "")
            if m and len(cells) == 1:
                county = m.group(1).strip().title()
            continue
        v = {"name": str(r[name_col]).strip(), "county": county,
             "class": str(r[class_col]).strip().split(".")[0] if class_col is not None and class_col < len(r) and r[class_col] is not None else None}
        for key, c in cols.items():
            v[key] = pick(r, c)
        out[a] = v
    return fy, out


A1_COLS = {"formula_need": "formulaneed", "local_effort": "local", "option_funding": "optionfunding", "income_tax": "incometaxrebate",
           "other_receipts": "otherreceipts", "foundation_in": "foundationin", "total_resources": "totalresources",
           "foundation_out": ("foundationout", "founddationout"), "eq_aid": "eqaid", "calc_aid": "calcsa"}


def parse_a1(book):
    rows = next(iter(book.values()))
    hi = next(i for i, r in enumerate(rows) if r and any(norm(c) == "codistsch" for c in r))
    ix = {norm(c): i for i, c in enumerate(rows[hi]) if c}
    out = {}
    for r in rows[hi + 1:]:
        a = str(r[ix["codistsch"]] or "").strip() if r else ""
        if not AGENCY.match(a):
            continue
        v = {}
        for key, h in A1_COLS.items():
            i = next((ix[x] for x in ((h,) if isinstance(h, str) else h) if x in ix), None)
            v[key] = num(r[i]) if i is not None and i < len(r) else None
        out[a] = v
    return out


A2_COLS = {"basic_funding": "basic funding", "sga": "student growth adjustment", "sgacorr": "student growth correction",
           "poverty_allowance": "poverty allowance", "lep_allowance": "lep allowance"}


def parse_a2(book):
    """Formula Needs Components (A2): basic funding, the student growth adjustment and its correction, by district"""
    rows = next(iter(book.values()))
    hi = next(i for i, r in enumerate(rows) if r and any("county /district number" in norm(c) or norm(c) == "codistsch" for c in r))
    hdr = [norm(c) for c in rows[hi]]
    ix = {k: next((i for i, h in enumerate(hdr) if h == lab), None) for k, lab in A2_COLS.items()}
    out = {}
    for r in rows[hi + 1:]:
        a = str(r[0] or "").strip() if r else ""
        if AGENCY.match(a):
            out[a] = {k: (num(r[i]) if i is not None and i < len(r) else None) for k, i in ix.items()}
    return out


LC2_COLS = [   # NDE's statewide LC-2 budget submission totals (sfos.education.ne.gov/FOS/Data/lc2-YYYY.xls), by header text
    ("budget_authority", lambda h: h == "certified budget authority"),
    ("unused_access", lambda h: h.startswith("access to prior year")),
    ("total_allowable", lambda h: h == "total allowable budget authority"),
    ("gf_budget", lambda h: h.endswith("general fund budget of disbursements & transfers") and not h.startswith("total")),
    ("sgf", lambda h: h.endswith("special grant funds")),
    ("sped", lambda h: "special education budget" in h),
    ("gfle", lambda h: h.endswith("general fund lid exclusions")),
    ("adj_budget", lambda h: h.startswith("total adjusted general fund budget")),
    ("unused_budget", lambda h: h == "total unused budget authority"),
    ("budget_vote", lambda h: h.startswith("budget authority increase approved by the voters")),
    ("override_on", lambda h: h.startswith("did you hold a successful election of your patrons for a levy override")),
    ("override_levy", lambda h: h.startswith("total property tax levy approved by the patrons")),
    ("override_years", lambda h: h.startswith("number of years the levy override")),
    ("override_first", lambda h: h.startswith("what was the first year this levy override")),
    ("override_last", lambda h: h.startswith("what year will this levy override")),
    ("valuation", lambda h: h == "certified assessed valuation"),
    ("reserve_pct", lambda h: h.endswith("applicable allowable reserve percentage")),
    ("gf_reserve", lambda h: h.endswith("general fund necessary cash reserve")),
    ("depreciation_req", lambda h: h.endswith("depreciation fund total requirements")),
    ("eb_reserve", lambda h: h.endswith("employee benefit fund necessary cash reserve")),
    ("pta", lambda h: re.match(r"^\d{4}/\d\d property tax request authority$", h)),
    ("board_vote", lambda h: h.startswith("did 70% of the school board approve")),
    ("board_extra", lambda h: h.startswith("enter the amount approved by the school board") or h.startswith("list the additional increase approved by the school board")),
    ("pta_vote", lambda h: h.startswith("enter the total property tax request authority increase approved") or h.startswith("list the total property tax request authority increase approved")),
    ("gf_request", lambda h: h.endswith("property tax request general fund")),
    ("sb_request", lambda h: h.endswith("property tax request special building fund")),
    ("total_request", lambda h: re.match(r"^\d{4}/\d\d total property tax request$", h)),
    ("unused_pta", lambda h: h.endswith("unused property tax request authority")),
    ("ov_authority", lambda h: h.startswith("additional property tax authority due to successful levy override")),
]


def yes(v):
    """1 / 'Yes' / 'Y' -> 1.0, 0 / 'No' -> 0.0"""
    if isinstance(v, str) and v.strip().lower() in ("yes", "y", "no", "n"):
        return 1.0 if v.strip().lower().startswith("y") else 0.0
    return num(v)


def override_fy(v, first):
    """The LC-2's levy override years as HighGround fiscal years (the year a school year ends). NDE's 2023/24 file wrote them as
    school years ('2023/24' to '2027/28'); later files as years (2023 to 2028, with 'Number of years' 5). The two match only if a
    plain first year is the year the school year starts and a plain expiry year is the year the last school year ends."""
    if v is None or v == "":
        return None
    if isinstance(v, str) and re.search(r"20\d\d\s*[/-]", v):
        return school_year_fy(v)
    y = num(v)
    if y is None or not 1990 < y < 2100:
        return None
    return int(y) + (1 if first else 0)


def parse_lc2(book):
    """-> (fy, {agency: {...}}): the adopted budget's General Fund and Special Building property tax requests, budget authority,
    unused authority, levy overrides, valuation and reserves, for every district"""
    rows = next(iter(book.values()))
    # newer files head the agency column "District Number"; NDE's 2023/24 file leaves it blank above a row of codes
    # ("AgencyID", "A-101", ...), so the row of descriptions is found by its first description too
    hi = next((i for i, r in enumerate(rows) if r and norm(r[0]) == "district number"), None)
    if hi is None:
        hi = next((i for i, r in enumerate(rows) if r and any(norm(c) == "certified budget authority" for c in r)), None)
    if hi is None:
        raise ValueError("not laid out like NDE's LC-2 totals (no 'District Number' or 'Certified Budget Authority' heading)")
    hdr = [norm(c) for c in rows[hi]]
    cols = {}
    for key, test in LC2_COLS:
        i = next((i for i, h in enumerate(hdr) if h and i not in cols.values() and test(h)), None)
        if i is not None:
            cols[key] = i
    fy = school_year_fy(" ".join(str(c) for r in rows[:hi + 1] for c in (r or []) if c))
    out = {}
    for r in rows[hi + 1:]:
        a = str(r[0] or "").strip() if r else ""
        if AGENCY.match(a):
            v = {k: num(r[i]) if i < len(r) else None for k, i in cols.items()}
            for k in ("override_on", "board_vote"):
                if k in cols:
                    v[k] = yes(r[cols[k]]) if cols[k] < len(r) else None
            for k in ("override_first", "override_last"):
                if k in cols:
                    v[k] = override_fy(r[cols[k]] if cols[k] < len(r) else None, k == "override_first")
            out[a] = v
    return fy, out


def pdf_lines(path):
    """The text of a PDF, line by line, laid out as printed (poppler's pdftotext; the workflow installs poppler-utils)."""
    try:
        r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        raise RuntimeError(f"pdftotext couldn't read {os.path.basename(path)}: {e}")
    return r.stdout.decode("utf-8", "replace").splitlines()


def parse_pyc(lines):
    """NDE's 'Calculation of Prior Year Correction' (a PDF): last year's certified aid, last year recalculated with final data,
    and the difference, paid or taken back with this year's aid (79-1065). A row counts only if the three agree."""
    out = {}
    for ln in lines:
        m = re.search(r"\b(\d\d-\d{4}-\d{3})\b", ln)
        if not m:
            continue
        rest = ln[:m.start()] + " " + ln[m.end():]
        nums = [num(x) for x in re.findall(r"\(\s*[\d,]+\s*\)|-?\d[\d,]*", rest)]
        nums = [x for x in nums if x is not None]
        if len(nums) < 3:
            continue
        cert, recalc, corr = nums[-3:]
        if abs(recalc - cert - corr) <= 1:
            out[m.group(1)] = {"prior_cert_aid": cert, "prior_recalc_aid": recalc, "prior_year_corr": corr}
    return out


def parse_a3(book):
    rows = next(iter(book.values()))
    hi = next(i for i, r in enumerate(rows) if r and any(norm(c) == "agencyid" for c in r))
    ix = {norm(c): i for i, c in enumerate(rows[hi]) if c}
    out = {}
    for r in rows[hi + 1:]:
        a = str(r[ix["agencyid"]] or "").strip() if r else ""
        if AGENCY.match(a):
            out[a] = {"formula_students": num(r[ix["formulastudents"]]), "adj_gfoe": num(r[ix["adjgfoe"]]) if "adjgfoe" in ix else None,
                      "cert_fy": school_year_fy(r[ix["certyear"]]) if "certyear" in ix else None}
    return out


PTA_COLS = [   # (key, test on the normalised header)
    ("gf_ask", lambda h: h.startswith("general fund tax asking")),
    ("sb_ask", lambda h: h.startswith("special bldg tax asking")),
    ("total_request", lambda h: re.search(r"total property tax request$", h)),
    ("total_revenue", lambda h: h.startswith("total revenue") or h.startswith("total property tax & non-property")),
    ("g_member", lambda h: h.startswith("basic growth %") and "membership" in h),
    ("g_lep", lambda h: h.startswith("basic growth %") and h.endswith("lep")),
    ("g_poverty", lambda h: h.startswith("basic growth %") and "poverty" in h),
    ("base_growth_rate", lambda h: h.startswith("total base growth rate")),
    ("revenue_cap", lambda h: h.startswith("revenue cap")),
    ("prior_unused", lambda h: h.startswith("prior years unused")),
    ("authority", lambda h: re.match(r"^\d{4}/\d\d property tax (request )?authority", h) and "including board" not in h),
    ("board_pct", lambda h: h.startswith("additional base growth")),
    ("board_extra", lambda h: h.startswith("additional property tax authority") or h.startswith("amount of additional")),
    ("authority_with_board", lambda h: "including board approved" in h),
]


def parse_pta(book):
    """-> (fy, {agency: {...}})"""
    rows = next(iter(book.values()))
    hi = next(i for i, r in enumerate(rows) if r and any(norm(c) == "agencyid" for c in r))
    hdr = [norm(c) for c in rows[hi]]
    cols = {}
    for key, test in PTA_COLS:
        i = next((i for i, h in enumerate(hdr) if h and i not in cols.values() and test(h)), None)
        if i is not None:
            cols[key] = i
    fy = None
    if "authority_with_board" in cols:
        fy = school_year_fy(hdr[cols["authority_with_board"]])
    if fy is None:
        fy = school_year_fy(" ".join(str(c) for r in rows[:hi] for c in (r or []) if c))
    out = {}
    for r in rows[hi + 1:]:
        a = str(r[hdr.index("agencyid")] or "").strip() if r else ""
        if AGENCY.match(a):
            out[a] = {k: num(r[i]) if i < len(r) else None for k, i in cols.items()}
    return fy, out


BUDGET_COLS = [   # NDE "Budget Authority and Allowable Reserve Percentage" (budget factors), sheet "Data Components"
    ("formula_need", lambda h: h.endswith("formula needs")),
    ("gfbe", lambda h: "general fund budget of expenditures" in h),
    ("sgf", lambda h: h.endswith("special grant funds")),
    ("sped", lambda h: "special education budget" in h),
    ("gfle", lambda h: "lid exclusions" in h),
    ("adjusted", lambda h: h.endswith("adjusted expenditures") and not h.startswith("2%")),
    ("two_pct", lambda h: h.startswith("2%")),
    ("unused", lambda h: "unused budget authority" in h),
    ("sga", lambda h: h.endswith("student growth adjustment")),
    ("sgacorr", lambda h: h.endswith("student growth correction")),
]


def parse_budget(book):
    """-> (fy, {agency: {authority, method, reserve_pct, formula_need, gfbe, sgf, sped, gfle, adjusted, two_pct, unused, sga, sgacorr}})"""
    out, fy = {}, None
    for name, rows in book.items():
        hi = next((i for i, r in enumerate(rows) if r and any(norm(c).replace(" ", "").startswith("county/districtnumber") for c in r)), None)
        if hi is None:
            continue
        hdr = [norm(c) for c in rows[hi]]
        title = " ".join(str(c) for r in rows[:hi + 1] for c in (r or []) if c)
        fy = fy or school_year_fy(title)
        if "data component" in norm(name):
            cols = {}
            for key, test in BUDGET_COLS:
                i = next((i for i, h in enumerate(hdr) if h and i not in cols.values() and test(h)), None)
                if i is not None:
                    cols[key] = i
        else:
            cols = {"authority": next((i for i, h in enumerate(hdr) if "budget authority" in h), None),
                    "method": next((i for i, h in enumerate(hdr) if h == "method"), None),
                    "reserve_pct": next((i for i, h in enumerate(hdr) if "reserve" in h), None)}
            cols = {k: v for k, v in cols.items() if v is not None}
        for r in rows[hi + 1:]:
            a = str(r[0] or "").strip() if r else ""
            if not AGENCY.match(a):
                continue
            v = out.setdefault(a, {})
            for k, i in cols.items():
                if i < len(r):
                    v[k] = str(r[i]).strip() if k == "method" and r[i] is not None else num(r[i])
    return fy, out


def parse_afr(page_html):
    """-> {agency, name, class, fy, accounts: [(account, description, amount)]} from an AFRDistrict.aspx page."""
    def span(id_):
        m = re.search(r'id="MainContent_DistrictHeader1_' + id_ + r'"[^>]*>(.*?)</span>', page_html, flags=re.S)
        return html.unescape(m.group(1)).strip() if m else None
    agency, dy = span("lblCodistsch"), span("lblDatayear")
    m = re.search(r'<table[^>]*id="MainContent_tblResults".*?</table>', page_html, flags=re.S)
    accts = []
    if m:
        for tr in re.finditer(r"<tr\b.*?</tr>", m.group(0), flags=re.S):
            tds = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<td\b[^>]*>(.*?)</td>", tr.group(0), flags=re.S)]
            if len(tds) == 3 and re.match(r"^\d{2}-[0-9]-[0-9A-Z]{5}-", tds[0]):
                accts.append((tds[0], tds[1], num(tds[2])))
    return {"agency": agency, "name": span("lblName"), "class": span("lblClass"), "fy": school_year_fy(dy or ""), "accounts": accts}


# ---------------------------------------------------------------- database
def psql(db, sql):
    r = subprocess.run(["psql", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA"], input="set statement_timeout = 0;\n" + sql,
                       text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("psql failed:\n" + r.stderr)
    return r.stdout.strip()


def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def unchanged(db, kind, years, digest):
    return bool(psql(db, f"select 1 from public.ne_load_run where kind = {lit(kind)} and years = {lit(years)} "
                         f"and sha256 = {lit(digest)} and status = 'ok' limit 1;"))


def write_csv(path, rows):
    with open(path, "w", newline="") as o:
        csv.writer(o).writerows(rows)


def upsert(db, kind, name, years, digest, rows_read, csvp, table, cols, keys, where):
    collist = ", ".join(cols)
    sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in keys)
    n = psql(db, f"""create temp table _t as select {collist} from public.{table} limit 0;
\\copy _t ({collist}) from '{csvp}' with (format csv, null '')
begin;
delete from public.{table} where {where};
insert into public.{table} ({collist}) select t.* from _t t join public.ne_district d on d.agency_id = t.agency_id
  on conflict ({", ".join(keys)}) do update set {sets};
insert into public.ne_load_run (kind, source_url, sha256, rows_read, rows_loaded, years, status)
select {lit(kind)}, {lit(name)}, {lit(digest)}, {rows_read}, count(*), {lit(years)}, 'ok' from public.{table} where {where};
commit;
select count(*) from public.{table} where {where};""").splitlines()[-1]
    return int(n)


def upsert_districts(db, work, districts):
    p = os.path.join(work, "districts.csv")
    write_csv(p, [[a, v["name"], v.get("county"), v.get("class")] for a, v in districts.items()])
    psql(db, f"""create temp table _d (agency_id text, name text, county text, class text);
\\copy _d from '{p}' with (format csv, null '')
insert into public.ne_district (agency_id, name, county, class) select agency_id, name, county, class from _d
  on conflict (agency_id) do update set name = excluded.name, county = coalesce(excluded.county, ne_district.county),
  class = coalesce(excluded.class, ne_district.class), loaded_at = now();""")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["stat", "aid", "pta", "budget", "lc2", "afr"], action="append")
    ap.add_argument("--file", action="append", default=[], help="kind[FY]=path: stat2026=2526_StatInfo.xls, aid=A1.xlsx, aid_a3=A3.xlsx, pta=PTA.xlsx, budget=2627BudgetAuthorityCertifiedC.xlsx, lc2=lc2-2627.xls, aid_a2=A2.xlsx, aid_pyc=2627SA_CalcOfPriorYearCorr.pdf, afr=page.html")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--afr-years", type=int, default=3)
    ap.add_argument("--afr-limit", type=int, default=0, help="only the first N districts (to try it out)")
    ap.add_argument("--afr-pause", type=float, default=0.5, help="seconds between AFR pages (be polite)")
    a = ap.parse_args()
    db = os.environ.get("DATABASE_URL")
    if not db and not a.dry_run:
        raise SystemExit("Set DATABASE_URL (or use --dry-run).")
    kinds = a.only or ["stat", "aid", "pta", "budget", "lc2", "afr"]
    work = tempfile.mkdtemp(prefix="nde_")
    local = {}
    for x in a.file:
        k, p = x.split("=", 1)
        m = re.fullmatch(r"(stat|aid|aid_a2|aid_a3|aid_pyc|pta|budget|lc2|afr)(\d{4})?", k)
        if not m:
            raise SystemExit(f"--file {x}: use stat=, aid=, aid_a2=, aid_a3=, aid_pyc=, pta=, budget=, lc2= or afr= (optionally with a year, stat2026=)")
        kind = "aid" if m.group(1).startswith("aid") else m.group(1)
        part = {"aid": "a1", "aid_a2": "a2", "aid_a3": "a3", "aid_pyc": "pyc"}.get(m.group(1), m.group(1))
        local.setdefault(kind, []).append((int(m.group(2)) if m.group(2) else None, os.path.basename(p), p, part))

    if a.file and not a.only:   # files given by hand: load just those kinds
        kinds = [k for k in ["stat", "aid", "pta", "budget", "lc2", "afr"] if k in local]

    def get(src, name):
        if not src.startswith("http"):
            return src
        p = os.path.join(work, re.sub(r"[^\w.-]+", "_", name))
        open(p, "wb").write(fetch(src))
        return p

    stat_years = []
    for kind in [k for k in ("stat", "aid", "pta", "budget", "lc2") if k in kinds]:
        files = local.get(kind) if a.file else find_files(kind)
        if not files:
            print(f"{kind}: no files found", flush=True); continue
        if kind == "aid":
            a1 = next((f for f in files if f[3] == "a1"), None)
            a3 = next((f for f in files if f[3] == "a3"), None)
            a2 = next((f for f in files if f[3] == "a2"), None)
            if not a1:
                print("aid: no A1 file", flush=True); continue
            p1 = get(a1[2], a1[1]); aid = parse_a1(read_book(p1))
            digest = hashlib.sha256(open(p1, "rb").read()).hexdigest()
            stu = {}
            if a3:
                p3 = get(a3[2], a3[1]); stu = parse_a3(read_book(p3))
                digest = hashlib.sha256((digest + hashlib.sha256(open(p3, "rb").read()).hexdigest()).encode()).hexdigest()
            pyc = {}
            fp = next((f for f in files if f[3] == "pyc"), None)
            if fp:
                try:
                    pp = get(fp[2], fp[1]); pyc = parse_pyc(pdf_lines(pp))
                    digest = hashlib.sha256((digest + hashlib.sha256(open(pp, "rb").read()).hexdigest()).encode()).hexdigest()
                    print(f"aid: prior year correction for {len(pyc)} districts ({fp[1]})", flush=True)
                except RuntimeError as e:
                    print(f"aid: prior year correction skipped: {e}", flush=True)
            comp = {}
            if a2:
                p2 = get(a2[2], a2[1]); comp = parse_a2(read_book(p2))
                digest = hashlib.sha256((digest + hashlib.sha256(open(p2, "rb").read()).hexdigest()).encode()).hexdigest()
            fy = a1[0] or next((v["cert_fy"] for v in stu.values() if v.get("cert_fy")), None)
            if not fy:
                raise SystemExit(f"{a1[1]}: say which year, e.g. --file aid2027=...")
            PYC = ["prior_cert_aid", "prior_recalc_aid", "prior_year_corr"]
            cols = ["agency_id", "fiscal_year"] + list(A1_COLS) + ["formula_students", "adj_gfoe"] + list(A2_COLS) + PYC + ["source"]
            csvp = os.path.join(work, f"aid_{fy}.csv")
            write_csv(csvp, [[ag, fy] + [v[k] for k in A1_COLS] + [stu.get(ag, {}).get("formula_students"), stu.get(ag, {}).get("adj_gfoe")]
                             + [comp.get(ag, {}).get(k) for k in A2_COLS] + [pyc.get(ag, {}).get(k) for k in PYC] + [f"NDE {fy - 1}/{str(fy)[2:]} state aid certification"] for ag, v in aid.items()])
            print(f"aid {fy}: {len(aid)} districts, {len(stu)} with formula students ({a1[1]})", flush=True)
            if a.dry_run:
                for ag in list(aid)[:2]:
                    print("   ", ag, aid[ag], stu.get(ag), comp.get(ag))
                continue
            if not a.force and unchanged(db, "aid", str(fy), digest):
                print(f"aid {fy}: unchanged, skipped", flush=True); continue
            n = upsert(db, "aid", a1[1], str(fy), digest, len(aid), csvp, "ne_aid", cols, ["agency_id", "fiscal_year"], f"fiscal_year = {fy}")
            print(f"aid {fy}: loaded {n}", flush=True)
            continue
        for fy, name, src, part in files:
            p = get(src, name)
            digest = hashlib.sha256(open(p, "rb").read()).hexdigest()
            book = read_book(p)
            if kind == "stat":
                fy2, data = parse_stat(book, fy)
                fy = fy or fy2
                stat_years.append(fy)
                cols = ["agency_id", "fiscal_year", "valuation", "gen_levy", "bond_levy", "sb_levy", "qcpuf_levy", "total_levy",
                        "mem_pk", "mem_k12", "mem_total", "source"]
                rows = [[ag, fy] + [v.get(c) for c in cols[2:8]] + [int(v[c]) if v.get(c) is not None else None for c in cols[8:11]]
                        + [f"NDE Statistical Information {fy - 1}/{str(fy)[2:]}"] for ag, v in data.items()]
                table = "ne_stat"
            elif kind == "lc2":
                try:
                    fy2, data = parse_lc2(book)
                except (ValueError, StopIteration) as e:
                    if name != files[0][1]:   # an older year in a layout this reader doesn't know: skip it, keep the rest
                        print(f"lc2: {name} skipped ({e})", flush=True); continue
                    raise
                fy = fy or fy2
                lc = [k for k, _ in LC2_COLS]
                cols = ["agency_id", "fiscal_year"] + lc + ["source"]
                rows = [[ag, fy] + [v.get(k) for k in lc] + [f"NDE {fy - 1}/{str(fy)[2:]} LC-2 budget submissions"] for ag, v in data.items()]
                table = "ne_lc2"
            elif kind == "budget":
                fy2, data = parse_budget(book)
                fy = fy or fy2
                bc = ["authority", "method", "reserve_pct"] + [k for k, _ in BUDGET_COLS]
                cols = ["agency_id", "fiscal_year"] + bc + ["source"]
                rows = [[ag, fy] + [v.get(k) for k in bc] + [f"NDE {fy - 1}/{str(fy)[2:]} certified budget authority"] for ag, v in data.items()]
                table = "ne_budget"
            else:
                fy2, data = parse_pta(book)
                fy = fy or fy2
                cols = ["agency_id", "fiscal_year"] + [k for k, _ in PTA_COLS] + ["source"]
                rows = [[ag, fy] + [v.get(k) for k, _ in PTA_COLS] + [f"NDE {fy - 1}/{str(fy)[2:]} property tax request authority certification"]
                        for ag, v in data.items()]
                table = "ne_pta"
            csvp = os.path.join(work, f"{kind}_{fy}.csv")
            write_csv(csvp, rows)
            print(f"{kind} {fy}: {len(data)} districts ({name})", flush=True)
            if a.dry_run:
                for ag in list(data)[:2]:
                    print("   ", ag, data[ag])
                continue
            if kind == "stat":
                upsert_districts(db, work, data)
            if not a.force and unchanged(db, kind, str(fy), digest):
                print(f"{kind} {fy}: unchanged, skipped", flush=True); continue
            n = upsert(db, kind, name, str(fy), digest, len(data), csvp, table, cols, ["agency_id", "fiscal_year"], f"fiscal_year = {fy}")
            print(f"{kind} {fy}: loaded {n}", flush=True)

    if "afr" in kinds:
        if a.file and local.get("afr"):
            pages = [(None, n, p, "afr") for _, n, p, _ in local["afr"]]
            agencies, years = None, None
        else:
            pages = None
            if a.dry_run and not db:
                # without a database, take the district list from the newest statistical file
                f = find_files("stat")[0]
                agencies = sorted(parse_stat(read_book(get(f[2], f[1])), f[0])[1])
                newest = f[0]
            else:
                agencies = psql(db, "select agency_id from public.ne_district order by agency_id;").split()
                newest = int(psql(db, "select coalesce(max(fiscal_year), 0) from public.ne_stat;") or 0)
            if a.afr_limit:
                agencies = agencies[:a.afr_limit]
            # the AFR for a school year is filed in the autumn after it ends; try the newest stat year, then go back
            years = list(range(newest, newest - a.afr_years - 1, -1))
        by_year = {}
        if pages:
            for _, n, p, _ in pages:
                r = parse_afr(open(p, encoding="utf-8", errors="replace").read())
                by_year.setdefault(r["fy"], []).append(r)
        else:
            for fy in years:
                dy = f"{fy - 1}/{str(fy)[2:]}"
                got = []
                for ag in agencies:
                    r = parse_afr(fetch(AFR_URL.format(agency=ag, dy=dy)).decode("utf-8", "replace"))
                    if r["accounts"]:
                        got.append(r)
                    time.sleep(a.afr_pause)
                    if not got and len(agencies) > 20 and agencies.index(ag) >= 9:
                        break           # the year isn't published yet
                print(f"afr {fy}: {len(got)} districts", flush=True)
                if got:
                    by_year[fy] = got
                if len(by_year) >= a.afr_years:
                    break
        for fy, got in sorted(by_year.items()):
            csvp = os.path.join(work, f"afr_{fy}.csv")
            write_csv(csvp, [[r["agency"], fy, acct, desc, amt] for r in got for acct, desc, amt in r["accounts"]])
            n_rows = sum(len(r["accounts"]) for r in got)
            if a.dry_run:
                print(f"afr {fy}: {len(got)} districts, {n_rows} accounts", flush=True)
                for r in got[:1]:
                    print("   ", r["agency"], r["name"], [x for x in r["accounts"] if x[0] in ("01-1-10000-000", "01-2-20400-000", "01-0-CSHOH-END")])
                continue
            digest = hashlib.sha256(open(csvp, "rb").read()).hexdigest()
            if not a.force and unchanged(db, "afr", str(fy), digest):
                print(f"afr {fy}: unchanged, skipped", flush=True); continue
            cols = ["agency_id", "fiscal_year", "account", "description", "amount"]
            n = upsert(db, "afr", AFR_URL.split("?")[0], str(fy), digest, n_rows, csvp, "ne_afr", cols,
                       ["agency_id", "fiscal_year", "account"],
                       f"fiscal_year = {fy} and agency_id in (select distinct agency_id from _t)")   # only the districts read this time
            m = psql(db, f"select public.ne_refresh_measures({fy});")
            print(f"afr {fy}: loaded {n} accounts; {m} peer measures", flush=True)


if __name__ == "__main__":
    main()
