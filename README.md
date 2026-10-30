# Last Legs Standing

An annual, worldwide elimination running challenge. Day 1 is 1 km, Day 2 is 2 km, and so on. Run anywhere, upload before 23:59:59 UTC, and the last runner standing wins.

Built for **Cloudflare Pages**: static HTML/CSS/JS in `public/`, an API in Pages Functions (`functions/` → `src/server/`), a **D1** (SQLite) database, and **R2** storage for uploaded run files.

## Run it locally

```powershell
npm install
npm run db:reset      # creates the local database and loads demo data
npm run dev           # http://localhost:8788
```

Demo logins (local only):

| Role | Email | Password |
|---|---|---|
| Admin | admin@lastlegsstanding.test | AdminDemo2026! |
| Runner in the live demo race | runner@lastlegsstanding.test | RunDemo2026! |

`npm run sample-gpx` writes test files to `samples/` for today's demo race day: a valid run, a run from yesterday and a car ride. Re-run it each day, and re-run `npm run db:reset` to refresh the demo race. `node scripts/test-parsers.mjs` checks the GPX/FIT parsers and the anti-cheat verdicts.

## Pages

| Page | Purpose |
|---|---|
| `/` | Home, About, the climb, deadline in your time zone, Rules, Prizes, FAQ |
| `/signup.html` | Choose challenge, first-time/returning (required), runner info, shipping + billing, payment, then the rules + waiver pop-up with a typed signature |
| `/events.html`, `/event.html?e=…` | Upcoming events (start, fee, prizes, sign up) and previous events (podium, stats, chart, standings) |
| `/live.html` | Live race: day, distance due, deadline countdown (local + UTC), runners left/eliminated, fastest run, leaderboard, runners-left chart. `?state=none` previews the "no race" screen |
| `/account.html` | Runner dashboard: today's progress, countdown, runs and verification results |
| `/upload.html` | Upload .gpx / .tcx / .fit (any watch or app) or import from Strava |
| `/track.html` | Built-in GPS tracker (installable to the phone home screen) |
| `/admin.html` | Sign-up stats (first-time vs returning, revenue), review queue for flagged runs, disqualify/reinstate |

## How the race engine works

- Race day N runs 00:00:00–23:59:59.999 UTC. The distance due is N km, and runs on the same day are added together.
- No cron job is needed. Each API call brings events up to date: it starts a race on its start date, eliminates every runner who fell short on each finished day, and finalizes places once one runner (or none) is left.
- Ranking: last day survived, then total distance, then fastest total moving time.
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
4. Delete the demo events. Create real events by inserting rows into `events`; there is no event editor in the admin page yet.
5. Set secrets in Pages → Settings → Variables (or `wrangler pages secret put`):
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`: real card payments. Without them, sign-up runs in test mode.
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`: from https://www.strava.com/settings/api. Set the callback domain to your domain.
   - Set `ADMIN_EMAILS` in `wrangler.toml` to your own email.
6. Add your domain under Pages → Custom domains.

## Before launch: checklist

- [ ] Buy the domain (lastlegsstanding.com was unregistered on 2026-10-29).
- [ ] Have a lawyer review `public/js/legal.js` and fill in the `[ORGANIZER LEGAL ENTITY NAME]`, `[GOVERNING STATE]`, `[COUNTY, STATE]` and `[CONTACT EMAIL]` placeholders.
- [ ] Create Stripe and Strava developer accounts.
- [ ] Apply for the Garmin Connect Developer Program if you want automatic Garmin sync (file upload already works).
- [ ] Decide on the prizes and set them per event.
