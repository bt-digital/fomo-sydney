const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const EVENT_TYPES = new Set(['Event','MusicEvent','TheaterEvent','Festival','SocialEvent','SportsEvent','EducationEvent','ExhibitionEvent','ComedyEvent','DanceEvent','ScreeningEvent','VisualArtsEvent','LiteraryEvent','FoodEvent','SaleEvent']);

// Generic nav/UI text to ignore when scraping names
const NAV_BLOCKLIST = new Set([
  'today','this weekend','this week','see all','load more','read more','more info','view more',
  'find out more','buy tickets','get tickets','book now','learn more','newly added','upcoming events',
  'search','all events','whats on',"what's on","what’s on",'home','back','next','previous','menu','close','open',
  'events','shows','tickets','subscribe','sign up','newsletter','follow us','showing results',
  'get ticketsmore info','filter','sort by','results','2026 highlights','highlights','featured',
  'latest','popular','recommended','explore','discover','exhibitions','contemporary music',
  'classical music','comedy, circus and magic','musical theatre & cabaret','kids & families',
  'jazz','theatre','dance','film','music','art','culture','food & drink','markets','sport',
  'wellness','education','tech','book a private event','book a private event with paint your world',
  "what's on",'whats-on','venue hire','plan your visit','about us','contact us','buy now',
  'view all','show all','see more','read all','all shows','all events','all exhibitions',
  'browse all','view programme','full programme','programme','schedule','lineup','line-up',
  'facebook','instagram','youtube','twitter','tiktok','linkedin','spotify','soundcloud',
  'sign in','log in','login','register','account','cart','checkout','privacy policy','terms',
]);

const NAV_BLOCKLIST_PREFIXES = [
  'book a private event',
  'book your private',
  'hire this venue',
  'private hire',
];

function isValidName(name) {
  if (!name) return false;
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 5 || clean.length > 200) return false;
  const lower = clean.toLowerCase();
  if (NAV_BLOCKLIST.has(lower)) return false;
  if (NAV_BLOCKLIST_PREFIXES.some(p => lower.startsWith(p))) return false;
  // Reject strings that are mostly non-alpha (nav icons, prices, etc.)
  const alphaRatio = (clean.match(/[a-zA-Z]/g) || []).length / clean.length;
  return alphaRatio > 0.4;
}

async function fetchHtml(url, timeout = 12000) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout });
    return res.data;
  } catch { return null; }
}

// Robust JSON-LD extractor — handles @graph arrays and all Event subtypes
function extractJsonLd(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const events = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      // Flatten: handle top-level array, @graph, or single object
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data['@graph']) {
        items = Array.isArray(data['@graph']) ? data['@graph'] : [data['@graph']];
      } else {
        items = [data];
      }

      for (const item of items) {
        const type = item['@type'];
        const typeStr = Array.isArray(type) ? type.join(',') : (type || '');
        const isEvent = [...EVENT_TYPES].some(t => typeStr.includes(t));
        if (!isEvent || !item.name) continue;

        const loc = item.location || {};
        const addr = loc.address || {};
        events.push({
          name: item.name,
          description: (item.description || '').slice(0, 500),
          startDate: item.startDate,
          endDate: item.endDate,
          url: item.url,
          imageUrl: typeof item.image === 'string' ? item.image : item.image?.url,
          venueName: loc.name || '',
          address: typeof addr === 'string' ? addr : (addr.streetAddress || addr['@value'] || ''),
          organizer: Array.isArray(item.organizer) ? item.organizer[0]?.name : item.organizer?.name,
          isFree: item.isAccessibleForFree,
          price: item.offers?.price != null ? String(item.offers.price) : null,
        });
      }
    } catch { }
  });
  return events;
}

// Generic scraper — tries JSON-LD first, then falls back to CSS selectors
function scrapeCards($, selectors) {
  const results = [];
  const seen = new Set();
  const sel = selectors.join(',');
  $(sel).each((_, el) => {
    const name = $(el).find('h1,h2,h3,h4,[class*="title"],[class*="name"],[class*="heading"]').first().text().trim();
    if (!isValidName(name) || seen.has(name)) return;
    seen.add(name);
    const date = $(el).find('time,[class*="date"],[class*="when"],[class*="start"]').first().text().trim() ||
                 $(el).find('[datetime]').first().attr('datetime') || '';
    const venue = $(el).find('[class*="venue"],[class*="location"],[class*="place"]').first().text().trim();
    const href = $(el).find('a').first().attr('href') || $(el).closest('a').attr('href') || '';
    const img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';
    results.push({ name, dateDisplay: date, venueName: venue, url: href, imageUrl: img });
  });
  return results;
}

