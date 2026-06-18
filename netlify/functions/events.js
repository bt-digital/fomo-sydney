require('dotenv').config();
const { loadEvents } = require('../../src/store');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const data = await loadEvents();
    if (!data) return { statusCode: 200, headers: CORS, body: JSON.stringify({ events: [], updatedAt: null, total: 0 }) };

    const p = event.queryStringParameters || {};
    let events = data.events || [];

    if (p.category && p.category !== 'all') events = events.filter(e => e.category === p.category);
    if (p.suburb) { const s = p.suburb.toLowerCase(); events = events.filter(e => (e.location?.suburb || '').toLowerCase().includes(s)); }
    if (p.free === 'true') events = events.filter(e => e.isFree);
    if (p.trend) events = events.filter(e => e.trendLevel === p.trend);

    const sort = p.sort || 'trend';
    if (sort === 'talking') events.sort((a, b) => b.talkingCount - a.talkingCount);
    else if (sort === 'date') events.sort((a, b) => new Date(a.date?.start || '9999') - new Date(b.date?.start || '9999'));
    else events.sort((a, b) => b.trendScore - a.trendScore);

    if (p.q) {
      const q = p.q.toLowerCase();
      events = events.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.location?.suburb || '').toLowerCase().includes(q)
      );
    }

    const page = parseInt(p.page) || 1;
    const limit = Math.min(parseInt(p.limit) || 50, 100);
    const total = events.length;
    const paged = events.slice((page - 1) * limit, page * limit);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ events: paged, total, page, pages: Math.ceil(total / limit), updatedAt: data.updatedAt }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
