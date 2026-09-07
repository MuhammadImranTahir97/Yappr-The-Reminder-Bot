# Yappr — Project Overview

This document explains what Yappr is, what it actually does, how the pieces
fit together, and why each technology was chosen. It's meant as a reference
for understanding the project as a whole, separate from `README.md` (which
is just setup instructions).

---

## What Yappr is

A personal reminders app. You add a task with a due time; if you don't mark
it done, it keeps "yapping" at you — pushing a notification to your phone
and browser on a repeating interval — until you either complete it or
snooze it. It's built to run permanently for free, with no credit card
required anywhere in the stack.

---

## Core functionality

**Tasks**
- Add a task: title, optional notes, a due date/time, an optional repeat
  (daily, weekly, weekdays-only, or every N days), and how often (in
  minutes) it should re-nag you once due.
- Mark done, edit any field, snooze by 10/30/60 minutes, or delete.
- Completing a *recurring* task doesn't just mark it done — it calculates
  the next real occurrence in the future (so a daily task you missed for 3
  days rolls to tomorrow, not to a date that's still in the past; a
  "weekdays" task skips straight over any weekend in between).
- Completed one-off tasks older than 30 days are deleted automatically.

**Notifications**
- **ntfy.sh push** — the primary channel. Works on any phone with the free
  ntfy app installed, no account needed.
- **Native Web Push** (optional) — browser/OS-level push notifications,
  the kind that work even with no tab open. Requires the app to be
  installed as a PWA (see below) on iOS specifically.
- **In-browser notifications** — while a tab is open, the page polls for
  due tasks and fires a native browser notification too.
- The ntfy notification itself has **Done** and **Snooze 15m** buttons you
  can tap directly from the notification, no need to open the app.

**The web app**
- A single-password-gated page (no user accounts — this is a personal,
  single-user app).
- Installable to a phone's home screen as a real-feeling app (PWA): its
  own icon, opens full-screen, no browser address bar.
- Active tasks are grouped into Today / Tomorrow / Later.

**Reliability features**
- A health check endpoint to confirm the app and its database are alive.
- Login rate limiting (10 attempts per 15 minutes per IP).
- Optional "quiet hours" — skip nagging overnight (or any window) without
  disturbing a task's own schedule.
- An optional external cron trigger for punctual (rather than best-effort)
  reminder delivery.

---

## How it all fits together

Yappr is split across **four independent free services**, each doing one
job. None of them requires a credit card, and none of them talk to each
other directly except through the shared database.

```
┌─────────────┐      reads/writes      ┌──────────────┐
│   Browser    │ ───────────────────►  │    Vercel     │
│ (the web app)│ ◄───────────────────  │ (Node/Express)│
└─────────────┘        JSON API        └───────┬───────┘
                                                │
                                                │ reads/writes
                                                ▼
┌───────────────┐                      ┌──────────────┐
│ GitHub Actions │ ──── every 5 min ──► │   Supabase    │
│ (cron worker)  │      (best-effort)   │  (Postgres)   │
└───────┬────────┘                      └──────────────┘
        │                                       ▲
        │ sends push                            │
        ▼                                       │ reads/writes
┌───────────────┐                                │
│   ntfy.sh /    │                       ┌───────┴────────┐
│   Web Push     │                       │ cron-job.org    │
│ (notification  │                       │ (optional, hits │
│  delivery)     │                       │ Vercel directly)│
└───────────────┘                       └────────────────┘
```

1. **Vercel** hosts the web app itself (an Express server running as a
   serverless function). This is what you actually see and interact with
   when you open the app in a browser — login, add/edit/complete tasks.
2. **Supabase** is the database — the single source of truth for every
   task, login attempt record, and push subscription. Every other piece
   reads from and writes to it, but nothing else runs *inside* it.
3. **GitHub Actions** runs a scheduled script every 5 minutes (in
   practice, more like every 1.5–3.5 hours — GitHub's scheduler is
   best-effort, not exact) that checks the database for anything due and
   triggers a notification.
4. **ntfy.sh** is a free, no-account push notification relay — Yappr POSTs
   a message to it, and the ntfy phone app (subscribed to your private
   topic) receives it as a push notification.
5. **cron-job.org** (optional, not currently in use for this deployment)
   would hit a Vercel endpoint directly every 5 minutes for punctual
   delivery, bypassing GitHub's unreliable timing entirely.

