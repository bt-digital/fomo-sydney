// Social signal enricher
// Queries Spotify, Last.fm, Reddit (multi-subreddit) and Wikipedia for each event.
//
// Note on platforms not supported:
//   Facebook  — Graph API requires app review; post search not available self-serve
//   Instagram — Content search API removed in 2019; only available to business partners
//   Discord   — No public search API exists
//   TikTok    — No public search API; scraping blocked
//
// Free APIs used here (just need account signups):
//   Spotify   — https://developer.spotify.com/dashboard (SPOTIFY_CLIENT_ID / SECRET)
//   Last.fm   — https://www.last.fm/api/account/create (LASTFM_API_KEY)
//   Reddit    — No key required (public JSON API)
//   Wikipedia — No key required

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const pLimit = require('p-limit');

// ─── Cache (persists between crawls) ─────────────────────────────────────────
const CACHE_PATH = path.join(__dirname, '../data/enrichment-cache.json');
const CACHE_TTL  = 14 * 60 * 60 * 1000; // 14 hours

let _cache = {};
try {
  if (fs.existsSync(CACHE_PATH)) _cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
} catch {}

function cacheGet(key) {
  const e = _cache[key];
  if (!e || Date.now() - e.ts > CACHE_TTL) return undefined;
  return e.data;
}
function cacheSet(key, data) { _cache[key] = { ts: Date.now(), data }; }

function flushCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    const now = Date.now();
    for (const k of Object.keys(_cache)) {
      if (now - _cache[k].ts > CACHE_TTL * 3) delete _cache[k];
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache));
  } catch {}
}

// ─── Spotify ──────────────────────────────────────────────────────────────────
let _spotifyToken = null;
let _spotifyExpiry = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyExpiry - 5000) return _spotifyToken;
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  try {
    const res = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 8000,
      }
    );
    _spotifyToken  = res.data.access_token;
    _spotifyExpiry = Date.now() + res.data.expires_in * 1000;
    return _spotifyToken;
  } catch { return null; }
}

async function spotifyLookup(artistName) {
  const key = `spotify:${artistName.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const token = await getSpotifyToken();
  if (!token) { cacheSet(key, null); return null; }

  try {
    const res = await axios.get('https://api.spotify.com/v1/search', {
      params: { q: artistName, type: 'artist', limit: 3, market: 'AU' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 6000,
    });
    const items = res.data.artists?.items || [];
    if (!items.length) { cacheSet(key, null); return null; }

    // Prefer exact name match, fall back to first result
    const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const match = items.find(a => norm(a.name) === norm(artistName)) || items[0];
    const data = {
      popularity: match.popularity || 0,
      followers:  match.followers?.total || 0,
      genres:     match.genres?.slice(0, 3) || [],
    };
    cacheSet(key, data);
    return data;
  } catch { cacheSet(key, null); return null; }
}

// ─── Last.fm ──────────────────────────────────────────────────────────────────
async function lastfmLookup(artistName) {
  const key = `lastfm:${artistName.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) { cacheSet(key, null); return null; }

  try {
    const res = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: {
        method: 'artist.getinfo', artist: artistName,
        api_key: apiKey, format: 'json', autocorrect: 1,
      },
      timeout: 6000,
    });
    const stats = res.data?.artist?.stats;
    if (!stats) { cacheSet(key, null); return null; }
    const data = {
      listeners: parseInt(stats.listeners || '0'),
      playcount: parseInt(stats.playcount || '0'),
    };
    cacheSet(key, data);
    return data;
  } catch { cacheSet(key, null); return null; }
}

