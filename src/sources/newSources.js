// 100 new Sydney event sources — venues, institutions, councils, ticketing platforms
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const EVENT_TYPES = new Set(['Event','MusicEvent','TheaterEvent','Festival','SocialEvent','SportsEvent','EducationEvent','ExhibitionEvent','ComedyEvent','DanceEvent','ScreeningEvent','VisualArtsEvent','LiteraryEvent','FoodEvent','SaleEvent','BusinessEvent','TheaterEvent','ChildrensEvent']);

async function fetchHtml(url, timeout = 12000) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout });
    return res.data;
  } catch { return null; }
}

function extractJsonLd(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const events = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      let items = Array.isArray(data) ? data : (data['@graph'] ? (Array.isArray(data['@graph']) ? data['@graph'] : [data['@graph']]) : [data]);
      for (const item of items) {
        const type = Array.isArray(item['@type']) ? item['@type'].join(',') : (item['@type'] || '');
        if (![...EVENT_TYPES].some(t => type.includes(t))) continue;
        if (!item.name) continue;
        const loc = item.location || {};
        const addr = loc.address || {};
        events.push({
          name: item.name,
          description: (item.description || '').slice(0, 500),
          startDate: item.startDate,
          endDate: item.endDate,
          url: item.url || item['@id'] || '',
          imageUrl: typeof item.image === 'string' ? item.image : (item.image?.url || item.image?.contentUrl || ''),
          venueName: loc.name || '',
          address: typeof addr === 'string' ? addr : (addr.streetAddress || ''),
          organizer: Array.isArray(item.organizer) ? item.organizer[0]?.name : item.organizer?.name,
          isFree: item.isAccessibleForFree,
          price: item.offers?.price != null ? String(item.offers.price) : (item.offers?.minPrice != null ? String(item.offers.minPrice) : null),
        });
      }
    } catch { }
  });
  return events;
}

function isValidName(name) {
  if (!name) return false;
  const clean = name.trim();
  if (clean.length < 5 || clean.length > 200) return false;
  const lower = clean.toLowerCase();
  const BLOCKLIST = new Set(['today','this weekend','see all','load more','read more','more info','buy tickets','get tickets','book now','learn more','upcoming events','search','all events','whats on',"what's on",'home','back','next','previous','menu','close','events','shows','tickets','subscribe','sign up','newsletter','follow us','filter','sort by','results','featured','latest','popular','recommended','explore','discover','facebook','instagram','youtube','twitter','tiktok','linkedin','sign in','log in','login','register','account','privacy policy','terms','all shows','all exhibitions','view all','show all','see more','browse all','full programme','programme','schedule','lineup','buy now','contact','about us','venue hire']);
  if (BLOCKLIST.has(lower)) return false;
  const alphaRatio = (clean.match(/[a-zA-Z]/g) || []).length / clean.length;
  return alphaRatio > 0.4;
}

function scrapeHeadings($, baseUrl = '', venueName = '', defaults = {}) {
  const results = [];
  const seen = new Set();
  $('h1,h2,h3,h4').each((_, el) => {
    const name = $(el).text().trim();
    if (!isValidName(name) || seen.has(name)) return;
    seen.add(name);
    const href = $(el).find('a').first().attr('href') || $(el).closest('a').attr('href') || $(el).next('a').attr('href') || '';
    const date = $(el).closest('article,section,li,[class*="event"],[class*="card"]').find('time,[class*="date"]').first().text().trim();
    const url = href ? (href.startsWith('http') ? href : `${baseUrl}${href}`) : '';
    results.push({ name, dateDisplay: date, venueName, url, ...defaults });
  });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING PLATFORMS — HIGH VOLUME
// ═══════════════════════════════════════════════════════════════════════════════

// Moshtix — fetch ALL events via their JSON API (1700+ events in a single call)
async function fetchMoshtixAllPages() {
  try {
    const res = await axios.get('https://www.moshtix.com.au/v2/api/search', {
      params: { q: '', state: 'NSW', page: 1 },
      headers: { ...HEADERS, Accept: 'application/json' },
      timeout: 20000,
    });
    const rawEvents = Object.values(res.data?.EventSearchResults || {});
    const fixImg = p => (p && p !== '/uploads/' && p !== '/uploads') ? `https://www.moshtix.com.au${p}` : null;
    return rawEvents.map(e => ({
      name: e.Title,
      startDate: e.StartDate,
      dateDisplay: e.StartDateFormatted,
      url: e.EventUrl || e.Url,
      imageUrl: fixImg(e.PhotoFileCustomUrl) || fixImg(e.PhotoFileUrl),
      venueName: e.VenueName,
      address: [e.Street1, e.Suburb, e.City].filter(Boolean).join(', '),
      description: (e.Summary || e.Details || '').slice(0, 500),
      category: (e.Genre || e.Category || '').toLowerCase().includes('music') ? 'music' : undefined,
      isFree: e.FromPrice === 0,
      price: e.FromPrice != null ? String(e.FromPrice) : null,
    })).filter(e => e.name);
  } catch (err) {
    console.error('[Moshtix All Pages]', err.message);
    return [];
  }
}

// OzTix — scrape event cards
async function fetchOztix() {
  try {
    const html = await fetchHtml('https://www.oztix.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('[class*="event"],[class*="Event"],article,.item').each((_, el) => {
      const name = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      const date = $(el).find('time,[class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href') || '';
      results.push({ name, dateDisplay: date, url: href.startsWith('http') ? href : `https://www.oztix.com.au${href}` });
    });
    return results;
  } catch (err) {
    console.error('[OzTix]', err.message);
    return [];
  }
}

// StickyTickets
async function fetchStickyTickets() {
  try {
    const html = await fetchHtml('https://www.stickytickets.com.au/find_events/state/NSW');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('[class*="event"],[class*="listing"],article,.row .col').each((_, el) => {
      const name = $(el).find('h2,h3,h4,[class*="title"],[class*="name"]').first().text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      const date = $(el).find('time,[class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href') || '';
      results.push({ name, dateDisplay: date, url: href.startsWith('http') ? href : `https://www.stickytickets.com.au${href}` });
    });
    return results;
  } catch (err) {
    console.error('[StickyTickets]', err.message);
    return [];
  }
}

