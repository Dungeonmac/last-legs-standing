import { HttpError, json, readJson, required, clean, dayNumber, dayWindow, sha256Hex, randomToken } from './util.js';
import { hashPassword, verifyPassword, validatePassword, createSession, clearSessionCookie, currentUser, destroySession, requireUser, requireAdmin } from './auth.js';
import { parseActivityFile } from './parsers.js';
import { computeMetrics, fingerprint, assessRun } from './analyze.js';
import { syncEvent, liveStats, pastEventStats, publicEvent, recheckRegistration, standings, rankEvent, refreshTotals } from './race.js';
import {
  stripeEnabled, createPaymentIntent, verifyPaymentIntent,
  stravaEnabled, stravaAuthorizeUrl, stravaExchange, stravaTodaysActivities, stravaActivityPoints,
  emailEnabled, sendEmail,
} from './integrations.js';
import { ageGroup, divisionLabel } from '../../public/js/divisions.js';

export const WAIVER_VERSION = '2026-10-30.2';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

// Public race data (live race, events, results) is the same for every visitor, so Cloudflare's edge cache
// keeps each answer for a minute. That keeps database reads low however many people are watching.
// Admin demo-mode requests are never cached.
const PUBLIC_CACHE = /^\/(live|events(\/[^/]+)?)$/;
const PUBLIC_CACHE_SECONDS = 60;

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const cacheable = request.method === 'GET' && PUBLIC_CACHE.test(path) && !isDemoRequest(request) && typeof caches !== 'undefined';
  const cacheKey = cacheable ? new Request(url.toString(), { method: 'GET' }) : null;
  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    // Countdowns use server_now to correct a phone's wrong clock, so it must be fresh even on a cached answer.
    if (hit) return json(JSON.parse((await hit.text()).replace(/"server_now":\d+/, `"server_now":${Date.now()}`)));
  }
  for (const r of routes) {
    if (r.method !== request.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    try {
      const res = await r.handler({ request, env, url, params: m.groups || {} });
      if (cacheable && res.status === 200) {
        const copy = new Response(res.clone().body, res);
        copy.headers.set('cache-control', `public, s-maxage=${PUBLIC_CACHE_SECONDS}, max-age=0`);
        await caches.default.put(cacheKey, copy);
      }
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      // The free database plan has a daily limit. Say so plainly instead of a vague error.
      if (/D1_ERROR.*(limit|exceeded)/i.test(String(e?.message))) {
        return json({ error: 'The site is over its daily database limit. It resets at midnight UTC. Please try again after that.' }, 503);
      }
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  }
  return json({ error: 'Not found' }, 404);
}

// ---------------------------------------------------------------- admin demo mode
// Demo events and demo runners are hidden from the public. An admin can switch on Demo mode (the browser then
// sends X-LLS-Demo: 1) to see the whole site with the demo data, and X-LLS-Demo-As to view it as a demo runner.
// Both headers are ignored unless the logged-in user is an admin.
const DEMO_RUNNERS = { paid: 'paid@lastlegsstanding.test', runner: 'runner@lastlegsstanding.test' };
const isDemoRequest = (request) => request.headers.get('x-lls-demo') === '1';

async function isAdminDemo(request, env) {
  if (!isDemoRequest(request)) return false;
  return !!(await currentUser(request, env))?.isAdmin;
}

/** The logged-in user, or (admins in demo mode only) the demo runner they chose to view the site as. */
async function viewer(request, env) {
  const user = await currentUser(request, env);
  if (!user) return null;
  user.demo = false;
  if (!user.isAdmin || !isDemoRequest(request)) return user;
  user.demo = true;
  const email = DEMO_RUNNERS[request.headers.get('x-lls-demo-as')];
  if (!email) return user;
  const as = await env.DB.prepare('SELECT id, email, first_name, last_name, role, country FROM users WHERE email = ?').bind(email).first();
  return as ? { ...as, isAdmin: true, demo: true, viewingAs: `${as.first_name} ${as.last_name}` } : user;
}

async function requireViewer(request, env) {
  const user = await viewer(request, env);
  if (!user) throw new HttpError(401, 'Please log in first.');
  return user;
}

// ---------------------------------------------------------------- helpers
async function allEvents(env, demo = false) {
  const { results } = await env.DB.prepare('SELECT * FROM events ORDER BY start_date').all();
  const visible = results.filter((ev) => demo || !ev.is_demo);
  for (const ev of visible) if (ev.status !== 'completed') await syncEvent(env, ev);
  return visible;
}

async function eventBySlug(env, slug, demo = false) {
  const ev = await env.DB.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first();
  if (!ev || (ev.is_demo && !demo)) throw new HttpError(404, 'Event not found.');
  if (ev.status !== 'completed') await syncEvent(env, ev);
  return ev;
}

async function liveRegistration(env, userId, demo = false) {
  await allEvents(env, demo);
  return env.DB.prepare(
    `SELECT r.id AS reg_id, r.status AS reg_status, r.bib, r.status_reason, e.*
       FROM registrations r JOIN events e ON e.id = r.event_id
      WHERE r.user_id = ? AND e.status = 'live' AND (e.is_demo = 0 OR ?) ORDER BY e.start_date DESC LIMIT 1`,
  ).bind(userId, demo ? 1 : 0).first();
}

async function dayProgress(env, regId, day) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(distance_m), 0) AS d FROM runs WHERE registration_id = ? AND race_day = ? AND status != 'rejected'`,
  ).bind(regId, day).first();
  return row.d;
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s || '');
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function ageOn(dob, dateStr) {
  const b = new Date(`${dob}T00:00:00Z`);
  const d = new Date(`${dateStr}T00:00:00Z`);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

function validAddress(a, label) {
  if (!a) throw new HttpError(400, `${label} address is required.`);
  required(a, ['line1', 'city', 'postal', 'country']);
  return {
    line1: clean(a.line1), line2: clean(a.line2), city: clean(a.city, 100), region: clean(a.region, 100),
    postal: clean(a.postal, 20), country: clean(a.country, 60),
  };
}

// ---------------------------------------------------------------- config & auth
route('GET', '/config', async ({ request, env }) => json({
  // Sign-up opens to the public once real card payments (Stripe) are set up. Admins in demo mode can preview it.
  registrationOpen: stripeEnabled(env) || (await isAdminDemo(request, env)),
  stripePublishableKey: stripeEnabled(env) ? env.STRIPE_PUBLISHABLE_KEY : null,
  strava: stravaEnabled(env),
  waiverVersion: WAIVER_VERSION,
  supportTopics: SUPPORT_TOPICS,
}));

route('GET', '/me', async ({ request, env }) => {
  const user = await viewer(request, env);
  if (!user) return json({ user: null });
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.bib, r.status, r.eliminated_day, r.final_place, r.shirt_size, r.amount_cents, r.payment_status, r.created_at,
            e.id AS event_id, e.slug, e.name, e.status AS event_status, e.start_date
       FROM registrations r JOIN events e ON e.id = r.event_id
      WHERE r.user_id = ? AND (e.is_demo = 0 OR ?) ORDER BY e.start_date DESC`,
  ).bind(user.id, user.demo ? 1 : 0).all();
  const p = await env.DB.prepare('SELECT dob, gender FROM users WHERE id = ?').bind(user.id).first();
  for (const r of results) {
    r.division = divisionLabel(p.gender, ageGroup(p.dob ? ageOn(p.dob, r.start_date) : null));
    // Award (if any) from a finished event
    if (r.event_status === 'completed') {
      const { rows } = await rankEvent(env, r.event_id);
      r.award = rows.find((x) => x.id === r.id)?.award || null;
    }
    delete r.id; delete r.event_id;
  }
  return json({
    user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, isAdmin: user.isAdmin, demo: user.demo, viewingAs: user.viewingAs || null },
    registrations: results,
  });
});

