// RSS / Atom feed-based sources — reliable, low-latency, structured
const RSSParser = require('rss-parser');
const axios = require('axios');

const parser = new RSSParser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FOMOSydney/1.0; +https://fomo.sydney)' },
});

function rssItemToEvent(item, defaults = {}) {
  const name = (item.title || '').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
  if (!name || name.length < 5) return null;
  return {
    name,
    description: (item.contentSnippet || item.content || item.summary || '').slice(0, 500),
    url: item.link || item.guid || '',
    imageUrl: item.enclosure?.url || item['media:thumbnail']?.['$']?.url || '',
    startDate: item.isoDate || item.pubDate || null,
    dateDisplay: item.pubDate || '',
    ...defaults,
  };
}

async function fetchRSS(name, url, defaults = {}) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(i => rssItemToEvent(i, defaults)).filter(Boolean);
  } catch (err) {
    console.error(`[RSS ${name}]`, err.message);
    return [];
  }
}

// ─── Concrete Playground Sydney ─────────────────────────────────────────────
async function fetchConcretePlaygroundRSS() {
  return fetchRSS('Concrete Playground RSS', 'https://concreteplayground.com/sydney/feed/', { category: 'culture' });
}

// ─── Concrete Playground Events category ────────────────────────────────────
async function fetchConcretePlaygroundEventsRSS() {
  return fetchRSS('Concrete Playground Events RSS', 'https://concreteplayground.com/sydney/category/events/feed/', { category: 'culture' });
}

// ─── Time Out Sydney (article listings via RSS) ─────────────────────────────
async function fetchTimeOutRSS() {
  const urls = [
    'https://www.timeout.com/sydney/things-to-do/rss',
    'https://www.timeout.com/sydney/rss.xml',
  ];
  for (const u of urls) {
    const r = await fetchRSS('TimeOut RSS', u, { category: 'culture' });
    if (r.length) return r;
  }
  return [];
}

// ─── Happy Mag (Sydney music/events) ────────────────────────────────────────
async function fetchHappyMagRSS() {
  const all = await fetchRSS('Happy Mag RSS', 'https://happymag.tv/feed/', { category: 'music' });
  // Filter to Sydney-relevant content
  return all.filter(e => {
    const text = (e.name + ' ' + e.description).toLowerCase();
    return text.includes('sydney') || text.includes('nsw') || text.includes('australia');
  }).slice(0, 20);
}

// ─── Stoney Roads (Sydney electronic music events) ───────────────────────────
async function fetchStoneyRoadsRSS() {
  const urls = [
    'https://stoneyroads.com/feed/',
    'https://stoneyroads.com/sydney/feed/',
  ];
  for (const u of urls) {
    try {
      const feed = await parser.parseURL(u);
      if (feed.items.length) {
        return feed.items
          .filter(i => (i.title + ' ' + (i.contentSnippet || '')).toLowerCase().includes('sydney') ||
                       (i.title + ' ' + (i.contentSnippet || '')).toLowerCase().includes('australia'))
          .map(i => rssItemToEvent(i, { category: 'music' }))
          .filter(Boolean)
          .slice(0, 20);
      }
    } catch { }
  }
  return [];
}

// ─── The Music (themusic.com.au) RSS ────────────────────────────────────────
async function fetchTheMusicRSS() {
  const urls = [
    'https://themusic.com.au/sydney/feed/',
    'https://themusic.com.au/feeds/sydney/',
    'https://themusic.com.au/news/feed/',
  ];
  for (const u of urls) {
    const r = await fetchRSS('The Music RSS', u, { category: 'music' });
    if (r.length) return r.slice(0, 20);
  }
  return [];
}

// ─── Music NSW ───────────────────────────────────────────────────────────────
async function fetchMusicNSWRSS() {
  return fetchRSS('Music NSW RSS', 'https://musicnsw.com.au/feed/', { category: 'music' });
}

// ─── FBi Radio (Sydney indie music station events) ───────────────────────────
async function fetchFBiRadioRSS() {
  const urls = [
    'https://fbiradio.com/events/feed/',
    'https://fbiradio.com/feed/',
  ];
  for (const u of urls) {
    const r = await fetchRSS('FBi Radio RSS', u, { category: 'music' });
    if (r.length) return r.slice(0, 20);
  }
  return [];
}

