const { runTick } = require('./nag');
const logger = require('./logger');

async function tick() {
  try {
    await runTick();
  } catch (err) {
    logger.error('scheduler tick failed', { error: err.message });
  }
}

function start() {
  tick();
  setInterval(tick, 60 * 1000);
}

module.exports = { start };
