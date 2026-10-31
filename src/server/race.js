import { dayNumber, dayWindow } from './util.js';
import { ageOn, ageGroup, computeAwards } from '../../public/js/divisions.js';

const PUBLIC_NAME = `u.first_name || ' ' || substr(u.last_name, 1, 1) || '.'`;

/**
 * Brings an event up to date. Runs lazily on API calls, so no cron job is needed:
 * it flips upcoming -> live at the start, eliminates everyone who fell short on each
 * finished day, and finalizes places once one runner (or none) is left.
 * Demo events are frozen so the preview data never changes.
 */
export async function syncEvent(env, ev, now = Date.now()) {
  if (ev.is_demo) return ev;
  const day = dayNumber(ev.start_date, now);

  if (ev.status === 'upcoming' && day >= 1) {
    await env.DB.prepare(`UPDATE events SET status = 'live', registration_open = 0 WHERE id = ?`).bind(ev.id).run();
    ev.status = 'live';
  }
  if (ev.status !== 'live') return ev;

  for (let d = ev.last_processed_day + 1; d <= day - 1; d++) {
    await env.DB.prepare(
      `UPDATE registrations SET status = 'eliminated', eliminated_day = ?2, status_reason = ?3
        WHERE event_id = ?1 AND status = 'active' AND id NOT IN (
          SELECT registration_id FROM runs
           WHERE event_id = ?1 AND race_day = ?2 AND status != 'rejected'
           GROUP BY registration_id HAVING SUM(distance_m) >= ?4)`,
    ).bind(ev.id, d, `Did not complete ${d} km on Day ${d}`, d * 1000).run();
    await env.DB.prepare('UPDATE events SET last_processed_day = ? WHERE id = ?').bind(d, ev.id).run();
    ev.last_processed_day = d;

    const { left } = await env.DB.prepare(`SELECT COUNT(*) AS left FROM registrations WHERE event_id = ? AND status = 'active'`).bind(ev.id).first();
    if (left <= 1) {
      await finalize(env, ev, d);
      break;
    }
  }
  return ev;
}

/**
 * Ranking rule: last day survived, then most total distance, then fastest total time.
 * Also ranks every division (men, women, age groups by age on Day 1) and works out the awards.
 * Birth dates never leave this function; only the age group does.
 */
