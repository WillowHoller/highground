#!/usr/bin/env python3
"""Tests for load_nebraska.py's readers and parsers, with made-up districts laid out exactly like NDE's files
(StatInfo .xls report and 2020/21 .xlsx table, A1, A3, the PTA certification, an AFR page).
    python3 loader/nebraska_loader_test.py
The .xls fixture is written by a tiny Excel 97-2003 writer below (shared strings split across CONTINUE records,
RK, MULRK and NUMBER cells, a cell one column off its header, as in the real report)."""
import os, struct, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_nebraska as L

passed = failed = 0


def ok(cond, msg):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1; print("FAIL", msg)


def near(a, b, msg, tol=1e-6):
    ok(a is not None and b is not None and abs(a - b) <= tol, f"{msg}: {a!r} vs {b!r}")


# ---------------------------------------------------------------- a tiny .xls writer (fixtures only)
def rec(t, data):
    return struct.pack("<HH", t, len(data)) + data


def sst_records(strings, chunk=60):
    """SST + CONTINUE records, splitting strings across records the way Excel does."""
    recs, cur = [], bytearray(struct.pack("<II", len(strings), len(strings)))
    first = True

    def flush():
        nonlocal cur, first
        recs.append(rec(0xFC if first else 0x3C, bytes(cur))); first = False; cur = bytearray()
    for s in strings:
        wide = any(ord(ch) > 255 for ch in s)
        if len(cur) + 3 > chunk:
            flush()
        cur += struct.pack("<HB", len(s), 1 if wide else 0)
        i = 0
        while i < len(s):
            w = 2 if wide else 1
            room = (chunk - len(cur)) // w
            if room <= 0:
                flush(); cur += bytes([1 if wide else 0]); continue
            part = s[i:i + room]
            cur += part.encode("utf-16-le" if wide else "latin-1"); i += len(part)
    flush()
    return b"".join(recs)


