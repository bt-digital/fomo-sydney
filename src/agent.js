require('dotenv').config();
const pLimit = require('p-limit');
const Anthropic = require('@anthropic-ai/sdk');

const { normalize } = require('./normalizer');
const { deduplicate } = require('./deduplicator');
const { scoreAll } = require('./scorer');
const { saveEvents, saveState } = require('./store');

const apiSources = require('./sources/apiSources');
const scrapeSources = require('./sources/scrapeSources');

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ─── Source registry ──────────────────────────────────────────────────────────
// Each entry: { name, fetch, tier }
// tier 1 = official API, tier 2 = structured scrape, tier 3 = LLM-assisted scrape
const SOURCES = [
  // Tier 1 — APIs
  { name: 'Eventbrite',        fetch: apiSources.fetchEventbrite,       tier: 1 },
  { name: 'Meetup',            fetch: apiSources.fetchMeetup,           tier: 1 },
  { name: 'Ticketmaster',      fetch: apiSources.fetchTicketmaster,     tier: 1 },
  { name: 'Songkick',          fetch: apiSources.fetchSongkick,         tier: 1 },
  { name: 'Bandsintown',       fetch: apiSources.fetchBandsintown,      tier: 1 },
  { name: 'Humanitix',         fetch: apiSources.fetchHumanitix,        tier: 1 },
  { name: 'SeatGeek',          fetch: apiSources.fetchSeatGeek,         tier: 1 },
  { name: 'Reddit r/sydney',   fetch: apiSources.fetchReddit,           tier: 1 },
  { name: 'Yelp Events',       fetch: apiSources.fetchYelp,             tier: 1 },
  { name: 'Google Places',     fetch: apiSources.fetchGooglePlaces,     tier: 1 },
  { name: 'Skiddle',           fetch: scrapeSources.fetchSkiddle,       tier: 1 },

  // Tier 2 — structured scraping (JSON-LD / known selectors)
  { name: 'Resident Advisor',      fetch: scrapeSources.fetchResidentAdvisor,    tier: 2 },
  { name: 'Dice.fm',               fetch: scrapeSources.fetchDice,               tier: 2 },
  { name: 'TimeOut Sydney',        fetch: scrapeSources.fetchTimeOut,            tier: 2 },
  { name: 'Broadsheet Sydney',     fetch: scrapeSources.fetchBroadsheet,         tier: 2 },
  { name: 'Concrete Playground',   fetch: scrapeSources.fetchConcretePlayground, tier: 2 },
  { name: 'Sydney Opera House',    fetch: scrapeSources.fetchSydneyOperaHouse,   tier: 2 },
  { name: 'Art Gallery of NSW',    fetch: scrapeSources.fetchAGNSW,              tier: 2 },
  { name: 'MCA Sydney',            fetch: scrapeSources.fetchMCA,                tier: 2 },
  { name: 'City of Sydney',        fetch: scrapeSources.fetchCityOfSydney,       tier: 2 },
  { name: 'Destination NSW',       fetch: scrapeSources.fetchDestinationNSW,     tier: 2 },
  { name: 'Eventfinda',            fetch: scrapeSources.fetchEventfinda,         tier: 2 },
  { name: 'TryBooking',            fetch: scrapeSources.fetchTryBooking,         tier: 2 },
  { name: 'Moshtix',               fetch: scrapeSources.fetchMoshtix,            tier: 2 },
  { name: 'Peatix',                fetch: scrapeSources.fetchPeatix,             tier: 2 },
  { name: 'WeTeachMe',             fetch: scrapeSources.fetchWeTeachMe,          tier: 2 },
  { name: 'Carriageworks',         fetch: scrapeSources.fetchCarriageworks,      tier: 2 },
  { name: 'Seymour Centre',        fetch: scrapeSources.fetchSeymourCentre,      tier: 2 },
  { name: 'The Music',             fetch: scrapeSources.fetchTheMusic,           tier: 2 },
  { name: 'NSW Government',        fetch: scrapeSources.fetchNSWGov,             tier: 2 },
  { name: 'Airbnb Experiences',    fetch: scrapeSources.fetchAirbnbExperiences,  tier: 2 },
  { name: 'Ticketek',              fetch: scrapeSources.fetchTicketek,           tier: 2 },
  { name: 'Sydney Festival',       fetch: scrapeSources.fetchSydneyFestival,     tier: 2 },
  { name: 'Mardi Gras',            fetch: scrapeSources.fetchMardiGras,          tier: 2 },
  { name: 'SXSW Sydney',           fetch: scrapeSources.fetchSXSWSydney,         tier: 2 },
  { name: 'Vivid Sydney',          fetch: scrapeSources.fetchVividSydney,        tier: 2 },
  { name: 'Fuzzy Events',          fetch: scrapeSources.fetchFuzzy,              tier: 2 },
  { name: 'Astral People',         fetch: scrapeSources.fetchAstralPeople,       tier: 2 },
  { name: 'Sweat It Out',          fetch: scrapeSources.fetchSweatItOut,         tier: 2 },
  { name: 'Goodgod Small Club',    fetch: scrapeSources.fetchGoodGod,            tier: 2 },
  { name: 'Sydney Town Hall',      fetch: scrapeSources.fetchTownHall,           tier: 2 },
  { name: 'Enmore Theatre',        fetch: scrapeSources.fetchEnmore,             tier: 2 },
  { name: 'Metro Theatre',         fetch: scrapeSources.fetchMetroTheatre,       tier: 2 },
  { name: 'Hordern Pavilion',      fetch: scrapeSources.fetchHordern,            tier: 2 },
  { name: 'Factory Theatre',       fetch: scrapeSources.fetchFactoryTheatre,     tier: 2 },
  { name: 'Power Station',         fetch: scrapeSources.fetchPowerStation,       tier: 2 },
  { name: 'Sydney Markets',        fetch: scrapeSources.fetchSydneyMarkets,      tier: 2 },
  { name: 'Secret Sounds',         fetch: scrapeSources.fetchSecretSounds,       tier: 2 },
  { name: 'Sydney Comedy Store',   fetch: scrapeSources.fetchComedyStore,        tier: 2 },
  { name: 'Powerhouse Museum',     fetch: scrapeSources.fetchPowerhouse,         tier: 2 },
];