// Password guessing protection: after too many wrong passwords from one device (IP) or for one account,
// logins pause for 15 minutes.
const LOGIN_WINDOW = '-15 minutes';
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_EMAIL = 8;

route('POST', '/auth/login', async ({ request, env }) => {
  const body = await readJson(request);
  const email = (clean(body.email, 200) || '').toLowerCase();
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const since = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${LOGIN_WINDOW}')`;
  const fails = await env.DB.prepare(
    `SELECT SUM(ip = ?1) AS by_ip, SUM(email = ?2) AS by_email FROM login_failures WHERE at > ${since}`,
  ).bind(ip, email).first();
  if ((fails?.by_ip || 0) >= MAX_FAILS_PER_IP || (fails?.by_email || 0) >= MAX_FAILS_PER_EMAIL) {
    throw new HttpError(429, 'Too many wrong passwords. For your security, wait 15 minutes and try again, or contact the help desk.');
  }
  const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!u || !(await verifyPassword(String(body.password || ''), u.password_hash, u.password_salt))) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_failures (ip, email) VALUES (?, ?)').bind(ip, email),
      env.DB.prepare(`DELETE FROM login_failures WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`),
    ]);
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  await env.DB.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run();
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id, request) });
});

// Create an account without entering a race (anyone can enter a race later from the sign-up page).
route('POST', '/auth/register', async ({ request, env }) => {
  const b = await readJson(request);
  required(b, ['first_name', 'last_name', 'email', 'password']);
  if (!isEmail(b.email)) throw new HttpError(400, 'Enter a valid email address.');
  validatePassword(b.password);
  const email = clean(b.email, 200).toLowerCase();
  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) {
    throw new HttpError(409, 'An account with this email already exists. Log in instead.');
  }
  const { hash, salt } = await hashPassword(b.password);
  const res = await env.DB.prepare('INSERT INTO users (email, password_hash, password_salt, first_name, last_name) VALUES (?, ?, ?, ?, ?)')
    .bind(email, hash, salt, clean(b.first_name, 60), clean(b.last_name, 60)).run();
  return json({ ok: true }, 201, { 'set-cookie': await createSession(env, res.meta.last_row_id, request) });
});

