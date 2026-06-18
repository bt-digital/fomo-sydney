require('dotenv').config();
const { loadEvents } = require('../../src/store');
const { SOURCES } = require('../../src/sources/registry');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const data = await loadEvents();
    const summary = data?.sourceSummary || {};
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        sources: SOURCES.map(s => ({ name: s.name, tier: s.tier, ...summary[s.name] })),
      }),
    };
  } catch (err) {
    console.error('[sources]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