// ─── LLM enrichment — use Claude to extract events from plain text ─────────────
async function llmExtractEvents(rawText, sourceName) {
  if (!anthropic || !rawText) return [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Extract upcoming Sydney events from this text. Return a JSON array only (no explanation).
Each event: { "name": string, "date": string, "venue": string, "description": string, "url": string }
Text from ${sourceName}:
${rawText.slice(0, 3000)}`,
      }],
    });
    const json = msg.content[0].text.match(/\[[\s\S]*\]/)?.[0];
    if (!json) return [];
    return JSON.parse(json).map(e => ({
      name: e.name,
      dateDisplay: e.date,
      venueName: e.venue,
      description: e.description,
      url: e.url,
    }));
  } catch { return []; }
}

// ─── LLM sentiment analysis ────────────────────────────────────────────────────
async function llmSentiment(eventName, comments) {
  if (!anthropic || !comments.length) return { positive: 70, neutral: 25, negative: 5 };
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages: [{
        role: 'user',
        content: `Analyse sentiment for "${eventName}". Comments: ${comments.join(' | ')}
Return JSON only: {"positive": number, "neutral": number, "negative": number} (must sum to 100)`,
      }],
    });
    return JSON.parse(msg.content[0].text.match(/\{[^}]+\}/)?.[0] || '{}');
  } catch { return { positive: 70, neutral: 25, negative: 5 }; }
}

// ─── Main crawl function ───────────────────────────────────────────────────────
async function crawl() {
  console.log(`[Agent] Starting crawl across ${SOURCES.length} sources — ${new Date().toISOString()}`);
  const limit = pLimit(8); // max 8 concurrent requests
  const sourceResults = new Map();

  const tasks = SOURCES.map(source =>
    limit(async () => {
      const start = Date.now();
      try {
        const raw = await source.fetch();
        const events = raw
          .map(r => normalize(r, source.name))
          .filter(Boolean);
        sourceResults.set(source.name, { count: events.length, ok: true });
        console.log(`  ✓ ${source.name}: ${events.length} events (${Date.now() - start}ms)`);
        return events;
      } catch (err) {
        sourceResults.set(source.name, { count: 0, ok: false, error: err.message });
        console.error(`  ✗ ${source.name}: ${err.message}`);
        return [];
      }
    })
  );

  const results = await Promise.all(tasks);
  const allEvents = results.flat();
  console.log(`[Agent] Raw events collected: ${allEvents.length}`);

  // Deduplicate
  const deduped = deduplicate(allEvents);
  console.log(`[Agent] After deduplication: ${deduped.length}`);

  // Score and rank
  const scored = scoreAll(deduped);

  // LLM enrichment on top 20 events (rate-limit conscious)
  if (anthropic) {
    const top = scored.slice(0, 20);
    for (const ev of top) {
      if (ev.comments.length === 0) continue;
      ev.sentiment = await llmSentiment(ev.name, ev.comments.map(c => c.text));
    }
  }

  // Save results
  const output = {
    updatedAt: new Date().toISOString(),
    totalEvents: scored.length,
    sourceSummary: Object.fromEntries(sourceResults),
    events: scored,
  };

  await saveEvents(output);
  await saveState({
    lastCrawl: new Date().toISOString(),
    totalEvents: scored.length,
    sourcesOk: [...sourceResults.values()].filter(s => s.ok).length,
    sourcesFailed: [...sourceResults.values()].filter(s => !s.ok).length,
  });

  console.log(`[Agent] Done. ${scored.length} events saved. ${[...sourceResults.values()].filter(s => s.ok).length}/${SOURCES.length} sources succeeded.`);
  return output;
}

module.exports = { crawl, SOURCES };

// Run directly if called as script
if (require.main === module) {
  crawl().catch(console.error);
}
