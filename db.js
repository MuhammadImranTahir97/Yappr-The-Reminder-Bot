require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
  `);
}

module.exports = { pool, init };
