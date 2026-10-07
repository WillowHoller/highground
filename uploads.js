/* HighGround — reading uploaded spreadsheets.
   Project lists and fund balances, as CSV or Excel (.xlsx). No library: .xlsx is read with the browser's own
   unzip (DecompressionStream) and XML parser. Parsing rules carried over unchanged from the working planner,
   so the same spreadsheets work. Pure functions except readXlsx/readTable (browser only). Tests: uploads_test.js */
(function (root, factory) {
  const E = root.HGEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGUploads = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const MAX_PH = 12;
  const NAMES = { save: 'SAVE', ppel: 'PPEL', vppel: 'V-PPEL', grants: 'Grants/Donations', boost: 'Boosters', camp: 'Campaign/Bond' };
  const fmtExact = (v) => '$' + Math.round(v).toLocaleString('en-US');

  // ---------------------------------------------------------------- reading files
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), files = {};
    let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
    if (e < 0) throw new Error('This isn’t a readable .xlsx file. Save it as .xlsx or .csv and try again.');
    let p = dv.getUint32(e + 16, true); const count = dv.getUint16(e + 10, true);
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, lho }; p += 46 + nl + xl + cl;
    }
    return async (name) => {
      const f = files[name]; if (!f) return null;
      const nl = dv.getUint16(f.lho + 26, true), xl = dv.getUint16(f.lho + 28, true), start = f.lho + 30 + nl + xl;
      const raw = u8.subarray(start, start + f.csize);
      const out = f.method === 0 ? raw : await inflateRaw(raw);
      return new TextDecoder().decode(out);
    };
  }
  /* first worksheet only */
  async function readXlsx(buf) {
    const get = await unzip(buf);
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const ss = []; const sst = await get('xl/sharedStrings.xml');
    if (sst) xml(sst).querySelectorAll('si').forEach((si) => { let t = ''; si.querySelectorAll('t').forEach((x) => { t += x.textContent; }); ss.push(t); });
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = xml(wb).querySelector('sheet');
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = rid && [...xml(rels).querySelectorAll('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
    }
    const sh = await get(sheetPath); if (!sh) throw new Error('Couldn’t find the first worksheet in that file.');
    const colIdx = (r) => { const m = /^([A-Z]+)/.exec(r || ''); let n = 0; if (m) for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const rows = [];
    xml(sh).querySelectorAll('sheetData > row').forEach((r) => {
      const row = [];
      r.querySelectorAll('c').forEach((c) => {
        const t = c.getAttribute('t'), v = c.querySelector('v'), is = c.querySelector('is');
        let val = v ? v.textContent : '';
        if (t === 's') val = ss[+val] || ''; else if (t === 'inlineStr' && is) val = is.textContent; else if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE';
        row[colIdx(c.getAttribute('r'))] = val;
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
    });
    return rows;
  }
  async function readTable(file) {
    if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
    if (/\.xls$/i.test(file.name)) throw new Error('That’s the old .xls format. Save it as .xlsx or .csv first.');
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) throw new Error('Upload a .csv or .xlsx file.');
    return parseCSV(await file.text());
  }


  // ---------------------------------------------------------------- writing .xlsx (no library: a plain zip of XML)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {   /* [{ name, data: Uint8Array }] → Uint8Array, stored (no compression) */
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach((f) => {
      const nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + f.data.length;
    });
    const csize = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]), out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0;
    all.forEach((x) => { out.set(x, p); p += x.length; });
    return out;
  }
  const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  /**
   * rows (first row = headings) → an Excel workbook (Uint8Array). Plain numbers (no leading zero) become number cells,
   * everything else stays text; the heading row is bold and frozen; columns are sized to fit. Reads back with readXlsx.
   */
  function toXlsx(rows, sheetName) {
    const isNum = (v) => typeof v === 'number' ? isFinite(v) : /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(String(v).trim());
    const width = []; rows.forEach((r) => r.forEach((v, i) => { width[i] = Math.min(60, Math.max(width[i] || 8, String(v == null ? '' : v).length + 2)); }));
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
      return isNum(v) && ri > 0 ? `<c r="${ref}"${st}><v>${Number(v)}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS} ${R}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      + `<cols>${width.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
    const name = xesc(String(sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    const t = new TextEncoder(), f = (n, s) => ({ name: n, data: t.encode(s) });
    return zip([
      f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
      f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      f('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} ${R}><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
      f('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
      f('xl/worksheets/sheet1.xml', sheet),
    ]);
  }

  // ---------------------------------------------------------------- reading values
  function parseMoney(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return null;
    const one = (t) => { t = t.replace(/[$,\s]/g, '').toLowerCase(); const m = /^(-?\d*\.?\d+)([km]?)$/.exec(t); if (!m) return null;
      return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1)); };
    const rg = s.split(/\s*(?:–|—|-(?=\s*\$?\d)|\bto\b)\s*/i).filter(Boolean);
    if (rg.length === 2) { const a = one(rg[0]), b = one(rg[1]); if (a != null && b != null) return { v: Math.round((a + b) / 2), range: true }; }
    const v = one(s); return v == null ? null : { v: v, range: false };
  }
  const excelDate = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  const yr4 = (t) => (t.length === 2 ? 2000 + +t : +t);
  function parseFY(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return null;
    let m;
    if (/^\d{5}(\.\d+)?$/.test(s)) return E.fyOfDate(excelDate(+s));           /* an Excel date cell */
    if ((m = /summer\s*'?(\d{2,4})/i.exec(s))) return yr4(m[1]) + 1;           /* "Summer 2027" work lands in FY2028 */
    if ((m = /fy\s*'?(\d{2,4})/i.exec(s))) return yr4(m[1]);
    if ((m = /^(\d{4})\s*[-–/]\s*(\d{2,4})$/.exec(s))) return m[2].length === 2 ? Math.floor(+m[1] / 100) * 100 + +m[2] : +m[2];
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) return E.fyOfDate(yr4(m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'));
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return E.fyOfDate(s);
    if ((m = /^(\d{4})$/.exec(s))) return +m[1];
    if ((m = /^(\d{2})$/.exec(s))) return 2000 + +m[1];
    return null;
  }
  function parseDate(s) {
    s = String(s == null ? '' : s).trim(); let m;
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(+s);
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[0];
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) return yr4(m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    return null;
  }
  function srcKey(s) {
    s = String(s || '').toLowerCase().trim(); if (!s) return null;
    if (/v-?\s?ppel|voter|voted/.test(s)) return 'vppel';
    if (/ppel|physical plant/.test(s)) return 'ppel';
    if (/save|sales tax|secure an advanced/.test(s)) return 'save';
    if (/grant|donat|foundation|gift/.test(s)) return 'grants';
    if (/booster/.test(s)) return 'boost';
    if (/campaign|bond|referend|\bgo\b|general obligation|fundrais/.test(s)) return 'camp';
    return undefined;
  }
  /* the single priority: must | strategic | nice (old High/Med/Low still accepted) */
  function tierKey(s) {
    s = String(s || '').toLowerCase().trim(); if (!s) return '';
    if (/must|essential|required|critical|^high|^h$|^1$/.test(s)) return 'must';
    if (/strateg|^med|^m$|^2$/.test(s)) return 'strategic';
    if (/nice|optional|^low|^l$|^3$|10/.test(s)) return 'nice';
    return '';
  }
  const TIER_WORD = { must: 'Must-have', strategic: 'Strategic', nice: 'Nice to have' };
  const TIER_PRI = { must: 'High', strategic: 'Med', nice: 'Low' };
  function priKey(s) {
    s = String(s || '').toLowerCase().trim(); if (!s) return '';
    if (/10/.test(s)) return '10-yr';
    if (/^h|^1$/.test(s)) return 'High'; if (/^m|^2$/.test(s)) return 'Med'; if (/^l|^3$/.test(s)) return 'Low'; return '';
  }
  function findCols(head) {
    const H = head.map((h) => String(h || '').toLowerCase().trim());
    const taken = new Set();
    const pick = (re) => { const i = H.findIndex((h, k) => !taken.has(k) && re.test(h)); if (i >= 0) taken.add(i); return i; };
    const c = {};
    c.conf = pick(/confiden|firm/);
    c.actual = pick(/actual/);
    c.life = pick(/remaining|useful life|life/);
    c.status = pick(/^status|progress/);
    c.cond = pick(/condition/);
    c.phase = pick(/^phase|phase name|^step/);
    c.name = pick(/^(project|name|item|description|project name)/);
    c.fy = pick(/^fy|fiscal|year|complet|when|timing/);
    c.cost = pick(/estimate|cost|amount|budget|\$/);
    c.pri = pick(/priorit/);
    c.area = pick(/focus|categor|area|goal/);
    c.src = []; c.pct = [];
    H.forEach((h, k) => { if (taken.has(k)) return; if (/%|percent|pct|share/.test(h)) { c.pct.push(k); taken.add(k); } });
    H.forEach((h, k) => { if (taken.has(k)) return; if (/source|funding|fund\b|lever/.test(h)) { c.src.push(k); taken.add(k); } });
    return c;
  }

  /* rows → projects. Rows sharing a project name become phases of one project. year is 0-based from startFY.
     issues: {l:'e'|'w', m, row} — any 'e' blocks applying the upload. */
  function parseProjects(rows, startFY, years) {
    const issues = [], out = [], byName = {};
    if (!rows.length) return { projects: [], issues: [{ l: 'e', m: 'The file is empty.' }] };
    let hi = rows.findIndex((r) => r.some((x) => /project|name/i.test(String(x)))); if (hi < 0) hi = 0;
    const c = findCols(rows[hi]);
    if (c.name < 0) issues.push({ l: 'e', m: 'No “Project” column found. Use the template’s headings.' });
    if (c.fy < 0) issues.push({ l: 'e', m: 'No “FY” column found.' });
    if (c.cost < 0) issues.push({ l: 'e', m: 'No “Estimate” column found.' });
    if (issues.length) return { projects: [], issues };
    let id = 1;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r], line = r + 1, cell = (i) => (i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : '');
      const name = cell(c.name); if (!name) continue;
      const fy = parseFY(cell(c.fy));
      if (fy == null) { issues.push({ l: 'e', row: line, m: `Row ${line} “${name}”: can’t read the FY “${cell(c.fy)}”. Use FY2028, 2028 or 2027-28.` }); continue; }
      const y = fy - startFY;
      if (y < 0 || y >= years) { issues.push({ l: 'e', row: line, m: `Row ${line} “${name}”: FY${fy} is outside this plan (FY${startFY}–FY${startFY + years - 1}). Fix the year, or change the plan years in Settings, Starting numbers.` }); continue; }
      const mon = parseMoney(cell(c.cost));
      if (!mon) { issues.push({ l: 'e', row: line, m: `Row ${line} “${name}”: can’t read the estimate “${cell(c.cost)}”.` }); continue; }
      if (mon.range) issues.push({ l: 'w', row: line, m: `Row ${line} “${name}”: a range, so the midpoint was used (${fmtExact(mon.v)}) and marked as an estimate.` });
      const funding = [];
      c.src.forEach((si, k) => {
        const raw = cell(si); if (!raw) return; const b = srcKey(raw);
        if (b === undefined) issues.push({ l: 'w', row: line, m: `Row ${line} “${name}”: funding source “${raw}” not recognised, so SAVE was used. Recognised: SAVE, PPEL, V-PPEL, Grants/Donations, Boosters, Campaign/Bond.` });
        const pRaw = c.pct[k] != null ? cell(c.pct[k]).replace(/%/g, '') : ''; const p = pRaw === '' ? null : parseFloat(pRaw);
        funding.push({ b: b || 'save', p: p });
      });
      if (!funding.length) { funding.push({ b: 'save', p: 100 }); issues.push({ l: 'w', row: line, m: `Row ${line} “${name}”: no funding source, so SAVE was used.` }); }
      const given = funding.filter((f) => f.p != null); let sumGiven = given.reduce((a, f) => a + f.p, 0);
      /* Excel %-formatted cells arrive as fractions: 1 = 100%, 0.6 = 60% */
      if (sumGiven > 0 && sumGiven <= 1.0001) { given.forEach((f) => { f.p *= 100; }); sumGiven *= 100; }
      const blank = funding.filter((f) => f.p == null);
      if (blank.length) { const each = Math.max(0, (100 - sumGiven)) / blank.length; blank.forEach((f) => { f.p = each; }); }
      const tot = funding.reduce((a, f) => a + f.p, 0);
      if (Math.abs(tot - 100) > 0.5 && tot > 0) { issues.push({ l: 'w', row: line, m: `Row ${line} “${name}”: funding adds to ${Math.round(tot)}%, so it was scaled to 100%.` }); funding.forEach((f) => { f.p = f.p / tot * 100; }); }
      funding.forEach((f) => { f.p = Math.round(f.p); }); const drift = 100 - funding.reduce((a, f) => a + f.p, 0); funding[0].p += drift;
      const conf = cell(c.conf).toLowerCase();
      const key = name.toLowerCase().replace(/\s+/g, ' ');
      let p = byName[key];
      if (!p) {
        p = { id: id++, life: null, cond: '', name: name.slice(0, 90), tier: tierKey(cell(c.pri)), pri: TIER_PRI[tierKey(cell(c.pri))] || '', est: !/^f|firm|bid|contract|actual/.test(conf) || mon.range,
              area: cell(c.area).slice(0, 40), phases: [] };
        byName[key] = p; out.push(p);
      } else if (mon.range) p.est = true;
      const stRaw = cell(c.status).toLowerCase(), st = /complete|done|finished|closed/.test(stRaw) ? 'done' : /underway|progress|started|active/.test(stRaw) ? 'underway' : '';
      const act = parseMoney(cell(c.actual));
      const phase = { cost: mon.v, year: y, funding: funding.slice(0, 3) }; if (st) phase.status = st; if (st === 'done' && act) phase.actual = act.v;
      const pname = cell(c.phase); if (pname) phase.label = pname.slice(0, 80);
      p.phases.push(phase);
      const cond = cell(c.cond); if (cond && !p.cond) { const k = ['Good', 'Fair', 'Poor', 'Critical'].find((x) => x.toLowerCase() === cond.toLowerCase()); if (k) p.cond = k; }
      const life = parseInt(cell(c.life), 10); if (!isNaN(life) && p.life == null) p.life = life;
    }
    out.forEach((p) => {
      p.phases.sort((a, b) => a.year - b.year);
      if (p.phases.length > MAX_PH) { issues.push({ l: 'w', m: `“${p.name}” has ${p.phases.length} rows; kept the first ${MAX_PH} phases.` }); p.phases = p.phases.slice(0, MAX_PH); }
    });
    if (!out.length && !issues.some((i) => i.l === 'e')) issues.push({ l: 'e', m: 'No project rows found under the headings.' });
    return { projects: out, issues };
  }

  function parseBalances(rows) {
    const found = {}, issues = []; let asOf = null;
    if (!rows.length) return { found, issues: [{ l: 'e', m: 'The file is empty.' }], asOf };
    let hi = rows.findIndex((r) => r.some((x) => /fund|balance/i.test(String(x)))); if (hi < 0) hi = 0;
    const H = rows[hi].map((h) => String(h || '').toLowerCase());
    const ci = (re) => H.findIndex((h) => re.test(h));
    const cName = ci(/fund|name|account|description/), cCode = ci(/code|number|no\.?$/), cBal = ci(/balance|amount|ending|\$/), cDate = ci(/as.?of|date|period/);
    if (cBal < 0) return { found, issues: [{ l: 'e', m: 'No “Balance” column found. Use the template’s headings.' }], asOf };
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r], cell = (i) => (i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : '');
      const nm = cell(cName), code = cell(cCode).replace(/\D/g, '');
      let b = srcKey(nm);
      if (!b && /capital projects/i.test(nm)) { b = 'save'; issues.push({ l: 'w', row: r + 1, m: `Row ${r + 1} “${nm}”: read as SAVE. If it also holds bond proceeds, enter the SAVE part only.` }); }
      if (!b && code === '33') b = 'save'; if (!b && code === '36') b = 'ppel';
      if (b === 'boost' || b === 'camp') b = undefined;
      if (!b) { if (nm || code) issues.push({ l: 'w', row: r + 1, m: `Row ${r + 1} “${nm || code}”: not a fund the capital plan uses, so it was skipped.` }); continue; }
      const m = parseMoney(cell(cBal));
      if (!m) { if (cell(cBal)) issues.push({ l: 'e', row: r + 1, m: `Row ${r + 1} “${nm}”: can’t read the balance “${cell(cBal)}”.` }); continue; }
      found[b] = (found[b] || 0) + m.v;
      if (!asOf && cDate >= 0) asOf = parseDate(cell(cDate));
    }
    if (!Object.keys(found).length) issues.push({ l: 'e', m: 'No SAVE, PPEL, V-PPEL or grant balances found.' });
    return { found, issues, asOf };
  }

  // ---------------------------------------------------------------- templates and export
  const csvCell = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const PROJECT_HEAD = ['Project', 'Phase name', 'FY', 'Estimate', 'Funding source', 'Funding %', 'Funding source 2', 'Funding % 2', 'Funding source 3', 'Funding % 3',
    'Priority', 'Focus area', 'Cost confidence (Firm/Estimate)', 'Status', 'Actual cost', 'Condition', 'Remaining life (years)'];
  function projectTemplate(startFY) {
    const f = startFY || 2027;
    return toCSV([PROJECT_HEAD,
      ['Secure entry vestibule', '', 'FY' + f, '185000', 'SAVE', '100', '', '', '', '', 'Must-have', 'Safety & security', 'Estimate'],
      ['Roof replacement — north wing', 'Sections A–B', 'FY' + (f + 1), '160000', 'SAVE', '60', 'PPEL', '40', '', '', 'Must-have', 'Facilities', 'Estimate', '', '', 'Poor', '2'],
      ['Roof replacement — north wing', 'Sections C–D', 'FY' + (f + 3), '175000', 'SAVE', '100', '', '', '', '', 'Must-have', 'Facilities', 'Estimate'],
      ['Replace route bus', '', 'FY' + (f + 1), '135000', 'PPEL', '100', '', '', '', '', 'Strategic', 'Transportation', 'Firm'],
      ['Track resurface', '', 'FY' + (f + 4), '250000-300000', 'Campaign/Bond', '70', 'Boosters', '30', '', '', 'Nice to have', 'Activities', 'Estimate'],
    ]);
  }
  /* engine projects → the same spreadsheet layout, so an export can be edited and uploaded back */
  function projectsToCSV(projects, startFY) {
    const rows = [PROJECT_HEAD];
    projects.forEach((p) => p.phases.forEach((ph) => {
      const r = [p.name, ph.label || '', 'FY' + (startFY + ph.year), ph.cost];
      for (let i = 0; i < 3; i++) { const f = ph.funding[i]; r.push(f ? NAMES[f.b] : '', f ? f.p : ''); }
      r.push(TIER_WORD[p.tier || tierKey(p.pri)] || '', p.area || '', p.est ? 'Estimate' : 'Firm', ph.status === 'done' ? 'Complete' : ph.status === 'underway' ? 'Underway' : '',
             ph.actual != null ? ph.actual : '', p.cond || '', p.life != null ? p.life : '');
      rows.push(r);
    }));
    return toCSV(rows);
  }
  function balanceTemplate() {
    return toCSV([['Fund', 'Iowa fund code', 'Balance', 'As-of date'],
      ['SAVE (Secure an Advanced Vision for Education)', '33', '', ''],
      ['PPEL (board-approved)', '36', '', ''],
      ['V-PPEL (voter-approved)', '36', '', ''],
      ['Grants / donations restricted to capital', '', '', '']]);
  }

  return { tierKey, TIER_WORD, parseCSV, readXlsx, readTable, parseMoney, parseFY, parseDate, srcKey, priKey, findCols, parseProjects, parseBalances,
           projectTemplate, projectsToCSV, balanceTemplate, toCSV, toXlsx, MAX_PH };
});