**Why split across four services instead of one host?** Every all-in-one
option that was evaluated (Render, Fly.io, Railway, Koyeb, Zeabur,
Back4App) either requires a credit card for a permanent free tier, has
discontinued free tiers for new signups, or only offers temporary/60-minute
public URLs. This four-service split is the only combination found that's
*permanently* free with no card, anywhere.

---

## Why each technology was chosen

**Vercel (hosting)** — Free, permanent, no card, deploys straight from a
GitHub push, and its serverless Node.js runtime is a natural fit for
Express. The tradeoff is that serverless functions are stateless between
invocations (no persistent memory, no long-running background timers),
which shaped several other decisions below.

**Supabase (Postgres database)** — Free tier Postgres with no card. Two
connection modes matter here: the **Session pooler** (port 5432) behaves
like a normal long-lived connection and is fine for local dev and
short-lived scripts; the **Transaction pooler** (port 6543) is required on
Vercel specifically, because serverless means *many* short-lived function
invocations opening connections independently — the direct/session
connection limit gets exhausted quickly under that pattern, while the
transaction pooler is built to multiplex exactly that kind of load.

**GitHub Actions (the scheduler)** — Because Vercel functions are
stateless and only run in response to an incoming request, there's no way
to run a persistent "check every 5 minutes" timer *inside* Vercel itself.
GitHub Actions' free scheduled workflows fill that gap: a small Node
script runs on a timer, completely independent of whether anyone has the
web page open or the Vercel function is "warm." The real-world tradeoff
(GitHub's scheduler being best-effort, not exact) is a known limitation of
free-tier scheduled workflows, not something specific to this app.

**ntfy.sh (notifications)** — No account, no app-specific setup beyond
subscribing to a topic name, and it just works as a simple HTTP POST from
the server. Chosen as the primary/fallback channel specifically *because*
it needs no browser permission dialog and no complex subscription
handshake — it's the one channel guaranteed to work regardless of what a
browser or OS decides to allow.

**Web Push + VAPID keys (optional, additive)** — Native OS-level push (the
kind that works with no tab open, integrated with the phone's own
notification system) requires a public/private key pair (VAPID) that
identifies this specific app to each browser's push service, plus each
device explicitly subscribing via the browser's Push API. This is *why*
the app also needed a PWA manifest and service worker — on iOS
specifically, Web Push only works for a site added to the Home Screen,
which requires exactly those two things to be present.

**Signed cookies instead of server-side sessions** — Serverless functions
don't share memory between invocations, so a traditional session store
(an in-memory map of session ID → user) simply wouldn't work — each
invocation would have its own empty memory. Instead, the "session" is
entirely self-contained in the cookie itself: a timestamp plus an HMAC
signature of that timestamp, verified fresh on every request using a
secret key. No server-side storage needed at all, which is what makes this
safe to run on Vercel's serverless model in the first place.

**HMAC-signed action tokens (for the notification buttons)** — The Done/
Snooze buttons on an ntfy notification fire a plain HTTP request with no
cookie attached (there's no browser session to speak of — it's coming from
the ntfy app, not a logged-in browser tab). Instead of leaving those
routes open, each button's URL carries a token — a signature over exactly
"this task ID + this action," using the same secret as the login cookies —
so the button can only ever mark done or snooze the one task it was
generated for, nothing else.

**node:test (built-in test runner)** — No new dependency needed; Node
ships a real test runner out of the box, sufficient for testing the pure
logic (recurring-date math, token signing/verification) without needing
Jest, Mocha, or similar.

**helmet (security headers)** — A well-established, minimal-config library
for the standard set of HTTP security headers (CSP, X-Frame-Options,
etc.) that would otherwise need to be set by hand, one by one.

---

## What's deliberately *not* done

- **No user accounts** — a single shared `APP_PASSWORD` is the entire
  auth model. This is a personal, single-user app; multi-user accounts
  would add real complexity for no benefit here.
- **No TLS certificate pinning on the database connection** — accepted as
  a deliberate, documented tradeoff (see the comment in `db.js`) rather
  than a real security gap for this specific project's threat model.
- **The legacy `vercel.json` config form** — the modern
  `functions`/`rewrites` config was tried and it broke production login;
  reverted and kept on the older `builds`/`routes` form on purpose (a
  cosmetic build warning, not a functional issue).
- **The external cron-job.org trigger** — built and available
  (`/api/cron-tick`), but not currently wired up. GitHub Actions' own
  best-effort schedule is enough for how this app is actually used; the
  external trigger is there if punctual delivery ever becomes worth the
  extra signup.
