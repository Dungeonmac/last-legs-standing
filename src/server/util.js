export const DAY_MS = 86_400_000;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

/** Day N of an event runs from 00:00:00 UTC to 23:59:59.999 UTC. */
export function dayWindow(startDate, day) {
  const start = Date.parse(`${startDate}T00:00:00Z`) + (day - 1) * DAY_MS;
  return { start, end: start + DAY_MS };
}

/** Race day number for a moment in time (can be <= 0 before the start). */
export function dayNumber(startDate, t = Date.now()) {
  return Math.floor((t - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) + 1;
}

export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function required(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`, { missing });
}

export function clean(s, max = 200) {
  return s === undefined || s === null ? null : String(s).trim().slice(0, max);
}

/** Great-circle distance in meters. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6_371_008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
