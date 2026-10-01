// HighGround: test for send-invitation.ts without deploying it. Run: node --experimental-strip-types send_invitation_test.mjs
// Harness: stand in for Deno + Supabase + Postmark, call the function's handler directly.
let handler; const ENV = {};
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const calls = []; let DB = {};
globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url); calls.push({ url: String(url), method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body });
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (u.host === 'api.postmarkapp.com') return DB.postmarkFail ? J({ ErrorCode: 406, Message: 'Inactive recipient' }, 422) : J({ ErrorCode: 0, Message: 'OK', To: JSON.parse(opt.body).To });
  const auth = (opt.headers || {}).Authorization;
  if (u.pathname === '/auth/v1/user') return auth === 'Bearer good' || auth === 'Bearer notadmin' ? J({ id: 'u1', email: 'pat@ironwood.test' }) : J({ msg: 'bad jwt' }, 401);
  if (u.pathname === '/rest/v1/invitation' && (opt.method || 'GET') === 'GET') return J(auth === 'Bearer good' ? DB.inv : []);   // RLS: only the admin sees it
  if (u.pathname === '/rest/v1/profile') return J([{ full_name: 'Pat Admin' }]);
  if (u.pathname === '/rest/v1/invitation' && opt.method === 'PATCH') return new Response(null, { status: 204 });
  return J({ message: 'unexpected ' + u.pathname }, 404);
};
await import('./send-invitation.ts');
const call = (auth, body) => handler(new Request('https://x.supabase.co/functions/v1/send-invitation', { method: 'POST',
  headers: { Authorization: auth, apikey: 'sb_publishable_x', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const ID = '11111111-2222-4333-8444-555555555555';
const reset = () => { calls.length = 0; DB = { inv: [{ id: ID, email: 'new.person@ironwood.test', role: 'editor', expires_at: '2026-10-30T00:00:00Z', accepted_at: null, sent_count: 0, district: { name: 'Ironwood Valley CSD' } }] }; };
let pass = 0, fail = 0; const check = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d ?? ''); } };

ENV.SUPABASE_URL = 'https://x.supabase.co';
reset(); let r = await call('Bearer good', { invitation_id: ID });
check('missing Postmark secret is reported, nothing sent', r.status === 500 && !calls.some((c) => c.url.includes('postmark')), r.status);
ENV.POSTMARK_SERVER_TOKEN = 'pm-secret';
reset(); r = await call('Bearer good', { invitation_id: ID }); let b = await r.json();
const pm = calls.find((c) => c.url.includes('postmarkapp'));
const mail = pm && JSON.parse(pm.body);
check('admin: email sent', r.status === 200 && b.status === 'sent' && b.to === 'new.person@ironwood.test', JSON.stringify(b));
check('email goes to the invited address, from HighGround, transactional stream', mail && mail.To === 'new.person@ironwood.test' && mail.From === 'HighGround <no-reply@willowholler.com>' && mail.MessageStream === 'outbound');
check('Postmark token sent only to Postmark, in its header', pm && pm.headers['X-Postmark-Server-Token'] === 'pm-secret' && !calls.some((c) => !c.url.includes('postmark') && JSON.stringify(c).includes('pm-secret')));
check('email names the district, the inviter, the role and the sign-up link', mail && /Pat Admin invited you to Ironwood Valley CSD on HighGround, as an editor/.test(mail.TextBody) && mail.TextBody.includes('https://willowholler.github.io/highground/#/signup'));
check('invitation marked as sent, using the caller’s own sign-in', calls.some((c) => c.method === 'PATCH' && c.headers.Authorization === 'Bearer good' && JSON.parse(c.body).sent_count === 1));
reset(); r = await call('Bearer notadmin', { invitation_id: ID });
check('not an admin of that district: refused, nothing sent', r.status === 403 && !calls.some((c) => c.url.includes('postmark')));
reset(); r = await call('Bearer expired', { invitation_id: ID });
check('signed out: refused', r.status === 401 && !calls.some((c) => c.url.includes('postmark')));
reset(); DB.inv[0].accepted_at = '2026-09-30T00:00:00Z'; r = await call('Bearer good', { invitation_id: ID }); b = await r.json();
check('already accepted: reported, nothing sent', b.status === 'accepted' && !calls.some((c) => c.url.includes('postmark')));
reset(); r = await call('Bearer good', { invitation_id: 'nope' });
check('bad id: refused', r.status === 400);
reset(); DB.postmarkFail = true; r = await call('Bearer good', { invitation_id: ID }); b = await r.json();
check('Postmark refusal is passed on, invitation not marked sent', r.status === 502 && /Inactive recipient/.test(b.error) && !calls.some((c) => c.method === 'PATCH'));
reset(); DB.inv[0].district.name = '<script>x</script>'; r = await call('Bearer good', { invitation_id: ID });
const m2 = JSON.parse(calls.find((c) => c.url.includes('postmark')).body);
check('names are escaped in the HTML email', !m2.HtmlBody.includes('<script>') && m2.HtmlBody.includes('&lt;script&gt;'));
const opt = await handler(new Request('https://x/functions/v1/send-invitation', { method: 'OPTIONS' }));
check('browser pre-flight answered with CORS headers', opt.status === 200 && opt.headers.get('Access-Control-Allow-Headers').includes('apikey'));
console.log(`send-invitation tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
