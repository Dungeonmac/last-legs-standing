// Stripe (payments) and Strava (activity import).
// Both switch on automatically once their keys exist in the environment; until then the
// site runs in demo mode (test card form) and the Strava button explains it isn't connected yet.

import { HttpError, dayWindow } from './util.js';

// ---------------- Stripe ----------------
export const stripeEnabled = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY);

async function stripe(env, path, params, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(402, data.error?.message || 'Payment provider error.');
  return data;
}

export const stripeTestMode = (env) => String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

export function createPaymentIntent(env, amountCents, email, ev) {
  return stripe(env, 'payment_intents', {
    amount: String(amountCents),
    currency: 'usd',
    receipt_email: email, // Stripe emails the runner a receipt
    description: `${ev.name} entry fee`,
    'metadata[event_slug]': ev.slug,
    'metadata[email]': email,
    'automatic_payment_methods[enabled]': 'true',
  });
}

/** Checks a payment really went through, for the right amount and race, before a registration is saved. */
export async function verifyPaymentIntent(env, id, amountCents, eventSlug) {
  const pi = await stripe(env, `payment_intents/${encodeURIComponent(id)}`, null, 'GET');
  if (pi.status !== 'succeeded' || pi.amount_received < amountCents || pi.currency !== 'usd') throw new HttpError(402, 'Payment has not completed.');
  if (pi.metadata?.event_slug !== eventSlug) throw new HttpError(402, 'This payment was for a different race.');
  return pi;
}

// ---------------- Strava ----------------
export const stravaEnabled = (env) => !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);

export function stravaAuthorizeUrl(env, origin, state) {
  const p = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${origin}/api/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${p}`;
}

async function tokenRequest(env, params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params }),
  });
  if (!res.ok) throw new HttpError(502, 'Strava rejected the authorization.');
  return res.json();
}

export async function stravaExchange(env, userId, code) {
  const t = await tokenRequest(env, { code, grant_type: 'authorization_code' });
  await env.DB.prepare(
    `INSERT INTO strava_tokens (user_id, athlete_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`,
  ).bind(userId, t.athlete?.id ?? null, t.access_token, t.refresh_token, t.expires_at).run();
}

async function stravaToken(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM strava_tokens WHERE user_id = ?').bind(userId).first();
  if (!row) throw new HttpError(400, 'Strava is not connected to your account.');
  if (row.expires_at > Date.now() / 1000 + 60) return row.access_token;
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await env.DB.prepare('UPDATE strava_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?')
    .bind(t.access_token, t.refresh_token, t.expires_at, userId).run();
  return t.access_token;
}

async function stravaGet(env, userId, path) {
  const token = await stravaToken(env, userId);
  const res = await fetch(`https://www.strava.com/api/v3/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(502, `Strava request failed (${res.status}).`);
  return res.json();
}

export async function stravaTodaysActivities(env, userId, ev, day) {
  const w = dayWindow(ev.start_date, day);
  const list = await stravaGet(env, userId, `athlete/activities?after=${Math.floor(w.start / 1000)}&before=${Math.floor(w.end / 1000)}&per_page=30`);
  return list.map((a) => ({
    id: a.id, name: a.name, sport_type: a.sport_type, start: a.start_date, distance_m: a.distance, moving_s: a.moving_time, manual: a.manual,
  }));
}

/** Pulls the full GPS stream so the run goes through exactly the same checks as an uploaded file. */
export async function stravaActivityPoints(env, userId, activityId) {
  const a = await stravaGet(env, userId, `activities/${encodeURIComponent(activityId)}`);
  const s = await stravaGet(env, userId, `activities/${encodeURIComponent(activityId)}/streams?keys=time,latlng,altitude,heartrate,cadence&key_by_type=true`);
  const start = Date.parse(a.start_date);
  const time = s.time?.data || [];
  const latlng = s.latlng?.data || [];
  const points = time.map((sec, i) => ({
    t: start + sec * 1000,
    lat: latlng[i]?.[0],
    lon: latlng[i]?.[1],
    ele: s.altitude?.data?.[i] ?? null,
    hr: s.heartrate?.data?.[i] ?? null,
    cad: s.cadence?.data?.[i] ?? null,
  })).filter((p) => Number.isFinite(p.lat));
  const sport = /run|walk|hike/i.test(a.sport_type || a.type) ? (/run/i.test(a.sport_type || a.type) ? 'running' : 'walking') : 'other';
  // Manually-entered Strava activities have no GPS stream, so they fail the NO_GPS check.
  return { sport, device: a.device_name || 'Strava', points, stravaId: a.id };
}

// ---------------- Email (help desk) ----------------
// Help desk messages are always saved in the database and shown in Admin. They are also emailed to
// SUPPORT_EMAIL once RESEND_API_KEY is set (free account at resend.com). Until you verify your own
// domain with Resend, its test sender can only deliver to the email address you signed up to Resend with.
export const emailEnabled = (env) => !!(env.RESEND_API_KEY && env.SUPPORT_EMAIL);

export async function sendEmail(env, { to, replyTo, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Last Legs Standing <onboarding@resend.dev>',
      to: [to], reply_to: replyTo, subject, text,
    }),
  });
  if (!res.ok) throw new Error(`Email provider error (${res.status}): ${await res.text()}`);
}
