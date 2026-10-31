// The statistics an event can show on its live and results pages. Admins pick these per event.
// Shared by the admin page, the live/results pages and the server (validation).
// [key, label, description]
export const EVENT_STATS = [
  ['runners_left', 'Runners left & eliminations', 'Runners still standing, eliminated yesterday, and done for today.'],
  ['first_timers', 'First-timers vs returning', 'How many runners are new and how many are back.'],
  ['fastest_today', 'Fastest run of the day', 'The fastest full-distance run each day.'],
  ['total_distance', 'Distance run by everyone', 'The combined distance of all runners.'],
  ['survivors_chart', 'Runners-left chart', 'A chart of how many runners were left after each day.'],
  ['leaderboard', 'Leaderboard', 'The ranking of runners (live) and final standings (results).'],
  ['division_leaders', 'Division leaders & awards', 'Top 3 overall, men, women and every age group.'],
  ['fastest_by_day', 'Fastest run, every day', 'Results page: the fastest full-distance run on each day of the race.'],
];

/** Hides every element marked data-stat="key" that the event doesn't track (null = show everything). */
export function applyEventStats(root, tracked) {
  if (!Array.isArray(tracked)) return;
  root.querySelectorAll('[data-stat]').forEach((el) => { el.hidden = !tracked.includes(el.dataset.stat); });
}
