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

Using [Render](https://render.com) (free web service tier):

1. Push this project to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add the same environment variables from your `.env` file in Render's
   dashboard (Environment tab).
5. Deploy. Render gives you a URL like `https://nag-xxxx.onrender.com` —
   open that on your iPhone and laptop.

Note: Render's free tier sleeps after 15 minutes of no web traffic and wakes
up on the next request (a few seconds delay) — the reminder scheduler only
runs while the app is awake, so an occasional visit (or a free uptime pinger
like UptimeRobot hitting the URL every 10 min) keeps it always-on.

## How it works

- Add a task with a due time, optional daily repeat, and how often (in
  minutes) it should re-nag you.
- Once a minute, the server checks for anything due and not done, and sends
  a push to your ntfy topic if enough time has passed since the last nag.
- The web page (when open) does the same check every 20s and fires a native
  Windows notification in sync with the same schedule.
- Marking a one-off task done just marks it done. Marking a daily task done
  rolls its due time forward by 24 hours and resets the nag timer.