// ─── 11. RESIDENT ADVISOR ─────────────────────────────────────────────────────
async function fetchResidentAdvisor() {
  try {
    // RA GraphQL — Sydney area ID is 28
    const query = `{ eventListings(filters: {areas: {id: 28}, listingDate: {gte: "${new Date().toISOString().slice(0,10)}"}}, pageSize: 50, orderBy: {name: ATTENDING, value: DESC}) { data { id listing { title startTime endTime venue { name } artists { name } contentUrl } } } }`;
    const res = await axios.post('https://ra.co/graphql', { query }, {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Referer': 'https://ra.co/', 'Origin': 'https://ra.co' },
      timeout: 12000,
    });
    return (res.data?.data?.eventListings?.data || []).map(e => ({
      name: e.listing.title,
      startDate: e.listing.startTime,
      endDate: e.listing.endTime,
      url: `https://ra.co${e.listing.contentUrl}`,
      venueName: e.listing.venue?.name,
      organizer: (e.listing.artists || []).map(a => a.name).join(', '),
      category: 'music',
    }));
  } catch (err) {
    console.error('[Resident Advisor]', err.message);
    return [];
  }
}

// ─── 12. DICE.FM ──────────────────────────────────────────────────────────────
async function fetchDice() {
  try {
    // Dice has an undocumented JSON API
    const res = await axios.get('https://api.dice.fm/events', {
      headers: { ...HEADERS, 'x-api-key': 'dice' },
      params: { page: 1, per_page: 50, country_code: 'AU', city: 'Sydney', types: 'linkout,event' },
      timeout: 10000,
    });
    const events = res.data?.payload?.events || res.data?.data || [];
    if (events.length) {
      return events.map(e => ({
        name: e.name,
        startDate: e.date,
        url: e.url || `https://dice.fm/event/${e.id}`,
        imageUrl: e.event_images?.portrait,
        venueName: e.venue?.name,
        address: e.venue?.location,
        category: 'music',
        isFree: e.min_price === 0,
        price: e.min_price != null ? `$${e.min_price}` : null,
      }));
    }
    // Fallback: scrape browse page
    const html = await fetchHtml('https://dice.fm/browse?q=sydney+australia');
    const evs = extractJsonLd(html);
    if (evs.length) return evs;
    const ch = cheerio.load(html || '');
    return scrapeCards(ch, ['[data-testid*="event"]', '[class*="EventCard"]', '[class*="event-card"]', 'article']).slice(0, 30);
  } catch (err) {
    console.error('[Dice.fm]', err.message);
    return [];
  }
}

// ─── 13. TIMEOUT SYDNEY ───────────────────────────────────────────────────────
async function fetchTimeOut() {
  try {
    // TimeOut is a React SPA — article listings on category pages render server-side h3s
    const urls = [
      'https://www.timeout.com/sydney/music',
      'https://www.timeout.com/sydney/things-to-do',
      'https://www.timeout.com/sydney/film',
    ];
    const results = [];
    const seen = new Set();
    for (const url of urls) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) { results.push(...events); continue; }
      const $ = cheerio.load(html || '');
      $('article,h3').each((_, el) => {
        const name = el.tagName === 'h3' ? $(el).text().trim() : $(el).find('h3,h2').first().text().trim();
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        const href = el.tagName === 'h3'
          ? ($(el).find('a').attr('href') || $(el).closest('a').attr('href') || $(el).next('a').attr('href') || '')
          : $(el).find('a').first().attr('href') || '';
        const date = $(el).find('time,[class*="date"]').first().text().trim();
        results.push({ name, dateDisplay: date, url: href ? (href.startsWith('http') ? href : `https://www.timeout.com${href}`) : '' });
      });
    }
    return results.slice(0, 40);
  } catch (err) {
    console.error('[TimeOut Sydney]', err.message);
    return [];
  }
}

// ─── 14. BROADSHEET SYDNEY ────────────────────────────────────────────────────
async function fetchBroadsheet() {
  try {
    for (const url of [
      'https://www.broadsheet.com.au/sydney/event-guide',
      'https://www.broadsheet.com.au/sydney/event-guide/article/this-week-sydney',
      'https://www.broadsheet.com.au/sydney',
    ]) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events.filter(e => isValidName(e.name));
      const $ = cheerio.load(html || '');
      const results = [];
      const seen = new Set();
      $('[class*="card"],[class*="Card"],[class*="article"],[class*="story"],[class*="item"]').each((_, el) => {
        const name = $(el).find('h2,h3,h4,[class*="title"],[class*="heading"]').first().text().trim();
        const date = $(el).find('time,[class*="date"]').first().text().trim();
        const href = $(el).find('a').first().attr('href');
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        results.push({ name, dateDisplay: date, url: href ? `https://www.broadsheet.com.au${href}` : '' });
      });
      if (results.length > 3) return results.slice(0, 30);
    }
    return [];
  } catch (err) {
    console.error('[Broadsheet]', err.message);
    return [];
  }
}

