require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { pool, init } = require('./db');
const scheduler = require('./scheduler');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

// Login endpoint (must stay open, before auth gate)
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.APP_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tasks', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM tasks ORDER BY done ASC, due_at ASC`);
  res.json(rows);
});

app.get('/api/tasks/due', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE done = false AND due_at <= now() ORDER BY due_at ASC`
  );
  res.json(rows);
});

app.post('/api/tasks', async (req, res) => {
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
});

app.patch('/api/tasks/:id/done', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  const task = rows[0];
  if (!task) return res.status(404).json({ error: 'not found' });

  if (task.recurring === 'daily') {
    const { rows: updated } = await pool.query(
      `UPDATE tasks SET due_at = due_at + interval '1 day', done = false, last_nagged_at = NULL
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
});

app.patch('/api/tasks/:id/undone', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE tasks SET done = false, last_nagged_at = NULL WHERE id = $1 RETURNING *`,
    [id]
  );
  res.json(rows[0]);
});

app.delete('/api/tasks/:id', async (req, res) => {
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    scheduler.start();
    app.listen(PORT, () => console.log(`Yappr running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
