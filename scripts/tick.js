require('dotenv').config();
const { pool, init } = require('../db');
const { runTick } = require('../nag');

async function tick() {
  await init();
  await runTick();
}

tick()
  .then(() => pool.end())
  .catch((err) => {
    console.error('tick failed:', err.message);
    return pool.end().finally(() => process.exit(1));
  });