route('POST', '/auth/logout', async ({ request, env }) => {
  await destroySession(request, env);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
});

// ---------------------------------------------------------------- signup + payment
route('POST', '/payments/intent', async ({ request, env }) => {
  if (!stripeEnabled(env)) throw new HttpError(400, 'Card payments are in demo mode.');
  const body = await readJson(request);
  const ev = await eventBySlug(env, clean(body.event_slug));
  const pi = await createPaymentIntent(env, ev.fee_cents, clean(body.email), ev.name);
  return json({ clientSecret: pi.client_secret, id: pi.id });
});

route('POST', '/signup', async ({ request, env }) => {
  const b = await readJson(request);
  const sessionUser = await currentUser(request, env);
  const preview = !stripeEnabled(env) && !!sessionUser?.isAdmin && isDemoRequest(request);
  if (!stripeEnabled(env) && !preview) throw new HttpError(403, 'Registration opens soon. Card payments are being set up.');

  required(b, ['event_slug', 'first_time', 'first_name', 'last_name', 'dob', 'gender', 'country', 'phone', 'emergency_name', 'emergency_phone', 'shirt_size']);
  if (!['first', 'returning'].includes(b.first_time)) throw new HttpError(400, 'Tell us whether this is your first time.');
  if (!['Male', 'Female'].includes(b.gender)) throw new HttpError(400, 'Choose Male or Female.');
  const ev = await eventBySlug(env, clean(b.event_slug));
  if (!ev.registration_open || ev.status !== 'upcoming') throw new HttpError(400, 'Registration for this event is closed.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dob) || Date.parse(`${b.dob}T00:00:00Z`) >= Date.now()) throw new HttpError(400, 'Enter a valid date of birth.');

  // Runners under 18 on the start date need a parent or guardian, who signs the waiver too.
  let guardian = null;
  if (ageOn(b.dob, ev.start_date) < 18) {
    const g = b.guardian || {};
    if (!g.agreed) throw new HttpError(400, 'A parent or guardian must give consent for runners under 18.');
    required(g, ['name', 'relationship', 'email', 'phone', 'signed_name']);
    if (!isEmail(g.email)) throw new HttpError(400, "Enter a valid email for the parent or guardian.");
    if (normName(g.name) === normName(`${b.first_name} ${b.last_name}`)) throw new HttpError(400, 'The parent or guardian must be a different person from the runner.');
    if (normName(g.signed_name) !== normName(g.name)) throw new HttpError(400, "The parent or guardian's signature must match their name exactly.");
    guardian = {
      name: clean(g.name, 120), relationship: clean(g.relationship, 40), email: clean(g.email, 200).toLowerCase(), phone: clean(g.phone, 40),
      signed_name: clean(g.signed_name, 120), signed_at: new Date().toISOString(),
    };
  }

  const shipping = validAddress(b.shipping, 'Shipping');
  const billing = b.billing_same ? shipping : validAddress(b.billing, 'Billing');

  const w = b.waiver || {};
  if (!w.agreed_rules || !w.agreed_waiver || !w.agreed_age) throw new HttpError(400, 'You must accept the rules and the waiver.');
  if (w.version !== WAIVER_VERSION) throw new HttpError(409, 'The waiver was updated. Please reload the page and review it again.');
  if (normName(w.signed_name) !== normName(`${b.first_name} ${b.last_name}`)) {
    throw new HttpError(400, 'Your signature must match your first and last name exactly.');
  }

  // Admin demo mode: everything above was checked for real, but nothing is saved and no card is charged.
  if (preview) return json({ ok: true, preview: true, bib: 0, event: publicEvent(ev), demoPayment: true }, 200);

  let userId = sessionUser?.id;
  let email = sessionUser?.email;
  if (!userId) {
    required(b, ['email', 'password']);
    if (!isEmail(b.email)) throw new HttpError(400, 'Enter a valid email address.');
    validatePassword(b.password);
    email = clean(b.email).toLowerCase();
    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) throw new HttpError(409, 'An account with this email already exists. Log in first, then sign up.');
  } else {
    const dup = await env.DB.prepare('SELECT id FROM registrations WHERE event_id = ? AND user_id = ?').bind(ev.id, userId).first();
    if (dup) throw new HttpError(409, "You're already registered for this event.");
  }

  // Payment: real Stripe when configured, otherwise demo mode (card number never leaves the browser).
  let paymentStatus;
  let paymentRef;
  if (stripeEnabled(env)) {
    if (!b.payment?.payment_intent) throw new HttpError(402, 'Payment is required.');
    const pi = await verifyPaymentIntent(env, b.payment.payment_intent, ev.fee_cents);
    paymentStatus = 'paid';
    paymentRef = pi.id;
  } else {
    if (!/^\d{4}$/.test(b.payment?.last4 || '')) throw new HttpError(402, 'Card details are required.');
    paymentStatus = 'demo_paid';
    paymentRef = `DEMO-${b.payment.brand || 'card'}-${b.payment.last4}`;
  }

  let cookie;
  if (!userId) {
    const { hash, salt } = await hashPassword(b.password);
    const res = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, password_salt, first_name, last_name, dob, gender, country, phone, emergency_name, emergency_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(email, hash, salt, clean(b.first_name, 60), clean(b.last_name, 60), b.dob, clean(b.gender, 30), clean(b.country, 60),
      clean(b.phone, 40), clean(b.emergency_name, 120), clean(b.emergency_phone, 40)).run();
    userId = res.meta.last_row_id;
    cookie = await createSession(env, userId, request);
  } else {
    await env.DB.prepare(
      `UPDATE users SET first_name = ?, last_name = ?, dob = ?, gender = ?, country = ?, phone = ?, emergency_name = ?, emergency_phone = ? WHERE id = ?`,
    ).bind(clean(b.first_name, 60), clean(b.last_name, 60), b.dob, clean(b.gender, 30), clean(b.country, 60), clean(b.phone, 40),
      clean(b.emergency_name, 120), clean(b.emergency_phone, 40), userId).run();
  }

  const upsertAddr = (kind, a) => env.DB.prepare(
    `INSERT INTO addresses (user_id, kind, line1, line2, city, region, postal, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET line1 = excluded.line1, line2 = excluded.line2, city = excluded.city,
       region = excluded.region, postal = excluded.postal, country = excluded.country`,
  ).bind(userId, kind, a.line1, a.line2, a.city, a.region, a.postal, a.country);

  const { nextBib } = await env.DB.prepare('SELECT COALESCE(MAX(bib), 0) + 1 AS nextBib FROM registrations WHERE event_id = ?').bind(ev.id).first();
  await env.DB.batch([
    upsertAddr('shipping', shipping),
    upsertAddr('billing', billing),
    env.DB.prepare(
      `INSERT INTO registrations (event_id, user_id, bib, first_time, shirt_size, amount_cents, payment_status, payment_ref,
         waiver_version, waiver_signed_name, waiver_signed_at, waiver_ip,
         guardian_name, guardian_relationship, guardian_email, guardian_phone, guardian_signed_name, guardian_signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(ev.id, userId, nextBib, b.first_time === 'first' ? 1 : 0, clean(b.shirt_size, 10), ev.fee_cents, paymentStatus, paymentRef,
      WAIVER_VERSION, clean(w.signed_name, 120), new Date().toISOString(), request.headers.get('cf-connecting-ip') || 'local',
      guardian?.name ?? null, guardian?.relationship ?? null, guardian?.email ?? null, guardian?.phone ?? null,
      guardian?.signed_name ?? null, guardian?.signed_at ?? null),
  ]);

  return json({ ok: true, bib: nextBib, event: publicEvent(ev), demoPayment: paymentStatus === 'demo_paid' }, 201, cookie ? { 'set-cookie': cookie } : {});
});

// ---------------------------------------------------------------- events & live
route('GET', '/events', async ({ request, env }) => {
  const events = await allEvents(env, await isAdminDemo(request, env));
  const { results: counts } = await env.DB.prepare('SELECT event_id, COUNT(*) AS n FROM registrations GROUP BY event_id').all();
  const n = Object.fromEntries(counts.map((c) => [c.event_id, c.n]));
  const out = { upcoming: [], live: [], past: [] };
  for (const ev of events) {
    const pe = { ...publicEvent(ev), registered: n[ev.id] || 0 };
    if (ev.status === 'completed') {
      const winner = await env.DB.prepare(
        `SELECT u.first_name || ' ' || substr(u.last_name, 1, 1) || '.' AS name, u.country FROM registrations r JOIN users u ON u.id = r.user_id
          WHERE r.event_id = ? AND r.final_place = 1`,
      ).bind(ev.id).first();
      out.past.push({ ...pe, winner });
    } else out[ev.status === 'live' ? 'live' : 'upcoming'].push(pe);
  }
  out.past.reverse();
  return json(out);
});

route('GET', '/events/:slug', async ({ request, env, params }) => {
  const ev = await eventBySlug(env, params.slug, await isAdminDemo(request, env));
  if (ev.status === 'completed') return json({ kind: 'past', ...(await pastEventStats(env, ev)) });
  if (ev.status === 'live') return json({ kind: 'live', ...(await liveStats(env, ev)) });
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').bind(ev.id).first();
  return json({ kind: 'upcoming', event: publicEvent(ev), registered: n });
});

route('GET', '/live', async ({ request, env, url }) => {
  const events = await allEvents(env, await isAdminDemo(request, env));
  const wanted = url.searchParams.get('event');
  const live = events.filter((e) => e.status === 'live');
  const ev = live.find((e) => e.slug === wanted) || live.find((e) => !e.is_demo) || live[0];
  if (!ev) {
    const next = events.find((e) => e.status === 'upcoming');
    return json({ live: false, next: next ? publicEvent(next) : null });
  }
  return json({ live: true, ...(await liveStats(env, ev)) });
});

// ---------------------------------------------------------------- runner dashboard
route('GET', '/dashboard', async ({ request, env }) => {
  const user = await requireViewer(request, env);
  const reg = await liveRegistration(env, user.id, user.demo);
  let race = null;
  if (reg) {
    const day = Math.max(1, dayNumber(reg.start_date));
    const win = dayWindow(reg.start_date, day);
    race = {
      event: publicEvent(reg), bib: reg.bib, status: reg.reg_status, status_reason: reg.status_reason,
      day, due_m: day * 1000, done_m: await dayProgress(env, reg.reg_id, day), deadline: win.end - 1, server_now: Date.now(),
    };
  }
  const { results: runs } = await env.DB.prepare(
    `SELECT r.id, r.race_day, r.source, r.start_time, r.distance_m, r.moving_s, r.status, r.risk_score, r.flags, r.review_note, e.name AS event_name
       FROM runs r JOIN events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY r.start_time DESC LIMIT 60`,
  ).bind(user.id).all();
  const strava = await env.DB.prepare('SELECT athlete_id FROM strava_tokens WHERE user_id = ?').bind(user.id).first();
  const shipping = await env.DB.prepare(`SELECT city, region, country FROM addresses WHERE user_id = ? AND kind = 'shipping'`).bind(user.id).first();
  return json({
    user: { first_name: user.first_name, last_name: user.last_name, email: user.email, isAdmin: user.isAdmin },
    shipping,
    race,
    runs: runs.map((r) => ({ ...r, flags: JSON.parse(r.flags || '[]') })),
    strava: { enabled: stravaEnabled(env), connected: !!strava },
  });
});

// ---------------------------------------------------------------- run ingestion
async function ingestRun(env, user, parsed, source, file) {
  const reg = await liveRegistration(env, user.id, user.demo);
  if (!reg) throw new HttpError(400, "You're not registered in a race that is currently live.");
  if (reg.reg_status !== 'active') {
    throw new HttpError(403, `You're out of this race (${reg.reg_status}${reg.status_reason ? `: ${reg.status_reason}` : ''}).`);
  }
  const now = Date.now();
  const day = Math.max(1, dayNumber(reg.start_date, now));
  const window = dayWindow(reg.start_date, day);

  const points = parsed.points.filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0));
  if (points.length < 2) throw new HttpError(400, 'No GPS points found in this activity. Only GPS-recorded runs can be submitted.');

  const m = computeMetrics(points);
  const fp = await fingerprint(points);
  const fileHash = file ? await sha256Hex(file.buffer) : null;

  const [dupFile, dupTrack, overlap] = await Promise.all([
    fileHash ? env.DB.prepare(`SELECT id FROM runs WHERE file_hash = ? AND status != 'rejected' LIMIT 1`).bind(fileHash).first() : null,
    env.DB.prepare(`SELECT id FROM runs WHERE fingerprint = ? AND status != 'rejected' LIMIT 1`).bind(fp).first(),
    env.DB.prepare(`SELECT id FROM runs WHERE user_id = ? AND status != 'rejected' AND start_time < ? AND end_time > ? LIMIT 1`)
      .bind(user.id, m.end_time, m.start_time).first(),
  ]);

  const verdict = assessRun({
    metrics: m, sport: parsed.sport, source, window, day, now,
    duplicateFile: !!dupFile, duplicateTrack: !!dupTrack, overlapping: !!overlap,
  });

  let fileKey = null;
  if (file && env.UPLOADS) {
    fileKey = `runs/${user.id}/${now}-${file.name.replace(/[^\w.-]/g, '_')}`;
    await env.UPLOADS.put(fileKey, file.buffer);
  }

  const res = await env.DB.prepare(
    `INSERT INTO runs (registration_id, user_id, event_id, race_day, source, start_time, end_time, distance_m, moving_s, elapsed_s,
       avg_hr, max_speed_kmh, elevation_gain_m, track, file_key, file_hash, fingerprint, risk_score, flags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(reg.reg_id, user.id, reg.id, day, source, m.start_time, m.end_time, m.distance_m, m.moving_s, m.elapsed_s, m.avg_hr,
    m.max_speed_kmh, m.elevation_gain_m, JSON.stringify(m.track), fileKey, fileHash, fp, verdict.score,
    JSON.stringify(verdict.flags), verdict.status).run();
  await refreshTotals(env, reg.reg_id);

  const done = await dayProgress(env, reg.reg_id, day);
  return json({
    run: {
      id: res.meta.last_row_id, status: verdict.status, risk_score: verdict.score, flags: verdict.flags,
      distance_m: m.distance_m, moving_s: m.moving_s, elapsed_s: m.elapsed_s, start_time: m.start_time, end_time: m.end_time,
      avg_hr: m.avg_hr, elevation_gain_m: m.elevation_gain_m, track: m.track, device: parsed.device, sport: parsed.sport,
    },
    today: { day, due_m: day * 1000, done_m: done, complete: done >= day * 1000, deadline: window.end - 1 },
  }, verdict.status === 'rejected' ? 422 : 201);
}

route('POST', '/runs/upload', async ({ request, env }) => {
  const user = await requireViewer(request, env);
  const form = await request.formData();
  const f = form.get('file');
  if (!f || typeof f === 'string') throw new HttpError(400, 'Attach a .gpx, .tcx or .fit file.');
  if (f.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (25 MB max).');
  const buffer = await f.arrayBuffer();
  const parsed = parseActivityFile(f.name, buffer);
  return ingestRun(env, user, parsed, parsed.format, { name: f.name, buffer });
});

route('POST', '/runs/track', async ({ request, env }) => {
  const user = await requireViewer(request, env);
  const body = await readJson(request);
  if (!Array.isArray(body.points) || body.points.length > 200_000) throw new HttpError(400, 'Invalid track.');
  const points = body.points
    .map((p) => ({ t: Number(p.t), lat: Number(p.lat), lon: Number(p.lon), ele: p.ele == null ? null : Number(p.ele), hr: null, cad: null }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => a.t - b.t);
  return ingestRun(env, user, { sport: 'running', device: 'Last Legs Standing tracker', points }, 'tracker', null);
});

route('GET', '/runs/:id', async ({ request, env, params }) => {
  const user = await requireViewer(request, env);
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(params.id).first();
  if (!run || (run.user_id !== user.id && !user.isAdmin)) throw new HttpError(404, 'Run not found.');
  return json({ ...run, track: JSON.parse(run.track || '[]'), flags: JSON.parse(run.flags || '[]'), file_hash: undefined, fingerprint: undefined });
});

// ---------------------------------------------------------------- Strava
route('GET', '/strava/connect', async ({ request, env, url }) => {
  const user = await requireUser(request, env);
  if (!stravaEnabled(env)) throw new HttpError(400, 'Strava connection is not configured yet.');
  const state = `${user.id}.${randomToken(12)}`;
  return new Response(null, {
    status: 302,
    headers: { location: stravaAuthorizeUrl(env, url.origin, state), 'set-cookie': `lls_strava_state=${state}; Path=/api/strava; HttpOnly; SameSite=Lax; Max-Age=600` },
  });
});

route('GET', '/strava/callback', async ({ request, env, url }) => {
  const user = await requireUser(request, env);
  const state = url.searchParams.get('state');
  const cookieState = (request.headers.get('cookie') || '').match(/lls_strava_state=([^;]+)/)?.[1];
  if (!state || state !== cookieState || !state.startsWith(`${user.id}.`)) throw new HttpError(400, 'Strava sign-in expired. Try again.');
  if (url.searchParams.get('error')) return Response.redirect(`${url.origin}/upload.html?strava=denied`, 302);
  await stravaExchange(env, user.id, url.searchParams.get('code'));
  return Response.redirect(`${url.origin}/upload.html?strava=connected`, 302);
});

route('GET', '/strava/activities', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const reg = await liveRegistration(env, user.id);
  if (!reg) throw new HttpError(400, "You're not in a live race.");
  const day = Math.max(1, dayNumber(reg.start_date));
  return json({ activities: await stravaTodaysActivities(env, user.id, reg, day) });
});

route('POST', '/strava/import', async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { id } = await readJson(request);
  const parsed = await stravaActivityPoints(env, user.id, id);
  return ingestRun(env, user, parsed, 'strava', { name: `strava-${id}.json`, buffer: new TextEncoder().encode(`strava:${parsed.stravaId}`) });
});

// ---------------------------------------------------------------- help desk
const SUPPORT_TOPICS = ['Uploading a run', 'Built-in tracker', 'Account or login', 'Payment or refund', 'Awards, shirts & medals', 'Rules question', 'Complaint', 'Other'];

route('POST', '/support', async ({ request, env }) => {
  const b = await readJson(request);
  if (b.website) return json({ ok: true }); // honeypot field: only bots fill it in
  required(b, ['name', 'email', 'topic', 'message']);
  if (!isEmail(b.email)) throw new HttpError(400, 'Enter a valid email address so we can reply.');
  if (!SUPPORT_TOPICS.includes(b.topic)) throw new HttpError(400, 'Choose a topic.');
  if (String(b.message).trim().length < 10) throw new HttpError(400, 'Tell us a little more about the problem.');
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const { n } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM support_messages WHERE ip = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')`,
  ).bind(ip).first();
  if (n >= 5) throw new HttpError(429, 'You’ve sent several messages in the last few minutes. Please wait a little, or email us directly.');

  const user = await currentUser(request, env);
  const msg = {
    name: clean(b.name, 120), email: clean(b.email, 200), bib: clean(b.bib, 20), topic: b.topic, message: clean(b.message, 5000),
  };
  const res = await env.DB.prepare(
    'INSERT INTO support_messages (user_id, name, email, bib, topic, message, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(user?.id ?? null, msg.name, msg.email, msg.bib, msg.topic, msg.message, ip).run();
  const id = res.meta.last_row_id;

  let emailed = false;
  if (emailEnabled(env)) {
    try {
      await sendEmail(env, {
        to: env.SUPPORT_EMAIL, replyTo: msg.email, subject: `[Help #${id}] ${msg.topic}: ${msg.name}`,
        text: [
          `Topic: ${msg.topic}`, `From: ${msg.name} <${msg.email}>`, `Bib: ${msg.bib || '(none given)'}`,
          `Logged in as: ${user ? `${user.first_name} ${user.last_name} <${user.email}>` : '(not logged in)'}`,
          `Sent: ${new Date().toUTCString()}`, '', msg.message, '', 'Reply to this email to answer the runner directly.',
        ].join('\n'),
      });
      emailed = true;
      await env.DB.prepare('UPDATE support_messages SET emailed = 1 WHERE id = ?').bind(id).run();
    } catch (e) {
      console.error('Help desk email failed', e); // the message is still saved and visible in Admin
    }
  }
  return json({ ok: true, id, emailed }, 201);
});

route('GET', '/admin/support', async ({ request, env }) => {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare('SELECT * FROM support_messages ORDER BY status = \'open\' DESC, created_at DESC LIMIT 200').all();
  return json({ messages: results, emailEnabled: emailEnabled(env), supportEmail: env.SUPPORT_EMAIL || null });
});

route('POST', '/admin/support/:id', async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const { status } = await readJson(request);
  if (!['open', 'closed'].includes(status)) throw new HttpError(400, 'Status must be open or closed.');
  await env.DB.prepare('UPDATE support_messages SET status = ? WHERE id = ?').bind(status, params.id).run();
  return json({ ok: true });
});

