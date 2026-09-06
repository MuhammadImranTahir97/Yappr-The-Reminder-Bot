require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { pool, init } = require('./db');
const scheduler = require('./scheduler');
const { isEnabled: pushEnabled } = require('./webpush');
const { verifyActionToken } = require('./actionTokens');
const { normalizeRecurring, nextOccurrence } = require('./recurrence');
const logger = require('./logger');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  throw new Error('SESSION_SECRET must be set and at least 16 characters long');
}
if (!process.env.APP_PASSWORD) {
  throw new Error('APP_PASSWORD must be set');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Vercel already forces HTTPS; this directive only causes harm locally,
      // where it makes the browser try (and fail) to upgrade http://localhost
      // subresource requests to https.
      upgradeInsecureRequests: null,
    },
  },
}));
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

const COOKIE_NAME = 'yappr_auth';
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hmacFor(issuedAt) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(String(issuedAt))
    .digest('hex');
}

function signAuthToken() {
  const issuedAt = Date.now();
  return `${issuedAt}.${hmacFor(issuedAt)}`;
}

function isValidAuthCookie(value) {
  if (!value) return false;
  const [issuedAtStr, mac] = value.split('.');
  const issuedAt = Number(issuedAtStr);
  if (!issuedAtStr || !mac || !Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > TOKEN_MAX_AGE_MS) return false;

  const expected = hmacFor(issuedAt);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Login endpoint (must stay open, before auth gate)
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW = '15 minutes';

app.post('/api/login', asyncHandler(async (req, res) => {
  const ip = req.ip;
  await pool.query(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'`);
  const { rows: attemptRows } = await pool.query(
    `SELECT COUNT(*) FROM login_attempts WHERE ip = $1 AND attempted_at > now() - interval '${LOGIN_WINDOW}'`,
    [ip]
  );
  if (Number(attemptRows[0].count) >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }

  const { password } = req.body;
  if (password && safeEqual(password, process.env.APP_PASSWORD)) {
    res.cookie(COOKIE_NAME, signAuthToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TOKEN_MAX_AGE_MS,
    });
    return res.json({ ok: true });
  }
  await pool.query(`INSERT INTO login_attempts (ip) VALUES ($1)`, [ip]);
  return res.status(401).json({ error: 'wrong password' });
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.get('/api/health', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM tasks WHERE done = false AND due_at <= now()`
  );
  res.json({ ok: true, tasksDue: Number(rows[0].count) });
}));

app.get('/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.js'));
});

// PWA assets: none of these carry anything sensitive (app name, icons,
// theme color, a no-op service worker), and <link rel="manifest"> fetches
// don't send cookies by default (they're same-origin but credential-less
// unless crossorigin="use-credentials" is set) - so gating these behind
// requireAuth just makes the manifest 302 to /login.html and fail to parse
// as JSON. Simpler to serve them openly.
app.get('/manifest.webmanifest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});

app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/icon-192.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'icon-192.png'));
});

app.get('/icon-512.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'icon-512.png'));
});

// Token-gated GET routes so ntfy's Actions buttons (which only fire plain
// HTTP requests, no cookies) can mark a task done or snooze it directly
// from the notification, without needing to open and log into the app.
// Deliberately registered before requireAuth - the token itself is the
// authorization, scoped to exactly one task and one action.
app.get('/api/tasks/:id/done', requireIntId, asyncHandler(async (req, res) => {
  if (!verifyActionToken(req.query.t, req.params.id, 'done')) {
    return res.status(403).json({ error: 'invalid or missing token' });
  }
  const updated = await markTaskDone(req.params.id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
}));

app.get('/api/tasks/:id/snooze', requireIntId, asyncHandler(async (req, res) => {
  if (!verifyActionToken(req.query.t, req.params.id, 'snooze')) {
    return res.status(403).json({ error: 'invalid or missing token' });
  }
  const updated = await snoozeTask(req.params.id, 15);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
}));

function requireAuth(req, res, next) {
  if (isValidAuthCookie(req.cookies[COOKIE_NAME])) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

function requireIntId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  next();
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!pushEnabled()) return res.status(404).json({ error: 'web push not configured' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'invalid subscription' });
  }
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [endpoint, keys.p256dh, keys.auth]
  );
  res.json({ ok: true });
}));

app.post('/api/push/unsubscribe', asyncHandler(async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  res.json({ ok: true });
}));

app.get('/api/tasks', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM tasks ORDER BY done ASC, due_at ASC`);
  res.json(rows);
}));

app.get('/api/tasks/due', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE done = false AND due_at <= now() ORDER BY due_at ASC`
  );
  res.json(rows);
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const { title, notes, dueAt, recurring, nagMinutes } = req.body;

  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
    return res.status(400).json({ error: 'title must be 1-200 characters' });
  }
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'notes must be a string up to 2000 characters' });
  }
  const parsedDueAt = new Date(dueAt);
  if (!dueAt || Number.isNaN(parsedDueAt.getTime())) {
    return res.status(400).json({ error: 'dueAt must be a valid date' });
  }
  let nagMins = 15;
  if (nagMinutes !== undefined && nagMinutes !== null) {
    nagMins = Number(nagMinutes);
    if (!Number.isInteger(nagMins) || nagMins < 1 || nagMins > 1440) {
      return res.status(400).json({ error: 'nagMinutes must be an integer between 1 and 1440' });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, due_at, recurring, nag_minutes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      title.trim(),
      notes || '',
      parsedDueAt.toISOString(),
      normalizeRecurring(recurring),
      nagMins,
    ]
  );
  res.json(rows[0]);
}));

app.patch('/api/tasks/:id', requireIntId, asyncHandler(async (req, res) => {
  const { rows: existingRows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { title, notes, dueAt, recurring, nagMinutes } = req.body;

  let title2 = existing.title;
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
      return res.status(400).json({ error: 'title must be 1-200 characters' });
    }
    title2 = title.trim();
  }

  let notes2 = existing.notes;
  if (notes !== undefined) {
    if (notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
      return res.status(400).json({ error: 'notes must be a string up to 2000 characters' });
    }
    notes2 = notes || '';
  }

  let dueAt2 = existing.due_at;
  if (dueAt !== undefined) {
    const parsed = new Date(dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'dueAt must be a valid date' });
    }
    dueAt2 = parsed.toISOString();
  }

  let recurring2 = existing.recurring;
  if (recurring !== undefined) {
    recurring2 = normalizeRecurring(recurring);
  }

  let nagMins2 = existing.nag_minutes;
  if (nagMinutes !== undefined && nagMinutes !== null) {
    const n = Number(nagMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      return res.status(400).json({ error: 'nagMinutes must be an integer between 1 and 1440' });
    }
    nagMins2 = n;
  }

  const { rows } = await pool.query(
    `UPDATE tasks SET title = $2, notes = $3, due_at = $4, recurring = $5, nag_minutes = $6
     WHERE id = $1 RETURNING *`,
    [req.params.id, title2, notes2, dueAt2, recurring2, nagMins2]
  );
  res.json(rows[0]);
}));

async function markTaskDone(id) {
  const { rows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  const task = rows[0];
  if (!task) return null;

  if (task.recurring && task.recurring !== 'none') {
    const nextDueAt = nextOccurrence(new Date(task.due_at), task.recurring, new Date());
    const { rows: updated } = await pool.query(
      `UPDATE tasks SET due_at = $2, done = false, last_nagged_at = NULL
       WHERE id = $1 RETURNING *`,
      [id, nextDueAt.toISOString()]
    );
    return updated[0];
  }
  const { rows: updated } = await pool.query(
    `UPDATE tasks SET done = true WHERE id = $1 RETURNING *`,
    [id]
  );
  return updated[0];
}

async function snoozeTask(id, minutes) {
  const { rows } = await pool.query(
    `UPDATE tasks SET due_at = now() + ($2 || ' minutes')::interval, last_nagged_at = NULL
     WHERE id = $1 RETURNING *`,
    [id, minutes]
  );
  return rows[0] || null;
}

app.patch('/api/tasks/:id/done', requireIntId, asyncHandler(async (req, res) => {
  const updated = await markTaskDone(req.params.id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
}));

app.patch('/api/tasks/:id/snooze', requireIntId, asyncHandler(async (req, res) => {
  const minutes = Number(req.body && req.body.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return res.status(400).json({ error: 'minutes must be an integer between 1 and 1440' });
  }
  const updated = await snoozeTask(req.params.id, minutes);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
}));

app.patch('/api/tasks/:id/undone', requireIntId, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE tasks SET done = false, last_nagged_at = NULL WHERE id = $1 RETURNING *`,
    [id]
  );
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', requireIntId, asyncHandler(async (req, res) => {
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, next) => {
  logger.error('unhandled request error', { path: req.path, taskId: req.params.id, error: err.message });
  const status = Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'internal error' : err.message });
});

const PORT = process.env.PORT || 3000;

// Only runs when started directly (local dev, or self-hosting) — on Vercel
// this module is required as a serverless handler, so this block is skipped
// and the in-process scheduler (replaced there by a GitHub Actions cron
// calling scripts/tick.js) never starts.
if (require.main === module) {
  init()
    .then(() => {
      // Off by default: if GitHub Actions is also ticking against the same
      // database, running this too means two naggers double-nagging you.
      // Opt in only when running fully standalone with no other tick source.
      if (process.env.ENABLE_LOCAL_SCHEDULER === 'true') {
        scheduler.start();
      }
      app.listen(PORT, () => logger.info(`Yappr running on port ${PORT}`));
    })
    .catch((err) => {
      logger.error('Failed to init DB', { error: err.message });
      process.exit(1);
    });
}

module.exports = app;