// ─── Reddit (local + global) ──────────────────────────────────────────────────
async function redditLookup(query) {
  const key = `reddit:${query.toLowerCase().slice(0, 80)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const [localRes, globalRes] = await Promise.allSettled([
      axios.get('https://www.reddit.com/r/sydney+sydneymusic+ausmusic+australia/search.json', {
        params: { q: query, sort: 'relevance', t: 'month', limit: 15 },
        headers: { 'User-Agent': 'FOMOSydney/1.0 (event discovery; contact ben@btdigital.co)' },
        timeout: 8000,
      }),
      axios.get('https://www.reddit.com/search.json', {
        params: { q: `"${query.slice(0, 60)}"`, sort: 'relevance', t: 'month', limit: 10 },
        headers: { 'User-Agent': 'FOMOSydney/1.0 (event discovery; contact ben@btdigital.co)' },
        timeout: 8000,
      }),
    ]);

    const localPosts  = localRes.status  === 'fulfilled' ? (localRes.value.data?.data?.children  || []).map(c => c.data) : [];
    const globalPosts = globalRes.status === 'fulfilled' ? (globalRes.value.data?.data?.children || []).map(c => c.data) : [];

    const seen = new Set();
    const posts = [...localPosts, ...globalPosts].filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    const data = {
      mentions: posts.length,
      score:    posts.reduce((s, p) => s + (p.score       || 0), 0),
      comments: posts.reduce((s, p) => s + (p.num_comments || 0), 0),
    };
    cacheSet(key, data);
    return data;
  } catch { cacheSet(key, null); return null; }
}

// ─── Wikipedia pageviews (search-interest proxy) ─────────────────────────────
async function wikiLookup(query) {
  const key = `wiki:${query.toLowerCase().slice(0, 80)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const searchRes = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 1 },
      timeout: 6000,
    });
    const title = searchRes.data?.query?.search?.[0]?.title;
    if (!title) { cacheSet(key, null); return null; }

    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    const now   = new Date();
    const fmt   = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}00`;
    const to    = fmt(now);
    const from  = fmt(new Date(now - 30 * 86400000));

    const viewsRes = await axios.get(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encoded}/daily/${from}/${to}`,
      { timeout: 6000 }
    );
    const monthlyViews = (viewsRes.data?.items || []).reduce((s, d) => s + (d.views || 0), 0);
    const data = { monthlyViews, title };
    cacheSet(key, data);
    return data;
  } catch { cacheSet(key, null); return null; }
}

// ─── Artist name extraction ────────────────────────────────────────────────────
// For music events the title is usually the artist name — strip common suffixes
function extractArtist(eventName) {
  let s = eventName
    .replace(/\s*\((?:AUS|AU|US|UK|NZ|CA)\)\s*/gi, ' ')   // "(AUS)" suffix
    .replace(/\s*[—–]\s*.{5,}$/, '')                        // "— Dark Mofo 2026"
    .replace(/\s*\|.*$/, '')                                 // "| extra info"
    .replace(/\s*\((?:\d+\+|all ages|lic\.? venue|licensed|18\+)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // "Seasons of Change #53: 3000 - Friends Of The Program" → "3000"
  const afterColon = s.match(/:\s*(.{2,40})$/)?.[1]?.trim();
  if (afterColon && afterColon.length < 35 && !afterColon.includes(':')) s = afterColon;

  return s || eventName;
}

// ─── Enrich a single event ─────────────────────────────────────────────────────
async function enrichOne(ev) {
  const isMusic  = ev.category === 'music';
  const artist   = isMusic ? extractArtist(ev.name) : null;
  const term     = (artist || ev.name).slice(0, 80);

  const [spotify, lastfm, reddit, wiki] = await Promise.all([
    isMusic ? spotifyLookup(artist)  : Promise.resolve(null),
    isMusic ? lastfmLookup(artist)   : Promise.resolve(null),
    redditLookup(term),
    wikiLookup(term),
  ]);

  return {
    ...ev,
    rawSignals: {
      ...(ev.rawSignals || {}),
      spotifyPopularity: spotify?.popularity   ?? 0,
      spotifyFollowers:  spotify?.followers    ?? 0,
      lastfmListeners:   lastfm?.listeners     ?? 0,
      redditMentions:    reddit?.mentions      ?? (ev.rawSignals?.redditMentions || 0),
      redditScore:       reddit?.score         ?? (ev.rawSignals?.redditScore    || 0),
      redditComments:    reddit?.comments      ?? (ev.rawSignals?.redditComments || 0),
      wikiMonthlyViews:  wiki?.monthlyViews    ?? 0,
    },
  };
}

// ─── Public: enrich the top N upcoming events ──────────────────────────────────
// We pre-sort by urgency + source count, enrich the top slice, leave the rest
// with zero social signals (they'll still score on urgency/coverage).
async function enrichEvents(events, topN = 300) {
  function preScore(ev) {
    const days = (new Date(ev.date?.start || '9999') - Date.now()) / 86400000;
    if (days < -1) return -9999;
    const srcs = new Set((ev.sources || []).map(s => s.name)).size;
    const urgency = days <= 1 ? 30 : days <= 7 ? 20 : days <= 30 ? 10 : 3;
    return urgency + srcs * 5;
  }

  const sorted    = [...events].sort((a, b) => preScore(b) - preScore(a));
  const toEnrich  = sorted.slice(0, topN);
  const remainder = sorted.slice(topN);

  console.log(`[Enricher] Enriching top ${toEnrich.length} events (${remainder.length} skipped)…`);
  const start = Date.now();

  const limit   = pLimit(6);
  const enriched = await Promise.all(toEnrich.map(ev => limit(() => enrichOne(ev))));

  console.log(`[Enricher] Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  flushCache();

  return [...enriched, ...remainder];
}

module.exports = { enrichEvents };
