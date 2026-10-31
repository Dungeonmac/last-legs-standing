// Admin API: events, help desk tickets, flagged runners, runs, admins, activity log.
// Every route requires an admin; every change is written to admin_log.
import { EVENT_STATS } from '../../public/js/event-stats.js';

export function registerAdminRoutes(route, d) {
  const {
    json, HttpError, readJson, clean, requireAdmin, allEvents, eventBySlug, publicEvent, rankEvent, standings,
    recheckRegistration, refreshTotals, dayNumber, dayWindow, parseActivityFile, computeMetrics, fingerprint, assessRun,
    sha256Hex, sendToRunner, canEmailRunners, verifyPassword, isEmail, isDemoRequest,
  } = d;

  const log = (env, admin, action, target, detail) => env.DB.prepare(
    'INSERT INTO admin_log (admin_id, admin_email, action, target, detail) VALUES (?, ?, ?, ?, ?)',
  ).bind(admin.id, admin.email, action, target ?? null, detail ? String(detail).slice(0, 1000) : null).run();

  const demoOk = (request) => isDemoRequest(request); // admins see demo data only while Demo mode is on

  // ---------------------------------------------------------------- overview
  route('GET', '/admin/overview', async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const events = await allEvents(env, demoOk(request));
    const { results: stats } = await env.DB.prepare(
      `SELECT event_id, COUNT(*) AS total, SUM(first_time = 1) AS first_timers, SUM(first_time = 0) AS returners,
              SUM(status = 'active') AS active, SUM(status = 'disqualified') AS dq,
              SUM(CASE WHEN payment_status = 'paid' THEN amount_cents ELSE 0 END) AS revenue_cents
         FROM registrations GROUP BY event_id`,
    ).all();
    const byId = Object.fromEntries(stats.map((s) => [s.event_id, s]));
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users WHERE password_hash != '!') AS accounts,
              (SELECT COUNT(*) FROM users WHERE role IN ('admin', 'owner')) AS admins,
              (SELECT COUNT(*) FROM support_messages WHERE status = 'open') AS open_tickets,
              (SELECT COUNT(*) FROM runs r JOIN events e ON e.id = r.event_id WHERE r.status = 'flagged' AND (e.is_demo = 0 OR ?)) AS flagged_runs`,
    ).bind(demoOk(request) ? 1 : 0).first();
    return json({
      me: { id: admin.id, email: admin.email, owner: admin.role === 'owner' },
      counts,
      emailRunners: canEmailRunners(env),
      events: events.map((e) => ({ ...publicEvent(e), stats_tracked: e.stats ? JSON.parse(e.stats) : null, numbers: byId[e.id] || { total: 0 } })),
      statOptions: EVENT_STATS,
    });
  });

  // ---------------------------------------------------------------- events
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  function eventFields(b) {
    const name = clean(b.name, 120);
    if (!name) throw new HttpError(400, 'Give the event a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '')) throw new HttpError(400, 'Choose a start date (Day 1).');
    const fee = Math.round(Number(b.fee) * 100);
    if (!(fee >= 0 && fee <= 100000)) throw new HttpError(400, 'Enter an entry fee between $0 and $1,000.');
    const prizes = [1, 2, 3].map((place, i) => ({ place, prize: clean(b.prizes?.[i], 200) || 'To be announced' }));
    const keys = EVENT_STATS.map(([k]) => k);
    const stats = Array.isArray(b.stats) ? b.stats.filter((k) => keys.includes(k)) : keys;
    return {
      name, tagline: clean(b.tagline, 200), description: clean(b.description, 4000), start_date: b.start_date, fee_cents: fee,
      prizes: JSON.stringify(prizes), registration_open: b.registration_open ? 1 : 0, stats: JSON.stringify(stats),
    };
  }

  route('POST', '/admin/events', async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    const f = eventFields(b);
    const slug = slugify(b.slug || `${f.name}`);
    if (!slug) throw new HttpError(400, 'The event needs a web address (slug).');
    if (await env.DB.prepare('SELECT id FROM events WHERE slug = ?').bind(slug).first()) throw new HttpError(409, 'An event with that web address already exists.');
    if (Date.parse(`${f.start_date}T00:00:00Z`) < Date.now()) throw new HttpError(400, 'Day 1 must be in the future.');
    await env.DB.prepare(
      `INSERT INTO events (slug, name, tagline, description, start_date, status, fee_cents, prizes, registration_open, stats, is_demo)
       VALUES (?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, 0)`,
    ).bind(slug, f.name, f.tagline, f.description, f.start_date, f.fee_cents, f.prizes, f.registration_open, f.stats).run();
    await log(env, admin, 'event.create', slug, f.name);
    return json({ ok: true, slug }, 201);
  });

  route('POST', '/admin/events/:slug', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const ev = await eventBySlug(env, params.slug, true);
    const f = eventFields(await readJson(request));
    // Once a race has started, its start date can't move (it would change every runner's race days).
    const startDate = ev.status === 'upcoming' ? f.start_date : ev.start_date;
    await env.DB.prepare(
      `UPDATE events SET name = ?, tagline = ?, description = ?, start_date = ?, fee_cents = ?, prizes = ?, registration_open = ?, stats = ? WHERE id = ?`,
    ).bind(f.name, f.tagline, f.description, startDate, f.fee_cents, f.prizes, f.registration_open, f.stats, ev.id).run();
    await log(env, admin, 'event.update', ev.slug, f.name);
    return json({ ok: true });
  });

  route('POST', '/admin/events/:slug/delete', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const ev = await eventBySlug(env, params.slug, true);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').bind(ev.id).first();
    if (n > 0) throw new HttpError(409, `This event has ${n} registration(s), so it can't be deleted. Close registration instead.`);
    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(ev.id).run();
    await log(env, admin, 'event.delete', ev.slug, ev.name);
    return json({ ok: true });
  });

  route('GET', '/admin/events/:slug/registrations', async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const ev = await eventBySlug(env, params.slug, true);
    const rows = await standings(env, ev.id, 5000);
    const { results: extra } = await env.DB.prepare(
      `SELECT r.id, u.first_name || ' ' || u.last_name AS full_name, u.email, u.phone, r.first_time, r.shirt_size, r.payment_status, r.payment_ref, r.created_at,
              r.guardian_name, r.guardian_email, r.guardian_phone
         FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.event_id = ?`,
    ).bind(ev.id).all();
    const byId = Object.fromEntries(extra.map((x) => [x.id, x]));
    return json({ event: publicEvent(ev), registrations: rows.map((r) => ({ ...r, ...byId[r.id] })) });
  });

  // Award winners with what's needed to ship their shirt and medal (only award winners get them).
  route('GET', '/admin/events/:slug/awards', async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const ev = await eventBySlug(env, params.slug, true);
    const { awards } = await rankEvent(env, ev.id);
    const ids = [...new Set(awards.flatMap((c) => c.winners.map((w) => w.id)))];
    const ship = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { results } = await env.DB.prepare(
        `SELECT r.id, u.first_name || ' ' || u.last_name AS full_name, u.email, u.phone, r.shirt_size,
                a.line1, a.line2, a.city, a.region, a.postal, a.country AS ship_country
           FROM registrations r JOIN users u ON u.id = r.user_id
           LEFT JOIN addresses a ON a.user_id = u.id AND a.kind = 'shipping'
          WHERE r.id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk).all();
      for (const x of results) ship[x.id] = x;
    }
    return json({
      event: publicEvent(ev), final: ev.status === 'completed',
      awards: awards.map((c) => ({ ...c, winners: c.winners.map((w) => ({ ...w, ...ship[w.id] })) })),
    });
  });

  // ---------------------------------------------------------------- help desk tickets
  route('GET', '/admin/support', async ({ request, env, url }) => {
    await requireAdmin(request, env);
    const status = url.searchParams.get('status') === 'closed' ? 'closed' : 'open';
    const { results: messages } = await env.DB.prepare(
      'SELECT * FROM support_messages WHERE status = ? ORDER BY created_at DESC LIMIT 200',
    ).bind(status).all();
    const ids = messages.map((m) => m.id);
    let replies = [];
    if (ids.length) {
      replies = (await env.DB.prepare(
        `SELECT sr.*, u.first_name AS admin_name FROM support_replies sr LEFT JOIN users u ON u.id = sr.admin_id
          WHERE sr.message_id IN (${ids.map(() => '?').join(',')}) ORDER BY sr.created_at`,
      ).bind(...ids).all()).results;
    }
    const { n: openCount } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM support_messages WHERE status = 'open'`).first();
    return json({
      messages: messages.map((m) => ({ ...m, replies: replies.filter((r) => r.message_id === m.id) })),
      openCount, emailRunners: canEmailRunners(env),
    });
  });

  route('POST', '/admin/support/:id/reply', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const { body, close } = await readJson(request);
    const text = clean(body, 8000);
    if (!text) throw new HttpError(400, 'Write a reply first.');
    const msg = await env.DB.prepare('SELECT * FROM support_messages WHERE id = ?').bind(params.id).first();
    if (!msg) throw new HttpError(404, 'Ticket not found.');
    const res = await env.DB.prepare('INSERT INTO support_replies (message_id, admin_id, body) VALUES (?, ?, ?)').bind(msg.id, admin.id, text).run();
    let emailed = false;
    let emailError = null;
    if (canEmailRunners(env)) {
      try {
        await sendToRunner(env, {
          to: msg.email,
          subject: `Re: [Help #${msg.id}] ${msg.topic}`,
          text: `${text}\n\n— Last Legs Standing help desk\n\n----- Your message -----\n${msg.message}`,
        });
        emailed = true;
        await env.DB.prepare('UPDATE support_replies SET emailed = 1 WHERE id = ?').bind(res.meta.last_row_id).run();
      } catch (e) {
        emailError = String(e.message || e);
        console.error('Reply email failed', e);
      }
    }
    if (close) await env.DB.prepare(`UPDATE support_messages SET status = 'closed' WHERE id = ?`).bind(msg.id).run();
    await log(env, admin, 'ticket.reply', `#${msg.id}`, `${emailed ? 'emailed' : 'saved, not emailed'}${close ? ', closed' : ''}`);
    return json({ ok: true, emailed, emailError });
  });

  route('POST', '/admin/support/:id', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const { status } = await readJson(request);
    if (!['open', 'closed'].includes(status)) throw new HttpError(400, 'Status must be open or closed.');
    await env.DB.prepare('UPDATE support_messages SET status = ? WHERE id = ?').bind(status, params.id).run();
    await log(env, admin, status === 'closed' ? 'ticket.close' : 'ticket.reopen', `#${params.id}`);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- flagged runners
  route('GET', '/admin/flags', async ({ request, env }) => {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.bib, r.status, r.status_reason, r.cleared_at, r.eliminated_day,
              u.first_name || ' ' || u.last_name AS full_name, u.email, e.name AS event_name, e.slug, e.is_demo,
              (SELECT COUNT(*) FROM runs WHERE registration_id = r.id AND status = 'flagged') AS flagged,
              (SELECT COUNT(*) FROM runs WHERE registration_id = r.id AND status = 'rejected') AS rejected,
              (SELECT MAX(risk_score) FROM runs WHERE registration_id = r.id) AS max_risk
         FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
        WHERE (e.is_demo = 0 OR ?)
          AND (r.status = 'disqualified'
               OR EXISTS (SELECT 1 FROM runs WHERE registration_id = r.id AND status IN ('flagged', 'rejected')))
        ORDER BY (r.status = 'disqualified') ASC, flagged DESC, max_risk DESC LIMIT 300`,
    ).bind(demoOk(request) ? 1 : 0).all();
    return json({ flags: results });
  });

  route('GET', '/admin/registrations/:id', async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const reg = await env.DB.prepare(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS full_name, u.email, e.name AS event_name, e.slug, e.start_date
         FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id WHERE r.id = ?`,
    ).bind(params.id).first();
    if (!reg) throw new HttpError(404, 'Registration not found.');
    const { results: runs } = await env.DB.prepare(
      `SELECT id, race_day, source, start_time, distance_m, moving_s, max_speed_kmh, risk_score, flags, status, review_note
         FROM runs WHERE registration_id = ? ORDER BY start_time DESC`,
    ).bind(reg.id).all();
    return json({ registration: reg, runs: runs.map((x) => ({ ...x, flags: JSON.parse(x.flags || '[]') })) });
  });

  // disqualify | forgive (undo a disqualification) | clear (approve all flagged runs, mark reviewed)
  route('POST', '/admin/registrations/:id/status', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const { action, reason } = await readJson(request);
    const reg = await env.DB.prepare('SELECT r.*, e.start_date FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = ?').bind(params.id).first();
    if (!reg) throw new HttpError(404, 'Registration not found.');
    const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(reg.event_id).first();
    if (action === 'disqualify') {
      if (!clean(reason)) throw new HttpError(400, 'A reason is required to disqualify a runner (the runner sees it).');
      await env.DB.prepare(`UPDATE registrations SET status = 'disqualified', eliminated_day = COALESCE(eliminated_day, ?), status_reason = ? WHERE id = ?`)
        .bind(Math.max(1, dayNumber(reg.start_date)), `Disqualified: ${clean(reason, 300)}`, reg.id).run();
    } else if (action === 'forgive' || action === 'reinstate') {
      // Back to active, then re-check every finished day so a runner who fell short is still eliminated fairly.
      await env.DB.prepare(`UPDATE registrations SET status = 'active', eliminated_day = NULL, status_reason = NULL WHERE id = ?`).bind(reg.id).run();
      await recheckRegistration(env, ev, reg.id);
    } else if (action === 'clear') {
      await env.DB.prepare(`UPDATE runs SET status = 'approved', review_note = ? WHERE registration_id = ? AND status = 'flagged'`)
        .bind(`Cleared after review (by ${admin.email})`, reg.id).run();
      await env.DB.prepare('UPDATE registrations SET cleared_at = ?, cleared_by = ? WHERE id = ?').bind(new Date().toISOString(), admin.id, reg.id).run();
      await recheckRegistration(env, ev, reg.id);
    } else throw new HttpError(400, 'Unknown action.');
    await log(env, admin, `runner.${action}`, `registration ${reg.id} (bib ${reg.bib}, ${ev.slug})`, reason);
    return json({ ok: true });
  });

  route('POST', '/admin/runs/:id/review', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const { action, note } = await readJson(request);
    if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Action must be approve or reject.');
    const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(params.id).first();
    if (!run) throw new HttpError(404, 'Run not found.');
    await env.DB.prepare('UPDATE runs SET status = ?, review_note = ? WHERE id = ?')
      .bind(action === 'approve' ? 'approved' : 'rejected', `${clean(note, 500) || action} (by ${admin.email})`, run.id).run();
    const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(run.event_id).first();
    await recheckRegistration(env, ev, run.registration_id);
    await log(env, admin, `run.${action}`, `run ${run.id}`, note);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- runners & their runs
  route('GET', '/admin/users', async ({ request, env, url }) => {
    await requireAdmin(request, env);
    const q = `%${clean(url.searchParams.get('q'), 100) || ''}%`;
    const { results: users } = await env.DB.prepare(
      `SELECT id, email, first_name, last_name, role, created_at FROM users
        WHERE password_hash != '!' AND (email LIKE ?1 OR first_name || ' ' || last_name LIKE ?1) ORDER BY created_at DESC LIMIT 50`,
    ).bind(q).all();
    const ids = users.map((u) => u.id);
    let regs = [];
    if (ids.length) {
      regs = (await env.DB.prepare(
        `SELECT r.id, r.user_id, r.bib, r.status, e.name AS event_name, e.slug, e.status AS event_status, e.is_demo
           FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id IN (${ids.map(() => '?').join(',')})`,
      ).bind(...ids).all()).results;
    }
    return json({ users: users.map((u) => ({ ...u, registrations: regs.filter((r) => r.user_id === u.id) })) });
  });

  // Upload a run for a runner (e.g. their watch file emailed to the help desk). Any day of the race can be filled in.
  route('POST', '/admin/registrations/:id/runs', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(params.id).first();
    if (!reg) throw new HttpError(404, 'Registration not found.');
    const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(reg.event_id).first();
    const form = await request.formData();
    const f = form.get('file');
    if (!f || typeof f === 'string') throw new HttpError(400, 'Attach a .gpx, .tcx or .fit file.');
    const buffer = await f.arrayBuffer();
    const parsed = parseActivityFile(f.name, buffer);
    const points = parsed.points.filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0));
    if (points.length < 2) throw new HttpError(400, 'No GPS points found in this file.');
    const m = computeMetrics(points);
    const day = dayNumber(ev.start_date, m.start_time);
    if (day < 1) throw new HttpError(400, 'This run happened before the race started.');
    if (ev.ended_day && day > ev.ended_day) throw new HttpError(400, 'This run happened after the race ended.');
    if (day > dayNumber(ev.start_date)) throw new HttpError(400, 'This run is dated in the future.');
    const window = dayWindow(ev.start_date, day);
    const fp = await fingerprint(points);
    const fileHash = await sha256Hex(buffer);
    const verdict = assessRun({ metrics: m, sport: parsed.sport, source: parsed.format, window, day, now: Math.min(Date.now(), window.end - 1) });
    await env.DB.prepare(
      `INSERT INTO runs (registration_id, user_id, event_id, race_day, source, start_time, end_time, distance_m, moving_s, elapsed_s,
         avg_hr, max_speed_kmh, elevation_gain_m, track, file_hash, fingerprint, risk_score, flags, status, review_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
    ).bind(reg.id, reg.user_id, ev.id, day, parsed.format, m.start_time, m.end_time, m.distance_m, m.moving_s, m.elapsed_s, m.avg_hr,
      m.max_speed_kmh, m.elevation_gain_m, JSON.stringify(m.track), fileHash, fp, verdict.score, JSON.stringify(verdict.flags),
      `Added by admin ${admin.email}`).run();
    await recheckRegistration(env, ev, reg.id);
    await log(env, admin, 'run.add', `registration ${reg.id} (bib ${reg.bib})`, `Day ${day}, ${(m.distance_m / 1000).toFixed(2)} km, ${f.name}`);
    return json({ ok: true, day, distance_m: m.distance_m, checks: verdict.flags }, 201);
  });

  route('POST', '/admin/runs/:id/delete', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(params.id).first();
    if (!run) throw new HttpError(404, 'Run not found.');
    await env.DB.prepare('DELETE FROM runs WHERE id = ?').bind(run.id).run();
    const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(run.event_id).first();
    await refreshTotals(env, run.registration_id);
    await recheckRegistration(env, ev, run.registration_id);
    await log(env, admin, 'run.remove', `run ${run.id} (registration ${run.registration_id})`,
      `Day ${run.race_day}, ${(run.distance_m / 1000).toFixed(2)} km, ${run.source}, started ${new Date(run.start_time).toISOString()}`);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- admins
  route('GET', '/admin/admins', async ({ request, env }) => {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      `SELECT id, email, first_name, last_name, role FROM users WHERE role IN ('admin', 'owner') ORDER BY role = 'owner' DESC, email`,
    ).all();
    return json({ admins: results });
  });

  route('POST', '/admin/admins', async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const email = (clean((await readJson(request)).email, 200) || '').toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Enter the email address of their account.');
    const u = await env.DB.prepare('SELECT id, role FROM users WHERE email = ?').bind(email).first();
    if (!u) throw new HttpError(404, 'No account with that email. Ask them to create an account first (Log in → Create an account).');
    if (u.role === 'owner' || u.role === 'admin') throw new HttpError(409, 'That account is already an admin.');
    await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(u.id).run();
    await log(env, admin, 'admin.add', email);
    return json({ ok: true });
  });

  // The owner account can only be removed as an admin with the owner password (stored as a hash in OWNER_PASSWORD_HASH).
  route('POST', '/admin/admins/:id/remove', async ({ request, env, params }) => {
    const admin = await requireAdmin(request, env);
    const { password } = await readJson(request);
    const u = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(params.id).first();
    if (!u || !['admin', 'owner'].includes(u.role)) throw new HttpError(404, 'That account isn’t an admin.');
    if (u.role === 'owner') {
      const [salt, hash] = String(env.OWNER_PASSWORD_HASH || '').split(':');
      if (!salt || !hash) throw new HttpError(403, 'The owner account can’t be removed: no owner password is configured.');
      if (!password || !(await verifyPassword(String(password), hash, salt))) {
        await log(env, admin, 'admin.remove-owner-denied', u.email, 'wrong owner password');
        throw new HttpError(403, 'Wrong owner password. The owner account was not removed.');
      }
    }
    await env.DB.prepare(`UPDATE users SET role = 'runner' WHERE id = ?`).bind(u.id).run();
    await log(env, admin, 'admin.remove', u.email, u.role === 'owner' ? 'owner (password confirmed)' : null);
    return json({ ok: true, self: u.id === admin.id });
  });

  // ---------------------------------------------------------------- activity log
  route('GET', '/admin/log', async ({ request, env }) => {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 300').all();
    return json({ log: results });
  });
}
