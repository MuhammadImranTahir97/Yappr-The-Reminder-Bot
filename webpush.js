const webpush = require('web-push');
const { pool } = require('./db');
const logger = require('./logger');

let configured = false;

function isEnabled() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureConfigured() {
  if (configured || !isEnabled()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

async function sendWebPush(title, body, taskId) {
  if (!isEnabled()) return;
  ensureConfigured();

  const { rows } = await pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`);
  const payload = JSON.stringify({ title, body });

  for (const sub of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
        logger.info('removed expired push subscription', { taskId, subscriptionId: sub.id });
      } else {
        logger.error('web push send failed', { taskId, subscriptionId: sub.id, error: err.message });
      }
    }
  }
}

module.exports = { sendWebPush, isEnabled };
