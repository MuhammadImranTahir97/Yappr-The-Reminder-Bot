const { pool } = require('./db');
const { sendNtfy } = require('./ntfy');
const { sendWebPush } = require('./webpush');

async function runTick() {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE done = false AND due_at <= now()`
  );
  const now = Date.now();
  for (const task of rows) {
    const nagMs = task.nag_minutes * 60 * 1000;
    const last = task.last_nagged_at ? new Date(task.last_nagged_at).getTime() : null;
    if (last === null || now - last >= nagMs) {
      const title = `Reminder: ${task.title}`;
      const body = task.notes || 'Tap to mark it done.';
      await sendNtfy(title, body, task.id);
      await sendWebPush(title, body);
      await pool.query(`UPDATE tasks SET last_nagged_at = now() WHERE id = $1`, [task.id]);
    }
  }
}

module.exports = { runTick };