// ---------------------------------------------------------------- admin
route('GET', '/admin/overview', async ({ request, env }) => {
  await requireAdmin(request, env);
  const events = await allEvents(env, true);
  const { results: stats } = await env.DB.prepare(
    `SELECT event_id, COUNT(*) AS total, SUM(first_time = 1) AS first_timers, SUM(first_time = 0) AS returners,
            SUM(status = 'active') AS active, SUM(status = 'disqualified') AS dq,
            SUM(CASE WHEN payment_status IN ('paid', 'demo_paid') THEN amount_cents ELSE 0 END) AS revenue_cents
       FROM registrations GROUP BY event_id`,
  ).all();
  const byId = Object.fromEntries(stats.map((s) => [s.event_id, s]));
  const { results: queue } = await env.DB.prepare(
    `SELECT ru.id, ru.race_day, ru.source, ru.start_time, ru.distance_m, ru.moving_s, ru.risk_score, ru.flags, ru.status, ru.max_speed_kmh,
            u.first_name || ' ' || u.last_name AS runner, u.email, r.bib, e.name AS event_name
       FROM runs ru JOIN users u ON u.id = ru.user_id JOIN registrations r ON r.id = ru.registration_id JOIN events e ON e.id = ru.event_id
      WHERE ru.status = 'flagged' OR (ru.status = 'rejected' AND ru.risk_score < 100 AND ru.review_note IS NULL)
      ORDER BY ru.status = 'flagged' DESC, ru.created_at DESC LIMIT 100`,
  ).all();
  return json({
    events: events.map((e) => ({ ...publicEvent(e), stats: byId[e.id] || { total: 0 } })),
    queue: queue.map((q) => ({ ...q, flags: JSON.parse(q.flags || '[]') })),
  });
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
  return json({ ok: true });
});

