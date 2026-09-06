require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { pool, init } = require('./db');
const scheduler = require('./scheduler');

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

app.get('/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.js'));
});

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
      recurring === 'daily' ? 'daily' : 'none',
      nagMins,
    ]
  );
  res.json(rows[0]);
}));

app.patch('/api/tasks/:id/done', requireIntId, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  const task = rows[0];
  if (!task) return res.status(404).json({ error: 'not found' });

  if (task.recurring === 'daily') {
    const { rows: updated } = await pool.query(
      `UPDATE tasks
       SET due_at = due_at + (
             GREATEST(FLOOR(EXTRACT(EPOCH FROM (now() - due_at)) / 86400), 0) + 1
           ) * interval '1 day',
           done = false,
           last_nagged_at = NULL
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return res.json(updated[0]);
  }
  const { rows: updated } = await pool.query(
    `UPDATE tasks SET done = true WHERE id = $1 RETURNING *`,
    [id]
  );
  res.json(updated[0]);
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
  console.error('unhandled error:', err);
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
      app.listen(PORT, () => console.log(`Yappr running on port ${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to init DB:', err);
      process.exit(1);
    });
}

module.exports = app;
