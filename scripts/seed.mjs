// Generates scripts/seed.sql with SAMPLE data so every page can be previewed:
//   - a completed sample past event (2025)
//   - a live demo event that is on Day 18 today
//   - the real upcoming 2027 event (placeholder date) with registration open
//   - an admin account and a test runner account (printed at the end)
// Run with: npm run db:reset
// --prod writes scripts/seed-prod.sql for the live site: same demo data, but WITHOUT the demo admin account
// (its password is in this public repo). Live admins come from ADMIN_EMAILS instead.

import { writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const DAY = 86_400_000;
let seed = 20261029;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  const b64 = (b) => Buffer.from(b).toString('base64');
  return { hash: b64(bits), salt: b64(salt) };
}

const FIRST_M = ['Liam', 'Noah', 'Kai', 'Mateo', 'Lucas', 'Ethan', 'Leo', 'Omar', 'Jonas', 'Diego', 'Felix', 'Theo', 'Ravi', 'Malik', 'Tomas', 'Arjun', 'Sam', 'Kenji', 'Oscar', 'Ben', 'Hugo', 'Finn', 'Ivan', 'Marco', 'Jack'];
const FIRST_F = ['Ava', 'Mia', 'Zoe', 'Aisha', 'Sofia', 'Yuki', 'Amara', 'Freya', 'Ines', 'Priya', 'Nora', 'Hana', 'Lena', 'Chloe', 'Elin', 'Grace', 'Ingrid', 'Lucia', 'Maya', 'Zara', 'Ama', 'Rosa', 'Leila', 'Nia', 'Sara'];
const LAST = ['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Silva', 'Novak', 'Haddad', 'Kowalski', 'Mensah', 'Rossi', 'Fischer', 'Garcia', 'Nguyen', 'Patel', 'Murphy', 'Costa', 'Jensen', 'Abebe', 'Kim', 'Dubois', 'Walsh', 'Ortega', 'Sato', 'Berg', 'Kariuki', 'Reyes', 'Hughes', 'Ivanova', 'Mbeki', 'Larsen', 'Park', 'Santos', 'Weber', 'Ali', 'Clarke', 'Romero', 'Popescu', 'Yilmaz', 'Brennan', 'Achebe'];
const COUNTRIES = ['United States', 'United States', 'United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Norway', 'Poland', 'Kenya', 'South Africa', 'Nigeria', 'Brazil', 'Mexico', 'Argentina', 'Japan', 'South Korea', 'India', 'Australia', 'New Zealand', 'Israel', 'Turkey', 'Portugal'];

const sql = [];
const users = [];
const regs = [];
const runs = [];
let userId = 0;
let regId = 0;

