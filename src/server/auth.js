import { HttpError, randomToken } from './util.js';

const COOKIE = 'lls_session';
const SESSION_DAYS = 30;
// Cloudflare Workers caps PBKDF2 at 100k iterations.
const ITERATIONS = 100_000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: b64(await derive(password, salt)), salt: b64(salt) };
}

export async function verifyPassword(password, hash, salt) {
  const candidate = new Uint8Array(await derive(password, unb64(salt)));
  const expected = unb64(hash);
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i];
  return diff === 0;
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Password must contain a letter and a number.');
}

export async function createSession(env, userId, request) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expires).run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

/**
 * Master switch for everything account-related (log in, new accounts, race sign-up, payments).
 * Set ACCOUNTS_OPEN = "true" in wrangler.toml (live) or .dev.vars (local) to turn it on.
 * While it's off, nobody is logged in, even with an old session cookie.
 */
export const accountsOpen = (env) => env.ACCOUNTS_OPEN === 'true';

/**
 * Second switch, for race sign-up and payments only (RACE_SIGNUP_OPEN = "true"). Needs accounts to be open too.
 * Lets people log in and create accounts while nobody can enter a race or be charged.
 */
export const raceSignupOpen = (env) => accountsOpen(env) && env.RACE_SIGNUP_OPEN === 'true';

export function requireRaceSignupOpen(env) {
  if (!raceSignupOpen(env)) throw new HttpError(403, 'Race registration opens soon. Thanks for your patience!');
}

export function requireAccountsOpen(env) {
  if (!accountsOpen(env)) throw new HttpError(403, 'Accounts and registration open soon. Thanks for your patience!');
}

export async function currentUser(request, env) {
  if (!accountsOpen(env)) return null;
  const token = readToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.country, s.token
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`,
  ).bind(token, Date.now()).first();
  if (!row) return null;
  // Admin rights live on the account itself (users.role), set with `npm run make-admin -- <email>`.
  // Never grant admin by email address alone: emails aren't verified, so anyone could sign up with one.
  row.isAdmin = row.role === 'admin' || row.role === 'owner';
  return row;
}

export async function destroySession(request, env) {
  const token = readToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Please log in first.');
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new HttpError(403, 'Admins only.');
  return user;
}
