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
def user_obj(email):
  u=USERS[email]; o={"id":u[0],"email":email,"user_metadata":{"full_name":u[1]}}
  if email=="mfa@example.test": o["factors"]=[{"id":"f9","status":"verified","factor_type":"totp"}]
  return o
def email_of(uid): return next((e for e,u in USERS.items() if u[0]==uid),None)
async def handler(route):
  req=route.request; url=urllib.parse.urlparse(req.url); path=url.path; q=urllib.parse.parse_qs(url.query)
  body=req.post_data; calls.append((req.method,path+"?"+url.query,body,req.headers.get("prefer","")))
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
  if path=="/rest/v1/rpc/request_access": return await ok("sent")
  if path=="/auth/v1/user":
    if not em: return await ok({"msg":"JWT expired"},401)
    return await ok(user_obj(em))
  if path=="/auth/v1/signup": return await ok({"id":"u-x","email":json.loads(body)["email"]})
  if path=="/auth/v1/recover": return await ok({})
  if path=="/auth/v1/logout": return await route.fulfill(status=204,body="")
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
  if t in TABLES and req.method=="POST":
    b=json.loads(body); return await ok(b if isinstance(b,list) else [b],201)
  if t in TABLES and req.method=="DELETE":
    return await ok([{"deleted":True}])
  if t in TABLES and req.method=="PATCH":
    return await ok([json.loads(body)])
  if t in TABLES:
    did=q.get("district_id",["eq.d1"])[0][3:]
    return await ok([r for r in TABLES[t] if r.get("district_id")==did])
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
    pg=await ctx.new_page(); pg.on("dialog",lambda dl: asyncio.ensure_future(dl.accept(dl.default_value) if dl.type=="prompt" else dl.accept())); pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append("console: "+m.text) if m.type=="error" and "fonts" not in m.text and "ERR_FAILED" not in m.text else None)
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
    check("capital plan: unfinished parts still marked", "Still to come on this screen" in t)
    # scenario work
    board_id=next(sc["id"] for sc in TABLES["scenario"] if sc["is_board_version"]); phased_id=sid
    await pg.select_option("select[data-cap-scenario]",board_id); await pg.wait_for_timeout(400)
    t=await pg.inner_text("#view")
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
    await first.locator("input[name=pct0]").fill("60"); n0=len(calls)
    await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(300)
    check("editor: a split that doesn't add to 100% is caught", "add to 60%" in await pg.inner_text("[data-modal] [data-form-errors]") and not any(c[0] in("POST","PATCH","DELETE") for c in calls[n0:]))
    await first.locator("input[name=pct0]").fill("100"); await first.locator("input[name=cost]").fill("950,000")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    new=calls[n0:]; ops=[(c[0],c[1].split("?")[0].replace("/rest/v1/","")) for c in new if c[0] in ("POST","PATCH","DELETE")]
    phs=json.loads(next(c[2] for c in new if c[0]=="POST" and c[1].startswith("/rest/v1/phase?") or (c[0]=="POST" and c[1]=="/rest/v1/phase?")))
    delq=next((c[1] for c in new if c[0]=="DELETE" and "/rest/v1/phase?" in c[1]),"")
    check("editor: save updates details and replaces this scenario's phases", ops==[("PATCH","initiative"),("DELETE","phase"),("POST","phase"),("POST","phase_funding")]
          and phs[0]["cost"]==950000 and ("scenario_id=eq."+phased_id) in delq, str(ops))
    await pg.click("button[data-action=editProject][data-id='']"); await pg.wait_for_timeout(300)
    await pg.fill("[data-modal] input[name=name]","Library HVAC")
    row=pg.locator("[data-modal] [data-phase-row]").first
    await row.locator("select[name=fy]").select_option("2029"); await row.locator("input[name=cost]").fill("50000")
    n0=len(calls); await pg.click("[data-modal] button[type=submit]"); await pg.wait_for_timeout(800)
    ops=[c[1].split("?")[0].replace("/rest/v1/","") for c in calls[n0:] if c[0]=="POST"]
    newph=json.loads(next(c[2] for c in calls[n0:] if c[0]=="POST" and c[1].split("?")[0]=="/rest/v1/phase"))
    check("add a project: new project joins this scenario", ops==["initiative","scenario_initiative","phase","phase_funding"] and newph[0]["fy"]==2029 and newph[0]["scenario_id"]==phased_id, str(ops))
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
    await pg.click("text=Add an initiative"); await pg.wait_for_timeout(200)
    check("not-built button throws and shows message", "Adding initiatives isn't built yet (planned for Phase 1)" in (await pg.inner_text("#toasts")).replace("’","'"))
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
    await pg.set_input_files("input[data-upload-file]",files=[{"name":"bad.csv","mimeType":"text/csv","buffer":bad}]); await pg.wait_for_timeout(400)
    check("upload: errors block Apply", "outside this plan" in await pg.inner_text("#upload-review") and await pg.is_disabled("button[data-action=applyUpload]"))
    wb=openpyxl.Workbook(); ws=wb.active
    for r in [["Project","FY","Estimate","Funding source","Funding %"],["Chiller replacement","FY2029",640000,"SAVE",1],["Parking lot","2030-31","$95k","PPEL",1]]: ws.append(r)
    bio=io.BytesIO(); wb.save(bio)
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
    check("exports: full backup has the plan, not people", bk["kind"]=="HighGround district backup" and len(bk["tables"]["phase"])==EXP["phases"] and "district_member" not in bk["tables"] and "audit_log" not in bk["tables"])
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
