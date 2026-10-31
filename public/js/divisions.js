// Divisions and awards. Shared by the website and the server (src/server/race.js imports this file).
//
// How it follows road-race convention:
//  - Categories go 3 deep: Overall, Men, Women, then Men and Women in each age group.
//  - Your age group is your age on Day 1 of the event (age on race day, as USATF does).
//  - Every category is ranked the same way as the overall race: days survived, then total distance,
//    then fastest total moving time. Disqualified runners are not ranked.
//  - No double awards ("no double dipping"): a runner wins only their highest award, in the order
//    Overall -> Men/Women -> age group, and the next runner in line moves up.

export const AWARD_DEPTH = 3;
export const NO_DOUBLE_AWARDS = true;

// [min age, max age, label]
export const AGE_GROUPS = [
  [0, 19, '19 & under'],
  [20, 39, '20–39'],
  [40, 59, '40–59'],
  [60, 79, '60–79'],
  [80, 200, '80+'],
];

const SEXES = [['Male', 'Men'], ['Female', 'Women']];

/** Age in whole years on dateStr (YYYY-MM-DD). */
export function ageOn(dob, dateStr) {
  if (!dob) return null;
  const b = new Date(`${dob}T00:00:00Z`);
  const d = new Date(`${dateStr}T00:00:00Z`);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export const ageGroup = (age) => (age == null ? null : AGE_GROUPS.find(([lo, hi]) => age >= lo && age <= hi)?.[2] ?? null);
const plural = (sex) => SEXES.find(([s]) => s === sex)?.[1];
/** e.g. "Women 30–39" */
export const divisionLabel = (sex, group) => (plural(sex) && group ? `${plural(sex)} ${group}` : plural(sex) || '');

/**
 * rows: runners already sorted by the overall ranking, each with { id, status, sex, age_group }.
 * Adds gender_place, ag_place and division to every ranked row, and returns the award categories:
 * [{ key, title, winners: [{ ...row, award_place }] }] in ceremony order.
 */
export function computeAwards(rows) {
  const ranked = rows.filter((r) => r.status !== 'disqualified');
  const genderN = {};
  const agN = {};
  for (const r of ranked) {
    r.division = divisionLabel(r.sex, r.age_group);
    if (plural(r.sex)) r.gender_place = genderN[r.sex] = (genderN[r.sex] || 0) + 1;
    if (plural(r.sex) && r.age_group) {
      const k = `${r.sex}|${r.age_group}`;
      r.ag_place = agN[k] = (agN[k] || 0) + 1;
    }
  }

  const awarded = new Set();
  const take = (key, title, pool) => {
    const winners = [];
    for (const r of pool) {
      if (winners.length >= AWARD_DEPTH) break;
      if (NO_DOUBLE_AWARDS && awarded.has(r.id)) continue;
      winners.push({ ...r, award_place: winners.length + 1 });
    }
    winners.forEach((w) => awarded.add(w.id));
    return { key, title, winners };
  };

  const out = [take('overall', 'Overall', ranked)];
  for (const [sex, title] of SEXES) out.push(take(sex.toLowerCase(), title, ranked.filter((r) => r.sex === sex)));
  for (const [, , group] of AGE_GROUPS) {
    for (const [sex] of SEXES) {
      const pool = ranked.filter((r) => r.sex === sex && r.age_group === group);
      if (pool.length) out.push(take(`${sex.toLowerCase()}-${group}`, divisionLabel(sex, group), pool));
    }
  }
  // Tag each winner's row with the award they hold.
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of out) for (const w of c.winners) {
    const r = byId.get(w.id);
    if (r && !r.award) r.award = { category: c.title, place: w.award_place };
  }
  return out;
}

/** Plain-language summary used by the rules and the home page. */
export const AGE_GROUP_LIST = AGE_GROUPS.map(([, , l]) => l).join(', ');