route('GET', '/admin/events/:slug/registrations', async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const ev = await eventBySlug(env, params.slug, true);
  const rows = await standings(env, ev.id, 5000);
  const { results: extra } = await env.DB.prepare(
    `SELECT r.id, u.first_name || ' ' || u.last_name AS full_name, u.email, r.first_time, r.shirt_size, r.payment_status, r.created_at
       FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.event_id = ?`,
  ).bind(ev.id).all();
  const byId = Object.fromEntries(extra.map((x) => [x.id, x]));
  return json({ event: publicEvent(ev), registrations: rows.map((r) => ({ ...r, ...byId[r.id] })) });
});

// Award winners with what's needed to ship their shirt and medal. Only award winners get them.
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
    event: publicEvent(ev),
    final: ev.status === 'completed',
    awards: awards.map((c) => ({ ...c, winners: c.winners.map((w) => ({ ...w, ...ship[w.id] })) })),
  });
});

route('POST', '/admin/registrations/:id/status', async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const { action, reason } = await readJson(request);
  const reg = await env.DB.prepare('SELECT r.*, e.start_date FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = ?').bind(params.id).first();
  if (!reg) throw new HttpError(404, 'Registration not found.');
  if (action === 'disqualify') {
    if (!clean(reason)) throw new HttpError(400, 'A reason is required to disqualify a runner.');
    await env.DB.prepare(`UPDATE registrations SET status = 'disqualified', eliminated_day = COALESCE(eliminated_day, ?), status_reason = ? WHERE id = ?`)
      .bind(Math.max(1, dayNumber(reg.start_date)), `Disqualified: ${clean(reason, 300)}`, reg.id).run();
  } else if (action === 'reinstate') {
    await env.DB.prepare(`UPDATE registrations SET status = 'active', eliminated_day = NULL, status_reason = NULL WHERE id = ?`).bind(reg.id).run();
  } else throw new HttpError(400, 'Unknown action.');
  return json({ ok: true });
});
