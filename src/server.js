require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { crawl, SOURCES } = require('./agent');
const { loadEvents, loadState, hasData } = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── GET /api/events ──────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  const data = await loadEvents();
  if (!data) return res.json({ events: [], updatedAt: null, totalEvents: 0 });

  let events = data.events || [];

  if (req.query.category && req.query.category !== 'all') {
    events = events.filter(e => e.category === req.query.category);
  }
  if (req.query.suburb) {
    const s = req.query.suburb.toLowerCase();
    events = events.filter(e => (e.location?.suburb || '').toLowerCase().includes(s));
  }
  if (req.query.free === 'true') events = events.filter(e => e.isFree);
  if (req.query.trend) events = events.filter(e => e.trendLevel === req.query.trend);

  const sort = req.query.sort || 'trend';
  if (sort === 'talking') events.sort((a, b) => b.talkingCount - a.talkingCount);
  else if (sort === 'date') events.sort((a, b) => new Date(a.date?.start || '9999') - new Date(b.date?.start || '9999'));
  else events.sort((a, b) => b.trendScore - a.trendScore);

  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    events = events.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.location?.suburb || '').toLowerCase().includes(q)
    );
  }

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const total = events.length;
  const paged = events.slice((page - 1) * limit, page * limit);

  res.json({ events: paged, total, page, pages: Math.ceil(total / limit), updatedAt: data.updatedAt });
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
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

  res.json({
    totalEvents: events.length,
    hotCount, freeCount, totalTalking, thisWeekend,
    categories,
    topSuburbs: Object.entries(suburbs).sort((a, b) => b[1] - a[1]).slice(0, 10),
    sources: { total: SOURCES.length, ok: state.sourcesOk, failed: state.sourcesFailed, lastCrawl: state.lastCrawl },
  });
});

// ─── GET /api/sources ─────────────────────────────────────────────────────────
app.get('/api/sources', async (req, res) => {
  const data = await loadEvents();
  const summary = data?.sourceSummary || {};
  res.json({ sources: SOURCES.map(s => ({ name: s.name, tier: s.tier, ...summary[s.name] })) });
});

// ─── POST /api/crawl ──────────────────────────────────────────────────────────
app.post('/api/crawl', async (req, res) => {
  const token = req.headers['x-crawl-token'];
  if (process.env.CRAWL_TOKEN && token !== process.env.CRAWL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Crawl started', startedAt: new Date().toISOString() });
  crawl().catch(console.error);
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const state = await loadState();
  res.json({ ok: true, ...state });
});

// ─── Scheduler ────────────────────────────────────────────────────────────────
cron.schedule('0 */6 * * *', () => {
  console.log('[Scheduler] Starting scheduled crawl');
  crawl().catch(console.error);
});

// ─── Startup crawl if no data ─────────────────────────────────────────────────
hasData().then(exists => {
  if (!exists) {
    console.log('[Server] No data found — running initial crawl');
    crawl().catch(console.error);
  }
});

app.listen(PORT, () => {
  console.log(`\n🎉 FOMO Sydney running at http://localhost:${PORT}`);
  console.log(`   ${SOURCES.length} sources configured`);
  console.log(`   Crawling every 6 hours\n`);
});