// ─── 15. CONCRETE PLAYGROUND ──────────────────────────────────────────────────
async function fetchConcretePlayground() {
  try {
    const html = await fetchHtml('https://concreteplayground.com/sydney/events/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article', '[class*="event"]', '[class*="card"]', '[class*="item"]']).slice(0, 30)
      .map(e => ({ ...e, url: e.url?.startsWith('http') ? e.url : `https://concreteplayground.com${e.url || ''}` }));
  } catch (err) {
    console.error('[Concrete Playground]', err.message);
    return [];
  }
}

// ─── 16. SYDNEY OPERA HOUSE ───────────────────────────────────────────────────
async function fetchSydneyOperaHouse() {
  try {
    // SOH whats-on page is Drupal — events are in individual category pages
    // Scrape each genre sub-page which has static HTML listings
    const categoryUrls = [
      'https://www.sydneyoperahouse.com/contemporary-music',
      'https://www.sydneyoperahouse.com/classical-music',
      'https://www.sydneyoperahouse.com/comedy-circus-magic',
      'https://www.sydneyoperahouse.com/musical-theatre-cabaret',
    ];
    const results = [];
    const seen = new Set();
    for (const url of categoryUrls) {
      const html = await fetchHtml(url);
      if (!html) continue;
      const events = extractJsonLd(html);
      if (events.length) {
        events.forEach(e => { if (!seen.has(e.name)) { seen.add(e.name); results.push({ ...e, venueName: e.venueName || 'Sydney Opera House', category: 'culture' }); } });
        continue;
      }
      const $ = cheerio.load(html);
      $('[class*="soh-card"],[class*="views-row"],article').each((_, el) => {
        const name = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim();
        const date = $(el).find('time,[class*="date"]').first().text().trim();
        const href = $(el).find('a').first().attr('href') || '';
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        results.push({ name, dateDisplay: date, venueName: 'Sydney Opera House', url: href.startsWith('http') ? href : `https://www.sydneyoperahouse.com${href}`, category: 'culture' });
      });
      // Link fallback — grab any internal event page links
      if (!results.length) {
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const name = $(el).attr('title') || $(el).text().trim();
          if (!isValidName(name) || seen.has(name) || !href.includes('sydneyoperahouse')) return;
          seen.add(name);
          results.push({ name, venueName: 'Sydney Opera House', url: href, category: 'culture' });
        });
      }
    }
    return results.slice(0, 20);
  } catch (err) {
    console.error('[Sydney Opera House]', err.message);
    return [];
  }
}

