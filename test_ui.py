# HighGround shell: browser test against a simulated Supabase. Run: pip install playwright; playwright install chromium; python3 test_ui.py
import asyncio, json, re, urllib.parse, subprocess, time, os
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.abspath(__file__)); SB="https://test.supabase.co"; SHOTS=os.path.join(os.path.dirname(os.path.abspath(__file__)),"shots"); os.makedirs(SHOTS,exist_ok=True)
D1={"id":"d1","slug":"ironwood-valley","name":"Ironwood Valley Community School District","short_name":"Ironwood Valley","state":"IA","county":"Fictional","brand_color":"#1F4E8C","is_demo":True,"public_link_enabled":True}
D2={"id":"d2","slug":"cottonwood-ridge","name":"Cottonwood Ridge Community School District","short_name":"Cottonwood Ridge","state":"IA","county":None,"brand_color":"#7A4E2D","is_demo":True,"public_link_enabled":True}
USERS={"admin@example.test":("u-admin","Pat Admin",[("d1","admin"),("d2","viewer")],False),
       "viewer@example.test":("u-viewer","Val Viewer",[("d1","viewer")],False),
       "new@example.test":("u-new","Nia New",[],False),
       "staff@example.test":("u-staff","Sam Staff",[],True),
       "empty.staff@example.test":("u-estaff","Eve Staff",[],True),
       "mfa@example.test":("u-mfa","Mo Factor",[],False)}
PW="correct horse battery"
TABLES={"initiative":[{"district_id":"d1","name":"Middle school HVAC","type":"capital","status":"approved","focus_area":"Facilities","tier":"must","cost_confidence":"firm","condition":"poor","id":"i1"}],
 "scenario":[{"district_id":"d1","id":"s1","name":"District baseline","is_board_version":True,"is_locked":True,"updated_at":"2026-09-23T12:00:00Z"}],
 "import_batch":[{"district_id":"d1","id":"b1","kind":"gl_monthly","period_end":"2026-08-31","file_name":"august.csv","status":"applied","uploaded_at":"2026-09-10T12:00:00Z"}],
 "priority":[],"measure":[],
 "fund_balance":[{"district_id":"d1","fund":"save","as_of":"2026-07-01","amount":2150000,"source":"manual"},{"district_id":"d1","fund":"save","as_of":"2026-06-01","amount":1,"source":"manual"}],
 "debt_obligation":[{"district_id":"d1","name":"SAVE revenue bonds, Series 2021","fund":"save","annual_payment":610000,"final_fy":2033}],
 "district_settings":[],"publication":[{"district_id":"d1","kind":"board_plan","title":"Board version","published_at":"2026-09-20T12:00:00Z","is_current":True}],
 "invitation":[{"district_id":"d1","id":"inv1","email":"bm@example.test","role":"business_manager","created_at":"2026-09-28T12:00:00Z","expires_at":"2026-10-28T12:00:00Z"}]}
IRON=json.loads(subprocess.check_output(["node","-e",
  "const C=require('./capital.js'),D=require('./demo_data.js');let i=0;"
  "process.stdout.write(JSON.stringify(C.demoRows(D['ironwood-valley'],'d1',()=>'00000000-0000-4000-8000-'+String(++i).padStart(12,'0'))))"],cwd=os.path.dirname(os.path.abspath(__file__))))
for t in ["district_settings","debt_obligation","initiative","scenario","scenario_initiative","phase","phase_funding","financing"]:
  TABLES[t]=IRON[t]
TABLES["fund_balance"]=IRON["fund_balance"]+[{"district_id":"d1","fund":"save","as_of":"2026-06-01","amount":1,"source":"manual"}]
for i,dbt in enumerate(TABLES["debt_obligation"]): dbt.setdefault("id","debt-%d"%i)
for i,fn in enumerate(TABLES["financing"]): fn.setdefault("id","fin-%d"%i)
_ph_sid=[sc["id"] for sc in IRON["scenario"] if not sc["is_board_version"]][0]
_init0=IRON["initiative"][0]["id"]
for sc in TABLES["scenario"]:
  sc["updated_at"]="2026-09-23T12:00:00Z"
  if sc["id"] in IRON["lock"]: sc["is_locked"]=True
GOLD=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"golden_engine.json")))["districts"]["demo-medium"]
def fmtK(v):
  s="-" if v<0 else ""; v=abs(v)
  if v>=1e6: return s+"$%.2fM"%(v/1e6)
  if v>=1000: return s+"$%dk"%round(v/1000)
  return s+"$%d"%round(v)
def gold(scen,patch): return next(c for c in GOLD["cases"] if c["scenario"]==scen and c["patch"]==patch)["result"]
PUB={}
TABLES["publication"]=[]
TABLES["import_row"]=[]; TABLES["import_issue"]=[]
for t in ["assumption_set","outcome","measure_value","survey","survey_result","recurring_cost","project_request","report_snapshot"]: TABLES.setdefault(t,[])
TABLES["initiative"]=TABLES["initiative"]+[{"id":"ini-ffa","district_id":"d1","name":"FFA program","type":"program","status":"approved","cost_confidence":"estimate"}]
_bp=[p for p in TABLES["phase"] if p["scenario_id"]!=_ph_sid][0]; _bp["label"]="Unit ventilators"
TABLES["recurring_cost"]=[{"id":"rc1","district_id":"d1","scenario_id":_ph_sid,"initiative_id":_init0,"kind":"supplies","fund":"ppel","first_fy":2028,"last_fy":None,"annual_amount":12000,"grows_with":"none"}]
TABLES["audit_log"]=[{"id":2,"district_id":"d1","table_name":"initiative","row_pk":"x","action":"update","actor":"u-admin","at":"2026-09-30T15:04:00Z",
   "old_row":{"name":"Gym floor","focus_area":"Facilities","updated_at":"a"},"new_row":{"name":"Gym floor","focus_area":"Activities","updated_at":"b"}},
  {"id":1,"district_id":"d1","table_name":"scenario","row_pk":"y","action":"insert","actor":"u-someone-else","at":"2026-09-30T14:00:00Z","old_row":None,"new_row":{"name":"Plan B"}}]
TABLES["access_request"]=[{"id":"req1","district_id":"d1","email":"asker@example.test","message":"New principal at the middle school","created_at":"2026-09-29T15:00:00Z","status":"pending"}]
calls=[]
import base64
def tok(uid,aal="aal1"):
  pl=base64.urlsafe_b64encode(json.dumps({"sub":uid,"aal":aal}).encode()).decode().rstrip("=")
  return "tok-%s.%s.sig"%(uid,pl)
def uid_from(req):
  a=req.headers.get("authorization","")
  return a[len("Bearer tok-"):].split(".")[0] if a.startswith("Bearer tok-") else None
FN={"fail":False}
PROMPT={"text":None}
DBFAIL={"phase":False}
def user_obj(email):
  u=USERS[email]; o={"id":u[0],"email":email,"user_metadata":{"full_name":u[1]}}
  if email=="mfa@example.test": o["factors"]=[{"id":"f9","status":"verified","factor_type":"totp"}]
  return o
