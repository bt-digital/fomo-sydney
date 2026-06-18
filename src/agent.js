require('dotenv').config();
const pLimit = require('p-limit');
const Anthropic = require('@anthropic-ai/sdk');

const { normalize } = require('./normalizer');
const { deduplicate } = require('./deduplicator');
const { scoreAll } = require('./scorer');
const { saveEvents, saveState } = require('./store');

const apiSources = require('./sources/apiSources');
const scrapeSources = require('./sources/scrapeSources');
const { SOURCES: SOURCE_META } = require('./sources/registry');

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ─── Source registry — attach fetch functions to the lightweight registry ────
const FETCH_MAP = {
  'Eventbrite':          apiSources.fetchEventbrite,
  'Meetup':              apiSources.fetchMeetup,
  'Ticketmaster':        apiSources.fetchTicketmaster,
  'Songkick':            apiSources.fetchSongkick,
  'Bandsintown':         apiSources.fetchBandsintown,
  'Humanitix':           apiSources.fetchHumanitix,
  'SeatGeek':            apiSources.fetchSeatGeek,
  'Reddit r/sydney':     apiSources.fetchReddit,
  'Yelp Events':         apiSources.fetchYelp,
  'Google Places':       apiSources.fetchGooglePlaces,
  'Skiddle':             scrapeSources.fetchSkiddle,
  'Resident Advisor':    scrapeSources.fetchResidentAdvisor,
  'Dice.fm':             scrapeSources.fetchDice,
  'TimeOut Sydney':      scrapeSources.fetchTimeOut,
  'Broadsheet Sydney':   scrapeSources.fetchBroadsheet,
  'Concrete Playground': scrapeSources.fetchConcretePlayground,
  'Sydney Opera House':  scrapeSources.fetchSydneyOperaHouse,
  'Art Gallery of NSW':  scrapeSources.fetchAGNSW,
  'MCA Sydney':          scrapeSources.fetchMCA,
  'City of Sydney':      scrapeSources.fetchCityOfSydney,
  'Destination NSW':     scrapeSources.fetchDestinationNSW,
  'Eventfinda':          scrapeSources.fetchEventfinda,
  'TryBooking':          scrapeSources.fetchTryBooking,
  'Moshtix':             scrapeSources.fetchMoshtix,
  'Peatix':              scrapeSources.fetchPeatix,
  'WeTeachMe':           scrapeSources.fetchWeTeachMe,
  'Carriageworks':       scrapeSources.fetchCarriageworks,
  'Seymour Centre':      scrapeSources.fetchSeymourCentre,
  'The Music':           scrapeSources.fetchTheMusic,
  'NSW Government':      scrapeSources.fetchNSWGov,
  'Airbnb Experiences':  scrapeSources.fetchAirbnbExperiences,
  'Ticketek':            scrapeSources.fetchTicketek,
  'Sydney Festival':     scrapeSources.fetchSydneyFestival,
  'Mardi Gras':          scrapeSources.fetchMardiGras,
  'SXSW Sydney':         scrapeSources.fetchSXSWSydney,
  'Vivid Sydney':        scrapeSources.fetchVividSydney,
  'Fuzzy Events':        scrapeSources.fetchFuzzy,
  'Astral People':       scrapeSources.fetchAstralPeople,
  'Sweat It Out':        scrapeSources.fetchSweatItOut,
  'Goodgod Small Club':  scrapeSources.fetchGoodGod,
  'Sydney Town Hall':    scrapeSources.fetchTownHall,
  'Enmore Theatre':      scrapeSources.fetchEnmore,
  'Metro Theatre':       scrapeSources.fetchMetroTheatre,
  'Hordern Pavilion':    scrapeSources.fetchHordern,
  'Factory Theatre':     scrapeSources.fetchFactoryTheatre,
  'Power Station':       scrapeSources.fetchPowerStation,
  'Sydney Markets':      scrapeSources.fetchSydneyMarkets,
  'Secret Sounds':       scrapeSources.fetchSecretSounds,
  'Sydney Comedy Store': scrapeSources.fetchComedyStore,
  'Powerhouse Museum':   scrapeSources.fetchPowerhouse,
};

const SOURCES = SOURCE_META.map(s => ({ ...s, fetch: FETCH_MAP[s.name] }));

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
