require('dotenv').config();
const { loadEvents, loadState } = require('../../src/store');
const { SOURCES } = require('../../src/sources/registry');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const [data, state] = await Promise.all([loadEvents(), loadState()]);
    const events = data?.events || [];

    const categories = {};
    const suburbs = {};
    let hotCount = 0, freeCount = 0, totalTalking = 0, thisWeekend = 0;
    const weekend = new Date(Date.now() + 7 * 86400000);

    for (const ev of events) {
      categories[ev.category] = (categories[ev.category] || 0) + 1;
      if (ev.location?.suburb) suburbs[ev.location.suburb] = (suburbs[ev.location.suburb] || 0) + 1;
      if (ev.trendLevel === 'hot') hotCount++;
      if (ev.isFree) freeCount++;
      totalTalking += ev.talkingCount || 0;
      if (ev.date?.start && new Date(ev.date.start) <= weekend) thisWeekend++;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        totalEvents: events.length,
        hotCount, freeCount, totalTalking, thisWeekend,
        categories,
        topSuburbs: Object.entries(suburbs).sort((a, b) => b[1] - a[1]).slice(0, 10),
        sources: {
          total: SOURCES.length,
          ok: state.sourcesOk,
          failed: state.sourcesFailed,
          lastCrawl: state.lastCrawl,
        },
      }),
    };
  } catch (err) {
    console.error('[stats]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