export async function rankEvent(env, eventId) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.bib, r.status, r.eliminated_day, r.final_place, r.status_reason, ${PUBLIC_NAME} AS name, u.country,
            u.gender, u.dob, e.start_date,
            r.total_m AS distance_m, r.total_s AS moving_s
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       JOIN events e ON e.id = r.event_id
      WHERE r.event_id = ?`,
  ).bind(eventId).all();
  const survived = (r) => (r.status === 'active' ? Infinity : r.status === 'disqualified' ? -1 : r.eliminated_day);
  results.sort((a, b) => survived(b) - survived(a) || b.distance_m - a.distance_m || a.moving_s - b.moving_s);
  for (const r of results) {
    r.sex = ['Male', 'Female'].includes(r.gender) ? r.gender : null;
    r.age_group = ageGroup(ageOn(r.dob, r.start_date));
    delete r.gender; delete r.dob; delete r.start_date;
  }
  const awards = computeAwards(results).map((c) => ({
    ...c, winners: c.winners.map((w) => ({ id: w.id, award_place: w.award_place, name: w.name, country: w.country, bib: w.bib, division: w.division, status: w.status, eliminated_day: w.eliminated_day, distance_m: w.distance_m })),
  }));
  return { rows: results, awards };
}

export async function standings(env, eventId, limit = 1000) {
  return (await rankEvent(env, eventId)).rows.slice(0, limit);
}

async function finalize(env, ev, lastDay) {
  const rows = await standings(env, ev.id);
  let place = 0;
  const stmts = rows
    .filter((r) => r.status !== 'disqualified')
    .map((r) => env.DB.prepare('UPDATE registrations SET final_place = ? WHERE id = ?').bind(++place, r.id));
  stmts.push(env.DB.prepare(`UPDATE events SET status = 'completed', ended_day = ? WHERE id = ?`).bind(lastDay, ev.id));
  await env.DB.batch(stmts);
  ev.status = 'completed';
  ev.ended_day = lastDay;
}

/**
 * Re-evaluates one runner after an admin approves/rejects a run on a day that was already processed.
 * Rejecting a run can eliminate them retroactively; approving can reinstate them.
 */
/**
 * Keeps a runner's running totals (distance, moving time, run count) on their registration, so rankings
 * read one row per runner instead of adding up every run on every page view. Call after any run changes.
 */
export function refreshTotals(env, regId) {
  return env.DB.prepare(
    `UPDATE registrations SET
       total_m = (SELECT COALESCE(SUM(distance_m), 0) FROM runs WHERE registration_id = ?1 AND status != 'rejected'),
       total_s = (SELECT COALESCE(SUM(moving_s), 0) FROM runs WHERE registration_id = ?1 AND status != 'rejected'),
       run_count = (SELECT COUNT(*) FROM runs WHERE registration_id = ?1 AND status != 'rejected')
     WHERE id = ?1`,
  ).bind(regId).run();
}

export async function recheckRegistration(env, ev, regId) {
  await refreshTotals(env, regId);
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(regId).first();
  if (!reg || reg.status === 'disqualified' || ev.is_demo) return;
  const { results } = await env.DB.prepare(
    `SELECT race_day, SUM(distance_m) AS d FROM runs WHERE registration_id = ? AND status != 'rejected' GROUP BY race_day`,
  ).bind(regId).all();
  const byDay = Object.fromEntries(results.map((r) => [r.race_day, r.d]));
  let failDay = null;
  for (let d = 1; d <= ev.last_processed_day; d++) {
    if ((byDay[d] || 0) < d * 1000) { failDay = d; break; }
  }
  if (failDay) {
    await env.DB.prepare(`UPDATE registrations SET status = 'eliminated', eliminated_day = ?, status_reason = ? WHERE id = ?`)
      .bind(failDay, `Did not complete ${failDay} km on Day ${failDay}`, regId).run();
  } else if (reg.status === 'eliminated') {
    await env.DB.prepare(`UPDATE registrations SET status = 'active', eliminated_day = NULL, status_reason = NULL WHERE id = ?`).bind(regId).run();
  }
}

async function survivorsByDay(env, ev, throughDay) {
  const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM registrations WHERE event_id = ?').bind(ev.id).first();
  const { results } = await env.DB.prepare(
    `SELECT eliminated_day AS day, COUNT(*) AS n FROM registrations
      WHERE event_id = ? AND eliminated_day IS NOT NULL GROUP BY eliminated_day`,
  ).bind(ev.id).all();
  const out = new Map(results.map((r) => [r.day, r.n]));
  const series = [{ day: 0, left: total, out: 0 }];
  let left = total;
  for (let d = 1; d <= throughDay; d++) {
    const n = out.get(d) || 0;
    left -= n;
    series.push({ day: d, left, out: n });
  }
  return { total, series };
}

export function publicEvent(ev) {
  return {
    id: ev.id,
    slug: ev.slug,
    name: ev.name,
    tagline: ev.tagline,
    description: ev.description,
    start_date: ev.start_date,
    start_ms: Date.parse(`${ev.start_date}T00:00:00Z`),
    status: ev.status,
    fee_cents: ev.fee_cents,
    prizes: ev.prizes ? JSON.parse(ev.prizes) : [],
    registration_open: !!ev.registration_open,
    registration_closes: ev.registration_closes,
    ended_day: ev.ended_day,
    is_demo: !!ev.is_demo,
    stats: ev.stats ? JSON.parse(ev.stats) : null, // statistics this event shows (null = all)
  };
}

export async function liveStats(env, ev, now = Date.now()) {
  const day = Math.max(1, dayNumber(ev.start_date, now));
  const win = dayWindow(ev.start_date, day);
  const due = day * 1000;

  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(status = 'disqualified') AS dq,
            SUM(eliminated_day = ?2 AND status != 'active') AS out_yesterday,
            SUM(first_time = 1) AS rookies
       FROM registrations WHERE event_id = ?1`,
  ).bind(ev.id, day - 1).first();

  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS done FROM (
       SELECT ru.registration_id FROM runs ru JOIN registrations r ON r.id = ru.registration_id
        WHERE ru.event_id = ? AND ru.race_day = ? AND ru.status != 'rejected' AND r.status = 'active'
        GROUP BY ru.registration_id HAVING SUM(ru.distance_m) >= ?)`,
  ).bind(ev.id, day, due).first();

  // Fastest single run today that covered the full distance due, by moving pace.
  const fastest = await env.DB.prepare(
    `SELECT ${PUBLIC_NAME} AS name, u.country, ru.distance_m, ru.moving_s, ru.source
       FROM runs ru JOIN users u ON u.id = ru.user_id
      WHERE ru.event_id = ? AND ru.race_day = ? AND ru.status != 'rejected' AND ru.distance_m >= ?
      ORDER BY ru.moving_s * 1.0 / ru.distance_m ASC LIMIT 1`,
  ).bind(ev.id, day, due).first();

  const totals = await env.DB.prepare(
    'SELECT COALESCE(SUM(total_m), 0) AS all_m FROM registrations WHERE event_id = ?',
  ).bind(ev.id).first();

  const { series } = await survivorsByDay(env, ev, day - 1);
  const { rows: ranked, awards } = await rankEvent(env, ev.id);
  const leaders = ranked.slice(0, 25);

  return {
    event: publicEvent(ev),
    day,
    due_m: due,
    window: { start: win.start, deadline: win.end - 1 },
    server_now: now,
    total_runners: counts.total || 0,
    runners_left: counts.active || 0,
    disqualified: counts.dq || 0,
    eliminated_last_day: counts.out_yesterday || 0,
    completed_today: today.done || 0,
    rookies: counts.rookies || 0,
    total_distance_m: totals.all_m,
    fastest_today: fastest || null,
    survivors: series,
    leaderboard: leaders,
    category_leaders: awards, // who would win each award if the race ended now
  };
}

export async function pastEventStats(env, ev) {
  const lastDay = ev.ended_day || ev.last_processed_day;
  const { total, series } = await survivorsByDay(env, ev, lastDay);
  const { rows, awards } = await rankEvent(env, ev.id);
  const meta = await env.DB.prepare(
    `SELECT SUM(first_time = 1) AS rookies, SUM(first_time = 0) AS returners, SUM(status = 'disqualified') AS dq
       FROM registrations WHERE event_id = ?`,
  ).bind(ev.id).first();
  const totals = await env.DB.prepare(
    'SELECT COALESCE(SUM(total_m), 0) AS all_m, COALESCE(SUM(run_count), 0) AS runs FROM registrations WHERE event_id = ?',
  ).bind(ev.id).first();
  const fastestDays = await env.DB.prepare(
    `SELECT race_day, name, pace FROM (
       SELECT ru.race_day, ${PUBLIC_NAME} AS name, ru.moving_s * 1.0 / ru.distance_m * 1000 AS pace,
              ROW_NUMBER() OVER (PARTITION BY ru.race_day ORDER BY ru.moving_s * 1.0 / ru.distance_m) AS rn
         FROM runs ru JOIN users u ON u.id = ru.user_id
        WHERE ru.event_id = ? AND ru.status != 'rejected' AND ru.distance_m >= ru.race_day * 1000)
      WHERE rn = 1 ORDER BY race_day`,
  ).bind(ev.id).all();

  return {
    event: publicEvent(ev),
    days: lastDay,
    total_runners: total,
    rookies: meta.rookies || 0,
    returning: meta.returners || 0,
    disqualified: meta.dq || 0,
    total_distance_m: totals.all_m,
    total_runs: totals.runs,
    winner_distance_m: rows[0]?.distance_m || 0,
    podium: rows.filter((r) => r.final_place && r.final_place <= 3).sort((a, b) => a.final_place - b.final_place),
    survivors: series,
    standings: rows,
    awards,
    fastest_by_day: fastestDays.results,
  };
}
