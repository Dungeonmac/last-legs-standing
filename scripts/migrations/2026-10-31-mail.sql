-- Live database migration (2026-10-31): email list. Adds only; deletes nothing.
-- Run once:  npx wrangler d1 execute lls-db --remote --file scripts/migrations/2026-10-31-mail.sql
ALTER TABLE users ADD COLUMN email_opt_out INTEGER NOT NULL DEFAULT 0;  -- 1 = unsubscribed from race emails
ALTER TABLE users ADD COLUMN unsub_token TEXT;                         -- secret for the one-click unsubscribe link
CREATE TABLE IF NOT EXISTS mail_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  audience_label TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sending'                               -- sending | done
);
CREATE TABLE IF NOT EXISTS mail_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',                                -- queued | sent | failed
  error TEXT
);
CREATE INDEX IF NOT EXISTS mail_recipients_queue ON mail_recipients(campaign_id, status);