// ─── Inner West Council ──────────────────────────────────────────────────────
async function fetchInnerWestRSS() {
  const urls = [
    'https://www.innerwest.nsw.gov.au/rss/whats-on',
    'https://www.innerwest.nsw.gov.au/feeds/rss/events',
  ];
  for (const u of urls) {
    const r = await fetchRSS('Inner West RSS', u, { suburb: 'Inner West' });
    if (r.length) return r;
  }
  return [];
}

// ─── City of Sydney RSS ──────────────────────────────────────────────────────
async function fetchCityOfSydneyRSS() {
  const urls = [
    'https://whatson.cityofsydney.nsw.gov.au/api/v1/events?format=rss',
    'https://www.cityofsydney.nsw.gov.au/whats-on/rss',
  ];
  for (const u of urls) {
    const r = await fetchRSS('City of Sydney RSS', u, {});
    if (r.length) return r;
  }
  return [];
}

// ─── Waverley Council ────────────────────────────────────────────────────────
async function fetchWaverleyRSS() {
  return fetchRSS('Waverley Council RSS', 'https://www.waverley.nsw.gov.au/api/rss/events', { suburb: 'Bondi' });
}

// ─── Limelight Magazine (classical / opera / arts) RSS ───────────────────────
async function fetchLimelightRSS() {
  const all = await fetchRSS('Limelight RSS', 'https://limelightmagazine.com.au/feed/', { category: 'culture' });
  return all.filter(e => {
    const t = (e.name + ' ' + e.description).toLowerCase();
    return t.includes('sydney') || t.includes('nsw') || t.includes('concert') || t.includes('opera') || t.includes('perform');
  }).slice(0, 15);
}

// ─── Artshub (arts sector event listings) RSS ────────────────────────────────
async function fetchArtshubRSS() {
  const all = await fetchRSS('Artshub RSS', 'https://www.artshub.com.au/feed/', { category: 'art' });
  return all.filter(e => {
    const t = (e.name + ' ' + e.description).toLowerCase();
    return t.includes('sydney') || t.includes('nsw');
  }).slice(0, 15);
}

// ─── Daily Review (arts and culture reviews/listings) RSS ────────────────────
async function fetchDailyReviewRSS() {
  const all = await fetchRSS('Daily Review RSS', 'https://dailyreview.com.au/feed/', { category: 'culture' });
  return all.filter(e => {
    const t = (e.name + ' ' + e.description).toLowerCase();
    return t.includes('sydney') || t.includes('nsw');
  }).slice(0, 15);
}

// ─── TimeOut Food Sydney RSS ─────────────────────────────────────────────────
async function fetchTimeOutFoodRSS() {
  const urls = [
    'https://www.timeout.com/sydney/restaurants/rss',
    'https://www.timeout.com/sydney/food-drink/rss',
  ];
  for (const u of urls) {
    const r = await fetchRSS('TimeOut Food RSS', u, { category: 'food' });
    if (r.length) return r.slice(0, 15);
  }
  return [];
}

// ─── Broadsheet Sydney RSS ───────────────────────────────────────────────────
async function fetchBroadsheetRSS() {
  const urls = [
    'https://www.broadsheet.com.au/sydney/rss',
    'https://www.broadsheet.com.au/rss/sydney',
    'https://www.broadsheet.com.au/sydney/feed',
  ];
  for (const u of urls) {
    const r = await fetchRSS('Broadsheet RSS', u, { category: 'culture' });
    if (r.length) return r.slice(0, 20);
  }
  return [];
}

module.exports = {
  fetchConcretePlaygroundRSS,
  fetchConcretePlaygroundEventsRSS,
  fetchTimeOutRSS,
  fetchHappyMagRSS,
  fetchStoneyRoadsRSS,
  fetchTheMusicRSS,
  fetchMusicNSWRSS,
  fetchFBiRadioRSS,
  fetchInnerWestRSS,
  fetchCityOfSydneyRSS,
  fetchWaverleyRSS,
  fetchLimelightRSS,
  fetchArtshubRSS,
  fetchDailyReviewRSS,
  fetchTimeOutFoodRSS,
  fetchBroadsheetRSS,
};
