require('dotenv').config();
const { crawl } = require('../../src/agent');

// Background function — Netlify responds 202 immediately, this runs for up to 15 minutes
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  const token = event.headers['x-crawl-token'];
  if (process.env.CRAWL_TOKEN && token !== process.env.CRAWL_TOKEN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    await crawl();
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[crawl-background]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
