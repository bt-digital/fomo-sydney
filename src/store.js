const IS_NETLIFY = process.env.NETLIFY === 'true';

let _store = null;
function getBlobs() {
  if (!_store) {
    const { getStore } = require('@netlify/blobs');
    _store = getStore('fomo-data');
  }
  return _store;
}

// ─── File-system fallback (local dev) ─────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '../data/events.json');
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
    return await getBlobs().get('events', { type: 'json' });
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
    return (await getBlobs().get('state', { type: 'json' })) || defaults;
  }
  return fsLoad(STATE_PATH) || defaults;
}

async function hasData() {
  if (IS_NETLIFY) {
    const data = await getBlobs().get('events', { type: 'json' });
    return data !== null;
  }
  return fs.existsSync(DATA_PATH);
}

module.exports = { saveEvents, loadEvents, saveState, loadState, hasData };
