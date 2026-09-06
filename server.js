require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
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
app.use(express.json());
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
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.APP_PASSWORD) {
    res.cookie(COOKIE_NAME, signAuthToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TOKEN_MAX_AGE_MS,
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong password' });
});

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

function requireAuth(req, res, next) {
  if (isValidAuthCookie(req.cookies[COOKIE_NAME])) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
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
  if (!title || !dueAt) return res.status(400).json({ error: 'title and dueAt required' });
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, due_at, recurring, nag_minutes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      title,
      notes || '',
      dueAt,
      recurring === 'daily' ? 'daily' : 'none',
      nagMinutes && nagMinutes > 0 ? nagMinutes : 15,
    ]
  );
  res.json(rows[0]);
}));

app.patch('/api/tasks/:id/done', asyncHandler(async (req, res) => {
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

app.patch('/api/tasks/:id/undone', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE tasks SET done = false, last_nagged_at = NULL WHERE id = $1 RETURNING *`,
    [id]
  );
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', asyncHandler(async (req, res) => {
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3000;

// Only runs when started directly (local dev, or self-hosting) — on Vercel
// this module is required as a serverless handler, so this block is skipped
// and the in-process scheduler (replaced there by a GitHub Actions cron
// calling scripts/tick.js) never starts.
if (require.main === module) {
  init()
    .then(() => {
      scheduler.start();
      app.listen(PORT, () => console.log(`Yappr running on port ${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to init DB:', err);
      process.exit(1);
    });
}

module.exports = app;
