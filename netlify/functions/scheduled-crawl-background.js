require('dotenv').config();
const { crawl } = require('../../src/agent');

// Scheduled background function — runs every 6 hours (defined in netlify.toml)
// Background suffix gives 15-minute timeout, enough for 50-source crawl
exports.handler = async () => {
  console.log('[scheduled-crawl] Starting —', new Date().toISOString());
  try {
    const result = await crawl();
    console.log(`[scheduled-crawl] Done — ${result.totalEvents} events`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('[scheduled-crawl] Error:', err.message);
    return { statusCode: 500 };
  }
};
