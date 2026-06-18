// Netlify sets NETLIFY=true in functions AND builds. Guard against "1" as well.
const IS_NETLIFY = !!process.env.NETLIFY && process.env.NETLIFY !== '0';

// ─── Netlify Blobs ─────────────────────────────────────────────────────────────
function getBlobs() {
  const { getStore } = require('@netlify/blobs');
  // Prefer explicit credentials (set in Netlify env vars dashboard) so this
  // works even if NETLIFY_BLOBS_CONTEXT isn't injected (e.g. background fns).
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'fomo-data', siteID, token });
  }
  // Fallback: rely on NETLIFY_BLOBS_CONTEXT injected by the Netlify runtime
  return getStore('fomo-data');
}

// ─── File-system fallback (local dev) ─────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const DATA_PATH  = path.join(__dirname, '../data/events.json');
const STATE_PATH = path.join(__dirname, '../data/state.json');

function fsLoad(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function fsSave(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function saveEvents(data) {
  if (IS_NETLIFY) {
    await getBlobs().setJSON('events', data);
  } else {
    fsSave(DATA_PATH, data);
  }
}

async function loadEvents() {
  if (IS_NETLIFY) {
    try { return await getBlobs().get('events', { type: 'json' }); }
    catch (err) { console.error('[store] loadEvents blobs error:', err.message); return null; }
  }
  return fsLoad(DATA_PATH);
}

async function saveState(state) {
  if (IS_NETLIFY) {
    await getBlobs().setJSON('state', state);
  } else {
    fsSave(STATE_PATH, state);
  }
}

async function loadState() {
  const defaults = { lastCrawl: null, totalEvents: 0, sourcesOk: 0, sourcesFailed: 0 };
  if (IS_NETLIFY) {
    try { return (await getBlobs().get('state', { type: 'json' })) || defaults; }
    catch (err) { console.error('[store] loadState blobs error:', err.message); return defaults; }
  }
  return fsLoad(STATE_PATH) || defaults;
}

async function hasData() {
  if (IS_NETLIFY) {
    try {
      const data = await getBlobs().get('events', { type: 'json' });
      return data !== null;
    } catch { return false; }
  }
  return fs.existsSync(DATA_PATH);
}

module.exports = { saveEvents, loadEvents, saveState, loadState, hasData };
