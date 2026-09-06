const { signActionToken } = require('./actionTokens');
const logger = require('./logger');

async function sendNtfy(title, message, taskId) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;

  const headers = {
    Title: title,
    Priority: 'high',
    Tags: 'bell',
  };

  if (taskId && process.env.PUBLIC_BASE_URL) {
    const base = process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const doneToken = signActionToken(taskId, 'done');
    const snoozeToken = signActionToken(taskId, 'snooze');
    const doneUrl = `${base}/api/tasks/${taskId}/done?t=${doneToken}`;
    const snoozeUrl = `${base}/api/tasks/${taskId}/snooze?t=${snoozeToken}`;
    headers.Actions = `http, Done, ${doneUrl}, method=GET, clear=true; http, Snooze 15m, ${snoozeUrl}, method=GET, clear=true`;
  }

  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers,
      body: message || 'Tap to open your reminders.',
    });
  } catch (err) {
    logger.error('ntfy send failed', { taskId, error: err.message });
  }
}

module.exports = { sendNtfy };
