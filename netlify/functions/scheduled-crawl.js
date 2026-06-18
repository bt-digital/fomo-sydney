require('dotenv').config();
const { schedule } = require('@netlify/functions');
const { crawl } = require('../../src/agent');

const handler = async () => {
  console.log('[scheduled-crawl] Starting crawl —', new Date().toISOString());
  try {
    await crawl();
    console.log('[scheduled-crawl] Done');
    return { statusCode: 200 };
  } catch (err) {
    console.error('[scheduled-crawl]', err.message);
    return { statusCode: 500 };
  }
};

// Schedule defined here AND in netlify.toml — both are required
module.exports.handler = schedule('0 */6 * * *', handler);