def write_xls(path, rows, sheet="Sheet1"):
    strings, idx = [], {}
    for r in rows:
        for v in r:
            if isinstance(v, str) and v not in idx:
                idx[v] = len(strings); strings.append(v)
    bof = lambda dt: rec(0x809, struct.pack("<HHHHII", 0x0600, dt, 0x0DBB, 0x07CC, 0, 0))
    name = sheet.encode("latin-1")
    glob = bof(0x5) + rec(0x85, struct.pack("<IHBB", 0, 0, len(name), 0) + name) + sst_records(strings) + rec(0x0A, b"")
    cells = b""
    for r, row in enumerate(rows):
        c = 0
        while c < len(row):
            v = row[c]
            small = lambda x: isinstance(x, int) and not isinstance(x, bool) and 0 <= x < (1 << 29)
            if not small(v) and isinstance(v, int):
                v = float(v)
            if small(v) and c + 1 < len(row) and small(row[c + 1]):
                run = [v]                                           # MULRK for runs of whole numbers
                while c + len(run) < len(row) and small(row[c + len(run)]):
                    run.append(row[c + len(run)])
                cells += rec(0xBD, struct.pack("<HH", r, c) + b"".join(struct.pack("<HI", 0, (x << 2) | 2) for x in run) + struct.pack("<H", c + len(run) - 1))
                c += len(run); continue
            if isinstance(v, str):
                cells += rec(0xFD, struct.pack("<HHHI", r, c, 0, idx[v]))
            elif isinstance(v, int):
                cells += rec(0x27E, struct.pack("<HHHI", r, c, 0, (v << 2) | 2))
            elif isinstance(v, float):
                cells += rec(0x203, struct.pack("<HHHd", r, c, 0, v))
            c += 1
    stream = glob + bof(0x10) + cells + rec(0x0A, b"")
    stream += b"\0" * max(0, 4096 - len(stream))
    SS = 512
    nsec = (len(stream) + SS - 1) // SS
    stream += b"\0" * (nsec * SS - len(stream))
    hdr = bytearray(512)
    hdr[0:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", hdr, 24, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into("<IiIIiIiI", hdr, 44, 1, 1, 0, 4096, -2, 0, -2, 0)
    for i in range(109):
        struct.pack_into("<i", hdr, 76 + 4 * i, 0 if i == 0 else -1)
    fat = [-3, -2] + [3 + i for i in range(nsec - 1)] + [-2]
    fat += [-1] * (128 - len(fat))
    fat_b = struct.pack("<128i", *fat)

    def entry(n, typ, start, size):
        e = bytearray(128)
        nb = (n + "\0").encode("utf-16-le"); e[0:len(nb)] = nb
        struct.pack_into("<HBB", e, 64, len(nb), typ, 1)
        struct.pack_into("<iii", e, 68, -1, -1, 1 if typ == 5 else -1)
        struct.pack_into("<iI", e, 116, start, size)
        return bytes(e)
    d = entry("Root Entry", 5, -2, 0) + entry("Workbook", 2, 2, len(stream.rstrip(b"\0")) if False else nsec * SS)
    d += b"\0" * (512 - len(d))
    open(path, "wb").write(bytes(hdr) + fat_b + d + stream)


def write_xlsx(path, rows, sheet="Sheet1"):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = sheet
    for r in rows:
        ws.append(r)
    wb.save(path)


tmp = tempfile.mkdtemp(prefix="ne_test_")

# ---------------------------------------------------------------- StatInfo, the printed .xls report (2021/22 on)
row_hdr0 = [None, None, "COUNTY", None, None, None, None, None, None, None, None, "Class", None, "Levies: Per $100 of Valuation — every fund",
            None, None, None, None, None, None, None, None, None, None, None, "Fall Membership"]
row_hdr = [None, None, "School District", None, None, None, None, None, "Agency ID", None, None, "Code", None, "General", None, "Bond", None,
           "Building", None, "Qualified", None, "Total", None, "Valuation", None, "PK", None, None, "K-12", None, None, None, "TOTAL"]


def drow(name, ag, cls, gen, bond, sb, q, tot, val, pk, k12, total, val_col=23):
    r = [None] * 33
    r[2], r[8], r[11], r[13], r[15], r[17], r[19], r[21] = name, ag, cls, gen, bond, sb, q, tot
    r[val_col] = val
    r[25], r[28], r[32] = pk, k12, total
    return r


stat_rows = [[None, "NEBRASKA DEPARTMENT OF EDUCATION\nSCHOOL FINANCE & ORGANIZATION SERVICES\n2025/2026 STATISTICAL INFORMATION FOR PUBLIC SCHOOL DISTRICTS"],
             [], [], [], [], row_hdr0, row_hdr, [], [None, "PRAIRIE ( 99 ) "], [],
             drow("PRAIRIE FORK PUBLIC SCHOOLS", "99-0001-000", "3", 0.8123, 0.0911, 0.0450, 0.0, 0.9484, 612345678, 40, 560, 600),
             [], drow("WILLOW BEND PUBLIC SCHOOLS", "99-0002-000", "3", 1.01, 0.14, 0.0, 0.01, 1.16, 1862229887, 454, 3213, 3667, val_col=22),
             [None, None, "COUNTY TOTAL"], [None, "BLUESTEM ( 98 ) "],
             drow("BLUESTEM VALLEY SCHOOLS", "98-0005-000", "3", 0.6909, 0.0438, 0.0354, 0.0, 0.7701, 600009963, 34, 260, 294)]
p = os.path.join(tmp, "2526_StatInfo.xls")
write_xls(p, stat_rows)
book = L.read_book(p)
ok(list(book) == ["Sheet1"], "xls sheet name")
ok(book["Sheet1"][0][1].startswith("NEBRASKA DEPARTMENT"), "xls shared string (split across CONTINUE records)")
ok("—" in book["Sheet1"][5][13], "xls wide string")
fy, st = L.parse_stat(book)
ok(fy == 2026, f"stat fiscal year from the title: {fy}")
ok(sorted(st) == ["98-0005-000", "99-0001-000", "99-0002-000"], f"stat districts: {sorted(st)}")
a = st["99-0001-000"]
near(a["gen_levy"], 0.8123, "general levy"); near(a["sb_levy"], 0.045, "special building levy"); near(a["qcpuf_levy"], 0, "QCPUF levy")
near(a["total_levy"], 0.9484, "total levy"); near(a["valuation"], 612345678, "valuation")
ok(a["mem_pk"] == 40 and a["mem_k12"] == 560 and a["mem_total"] == 600, f"membership {a}")
ok(a["county"] == "Prairie" and a["class"] == "3" and a["name"] == "PRAIRIE FORK PUBLIC SCHOOLS", f"county/class/name {a}")
near(st["99-0002-000"]["valuation"], 1862229887, "valuation one column left of its header")
near(st["99-0002-000"]["total_levy"], 1.16, "total levy not confused with the valuation beside it")
ok(st["99-0002-000"]["mem_total"] == 3667, "total membership is the second 'TOTAL'")
ok(st["98-0005-000"]["county"] == "Bluestem", "county changes at each county row")

p = os.path.join(tmp, "mulrk.xls")
write_xls(p, [["a", 1, 2, 3, -4, 1.5, 70000000000]])
rr = L.read_book(p)["Sheet1"][0]
ok(rr[:4] == ["a", 1, 2, 3] and rr[5] == 1.5 and rr[6] == 7e10, f"xls MULRK/RK/NUMBER cells {rr}")

# ---------------------------------------------------------------- StatInfo 2020/21 (.xlsx table)
p = os.path.join(tmp, "2021_StatisticalInfo.xlsx")
write_xlsx(p, [["COUNTYNO", "COUNTYNAME", "CODISTSCH", "NAME", "CLASS", "VAL", "GENLEV", "BONDLEV", "SINKLEV", "QCPULEV", "MEM_PK", "MEM_K12", "MEM_TOTAL", "DATAYEAR", "DATAYEARS"],
               ["99", "PRAIRIE", "99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "3", "439344332", "0.8219", "0.0759", "0.046", "0", "20", "235", "255", "2020/21", "2020/2021"]], "Data")
fy, st = L.parse_stat(L.read_book(p))
ok(fy == 2021, f"2020/21 table year {fy}")
near(st["99-0001-000"]["valuation"], 439344332, "2020/21 valuation"); near(st["99-0001-000"]["total_levy"], 0.9438, "2020/21 total levy = sum")
ok(st["99-0001-000"]["county"] == "Prairie", "2020/21 county")

# ---------------------------------------------------------------- A1 and A3 (2026/27 state aid certification)
p = os.path.join(tmp, "2627SA_A1StateAidCalcBySystem_C.xlsx")
write_xlsx(p, [["CoDistSch", "NAME", "FormulaNeed", "Local", "OptionFunding", "IncomeTaxRebate", "OtherReceipts", "commachieveplanaid", "FoundationIn",
                "TotalResources", "FounddationOut", "EqAid", "CalcSA"],
               ["99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "8300000", "6123457", "0", "60000", "900000", "0", "540000", "7623457", "900000", "676543", "1576543"]], "Data 1")
a1 = L.parse_a1(L.read_book(p))
near(a1["99-0001-000"]["formula_need"], 8300000, "A1 need"); near(a1["99-0001-000"]["foundation_out"], 900000, "A1 foundation (NDE's typo'd header)")
near(a1["99-0001-000"]["calc_aid"], 1576543, "A1 calculated aid")
p = os.path.join(tmp, "2627SA_A3FormulaStudentsinAscendingOrder_C.xlsx")
write_xlsx(p, [["datayears", "county", "agencyid", "formulastudents", "adjgfoe", "adjgfoeperstu", "CertYear"],
               ["20252026", "99", "99-0001-000", "600.123", "7000000", "11664.0", "20262027"]], "Data 1")
a3 = L.parse_a3(L.read_book(p))
near(a3["99-0001-000"]["formula_students"], 600.123, "A3 formula students"); ok(a3["99-0001-000"]["cert_fy"] == 2027, "A3 certification year")

# TEEOSA identity on the made-up row: equalization = need - resources; aid = equalization + foundation (+ ITR + option)
v = a1["99-0001-000"]
near(v["formula_need"] - v["total_resources"], v["eq_aid"], "equalization = need - resources")
near(v["eq_aid"] + v["foundation_out"] + v["income_tax"] * 0 + v["option_funding"], v["calc_aid"], "calculated aid = equalization + foundation")

# ---------------------------------------------------------------- PTA certification (2024/25, 2025/26, 2026/27 headers)
H2627 = ["AgencyID", "District Name", "General Fund Tax Asking\n(2025/26 LC-2)", "Special Bldg \nTax Asking\n(2025/26 LC-2)", "2025/26 \nTOTAL\nProperty Tax Request\n",
         "General Fund \nNon-Property Tax Revenue\n(2023/24 AFR)", "Special Bldg\nNon-Property Tax Revenue (2023/24 AFR)", "2023/24 \nTOTAL\nNon-Property Tax Revenue\n",
         "2024/25 \nSPED Reimbursement", "2025/26 \nTEEOSA \nCertified 2.27.25", "TOTAL \nREVENUE\n(Total Tax Request + NonProperty $ + SPED + TEEOSA)\n",
         "Base \nGrowth \n3% ", "Basic Growth %  for Membership", "Basic Growth % for \nLEP", "Basic Growth % for \nPoverty", "TOTAL \nBASE GROWTH \nRATE % \n",
         "REVENUE CAP\n(Total Revenue \nX \nTotal Base Growth %)", "General Fund \nNon-Property Tax Revenue\n(2024/25 AFR)", "Special Bldg\nNon-Property Tax Revenue (2024/25 AFR)",
         "2024/25 \nTOTAL\nNon-Property Tax Revenue\n", "2025/26 \nSPED \nFINAL TO PAY", "2026/27 \nTEEOSA \nCertified 2.27.26 ",
         "Prior Years\nUnused Property Tax Authority\n(2025/26 LC-2)", "2026/27 \nPROPERTY \nTAX AUTHORITY\n(Section C - Total NonProperty $ - SPED - TEEOSA + PY Unused PTAuthority)",
         "Additional Base Growth % Allowed with 70% Board Approval", "Additional Property Tax Authority Allowed if Board Approved\n(Section A Total Revenue x Section E)",
         "2026/27 Property Tax Request Authority including Board Approved Amount"]
ROW = ["99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "4145194", "212121", "4357315", "437514", "3201", "440715", "443649", "579558", "5821237", "0.03", "0.0369", "0", "0.0025",
       "0.0695", "6225788.5", "365785", "3717", "369502", "433732.2", "736408", "440433", "5126579", "0.07", "407487", "5534066"]
p = os.path.join(tmp, "2627_PropertyTaxAuthorityCertification_06.26.26.xlsx")
write_xlsx(p, [["Nebraska Department of Education\n2026/27 PROPERTY TAX REQUEST AUTHORITY"], [None, None, "SECTION A"], H2627, ROW], "Certification 6.25.26")
fy, pta = L.parse_pta(L.read_book(p))
ok(fy == 2027, f"PTA year {fy}")
r = pta["99-0001-000"]
near(r["gf_ask"], 4145194, "PTA GF asking"); near(r["sb_ask"], 212121, "PTA SB asking"); near(r["total_revenue"], 5821237, "PTA total revenue")
near(r["base_growth_rate"], 0.0695, "PTA base growth"); near(r["prior_unused"], 440433, "PTA prior unused"); near(r["authority"], 5126579, "PTA authority")
near(r["board_pct"], 0.07, "PTA board %"); near(r["board_extra"], 407487, "PTA board extra"); near(r["authority_with_board"], 5534066, "PTA with board")
near(r["revenue_cap"], 6225788.5, "PTA revenue cap"); near(r["total_request"], 4357315, "PTA total request")
near(r["g_member"], 0.0369, "PTA membership growth part"); near(r["g_lep"], 0, "PTA LEP growth part"); near(r["g_poverty"], 0.0025, "PTA poverty growth part")
# NDE's arithmetic, as the certification explains it: authority = cap - non-property $ - SPED - TEEOSA + prior unused
near(r["revenue_cap"] - 369502 - 433732.2 - 736408 + r["prior_unused"], r["authority"], "authority = cap - non-property - SPED - TEEOSA + unused", tol=1)
near(r["total_revenue"] * r["board_pct"], r["board_extra"], "board extra = total revenue x board %", tol=1)
H2425 = list(H2627)
H2425[10] = "TOTAL Property Tax & Non-Property Tax Revenue"; H2425[22] = "Prior Years Unused Property Tax Authority"
H2425[23] = "2024/25 PROPERTY TAX REQUEST AUTHORITY"; H2425[24] = "Additional Base Growth Percentage if 70% Board Approval"
H2425[25] = "Amount of Additional Property Tax Authority if Approved"; H2425[26] = "2024/25 Property Tax Request Authority including Board Approved Amount"
p = os.path.join(tmp, "2425PTAuthorityCertification_5.23.24.xlsx")
write_xlsx(p, [["title"], [None], H2425, ROW], "Certification 24-25")
fy, pta = L.parse_pta(L.read_book(p))
ok(fy == 2025, f"2024/25 PTA year {fy}")
near(pta["99-0001-000"]["authority"], 5126579, "2024/25 authority header"); near(pta["99-0001-000"]["board_extra"], 407487, "2024/25 board extra header")
near(pta["99-0001-000"]["total_revenue"], 5821237, "2024/25 total revenue header")

# ---------------------------------------------------------------- certified budget authority (budget factors), 2026/27
from openpyxl import Workbook
wb = Workbook(); ws = wb.active; ws.title = "2026-27 Budget Authority"
for r in [["NEBRASKA DEPARTMENT OF EDUCATION\n2026/27 BUDGET AUTHORITY AND ALLOWABLE RESERVE PERCENTAGE", None, None, None, "2026-27  \nCertified Budget Authority \nFebruary 27, 2026"],
          ["B = Budget Based Calculation"], ["SGA = Student Growth Adjustment Calculation"], ["F = Formula Needs Based Calculation"], [None, "2.5% Basic Allowable Growth Rate (BAGR)"],
          ["COUNTY/ DISTRICT NUMBER", "DISTRICT NAME", "CLASS", "2026/27   \nBUDGET AUTHORITY", "METHOD", " RESERVE\n%"],
          ["99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "3", "5067908", "F", "45"]]:
    ws.append(r)
ws2 = wb.create_sheet("2026-27 Data Components")
for r in [["NEBRASKA DEPARTMENT OF EDUCATION\nDATA COMPONENTS USED IN CALCULATING 2026/27 CERTIFIED BUDGET AUTHORITY"], [], [], [], [],
          ["COUNTY/ DISTRICT NUMBER", "DISTRICT NAME", "2026/27 FORMULA NEEDS", "2025/26 GENERAL FUND BUDGET OF EXPENDITURES", "2025/26 SPECIAL GRANT FUNDS",
           "2025/26 SPECIAL EDUCATION BUDGET OF EXPENDITURES", "2025/26 GENERAL FUND LID EXCLUSIONS", "2025/26 ADJUSTED EXPENDITURES", "2% OF 2025/26 ADJUSTED EXPENDITURES",
           "TOTAL UNUSED BUDGET AUTHORITY", "2026/27 STUDENT GROWTH ADJUSTMENT", "2026/27 STUDENT GROWTH CORRECTION"],
          ["99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "5422530", "6195000", "303275", "875000", "90986", "4925739", "98514.78", "0", "0", "0"]]:
    ws2.append(r)
ws3 = wb.create_sheet("Calculation"); ws3.append(["Formulas for Calculating Budget Authority"])
p = os.path.join(tmp, "2627BudgetAuthorityCertifiedC.xlsx"); wb.save(p)
fy, bud = L.parse_budget(L.read_book(p))
b = bud["99-0001-000"]
ok(fy == 2027, f"budget authority year {fy}")
near(b["authority"], 5067908, "certified budget authority"); ok(b["method"] == "F", f"method {b.get('method')}"); near(b["reserve_pct"], 45, "reserve %")
near(b["formula_need"], 5422530, "formula need"); near(b["gfbe"], 6195000, "last year's GF budget"); near(b["sgf"], 303275, "special grants")
near(b["sped"], 875000, "special education"); near(b["gfle"], 90986, "lid exclusions"); near(b["adjusted"], 4925739, "adjusted expenditures")
near(b["two_pct"], 98514.78, "2% of adjusted"); near(b["unused"], 0, "unused authority"); near(b["sga"], 0, "student growth adjustment")
# NDE's arithmetic: authority = the greatest of budget-based, student growth and formula-needs
near(max(b["adjusted"] * 1.025, b["adjusted"] + b["sga"] + b["sgacorr"], b["formula_need"] * 1.10 - b["sped"] * 1.025), b["authority"], "authority = greatest of the three methods", tol=1)
near(b["gfbe"] - b["sgf"] - b["sped"] - b["gfle"], b["adjusted"], "adjusted = budget less grants, SPED and exclusions", tol=1)

# ---------------------------------------------------------------- A2 (formula needs components) and the LC-2 budget submissions
p = os.path.join(tmp, "2627SA_A2FormulaNeeds_Components_C.xlsx")
write_xlsx(p, [["System County /District Number", "Formula Need", "Need Stabilization", "Special Receipts Allowance", "Transportation Allowance", "Poverty Allowance",
                "LEP Allowance", "DETA Allowance", "Elementary Site Allowance", "Summer School Allowance", "Focus School Allowance", "Commuinity Achieve Plan Aid",
                "Non-Qualified LEP Adjustment", "Basic Funding", "System  Averging Adjustment", "Student Growth Adjustment", "New School Adjustment",
                "Poverty Correction Adjustment", "LEP Correction Adjustment", "Student Growth Correction"],
               ["99-0001-000", "8300000", "0", "449548", "143060", "4485", "0", "8394", "0", "0", "0", "0", "0", "7200000", "0", "315000", "0", "0", "0", "-12000"]], "Data 1")
a2 = L.parse_a2(L.read_book(p))["99-0001-000"]
near(a2["basic_funding"], 7200000, "A2 basic funding"); near(a2["sga"], 315000, "A2 student growth adjustment"); near(a2["sgacorr"], -12000, "A2 correction")
near(a2["poverty_allowance"], 4485, "A2 poverty allowance")
LC2H = ["District Number", "Name", "Certified Budget Authority", "Access to Prior Year's Unused Budget Authority ", "Total Adjusted Budget Authority", "Early Childhood Grant Exclusion",
        "Total Allowable Budget Authority", "2026/27 General Fund Budget of Disbursements & Transfers", "2026/27 Special Grant Funds", "2026/27 Special Education Budget of Disbursements & Transfers",
        "2026/27 General Fund Lid Exclusions", "Total Adjusted General Fund Budget of Disbursements & Transfers", "2026/27 Unused Budget Authority", "2025/26 Total Unused Budget Authority",
        "2026/27 General Fund Expenditure Growth", "Adjusted Unused Budget Authority", "2026/27 Unused Budget Authority", "Total Unused Budget Authority",
        "Did you hold a successful special election for additional BUDGET Authority?", "Budget Authority INCREASE approved by the voters in the special election",
        "Did you hold a successful election of your patrons for a levy override that applies to the current year?", "Total property tax levy approved by the Patrons in excess of the Statutory Levy Limit of $1.05",
        "Number of years the Levy Override will be in effect: (Must between 1 and 5)", "What was the first year this Levy Override was in effect? - YYYY", "What year will this Levy Override will expire? - YYYY",
        "Certified Assessed Valuation", "2026/27 Applicable Allowable Reserve Percentage", "2026/27 Total Allowable Reserves", "2026/27 General Fund Necessary Cash Reserve",
        "2026/27 Depreciation Fund Total Requirements", "2026/27 Employee Benefit Fund Necessary Cash Reserve", "Total Reserves", "2026/27 Property Tax Request Authority",
        "Did 70% of the School Board approve to exceed the Certified Property Tax Request Authority?", "Maximum Amount Allowed:", "Enter the amount approved by the School Board.",
        "Was a successful election of the patrons held to exceed the Property Tax Request Authority?", "Enter the total Property Tax Request Authority increase approved by the voters.",
        "Additional Property Tax Authority due to successful levy override (Calculation of B-420 multiplied by Certified Assessed Valuation listed above)", "Total Property Tax Authority Allowed",
        "2026/27 Property Tax Request General Fund", "2026/27 Property Tax Request Special Building Fund", "2026/27 Total Property Tax Request", "2026/27 Unused Property Tax Request Authority",
        "Total Property Tax Reduced as a result of increased SPED & Foundation Aid"]
LC2R = ["99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", 5067908, 0, 5067908, 0, 5067908, 6565500, 337592, 1160000, 0, 5067908, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.035, 5, 2025, 2030,
        626635675, 45, 2954475, 2226183, 700000, 0, 2926183, 5126579, 0, 407487, 0, 0, 0, 0, 5126579, 4487374, 0, 4487374, 639205, 457585]
p = os.path.join(tmp, "lc2-2627.xls")
LC2B = list(LC2R); LC2B[0] = "99-0002-000"; LC2B[1] = "CEDAR BLUFF SCHOOLS"; LC2B[20] = 0; LC2B[21] = 0; LC2B[22] = 0; LC2B[23] = 0; LC2B[24] = 0
LC2B[33] = 1; LC2B[35] = 407487; LC2B[38] = 0
LC2R[38] = 219000   # a pre-2024 override's authority (B-420 × valuation)
write_xls(p, [["2026-27 LC2 & Budget Submission Totals"], LC2H, LC2R, LC2B])
fy, lc = L.parse_lc2(L.read_book(p))
v = lc["99-0001-000"]
ok(fy == 2027, f"LC-2 year {fy}")
near(v["gf_request"], 4487374, "LC-2 General Fund request"); near(v["sb_request"], 0, "LC-2 Special Building request"); near(v["pta"], 5126579, "LC-2 authority")
near(v["unused_pta"], 639205, "LC-2 unused authority"); near(v["valuation"], 626635675, "LC-2 valuation"); near(v["adj_budget"], 5067908, "LC-2 adjusted budget")
near(v["gf_budget"], 6565500, "LC-2 GF budget"); near(v["sped"], 1160000, "LC-2 SPED"); near(v["budget_authority"], 5067908, "LC-2 budget authority")
near(v["unused_budget"], 0, "LC-2 total unused budget authority (the last such column)"); near(v["override_levy"], 0.035, "LC-2 override levy"); near(v["override_last"], 2030, "LC-2 override end")
near(v["reserve_pct"], 45, "LC-2 reserve %"); near(v["depreciation_req"], 700000, "LC-2 depreciation requirements"); near(v["board_extra"], 0, "LC-2 board-approved extra")
ok(L.school_year_fy("2026-27 LC2 & Budget Submission Totals") == 2027, "school year 2026-27")
near(v["override_first"], 2026, "LC-2 override first year as a HighGround fiscal year (NDE's 2025 = 2025/26)"); near(v["override_on"], 1, "LC-2 override yes")
near(v["ov_authority"], 219000, "LC-2 override authority"); near(v["board_vote"], 0, "LC-2 no board vote")
v2 = lc["99-0002-000"]
near(v2["board_vote"], 1, "LC-2 board 70% vote"); near(v2["board_extra"], 407487, "LC-2 board amount"); ok(v2["override_first"] is None and v2["override_last"] is None, "LC-2 no override years")
ok(L.override_fy("2023/24", True) == 2024 and L.override_fy("2027/28", False) == 2028 and L.override_fy(2023, True) == 2024 and L.override_fy(2028, False) == 2028, "override years, both NDE layouts")
ok(L.yes("Yes") == 1 and L.yes("No") == 0 and L.yes(1) == 1, "LC-2 yes/no")

# ---------------------------------------------------------------- prior year correction (a PDF, read with pdftotext)
try:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    pp = os.path.join(tmp, "2627SA_CalcOfPriorYearCorrFor2627SACertC.pdf")
    c = canvas.Canvas(pp, pagesize=letter); yy = 740
    for t in ["Calculation of Prior Year Correction for the", "2026/27 State Aid Certification", "Agency ID   District Name   2025/26 Certified Aid   2025/26 Year ReCalculated Aid   Prior Year Correction"]:
        c.drawString(40, yy, t); yy -= 16
    for ag, nm, a, b, d in [("99-0001-000", "PRAIRIE FORK PUBLIC SCHOOLS", "584,987", "595,896", "10,909"), ("99-0002-000", "CEDAR BLUFF SCHOOLS", "543,402", "538,390", "(5,012 )"),
                            ("99-0003-000", "WILLOW CREEK SCHOOLS", "1,000", "2,000", "7")]:
        c.drawString(40, yy, ag); c.drawString(120, yy, nm); c.drawRightString(400, yy, a); c.drawRightString(480, yy, b); c.drawRightString(560, yy, d); yy -= 14
    c.drawString(300, yy, "1,128,389     1,134,286     5,897"); c.save()
    pyc = L.parse_pyc(L.pdf_lines(pp))
    near(pyc["99-0001-000"]["prior_year_corr"], 10909, "prior year correction"); near(pyc["99-0002-000"]["prior_year_corr"], -5012, "negative correction in parentheses")
    near(pyc["99-0002-000"]["prior_cert_aid"], 543402, "last year's certified aid")
    ok("99-0003-000" not in pyc, "a row whose figures don't add up is skipped")
except ImportError:
    print("SKIP prior year correction PDF (no reportlab)")

# ---------------------------------------------------------------- AFR page (sfos.education.ne.gov)
tr = lambda a, d, amt: f'<tr style="color:Black;background-color:White;font-weight:normal;"> <td align="left" valign="top">{a}</td><td align="left" valign="top">{d}</td><td align="right" valign="top">{amt}</td> </tr>'
page = ('<html><body><table id="MainContent_DistrictHeader1_tblDistrictInfo"><tr><td>County-District Number: </td><td></td><td><span id="MainContent_DistrictHeader1_lblCodistsch" style="font-weight:bold;">99-0001-000</span></td></tr>'
        '<tr><td>District Name: </td><td><span id="MainContent_DistrictHeader1_lblName" style="font-weight:bold;">PRAIRIE FORK PUBLIC SCHOOLS</span></td></tr>'
        '<tr><td>Class</td><td><span id="MainContent_DistrictHeader1_lblClass" style="font-weight:bold;">3</span></td></tr>'
        '<tr><td>Datayear: </td><td><span id="MainContent_DistrictHeader1_lblDatayear" style="font-weight:bold;">2024/25</span></td></tr></table>'
        '<table id="MainContent_tblResults"><tr style="color:White;"> <td>Account</td><td>Description</td><td align="right">Amount</td> </tr>'
        '<tr> <td align="center" colspan="3">General Fund</td> </tr>'
        + tr("01-1-01100-000", "TAXES LEVIED/ASSESSED BY THE SCHOOL DISTRICT", "4,594,895.00")
        + tr("01-1-03110-000", "STATE AID", "960,000.00")
        + tr("01-1-10000-000", "GRAND TOTAL OF ALL RECEIPTS", "9,917,416.00")
        + tr("01-2-027X0-000", "TOTAL STUDENT TRANSPORTATION - REGULAR EDUCATION", "267,207.00")
        + tr("01-2-06690-300's", "FEDERAL SERVICES - Professional/Tech Services", "1,500.00")
        + tr("01-2-20400-000", "TOTAL GENERAL FUND EXPENDITURES", "9,451,740.00")
        + tr("01-0-CSHOH-END", "General Fund - Cash on Hand - Ending Balance", "2,757,409.00")
        + tr("02-1-05200-000", "FUND TRANSFERS IN", "150,000.00")
        + tr("08-2-09001-001", "INTERFUND LOAN TO GENERAL FUND", "(1,250.00)")
        + '</table><table id="MainContent_tblSAAccounts"><tr><td>01-2-02510-382</td><td>DETA</td><td>+</td><td>4,430.00</td></tr></table></body></html>')
afr = L.parse_afr(page)
ok(afr["agency"] == "99-0001-000" and afr["fy"] == 2025 and afr["class"] == "3", f"AFR header {afr['agency']} {afr['fy']}")
acc = {a: v for a, _, v in afr["accounts"]}
ok(len(afr["accounts"]) == 9, f"AFR accounts {len(afr['accounts'])} (fund headings and the state-aid table left out)")
near(acc["01-1-10000-000"], 9917416, "AFR total receipts"); near(acc["01-0-CSHOH-END"], 2757409, "AFR cash")
near(acc["08-2-09001-001"], -1250, "AFR (negative)"); ok("01-2-06690-300's" in acc, "AFR object-group codes kept")
ok("01-2-02510-382" not in acc, "AFR state-aid allowance table not mixed in")

# ---------------------------------------------------------------- helpers
ok(L.school_year_fy("2025/26") == 2026 and L.school_year_fy("2025/2026") == 2026 and L.school_year_fy("20262027") == 2027, "school years")
ok(L.school_year_fy("21-22Statistical_Info.xls") == 2022, "file-name year 21-22")
ok(L.num("(1,250.00)") == -1250 and L.num("-") is None and L.num(" 3 ") == 3, "numbers")
lk = L.links('<a href="/wp-content/uploads/2026/01/2526_StatInfo_rev01.26.26.xls">2025/26</a><a href="https://x.org/a.pdf">PDF</a>')
ok(lk[0] == ("2025/26", "https://www.education.ne.gov/wp-content/uploads/2026/01/2526_StatInfo_rev01.26.26.xls"), f"links {lk}")

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
