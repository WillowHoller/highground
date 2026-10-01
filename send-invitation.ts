// HighGround — send-invitation (Supabase Edge Function)
// Emails a district invitation through Postmark. Deploy in the Supabase dashboard as "send-invitation" (SETUP.md, step 12).
//
// Secrets (Edge Functions → Secrets):
//   POSTMARK_SERVER_TOKEN  required. Postmark Server API token. Never put it in the app or the repository.
//   APP_URL                optional. Where the app lives; default https://willowholler.github.io/highground/
//   MAIL_FROM              optional. Default: HighGround <no-reply@willowholler.com>
// SUPABASE_URL is provided by Supabase automatically.
//
// Who may send: only someone who can see the invitation under the database's access rules, which means a
// district admin for that district, or Willow Holler staff. The function checks by asking the database with
// the caller's own sign-in, so it never needs (or holds) the Supabase secret key.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROLE: Record<string, string> = {
  admin: 'an admin', business_manager: 'the business manager', superintendent: 'the superintendent',
  editor: 'an editor', board: 'a board member', viewer: 'a viewer',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const base = Deno.env.get('SUPABASE_URL');
    const postmark = Deno.env.get('POSTMARK_SERVER_TOKEN');
    const appUrl = (Deno.env.get('APP_URL') || 'https://willowholler.github.io/highground/').replace(/\/?$/, '/');
    const from = Deno.env.get('MAIL_FROM') || 'HighGround <no-reply@willowholler.com>';
    if (!base || !postmark) return json({ error: 'Email isn’t set up on the server yet (POSTMARK_SERVER_TOKEN is missing).' }, 500);

    const authorization = req.headers.get('Authorization') || '';
    const apikey = req.headers.get('apikey') || '';
    if (!authorization.startsWith('Bearer ') || !apikey) return json({ error: 'Sign in first.' }, 401);
    const asCaller = { apikey, Authorization: authorization };

    const body = await req.json().catch(() => ({}));
    const id = String(body.invitation_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Which invitation? (invitation_id missing)' }, 400);

    // who is asking
    const me = await fetch(`${base}/auth/v1/user`, { headers: asCaller });
    if (!me.ok) return json({ error: 'Your session has ended. Sign in again.' }, 401);
    const caller = await me.json();

    // the invitation, as the caller is allowed to see it
    const q = `${base}/rest/v1/invitation?id=eq.${id}&select=id,email,role,expires_at,accepted_at,sent_count,district:district_id(name)`;
    const r = await fetch(q, { headers: asCaller });
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) return json({ error: 'That invitation wasn’t found, or only a district admin can send it.' }, 403);
    const inv = rows[0];
    if (inv.accepted_at) return json({ status: 'accepted' });

    const prof = await fetch(`${base}/rest/v1/profile?user_id=eq.${caller.id}&select=full_name`, { headers: asCaller });
    const inviter = ((prof.ok ? await prof.json() : [])[0] || {}).full_name || caller.email;
    const district = (inv.district && inv.district.name) || 'your district';
    const role = ROLE[inv.role] || 'a member';
    const expires = new Date(inv.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const signup = `${appUrl}#/signup`;

    const text = [
      `${inviter} invited you to ${district} on HighGround, as ${role}.`,
      ``,
      `To accept, create your HighGround account with this email address (${inv.email}):`,
      signup,
      ``,
      `Already have an account with this address? Just sign in; your access is waiting.`,
      ``,
      `This invitation expires on ${expires}.`,
      ``,
      `HighGround is a planning tool for Iowa school districts, from Willow Holler. Questions: hello@willowholler.com`,
    ].join('\n');
    const html = `<p>${esc(inviter)} invited you to <b>${esc(district)}</b> on HighGround, as ${esc(role)}.</p>
<p>To accept, create your HighGround account with this email address (${esc(inv.email)}):<br><a href="${esc(signup)}">${esc(signup)}</a></p>
<p>Already have an account with this address? Just sign in; your access is waiting.</p>
<p>This invitation expires on ${esc(expires)}.</p>
<p style="color:#5A6660;font-size:13px">HighGround is a planning tool for Iowa school districts, from Willow Holler. Questions: hello@willowholler.com</p>`;

    const send = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': postmark },
      body: JSON.stringify({ From: from, To: inv.email, Subject: `You’re invited to ${district} on HighGround`,
        TextBody: text, HtmlBody: html, MessageStream: 'outbound', ReplyTo: 'hello@willowholler.com' }),
    });
    const result = await send.json().catch(() => ({}));
    if (!send.ok || (result.ErrorCode && result.ErrorCode !== 0)) {
      return json({ error: `The email service refused it: ${result.Message || send.status}` }, 502);
    }

    await fetch(`${base}/rest/v1/invitation?id=eq.${id}`, {
      method: 'PATCH', headers: { ...asCaller, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_sent_at: new Date().toISOString(), sent_count: (inv.sent_count || 0) + 1 }),
    });
    return json({ status: 'sent', to: inv.email });
  } catch (err) {
    return json({ error: `Something went wrong sending the invitation: ${(err as Error).message}` }, 500);
  }
});