def email_of(uid): return next((e for e,u in USERS.items() if u[0]==uid),None)
async def handler(route):
  req=route.request; url=urllib.parse.urlparse(req.url); path=url.path; q=urllib.parse.parse_qs(url.query)
  body=None
  try: body=req.post_data
  except Exception: body="<binary>"
  calls.append((req.method,path+"?"+url.query,body,req.headers.get("prefer","")))
  if path.startswith("/storage/v1/object/public/"):   # public logos load like any image, without a key
    import base64 as _b; return await route.fulfill(status=200,content_type="image/png",body=_b.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
  assert req.headers.get("apikey")=="sb_publishable_TESTKEY_abcdefghijklmnop", "missing apikey"
  def ok(data,status=200): return route.fulfill(status=status,content_type="application/json",body=json.dumps(data))
  uid=uid_from(req); em=email_of(uid) if uid else None
  if path=="/auth/v1/token":
    b=json.loads(body)
    if q["grant_type"][0]=="password":
      if b["email"] in USERS and b["password"]==PW: return await ok({"access_token":tok(USERS[b["email"]][0]),"refresh_token":"r","expires_in":3600,"user":user_obj(b["email"])})
      return await ok({"error":"invalid_grant","error_description":"Invalid login credentials"},400)
  if path=="/auth/v1/factors" and req.method=="POST": return await ok({"id":"f1","type":"totp","totp":{"qr_code":"<svg xmlns='http://www.w3.org/2000/svg'/>","secret":"JBSWY3DPEHPK3PXP","uri":"otpauth://x"}})
  if path.startswith("/auth/v1/factors/") and path.endswith("/challenge"): return await ok({"id":"ch1","expires_at":9999999999})
  if path.startswith("/auth/v1/factors/") and path.endswith("/verify"):
    b=json.loads(body)
    if b.get("code")!="123456" or b.get("challenge_id")!="ch1": return await ok({"code":"mfa_verification_failed","msg":"Invalid TOTP code entered"},422)
    return await ok({"access_token":tok(uid,"aal2"),"refresh_token":"r2","expires_in":3600,"user":user_obj(em)})
  if path.startswith("/auth/v1/factors/") and req.method=="DELETE": return await ok({"id":path.split("/")[-1]})
  if path=="/functions/v1/send-invitation":
    b=json.loads(body)
    return await (ok({"error":"Email isn’t set up on the server yet."},500) if FN["fail"] else ok({"status":"sent","to":"x"}))
  if path=="/rest/v1/rpc/claim_my_access": return await route.fulfill(status=204,body="")
  if path=="/rest/v1/rpc/set_phase_progress": return await ok(json.loads(body))
  if path=="/rest/v1/rpc/request_access": return await ok("sent")
  if path=="/auth/v1/user":
    if not em: return await ok({"msg":"JWT expired"},401)
    return await ok(user_obj(em))
  if path=="/auth/v1/signup": return await ok({"id":"u-x","email":json.loads(body)["email"]})
  if path=="/auth/v1/recover": return await ok({})
  if path=="/auth/v1/logout": return await route.fulfill(status=204,body="")
  if path.startswith("/storage/v1/object/district-public/") and req.method=="POST":
    return await ok({"Key":path.split("/object/")[1]})
  if path=="/storage/v1/object/district-public" and req.method=="DELETE":
    return await ok([{"name":"x"}])
  if path.startswith("/storage/v1/object/district-files/") and req.method=="POST":
    return await ok({"Key":path.split("/object/")[1]})
  if path=="/rest/v1/rpc/copy_scenario": return await ok("copied-scenario-id")
  if path=="/rest/v1/rpc/apply_import": return await ok({"status":"applied"})
  if path=="/rest/v1/rpc/public_publication":
    b=json.loads(body)
    if b["p_slug"]=="ironwood-valley" and "d1" in PUB: return await ok({"district":D1,"kind":"board_plan","title":PUB["d1"]["title"],"published_at":"2026-09-29T12:00:00Z","payload":PUB["d1"]["payload"]})
    return await ok(None)
  t=path.split("/")[-1]
  if not em: return await ok({"message":"permission denied for table "+t,"code":"42501"},401)
  u=USERS[em]
  if t=="platform_admin": return await ok([{"user_id":u[0]}] if u[3] else [])
  if t=="profile": return await ok([{"user_id":x[0],"email":e,"full_name":x[1],"title":None} for e,x in USERS.items() if (x[0]==u[0] or "in." in url.query)] if req.method=="GET" else [{"user_id":u[0]}])
  if t=="district":
    if req.method=="GET" and em=="empty.staff@example.test": return await ok([])
    if req.method=="POST": b=json.loads(body); b["id"]="d9"; return await ok([b],201)
    if req.method=="PATCH": return await ok([dict(D1,**json.loads(body))])
    return await ok([D1,D2])
  if t=="district_member":
    if "user_id=eq." in url.query and "select=role,district" in url.query:
      dd={"d1":D1,"d2":D2}; return await ok([{"role":r,"district":dd[d]} for d,r in u[2]])
    if req.method=="PATCH" or req.method=="DELETE": return await ok([{"user_id":"x"}])
    did=q.get("district_id",["eq."])[0][3:]
    return await ok([{"user_id":x[0],"role":r,"created_at":"2026-09-01T00:00:00Z"} for e,x in USERS.items() for d,r in x[2] if d==did])
  if t=="invitation":
    if req.method=="POST": b=json.loads(body); b.update(id="inv2",created_at="2026-09-29T00:00:00Z",expires_at="2026-10-29T00:00:00Z"); return await ok([b],201)
    if req.method=="DELETE": return await ok([{"id":"inv1"}])
  if t=="publication" and req.method=="POST":
    pb=json.loads(body); PUB[pb["district_id"]]=pb; return await ok([dict(pb,id="pub1")],201)
  if t=="phase" and req.method=="POST" and DBFAIL["phase"]:
    return await ok({"code":"PGRST204","message":"Could not find the 'label' column of 'phase' in the schema cache"},400)
  if t in TABLES and req.method=="POST":
    b=json.loads(body)
    if isinstance(b,list) and len({tuple(sorted(x.keys())) for x in b})>1:   # like the real database
      return await ok({"code":"PGRST102","message":"All object keys must match"},400)
    return await ok(b if isinstance(b,list) else [b],201)
  if t in TABLES and req.method=="DELETE":
    return await ok([{"deleted":True}])
  if t in TABLES and req.method=="PATCH":
    return await ok([json.loads(body)])
  if t in TABLES:
    did=q.get("district_id",["eq.d1"])[0][3:]
    out=[r for r in TABLES[t] if r.get("district_id")==did]
    if "batch_id" in q:   # like the real database: amounts for one import, or a list of imports
      v=q["batch_id"][0]
      ids=v[4:-1].split(",") if v.startswith("in.(") else [v[3:]]
      out=[r for r in out if r.get("batch_id") in ids]
    return await ok(out)
  return await ok({"message":"unmocked "+t},404)

async def main():
  srv=subprocess.Popen(["python3","-m","http.server","8765"],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(0.8)
  errs=[]; R=[]
  def check(name,cond,detail=""): R.append((name,bool(cond),detail))
  async with async_playwright() as p:
    b=await p.chromium.launch()
    # 1. not configured
    pg=await b.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
    await pg.route("**/fonts.googleapis.com/**",lambda r:r.abort())
    async def blank(route): await route.fulfill(content_type="application/javascript",body="window.HG_CONFIG={supabaseUrl:'https://YOUR-PROJECT-ID.supabase.co',publishableKey:'YOUR-PUBLISHABLE-KEY'};")
    await pg.route("**/config.js",blank); await pg.goto("http://localhost:8765/"); await pg.wait_for_timeout(400)
    check("unconfigured shows setup message", "Not connected yet" in await pg.inner_text("body"))
    await pg.close()
    ctx=await b.new_context(viewport={"width":1360,"height":900})
    async def cfg(route): await route.fulfill(content_type="application/javascript",body="window.HG_CONFIG={supabaseUrl:'%s',publishableKey:'sb_publishable_TESTKEY_abcdefghijklmnop'};"%SB)
    await ctx.route("**/config.js",cfg); await ctx.route(SB+"/**",handler); await ctx.route("**/fonts.g*/**",lambda r:r.abort())
    pg=await ctx.new_page(); pg.on("dialog",lambda dl: asyncio.ensure_future(dl.accept(PROMPT["text"] if PROMPT["text"] is not None else dl.default_value) if dl.type=="prompt" else dl.accept())); pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append("console: "+m.text) if m.type=="error" and "fonts" not in m.text and "ERR_FAILED" not in m.text else None)
    await pg.goto("http://localhost:8765/"); await pg.wait_for_timeout(500)
    check("no session goes to sign in", "Sign in" in await pg.inner_text("h1"))
    await pg.screenshot(path=SHOTS+"/signin.png")
    await pg.fill("input[name=email]","admin@example.test"); await pg.fill("input[name=password]","wrong"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(400)
    check("wrong password message", "don't match" in (await pg.inner_text("#toasts")).replace("’","'"))
    await pg.fill("input[name=password]",PW); await pg.click("button[type=submit]"); await pg.wait_for_timeout(700)
    body=await pg.inner_text("body")
    check("access refresh runs on load", any("/rest/v1/rpc/claim_my_access" in c[1] for c in calls))
    check("admin lands on first district overview", "cottonwood-ridge/overview" in pg.url and "initiatives" in body, pg.url)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/overview/today"); await pg.wait_for_timeout(500); body=await pg.inner_text("body")
    check("overview live counts", "District baseline" in body)
    await pg.screenshot(path=SHOTS+"/overview.png",full_page=True)
    # every tab
    tabs=await pg.evaluate("""()=>{const out=[];document.querySelectorAll('.rail a[href^="#/d/"]').forEach(a=>out.push(a.getAttribute('href')));return out}""")
    visited=0; bad=[]
    secs=["overview/today","direction/priorities","direction/measures","direction/community","decisions/initiatives","decisions/ranking","decisions/scenarios","resources/summary","resources/general","resources/funds","resources/capital","resources/assumptions","progress/initiatives","progress/measures","progress/actuals","progress/uploads","reports/board","reports/community","reports/exports","settings/district","settings/people","settings/account","help/built"]
    for s in secs:
      await pg.goto("http://localhost:8765/#/d/ironwood-valley/"+s); await pg.wait_for_timeout(250)
      v=await pg.inner_text("#view"); visited+=1
      if "couldn’t load" in v or "Loading" in v: bad.append(s+": "+v[:80])
      if s in("resources/capital","settings/people","progress/uploads","resources/funds"): await pg.screenshot(path=SHOTS+"/"+s.replace("/","-")+".png",full_page=True)
    check("all 23 screens render", visited==23 and not bad, "; ".join(bad))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/funds"); await pg.wait_for_timeout(300)
    t=await pg.inner_text("#view"); check("latest balance only", "$2,150,000" in t and "$1\n" not in t)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/capital"); await pg.wait_for_timeout(500)
    t=await pg.inner_text("#view"); base=gold("orig",None)
    check("capital plan: board version gap matches the planner ($5.35M)", fmtK(base["gap"])=="$5.35M" and "$5.35M" in t and fmtK(base["need"]) in t, t[:300])
    check("capital plan: per-pupil and busiest year", "$11,836" in t and "FY2030" in t)
    await pg.screenshot(path=SHOTS+"/capital.png",full_page=True)
    await pg.click("input[data-lever=sf]"); await pg.wait_for_timeout(200)
    t=await pg.inner_text("#cap-results"); sf=gold("orig",{"sf":False})
    check("capital plan: SF 2472 off recomputes", fmtK(sf["gap"]) in t and "Gap to close" in t, fmtK(sf["gap"]))
    await pg.fill("input[data-lever=infl]","0.04"); await pg.dispatch_event("input[data-lever=infl]","input"); await pg.wait_for_timeout(200)
    t=await pg.inner_text("#cap-results")
    both=None
    await pg.click("button[data-action=capReset]"); await pg.wait_for_timeout(300)
    check("capital plan: reset returns to the scenario", "$5.35M" in await pg.inner_text("#cap-results"))
    sid=next(sc["id"] for sc in TABLES["scenario"] if not sc["is_board_version"])
    await pg.select_option("select[data-cap-scenario]",sid); await pg.wait_for_timeout(400)
    ph=gold("phased",None); t=await pg.inner_text("#view")
    check("capital plan: phased-bond scenario matches ($1.15M gap)", fmtK(ph["gap"])=="$1.15M" and "$1.15M" in t and "Bond" in t, fmtK(ph["gap"]))
    check("capital plan: complete, no unfinished parts left", "Still to come on this screen" not in t and "Projects by year" in t)
    TAXEXP=json.loads(subprocess.check_output(["node","-e","""
      const C=require('./capital.js'),E=require('./engine.js'),D=require('./demo_data.js'),T=require('./tax.js');let i=0;
      const R=C.demoRows(D['ironwood-valley'],'d1',()=>'00000000-0000-4000-8000-'+String(++i).padStart(12,'0'));
      const rows={district:{name:'x'},settings:R.district_settings[0],balances:R.fund_balance,debts:R.debt_obligation,scenarios:R.scenario,initiatives:R.initiative,phases:R.phase,funding:R.phase_funding,financing:R.financing,recurring:[]};
      const sc=R.scenario.find(s=>!s.is_board_version);const inp=C.buildInputs(rows,sc.id);const m=T.impact(inp.cfg,inp.levers,inp.tax);
      process.stdout.write(JSON.stringify({home:m.peak.home,fy:m.peak.fy,acre:m.peak.acre,rate:m.peak.rate}));"""],cwd=os.path.dirname(os.path.abspath(__file__))))
    tx=await pg.inner_text("#cap-tax")
    check("taxpayers: the phased-bond scenario's added cost for a $150,000 home and an acre", ("$%.2f a year"%TAXEXP["home"]) in tx and ("$%.2f an acre"%TAXEXP["acre"]) in tx and ("FY%d"%TAXEXP["fy"]) in tx and ("$%.4f"%TAXEXP["rate"]) in tx, tx[:300])
    await pg.locator("#cap-tax").screenshot(path=SHOTS+"/tax.png")
    # Phase 2E: table view and filters (phased scenario on screen)
    total_phases=sum(1 for p in TABLES["phase"] if p["scenario_id"]==_ph_sid)
    await pg.click("button[data-action=capView][data-v=table]"); await pg.wait_for_timeout(300)
    rows_n=await pg.locator("table.captable tbody tr").count()
    await pg.locator("#cap-filters").scroll_into_view_if_needed(); await pg.screenshot(path=SHOTS+"/captable.png")
    check("table view: the switch shows which view is on", await pg.get_attribute("button[data-action=capView][data-v=table]","aria-pressed")=="true")
    check("table view: one row per phase, with totals", rows_n==total_phases and "phases" in await pg.inner_text("table.captable tfoot"), f"{rows_n} vs {total_phases}")
    await pg.select_option("select[data-cap-filter=tier]","must"); await pg.wait_for_timeout(300)
    must_rows=await pg.locator("table.captable tbody tr").count()
    tiers=await pg.locator("table.captable tbody tr td:nth-child(4)").all_inner_texts()
    check("filters: priority", 0<must_rows<total_phases and all(x=="Must-have" for x in tiers) and "Showing %d of %d phases"%(must_rows,total_phases) in await pg.inner_text("#cap-years"), str(must_rows))
    await pg.select_option("select[data-cap-filter=tier]",""); await pg.fill("input[data-cap-filter=q]","roof"); await pg.wait_for_timeout(300)
    names=await pg.locator("table.captable tbody tr td:nth-child(2)").all_inner_texts()
    check("filters: search as you type, without losing the search box", names and all("roof" in n.lower() for n in names) and await pg.evaluate("document.activeElement && document.activeElement.matches('[data-cap-filter=q]')"), str(names))
    async with pg.expect_download() as dl: await pg.click("button[data-action=capDownload]")
    f=await dl.value; csvtext=open(await f.path(),encoding="utf-8").read()
    check("table view: download the filtered table", csvtext.startswith("FY,Initiative,Phase,Priority") and csvtext.count("\n")==len(names)+1, csvtext[:120])
    await pg.click("a[data-action=capClearFilters]"); await pg.click("button[data-action=capView][data-v=cards]"); await pg.wait_for_timeout(300)
    await pg.select_option("select[data-cap-filter=fund]","ppel"); await pg.wait_for_timeout(300)
    check("filters: apply to the cards too", "Showing" in await pg.inner_text("#cap-years") and "Year totals still include everything" in await pg.inner_text("#cap-years"))
    await pg.click("a[data-action=capClearFilters]"); await pg.wait_for_timeout(200)
    check("filters: clearing resets the filter menus too", await pg.input_value("select[data-cap-filter=fund]")=="" and await pg.input_value("input[data-cap-filter=q]")=="")
    check("taxpayers: says when a bond's levy ends, past the plan", "continues past the plan’s last year, through FY2050" in tx)
    check("taxpayers: says it's the added cost, and that a bond needs a vote", "added cost only" in tx.lower() and "needs a public vote" in tx)
    # scenario work
    board_id=next(sc["id"] for sc in TABLES["scenario"] if sc["is_board_version"]); phased_id=sid
    await pg.select_option("select[data-cap-scenario]",board_id); await pg.wait_for_timeout(400)
    t=await pg.inner_text("#view")
    check("phase names: shown on the year cards", "· Unit ventilators" in t)
    check("taxpayers: no bond, no new levy, says so", "adds no property tax" in await pg.inner_text("#cap-tax"))
    check("locked scenario: read-only, admin can unlock", "This scenario is locked" in t and await pg.locator(".ylist a").count()==0
          and await pg.locator("button[data-action=unlockScenario]").count()==1 and await pg.locator("button[data-action=deleteScenario]").count()==0
          and await pg.locator("button[data-action=saveLevers]").count()==0)
    await pg.select_option("select[data-cap-scenario]",phased_id); await pg.wait_for_timeout(400)
    links=pg.locator(".ylist a[data-action=editProject]")
    check("unlocked scenario: projects open for editing", await links.count()>=15)
    await pg.click(".ylist a:has-text('Middle school HVAC replacement')"); await pg.wait_for_timeout(300)
    check("editor: opens with the project's phases", await pg.locator("[data-modal] [data-phase-row]").count()==2 and await pg.input_value("[data-modal] input[name=name]")=="Middle school HVAC replacement")
    await pg.screenshot(path=SHOTS+"/editor.png")
    first=pg.locator("[data-modal] [data-phase-row]").first
    await first.locator("input[name=pct]").first.fill("60"); n0=len(calls)
    await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(300)
    check("editor: a split that doesn't add to 100% is caught", "add to 60%" in await pg.inner_text("[data-modal] [data-form-errors]") and not any(c[0] in("POST","PATCH","DELETE") for c in calls[n0:]))
    await first.locator("input[name=pct]").first.fill("100"); await first.locator("input[name=cost]").fill("950,000")
    # fund rows: add, even split, two-fund complement, remove
    await first.locator("button[data-action=addFund]").click()
    pv=lambda: first.locator("input[name=pct]").evaluate_all("els=>els.map(e=>e.value)")
    two=await pv()
    await first.locator("button[data-action=addFund]").click(); three=await pv()
    hidden=await first.locator("button[data-action=addFund]").is_hidden()
    await first.locator("[data-src] >> nth=2").locator("button[data-action=removeFund]").click()
    await first.locator("input[name=pct]").first.fill("70"); comp=await pv()
    await first.locator("[data-src] >> nth=1").locator("button[data-action=removeFund]").click(); one=await pv()
    check("funds: add gives 50/50, then 34/33/33, capped at three", two==["50","50"] and three==["34","33","33"] and hidden, str([two,three,hidden]))
    check("funds: with two, the other makes up the rest; removing goes back to 100", comp==["70","30"] and one==["100"], str([comp,one]))
    await first.locator("input[name=label]").fill("Design and bid")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    new=calls[n0:]; ops=[(c[0],c[1].split("?")[0].replace("/rest/v1/","")) for c in new if c[0] in ("POST","PATCH","DELETE")]
    phs=json.loads(next(c[2] for c in new if c[0]=="POST" and c[1].startswith("/rest/v1/phase?") or (c[0]=="POST" and c[1]=="/rest/v1/phase?")))
    delq=next((c[1] for c in new if c[0]=="DELETE" and "/rest/v1/phase?" in c[1]),"")
    delq="scenario_id=eq."+phased_id if "id=in.(" in delq else delq
    check("phase names: saved with the phase", phs[0].get("label")=="Design and bid", str(phs[0]))
    # if the database is missing an update, the message is plain and nothing is removed
    DBFAIL["phase"]=True
    await pg.click(".ylist a:has-text('Middle school HVAC replacement')"); await pg.wait_for_timeout(300)
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(600)
    tt=(await pg.inner_text("#toasts")).replace("’","'")
    check("errors: database out of date is explained plainly", "HighGround's database needs an update before this can be saved. Nothing was changed." in tt and "schema cache" not in tt, tt[-200:])
    check("errors: a failed save removes nothing", not any(c[0]=="DELETE" for c in calls[n0:]))
    DBFAIL["phase"]=False
    await pg.click("[data-modal] button[data-action=closeModal] >> nth=0"); await pg.wait_for_timeout(200)
    check("editor: save updates details and replaces this scenario's phases", ops==[("PATCH","initiative"),("POST","phase"),("POST","phase_funding"),("POST","recurring_cost"),("DELETE","phase"),("DELETE","recurring_cost")]
          and phs[0]["cost"]==950000 and ("scenario_id=eq."+phased_id) in delq, str(ops))
    await pg.click("button[data-action=editProject][data-id='']"); await pg.wait_for_timeout(300)
    await pg.fill("[data-modal] input[name=name]","Library HVAC")
    row=pg.locator("[data-modal] [data-phase-row]").first
    await row.locator("select[name=fy]").select_option("2029"); await row.locator("input[name=cost]").fill("50000")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    ops=[c[1].split("?")[0].replace("/rest/v1/","") for c in calls[n0:] if c[0]=="POST"]
    newph=json.loads(next(c[2] for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/phase"))
    check("add a project: new project joins this scenario", ops==["initiative","scenario_initiative","phase","phase_funding"] and newph[0]["fy"]==2029 and newph[0]["scenario_id"]==phased_id, str(ops))
    # picker: add an existing initiative that isn't in this scenario
    await pg.click("button[data-action=editProject][data-id='']"); await pg.wait_for_timeout(300)
    check("picker: existing initiatives not in this scenario are offered", await pg.locator("[data-modal] select[data-pick-init] option", has_text="FFA program").count()==1)
    await pg.select_option("[data-modal] select[data-pick-init]","ini-ffa"); await pg.wait_for_timeout(300)
    check("picker: choosing one fills in its details", await pg.input_value("[data-modal] input[name=name]")=="FFA program" and "Add to this scenario" in await pg.inner_text("[data-modal] h2"))
    row=pg.locator("[data-modal] [data-phase-row]").first
    await row.locator("input[name=label]").fill("Shop buildout"); await row.locator("input[name=cost]").fill("150000")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    ops=[(c[0],c[1].split("?")[0].replace("/rest/v1/","")) for c in calls[n0:] if c[0] in ("POST","PATCH")]
    check("picker: saving adds it to the scenario without a duplicate", ("PATCH","initiative") in ops and ("POST","scenario_initiative") in ops and ("POST","initiative") not in ops, str(ops))
    # Phase 2B: yearly costs and programs without phases
    await pg.click("button[data-action=editProject][data-id='']"); await pg.wait_for_timeout(300)
    await pg.fill("[data-modal] input[name=name]","Library aide"); await pg.select_option("[data-modal] select[name=type]","staff")
    await pg.click("[data-modal] button[data-action=removePhaseRow]"); await pg.click("[data-modal] button[data-action=addYearlyRow]")
    yr=pg.locator("[data-modal] [data-yearly-row]").last
    await yr.locator("select[name=y_kind]").select_option("salary"); await yr.locator("select[name=y_fund]").select_option("general")
    await yr.locator("input[name=y_amount]").fill("32,000"); await yr.locator("select[name=y_first]").select_option("2028")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    ops=[c[1].split("?")[0].replace("/rest/v1/","") for c in calls[n0:] if c[0]=="POST"]
    rcp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/recurring_cost"]
    ini=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/initiative"]
    check("yearly costs: a hire with only yearly costs, no phases", ops==["initiative","scenario_initiative","recurring_cost"] and ini[0]["type"]=="staff"
          and rcp[0][0]["annual_amount"]==32000 and rcp[0][0]["fund"]=="general" and rcp[0][0]["first_fy"]==2028 and rcp[0][0]["last_fy"] is None, str(ops)+str(rcp))
    await pg.click("[data-action=editProject][data-id='"+_init0+"'] >> nth=0"); await pg.wait_for_timeout(300)
    check("yearly costs: editor shows the scenario's existing yearly cost", await pg.locator("[data-modal] [data-yearly-row]").count()==1 and await pg.input_value("[data-modal] input[name=y_amount]")=="12,000")
    await pg.fill("[data-modal] input[name=y_amount]","0"); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(300)
    check("yearly costs: a zero amount is caught", "amount per year" in await pg.inner_text("[data-modal] [data-form-errors]"))
    await pg.click("[data-modal] button[data-action=closeModal] >> nth=0"); await pg.wait_for_timeout(200)
    t=await pg.inner_text("#cap-yearly")
    check("capital plan: yearly costs card", "Yearly costs" in t and "FY2028" in t and "$12k" in t and "PPEL" in t, t[:200])
    await pg.click("button[data-action=editFinancing][data-id='']"); await pg.wait_for_timeout(300)
    await pg.select_option("[data-modal] select[name=kind]","lease"); await pg.fill("[data-modal] input[name=amount]","300,000")
    await pg.fill("[data-modal] input[name=rate]","5"); await pg.fill("[data-modal] input[name=years]","5")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(700)
    fp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/financing"]
    check("financing: lease saved, repaid from PPEL", fp and fp[0]["kind"]=="lease" and fp[0]["repay_from"]=="ppel" and fp[0]["rate"]==0.05 and fp[0]["amount"]==300000 and fp[0]["scenario_id"]==phased_id, str(fp))
    await pg.click("input[data-lever=sf]"); n0=len(calls)
    await pg.click("button[data-action=saveLevers]"); await pg.wait_for_timeout(600)
    lp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/scenario?id=eq."+phased_id in c[1]]
    check("levers: saved to the scenario", lp and lp[0]["lever_sf2472"] is False and lp[0]["lever_ppel_growth"]==0.035, str(lp))
    n0=len(calls); await pg.click("button[data-action=copyScenario]"); await pg.wait_for_timeout(600)
    cp=[json.loads(c[2]) for c in calls[n0:] if "rpc/copy_scenario" in c[1]]
    check("copy: makes a new scenario from this one", cp and cp[0]["p_source"]==phased_id and cp[0]["p_name"].endswith("(copy)"), str(cp))
    await pg.select_option("select[data-cap-scenario]",phased_id); await pg.wait_for_timeout(400)
    n0=len(calls); await pg.click("button[data-action=makeBoard]"); await pg.wait_for_timeout(700)
    bp=[(c[1].split("id=eq.")[1], json.loads(c[2])) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/scenario?" in c[1]]
    check("board version: old one cleared first, then the new one set", bp==[(board_id,{"is_board_version":False}),(phased_id,{"is_board_version":True})], str(bp))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/reports/community"); await pg.wait_for_timeout(400)
    check("community page: nothing published yet", "Nothing is published" in await pg.inner_text("#view"))
    n0=len(calls); await pg.click("button[data-action=publishBoard]"); await pg.wait_for_timeout(700)
    pp=[c for c in calls[n0:] if c[0]=="POST" and "/rest/v1/publication" in c[1]]
    pl=json.loads(pp[0][2])["payload"] if pp else {}
    check("publish: sends the board version as a frozen copy", pp and len(pl.get("projects",[]))==16 and pl["settings"]["save"]["receipts"]==1420000 and json.loads(pp[0][2])["kind"]=="board_plan", str(len(pl.get("projects",[]))))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/initiatives"); await pg.wait_for_timeout(300)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/direction/priorities"); await pg.wait_for_timeout(400)
    await pg.click("text=Add a priority"); await pg.wait_for_timeout(200)
    check("not-built button throws and shows message", "Adding priorities isn't built yet (planned for Phase 5)" in (await pg.inner_text("#toasts")).replace("’","'"))
    # invite
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/people"); await pg.wait_for_timeout(400)
    await pg.fill("form[data-form=invite] input[name=email]","New.Person@Example.test"); await pg.select_option("form[data-form=invite] select","editor")
    await pg.click("form[data-form=invite] button"); await pg.wait_for_timeout(400)
    post=[c for c in calls if c[0]=="POST" and "/rest/v1/invitation" in c[1]]
    check("invite posts lowercased email and role", post and json.loads(post[-1][2])=={"district_id":"d1","email":"new.person@example.test","role":"editor"}, post[-1][2] if post else "")
    fnc=[c for c in calls if "/functions/v1/send-invitation" in c[1]]
    check("invite: emails the invitation through the server function", fnc and json.loads(fnc[-1][2])=={"invitation_id":"inv2"} and "Invitation emailed" in await pg.inner_text("#toasts"))
    FN["fail"]=True
    await pg.fill("form[data-form=invite] input[name=email]","second@example.test"); await pg.click("form[data-form=invite] button"); await pg.wait_for_timeout(500)
    check("invite: if the email can't go, says so and keeps the invitation", "Invitation saved, but not emailed" in await pg.inner_text("#toasts"))
    FN["fail"]=False
    n0=len(calls); await pg.click("button[data-action=resendInvite][data-id=inv1]"); await pg.wait_for_timeout(500)
    check("invite: send again", any("/functions/v1/send-invitation" in c[1] and json.loads(c[2])["invitation_id"]=="inv1" for c in calls[n0:]))
    t=await pg.inner_text("#view")
    check("access requests: listed for admins", "Asking for access" in t and "asker@example.test" in t and "New principal" in t)
    await pg.select_option("select[data-req-role=req1]","board"); n0=len(calls)
    await pg.click("button[data-action=approveRequest][data-id=req1]"); await pg.wait_for_timeout(600)
    ai=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and "/rest/v1/invitation" in c[1]]
    ap=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/access_request" in c[1]]
    check("access requests: approve invites them with the chosen role", ai==[{"district_id":"d1","email":"asker@example.test","role":"board"}] and ap and ap[0]["status"]=="approved", str(ai)+str(ap))
    await pg.click("text=Cancel"); await pg.wait_for_timeout(300)
    check("cancel invitation sends delete", any(c[0]=="DELETE" and "invitation?id=eq.inv1" in c[1] for c in calls))
    await pg.select_option("select[data-role-for='u-viewer']","editor"); await pg.wait_for_timeout(300)
    check("role change sends patch", any(c[0]=="PATCH" and "district_member" in c[1] and '"editor"' in (c[2] or "") for c in calls))
    # district save
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/district"); await pg.wait_for_timeout(300)
    await pg.fill("input[name=county]","Harrison-free County"); await pg.click("form[data-form=saveDistrict] button[type=submit]"); await pg.wait_for_timeout(400)
    check("district save sends patch", any(c[0]=="PATCH" and "/rest/v1/district?" in c[1] and "Harrison-free" in (c[2] or "") for c in calls))
    await pg.fill("input[name=allowed_domains]","@IronwoodValley.k12.ia.us, ivcsd.org"); await pg.select_option("select[name=domain_role]","board")
    n0=len(calls); await pg.click("form[data-form=saveDistrict] button[type=submit]"); await pg.wait_for_timeout(500)
    dp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/district?" in c[1]]
    check("domain allow-list: saved with role", dp and dp[0]["allowed_domains"]==["IronwoodValley.k12.ia.us","ivcsd.org"] and dp[0]["domain_role"]=="board", str(dp))
    # switch district: admin is viewer in d2
    await pg.select_option("select[data-switch]","cottonwood-ridge"); await pg.wait_for_timeout(500)
    await pg.goto("http://localhost:8765/#/d/cottonwood-ridge/settings/people"); await pg.wait_for_timeout(400)
    t=await pg.inner_text("#view"); check("viewer role hides invite form", "Invite someone" not in t and "Only a district admin" in t)
    await pg.goto("http://localhost:8765/#/d/no-such-district/overview/today"); await pg.wait_for_timeout(300)
    check("unknown district message", "don’t have access" in await pg.inner_text("body"))
    # uploads: projects (CSV), errors, Excel, balances, template
    import openpyxl, io
    TEMPLATE=subprocess.check_output(["node","-e","process.stdout.write(require('./uploads.js').projectTemplate(2027))"],cwd=os.path.dirname(os.path.abspath(__file__)))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/uploads"); await pg.wait_for_timeout(400)
    await pg.select_option("select[data-upload-kind]","projects")
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"projects.csv","mimeType":"text/csv","buffer":TEMPLATE}]); await pg.wait_for_timeout(500)
    t=await pg.inner_text("#upload-review")
    check("upload: review shows what was read", "4 projects, 5 phases" in t and "midpoint" in t and "Track resurface" in t, t[:200])
    await pg.screenshot(path=SHOTS+"/upload-review.png",full_page=True)
    n0=len(calls); await pg.click("button[data-action=applyUpload]"); await pg.wait_for_timeout(900)
    new=calls[n0:]; seq=[(c[0], c[1].split("?")[0].replace("/rest/v1/","").replace("/storage/v1/object/","storage:")) for c in new if c[0] in ("POST","PATCH")]
    names=[x[1] if not x[1].startswith("storage:") else "storage" for x in seq]
    want=["storage","import_batch","import_row","import_issue","initiative","scenario","scenario_initiative","phase","phase_funding","rpc/apply_import"]
    check("upload: file kept, batch recorded, scenario built, then applied", names==want, str(names))
    body=lambda t: json.loads(next(c[2] for c in new if c[0]=="POST" and c[1].split("?")[0].endswith("/"+t)))
    ph=body("phase"); fu=body("phase_funding"); sc=body("scenario"); bt=body("import_batch")
    check("upload: 5 phases with absolute years, 7 fund splits", len(ph)==5 and sorted(p["fy"] for p in ph)==[2027,2028,2028,2030,2031] and len(fu)==7, str([p["fy"] for p in ph]))
    check("upload: new scenario, not the board version (one exists)", sc["is_board_version"] is False and sc["name"].startswith("Uploaded"), str(sc))
    check("upload: batch points at the stored file", bt["storage_path"].startswith("d1/imports/") and bt["status"]=="review" and bt["kind"]=="projects")
    check("upload: lands on the capital plan", "/resources/capital" in pg.url)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/uploads"); await pg.wait_for_timeout(400)
    bad=b"Project,FY,Estimate,Funding source\r\nFar away,FY2040,1000,SAVE\r\n"
    await pg.select_option("select[data-upload-kind]","projects")
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"bad.csv","mimeType":"text/csv","buffer":bad}]); await pg.wait_for_timeout(400)
    check("upload: errors block Apply", "outside this plan" in await pg.inner_text("#upload-review") and await pg.is_disabled("button[data-action=applyUpload]"))
    wb=openpyxl.Workbook(); ws=wb.active
    for r in [["Project","FY","Estimate","Funding source","Funding %"],["Chiller replacement","FY2029",640000,"SAVE",1],["Parking lot","2030-31","$95k","PPEL",1]]: ws.append(r)
    bio=io.BytesIO(); wb.save(bio)
    await pg.select_option("select[data-upload-kind]","projects")
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"projects.xlsx","mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","buffer":bio.getvalue()}]); await pg.wait_for_timeout(600)
    t=await pg.inner_text("#upload-review")
    check("upload: Excel files are read", "2 projects" in t and "Chiller replacement" in t and "FY2031: $95,000" in t, t[:200])
    await pg.click("button[data-action=cancelUpload]")
    await pg.select_option("select[data-upload-kind]","balances")
    balcsv=b"Fund,Iowa fund code,Balance,As-of date\r\nSAVE,33,\"$2,300,000\",6/30/2026\r\nPPEL,36,410000,\r\n"
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"balances.csv","mimeType":"text/csv","buffer":balcsv}]); await pg.wait_for_timeout(400)
    check("upload: balances review with date from the file", await pg.input_value("input[data-upload-asof]")=="2026-06-30")
    n0=len(calls); await pg.click("button[data-action=applyUpload]"); await pg.wait_for_timeout(800)
    fb=[c for c in calls[n0:] if c[0]=="POST" and "/rest/v1/fund_balance?on_conflict=" in c[1]]
    fbb=json.loads(fb[0][2]) if fb else []
    check("upload: balances saved as an upload, linked to the batch", len(fbb)==4 and next(x for x in fbb if x["fund"]=="save")["amount"]==2300000 and all(x["source"]=="upload" and x["import_batch_id"] for x in fbb))
    async with pg.expect_download() as dl:
      await pg.click("a[data-action=downloadTemplate][data-kind=projects]")
    d=await dl.value
    check("upload: template downloads", d.suggested_filename=="highground-projects-template.csv")
    # Phase 3A: monthly GL export
    GLCSV=subprocess.check_output(["node","-e","process.stdout.write(require('./uploads.js').toCSV(require('./gl.js').sampleExport()))"],cwd=os.path.dirname(os.path.abspath(__file__)))
    TABLES["gl_account"]=[]; TABLES["gl_amount"]=[]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/overview/today"); await pg.wait_for_timeout(200)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/uploads"); await pg.wait_for_timeout(500)
    check("GL: offered first to business staff", await pg.input_value("select[data-upload-kind]")=="gl_monthly")
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"gl-2026-09.csv","mimeType":"text/csv","buffer":GLCSV}]); await pg.wait_for_timeout(600)
    rv=await pg.inner_text("#upload-review")
    check("GL: every account is new the first time, each with a suggestion", "21 new accounts to check" in rv and "SAVE spending, facilities acquisition" in rv, rv[:300])
    await pg.fill("input[data-upload-asof]","2026-09-30"); await pg.dispatch_event("input[data-upload-asof]","change"); await pg.wait_for_timeout(200)
    bal=await pg.inner_text("#gl-balances")
    check("GL: balances previewed before applying (fund balance + revenue − spending)", "$1,309,086" in bal and "$788,200" in bal and "Will update" in bal and "Sep 30, 2026" in bal, bal[:400])
    await pg.locator("#upload-review").screenshot(path=SHOTS+"/gl-review.png")
    await pg.select_option("select[data-gl-map='33-0000-000-0000-101']","fund_balance"); await pg.wait_for_timeout(200)
    check("GL: changing an account updates the preview at once", "$2,510,968" in await pg.inner_text("#gl-balances"))
    await pg.select_option("select[data-gl-map='33-0000-000-0000-101']","ignore"); await pg.wait_for_timeout(200)
    n0=len(calls); await pg.click("button[data-action=applyUpload]"); await pg.wait_for_timeout(1200)
    new=calls[n0:]
    ib=[json.loads(c[2]) for c in new if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/import_batch"]
    ga=[json.loads(c[2]) for c in new if c[0]=="POST" and c[1].startswith("/rest/v1/gl_account")]
    gm=[json.loads(c[2]) for c in new if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/gl_amount"]
    lay=[json.loads(c[2]) for c in new if c[0]=="PATCH" and "/rest/v1/district_settings?" in c[1]]
    check("GL: the import is kept, dated, as a monthly GL", ib and ib[0]["kind"]=="gl_monthly" and ib[0]["period_end"]=="2026-09-30" and ib[0]["fiscal_year"]==2027, str(ib)[:200])
    check("GL: accounts saved with what they are, and not asked about again", ga and len(ga[0])==21 and "on_conflict=district_id%2Ccode" in next(c[1] for c in new if c[1].startswith("/rest/v1/gl_account"))
          and next(a for a in ga[0] if a["code"]=="33-0000-000-0000-101")["maps_to"]=="ignore" and all(not a["needs_review"] for a in ga[0]), str(ga)[:300])
    ids={a["code"]:a["id"] for a in ga[0]} if ga else {}
    check("GL: every month's amounts saved against their accounts", gm and len(gm[0])==21 and all(x["account_id"] in ids.values() for x in gm[0]) and any(x["ytd_amount"]==295236 for x in gm[0]))
    check("GL: the layout is remembered", lay and lay[0]["gl_layout"]["cols"]["ytd"]==3)
    check("GL: applied, with the balances it updated named", any("rpc/apply_import" in c[1] for c in new) and "Balances updated: SAVE, PPEL, Debt Service, General Fund" in await pg.inner_text("#toasts"))
    # month two: the same accounts and layout are remembered
    TABLES["gl_account"]=[dict(a, needs_review=False) for a in ga[0]]
    for st0 in TABLES["district_settings"]: st0["gl_layout"]=lay[0]["gl_layout"]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/overview/today"); await pg.wait_for_timeout(200)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/uploads"); await pg.wait_for_timeout(500)
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"gl-2026-10.csv","mimeType":"text/csv","buffer":GLCSV}]); await pg.wait_for_timeout(600)
    rv=await pg.inner_text("#upload-review")
    check("GL: next month, nothing new to check, same layout", "No new accounts" in rv and "21 accounts matched from earlier months" in rv and "the same layout as last time" in rv, rv[:300])
    await pg.click("button[data-action=cancelUpload]"); await pg.wait_for_timeout(200)
    # a big first month: grouped and folded, with unrecognised accounts open
    TABLES["gl_account"]=[]
    lines=[GLCSV.decode().rstrip()]+["10-0%03d-1100-100-0000-111,Salaries building %d,1.00,%d.00,,"%(i,i,1000+i) for i in range(1,60)]+["XYZ-9,Odd account,1.00,5.00,,"]
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"big.csv","mimeType":"text/csv","buffer":("\r\n".join(lines)+"\r\n").encode()}]); await pg.wait_for_timeout(700)
    grp=pg.locator("details.glgroup")
    titles=await grp.locator("summary").all_inner_texts()
    opened=[await grp.nth(i).get_attribute("open") is not None for i in range(await grp.count())]
    check("GL: a long first month is grouped, unrecognised accounts first and open, the rest folded", titles and titles[0].startswith("Not recognised: 1 account") and opened[0] and not all(opened[1:]) and any(t.startswith("General Fund: spending, 6") for t in titles), str(list(zip(titles,opened)))[:300])
    await pg.click("button[data-action=cancelUpload]"); await pg.wait_for_timeout(200)
    TABLES["gl_account"]=[]; TABLES["gl_amount"]=[]
    # starting numbers
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/setup"); await pg.wait_for_timeout(500)
    v=await pg.input_value("input[name=save_receipts]"); g=await pg.input_value("input[name=ppel_growth]")
    check("setup: prefilled from the database", v=="1,420,000" and g=="3.5" and await pg.input_value("input[name=as_of]")=="2026-07-01", v+" "+g)
    await pg.screenshot(path=SHOTS+"/setup.png",full_page=True)
    await pg.fill("input[name=save_receipts]",""); n0=len(calls)
    await pg.click("form[data-form=saveSetup] button[type=submit]"); await pg.wait_for_timeout(300)
    err=await pg.inner_text("[data-setup-errors]")
    check("setup: missing SAVE receipts is caught before saving", "SAVE receipts is needed" in err and not any(c[0]=="POST" for c in calls[n0:]))
    await pg.fill("input[name=save_receipts]","$1,420,000"); await pg.fill("input[name=construction_inflation]","3")
    await pg.click("button[data-action=addDebtRow]")
    rows=pg.locator("[data-debt-body] [data-debt-row]"); last=rows.nth(await rows.count()-1)
    await last.locator("input[name=debt_name]").fill("Bus lease-purchase"); await last.locator("select[name=debt_fund]").select_option("ppel")
    await last.locator("input[name=debt_annual]").fill("45,000"); await last.locator("input[name=debt_final]").fill("2029")
    n0=len(calls); await pg.click("form[data-form=saveSetup] button[type=submit]"); await pg.wait_for_timeout(700)
    new=calls[n0:]
    st=[c for c in new if c[0]=="POST" and "/rest/v1/district_settings?on_conflict=district_id" in c[1]]
    fb=[c for c in new if c[0]=="POST" and "/rest/v1/fund_balance?on_conflict=" in c[1]]
    dp=[c for c in new if c[0]=="PATCH" and "/rest/v1/debt_obligation?" in c[1]]
    di=[c for c in new if c[0]=="POST" and c[1].startswith("/rest/v1/debt_obligation?")]
    ok1=False
    if st:
      sb=json.loads(st[0][2])[0]
      ok1=(sb["save_receipts"]==1420000 and sb["ppel_growth"]==0.035 and sb["construction_inflation"]==0.03 and sb["plan_start_fy"]==2027
           and sb["grants_yield"]==0.75 and sb["vppel_status"]=="active" and "merge-duplicates" in st[0][3])
    check("setup: saves settings with % converted and plan start derived", ok1, st[0][2][:200] if st else "no settings POST")
    check("setup: tax estimate settings saved", st and json.loads(st[0][2])[0].get("tax_home_value")==150000 and json.loads(st[0][2])[0].get("ag_value_per_acre")==2400, st[0][2][-200:] if st else "")
    fbb=json.loads(fb[0][2]) if fb else []
    check("setup: saves all four balances for the date", len(fbb)==4 and all(x["as_of"]=="2026-07-01" for x in fbb) and next(x for x in fbb if x["fund"]=="save")["amount"]==2150000)
    check("setup: updates the existing debt and adds the new one", len(dp)==1 and len(di)==1 and json.loads(di[0][2])["fund"]=="ppel" and json.loads(di[0][2])["annual_payment"]==45000)
    await pg.goto("http://localhost:8765/#/d/cottonwood-ridge/settings/setup"); await pg.wait_for_timeout(500)
    check("setup: read-only for a viewer", await pg.locator("form[data-form=saveSetup] button[type=submit]").count()==0 and await pg.is_disabled("input[name=save_receipts]"))
    # two-step sign-in: turning it on
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/account"); await pg.wait_for_timeout(400)
    await pg.click("button[data-action=mfaOn]"); await pg.wait_for_timeout(400)
    check("two-step: setup shows a QR code and the key", await pg.locator("[data-modal] img[alt^='QR code']").count()==1 and "JBSWY3DPEHPK3PXP" in await pg.inner_text("[data-modal]"))
    await pg.fill("[data-modal] input[name=code]","000000"); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(400)
    check("two-step: a wrong code is explained", "That code didn’t work" in await pg.inner_text("#toasts") and await pg.locator("[data-modal]").count()==1)
    await pg.fill("[data-modal] input[name=code]","123 456"); n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(600)
    seq=[c[1].split("?")[0] for c in calls[n0:] if "/factors/" in c[1]]
    check("two-step: challenge, then verify, then on", seq==["/auth/v1/factors/f1/challenge","/auth/v1/factors/f1/verify"] and "Two-step sign-in is on" in await pg.inner_text("#toasts"), str(seq))
    # Phase 2A: compare scenarios
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/scenarios"); await pg.wait_for_timeout(600)
    t=await pg.inner_text("#cmp-table")
    check("compare: both scenarios side by side with their gaps", "$5.35M" in t and "$1.15M" in t and "smallest" in t, t[:200])
    check("compare: added tax row", "Added tax, example home" in t and "/yr" in t)
    check("compare: yearly costs row", "Yearly costs (first year they start)" in t and "FY2028" in t and "$12k capital" in t, t[t.find("Yearly"):t.find("Yearly")+120])
    check("compare: what each asks of the community", "general-obligation bond of $4.20M in FY2030, which needs a public vote" in t and "not yet paid for" in t)
    w=await pg.inner_text("#cmp-why")
    check("compare: why the gap differs, in plain words", "lowers the gap by $4.20M" in w and "Financing adds" in w and "no effect on its own" in w, w[:300])
    await pg.screenshot(path=SHOTS+"/compare.png",full_page=True)
    boxes=pg.locator("[data-cmp-pick]")
    await boxes.nth(1).uncheck(); await pg.wait_for_timeout(300)
    check("compare: unticking a scenario removes its column", "$1.15M" not in await pg.inner_text("#cmp-table"))
    await boxes.nth(1).check(); await pg.wait_for_timeout(300)
    await pg.select_option("select[data-why=a]", index=1); await pg.wait_for_timeout(300)
    w=await pg.inner_text("#cmp-why")
    check("compare: either direction can be explained", "raises the gap by $4.20M" in w, w[:200])
    await pg.click("a[data-action=openScenario] >> nth=1"); await pg.wait_for_timeout(600)
    check("compare: Open goes to that scenario on the capital plan", "/resources/capital" in pg.url)
    # Phase 2B: All initiatives
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/initiatives"); await pg.wait_for_timeout(600)
    t=await pg.inner_text("#view")
    check("initiatives: status pipeline with counts", "All 17" in t.replace("\n"," ") and "Proposed 16" in t.replace("\n"," ") and "Approved 1" in t.replace("\n"," "), t[:200])
    check("initiatives: one-time and yearly costs from the board version", "One-time cost" in t and "$1.75M" in t and "District baseline, the board version" in t, t[:400])
    check("initiatives: which plans include each one", "Not in a plan yet" in t and "District baseline (board)" in t)
    await pg.select_option("select[data-ini-sid]", _ph_sid); await pg.wait_for_timeout(400)
    t2=await pg.inner_text("#view")
    check("initiatives: costs from any scenario, including yearly costs from the capital plan", "$12k" in t2 and "Costs are from Addition phased" in t2, t2[-300:])
    await pg.select_option("select[data-ini-sid]", label="District baseline (board version)"); await pg.wait_for_timeout(400)
    tv=await pg.inner_text("#view")
    check("initiatives: one priority, in the funding line's words", "Must-have" in tv and "Strategic" in tv and "\tHigh\t" not in tv)
    await pg.click("button[data-action=iniStatus][data-v=approved]"); await pg.wait_for_timeout(300)
    t=await pg.inner_text("#view")
    check("initiatives: filter by status, and approved-but-not-planned is flagged", "FFA program" in t and "Middle school HVAC" not in t and "Approved, but not in the board version yet" in t)
    await pg.click("a[data-action=editInitiative]:has-text('FFA program')"); await pg.wait_for_timeout(300)
    m=await pg.inner_text("[data-modal]")
    check("decisions editor: same details, costs optional", "Not in a plan yet" in m and "Apply to scenario" in m and await pg.locator("[data-modal] [data-phase-row]").count()==0)
    locked=await pg.locator("[data-modal] select[data-ed-scenario] option[disabled]").count()
    check("decisions editor: locked scenarios listed but can't be picked", locked==1 and "(locked)" in await pg.locator("[data-modal] select[data-ed-scenario] option[disabled]").inner_text())
    await pg.select_option("[data-modal] select[data-ed-scenario]", _ph_sid); await pg.wait_for_timeout(300)
    row=pg.locator("[data-modal] [data-phase-row]").first
    await row.locator("input[name=label]").fill("Chapter start-up fees"); await row.locator("input[name=cost]").fill("5000")
    await row.locator("button[data-action=addFund]").click()
    await pg.click("[data-modal] button[data-action=addYearlyRow]")
    yr=pg.locator("[data-modal] [data-yearly-row]").last
    await yr.locator("input[name=y_amount]").fill("65,000"); await yr.locator("select[name=y_first]").select_option("2028")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(900)
    ops=[(c[0],c[1].split("?")[0].replace("/rest/v1/","")) for c in calls[n0:] if c[0] in ("POST","PATCH","DELETE")]
    phs=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/phase"]
    fus=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/phase_funding"]
    pat=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/initiative?" in c[1]]
    check("decisions editor: Apply to scenario writes the costs there", ("POST","scenario_initiative") in ops and phs and phs[0][0]["scenario_id"]==_ph_sid
          and phs[0][0]["label"]=="Chapter start-up fees" and len(fus[0])==2 and ("POST","recurring_cost") in ops, str(ops))
    check("decisions editor: details saved too, including owner", pat and "owner_name" in pat[0] and pat[0]["name"]=="FFA program", str(pat)[:200])
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/initiatives"); await pg.wait_for_timeout(500)
    await pg.click("button[data-action=iniStatus][data-v='']"); await pg.wait_for_timeout(300)
    await pg.click("button[data-action=editInitiative][data-id='']"); await pg.wait_for_timeout(300)
    await pg.fill("[data-modal] input[name=name]","FFA program"); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(300)
    check("initiatives: a duplicate name is refused", "already an initiative called" in await pg.inner_text("[data-modal] [data-form-errors]"))
    await pg.fill("[data-modal] input[name=name]","Robotics club"); await pg.select_option("[data-modal] select[name=type]","program")
    await pg.select_option("[data-modal] select[name=status]","analysis"); await pg.fill("[data-modal] input[name=owner_name]","Ag teacher")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(600)
    ip=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/initiative"]
    check("initiatives: add with type, status and owner, details only", ip and ip[0]["type"]=="program" and ip[0]["status"]=="analysis" and ip[0]["owner_name"]=="Ag teacher"
          and not any(c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/phase" for c in calls[n0:]), str(ip))
    await pg.click("a[data-action=editInitiative] >> nth=0"); await pg.wait_for_timeout(300)
    await pg.select_option("[data-modal] select[name=status]","approved"); n0=len(calls)
    await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(500)
    check("initiatives: edit details", any(c[0]=="PATCH" and "/rest/v1/initiative?" in c[1] and '"approved"' in (c[2] or "") for c in calls[n0:]))
    await pg.screenshot(path=SHOTS+"/initiatives.png",full_page=True)
    # Phase 2C: ranking and the funding line
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/ranking"); await pg.wait_for_timeout(700)
    t=await pg.inner_text("#view")
    check("ranking: one list, must-have first, with the funding-line verdict", "Everything fits" in t and "#1" in t and t.find("Must-have")<t.find("Strategic")<t.find("Nice to have"), t[:300])
    check("ranking: campaign/bond and boosters called out separately, matching the gap", "$5.35M depends on a campaign or bond" in t and "$260k on boosters" in t and "Campaign or bond" in t, t[:500])
    check("ranking: priorities are the initiatives' own (no separate tier)", "Priority" in t and "from the old High/Med/Low" not in t)
    check("ranking: locked scenario can't be reordered", await pg.locator("button[data-action=rankMove]").count()==0 and "This scenario is locked" in t)
    await pg.screenshot(path=SHOTS+"/ranking.png",full_page=True)
    await pg.select_option("select[data-rank-sid]", _ph_sid); await pg.wait_for_timeout(600)
    check("ranking: unlocked scenario has move buttons", await pg.locator("button[data-action=rankMove]").count()>0)
    first_down=pg.locator("button[data-action=rankMove][data-d='1']").first
    moved_id=await first_down.get_attribute("data-id")
    n0=len(calls); await first_down.click(); await pg.wait_for_timeout(600)
    up=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and "/rest/v1/scenario_initiative?on_conflict=" in c[1]]
    check("ranking: moving saves the new order for the scenario", up and up[0][1]["initiative_id"]==moved_id and up[0][0]["rank"]==1 and up[0][1]["rank"]==2 and all(r["scenario_id"]==_ph_sid for r in up[0]), str(up[0][:2]) if up else "none")
    n0=len(calls); await pg.select_option("select[data-rank-tier] >> nth=0", "strategic"); await pg.wait_for_timeout(600)
    check("ranking: changing a tier saves it on the initiative", any(c[0]=="PATCH" and "/rest/v1/initiative?" in c[1] and '"strategic"' in (c[2] or "") for c in calls[n0:]))
    check("ranking: nothing to defer when everything fits", "Nothing needs deferring" in await pg.inner_text("#view") and await pg.locator("button[data-action=rankScenario]").count()==0)
    # starting numbers: checks
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/setup"); await pg.wait_for_timeout(700)
    ck=pg.locator("[data-setup-checks]")
    t=await ck.inner_text()
    check("checks: shown on arrival, as tips, with nothing wrong yet", await ck.is_visible() and "Worth a second look" in t and "don’t match" not in t and "5% debt limit" in t, t[:300])
    await pg.fill("input[name=ppel_receipts]","100,000"); await pg.wait_for_timeout(150)
    check("checks: PPEL receipts that don't match rate × valuation", "PPEL receipts ($100,000) don’t match" in await ck.inner_text())
    await pg.fill("input[name=save_receipts_fy]",""); await pg.wait_for_timeout(150)
    check("checks: a blank SAVE receipts year", "Say which fiscal year the SAVE receipts are for" in await ck.inner_text())
    await pg.fill("input[name=enrollment]","300"); await pg.wait_for_timeout(150)
    check("checks: SAVE per student far from the statewide amount", "per student; SAVE is shared statewide at about $1,358" in await ck.inner_text())
    while await pg.locator("button[data-action=removeDebtRow]").count(): await pg.locator("button[data-action=removeDebtRow]").first.click()
    await pg.wait_for_timeout(150)
    await ck.screenshot(path=SHOTS+"/checks.png")
    check("checks: no existing debt is questioned", "No existing debt entered" in await ck.inner_text())
    check("checks: where-to-find hints on the fields", "certified budget (Iowa Department of Management)" in await pg.inner_text("#view"))
    # Phase 2E: assumption sets
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/assumptions"); await pg.wait_for_timeout(600)
    check("assumption sets: none yet, with starters offered", "No assumption sets yet" in await pg.inner_text("#view"))
    n0=len(calls); await pg.click("button[data-action=starterSets]"); await pg.wait_for_timeout(600)
    sp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="POST" and "/rest/v1/assumption_set" in c[1]]
    check("assumption sets: Base, Conservative and Growth made from the starting numbers", sp and [x["name"] for x in sp[0]]==["Base","Conservative","Growth"]
          and sp[0][0]["is_default"] and sp[0][1]["construction_inflation"]>sp[0][0]["construction_inflation"] and sp[0][2]["ppel_growth"]>sp[0][0]["ppel_growth"], str(sp)[:300])
    TABLES["assumption_set"]=[{"id":"as-c","district_id":"d1","name":"Conservative","is_default":False,"construction_inflation":0.05,"save_trend":-0.01,"ppel_growth":0.02,"grant_yield":0.5,"settlement_pct":0.04,"notes":"Tougher"}]
    for sc in TABLES["scenario"]:
      if sc["id"]==_ph_sid: sc["assumption_set_id"]="as-c"; sc["lever_inflation"]=None
    await pg.reload(); await pg.wait_for_timeout(900)
    t=await pg.inner_text("#view")
    check("assumption sets: listed with values and the scenarios using them", "Conservative" in t and "5%" in t and "Addition phased" in t)
    await pg.click("a[data-action=editSet]"); await pg.wait_for_timeout(300)
    await pg.fill("[data-modal] input[name=construction_inflation]","6"); n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(500)
    check("assumption sets: edit saves percentages as fractions", any(c[0]=="PATCH" and "/rest/v1/assumption_set?" in c[1] and json.loads(c[2])["construction_inflation"]==0.06 for c in calls[n0:]))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/capital"); await pg.wait_for_timeout(500)
    await pg.select_option("select[data-cap-scenario]",_ph_sid); await pg.wait_for_timeout(500)
    check("capital plan: the scenario's set drives its levers", "Conservative" in await pg.inner_text("#cap-levers") and (await pg.inner_text("[data-lever-val=infl]")).startswith("5"), await pg.inner_text("[data-lever-val=infl]"))
    n0=len(calls); await pg.select_option("select[data-cap-set]",""); await pg.wait_for_timeout(600)
    pp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/scenario?" in c[1]]
    check("capital plan: choosing assumptions clears saved levers so the choice applies", pp and pp[0]["assumption_set_id"] is None and pp[0]["lever_inflation"] is None and pp[0]["lever_ppel_growth"] is None, str(pp))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/decisions/scenarios"); await pg.wait_for_timeout(600)
    check("compare: which assumptions each scenario uses", "Assumptions" in await pg.inner_text("#cmp-table") and "Conservative" in await pg.inner_text("#cmp-table"))
    TABLES["assumption_set"]=[]
    for sc in TABLES["scenario"]:
      if sc["id"]==_ph_sid: sc["assumption_set_id"]=None
    # Phase 3B: Progress → Initiatives
    TABLES["gl_account"]=[]; TABLES["gl_amount"]=[]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/initiatives"); await pg.wait_for_timeout(700)
    t=await pg.inner_text("#view")
    check("progress: against the board version, before any ledger", "No monthly ledger for FY2027 yet" in t and "District baseline" in t and "Middle school HVAC replacement" in t and "$900,000" in t, t[:400])
    GL=json.loads(subprocess.check_output(["node","-e","""
      const G=require('./gl.js');const P=G.parse(G.sampleExport());
      process.stdout.write(JSON.stringify(P.lines.map((l,k)=>Object.assign({id:'gla'+k,district_id:'d1',code:l.code,description:l.description,project_code:l.parts.project||null,function_code:l.parts.function||null,initiative_id:null,needs_review:false,_ytd:l.ytd,_enc:l.encumbered,_bud:l.budget},G.suggest(l.parts)))))"""],cwd=os.path.dirname(os.path.abspath(__file__))))
    TABLES["gl_account"]=[{k:v for k,v in a.items() if not k.startswith("_")} for a in GL]
    TABLES["gl_amount"]=[{"district_id":"d1","batch_id":"glb1","account_id":a["id"],"ytd_amount":a["_ytd"],"encumbered":a["_enc"],"budget_amount":a["_bud"]} for a in GL]
    TABLES["import_batch"]=TABLES["import_batch"]+[{"id":"glb1","district_id":"d1","kind":"gl_monthly","status":"applied","period_end":"2026-09-30","fiscal_year":2027,"file_name":"gl.csv","row_count":21,"uploaded_at":"2026-10-01T10:00:00Z"}]
    await pg.reload(); await pg.wait_for_timeout(900)
    t=await pg.inner_text("#view")
    roof_init=next(i["id"] for i in TABLES["initiative"] if i["name"].startswith("High school roof"))
    roof_acct=next(a["id"] for a in GL if a["code"]=="33-0000-4700-000-1001-450")
    check("progress: link card suggests initiatives for capital spending", "Link spending to initiatives" in t and await pg.input_value("select[data-pi-link='%s']"%roof_acct)==roof_init and "through Sep 30, 2026" in t, t[:300])
    check("progress: debt payments and General Fund aren't offered for linking", await pg.locator("select[data-pi-link='%s']"%next(a["id"] for a in GL if a["code"]=="36-0000-5000-000-0000-831")).count()==0
          and await pg.locator("select[data-pi-link='%s']"%next(a["id"] for a in GL if a["code"].startswith("10-0109"))).count()==0)
    n0=len(calls); await pg.click("button[data-action=piLinkAll]"); await pg.wait_for_timeout(900)
    lk=[(c[1].split("id=eq.")[1], json.loads(c[2])) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/gl_account?" in c[1]]
    check("progress: Link all suggested links each, as initiative spending", lk and any(i==roof_acct and b=={"initiative_id":roof_init,"maps_to":"initiative"} for i,b in lk), str(lk)[:300])
    for a in TABLES["gl_account"]:
      if a["id"]==roof_acct: a["initiative_id"]=roof_init; a["maps_to"]="initiative"
    await pg.reload(); await pg.wait_for_timeout(900)
    t=await pg.inner_text("table.pitable")
    check("progress: spending and encumbrances from the ledger, flagged when nothing was planned this year", "$262,750" in t and "$147,250" in t and "Spending, but nothing planned this year" in t, t[:500])
    await pg.click("a[data-action=piOpen][data-id='%s']"%roof_init); await pg.wait_for_timeout(500)
    await pg.locator("#view").screenshot(path=SHOTS+"/progress.png")
    first=pg.locator("tr[data-pi-phase]").first
    await first.locator("select[name=status]").select_option("done"); await first.locator("input[name=actual]").fill("")
    await first.locator("button[data-action=piSavePhase]").click(); await pg.wait_for_timeout(300)
    check("progress: done needs an actual cost", "Enter the actual cost when a phase is done" in (await pg.inner_text("#toasts")).replace("’","'").replace("'","’"))
    TABLES_ph=[p for p in TABLES["phase"] if p["initiative_id"]==roof_init and p["scenario_id"]!=_ph_sid]
    await first.locator("input[name=done]").fill("2026-09-25"); await first.locator("input[name=actual]").fill("401,500")
    n0=len(calls); await first.locator("button[data-action=piSavePhase]").click(); await pg.wait_for_timeout(600)
    sp=[json.loads(c[2]) for c in calls[n0:] if "rpc/set_phase_progress" in c[1]]
    check("progress: recorded through the progress-only function, even on the locked plan", sp and sp[0]["p_status"]=="done" and sp[0]["p_actual"]==401500 and sp[0]["p_done"]=="2026-09-25" and sp[0]["p_phase"]==sorted(TABLES_ph,key=lambda p:(p["fy"],p["seq"]))[0]["id"], str(sp))
    # Phase 3C: budget vs. actual (ledger still loaded from the progress tests); 3D adds an August import to compare
    TABLES["import_batch"]=TABLES["import_batch"]+[{"id":"glb0","district_id":"d1","kind":"gl_monthly","status":"applied","period_end":"2026-08-31","fiscal_year":2027,"file_name":"gl-aug.csv","row_count":21,"uploaded_at":"2026-09-10T10:00:00Z"}]
    TABLES["gl_amount"]=TABLES["gl_amount"]+[dict(g, batch_id="glb0", ytd_amount=(g["ytd_amount"] or 0)/2, encumbered=0) for g in TABLES["gl_amount"] if g["batch_id"]=="glb1"]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/actuals"); await pg.wait_for_timeout(800)
    t=await pg.inner_text("#view")
    check("budget: every fund, General Fund first, from the ledger through the month end", "Every fund" in t and t.find("General Fund")<t.find("SAVE")<t.find("PPEL") and "Sep 30, 2026" in t and "25% of the fiscal year gone" in t, t[:300])
    check("budget: by default, the year ends at budget unless already exceeded (no false alarms)", "$12,300,000" in t and "$2,909,551" in t and "over by" not in t and "on budget" in t, t[:600])
    await pg.select_option("select[data-ba=method]","pace"); await pg.wait_for_timeout(600); t=await pg.inner_text("#view")
    check("budget: rest of the year at the budget's pace", "$12,134,551" in t and "short by $165,449" in t)
    check("budget: spending by function, with what's still available", "Instruction" in t and "$5,275,000" in t and "$880,634" in t and "Operation and maintenance of plant" in t and "$4,394,366" in t, t[t.find("Spending by function"):t.find("Spending by function")+400])
    await pg.locator("#view").screenshot(path=SHOTS+"/budget.png")
    await pg.select_option("select[data-ba=method]","straight"); await pg.wait_for_timeout(600)
    check("budget: straight-line forecast, with its caution", "$11,638,206" in await pg.inner_text("#view") and "can mislead this method" in await pg.inner_text("#view"))
    await pg.click("a[data-action=baFund][data-k=save]"); await pg.wait_for_timeout(600)
    t=await pg.inner_text("#view")
    check("budget: any fund in detail", "Facilities acquisition and construction" in t and "$1,180,640" in t, t[t.find("Spending by function")-300:t.find("Spending by function")+300])
    t=await pg.inner_text("#view")
    check("compare: two months side by side, with the change", "Compare two months" in t and "Aug 31, 2026" in t and "+$1,454,776" in t and "different fiscal years" not in t, t[t.find("Compare two months"):t.find("Compare two months")+500])
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/uploads"); await pg.wait_for_timeout(500)
    check("uploads: balances-only is now a labelled fallback", "Fund balances only (if you can’t export the ledger)" in await pg.inner_text("select[data-upload-kind]"))
    TABLES["fund_balance"]=TABLES["fund_balance"]+[{"district_id":"d1","fund":"save","as_of":"2026-09-30","amount":1309086,"source":"gl_import"},{"district_id":"d1","fund":"ppel","as_of":"2026-09-30","amount":788200,"source":"gl_import"}]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/funds"); await pg.wait_for_timeout(700)
    t=await pg.inner_text("#view")
    hist=t[t.find("Balances month by month"):]
    check("all funds: balances month by month, newest first, with where they came from", "Balances month by month" in t and hist.find("Sep 30, 2026")<hist.find("Jul 1, 2026") and "$1,309,086" in hist and "Monthly GL" in hist, t[t.find("Balances month by month"):t.find("Balances month by month")+300])
    TABLES["fund_balance"]=[x for x in TABLES["fund_balance"] if x.get("as_of")!="2026-09-30"]
    saved_ends={b0["id"]:b0.get("period_end") for b0 in TABLES["import_batch"]}
    for b0 in TABLES["import_batch"]:
      if b0.get("kind")=="gl_monthly": b0["period_end"]="2020-01-31" if b0["id"]=="glb1" else "2019-12-31"
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/overview/today"); await pg.wait_for_timeout(500)
    check("reminder: business staff see when the ledger is getting old", "The ledger is through Jan 31, 2020" in await pg.inner_text("#view") and "Feb 29, 2020" in await pg.inner_text("#view"))
    for b0 in TABLES["import_batch"]: b0["period_end"]=saved_ends.get(b0["id"])
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/progress/actuals"); await pg.wait_for_timeout(600)
    for g in TABLES["gl_amount"]: g["budget_amount"]=None
    await pg.reload(); await pg.wait_for_timeout(800)
    check("budget: an export with no budget column says so", "has no budget column" in await pg.inner_text("#view"))
    TABLES["gl_account"]=[]; TABLES["gl_amount"]=[]; TABLES["import_batch"]=[b for b in TABLES["import_batch"] if b["id"] not in ("glb0","glb1")]
    kept_gl=[b for b in TABLES["import_batch"] if b.get("kind")=="gl_monthly"]; TABLES["import_batch"]=[b for b in TABLES["import_batch"] if b.get("kind")!="gl_monthly"]
    await pg.reload(); await pg.wait_for_timeout(600)
    check("budget: before any ledger, says what's needed", "No monthly ledger yet" in await pg.inner_text("#view"))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/overview/today"); await pg.wait_for_timeout(500)
    check("reminder: before any ledger, business staff are invited to start", "Bring in the business office’s month-end export each month" in await pg.inner_text("#view"))
    TABLES["import_batch"]=TABLES["import_batch"]+kept_gl
    # milestone 6: summary, all funds, exports, activity
    EXP=json.loads(subprocess.check_output(["node","-e","""
      const C=require('./capital.js'),E=require('./engine.js'),D=require('./demo_data.js');let i=0;
      const R=C.demoRows(D['ironwood-valley'],'d1',()=>'00000000-0000-4000-8000-'+String(++i).padStart(12,'0'));
      const rows={district:{name:'x'},settings:R.district_settings[0],balances:R.fund_balance,debts:R.debt_obligation,scenarios:R.scenario,initiatives:R.initiative,phases:R.phase,funding:R.phase_funding,financing:R.financing};
      const sc=R.scenario.find(s=>s.is_board_version);const inp=C.buildInputs(rows,sc.id);const r=E.compute(inp.projects,inp.levers,inp.cfg);
      const P=C.fundPaths(r,inp.cfg);process.stdout.write(JSON.stringify({save27:P.save.years[0].end,saveLow:P.save.low,saveLowFY:P.save.lowFY,phases:R.phase.length}));"""],cwd=os.path.dirname(os.path.abspath(__file__))))
    money=lambda v: "$"+format(round(v),",")
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/summary"); await pg.wait_for_timeout(500)
    t=await pg.inner_text("#view")
    check("summary: board version totals", "$14.79M" in t and "$5.35M" in t and "District baseline" in t)
    check("summary: each fund's low point", money(EXP["saveLow"])+" (FY"+str(EXP["saveLowFY"])+")" in t, money(EXP["saveLow"]))
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/resources/funds"); await pg.wait_for_timeout(500)
    t=await pg.inner_text("#view")
    check("all funds: year-by-year from the engine", "SAVE" in t and money(EXP["save27"]) in t and "Borrowing room" in t and "$4.59M" in t, money(EXP["save27"]))
    check("all funds: what each fund may pay for, with a caution", "423F" in t and "298.3" in t and "not legal advice" in t)
    await pg.screenshot(path=SHOTS+"/funds.png",full_page=True)
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/reports/exports"); await pg.wait_for_timeout(500)
    import csv, io as _io
    async with pg.expect_download() as dl: await pg.click("button[data-action=exportProjects]")
    f=await dl.value; text=open(await f.path(),encoding="utf-8").read()
    names={r["Project"] for r in csv.DictReader(_io.StringIO(text))}
    reparsed=json.loads(subprocess.run(["node","-e","const U=require('./uploads.js');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=U.parseProjects(U.parseCSV(s),2027,10);process.stdout.write(JSON.stringify({n:p.projects.length,e:p.issues.filter(i=>i.l==='e').length}))})"],input=text,capture_output=True,text=True,cwd=os.path.dirname(os.path.abspath(__file__))).stdout)
    check("exports: projects file is a valid upload with every project", len(names)==16 and reparsed=={"n":16,"e":0} and f.suggested_filename.startswith("ironwood-valley-"), str(reparsed))
    async with pg.expect_download() as dl: await pg.click("button[data-action=exportPhases]")
    f=await dl.value; prow=list(csv.DictReader(_io.StringIO(open(await f.path(),encoding="utf-8").read())))
    check("exports: every scenario's phases in one sheet", len(prow)==EXP["phases"] and {r["Scenario"] for r in prow}=={"District baseline","Addition phased, bond in FY2030"}, str(len(prow)))
    async with pg.expect_download() as dl: await pg.click("button[data-action=exportBackup]")
    f=await dl.value; bk=json.load(open(await f.path()))
    BACKUP_PATH=await f.path()
    check("exports: full backup has the plan, not people", bk["kind"]=="HighGround district backup" and len(bk["tables"]["phase"])==EXP["phases"] and "district_member" not in bk["tables"] and "audit_log" not in bk["tables"])
    # restore from a backup
    import shutil; shutil.copy(BACKUP_PATH,"/tmp/hg-backup.json")
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/reports/exports"); await pg.wait_for_timeout(500)
    check("restore: offered to admins, with the safety note", "Restore from a backup" in await pg.inner_text("#view") and "downloads a fresh backup" in await pg.inner_text("#view"))
    other=json.load(open("/tmp/hg-backup.json")); other["district"]["id"]="d-somewhere-else"; other["district"]["name"]="Another CSD"; json.dump(other,open("/tmp/hg-other.json","w"))
    await pg.set_input_files("input[data-restore-file]","/tmp/hg-other.json"); await pg.wait_for_timeout(400)
    check("restore: a backup from another district is refused", "That backup is from “Another CSD”" in await pg.inner_text("#toasts"))
    await pg.set_input_files("input[data-restore-file]","/tmp/hg-backup.json"); await pg.wait_for_timeout(400)
    rv=await pg.inner_text("[data-restore-review]")
    check("restore: shows what the backup holds before anything changes", "Backup from" in rv and "2 scenarios" in rv and ("%d initiatives"%len(TABLES["initiative"])) in rv and "1 yearly cost ·" in rv, rv[:200])
    PROMPT["text"]="wrong-district"; n0=len(calls); await pg.click("button[data-action=restoreRun]"); await pg.wait_for_timeout(400)
    check("restore: a mistyped link id changes nothing", "Not restored" in await pg.inner_text("#toasts") and not any(c[0] in ("DELETE","POST") for c in calls[n0:]))
    PROMPT["text"]="ironwood-valley"; n0=len(calls)
    async with pg.expect_download() as dl2: await pg.click("button[data-action=restoreRun]")
    safety=await dl2.value; await pg.wait_for_timeout(1500); PROMPT["text"]=None
    new=calls[n0:]
    dels=[c[1].split("?")[0].split("/")[-1] for c in new if c[0]=="DELETE"]
    posts=[c[1].split("?")[0].split("/")[-1] for c in new if c[0]=="POST"]
    locks=[c for c in new if c[0]=="PATCH" and "/rest/v1/scenario?" in c[1] and '"is_locked": true' in (c[2] or "").replace('":true','": true')]
    first_del=next(k for k,c in enumerate(new) if c[0]=="DELETE")
    check("restore: a safety backup downloads before anything is erased", safety.suggested_filename.endswith("-backup.json") and first_del>0)
    check("restore: erases the plan, then puts every table back in order", dels==["publication","report_snapshot","project_request","scenario","measure","outcome","survey","initiative","priority","assumption_set","debt_obligation","fund_balance","import_batch","district_settings"]
          and posts[:3]==["district_settings","initiative","scenario"] and posts.index("phase")>posts.index("scenario") and posts.index("fund_balance")>posts.index("phase"), str(posts))
    scen=[json.loads(c[2]) for c in new if c[0]=="POST" and c[1].split("?")[0].endswith("/scenario")][0]
    check("restore: scenarios go back unlocked, then the locked ones are locked again", all(x["is_locked"] is False for x in scen) and len(locks)==sum(1 for sc in TABLES["scenario"] if sc.get("is_locked")), f"{len(locks)} locks")
    check("restore: says it's done", "Plan restored" in await pg.inner_text("#toasts"))
    # district logo
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/district"); await pg.wait_for_timeout(500)
    import base64 as _b64
    open("/tmp/logo.png","wb").write(_b64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
    n0=len(calls); await pg.set_input_files("input[data-logo-file]","/tmp/logo.png"); await pg.wait_for_timeout(700)
    up=[c for c in calls[n0:] if c[0]=="POST" and "/storage/v1/object/district-public/d1/logo-" in c[1]]
    lp=[json.loads(c[2]) for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/district?" in c[1]]
    check("logo: uploads to the district's public folder and is saved on the district", up and lp and lp[0]["logo_path"].startswith("d1/logo-") and lp[0]["logo_path"].endswith(".png"), str(lp))
    open("/tmp/notimage.txt","w").write("hello")
    await pg.set_input_files("input[data-logo-file]",{"name":"logo.txt","mimeType":"text/plain","buffer":b"hello"}); await pg.wait_for_timeout(300)
    check("logo: only images are accepted", "Use a PNG, JPEG or WebP image" in await pg.inner_text("#toasts"))
    D1["logo_path"]="d1/logo-1.png"
    await pg.goto("http://localhost:8765/#/p/ironwood-valley"); await pg.wait_for_timeout(700)
    check("logo: shown on the public board page", await pg.locator("img.pub-dlogo[src*='/storage/v1/object/public/district-public/d1/logo-1.png']").count()==1)
    del D1["logo_path"]
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/settings/activity"); await pg.wait_for_timeout(500)
    t=await pg.inner_text("#view")
    check("activity: who changed what, before and after", "Pat Admin" in t and "Project: Gym floor" in t and "focus area: Facilities → Activities" in t and "updated at" not in t)
    check("activity: someone outside the district shows as staff", "Willow Holler staff" in t and "Scenario: Plan B" in t)
    await pg.goto("http://localhost:8765/#/d/cottonwood-ridge/settings/activity"); await pg.wait_for_timeout(400)
    check("activity: admins only", "Only a district admin" in await pg.inner_text("#view"))
    # help map
    await pg.goto("http://localhost:8765/#/d/ironwood-valley/help/built"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=SHOTS+"/help-built.png",full_page=True)
    await pg.click("button[data-action=signOut]"); await pg.wait_for_timeout(400)
    check("sign out", "Sign in" in await pg.inner_text("h1") and any("/auth/v1/logout" in c[1] for c in calls))
    # no-district user
    await pg.fill("input[name=email]","new@example.test"); await pg.fill("input[name=password]",PW); await pg.click("button[type=submit]"); await pg.wait_for_timeout(600)
    check("no-district welcome", "don’t have access to a district yet" in await pg.inner_text("body"))
    check("no Search button outside a district", await pg.locator("[data-notbuilt='Search']").count()==0)
    await pg.fill("form[data-form=requestAccess] input[name=slug]","ironwood-valley"); await pg.fill("form[data-form=requestAccess] textarea","I'm the new principal")
    n0=len(calls); await pg.click("form[data-form=requestAccess] button"); await pg.wait_for_timeout(500)
    rq=[json.loads(c[2]) for c in calls[n0:] if "rpc/request_access" in c[1]]
    check("request access: sent by link id", rq==[{"p_slug":"ironwood-valley","p_message":"I'm the new principal"}] and "Request sent" in await pg.inner_text("#toasts"), str(rq))
    await pg.click("button[data-action=signOut]"); await pg.wait_for_timeout(300)
    # two-step sign-in: someone who has it on is asked for a code
    await pg.fill("input[name=email]","mfa@example.test"); await pg.fill("input[name=password]",PW); await pg.click("button[type=submit]"); await pg.wait_for_timeout(600)
    check("two-step: code asked for after the password", "Enter the 6-digit code" in await pg.inner_text("body"))
    await pg.goto("http://localhost:8765/#/staff"); await pg.wait_for_timeout(500)
    check("two-step: nothing else opens until the code is entered", "Enter the 6-digit code" in await pg.inner_text("body"))
    await pg.fill("input[name=code]","123456"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(700)
    check("two-step: right code lets them in", "Welcome to HighGround" in await pg.inner_text("body"))
    await pg.click("button[data-action=signOut]"); await pg.wait_for_timeout(300)
    # staff with no districts yet
    await pg.fill("input[name=email]","empty.staff@example.test"); await pg.fill("input[name=password]",PW); await pg.click("button[type=submit]"); await pg.wait_for_timeout(600)
    t=await pg.inner_text("body")
    check("staff with no districts lands on Willow Holler page", "#/staff" in pg.url and "Add a district" in t and "don’t have access" not in t, pg.url)
    await pg.click("button[data-action=signOut]"); await pg.wait_for_timeout(300)
    # staff
    await pg.fill("input[name=email]","staff@example.test"); await pg.fill("input[name=password]",PW); await pg.click("button[type=submit]"); await pg.wait_for_timeout(600)
    await pg.goto("http://localhost:8765/#/staff"); await pg.wait_for_timeout(400)
    await pg.fill("input[name=name]","Harvest Plains Community School District"); await pg.fill("input[name=slug]","harvest-plains"); await pg.check("input[name=is_demo]"); await pg.fill("input[name=admin_email]","Boss@Example.test")
    await pg.click("form[data-form=createDistrict] button"); await pg.wait_for_timeout(500)
    dp=[c for c in calls if c[0]=="POST" and c[1].startswith("/rest/v1/district?")]
    ip=[c for c in calls if c[0]=="POST" and "/rest/v1/invitation" in c[1]]
    check("staff creates district and admin invite", dp and json.loads(dp[-1][2])["slug"]=="harvest-plains" and json.loads(ip[-1][2])=={"district_id":"d9","email":"boss@example.test","role":"admin"})
    check("staff sees Willow Holler page", "Added Harvest Plains" in await pg.inner_text("body"))
    await pg.select_option("select[data-demo-district]","d2"); await pg.select_option("select[data-demo-set]","harvest-plains")
    n0=len(calls); await pg.click("button[data-action=loadDemo]"); await pg.wait_for_timeout(900)
    posts=[c[1].split("?")[0].split("/")[-1] for c in calls[n0:] if c[0]=="POST"]
    locks=[c for c in calls[n0:] if c[0]=="PATCH" and "/rest/v1/scenario?" in c[1] and "is_locked" in (c[2] or "")]
    want=["district_settings","fund_balance","debt_obligation","initiative","scenario","scenario_initiative","phase","phase_funding"]
    check("staff loads demo data in dependency order, then locks the baseline", posts==want and len(locks)==1, str(posts))
    # reset a demo district to Bridger Hollow
    await pg.goto("http://localhost:8765/#/staff"); await pg.wait_for_timeout(600)
    check("staff: Bridger Hollow is offered first", (await pg.locator("select[data-demo-set] option").first.inner_text()).startswith("Bridger Hollow Community School District (925 students)"))
    await pg.select_option("select[data-demo-district]","d2"); await pg.select_option("select[data-demo-set]","bridger-hollow")
    n0=len(calls); await pg.click("button[data-action=resetDemo]"); await pg.wait_for_timeout(1200)
    dels=[c[1].split("?")[0].split("/")[-1] for c in calls[n0:] if c[0]=="DELETE"]
    posts=[c[1].split("?")[0].split("/")[-1] for c in calls[n0:] if c[0]=="POST"]
    check("reset: erases the demo district's plan, then reloads it", dels==["publication","scenario","initiative","debt_obligation","fund_balance","import_batch","district_settings"]
          and posts[:10]==["district_settings","fund_balance","debt_obligation","initiative","scenario","scenario_initiative","phase","phase_funding","recurring_cost","financing"], str(dels)+str(posts))
    check("reset: only that district is touched", all("district_id=eq.d2" in c[1] for c in calls[n0:] if c[0]=="DELETE"))
    check("reset: says it's done", "Demo reset" in await pg.inner_text("#toasts"))
    await pg.screenshot(path=SHOTS+"/staff.png",full_page=True)
    await pg.click("button[data-action=signOut]"); await pg.wait_for_timeout(300)
    # sign up
    await pg.goto("http://localhost:8765/#/signup"); await pg.wait_for_timeout(200)
    await pg.fill("input[name=full_name]","Nia New"); await pg.fill("input[name=email]","nia@example.test"); await pg.fill("input[name=password]","short1"); await pg.fill("input[name=again]","short1")
    await pg.evaluate("document.querySelectorAll('input[minlength]').forEach(i=>i.removeAttribute('minlength'))")
    await pg.click("button[type=submit]"); await pg.wait_for_timeout(300)
    check("short password refused", "8 characters" in await pg.inner_text("#toasts"))
    await pg.fill("input[name=password]","longenough"); await pg.fill("input[name=again]","longenough"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(300)
    check("password without capital, number, symbol refused", "one capital" in await pg.inner_text("#toasts") and not any("/auth/v1/signup" in c[1] for c in calls))
    await pg.fill("input[name=password]","Longer pass 9!"); await pg.fill("input[name=again]","Longer pass 9!"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(400)
    su=[c for c in calls if "/auth/v1/signup" in c[1]]
    check("sign up asks to confirm email", su and "redirect_to=" in su[-1][1] and "confirmation link" in await pg.inner_text("body"))
    # recovery link
    await pg.goto("http://localhost:8765/#access_token=tok-u-admin&refresh_token=r&expires_in=3600&type=recovery"); await pg.wait_for_timeout(600)
    check("reset link opens new-password screen", "Choose a new password" in await pg.inner_text("body") and "access_token" not in pg.url, pg.url)
    await pg.fill("input[name=password]","Another pass 7#"); await pg.fill("input[name=again]","Another pass 7#"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(600)
    check("password saved", any(c[0]=="PUT" and "/auth/v1/user" in c[1] for c in calls) and "Password changed" in await pg.inner_text("body"))
    await pg.goto("http://localhost:8765/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired"); await pg.wait_for_timeout(500)
    check("expired link explained", "expired" in await pg.inner_text("body"))
    # public page, opened by someone with no account (fresh browser, no session)
    anonctx=await b.new_context(viewport={"width":1360,"height":900}); await anonctx.route("**/config.js",cfg); await anonctx.route(SB+"/**",handler); await anonctx.route("**/fonts.g*/**",lambda r:r.abort())
    pub=await anonctx.new_page(); pub.on("pageerror",lambda e:errs.append(str(e)))
    n0=len(calls); await pub.goto("http://localhost:8765/#/p/ironwood-valley"); await pub.wait_for_timeout(700)
    t=await pub.inner_text("body")
    authed=[c for c in calls[n0:] if "/rest/v1/" in c[1] and "rpc/public_publication" not in c[1]]
    check("public link: plan shows with no account ($5.35M)", "Ironwood Valley" in t and "$5.35M" in t and "Sign in" in t and "Sign out" not in t, t[:200])
    check("public link: only the public function is called", not authed, str(authed[:2]))
    check("public link: nothing to edit or publish", await pub.locator("[data-notbuilt], [data-action=publishBoard], form").count()==0)
    await pub.click("input[data-lever=sf]"); await pub.wait_for_timeout(200)
    check("public link: shows what it means for taxpayers", "What it means for taxpayers" in await pub.inner_text("body"))
    check("public link: visitors can move levers", fmtK(gold("orig",{"sf":False})["gap"]) in await pub.inner_text("#cap-results"))
    await pub.screenshot(path=SHOTS+"/public.png",full_page=True)
    await pub.goto("http://localhost:8765/#/p/nowhere"); await pub.wait_for_timeout(400)
    check("unpublished link", "Nothing published here yet" in await pub.inner_text("body"))
    # phone
    ph=await b.new_context(viewport={"width":390,"height":844}); await ph.route("**/config.js",cfg); await ph.route(SB+"/**",handler); await ph.route("**/fonts.g*/**",lambda r:r.abort())
    pp=await ph.new_page(); pp.on("pageerror",lambda e:errs.append(str(e)))
    await pp.goto("http://localhost:8765/#/signin"); await pp.fill("input[name=email]","admin@example.test"); await pp.fill("input[name=password]",PW); await pp.click("button[type=submit]"); await pp.wait_for_timeout(700)
    sw=await pp.evaluate("document.documentElement.scrollWidth"); check("phone: no sideways scroll", sw<=390, str(sw))
    await pp.screenshot(path=SHOTS+"/phone.png")
    await b.close()
  srv.terminate()
  for n,okk,d in R: print(("PASS " if okk else "FAIL ")+n+(("  ["+d+"]") if d and not okk else ""))
  print("page errors:",errs)
asyncio.run(main())
