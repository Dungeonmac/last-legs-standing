# Project status: where we left off

**Live:** https://last-legs-standing.pages.dev · **Code:** https://github.com/Dungeonmac/last-legs-standing (public)
Cloudflare account: david@grozea.net. Publish updates with `npm run deploy` (pushing to GitHub alone does not redeploy).

_Last updated: 2026-10-30_

## Done
- The full site runs locally (`npm run dev` → http://localhost:8788). Pages: Home/About/Rules, Sign up (with rules + waiver pop-up), Events, Live race, Account, Upload, Tracker, How to submit a run, Help desk, Admin, and a local-only Demo page (`/demo`).
- Anti-cheat checks, the race engine, demo data and test files (see README.md).
- The name **Last Legs Standing** is chosen. lastlegsstanding.com was unregistered on 2026-10-29 and **is not bought yet**.
- 2026-10-30 changes:
  - Under-18s can enter (no minimum age) with a parent's or guardian's details and typed signature. The waiver now has a parent/guardian section. Waiver version is 2026-10-30.
  - Gender is required: Male or Female only.
  - The climb on the home page has no cap and says there's no predetermined finish day. The copy is more hype.
  - Help desk page with a contact form, email, a temporary phone number and the "contact us too late and it's on you" disclaimer. Messages are saved, shown in Admin, and emailed to jeffeersonjeff546@gmail.com once `RESEND_API_KEY` is set.
  - Step-by-step "How to submit a run" guide (tracker, Strava, watch), with a Help button.
  - A hype animation after sign-up, replayable from My race.
  - Mobile: bottom tab bar for logged-in runners, full-screen waiver on phones, bigger tap targets, no zoom-on-tap. The file picker accepts any file and explains .zip/wrong files.
  - Pre-race dashboard for paid runners: bib, countdown, order, shipping city, checklist.

- 2026-10-30 (later):
  - Awards like a road race (public/js/divisions.js): top 3 overall, top 3 men, top 3 women, top 3 men + women per age group (14 & under, 15–19, 20–29 … 60–69, 70+; age on Day 1). One award per runner (no double dipping). Shown on event results, the live page ("if it ended now") and Admin (with a shipping list + CSV).
  - Only award winners get a shirt and medal. Corrected on every page, in the rules and in the privacy text. Waiver version 2026-10-30.2.
  - Tracker shows whether it is keeping the screen awake and warns if GPS paused. The guide now covers any app (and apps without export) instead of telling runners to change phone settings.

## Decisions confirmed (2026-10-30)
- Treadmill runs don't count (GPS required).
- Each run must start and finish within the same UTC day.
- No GPS tolerance (runners are told to run 2–3% extra).
- The race ends when 1 or 0 runners are left.
- The entry fee is non-refundable.
- Runners under 18 can take part with a parent's or guardian's consent and typed signature. There is no minimum age.
- Public names are shown as first name + last initial + country, plus division (e.g. "Women 30–39").
- Shirts and medals go only to award winners.
- The start date is TBD. March 1, 2027 is kept as a placeholder. Prizes are "To be announced".

## Still to do
- [ ] Buy the domain.
- [ ] Lawyer review of the waiver/privacy text in `public/js/legal.js` (including the under-18 consent and having no minimum age), and fill in the placeholders.
- [ ] Replace the temporary help desk phone number (`SUPPORT` in `public/js/common.js`).
- [ ] Resend account (free) so help desk messages are emailed. Sign up with jeffeersonjeff546@gmail.com.
- [ ] Stripe account + keys (real payments). Strava developer app + keys (one-tap import).
- [ ] Optional: apply to the Garmin Connect Developer Program.
- [x] Pushed to GitHub (public) and deployed to Cloudflare Pages on 2026-10-30, with demo data and test-mode sign-up (by request). The live demo data has no admin account.
- [ ] Before the real launch: remove the demo events/runners and `public/demo.html`, and switch on real payments.
- [ ] Enable R2 in the Cloudflare dashboard (keeps original run files), then uncomment the R2 lines in wrangler.toml and redeploy.
- [ ] Sign up on the live site with jeffeersonjeff546@gmail.com to get Admin access.
- [ ] Optional: auto-deploy on every GitHub push (GitHub Action with a Cloudflare API token).
- [ ] Confirm the award setup: 10-year age groups and "one award per runner" are my defaults (both are one-line changes in public/js/divisions.js).
- [ ] Missing features: event editor in admin, password reset, email receipts/confirmations.
- [ ] Optional: a native phone app (the web tracker stops when the screen locks on most phones).

## Notes
- `node_modules` sits inside OneDrive and may cause sync churn. You can exclude it, or move the project outside OneDrive.
- The local database lives in `.wrangler/` and is not in git. `npm run db:reset` rebuilds it with demo data. Run it after pulling these changes, because the schema changed.
