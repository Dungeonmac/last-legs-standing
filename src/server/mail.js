// Email list: every runner account is on it automatically (admins/owner and demo accounts aren't).
// Admins pick an audience, write a message and send it from Admin → Email list. Every email has a
// one-click unsubscribe link (required for bulk email), and unsubscribed runners are always skipped.
const BATCH = 25; // emails sent per request; the admin page keeps asking until the whole list is done

// Who can be emailed: real runner accounts that haven't unsubscribed.
const BASE = `u.password_hash != '!' AND u.role NOT IN ('admin', 'owner') AND u.email_opt_out = 0 AND u.email NOT LIKE '%@lastlegsstanding.test'`;

export function registerMailRoutes(route, d) {
  const { json, HttpError, readJson, clean, requireAdmin, sendToRunner, canEmailRunners, requireViewer } = d;

  /** audience key -> SQL that selects (id, email, first_name, created_at) of the recipients. */
  async function audienceQuery(env, key) {
    if (key === 'all') return { label: 'Everyone on the list', sql: `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at FROM users u WHERE ${BASE}`, binds: [] };
    const m = /^(event|active):([a-z0-9-]+)$/.exec(key || '');
    if (!m) throw new HttpError(400, 'Choose who to send to.');
    const ev = await env.DB.prepare('SELECT id, name FROM events WHERE slug = ? AND is_demo = 0').bind(m[2]).first();
    if (!ev) throw new HttpError(404, 'Event not found.');
    return {
      label: m[1] === 'event' ? `Everyone entered in ${ev.name}` : `Runners still standing in ${ev.name}`,
      sql: `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at FROM users u JOIN registrations r ON r.user_id = u.id
             WHERE ${BASE} AND r.event_id = ?${m[1] === 'active' ? " AND r.status = 'active'" : ''}`,
      binds: [ev.id],
    };
  }

  route('GET', '/admin/mail', async ({ request, env }) => {
    await requireAdmin(request, env);
    const { results: events } = await env.DB.prepare(`SELECT slug, name, status FROM events WHERE is_demo = 0 ORDER BY start_date DESC`).all();
    const audiences = [['all', 'Everyone on the list']];
    for (const e of events) {
      audiences.push([`event:${e.slug}`, `Entered in ${e.name}`]);
      if (e.status === 'live') audiences.push([`active:${e.slug}`, `Still standing in ${e.name}`]);
    }
    const counts = [];
    for (const [key, label] of audiences) {
      const q = await audienceQuery(env, key);
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${q.sql})`).bind(...q.binds).first();
      counts.push({ key, label, count: n });
    }
    const { n: optedOut } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE email_opt_out = 1`).first();
    const { results: campaigns } = await env.DB.prepare(
      `SELECT c.id, c.subject, c.audience_label, c.created_at, c.total, c.sent, c.failed, c.status, u.email AS sent_by
         FROM mail_campaigns c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC LIMIT 30`,
    ).all();
    return json({ audiences: counts, optedOut, canSend: canEmailRunners(env), campaigns });
  });

  route('GET', '/admin/mail/list', async ({ request, env, url }) => {
    await requireAdmin(request, env);
    const q = await audienceQuery(env, url.searchParams.get('aud') || 'all');
    const { results } = await env.DB.prepare(`${q.sql} ORDER BY u.created_at DESC LIMIT 5000`).bind(...q.binds).all();
    return json({ label: q.label, people: results });
  });

  route('POST', '/admin/mail/campaigns', async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    if (!canEmailRunners(env)) throw new HttpError(400, 'Email sending isn’t switched on yet (see the note at the top of this tab).');
    const b = await readJson(request);
    const subject = clean(b.subject, 200);
    const body = clean(b.body, 20000);
    if (!subject || !body) throw new HttpError(400, 'Write a subject and a message.');
    const q = await audienceQuery(env, b.audience);
    // Make sure every recipient has an unsubscribe secret, then freeze the recipient list for this send.
    await env.DB.prepare(`UPDATE users SET unsub_token = lower(hex(randomblob(16))) WHERE unsub_token IS NULL`).run();
    const res = await env.DB.prepare('INSERT INTO mail_campaigns (subject, body, audience, audience_label, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(subject, body, b.audience, q.label, admin.id).run();
    const id = res.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO mail_recipients (campaign_id, user_id, email, first_name) SELECT ?, x.id, x.email, x.first_name FROM (${q.sql}) x`)
      .bind(id, ...q.binds).run();
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_recipients WHERE campaign_id = ?').bind(id).first();
    await env.DB.prepare('UPDATE mail_campaigns SET total = ? WHERE id = ?').bind(n, id).run();
    await env.DB.prepare('INSERT INTO admin_log (admin_id, admin_email, action, target, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(admin.id, admin.email, 'email.send', q.label, `${subject} (${n} recipients)`).run();
    return json({ ok: true, id, total: n }, 201);
  });

  // Sends the next batch of a campaign. The admin page calls this repeatedly and shows the progress.
  route('POST', '/admin/mail/campaigns/:id/send', async ({ request, env, url, params }) => {
    await requireAdmin(request, env);
    const c = await env.DB.prepare('SELECT * FROM mail_campaigns WHERE id = ?').bind(params.id).first();
    if (!c) throw new HttpError(404, 'Campaign not found.');
    const { results: batch } = await env.DB.prepare(
      `SELECT mr.id, mr.email, mr.first_name, u.unsub_token, u.id AS uid, u.email_opt_out FROM mail_recipients mr LEFT JOIN users u ON u.id = mr.user_id
        WHERE mr.campaign_id = ? AND mr.status = 'queued' LIMIT ?`,
    ).bind(c.id, BATCH).all();
    for (const r of batch) {
      if (r.email_opt_out) { // unsubscribed after the list was frozen
        await env.DB.prepare(`UPDATE mail_recipients SET status = 'failed', error = 'unsubscribed' WHERE id = ?`).bind(r.id).run();
        continue;
      }
      const unsub = `${url.origin}/api/unsubscribe?u=${r.uid}&t=${r.unsub_token}`;
      const text = `${c.body.replace(/\{first_name\}/g, r.first_name || 'runner')}\n\n—\nLast Legs Standing · https://lastlegstanding.com\n`
        + `You’re getting this because you have a Last Legs Standing account. Unsubscribe: ${unsub}`;
      try {
        await sendToRunner(env, { to: r.email, subject: c.subject, text });
        await env.DB.prepare(`UPDATE mail_recipients SET status = 'sent' WHERE id = ?`).bind(r.id).run();
      } catch (e) {
        await env.DB.prepare(`UPDATE mail_recipients SET status = 'failed', error = ? WHERE id = ?`).bind(String(e.message || e).slice(0, 300), r.id).run();
      }
    }
    const t = await env.DB.prepare(
      `SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'queued') AS queued FROM mail_recipients WHERE campaign_id = ?`,
    ).bind(c.id).first();
    await env.DB.prepare('UPDATE mail_campaigns SET sent = ?, failed = ?, status = ? WHERE id = ?')
      .bind(t.sent || 0, t.failed || 0, t.queued ? 'sending' : 'done', c.id).run();
    return json({ sent: t.sent || 0, failed: t.failed || 0, remaining: t.queued || 0, total: c.total });
  });

  // One-click unsubscribe from the link in every email.
  route('GET', '/unsubscribe', async ({ env, url }) => {
    const u = Number(url.searchParams.get('u'));
    const t = String(url.searchParams.get('t') || '');
    const ok = u && /^[0-9a-f]{32}$/.test(t)
      && (await env.DB.prepare('UPDATE users SET email_opt_out = 1 WHERE id = ? AND unsub_token = ?').bind(u, t).run()).meta.changes > 0;
    const msg = ok
      ? '<h1>You’re unsubscribed.</h1><p>You won’t get race emails from us anymore. You can turn them back on any time from your profile.</p>'
      : '<h1>That link didn’t work.</h1><p>It may be old or incomplete. You can turn race emails off from your profile instead.</p>';
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preferences · Last Legs Standing</title><link rel="stylesheet" href="/css/style.css"></head>
      <body><main class="section"><div class="wrap card center" style="max-width:560px;padding:2.5rem">${msg}<p><a class="btn" href="/profile.html">My profile</a> <a class="btn ghost" href="/">Home</a></p></div></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  });

  // Runners can turn race emails on/off from their profile.
  route('POST', '/profile/email-pref', async ({ request, env }) => {
    const user = await requireViewer(request, env);
    if (user.viewingAs) throw new HttpError(400, 'Demo runners’ settings can’t be changed.');
    const { subscribed } = await readJson(request);
    await env.DB.prepare('UPDATE users SET email_opt_out = ? WHERE id = ?').bind(subscribed ? 0 : 1, user.id).run();
    return json({ ok: true, subscribed: !!subscribed });
  });
}