// Humanitix
async function fetchHumanitixSydney() {
  try {
    for (const url of [
      'https://events.humanitix.com/au',
      'https://events.humanitix.com/',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length > 1) return events;
      // Try Next.js __NEXT_DATA__ for structured event data
      const m = (html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        try {
          const d = JSON.parse(m[1]);
          const evts = d?.props?.pageProps?.events || d?.props?.pageProps?.data?.events || [];
          if (evts.length) return evts.map(e => ({
            name: e.name || e.title,
            startDate: e.startDate || e.start_date,
            url: `https://events.humanitix.com/${e.slug || e.id}`,
            imageUrl: e.image || e.coverImage?.url,
            venueName: e.location?.name || e.venue,
            description: e.description,
          }));
        } catch { }
      }
    }
    return [];
  } catch (err) {
    console.error('[Humanitix Sydney]', err.message);
    return [];
  }
}

// TryBooking — scrape NSW events
async function fetchTryBookingSydney() {
  try {
    for (const url of [
      'https://www.trybooking.com/events?country=AU&state=2',
      'https://www.trybooking.com/events?country=au',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events;
      const $ = cheerio.load(html);
      const results = [];
      const seen = new Set();
      $('[class*="event"],[class*="Event"],article,.event-item').each((_, el) => {
        const name = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim();
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        const href = $(el).find('a').first().attr('href') || '';
        results.push({ name, url: href.startsWith('http') ? href : `https://www.trybooking.com${href}` });
      });
      if (results.length > 2) return results;
    }
    return [];
  } catch (err) {
    console.error('[TryBooking Sydney]', err.message);
    return [];
  }
}

// Eventbrite — scrape h3 listings from their discovery page
async function fetchEventbriteSydney() {
  try {
    for (const url of [
      'https://www.eventbrite.com.au/d/australia--sydney/events/',
      'https://www.eventbrite.com.au/d/australia--sydney/events/?page=2',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length > 3) return events;
      // Fallback: h3 tags contain event names
      const $ = cheerio.load(html);
      const results = [];
      const seen = new Set();
      $('h3').each((_, el) => {
        const name = $(el).text().trim();
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || '';
        const date = $(el).closest('[class*="card"],[class*="event"],article').find('time,[class*="date"]').first().text().trim();
        results.push({ name, dateDisplay: date, url: href.startsWith('http') ? href : (href ? `https://www.eventbrite.com.au${href}` : '') });
      });
      if (results.length > 3) return results;
    }
    return [];
  } catch (err) {
    console.error('[Eventbrite Sydney]', err.message);
    return [];
  }
}

// Eventfinda — use homepage which works
async function fetchEventfindaSydney() {
  try {
    const html = await fetchHtml('https://www.eventfinda.com.au/');
    if (!html) return [];
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    // Eventfinda homepage lists events in h3 tags
    $('h2,h3,h4').each((_, el) => {
      const name = $(el).text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      const href = $(el).find('a').first().attr('href') || $(el).closest('a').attr('href') || $(el).next('a').attr('href') || '';
      const date = $(el).closest('article,li,.event-item').find('time,[class*="date"]').first().text().trim();
      results.push({ name, dateDisplay: date, url: href.startsWith('http') ? href : `https://www.eventfinda.com.au${href}` });
    });
    return results;
  } catch (err) {
    console.error('[Eventfinda Sydney]', err.message);
    return [];
  }
}

// Peatix — Sydney events
async function fetchPeatixSydney() {
  try {
    const html = await fetchHtml('https://peatix.com/country/au/events');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('[class*="event"],[class*="card"],li.item').each((_, el) => {
      const name = $(el).find('h2,h3,[class*="title"]').first().text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      const href = $(el).find('a').first().attr('href') || '';
      results.push({ name, url: href.startsWith('http') ? href : `https://peatix.com${href}` });
    });
    return results;
  } catch (err) {
    console.error('[Peatix Sydney]', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMING ARTS VENUES
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchBelvoir() {
  try {
    const html = await fetchHtml('https://belvoir.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Belvoir St Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://belvoir.com.au', 'Belvoir St Theatre', { category: 'culture' }).slice(0, 15);
  } catch (err) { console.error('[Belvoir]', err.message); return []; }
}

async function fetchSydneyTheatreCompany() {
  try {
    for (const url of [
      'https://www.sydneytheatre.com.au/whats-on',
      'https://www.sydneytheatre.com.au/whats-on/productions',
      'https://www.sydneytheatre.com.au/whats-on/productions/2026',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Sydney Theatre Company', category: 'culture' }));
    }
    return [];
  } catch (err) { console.error('[STC]', err.message); return []; }
}

async function fetchGriffithTheatre() {
  try {
    const html = await fetchHtml('https://griffintheatre.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Griffin Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://griffintheatre.com.au', 'Griffin Theatre', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Griffin Theatre]', err.message); return []; }
}

async function fetchEnsembleTheatre() {
  try {
    const html = await fetchHtml('https://www.ensembletheatre.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Ensemble Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.ensembletheatre.com.au', 'Ensemble Theatre', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Ensemble Theatre]', err.message); return []; }
}

async function fetchHayesTheatre() {
  try {
    const html = await fetchHtml('https://hayestheatre.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Hayes Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://hayestheatre.com.au', 'Hayes Theatre', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Hayes Theatre]', err.message); return []; }
}

async function fetchStateTheatre() {
  try {
    const html = await fetchHtml('https://statetheatre.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'State Theatre Sydney', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://statetheatre.com.au', 'State Theatre', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[State Theatre]', err.message); return []; }
}

async function fetchOldFitzroyTheatre() {
  try {
    const html = await fetchHtml('https://oldfitzroytheatre.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Old Fitzroy Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://oldfitzroytheatre.com.au', 'Old Fitzroy Theatre', { category: 'culture' }).slice(0, 8);
  } catch (err) { console.error('[Old Fitzroy]', err.message); return []; }
}

async function fetchBangarra() {
  try {
    const html = await fetchHtml('https://bangarra.com.au/performances/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Bangarra Dance Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://bangarra.com.au', 'Bangarra Dance Theatre', { category: 'culture' }).slice(0, 8);
  } catch (err) { console.error('[Bangarra]', err.message); return []; }
}

async function fetchSydneySymphony() {
  try {
    const html = await fetchHtml('https://www.sydneysymphony.com/performances/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Sydney Symphony Orchestra', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.sydneysymphony.com', 'Sydney Symphony Orchestra', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Sydney Symphony]', err.message); return []; }
}

async function fetchAustralianChamberOrchestra() {
  try {
    const html = await fetchHtml('https://www.aco.com.au/performances/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Australian Chamber Orchestra', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.aco.com.au', 'Australian Chamber Orchestra', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[ACO]', err.message); return []; }
}

async function fetchMonkeyBaa() {
  try {
    const html = await fetchHtml('https://monkeybaa.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Monkey Baa Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://monkeybaa.com.au', 'Monkey Baa Theatre', { category: 'culture' }).slice(0, 8);
  } catch (err) { console.error('[Monkey Baa]', err.message); return []; }
}

async function fetchConcourse() {
  try {
    const html = await fetchHtml('https://www.theconcourse.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'The Concourse Chatswood', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.theconcourse.com.au', 'The Concourse Chatswood', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Concourse]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MUSIC VENUES
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchOxfordArtFactory() {
  try {
    // OAF uses Moshtix — scrape their events page
    const html = await fetchHtml('https://www.oxfordartfactory.com/whats-on');
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    // Extract Moshtix links from OAF page
    $('a[href*="moshtix.com.au"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('/event/')) return;
      // Find name from heading near this link
      let name = '';
      let node = $(el);
      for (let i = 0; i < 6 && !name; i++) {
        name = node.find('h1,h2,h3,h4,[class*="title"]').first().text().trim() || node.filter('h2,h3,h4').text().trim();
        node = node.parent();
      }
      if (!name) name = href.split('/event/')[1]?.split('/')[0]?.replace(/-/g, ' ')?.replace(/\b\w/g, c => c.toUpperCase()) || '';
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, venueName: 'Oxford Art Factory', category: 'music', url: href });
    });
    // Fallback: h2/h3 headings
    if (results.length < 3) {
      $('h2,h3').each((_, el) => {
        const name = $(el).text().trim();
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        results.push({ name, venueName: 'Oxford Art Factory', category: 'music' });
      });
    }
    return results.slice(0, 15);
  } catch (err) { console.error('[Oxford Art Factory]', err.message); return []; }
}

async function fetchEnmoreTheatreDirect() {
  try {
    // Try Enmore's own website first
    for (const url of [
      'https://www.enmoretheatre.com.au/',
      'https://www.enmoretheatre.com.au/events',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Enmore Theatre', category: 'music' }));
    }
    // Fallback: search Moshtix for Enmore Theatre
    const html = await fetchHtml('https://www.moshtix.com.au/v2/search?q=enmore&state=NSW');
    return extractJsonLd(html).map(e => ({ ...e, venueName: e.venueName?.includes('Enmore') ? e.venueName : e.venueName })).filter(e => (e.venueName || '').toLowerCase().includes('enmore')).slice(0, 10);
  } catch (err) { console.error('[Enmore Direct]', err.message); return []; }
}

async function fetchMetroDirect() {
  try {
    for (const url of [
      'https://metrotheatre.com.au/',
      'https://metrotheatre.com.au/whats-on',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Metro Theatre', category: 'music' }));
      if (html) {
        const $ = cheerio.load(html);
        const results = [];
        const seen = new Set();
        $('h1,h2,h3,h4').each((_, el) => {
          const name = $(el).text().trim();
          const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || '';
          if (!isValidName(name) || seen.has(name)) return;
          seen.add(name);
          results.push({ name, venueName: 'Metro Theatre', category: 'music', url: href.startsWith('http') ? href : `https://metrotheatre.com.au${href}` });
        });
        if (results.length > 2) return results.slice(0, 15);
      }
    }
    return [];
  } catch (err) { console.error('[Metro Direct]', err.message); return []; }
}

async function fetchHordernDirect() {
  try {
    for (const url of [
      'https://hordernpavilion.com.au/',
      'https://hordernpavilion.com.au/events',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Hordern Pavilion', category: 'music' }));
    }
    // Moshtix search
    const html = await fetchHtml('https://www.moshtix.com.au/v2/search?q=hordern&state=NSW');
    return extractJsonLd(html).filter(e => (e.venueName || '').toLowerCase().includes('hordern')).slice(0, 8);
  } catch (err) { console.error('[Hordern Direct]', err.message); return []; }
}

async function fetchFactoryDirect() {
  try {
    const html = await fetchHtml('https://www.factorytheatre.com.au/?s&key=upcoming');
    if (!html) return [];
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Factory Theatre', category: 'culture' }));
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    $('a[href*="/event/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slug = href.match(/\/event\/([^/?#]+)/)?.[1];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const dateText = $(el).text().replace(/join wait list|cancelled|sold out/gi, '').trim();
      const dateMatch = dateText.match(/(MON|TUE|WED|THU|FRI|SAT|SUN)\s+\d+\s+\w+/i)?.[0] || '';
      results.push({ name, dateDisplay: dateMatch, venueName: 'Factory Theatre', category: 'culture', url: href.startsWith('http') ? href : `https://www.factorytheatre.com.au${href}` });
    });
    return results.slice(0, 15);
  } catch (err) { console.error('[Factory Direct]', err.message); return []; }
}

async function fetchGoodGodDirect() {
  try {
    for (const url of [
      'https://www.goodgod.com.au/',
      'https://www.goodgod.com.au/events',
      'https://goodgodgoodgod.com.au/',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Goodgod Small Club', category: 'music' }));
      const $ = cheerio.load(html);
      const results = scrapeHeadings($, url.replace(/\/$/, ''), 'Goodgod Small Club', { category: 'music' });
      if (results.length > 2) return results.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Goodgod Direct]', err.message); return []; }
}

async function fetchSweatItOutDirect() {
  try {
    for (const url of [
      'https://sweatitout.com.au/',
      'https://sweatitout.com.au/events',
      'https://www.sweatitout.com.au/',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'music' }));
      const $ = cheerio.load(html);
      const results = scrapeHeadings($, 'https://sweatitout.com.au', '', { category: 'music' });
      if (results.length > 2) return results.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Sweat It Out]', err.message); return []; }
}

async function fetchSecretSoundsDirect() {
  try {
    const html = await fetchHtml('https://www.secretsounds.com/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.secretsounds.com', '', { category: 'music' }).slice(0, 15);
  } catch (err) { console.error('[Secret Sounds Direct]', err.message); return []; }
}

async function fetchManningBar() {
  try {
    const html = await fetchHtml('https://www.manningbar.com/?s&key=upcoming');
    if (!html) return [];
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Manning Bar', category: 'music' }));
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    // Manning Bar / Factory Theatre use WordPress events plugin — links to /event/slug
    $('a[href*="/event/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slug = href.match(/\/event\/([^/?#]+)/)?.[1];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const dateText = $(el).text().replace(/join wait list|cancelled|sold out/gi, '').trim();
      const dateMatch = dateText.match(/(MON|TUE|WED|THU|FRI|SAT|SUN)\s+\d+\s+\w+/i)?.[0] || dateText;
      results.push({ name, dateDisplay: dateMatch, venueName: 'Manning Bar', category: 'music', url: href.startsWith('http') ? href : `https://www.manningbar.com${href}` });
    });
    return results.slice(0, 15);
  } catch (err) { console.error('[Manning Bar]', err.message); return []; }
}

async function fetchBaldFacedStag() {
  try {
    for (const url of ['https://www.baldfacedstag.com.au/events','https://www.baldfacedstag.com.au/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Bald Faced Stag', category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.baldfacedstag.com.au', 'Bald Faced Stag', { category: 'music' });
      if (r.length > 2) return r.slice(0, 12);
    }
    return [];
  } catch (err) { console.error('[Bald Faced Stag]', err.message); return []; }
}

async function fetchMarrickvilleBowlo() {
  try {
    for (const url of ['https://www.marrickvillebowlo.com.au/events','https://www.marrickvillebowlo.com.au/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Marrickville Bowlo', category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.marrickvillebowlo.com.au', 'Marrickville Bowlo', { category: 'music' });
      if (r.length > 2) return r.slice(0, 12);
    }
    return [];
  } catch (err) { console.error('[Marrickville Bowlo]', err.message); return []; }
}

async function fetchVanguardSydney() {
  try {
    const html = await fetchHtml('https://www.thevanguard.com.au/');
    if (!html) return [];
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'The Vanguard', category: 'music' }));
    // The Vanguard uses a custom layout — events appear as ALL-CAPS artist names near date strings
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    const datePattern = /(MON|TUE|WED|THU|FRI|SAT|SUN)\s+\d+\s+\w+/i;
    $('div,li,tr,section').each((_, el) => {
      const fullText = $(el).text().replace(/\s+/g, ' ').trim();
      if (!datePattern.test(fullText) || fullText.length > 400) return;
      const lines = fullText.split(/\s{3,}|\n/).map(l => l.trim()).filter(l => l.length > 3);
      const nameLine = lines.find(l => !datePattern.test(l) && l.length > 5 && l.length < 80 && !l.match(/^buy|^more|^ticket|^\$/i));
      if (!nameLine || seen.has(nameLine)) return;
      seen.add(nameLine);
      const dateMatch = fullText.match(datePattern)?.[0] || '';
      const href = $(el).find('a').first().attr('href') || '';
      results.push({ name: nameLine, dateDisplay: dateMatch, venueName: 'The Vanguard', category: 'music', url: href.startsWith('http') ? href : (href ? `https://www.thevanguard.com.au${href}` : '') });
    });
    return results.slice(0, 12);
  } catch (err) { console.error('[Vanguard]', err.message); return []; }
}

async function fetchLazybonesSydney() {
  try {
    for (const url of ['https://www.lazybones.com.au/', 'https://www.lazybones.com.au/shows', 'https://www.lazybones.com.au/events']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Lazybones Lounge', category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.lazybones.com.au', 'Lazybones Lounge', { category: 'music' });
      if (r.length > 2) return r.slice(0, 12);
    }
    return [];
  } catch (err) { console.error('[Lazybones]', err.message); return []; }
}

async function fetchOld505() {
  try {
    const html = await fetchHtml('https://old505.com/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Old 505 Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://old505.com', 'Old 505 Theatre', { category: 'culture' }).slice(0, 10);
  } catch (err) { console.error('[Old 505]', err.message); return []; }
}

async function fetchImperialHotel() {
  try {
    for (const url of ['https://imperialevents.com.au/', 'https://www.theimperial.com.au/whats-on']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Imperial Hotel Erskineville', category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, url, 'Imperial Hotel Erskineville', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Imperial Hotel]', err.message); return []; }
}

async function fetchAbercrombieBar() {
  try {
    for (const url of ['https://www.abercrombie.bar/', 'https://www.abercrombie.bar/events']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'The Abercrombie', category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.abercrombie.bar', 'The Abercrombie', { category: 'music' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Abercrombie Bar]', err.message); return []; }
}

async function fetchBrightonUpBar() {
  try {
    for (const url of ['https://www.brightonupbar.com.au/', 'https://www.brightonupbar.com.au/events']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Brighton Up Bar', category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.brightonupbar.com.au', 'Brighton Up Bar', { category: 'music' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Brighton Up Bar]', err.message); return []; }
}

async function fetchSofar() {
  try {
    const html = await fetchHtml('https://www.sofarsounds.com/sydney');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Sofar Sounds Sydney', category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://www.sofarsounds.com', 'Sofar Sounds Sydney', { category: 'music' }).slice(0, 10);
  } catch (err) { console.error('[Sofar]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MUSEUMS, GALLERIES & CULTURAL INSTITUTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAustralianMuseum() {
  try {
    for (const url of [
      'https://australian.museum/whats-on/',
      'https://australian.museum/visit/events/',
      'https://australian.museum/programs-events/',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Australian Museum', category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://australian.museum', 'Australian Museum', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 15);
    }
    return [];
  } catch (err) { console.error('[Australian Museum]', err.message); return []; }
}

async function fetchSydneyLivingMuseums() {
  try {
    const html = await fetchHtml('https://sydneylivingmuseums.com.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://sydneylivingmuseums.com.au', '', { category: 'culture' }).slice(0, 15);
  } catch (err) { console.error('[Sydney Living Museums]', err.message); return []; }
}

async function fetchTarongaZoo() {
  try {
    for (const url of [
      'https://taronga.org.au/sydney-zoo/whats-on',
      'https://taronga.org.au/events',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Taronga Zoo', category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://taronga.org.au', 'Taronga Zoo', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Taronga Zoo]', err.message); return []; }
}

async function fetchStateLibraryNSW() {
  try {
    for (const url of [
      'https://www.sl.nsw.gov.au/events',
      'https://www.sl.nsw.gov.au/whats-on',
    ]) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'State Library NSW', category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.sl.nsw.gov.au', 'State Library NSW', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[State Library NSW]', err.message); return []; }
}

async function fetchWhiteRabbitGallery() {
  try {
    const html = await fetchHtml('https://whiterabbitcollection.org/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'White Rabbit Gallery', category: 'art' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://whiterabbitcollection.org', 'White Rabbit Gallery', { category: 'art' }).slice(0, 8);
  } catch (err) { console.error('[White Rabbit Gallery]', err.message); return []; }
}

async function fetchCampbelltownArts() {
  try {
    for (const url of ['https://www.c-a-c.com.au/', 'https://www.c-a-c.com.au/events', 'https://campbelltownarts.com.au/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Campbelltown Arts Centre', category: 'art' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, url, 'Campbelltown Arts Centre', { category: 'art' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Campbelltown Arts]', err.message); return []; }
}

async function fetchCasulaArts() {
  try {
    for (const url of ['https://www.casulapowerhouse.com/whats-on', 'https://www.casulapowerhouse.com/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: 'Casula Powerhouse Arts Centre', category: 'art' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.casulapowerhouse.com', 'Casula Powerhouse Arts Centre', { category: 'art' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Casula Arts]', err.message); return []; }
}

async function fetchHazelhurst() {
  try {
    const html = await fetchHtml('https://hazelhurst.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Hazelhurst Arts Centre', category: 'art' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://hazelhurst.com.au', 'Hazelhurst Arts Centre', { category: 'art' }).slice(0, 10);
  } catch (err) { console.error('[Hazelhurst]', err.message); return []; }
}

async function fetchPenrithGallery() {
  try {
    const html = await fetchHtml('https://penrithregionalgallery.org/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Penrith Regional Gallery', category: 'art' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://penrithregionalgallery.org', 'Penrith Regional Gallery', { category: 'art' }).slice(0, 10);
  } catch (err) { console.error('[Penrith Gallery]', err.message); return []; }
}

async function fetchCentre4A() {
  try {
    for (const url of ['https://4a.com.au/programs/', 'https://4a.com.au/programs']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: '4A Centre for Contemporary Asian Art', category: 'art' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://4a.com.au', '4A Centre for Contemporary Asian Art', { category: 'art' });
      if (r.length > 2) return r.slice(0, 8);
    }
    return [];
  } catch (err) { console.error('[4A]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchMarrickvilleOrganicMarket() {
  try {
    const html = await fetchHtml('https://marrickvilleorganicmarket.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Marrickville Organic Market', venueName: 'Marrickville Organic Market', url: 'https://marrickvilleorganicmarket.com.au/', category: 'market', description: 'Weekly organic farmers market in Marrickville.' }];
  } catch (err) { console.error('[Marrickville Market]', err.message); return []; }
}

async function fetchKirribillMarkets() {
  try {
    const html = await fetchHtml('https://www.kirribillimarkets.com/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const r = scrapeHeadings($, 'https://www.kirribillimarkets.com', 'Kirribilli Markets', { category: 'market' });
    return r.length ? r.slice(0, 5) : [{ name: 'Kirribilli Markets', venueName: 'Kirribilli', url: 'https://www.kirribillimarkets.com/', category: 'market' }];
  } catch (err) { console.error('[Kirribilli Markets]', err.message); return []; }
}

async function fetchBalmainMarket() {
  try {
    const html = await fetchHtml('https://balmainmarket.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Balmain Market', venueName: 'St Andrews Church Balmain', url: 'https://balmainmarket.com.au/', category: 'market', description: 'Monthly market at St Andrews Church Balmain.' }];
  } catch (err) { console.error('[Balmain Market]', err.message); return []; }
}

async function fetchManlyMarkets() {
  try {
    const html = await fetchHtml('https://manlymarkets.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Manly Markets', venueName: 'Manly Beach', url: 'https://manlymarkets.com.au/', category: 'market' }];
  } catch (err) { console.error('[Manly Markets]', err.message); return []; }
}

async function fetchEveleighMarket() {
  try {
    const html = await fetchHtml('https://eveleigh.com.au/farmers-market/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Carriageworks Farmers Market', venueName: 'Eveleigh', url: 'https://eveleigh.com.au/farmers-market/', category: 'market', description: 'Weekly farmers market at Carriageworks Eveleigh.' }];
  } catch (err) { console.error('[Eveleigh Market]', err.message); return []; }
}

async function fetchRozelleMarkets() {
  try {
    const html = await fetchHtml('https://www.rozellemarkets.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Rozelle Collectors Market', venueName: 'Rozelle Public School', url: 'https://www.rozellemarkets.com.au/', category: 'market' }];
  } catch (err) { console.error('[Rozelle Markets]', err.message); return []; }
}

async function fetchOrangeGroveMarket() {
  try {
    const html = await fetchHtml('https://orangegrovemarkets.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    return [{ name: 'Orange Grove Organic Market', venueName: 'Leichhardt', url: 'https://orangegrovemarkets.com.au/', category: 'market' }];
  } catch (err) { console.error('[Orange Grove Market]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COUNCIL EVENT PAGES
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCouncilEvents(name, urls, suburb) {
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length > 1) return events.map(e => ({ ...e, suburb: e.suburb || suburb }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, new URL(url).origin, '', { suburb });
      if (r.length > 2) return r.slice(0, 15);
    } catch { }
  }
  return [];
}

async function fetchWaverleyCouncil() {
  return fetchCouncilEvents('Waverley Council', [
    'https://www.waverley.nsw.gov.au/community/events',
    'https://www.waverley.nsw.gov.au/community/events-2',
  ], 'Bondi');
}

async function fetchInnerWestCouncil() {
  return fetchCouncilEvents('Inner West Council', [
    'https://www.innerwest.nsw.gov.au/explore/whats-on',
    'https://www.innerwest.nsw.gov.au/explore/events',
  ], 'Inner West');
}

async function fetchNorthSydneyCouncil() {
  return fetchCouncilEvents('North Sydney Council', [
    'https://www.northsydney.nsw.gov.au/Whats-On',
    'https://www.northsydney.nsw.gov.au/community/events',
  ], 'North Sydney');
}

async function fetchWilloughbyCouncil() {
  return fetchCouncilEvents('Willoughby Council', [
    'https://www.willoughby.nsw.gov.au/Events',
    'https://www.willoughby.nsw.gov.au/events/whats-on',
  ], 'Chatswood');
}

async function fetchRandwickCouncil() {
  return fetchCouncilEvents('Randwick Council', [
    'https://www.randwick.nsw.gov.au/community/events-and-culture',
    'https://www.randwick.nsw.gov.au/community/events',
  ], 'Randwick');
}

async function fetchNorthernBeachesCouncil() {
  return fetchCouncilEvents('Northern Beaches Council', [
    'https://www.northernbeaches.nsw.gov.au/things-to-do/whats-on',
    'https://www.northernbeaches.nsw.gov.au/whats-on',
  ], 'Manly');
}

async function fetchParramattaCouncil() {
  return fetchCouncilEvents('City of Parramatta', [
    'https://www.cityofparramatta.nsw.gov.au/whats-on',
    'https://www.cityofparramatta.nsw.gov.au/community/whats-on',
  ], 'Parramatta');
}

async function fetchBaysideCouncil() {
  return fetchCouncilEvents('Bayside Council', [
    'https://www.bayside.nsw.gov.au/events',
    'https://www.bayside.nsw.gov.au/community/events',
  ], 'Botany');
}

async function fetchSutherlandCouncil() {
  return fetchCouncilEvents('Sutherland Shire Council', [
    'https://www.sutherlandshire.nsw.gov.au/Community/Events',
    'https://www.sutherlandshire.nsw.gov.au/events',
  ], 'Sutherland');
}

async function fetchKuringgaiCouncil() {
  return fetchCouncilEvents('Ku-ring-gai Council', [
    'https://www.kmc.nsw.gov.au/whats-on',
    'https://www.kmc.nsw.gov.au/community/events',
  ], 'Turramurra');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FESTIVALS & SPECIAL EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchSydneyFilmFestival() {
  try {
    for (const url of ['https://sff.com.au/program/', 'https://sff.com.au/', 'https://www.sff.org.au/program/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'film' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://sff.com.au', '', { category: 'film' });
      if (r.length > 2) return r.slice(0, 20);
    }
    return [];
  } catch (err) { console.error('[Sydney Film Festival]', err.message); return []; }
}

async function fetchSydneyComedyFestival() {
  try {
    for (const url of ['https://www.sydneycomedyfest.com.au/', 'https://www.sydneycomedyfest.com.au/shows/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.sydneycomedyfest.com.au', '', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 20);
    }
    return [];
  } catch (err) { console.error('[Sydney Comedy Festival]', err.message); return []; }
}

async function fetchSydneyFringe() {
  try {
    for (const url of ['https://sydneyfringe.com/', 'https://sydneyfringe.com/events/', 'https://sydneyfringefestival.com.au/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, url.replace(/\/$/, ''), '', { category: 'culture' });
      if (r.length > 2) return r.slice(0, 20);
    }
    return [];
  } catch (err) { console.error('[Sydney Fringe]', err.message); return []; }
}

async function fetchSculptureByTheSea() {
  try {
    const html = await fetchHtml('https://sculpturebythesea.com/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'art' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://sculpturebythesea.com', '', { category: 'art' }).slice(0, 10);
  } catch (err) { console.error('[Sculpture By The Sea]', err.message); return []; }
}

async function fetchNightNoodleMarkets() {
  try {
    for (const url of ['https://www.nightnoodlemarkets.com.au/', 'https://www.goodfoodmonth.com/sydney/night-noodle-markets/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'food' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, url, '', { category: 'food' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Night Noodle Markets]', err.message); return []; }
}

async function fetchRoarAndSnore() {
  try {
    const html = await fetchHtml('https://taronga.org.au/sydney-zoo/whats-on/roar-and-snore');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://taronga.org.au', 'Taronga Zoo', { category: 'culture' }).slice(0, 5);
  } catch (err) { console.error('[Roar and Snore]', err.message); return []; }
}

async function fetchLanewayFestival() {
  try {
    for (const url of ['https://lanewayfestival.com/', 'https://lanewayfestival.com/sydney/']) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: 'music' }));
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, url, '', { category: 'music' });
      if (r.length > 2) return r.slice(0, 10);
    }
    return [];
  } catch (err) { console.error('[Laneway Festival]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPORT & WELLNESS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCity2Surf() {
  try {
    const html = await fetchHtml('https://www.city2surf.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'sport' }));
    return [{ name: 'City2Surf', venueName: 'Hyde Park to Bondi', url: 'https://www.city2surf.com.au/', category: 'sport', description: 'Annual fun run from the city to Bondi Beach.' }];
  } catch (err) { console.error('[City2Surf]', err.message); return []; }
}

async function fetchSydneyRunning() {
  try {
    const html = await fetchHtml('https://sydneyrunningfestival.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'sport' }));
    return [{ name: 'Sydney Running Festival', venueName: 'Sydney CBD', url: 'https://sydneyrunningfestival.com.au/', category: 'sport' }];
  } catch (err) { console.error('[Sydney Running]', err.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NICHE / COMMUNITY
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchWeTeachMeExpanded() {
  try {
    const pages = [
      'https://www.weteachme.com/workshops?location=Sydney+NSW',
      'https://www.weteachme.com/classes/sydney',
      'https://www.weteachme.com/workshops/category/creative+arts?location=Sydney',
    ];
    for (const url of pages) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length > 2) return events.slice(0, 20);
    }
    return [];
  } catch (err) { console.error('[WeTeachMe Expanded]', err.message); return []; }
}

async function fetchDestinationNSWExpanded() {
  try {
    const urls = [
      'https://www.visitnsw.com/destinations/sydney/events',
      'https://www.visitnsw.com/events?destination=sydney',
    ];
    for (const url of urls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.slice(0, 20);
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, new URL(url).origin, '', { suburb: 'Sydney' });
      if (r.length > 3) return r.slice(0, 15);
    }
    return [];
  } catch (err) { console.error('[Destination NSW Expanded]', err.message); return []; }
}

async function fetchNSWGovExpanded() {
  try {
    const urls = [
      'https://www.nsw.gov.au/whats-on/events',
      'https://www.nsw.gov.au/whats-on/arts-and-culture',
    ];
    for (const url of urls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length > 2) return events.slice(0, 20);
      const $ = cheerio.load(html);
      const r = scrapeHeadings($, 'https://www.nsw.gov.au', '', {});
      if (r.length > 3) return r.slice(0, 15);
    }
    return [];
  } catch (err) { console.error('[NSW Gov Expanded]', err.message); return []; }
}

async function fetchDiscoverParramatta() {
  try {
    const html = await fetchHtml('https://discoverparramatta.com/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, suburb: 'Parramatta' }));
    const $ = cheerio.load(html || '');
    return scrapeHeadings($, 'https://discoverparramatta.com', '', { suburb: 'Parramatta' }).slice(0, 15);
  } catch (err) { console.error('[Discover Parramatta]', err.message); return []; }
}

async function fetchAirbnbExperiencesSydney() {
  try {
    // Airbnb experiences page
    const html = await fetchHtml('https://www.airbnb.com.au/s/Sydney--New-South-Wales--Australia/experiences');
    const events = extractJsonLd(html);
    if (events.length) return events.slice(0, 15);
    // Try Next.js data
    const m = (html || '').match(/__NEXT_DATA__.*?<\/script>/s);
    if (m) {
      try {
        const d = JSON.parse(m[1].replace('__NEXT_DATA__ type="application/json">', '').replace(/<\/script>/, ''));
        const results = d?.props?.pageProps?.experiences || [];
        return results.map(e => ({ name: e.name, url: `https://www.airbnb.com.au/experiences/${e.id}`, category: 'culture', description: e.description })).slice(0, 15);
      } catch { }
    }
    return [];
  } catch (err) { console.error('[Airbnb Experiences]', err.message); return []; }
}

async function fetchResidentAdvisorScrape() {
  try {
    // Scrape RA Sydney events page directly
    const html = await fetchHtml('https://ra.co/events/au/sydney', 14000);
    if (!html) return [];
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html);
    // RA renders with React — try to find event data in script tags
    const scripts = $('script').map((_, el) => $(el).html() || '').get();
    for (const script of scripts) {
      if (script.includes('"title"') && script.includes('"startTime"')) {
        try {
          const match = script.match(/"eventListings":\{"data":\[(.*?)\]\}/s);
          if (match) {
            const events = JSON.parse('[' + match[1] + ']');
            return events.map(e => ({ name: e.event?.title || e.listing?.title, startDate: e.event?.startTime, venueName: e.event?.venue?.name, url: `https://ra.co${e.event?.contentUrl || ''}`, category: 'music' })).filter(e => e.name);
          }
        } catch { }
      }
    }
    return [];
  } catch (err) { console.error('[RA Scrape]', err.message); return []; }
}

async function fetchDiceFmSydney() {
  try {
    // Try different Dice URLs
    const urls = [
      'https://dice.fm/sydney-au',
      'https://dice.fm/search?q=sydney+australia&genre=all',
      'https://api.dice.fm/events?city=Sydney&country_code=AU&page=1&per_page=30',
    ];
    for (const url of urls) {
      try {
        const html = await fetchHtml(url);
        if (!html) continue;
        const events = extractJsonLd(html);
        if (events.length) return events.map(e => ({ ...e, category: 'music' }));
        const $ = cheerio.load(html);
        const r = scrapeHeadings($, 'https://dice.fm', '', { category: 'music' });
        if (r.length > 2) return r.slice(0, 15);
      } catch { }
    }
    return [];
  } catch (err) { console.error('[Dice FM Sydney]', err.message); return []; }
}

// SOH — try more URL patterns
async function fetchSydneyOperaHouseExpanded() {
  try {
    const urls = [
      'https://www.sydneyoperahouse.com/whats-on',
      'https://www.sydneyoperahouse.com/jazz',
      'https://www.sydneyoperahouse.com/classical',
      'https://www.sydneyoperahouse.com/theatre-dance-circus',
    ];
    const results = [];
    const seen = new Set();
    for (const url of urls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      for (const e of events) {
        if (!seen.has(e.name)) { seen.add(e.name); results.push({ ...e, venueName: e.venueName || 'Sydney Opera House', category: 'culture' }); }
      }
      if (!events.length) {
        const $ = cheerio.load(html);
        $('h2,h3,h4').each((_, el) => {
          const name = $(el).text().trim();
          if (!isValidName(name) || seen.has(name)) return;
          seen.add(name);
          const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || '';
          results.push({ name, venueName: 'Sydney Opera House', category: 'culture', url: href.startsWith('http') ? href : `https://www.sydneyoperahouse.com${href}` });
        });
      }
    }
    return results.slice(0, 20);
  } catch (err) { console.error('[SOH Expanded]', err.message); return []; }
}

// Ticketek — scrape actual event listings page
async function fetchTicketekEvents() {
  try {
    const urls = [
      'https://premier.ticketek.com.au/shows/genre.aspx?c=city&ci=sydney',
      'https://www.ticketek.com.au/shows/genre.aspx?c=city&ci=sydney',
      'https://www.ticketek.com.au/all-shows/sydney',
    ];
    for (const url of urls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, category: e.category || 'culture' }));
      const $ = cheerio.load(html);
      const results = [];
      const seen = new Set();
      $('h2,h3,[class*="event"],[class*="show"]').each((_, el) => {
        const name = $(el).text().trim();
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || '';
        results.push({ name, url: href.startsWith('http') ? href : `https://premier.ticketek.com.au${href}`, category: 'culture' });
      });
      if (results.length > 3) return results.slice(0, 20);
    }
    return [];
  } catch (err) { console.error('[Ticketek Events]', err.message); return []; }
}

// MCA — improved scraper
async function fetchMCAExpanded() {
  try {
    const urls = [
      'https://www.mca.com.au/whats-on/',
      'https://www.mca.com.au/whats-on/exhibitions/',
      'https://www.mca.com.au/whats-on/events/',
    ];
    const results = [];
    const seen = new Set();
    for (const url of urls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      for (const e of events) {
        if (!seen.has(e.name)) { seen.add(e.name); results.push({ ...e, venueName: e.venueName || 'MCA Sydney', category: 'art' }); }
      }
      if (!events.length) {
        const $ = cheerio.load(html);
        $('h2,h3,[class*="title"]').each((_, el) => {
          const name = $(el).text().trim();
          if (!isValidName(name) || seen.has(name)) return;
          seen.add(name);
          const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || '';
          results.push({ name, venueName: 'MCA Sydney', category: 'art', url: href.startsWith('http') ? href : `https://www.mca.com.au${href}` });
        });
      }
    }
    return results.slice(0, 15);
  } catch (err) { console.error('[MCA Expanded]', err.message); return []; }
}

module.exports = {
  // Booking platforms
  fetchMoshtixAllPages,
  fetchOztix,
  fetchStickyTickets,
  fetchHumanitixSydney,
  fetchTryBookingSydney,
  fetchEventbriteSydney,
  fetchEventfindaSydney,
  fetchPeatixSydney,
  // Performing arts
  fetchBelvoir,
  fetchSydneyTheatreCompany,
  fetchGriffithTheatre,
  fetchEnsembleTheatre,
  fetchHayesTheatre,
  fetchStateTheatre,
  fetchOldFitzroyTheatre,
  fetchBangarra,
  fetchSydneySymphony,
  fetchAustralianChamberOrchestra,
  fetchMonkeyBaa,
  fetchConcourse,
  // Music venues
  fetchOxfordArtFactory,
  fetchEnmoreTheatreDirect,
  fetchMetroDirect,
  fetchHordernDirect,
  fetchFactoryDirect,
  fetchGoodGodDirect,
  fetchSweatItOutDirect,
  fetchSecretSoundsDirect,
  fetchManningBar,
  fetchBaldFacedStag,
  fetchMarrickvilleBowlo,
  fetchVanguardSydney,
  fetchLazybonesSydney,
  fetchOld505,
  fetchImperialHotel,
  fetchAbercrombieBar,
  fetchBrightonUpBar,
  fetchSofar,
  // Museums & galleries
  fetchAustralianMuseum,
  fetchSydneyLivingMuseums,
  fetchTarongaZoo,
  fetchStateLibraryNSW,
  fetchWhiteRabbitGallery,
  fetchCampbelltownArts,
  fetchCasulaArts,
  fetchHazelhurst,
  fetchPenrithGallery,
  fetchCentre4A,
  // Markets
  fetchMarrickvilleOrganicMarket,
  fetchKirribillMarkets,
  fetchBalmainMarket,
  fetchManlyMarkets,
  fetchEveleighMarket,
  fetchRozelleMarkets,
  fetchOrangeGroveMarket,
  // Councils
  fetchWaverleyCouncil,
  fetchInnerWestCouncil,
  fetchNorthSydneyCouncil,
  fetchWilloughbyCouncil,
  fetchRandwickCouncil,
  fetchNorthernBeachesCouncil,
  fetchParramattaCouncil,
  fetchBaysideCouncil,
  fetchSutherlandCouncil,
  fetchKuringgaiCouncil,
  // Festivals
  fetchSydneyFilmFestival,
  fetchSydneyComedyFestival,
  fetchSydneyFringe,
  fetchSculptureByTheSea,
  fetchNightNoodleMarkets,
  fetchRoarAndSnore,
  fetchLanewayFestival,
  // Sport
  fetchCity2Surf,
  fetchSydneyRunning,
  // Other
  fetchWeTeachMeExpanded,
  fetchDestinationNSWExpanded,
  fetchNSWGovExpanded,
  fetchDiscoverParramatta,
  fetchAirbnbExperiencesSydney,
  fetchResidentAdvisorScrape,
  fetchDiceFmSydney,
  fetchSydneyOperaHouseExpanded,
  fetchTicketekEvents,
  fetchMCAExpanded,
};
