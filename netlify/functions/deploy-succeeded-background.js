require('dotenv').config();
const { crawl } = require('../../src/agent');

// Auto-triggered by Netlify after every successful deploy
// Ensures fresh event data is available immediately after each deployment
exports.handler = async () => {
  console.log('[deploy-succeeded] Running initial crawl —', new Date().toISOString());
  try {
    const result = await crawl();
    console.log(`[deploy-succeeded] Done — ${result.totalEvents} events`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('[deploy-succeeded] Error:', err.message);
    return { statusCode: 500 };
  }
};
