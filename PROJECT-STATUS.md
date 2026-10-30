# Project status: where we left off

_Last updated: 2026-10-29_

## Done
- The full site runs locally (`npm run dev` → http://localhost:8788). Pages: Home/About/Rules, Sign up (with rules + waiver pop-up), Events, Live race, Account, Upload, Tracker and Admin.
- Anti-cheat checks, the race engine, demo data and test files (see README.md).
- The name **Last Legs Standing** is chosen. lastlegsstanding.com was unregistered on 2026-10-29 and **is not bought yet**.

## Decisions to confirm (my defaults, easy to change)
- Treadmill runs don't count (GPS required).
- Each run must start and finish within the same UTC day.
- No GPS tolerance (runners are told to run 2–3% extra).
- The race ends when 1 or 0 runners are left.
- The entry fee is non-refundable.
- Runners must be 18 or older.
- Public names are shown as first name + last initial + country.
- The 2027 start date is a placeholder (March 1, 2027). Prizes are "To be announced".

## Still to do
- [ ] Buy the domain.
- [ ] Lawyer review of the waiver/privacy text in `public/js/legal.js`, and fill in the placeholders.
- [ ] Stripe account + keys (real payments). Strava developer app + keys (one-tap import).
- [ ] Optional: apply to the Garmin Connect Developer Program.
- [ ] Push to GitHub and deploy to Cloudflare Pages (steps in README.md).
- [ ] Missing features: event editor in admin, password reset, email receipts/confirmations.
- [ ] Optional: a native phone app (the web tracker stops when the screen locks on most phones).

## Notes
- `node_modules` sits inside OneDrive and may cause sync churn. You can exclude it, or move the project outside OneDrive.
- The local database lives in `.wrangler/` and is not in git. `npm run db:reset` rebuilds it with demo data.
