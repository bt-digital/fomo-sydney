require('dotenv').config();
const { loadState } = require('../../src/store');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const state = await loadState();
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...state }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
