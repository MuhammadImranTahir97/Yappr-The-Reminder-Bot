# Yappr

A personal reminders/tasks app: add tasks with a due time, and it keeps
yapping at you (on your iPhone via [ntfy.sh](https://ntfy.sh) and on Windows
via browser notifications) until you mark them done. Everything used here is
free.

## 1. Get your iPhone ready (ntfy)

1. Install the **ntfy** app from the App Store (free, no account needed).
2. In the app, subscribe to a topic name only you know, e.g. `imran-nag-8342`
   (topic names are public on ntfy.sh, so pick something hard to guess —
   don't use a real word or your name).
3. That's it — anything posted to that topic pops up as a phone notification.

## 2. Create a free database (Supabase)

1. Go to https://supabase.com, sign up free, create a new project.
2. Once it's ready: Project Settings → Database → **Connection string** → URI.
   Copy it (looks like `postgres://postgres:[password]@...supabase.co:5432/postgres`).
3. You'll paste this into `DATABASE_URL` below. The app creates its own table
   automatically on first run — no manual SQL needed.

## 3. Configure the app

1. Copy `.env.example` to `.env`.
2. Fill in:
   - `DATABASE_URL` — from step 2
   - `APP_PASSWORD` — any password you want to log in with
   - `SESSION_SECRET` — any long random string
   - `NTFY_TOPIC` — the topic name from step 1

## 4. Run it locally to try it out

```
npm install
npm start
```

Open http://localhost:3000, log in with your `APP_PASSWORD`, add a reminder
due a minute from now, and check your phone.

## 5. Deploy for free so it runs 24/7

This app is split across two free services, neither of which requires a
credit card:

- **Vercel** hosts the web page (login, add/view/complete tasks).
- **GitHub Actions** runs the nag-checker on a schedule, independent of
  whether the web page is open or the Vercel function is "awake."

### 5a. Deploy the web app to Vercel

1. Push this project to a GitHub repo (if you haven't already).
2. Go to [vercel.com](https://vercel.com), sign up (GitHub login is easiest),
   and click **Add New → Project**, then import this repo.
3. Vercel will detect `vercel.json` and deploy it as-is — no build/start
   command changes needed. `vercel.json` intentionally still uses the legacy
   `builds`/`routes` form (with its "unused Build and Development Settings"
   build warning) rather than the modern `functions`/`rewrites` form -
   tested that migration on a preview branch and it broke `POST /api/login`
   in production (requests fell through to the login-page redirect instead
   of reaching the route), so it was reverted. The legacy form works
   correctly; the warning is cosmetic.
4. In the project's **Settings → Environment Variables**, add:
   - `DATABASE_URL` — same as local, but change the port from `5432` to
     `6543` (Supabase's Transaction pooler). Vercel runs many short-lived
     serverless invocations, and the `5432` Session pooler can run out of
     connections under that load; `6543` is built for exactly this.
   - `APP_PASSWORD`, `SESSION_SECRET`, `NTFY_TOPIC` — same values as your
     local `.env`.
5. Deploy. Vercel gives you a permanent URL like `https://yappr-xxxx.vercel.app`
   — open that on your iPhone and laptop.

### 5b. Set up the GitHub Actions nag-checker

1. In your GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**.
2. Add two secrets: `DATABASE_URL` and `NTFY_TOPIC` (same values as above).
3. That's it — `.github/workflows/tick.yml` is already in the repo and runs
   automatically every 5 minutes, checking for due tasks and pushing to ntfy.
4. To test it immediately rather than waiting: go to the repo's **Actions**
   tab → "Nag tick" workflow → **Run workflow**.

Note: GitHub disables a scheduled workflow after 60 days with no repository
activity at all — an occasional commit (or just using the app, which doesn't
touch the repo) won't trigger this; if reminders ever silently stop, check
the Actions tab and re-enable the workflow there if needed.

**GitHub's cron is best-effort, not exact.** The workflow is configured to
run every 5 minutes, but GitHub explicitly reserves the right to delay or
skip scheduled runs under load, especially on free-tier repos — in practice
this project has seen gaps of 2+ hours between runs instead of 5 minutes.
Reminders may arrive later than the `nagMinutes` setting implies. There's no
free way to force GitHub to run more punctually; if reliable sub-5-minute
delivery ever matters, the fix is an external scheduler (e.g. a free cron
service) hitting a tick endpoint instead of relying on GitHub Actions'
`schedule` trigger.

## How it works

- Add a task with a due time, optional daily repeat, and how often (in
  minutes) it should re-nag you.
- Every 5 minutes, a GitHub Actions workflow (`scripts/tick.js`) checks for
  anything due and not done, and sends a push to your ntfy topic if enough
  time has passed since the last nag.
- The web page (when open) does its own check every 20s and fires a native
  browser notification in sync with the same due tasks.
- Marking a one-off task done just marks it done. Marking a daily task done
  rolls its due time forward by 24 hours and resets the nag timer.
- Logins use a signed cookie (no server-side session storage), which is what
  makes the web app safe to run on Vercel's serverless functions.