// ─── 17. ART GALLERY OF NSW ───────────────────────────────────────────────────
async function fetchAGNSW() {
  try {
    const html = await fetchHtml('https://www.artgallery.nsw.gov.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Art Gallery of NSW', category: 'art' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('article,[class*="event"],[class*="card"],[class*="listing"],[class*="item"]').each((_, el) => {
      const name = $(el).find('h2,h3,[class*="title"]').first().text().trim().replace(/\s+/g, ' ');
      const date = $(el).find('time,[class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, dateDisplay: date, venueName: 'Art Gallery of NSW', url: href ? `https://www.artgallery.nsw.gov.au${href}` : '', category: 'art' });
    });
    return results.slice(0, 20);
  } catch (err) {
    console.error('[AGNSW]', err.message);
    return [];
  }
}

// ─── 18. MCA SYDNEY ───────────────────────────────────────────────────────────
async function fetchMCA() {
  try {
    // MCA is a React SPA — scrape the calendar page which has static anchor links
    const html = await fetchHtml('https://www.mca.com.au/events-programs/calendar/');
    if (html) {
      const events = extractJsonLd(html);
      if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Museum of Contemporary Art', category: 'art' }));
    }
    // Fallback: scrape the whats-on page for internal links to exhibition/event pages
    const html2 = await fetchHtml('https://www.mca.com.au/whats-on/');
    const $ = cheerio.load(html2 || '');
    const results = [];
    const seen = new Set();
    $('a[href*="/exhibitions/"],a[href*="/events/"],a[href*="/programs/"],a[href*="/whats-on/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const name = $(el).attr('title') || $(el).text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, venueName: 'Museum of Contemporary Art', url: href.startsWith('http') ? href : `https://www.mca.com.au${href}`, category: 'art' });
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[MCA]', err.message);
    return [];
  }
}

// ─── 19. WHAT'S ON CITY OF SYDNEY ────────────────────────────────────────────
async function fetchCityOfSydney() {
  try {
    const html = await fetchHtml('https://whatson.cityofsydney.nsw.gov.au/');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    // Extract event links — /events/ paths
    const seen = new Set();
    $('a[href*="/events/"]').each((_, el) => {
      const href = $(el).attr('href');
      const name = $(el).attr('title') || $(el).text().trim();
      if (!name || name.length < 4 || seen.has(href)) return;
      seen.add(href);
      const date = $(el).closest('[class*="card"],[class*="item"],article').find('time,[class*="date"]').first().text().trim();
      const img = $(el).find('img').first().attr('src') || '';
      results.push({ name, dateDisplay: date, url: href.startsWith('http') ? href : `https://whatson.cityofsydney.nsw.gov.au${href}`, imageUrl: img });
    });
    return results.slice(0, 30);
  } catch (err) {
    console.error('[City of Sydney]', err.message);
    return [];
  }
}

// ─── 20. DESTINATION NSW ──────────────────────────────────────────────────────
async function fetchDestinationNSW() {
  try {
    const html = await fetchHtml('https://www.visitnsw.com/destinations/sydney/events');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article', '[class*="event"]', '[class*="card"]', '[class*="listing"]'])
      .slice(0, 20)
      .map(e => ({ ...e, url: e.url?.startsWith('http') ? e.url : `https://www.visitnsw.com${e.url || ''}` }));
  } catch (err) {
    console.error('[Destination NSW]', err.message);
    return [];
  }
}

// ─── 21. EVENTFINDA ───────────────────────────────────────────────────────────
async function fetchEventfinda() {
  try {
    const html = await fetchHtml('https://www.eventfinda.com.au/whatson/events/sydney');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    $('.listings-events .card, [class*="event"] .card, .cards .card').each((_, el) => {
      const name = $(el).find('h2,h3,h4,.card-title,[class*="title"]').first().text().trim();
      const date = $(el).find('time,.date,[class*="date"]').first().text().trim();
      const venue = $(el).find('[class*="venue"],[class*="location"]').first().text().trim();
      const href = $(el).find('a').first().attr('href') || $(el).closest('a').attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: venue, url: href ? `https://www.eventfinda.com.au${href}` : '' });
      }
    });
    return results.slice(0, 30);
  } catch (err) {
    console.error('[Eventfinda]', err.message);
    return [];
  }
}

// ─── 22. TRYBOOKING ───────────────────────────────────────────────────────────
async function fetchTryBooking() {
  try {
    const html = await fetchHtml('https://www.trybooking.com/au/events?q=sydney&sort=date');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="event"]', 'article', '.result-item']).slice(0, 20)
      .map(e => ({ ...e, url: e.url ? `https://www.trybooking.com${e.url}` : '' }));
  } catch (err) {
    console.error('[TryBooking]', err.message);
    return [];
  }
}

// ─── 23. MOSHTIX ──────────────────────────────────────────────────────────────
async function fetchMoshtix() {
  try {
    const html = await fetchHtml('https://www.moshtix.com.au/v2/search?query=&state=NSW&genre=0');
    // Moshtix has rich JSON-LD — use it
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: e.category || 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['.searchresult', '[class*="event"]', '.search-result']).slice(0, 20)
      .map(e => ({ ...e, category: 'music', url: e.url ? `https://www.moshtix.com.au${e.url}` : '' }));
  } catch (err) {
    console.error('[Moshtix]', err.message);
    return [];
  }
}

// ─── 24. PEATIX ───────────────────────────────────────────────────────────────
async function fetchPeatix() {
  try {
    const html = await fetchHtml('https://peatix.com/search?q=sydney&country=AU');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="event"]', 'article', '[class*="card"]']).slice(0, 20)
      .map(e => ({ ...e, url: e.url?.startsWith('http') ? e.url : `https://peatix.com${e.url || ''}` }));
  } catch (err) {
    console.error('[Peatix]', err.message);
    return [];
  }
}

// ─── 25. WETEACHME ────────────────────────────────────────────────────────────
async function fetchWeTeachMe() {
  try {
    const html = await fetchHtml('https://www.weteachme.com/s?near=Sydney%2C+NSW');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'education' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article', '[class*="class"]', '[class*="workshop"]', '[class*="card"]']).slice(0, 20)
      .map(e => ({ ...e, category: 'education', url: e.url?.startsWith('http') ? e.url : `https://www.weteachme.com${e.url || ''}` }));
  } catch (err) {
    console.error('[WeTeachMe]', err.message);
    return [];
  }
}

