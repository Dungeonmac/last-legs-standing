# Last Legs Standing

An annual, worldwide elimination running challenge. Day 1 is 1 km, Day 2 is 2 km, and so on. Run anywhere, upload before 23:59:59 UTC, and the last runner standing wins.

Built for **Cloudflare Pages**: static HTML/CSS/JS in `public/`, an API in Pages Functions (`functions/` → `src/server/`), a **D1** (SQLite) database, and **R2** storage for uploaded run files.

## Run it locally

```powershell
npm install
npm run db:reset      # creates the local database and loads demo data
npm run dev           # http://localhost:8788
npm run dev:phone     # same, but reachable from a phone on your Wi-Fi at http://<your-PC-IP>:8788
```

Open **http://localhost:8788/demo** to log in as a demo runner with one tap and see the welcome animation.

Demo logins (local only):

| Role | Email | Password |
|---|---|---|
| Admin | admin@lastlegsstanding.test | AdminDemo2026! |
| Runner in the live demo race (Day 18) | runner@lastlegsstanding.test | RunDemo2026! |
| Runner who has signed up and paid, race not started | paid@lastlegsstanding.test | PaidDemo2026! |

`npm run sample-gpx` writes test files to `samples/` for today's demo race day: a valid run, a run from yesterday and a car ride. Re-run it each day, and re-run `npm run db:reset` to refresh the demo race. `node scripts/test-parsers.mjs` checks the GPX/FIT parsers and the anti-cheat verdicts.

## Pages

| Page | Purpose |
|---|---|
| `/` | Home, About, the climb, deadline in your time zone, Rules, Prizes, FAQ |
| `/signup.html` | Choose challenge, first-time/returning (required), runner info (gender: Male/Female), parent/guardian details for runners under 18, shipping + billing, payment, then the rules + waiver pop-up with typed signatures (runner, plus parent/guardian for under-18s), then the hype animation |
| `/events.html`, `/event.html?e=…` | Upcoming events (start, fee, prizes, sign up) and previous events (podium, stats, chart, standings) |
| `/live.html` | Live race: day, distance due, deadline countdown (local + UTC), runners left/eliminated, fastest run, leaderboard, runners-left chart. `?state=none` previews the "no race" screen |
| `/account.html` | Runner dashboard. Before the race: bib, countdown to Day 1, order details, get-ready checklist, replay of the welcome animation. During the race: today's progress, countdown, runs and verification results |
| `/how-to-submit.html` | Plain-language, step-by-step guide: built-in tracker, Strava, GPS watch files, how to check a run counted, troubleshooting, Help button |
| `/help.html` | Help desk: contact form, email, temporary phone number, and the deadline-responsibility disclaimer |
| `/demo.html` | Local preview only: one-tap demo logins. Delete before launch |
| `/upload.html` | Upload .gpx / .tcx / .fit (any watch or app) or import from Strava |
| `/track.html` | Built-in GPS tracker (installable to the phone home screen) |
| `/admin.html` | Sign-up stats (first-time vs returning, revenue), review queue for flagged runs, disqualify/reinstate, help desk inbox |

## How the race engine works

- Race day N runs 00:00:00–23:59:59.999 UTC. The distance due is N km, and runs on the same day are added together.
- No cron job is needed. Each API call brings events up to date: it starts a race on its start date, eliminates every runner who fell short on each finished day, and finalizes places once one runner (or none) is left.
- Ranking: last day survived, then total distance, then fastest total moving time.
- Awards (`public/js/divisions.js`, shared by site and server): top 3 overall, men, women, and men/women per age group (age on Day 1), one award per runner. Only award winners get a shirt and medal. Admin → Awards lists winners with shirt sizes and addresses (CSV download).
- Anti-cheat (`src/server/analyze.js`) runs on every upload:
  - **Hard rejects:** wrong day or old run, future timestamps, duplicate file or track, not a run, no GPS.
  - **Scored checks:** vehicle speed, impossible pace, GPS teleports, relocation during a pause, overlapping runs, computer-generated tracks, no sensors.
  - Scores of 30–69 are flagged for an admin. Scores of 70+ are rejected.

## Going live (Cloudflare + GitHub)

1. Push this folder to a GitHub repo. `node_modules`, `.wrangler`, `.dev.vars` and `samples` are git-ignored.
2. Create the resources:
   ```powershell
   npx wrangler login
   npx wrangler d1 create lls-db          # paste the database_id into wrangler.toml
   npx wrangler r2 bucket create lls-uploads
   npx wrangler d1 execute lls-db --remote --file schema.sql
   ```
3. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo. Leave the build command empty and set the output directory to `public`.
4. Delete the demo events and `public/demo.html`. Create real events by inserting rows into `events`; there is no event editor in the admin page yet.
5. Set secrets in Pages → Settings → Variables (or `wrangler pages secret put`):
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`: real card payments. Without them, sign-up runs in test mode.
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`: from https://www.strava.com/settings/api. Set the callback domain to your domain.
   - `RESEND_API_KEY`: from https://resend.com (free). Emails every help desk message to `SUPPORT_EMAIL` (set in `wrangler.toml`). Sign up to Resend with that same email address, or verify your domain with Resend and set `EMAIL_FROM`. Without the key, messages are still saved and shown in Admin.
   - Set `ADMIN_EMAILS` in `wrangler.toml` to your own email.
6. Add your domain under Pages → Custom domains.

## Before launch: checklist

- [ ] Buy the domain (lastlegsstanding.com was unregistered on 2026-10-29).
- [ ] Have a lawyer review `public/js/legal.js` and fill in the `[ORGANIZER LEGAL ENTITY NAME]`, `[GOVERNING STATE]` and `[COUNTY, STATE]` placeholders. Ask specifically about the parent/guardian consent for runners under 18 (there is no minimum age).
- [ ] Replace the temporary help desk phone number in `public/js/common.js` (`SUPPORT`).
- [ ] Create Stripe and Strava developer accounts.
- [ ] Apply for the Garmin Connect Developer Program if you want automatic Garmin sync (file upload already works).
- [ ] Decide on the prizes and set them per event.
