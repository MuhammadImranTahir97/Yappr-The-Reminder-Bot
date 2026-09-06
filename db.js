require('dotenv').config();
const { Pool } = require('pg');

// rejectUnauthorized: false accepts any TLS certificate presented by the
// server. This is a deliberate tradeoff for this project only: Supabase's
// pooler cert chain isn't easily pinned from a serverless function, and the
// connection is already scoped to Supabase's own infra over a connection
// string that includes credentials. Don't copy this into a project where a
// MITM against the DB connection is a real threat model - supply Supabase's
// CA cert and verify properly there instead.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      due_at TIMESTAMPTZ NOT NULL,
      recurring TEXT NOT NULL DEFAULT 'none',
      nag_minutes INTEGER NOT NULL DEFAULT 15,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      last_nagged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, init };
