-- Last Legs Standing database schema (Cloudflare D1 / SQLite)
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS strava_tokens;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT,
  gender TEXT,
  country TEXT,
  phone TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  role TEXT NOT NULL DEFAULT 'runner',          -- runner | admin
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- shipping | billing
  line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, region TEXT,
  postal TEXT NOT NULL, country TEXT NOT NULL,
  UNIQUE(user_id, kind)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  start_date TEXT NOT NULL,                      -- YYYY-MM-DD, Day 1 begins 00:00:00 UTC
  status TEXT NOT NULL DEFAULT 'upcoming',       -- upcoming | live | completed
  fee_cents INTEGER NOT NULL DEFAULT 3000,
  prizes TEXT,                                   -- JSON array of {place, prize}
  registration_open INTEGER NOT NULL DEFAULT 1,
  registration_closes TEXT,                      -- ISO timestamp
  last_processed_day INTEGER NOT NULL DEFAULT 0,
  ended_day INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  bib INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',         -- active | eliminated | disqualified
  first_time INTEGER NOT NULL,                   -- 1 = first time, 0 = returning
  shirt_size TEXT,
  amount_cents INTEGER NOT NULL,
  payment_status TEXT NOT NULL,                  -- paid | demo_paid | refunded
  payment_ref TEXT,
  waiver_version TEXT NOT NULL,
  waiver_signed_name TEXT NOT NULL,
  waiver_signed_at TEXT NOT NULL,
  waiver_ip TEXT,
  eliminated_day INTEGER,
  status_reason TEXT,
  final_place INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, user_id),
  UNIQUE(event_id, bib)
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  race_day INTEGER NOT NULL,
  source TEXT NOT NULL,                          -- gpx | tcx | fit | tracker | strava
  start_time INTEGER NOT NULL,                   -- unix ms
  end_time INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  moving_s INTEGER NOT NULL,
  elapsed_s INTEGER NOT NULL,
  avg_hr INTEGER,
  max_speed_kmh REAL,
  elevation_gain_m REAL,
  track TEXT,                                    -- JSON [[lat,lon],...] simplified, for maps
  file_key TEXT,                                 -- R2 key of the original file
  file_hash TEXT,
  fingerprint TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  flags TEXT,                                    -- JSON [{code, points, detail}]
  status TEXT NOT NULL,                          -- approved | flagged | rejected
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX runs_event_day ON runs(event_id, race_day);
CREATE INDEX runs_user ON runs(user_id);
CREATE INDEX runs_hash ON runs(file_hash);
CREATE INDEX runs_fp ON runs(fingerprint);

CREATE TABLE strava_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id INTEGER,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
