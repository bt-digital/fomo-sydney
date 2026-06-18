require('dotenv').config();
const axios = require('axios');
const pLimit = require('p-limit');
const Anthropic = require('@anthropic-ai/sdk');

const { normalize } = require('./normalizer');
const { deduplicate } = require('./deduplicator');
const { scoreAll } = require('./scorer');
const { enrichEvents } = require('./enricher');
const { saveEvents, saveState } = require('./store');

const apiSources = require('./sources/apiSources');
const scrapeSources = require('./sources/scrapeSources');
const newSources = require('./sources/newSources');
const rssSources = require('./sources/rssSources');
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

  // ── New booking platforms ─────────────────────────────────────────────────
  'Moshtix All Pages':           newSources.fetchMoshtixAllPages,
  'OzTix':                       newSources.fetchOztix,
  'StickyTickets':               newSources.fetchStickyTickets,
  'Humanitix Sydney':            newSources.fetchHumanitixSydney,
  'TryBooking Sydney':           newSources.fetchTryBookingSydney,
  'Eventbrite Sydney':           newSources.fetchEventbriteSydney,
  'Eventfinda Sydney':           newSources.fetchEventfindaSydney,
  'Peatix Sydney':               newSources.fetchPeatixSydney,
  'Ticketek Events':             newSources.fetchTicketekEvents,

  // ── New performing arts ───────────────────────────────────────────────────
  'Belvoir St Theatre':          newSources.fetchBelvoir,
  'Sydney Theatre Company':      newSources.fetchSydneyTheatreCompany,
  'Griffin Theatre':             newSources.fetchGriffithTheatre,
  'Ensemble Theatre':            newSources.fetchEnsembleTheatre,
  'Hayes Theatre':               newSources.fetchHayesTheatre,
  'State Theatre':               newSources.fetchStateTheatre,
  'Old Fitzroy Theatre':         newSources.fetchOldFitzroyTheatre,
  'Bangarra Dance Theatre':      newSources.fetchBangarra,
  'Sydney Symphony Orchestra':   newSources.fetchSydneySymphony,
  'Australian Chamber Orchestra':newSources.fetchAustralianChamberOrchestra,
  'Monkey Baa Theatre':          newSources.fetchMonkeyBaa,
  'The Concourse':               newSources.fetchConcourse,

  // ── New music venues ──────────────────────────────────────────────────────
  'Oxford Art Factory':          newSources.fetchOxfordArtFactory,
  'Enmore Theatre Direct':       newSources.fetchEnmoreTheatreDirect,
  'Metro Direct':                newSources.fetchMetroDirect,
  'Hordern Direct':              newSources.fetchHordernDirect,
  'Goodgod Direct':              newSources.fetchGoodGodDirect,
  'Sweat It Out Direct':         newSources.fetchSweatItOutDirect,
  'Secret Sounds Direct':        newSources.fetchSecretSoundsDirect,
  'Manning Bar':                 newSources.fetchManningBar,
  'Bald Faced Stag':             newSources.fetchBaldFacedStag,
  'Marrickville Bowlo':          newSources.fetchMarrickvilleBowlo,
  'The Vanguard':                newSources.fetchVanguardSydney,
  'Old 505':                     newSources.fetchOld505,
  'Imperial Hotel':              newSources.fetchImperialHotel,
  'Sofar Sounds':                newSources.fetchSofar,
  'Factory Theatre':             newSources.fetchFactoryDirect,

  // ── New museums & galleries ───────────────────────────────────────────────
  'Australian Museum':           newSources.fetchAustralianMuseum,
  'Sydney Living Museums':       newSources.fetchSydneyLivingMuseums,
  'Taronga Zoo':                 newSources.fetchTarongaZoo,
  'State Library NSW':           newSources.fetchStateLibraryNSW,
  'White Rabbit Gallery':        newSources.fetchWhiteRabbitGallery,
  'Campbelltown Arts Centre':    newSources.fetchCampbelltownArts,
  'Casula Powerhouse':           newSources.fetchCasulaArts,
  'Hazelhurst Arts Centre':      newSources.fetchHazelhurst,
  'Penrith Regional Gallery':    newSources.fetchPenrithGallery,
  '4A Contemporary Asian Art':   newSources.fetchCentre4A,
  'MCA Expanded':                newSources.fetchMCAExpanded,
  'Sydney Opera House Expanded': newSources.fetchSydneyOperaHouseExpanded,

  // ── New markets ───────────────────────────────────────────────────────────
  'Marrickville Organic Market': newSources.fetchMarrickvilleOrganicMarket,
  'Kirribilli Markets':          newSources.fetchKirribillMarkets,
  'Balmain Market':              newSources.fetchBalmainMarket,
  'Manly Markets':               newSources.fetchManlyMarkets,
  'Eveleigh Market':             newSources.fetchEveleighMarket,
  'Rozelle Markets':             newSources.fetchRozelleMarkets,
  'Orange Grove Market':         newSources.fetchOrangeGroveMarket,

  // ── New councils ──────────────────────────────────────────────────────────
  'Waverley Council':            newSources.fetchWaverleyCouncil,
  'Inner West Council':          newSources.fetchInnerWestCouncil,
  'North Sydney Council':        newSources.fetchNorthSydneyCouncil,
  'Willoughby Council':          newSources.fetchWilloughbyCouncil,
  'Randwick Council':            newSources.fetchRandwickCouncil,
  'Northern Beaches Council':    newSources.fetchNorthernBeachesCouncil,
  'City of Parramatta':          newSources.fetchParramattaCouncil,
  'Bayside Council':             newSources.fetchBaysideCouncil,
  'Sutherland Shire':            newSources.fetchSutherlandCouncil,
  'Ku-ring-gai Council':         newSources.fetchKuringgaiCouncil,

  // ── New festivals ─────────────────────────────────────────────────────────
  'Sydney Film Festival':        newSources.fetchSydneyFilmFestival,
  'Sydney Comedy Festival':      newSources.fetchSydneyComedyFestival,
  'Sydney Fringe':               newSources.fetchSydneyFringe,
  'Sculpture by the Sea':        newSources.fetchSculptureByTheSea,
  'Night Noodle Markets':        newSources.fetchNightNoodleMarkets,
  'Roar and Snore':              newSources.fetchRoarAndSnore,
  'Laneway Festival':            newSources.fetchLanewayFestival,

  // ── Sport ─────────────────────────────────────────────────────────────────
  'City2Surf':                   newSources.fetchCity2Surf,
  'Sydney Running Festival':     newSources.fetchSydneyRunning,

  // ── Other expanded ────────────────────────────────────────────────────────
  'WeTeachMe Expanded':          newSources.fetchWeTeachMeExpanded,
  'Destination NSW Expanded':    newSources.fetchDestinationNSWExpanded,
  'NSW Government Expanded':     newSources.fetchNSWGovExpanded,
  'Discover Parramatta':         newSources.fetchDiscoverParramatta,
  'Airbnb Experiences Sydney':   newSources.fetchAirbnbExperiencesSydney,
  'Resident Advisor Scrape':     newSources.fetchResidentAdvisorScrape,
  'Dice FM Sydney':              newSources.fetchDiceFmSydney,

  // ── RSS sources ───────────────────────────────────────────────────────────
  'Concrete Playground RSS':        rssSources.fetchConcretePlaygroundRSS,
  'Concrete Playground Events RSS': rssSources.fetchConcretePlaygroundEventsRSS,
  'TimeOut Sydney RSS':             rssSources.fetchTimeOutRSS,
  'TimeOut Food RSS':               rssSources.fetchTimeOutFoodRSS,
  'Broadsheet RSS':                 rssSources.fetchBroadsheetRSS,
  'Happy Mag':                      rssSources.fetchHappyMagRSS,
  'Stoney Roads':                   rssSources.fetchStoneyRoadsRSS,
  'The Music RSS':                  rssSources.fetchTheMusicRSS,
  'Music NSW':                      rssSources.fetchMusicNSWRSS,
  'FBi Radio':                      rssSources.fetchFBiRadioRSS,
  'Inner West RSS':                 rssSources.fetchInnerWestRSS,
  'City of Sydney RSS':             rssSources.fetchCityOfSydneyRSS,
  'Waverley Council RSS':           rssSources.fetchWaverleyRSS,
  'Limelight Magazine':             rssSources.fetchLimelightRSS,
  'Artshub':                        rssSources.fetchArtshubRSS,
  'Daily Review':                   rssSources.fetchDailyReviewRSS,
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

