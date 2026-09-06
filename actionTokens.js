const crypto = require('crypto');

function signActionToken(taskId, action) {
  const payload = `${taskId}.${action}`;
  const mac = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(`action:${payload}`)
    .digest('hex');
  return `${payload}.${mac}`;
}

function verifyActionToken(token, expectedTaskId, expectedAction) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [taskId, action, mac] = parts;
  if (taskId !== String(expectedTaskId) || action !== expectedAction) return false;

  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(`action:${taskId}.${action}`)
    .digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signActionToken, verifyActionToken };
