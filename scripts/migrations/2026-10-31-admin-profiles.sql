-- Live database migration (2026-10-31). Adds only; deletes nothing.
-- Run once:  npx wrangler d1 execute lls-db --remote --file scripts/migrations/2026-10-31-admin-profiles.sql
-- Events: which statistics the event shows (JSON array of keys; NULL = all).
ALTER TABLE events ADD COLUMN stats TEXT;
-- Profiles: picture (small JPEG/PNG/WebP as a data URL, resized in the browser).
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN avatar_updated INTEGER;
-- Flag reviews: when an admin cleared a runner's flags.
ALTER TABLE registrations ADD COLUMN cleared_at TEXT;
ALTER TABLE registrations ADD COLUMN cleared_by INTEGER;
-- Help desk replies sent from Admin.
CREATE TABLE IF NOT EXISTS support_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  emailed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS support_replies_msg ON support_replies(message_id);
-- Everything admins do, for accountability.
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS admin_log_created ON admin_log(created_at);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
-- The site owner: can only be removed as an admin with the owner password.
UPDATE users SET role = 'owner' WHERE email = 'jeffeersonjeff546@gmail.com';
