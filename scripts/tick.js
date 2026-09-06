require('dotenv').config();
const { pool, init } = require('../db');
const { runTick } = require('../nag');
const logger = require('../logger');

async function tick() {
  await init();
  await runTick();
}

tick()
  .then(() => pool.end())
  .catch((err) => {
    logger.error('tick failed', { error: err.message });
    return pool.end().finally(() => process.exit(1));
  });
