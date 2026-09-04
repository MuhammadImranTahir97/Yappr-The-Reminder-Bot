require('dotenv').config();
const { pool } = require('../db');
const { sendNtfy } = require('../ntfy');

async function tick() {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE done = false AND due_at <= now()`
  );
  const now = Date.now();
  for (const task of rows) {
    const nagMs = task.nag_minutes * 60 * 1000;
    const last = task.last_nagged_at ? new Date(task.last_nagged_at).getTime() : null;
    if (last === null || now - last >= nagMs) {
      await sendNtfy(`Reminder: ${task.title}`, task.notes || 'Tap to mark it done.');
      await pool.query(`UPDATE tasks SET last_nagged_at = now() WHERE id = $1`, [task.id]);
    }
  }
}

tick()
  .then(() => pool.end())
  .catch((err) => {
    console.error('tick failed:', err.message);
    return pool.end().finally(() => process.exit(1));
  });
