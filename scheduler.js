const { runTick } = require('./nag');

async function tick() {
  try {
    await runTick();
  } catch (err) {
    console.error('scheduler tick failed:', err.message);
  }
}

function start() {
  tick();
  setInterval(tick, 60 * 1000);
}

module.exports = { start };