// ─── 26. CARRIAGEWORKS ────────────────────────────────────────────────────────
async function fetchCarriageworks() {
  try {
    // Correct URL is /whats-on not /events/
    const html = await fetchHtml('https://carriageworks.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Carriageworks, Eveleigh' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('[class*="listing"] [class*="result"], [class*="listing__item"], article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim();
      const date = $(el).find('time,[class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, dateDisplay: date, venueName: 'Carriageworks, Eveleigh', url: href ? `https://carriageworks.com.au${href}` : '' });
    });
    // Fallback: links to /event/ or /whats-on/ subpages
    if (!results.length) {
      $('a[href*="/event"],a[href*="/whats-on/"]').each((_, el) => {
        const name = $(el).text().trim() || $(el).attr('title');
        if (!isValidName(name) || seen.has(name)) return;
        seen.add(name);
        results.push({ name, venueName: 'Carriageworks, Eveleigh', url: `https://carriageworks.com.au${$(el).attr('href')}` });
      });
    }
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Carriageworks]', err.message);
    return [];
  }
}

// ─── 27. SEYMOUR CENTRE ───────────────────────────────────────────────────────
async function fetchSeymourCentre() {
  try {
    // Seymour uses /what-s-on/all-events/ with .tile cards
    const html = await fetchHtml('https://seymourcentre.com/what-s-on/all-events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Seymour Centre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    $('.tile').each((_, el) => {
      // tile structure: category label, then h2/h3 event name, then date
      const allText = $(el).text().replace(/\s+/g, ' ').trim();
      const name = $(el).find('h2,h3,h4,[class*="title"],strong').first().text().trim()
        || $(el).find('a').first().text().trim();
      const href = $(el).find('a').first().attr('href') || '';
      const date = $(el).find('time,[class*="date"]').first().text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, dateDisplay: date, venueName: 'Seymour Centre', url: href?.startsWith('http') ? href : `https://seymourcentre.com${href}`, category: 'culture' });
    });
    // Fallback: extract from tile text — the name is usually the first capitalised phrase
    if (!results.length) {
      $('.tile').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        const href = $(el).find('a').first().attr('href') || '';
        const match = text.match(/^[A-Z][^a-z]{0,3}[A-Z\s'&:-]+/);
        const name = match ? match[0].trim() : text.slice(0, 60).trim();
        if (isValidName(name) && !seen.has(name)) {
          seen.add(name);
          results.push({ name, venueName: 'Seymour Centre', url: href?.startsWith('http') ? href : `https://seymourcentre.com${href}`, category: 'culture' });
        }
      });
    }
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Seymour Centre]', err.message);
    return [];
  }
}

