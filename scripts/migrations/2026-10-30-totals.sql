-- Live database migration (2026-10-30). Adds only; deletes nothing.
-- Run once:  npx wrangler d1 execute lls-db --remote --file scripts/migrations/2026-10-30-totals.sql
-- 1. Running totals per registration, so rankings don't add up every run on every page view.
ALTER TABLE registrations ADD COLUMN total_m REAL NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN total_s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0;
-- 2. Indexes for the queries that read one runner's runs, and one event's runners.
CREATE INDEX IF NOT EXISTS runs_reg_day ON runs(registration_id, race_day);
CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id, status);
-- 3. Fill in the totals from the runs already recorded.
UPDATE registrations SET
  total_m = (SELECT COALESCE(SUM(distance_m), 0) FROM runs WHERE registration_id = registrations.id AND status != 'rejected'),
  total_s = (SELECT COALESCE(SUM(moving_s), 0) FROM runs WHERE registration_id = registrations.id AND status != 'rejected'),
  run_count = (SELECT COUNT(*) FROM runs WHERE registration_id = registrations.id AND status != 'rejected');
-- 4. Demo runner accounts can't be logged into on the live site (admins use Demo mode > View as).
UPDATE users SET password_hash = '!', password_salt = '!' WHERE email IN ('runner@lastlegsstanding.test', 'paid@lastlegsstanding.test');