// ─── Velocity calculator ────────────────────────────────────────────────────────
// Compares this crawl's source counts against the previous crawl.
// Returns a 0–1 score: 1 = event doubled its sources since last crawl.
function buildVelocityMap(previousEvents) {
  const map = new Map();
  for (const ev of (previousEvents || [])) {
    map.set(ev.name?.toLowerCase().trim(), ev.sourceCount || 1);
  }
  return map;
}

function velocityScore(eventName, currentSourceCount, prevMap) {
  const prev = prevMap.get(eventName?.toLowerCase().trim());
  if (!prev) return 0.5; // newly discovered = moderate velocity
  const growth = (currentSourceCount - prev) / Math.max(prev, 1);
  return Math.max(0, Math.min(1, growth));
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

  // Load previous crawl for velocity calculation
  const { loadEvents } = require('./store');
  const prevData = await loadEvents().catch(() => null);
  const prevMap  = buildVelocityMap(prevData?.events);

  // Attach velocity scores before main scoring
  for (const ev of deduped) {
    const srcCount = new Set(ev.sources.map(s => s.name)).size;
    ev.velocityScore = velocityScore(ev.name, srcCount, prevMap);
  }

  // Social signal enrichment — Spotify, Last.fm, Reddit (multi-subreddit), Wikipedia
  // Enriches top 300 upcoming events; results cached for 14h to avoid re-fetching
  const enriched = await enrichEvents(deduped);

  // Score and rank using all social signals
  const scored = scoreAll(enriched);

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