// Ages spread like a real running field: mostly 25-55, a few teens and 70+.
function randomDob() {
  const age = Math.round(12 + 62 * (rand() * 0.5 + rand() * 0.5));
  const m = 1 + Math.floor(rand() * 12);
  const d = 1 + Math.floor(rand() * 28);
  return `${2026 - age}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addUser(u) {
  userId++;
  const gender = u.gender || (rand() < 0.55 ? 'Male' : 'Female');
  users.push({ id: userId, role: 'runner', password_hash: '!', password_salt: '!', dob: randomDob(), gender, first_name: pick(gender === 'Male' ? FIRST_M : FIRST_F), ...u });
  return userId;
}

function simulateRunner(ev, uid, bib, capacity, opts = {}) {
  regId++;
  const basePace = 270 + rand() * 180; // seconds per km
  const startMs = Date.parse(`${ev.start_date}T00:00:00Z`);
  const lastDay = Math.min(capacity, ev.simulateThrough);
  let total = 0;
  let secs = 0;
  for (let d = 1; d <= lastDay; d++) {
    const failing = d === capacity;
    const isToday = d === ev.today;
    let dist = failing ? (rand() < 0.5 ? 0 : d * 1000 * (0.3 + rand() * 0.65)) : d * 1000 + 30 + rand() * 350;
    if (isToday && !failing && rand() < 0.35) dist = 0; // hasn't run yet today
    if (dist <= 0) continue;
    const pace = basePace * (0.92 + rand() * 0.16) * (1 + d / 120);
    const parts = dist > 6000 && rand() < 0.25 ? 2 : 1;
    for (let p = 0; p < parts; p++) {
      const pd = dist / parts;
      const moving = Math.round((pd / 1000) * pace);
      const dayStart = startMs + (d - 1) * DAY;
      const latest = Math.min(dayStart + DAY - 60_000, ev.now) - moving * 1000 - 300_000;
      const earliest = dayStart + (p === 0 ? 4 : 14) * 3_600_000;
      if (latest < dayStart) continue;
      const start = Math.max(dayStart + 60_000, Math.min(latest, earliest + rand() * (latest - earliest)));
      if (start + moving * 1000 > ev.now) continue;
      const flagged = opts.flagDay === d;
      runs.push({
        registration_id: regId, user_id: uid, event_id: ev.id, race_day: d, source: pick(['fit', 'fit', 'gpx', 'gpx', 'strava', 'tcx', 'tracker']),
        start_time: Math.round(start), end_time: Math.round(start + moving * 1000 + rand() * 240_000), distance_m: Math.round(pd),
        moving_s: moving, elapsed_s: moving + Math.round(rand() * 240), avg_hr: 135 + Math.round(rand() * 30),
        max_speed_kmh: +(3600 / pace * 1.25).toFixed(1), elevation_gain_m: Math.round(rand() * pd / 40),
        risk_score: flagged ? 45 : Math.round(rand() * 12),
        flags: JSON.stringify(flagged ? [{ code: 'VEHICLE', points: 45, detail: '94 s above 25 km/h, which suggests a vehicle or bike.' }] : []),
        status: flagged ? 'flagged' : 'approved',
      });
      total += pd;
      secs += moving;
    }
  }
  const eliminated = capacity <= ev.lastProcessed;
  const reg = {
    id: regId, event_id: ev.id, user_id: uid, bib, first_time: rand() < 0.62 ? 1 : 0, shirt_size: pick(['XS', 'S', 'M', 'M', 'L', 'L', 'XL', 'XXL']),
    amount_cents: 3000, payment_status: 'demo_paid', payment_ref: 'DEMO-seed', waiver_version: '2026-10-29', waiver_signed_name: 'seed',
    waiver_signed_at: new Date(startMs - 20 * DAY).toISOString(), status: eliminated ? 'eliminated' : 'active',
    eliminated_day: eliminated ? capacity : null, status_reason: eliminated ? `Did not complete ${capacity} km on Day ${capacity}` : null,
    final_place: null, total, secs,
  };
  if (opts.dq) {
    reg.status = 'disqualified';
    reg.eliminated_day = opts.dq;
    reg.status_reason = 'Disqualified: Run recorded in a vehicle (reviewed by race officials)';
  }
  regs.push(reg);
  return reg;
}

function capacityCurve(maxDay) {
  // Most runners crack between day 6 and 20; a few go much longer.
  return Math.max(2, Math.ceil(2 + (maxDay - 4) * rand() ** 1.7));
}

const now = Date.now();
const todayUtc = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
const liveStart = new Date(todayUtc - 17 * DAY).toISOString().slice(0, 10);

const events = [
  {
    id: 1, slug: 'lls-2025-sample', name: 'Last Legs Standing 2025', tagline: 'The first edition (sample data)', start_date: '2025-03-01',
    status: 'completed', registration_open: 0, last_processed_day: 44, ended_day: 44, is_demo: 1,
    description: 'Sample results that show how a finished event is presented. Every runner and number here is generated.',
    prizes: [{ place: 1, prize: 'Champion' }, { place: 2, prize: 'Runner-up' }, { place: 3, prize: 'Third place' }],
    simulateThrough: 44, lastProcessed: 44, today: null, now,
  },
  {
    id: 2, slug: 'lls-2026-demo', name: 'Last Legs Standing 2026 (Demo)', tagline: 'Live demo race on Day 18', start_date: liveStart,
    status: 'live', registration_open: 0, last_processed_day: 17, ended_day: null, is_demo: 1,
    description: 'A frozen demo race so you can see the live page in action. Every runner and number here is generated.',
    prizes: [{ place: 1, prize: 'To be announced' }, { place: 2, prize: 'To be announced' }, { place: 3, prize: 'To be announced' }],
    simulateThrough: 18, lastProcessed: 17, today: 18, now,
  },
  {
    id: 3, slug: 'lls-2027', name: 'Last Legs Standing 2027: The First Stand', tagline: 'The first edition. One more kilometer a day until the first champion is crowned.', start_date: '2027-03-01',
    status: 'upcoming', registration_open: 1, last_processed_day: 0, ended_day: null, is_demo: 0,
    description: 'The inaugural Last Legs Standing. Runners all over the world start together on March 1, 2027 with 1 km, and the distance climbs by 1 km every day until only one runner is left. History starts here: the first champion’s name goes in the record books for good.',
    prizes: [{ place: 1, prize: 'To be announced' }, { place: 2, prize: 'To be announced' }, { place: 3, prize: 'To be announced' }],
  },
];

// ----- demo accounts
const admin = await hash('AdminDemo2026!');
const runner = await hash('RunDemo2026!');
const PROD = process.argv.includes('--prod');
const adminId = PROD ? null : addUser({ email: 'admin@lastlegsstanding.test', first_name: 'Race', last_name: 'Director', country: 'United States', role: 'owner', password_hash: admin.hash, password_salt: admin.salt });
const testId = addUser({ email: 'runner@lastlegsstanding.test', first_name: 'Test', last_name: 'Runner', country: 'United States', password_hash: PROD ? '!' : runner.hash, password_salt: PROD ? '!' : runner.salt, dob: '1992-05-14', gender: 'Male' });
const paid = await hash('PaidDemo2026!');
const paidId = addUser({ email: 'paid@lastlegsstanding.test', first_name: 'Jordan', last_name: 'Rivera', country: 'United States', password_hash: PROD ? '!' : paid.hash, password_salt: PROD ? '!' : paid.salt, dob: '1995-08-21', gender: 'Female' });
void adminId;
const addresses = [
  { user_id: testId, kind: 'shipping', line1: '1 Demo Street', city: 'Austin', region: 'TX', postal: '78701', country: 'United States' },
  { user_id: paidId, kind: 'shipping', line1: '22 Sample Avenue', city: 'Brooklyn', region: 'NY', postal: '11201', country: 'United States' },
];

// ----- past sample event: 160 runners, ends on Day 44 with one survivor
{
  const ev = events[0];
  const n = 160;
  const caps = Array.from({ length: n }, () => Math.min(43, capacityCurve(44)));
  caps[0] = 999; // champion survives Day 44
  caps[1] = 44;  // two runners both fail on Day 44: distance tiebreak decides 2nd vs 3rd
  caps[2] = 44;
  for (let i = 0; i < n; i++) {
    const uid = addUser({ email: `sample${i}@example.invalid`, last_name: pick(LAST), country: pick(COUNTRIES) });
    simulateRunner(ev, uid, i + 1, caps[i], i === 40 ? { dq: 12, flagDay: 12 } : {});
  }
  const mine = regs.filter((r) => r.event_id === 1);
  const survived = (r) => (r.status === 'disqualified' ? -1 : r.eliminated_day ?? Infinity);
  mine.sort((a, b) => survived(b) - survived(a) || b.total - a.total || a.secs - b.secs);
  let place = 0;
  for (const r of mine) if (r.status !== 'disqualified') r.final_place = ++place;
  // Mark flagged run of the DQ'd runner as rejected, as an official would have.
  for (const run of runs) if (run.event_id === 1 && run.status === 'flagged') run.status = 'rejected';
}

// ----- live demo event: 240 runners, today is Day 18
{
  const ev = events[1];
  const n = 240;
  simulateRunner(ev, testId, 1, 999); // test runner: active, has not run yet today (maybe)
  for (let i = 1; i < n; i++) {
    const uid = addUser({ email: `demo${i}@example.invalid`, last_name: pick(LAST), country: pick(COUNTRIES) });
    const cap = rand() < 0.45 ? 999 : capacityCurve(40);
    const opts = i === 7 ? { dq: 9, flagDay: 9 } : i % 37 === 0 && cap > 18 ? { flagDay: 18 } : {};
    simulateRunner(ev, uid, i + 1, cap, opts);
  }
  // Test runner should start today fresh so uploads can be tried.
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].user_id === testId && runs[i].race_day === 18) runs.splice(i, 1);
  for (const run of runs) if (run.event_id === 2 && run.status === 'flagged' && run.race_day < 18) run.status = 'rejected';
}

// ----- demo runner who has signed up and paid for the upcoming 2027 race (race not started yet)
regId++;
regs.push({
  id: regId, event_id: 3, user_id: paidId, bib: 1, status: 'active', first_time: 1, shirt_size: 'M', amount_cents: 3000,
  payment_status: 'demo_paid', payment_ref: 'DEMO-Visa-4242', waiver_version: '2026-10-30.2', waiver_signed_name: 'Jordan Rivera',
  waiver_signed_at: new Date(now - 2 * DAY).toISOString(), eliminated_day: null, status_reason: null, final_place: null,
});

// ----- SQL
sql.push('DELETE FROM mail_recipients; DELETE FROM mail_campaigns; DELETE FROM admin_log; DELETE FROM support_replies; DELETE FROM support_messages; DELETE FROM runs; DELETE FROM registrations; DELETE FROM addresses; DELETE FROM sessions; DELETE FROM strava_tokens; DELETE FROM events; DELETE FROM users;');
for (const e of events) {
  sql.push(`INSERT INTO events (id, slug, name, tagline, description, start_date, status, fee_cents, prizes, registration_open, last_processed_day, ended_day, is_demo) VALUES (${[
    e.id, e.slug, e.name, e.tagline, e.description, e.start_date, e.status, 3000, JSON.stringify(e.prizes), e.registration_open, e.last_processed_day, e.ended_day, e.is_demo,
  ].map(q).join(', ')});`);
}
function bulk(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150).map((r) => `(${cols.map((c) => q(r[c])).join(', ')})`);
    sql.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${chunk.join(',\n')};`);
  }
}
bulk('users', ['id', 'email', 'password_hash', 'password_salt', 'first_name', 'last_name', 'dob', 'gender', 'country', 'role'], users);
// Running totals per registration (the site keeps these up to date as runs come in).
for (const r of regs) {
  const mine = runs.filter((x) => x.registration_id === r.id && x.status !== 'rejected');
  r.total_m = Math.round(mine.reduce((s, x) => s + x.distance_m, 0));
  r.total_s = mine.reduce((s, x) => s + x.moving_s, 0);
  r.run_count = mine.length;
}
bulk('registrations', ['id', 'event_id', 'user_id', 'bib', 'status', 'first_time', 'shirt_size', 'amount_cents', 'payment_status', 'payment_ref', 'waiver_version', 'waiver_signed_name', 'waiver_signed_at', 'eliminated_day', 'status_reason', 'final_place', 'total_m', 'total_s', 'run_count'], regs);
bulk('addresses', ['user_id', 'kind', 'line1', 'city', 'region', 'postal', 'country'], addresses);
bulk('runs', ['registration_id', 'user_id', 'event_id', 'race_day', 'source', 'start_time', 'end_time', 'distance_m', 'moving_s', 'elapsed_s', 'avg_hr', 'max_speed_kmh', 'elevation_gain_m', 'risk_score', 'flags', 'status'], runs);

writeFileSync(new URL(PROD ? './seed-prod.sql' : './seed.sql', import.meta.url), sql.join('\n') + '\n');
writeFileSync(new URL('./demo-meta.json', import.meta.url), JSON.stringify({ liveStart, generatedAt: new Date(now).toISOString() }, null, 2));
console.log(`seed.sql written: ${users.length} users, ${regs.length} registrations, ${runs.length} runs. Live demo started ${liveStart}.`);
console.log('Admin login:  admin@lastlegsstanding.test / AdminDemo2026!');
console.log('Runner login: runner@lastlegsstanding.test / RunDemo2026!  (mid-race, Day 18)');
console.log('Paid login:   paid@lastlegsstanding.test / PaidDemo2026!  (registered + paid, race not started)');
