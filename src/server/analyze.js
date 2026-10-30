// Run metrics + anti-cheat checks.
// Every check produces a flag { code, points, detail, hard }. Hard flags reject the run outright;
// otherwise the points add up to a risk score:  < 30 approved  |  30-69 flagged for review  |  >= 70 rejected.

import { haversine, sha256Hex } from './util.js';

const TELEPORT_MS = 12.5;     // 45 km/h between two GPS points = signal glitch or teleport
const VEHICLE_KMH = 25;       // sustained over 30 s = faster than any human distance pace
const ELITE_AVG_KMH = 21;     // ~2:51 /km average: world-record territory
const MAX_TRACK_POINTS = 400;

export function computeMetrics(points) {
  const n = points.length;
  const cd = new Array(n).fill(0); // cumulative "clean" distance
  let moving = 0;
  let teleports = 0;
  let gain = 0;
  let lastEle = points[0]?.ele ?? null;
  let longGaps = 0;

  for (let i = 1; i < n; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    const dt = (b.t - a.t) / 1000;
    const v = dt > 0 ? d / dt : Infinity;
    let credited = d;
    if (v > TELEPORT_MS && d > 100) {
      teleports++;
      credited = 0; // impossible jumps never count toward distance
    }
    if (dt > 600 && d > 3000) longGaps++;
    cd[i] = cd[i - 1] + credited;
    if (dt > 0 && dt <= 60 && v >= 0.5 && credited > 0) moving += dt;
    if (b.ele != null && lastEle != null) {
      const de = b.ele - lastEle;
      if (Math.abs(de) >= 2) { if (de > 0) gain += de; lastEle = b.ele; }
    } else if (b.ele != null) lastEle = b.ele;
  }

  // Sliding 30 s windows: vehicle seconds and max sustained speed.
  let vehicleSeconds = 0;
  let maxSustained = 0;
  const windowSpeeds = [];
  for (let i = 0, j = 0; i < n - 1; i++) {
    if (j < i) j = i;
    while (j < n - 1 && points[j].t - points[i].t < 30_000) j++;
    const dt = (points[j].t - points[i].t) / 1000;
    if (dt < 20) continue;
    const kmh = ((cd[j] - cd[i]) / dt) * 3.6;
    windowSpeeds.push(kmh);
    if (kmh > maxSustained) maxSustained = kmh;
    if (kmh > VEHICLE_KMH) vehicleSeconds += (points[i + 1].t - points[i].t) / 1000;
  }

  // Coefficient of variation of speed: real runs wobble, generated tracks don't.
  const moved = windowSpeeds.filter((s) => s > 2);
  const mean = moved.reduce((s, x) => s + x, 0) / (moved.length || 1);
  const sd = Math.sqrt(moved.reduce((s, x) => s + (x - mean) ** 2, 0) / (moved.length || 1));
  const speedCv = moved.length > 20 ? sd / mean : null;

  const hrs = points.filter((p) => p.hr).map((p) => p.hr);
  const step = Math.max(1, Math.ceil(n / MAX_TRACK_POINTS));
  const track = points.filter((_, i) => i % step === 0 || i === n - 1).map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]);

  return {
    distance_m: n ? cd[n - 1] : 0,
    moving_s: Math.round(moving),
    elapsed_s: n ? Math.round((points[n - 1].t - points[0].t) / 1000) : 0,
    start_time: n ? points[0].t : null,
    end_time: n ? points[n - 1].t : null,
    avg_hr: hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : null,
    has_hr: hrs.length > n * 0.5,
    has_cadence: points.filter((p) => p.cad).length > n * 0.5,
    max_speed_kmh: +maxSustained.toFixed(1),
    elevation_gain_m: Math.round(gain),
    teleports,
    longGaps,
    vehicleSeconds: Math.round(vehicleSeconds),
    speedCv,
    track,
  };
}

export async function fingerprint(points) {
  const f = points[0];
  const l = points[points.length - 1];
  return sha256Hex([f.t, f.lat.toFixed(4), f.lon.toFixed(4), l.t, l.lat.toFixed(4), l.lon.toFixed(4), points.length].join('|'));
}

/**
 * ctx: { metrics, sport, source, window:{start,end}, day, now, duplicateFile, duplicateTrack, overlapping }
 */
export function assessRun(ctx) {
  const { metrics: m, sport, source, window, now } = ctx;
  const flags = [];
  const flag = (code, points, detail, hard = false) => flags.push({ code, points, detail, hard });
  const fmt = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  if (m.track.length < 10 || m.distance_m < 50) {
    flag('NO_GPS', 100, 'The file has no usable GPS track. Only GPS-recorded runs can be verified.', true);
  }
  if (m.end_time > now + 120_000) {
    flag('FUTURE_TIME', 100, `The run ends at ${fmt(m.end_time)}, which is in the future. The device clock or file was altered.`, true);
  }
  if (m.start_time < window.start || m.end_time > window.end) {
    const older = m.start_time < window.start;
    flag('WRONG_DAY', 100, older
      ? `This run was recorded ${fmt(m.start_time)}, before today's race day began (${fmt(window.start)}). Old runs can't be reused.`
      : `This run crosses the daily deadline (${fmt(window.end)}). A run must start and finish within the race day.`, true);
  }
  if (ctx.duplicateFile) flag('DUPLICATE_FILE', 100, 'This exact file has already been uploaded.', true);
  if (ctx.duplicateTrack) flag('DUPLICATE_TRACK', 100, 'This exact GPS track has already been submitted (by you or another runner).', true);
  if (sport && !['running', 'walking'].includes(sport)) {
    flag('NOT_A_RUN', 100, `The device recorded this activity as "${sport}", not a run.`, true);
  }

  if (m.vehicleSeconds > 300) flag('VEHICLE', 80, `${Math.round(m.vehicleSeconds / 60)} min above ${VEHICLE_KMH} km/h. That's vehicle speed.`);
  else if (m.vehicleSeconds > 60) flag('VEHICLE', 45, `${m.vehicleSeconds} s above ${VEHICLE_KMH} km/h, which suggests a vehicle or bike.`);

  const avgKmh = m.moving_s ? (m.distance_m / m.moving_s) * 3.6 : 0;
  if (avgKmh > ELITE_AVG_KMH) flag('IMPOSSIBLE_PACE', 50, `Average moving speed ${avgKmh.toFixed(1)} km/h is faster than world-record pace.`);

  if (m.teleports >= 4) flag('GPS_JUMPS', 40, `${m.teleports} impossible GPS jumps (excluded from distance).`);
  else if (m.teleports >= 1) flag('GPS_JUMPS', 10, `${m.teleports} GPS jump(s) excluded from distance. Usually signal noise.`);

  if (m.longGaps) flag('GAP_RELOCATION', 40, 'Recording paused, then resumed more than 3 km away. Possible transport during a pause.');
  if (ctx.overlapping) flag('OVERLAP', 60, 'This run overlaps in time with another run you already submitted.');
  if (m.speedCv !== null && m.speedCv < 0.03) flag('SYNTHETIC', 35, 'The pace is unnaturally constant, typical of computer-generated GPS files.');
  if (source !== 'tracker' && !m.has_hr && !m.has_cadence) flag('NO_SENSORS', 10, 'No heart-rate or cadence data (fine for phone apps; noted for review).');

  const hard = flags.some((f) => f.hard);
  const score = Math.min(100, flags.reduce((s, f) => s + f.points, 0));
  const status = hard || score >= 70 ? 'rejected' : score >= 30 ? 'flagged' : 'approved';
  return { flags, score, status };
}
