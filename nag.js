const { pool } = require('./db');
const { sendNtfy } = require('./ntfy');
const { sendWebPush } = require('./webpush');

// Optional: set both to skip nagging overnight (or any window), e.g.
// QUIET_HOURS_START=22 QUIET_HOURS_END=8 (UTC hours). A task due during
// quiet hours just waits - last_nagged_at isn't touched, so it nags as soon
// as the window ends instead of resetting its own schedule.
function isQuietHours() {
  const start = Number(process.env.QUIET_HOURS_START);
  const end = Number(process.env.QUIET_HOURS_END);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) return false;

  const hour = new Date().getUTCHours();
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // window wraps past midnight
}

async function runTick() {
  // Completed one-off tasks never need to be seen again once well past due.
  await pool.query(
    `DELETE FROM tasks WHERE done = true AND recurring = 'none' AND due_at < now() - interval '30 days'`
  );

  if (isQuietHours()) return;

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