// ─── 28. THE MUSIC (themusic.com.au) ──────────────────────────────────────────
async function fetchTheMusic() {
  try {
    const html = await fetchHtml('https://themusic.com.au/gig-guide/sydney/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="event"],[class*="gig"],article,[class*="listing"]']).slice(0, 20)
      .map(e => ({ ...e, category: 'music', url: e.url?.startsWith('http') ? e.url : `https://themusic.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[The Music]', err.message);
    return [];
  }
}

// ─── 29. NSW GOVERNMENT WHAT'S ON ─────────────────────────────────────────────
async function fetchNSWGov() {
  try {
    const html = await fetchHtml('https://www.nsw.gov.au/things-to-do/sydney-events');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="event"],article,.nsw-card,[class*="card"]']).slice(0, 20)
      .map(e => ({ ...e, url: e.url?.startsWith('http') ? e.url : `https://www.nsw.gov.au${e.url || ''}` }));
  } catch (err) {
    console.error('[NSW Gov]', err.message);
    return [];
  }
}

// ─── 30. AIRBNB EXPERIENCES ───────────────────────────────────────────────────
async function fetchAirbnbExperiences() {
  try {
    const html = await fetchHtml('https://www.airbnb.com.au/s/Sydney--New-South-Wales/experiences');
    const $ = cheerio.load(html || '');
    const results = [];
    $('[data-testid="card-container"],[class*="cardCover"],article,[data-testid*="listing"]').each((_, el) => {
      const name = $(el).find('[data-testid="listing-card-title"],h3,h4,[class*="title"]').first().text().trim();
      const price = $(el).find('[data-testid="price-availability-row"],[class*="price"]').first().text().trim();
      const href = $(el).closest('a').attr('href') || $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, price, url: href ? `https://www.airbnb.com.au${href}` : '', category: 'education' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Airbnb Experiences]', err.message);
    return [];
  }
}

// ─── 31. TICKETEK ─────────────────────────────────────────────────────────────
async function fetchTicketek() {
  try {
    const html = await fetchHtml('https://premier.ticketek.com.au/shows/genre.aspx?c=CONC&region=NSW');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="show"],[class*="event"],.show-listing']).slice(0, 20)
      .map(e => ({ ...e, url: e.url?.startsWith('http') ? e.url : `https://premier.ticketek.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Ticketek]', err.message);
    return [];
  }
}

// ─── 32. SKIDDLE ──────────────────────────────────────────────────────────────
async function fetchSkiddle() {
  if (!process.env.SKIDDLE_KEY) return [];
  try {
    const res = await axios.get('https://www.skiddle.com/api/v1/events/search/', {
      params: { api_key: process.env.SKIDDLE_KEY, latitude: -33.8688, longitude: 151.2093, radius: 50, order: 'trending', limit: 30 },
    });
    return (res.data?.results || []).map(e => ({
      name: e.eventname, startDate: e.date, url: e.link,
      imageUrl: e.largeimageurl, venueName: e.venue?.name, address: e.venue?.address,
      category: 'music', talkingCount: e.goingcount || 0,
    }));
  } catch (err) {
    console.error('[Skiddle]', err.message);
    return [];
  }
}

// ─── 33. SYDNEY FESTIVAL ──────────────────────────────────────────────────────
async function fetchSydneyFestival() {
  try {
    const html = await fetchHtml('https://www.sydneyfestival.org.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="show"],[class*="card"]']).slice(0, 20)
      .map(e => ({ ...e, category: 'culture', url: e.url?.startsWith('http') ? e.url : `https://www.sydneyfestival.org.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Sydney Festival]', err.message);
    return [];
  }
}

// ─── 34. SYDNEY MARDI GRAS ────────────────────────────────────────────────────
async function fetchMardiGras() {
  try {
    const html = await fetchHtml('https://www.mardigras.org.au/program');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="program"],[class*="card"]']).slice(0, 15)
      .map(e => ({ ...e, category: 'culture', url: e.url?.startsWith('http') ? e.url : `https://www.mardigras.org.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Mardi Gras]', err.message);
    return [];
  }
}

// ─── 35. SXSW SYDNEY ──────────────────────────────────────────────────────────
async function fetchSXSWSydney() {
  try {
    const html = await fetchHtml('https://www.sxswsydney.com/schedule');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'culture' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="session"],[class*="event"],[class*="card"]']).slice(0, 20)
      .map(e => ({ ...e, category: 'culture', url: e.url?.startsWith('http') ? e.url : `https://www.sxswsydney.com${e.url || ''}` }));
  } catch (err) {
    console.error('[SXSW Sydney]', err.message);
    return [];
  }
}

// ─── 36. VIVID SYDNEY ─────────────────────────────────────────────────────────
async function fetchVividSydney() {
  try {
    const html = await fetchHtml('https://www.vividsydney.com/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'art' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="card"],[class*="tile"]']).slice(0, 20)
      .map(e => ({ ...e, category: 'art', url: e.url?.startsWith('http') ? e.url : `https://www.vividsydney.com${e.url || ''}` }));
  } catch (err) {
    console.error('[Vivid Sydney]', err.message);
    return [];
  }
}

// ─── 37. FUZZY EVENTS ─────────────────────────────────────────────────────────
async function fetchFuzzy() {
  try {
    const html = await fetchHtml('https://fuzzy.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="card"]']).slice(0, 15)
      .map(e => ({ ...e, category: 'music', url: e.url?.startsWith('http') ? e.url : `https://fuzzy.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Fuzzy Events]', err.message);
    return [];
  }
}

// ─── 38. ASTRAL PEOPLE ────────────────────────────────────────────────────────
async function fetchAstralPeople() {
  try {
    const html = await fetchHtml('https://astralpeople.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="card"]']).slice(0, 15)
      .map(e => ({ ...e, category: 'music', url: e.url?.startsWith('http') ? e.url : `https://astralpeople.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Astral People]', err.message);
    return [];
  }
}

// ─── 39. SWEAT IT OUT ─────────────────────────────────────────────────────────
async function fetchSweatItOut() {
  try {
    const html = await fetchHtml('https://sweatitout.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="card"]']).slice(0, 15)
      .map(e => ({ ...e, category: 'music', url: e.url?.startsWith('http') ? e.url : `https://sweatitout.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Sweat It Out]', err.message);
    return [];
  }
}

// ─── 40. GOODGOD SMALL CLUB ───────────────────────────────────────────────────
async function fetchGoodGod() {
  try {
    const html = await fetchHtml('https://goodgodgoodgod.com.au/') || await fetchHtml('https://goodgoodgood.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music', venueName: 'Goodgod Small Club' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="gig"]']).slice(0, 10)
      .map(e => ({ ...e, category: 'music', venueName: 'Goodgod Small Club' }));
  } catch (err) {
    console.error('[Goodgod]', err.message);
    return [];
  }
}

// ─── 41. SYDNEY TOWN HALL ─────────────────────────────────────────────────────
async function fetchTownHall() {
  try {
    const html = await fetchHtml('https://www.sydneytownhall.com.au/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Sydney Town Hall' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="card"]']).slice(0, 10)
      .map(e => ({ ...e, venueName: 'Sydney Town Hall', url: e.url?.startsWith('http') ? e.url : `https://www.sydneytownhall.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Sydney Town Hall]', err.message);
    return [];
  }
}

// ─── 42. ENMORE THEATRE ───────────────────────────────────────────────────────
async function fetchEnmore() {
  try {
    // Enmore Theatre ticketing is handled via Ticketmaster — scrape their listing
    const html = await fetchHtml('https://www.ticketmaster.com.au/venue/enmore-theatre-tickets/6053');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Enmore Theatre', category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['[class*="event"],[class*="EventCard"],article']).slice(0, 15)
      .map(e => ({ ...e, venueName: 'Enmore Theatre', category: 'music', url: e.url?.startsWith('http') ? e.url : `https://www.ticketmaster.com.au${e.url || ''}` }));
  } catch (err) {
    console.error('[Enmore Theatre]', err.message);
    return [];
  }
}

// ─── 43. METRO THEATRE ────────────────────────────────────────────────────────
async function fetchMetroTheatre() {
  try {
    const html = await fetchHtml('https://metrotheatre.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Metro Theatre', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    // Metro uses Foundation CSS — look for event links / h3 headings
    $('h2,h3,h4').each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).find('a').attr('href') || $(el).closest('a').attr('href') || $(el).next('a').attr('href');
      if (name && name.length > 5 && name.length < 120) {
        results.push({ name, venueName: 'Metro Theatre', category: 'music', url: href?.startsWith('http') ? href : (href ? `https://metrotheatre.com.au${href}` : '') });
      }
    });
    // Also try Ticketmaster listing
    if (!results.length) {
      const html2 = await fetchHtml('https://www.ticketmaster.com.au/venue/metro-theatre-sydney-tickets/6054');
      const events2 = extractJsonLd(html2);
      if (events2.length) return events2.map(e => ({ ...e, venueName: 'Metro Theatre', category: 'music' }));
    }
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Metro Theatre]', err.message);
    return [];
  }
}

// ─── 44. HORDERN PAVILION ─────────────────────────────────────────────────────
async function fetchHordern() {
  try {
    const html = await fetchHtml('https://hordernpavilion.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Hordern Pavilion', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    // Hordern lists shows with h2/h3 headings linked to event pages
    $('h2 a[href],h3 a[href],h4 a[href]').each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, venueName: 'Hordern Pavilion', category: 'music', url: href.startsWith('http') ? href : `https://hordernpavilion.com.au${href}` });
    });
    return results.slice(0, 10);
  } catch (err) {
    console.error('[Hordern Pavilion]', err.message);
    return [];
  }
}

// ─── 45. FACTORY THEATRE ──────────────────────────────────────────────────────
async function fetchFactoryTheatre() {
  try {
    const html = await fetchHtml('https://www.factorytheatre.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Factory Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    // Factory uses WordPress — event titles are in h2/h3 linked to /event/ or /show/ pages
    $('h2 a,h3 a,h4 a').each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      const date = $(el).closest('article,section,.entry').find('time,[class*="date"]').first().text().trim();
      results.push({ name, dateDisplay: date, venueName: 'Factory Theatre', category: 'culture', url: href.startsWith('http') ? href : `https://www.factorytheatre.com.au${href}` });
    });
    return results.slice(0, 10);
  } catch (err) {
    console.error('[Factory Theatre]', err.message);
    return [];
  }
}

// ─── 46. POWER STATION ────────────────────────────────────────────────────────
async function fetchPowerStation() {
  try {
    // Power Station Sydney — check via Ticketmaster
    const html = await fetchHtml('https://www.ticketmaster.com.au/venue/power-station-sydney-tickets/39039');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Power Station Sydney', category: 'music' }));
    return [];
  } catch (err) {
    console.error('[Power Station]', err.message);
    return [];
  }
}

// ─── 47. SYDNEY MARKETS (various) ─────────────────────────────────────────────
async function fetchSydneyMarkets() {
  const markets = [
    { name: 'Glebe Markets', url: 'https://www.glebemarkets.com.au' },
    { name: 'Bondi Markets', url: 'https://www.bondimarkets.com.au' },
    { name: 'Paddington Markets', url: 'https://paddingtonmarkets.com.au' },
    { name: 'Rozelle Collectors Markets', url: 'https://www.rozellemarkets.com.au' },
  ];
  const results = [];
  for (const market of markets) {
    try {
      const html = await fetchHtml(market.url);
      const events = extractJsonLd(html);
      if (events.length) {
        results.push(...events.map(e => ({ ...e, category: 'market', venueName: e.venueName || market.name })));
      } else {
        results.push({ name: market.name, venueName: market.name, url: market.url, category: 'market', description: 'Regular Sydney market — check website for current traders and dates.' });
      }
    } catch { }
  }
  return results;
}

// ─── 48. SECRET SOUNDS ────────────────────────────────────────────────────────
async function fetchSecretSounds() {
  try {
    const html = await fetchHtml('https://www.secretsounds.com/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    return scrapeCards($, ['article,[class*="event"],[class*="show"]']).slice(0, 15)
      .map(e => ({ ...e, category: 'music', url: e.url?.startsWith('http') ? e.url : `https://www.secretsounds.com${e.url || ''}` }));
  } catch (err) {
    console.error('[Secret Sounds]', err.message);
    return [];
  }
}

// ─── 49. SYDNEY COMEDY STORE ──────────────────────────────────────────────────
async function fetchComedyStore() {
  try {
    // Root page has inline events with "More Info" links to /event/ URLs
    const html = await fetchHtml('https://www.comedystore.com.au/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Sydney Comedy Store', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    // Extract from "More Info" links to /event/ pages
    // Comedy Store event name sits in an h3/h4 inside the same section as the "More Info" link
    $('a[href*="/event/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('/event/') || seen.has(href)) return;
      seen.add(href);
      // Walk up the DOM until we find a heading
      let name = '';
      let node = $(el).parent();
      for (let i = 0; i < 5 && !name; i++) {
        name = node.find('h2,h3,h4').first().text().trim();
        node = node.parent();
      }
      // Fallback: derive name from the URL slug
      if (!isValidName(name)) {
        name = href.split('/event/')[1]?.replace(/-/g, ' ').replace(/\/$/, '').replace(/\b\w/g, c => c.toUpperCase()) || '';
      }
      if (!isValidName(name)) return;
      results.push({ name, venueName: 'Sydney Comedy Store', category: 'culture', url: href.startsWith('http') ? href : `https://www.comedystore.com.au${href}` });
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Comedy Store]', err.message);
    return [];
  }
}

// ─── 50. POWERHOUSE MUSEUM ────────────────────────────────────────────────────
async function fetchPowerhouse() {
  try {
    const html = await fetchHtml('https://www.powerhouse.com.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: e.venueName || 'Powerhouse Museum', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    const seen = new Set();
    // Powerhouse is a Next.js SPA — grab internal exhibition/event links
    $('a[href*="/exhibition"],a[href*="/event"],a[href*="/whats-on/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const name = $(el).attr('title') || $(el).attr('aria-label') || $(el).text().trim();
      if (!isValidName(name) || seen.has(name)) return;
      seen.add(name);
      results.push({ name, venueName: 'Powerhouse Museum', url: href.startsWith('http') ? href : `https://www.powerhouse.com.au${href}`, category: 'culture' });
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Powerhouse Museum]', err.message);
    return [];
  }
}

module.exports = {
  fetchResidentAdvisor, fetchDice, fetchTimeOut, fetchBroadsheet, fetchConcretePlayground,
  fetchSydneyOperaHouse, fetchAGNSW, fetchMCA, fetchCityOfSydney, fetchDestinationNSW,
  fetchEventfinda, fetchTryBooking, fetchMoshtix, fetchPeatix, fetchWeTeachMe,
  fetchCarriageworks, fetchSeymourCentre, fetchTheMusic, fetchNSWGov, fetchAirbnbExperiences,
  fetchTicketek, fetchSkiddle, fetchSydneyFestival, fetchMardiGras, fetchSXSWSydney,
  fetchVividSydney, fetchFuzzy, fetchAstralPeople, fetchSweatItOut, fetchGoodGod,
  fetchTownHall, fetchEnmore, fetchMetroTheatre, fetchHordern, fetchFactoryTheatre,
  fetchPowerStation, fetchSydneyMarkets, fetchSecretSounds, fetchComedyStore, fetchPowerhouse,
};
