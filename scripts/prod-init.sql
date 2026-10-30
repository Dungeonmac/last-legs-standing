-- First-time setup for the LIVE database: the real upcoming event only (no demo runners or demo logins).
-- Run once after schema.sql:  npx wrangler d1 execute lls-db --remote --file scripts/prod-init.sql
INSERT INTO events (slug, name, tagline, description, start_date, status, fee_cents, prizes, registration_open, last_processed_day, is_demo)
VALUES ('lls-2027', 'Last Legs Standing 2027', 'Every day, one more kilometer.',
  'The annual worldwide elimination challenge. Run anywhere on Earth. Day 1 is 1 km, Day 2 is 2 km, and the distance keeps climbing by 1 km a day until only one runner is left.',
  '2027-03-01', 'upcoming', 3000,
  '[{"place":1,"prize":"To be announced"},{"place":2,"prize":"To be announced"},{"place":3,"prize":"To be announced"}]', 1, 0, 0);
