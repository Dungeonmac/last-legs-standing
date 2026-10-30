# Project status: where we left off

**Live:** https://lastlegsstanding.com (also https://last-legs-standing.pages.dev) · **Code:** https://github.com/Dungeonmac/last-legs-standing (public)
Cloudflare account: david@grozea.net. Publish updates with `npm run deploy` (pushing to GitHub alone does not redeploy).

_Last updated: 2026-10-30_

## Done
- The full site runs locally (`npm run dev` → http://localhost:8788). Pages: Home/About/Rules, Sign up (with rules + waiver pop-up), Events, Live race, Account, Upload, Tracker, How to submit a run, Help desk, Admin, and the admin-only Demo mode page (`/demo`).
- Anti-cheat checks, the race engine, demo data and test files (see README.md).
- 2026-10-30 changes:
  - Under-18s can enter (no minimum age) with a parent's or guardian's details and typed signature. The waiver now has a parent/guardian section.
  - Gender is required: Male or Female only.
  - The climb on the home page has no cap and says there's no predetermined finish day. The copy is more hype.
  - Help desk page with a contact form, email, a temporary phone number and the "contact us too late and it's on you" disclaimer. Messages are saved, shown in Admin, and emailed to jeffeersonjeff546@gmail.com once `RESEND_API_KEY` is set.
  - Step-by-step "How to submit a run" guide (tracker, Strava, any app or watch), with a Help button.
  - A hype animation after sign-up, replayable from My race.
  - Mobile: bottom tab bar for logged-in runners, full-screen waiver on phones, bigger tap targets, no zoom-on-tap.
  - Pre-race dashboard for paid runners: bib, countdown, order, shipping city, checklist.
  - Awards like a road race (public/js/divisions.js): top 3 overall, men, women, and men + women per age group (age on Day 1). One award per runner. Only award winners get a shirt and medal. Waiver version 2026-10-30.2.
  - Five golden rules on the home page, full rules in a dropdown.
  - Tracker shows whether it is keeping the screen awake and warns if GPS paused.
- 2026-10-30 (evening):
  - Domain lastlegsstanding.com (bought at Cloudflare) connected, with www. SSL: Universal certificate active (auto-renews), Full (strict), Always Use HTTPS, TLS 1.2 minimum, TLS 1.3, HTTPS rewrites, DNSSEC enabled.
  - Site security: HSTS, Content-Security-Policy, no framing, nosniff, referrer and permissions policies (public/_headers); map library integrity hashes; login limits (8 wrong passwords per account / 10 per IP per 15 min).
  - Admin rights are stored on the account (`npm run make-admin -- email`), never granted by email address alone.
  - Demo data is admin-only: the Demo mode switch (header + /demo) shows the demo races, "View as" the demo runners, and a sign-up preview. The public sees only real events. Sign-up says "Registration opens soon" until Stripe is connected.
  - Create an account without entering a race (Log in > Create an account).
  - Fixed running out of the free database's daily reads (5M rows/day): running totals per registration, indexes, 60 s edge cache for public race data. Live migration: scripts/migrations/2026-10-30-totals.sql.
  - New home page top section: headline + one main button + next-race card with countdown.

## Decisions confirmed (2026-10-30)
- Treadmill runs don't count (GPS required).
- Each run must start and finish within the same UTC day.
- No GPS tolerance (runners are told to run 2–3% extra).
- The race ends when 1 or 0 runners are left.
- The entry fee is non-refundable.
- Runners under 18 can take part with a parent's or guardian's consent and typed signature. There is no minimum age.
- Public names are shown as first name + last initial + country, plus division (e.g. "Women 30–39").
- Shirts and medals go only to award winners.
- Demo features are visible to admins only (Demo mode).
- The start date is TBD. March 1, 2027 is kept as a placeholder. Prizes are "To be announced".

## Still to do
- [ ] Create an account on the live site (Log in > Create an account) with jeffeersonjeff546@gmail.com, then have Claude run `npm run make-admin -- jeffeersonjeff546@gmail.com`.
- [ ] Add the two anti-spoofing email records in Cloudflare DNS: TXT `@` = `v=spf1 -all`, and TXT `_dmarc` = `v=DMARC1; p=reject;`. Change them if the domain ever sends email.
- [ ] Stripe account + keys (real payments; sign-up opens to the public once this is set). Strava developer app + keys (one-tap import).
- [ ] Lawyer review of the waiver/privacy text in `public/js/legal.js` (including the under-18 consent and having no minimum age), and fill in the placeholders.
- [ ] Replace the temporary help desk phone number (`SUPPORT` in `public/js/common.js`).
- [ ] Resend account (free) so help desk messages are emailed. Sign up with jeffeersonjeff546@gmail.com.
- [ ] Enable R2 in the Cloudflare dashboard (keeps original run files), then uncomment the R2 lines in wrangler.toml and redeploy.
- [ ] Optional: Workers Paid plan ($5/month) if traffic outgrows the free database limits.
- [ ] Optional: www → lastlegsstanding.com redirect rule in Cloudflare (both work today).
- [ ] Optional: auto-deploy on every GitHub push (GitHub Action with a Cloudflare API token).
- [ ] Optional: apply to the Garmin Connect Developer Program.
- [ ] Confirm the award setup: 10-year age groups and "one award per runner" are my defaults (both are one-line changes in public/js/divisions.js).
- [ ] Missing features: event editor in admin, password reset, email receipts/confirmations.
- [ ] Optional: a native phone app (the web tracker stops when the screen locks on most phones).

## Notes
- `node_modules` sits inside OneDrive and may cause sync churn. You can exclude it, or move the project outside OneDrive.
- The local database lives in `.wrangler/` and is not in git. `npm run db:reset` rebuilds it with demo data.
- Never run `npm run db:prod-seed` on a live site with real runners: it wipes the live database.
