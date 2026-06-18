const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

async function fetchHtml(url, timeout = 10000) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout });
    return res.data;
  } catch (err) {
    return null;
  }
}

// Extract JSON-LD structured event data from any page
function extractJsonLd(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const events = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Event') {
          events.push({
            name: item.name,
            description: (item.description || '').slice(0, 500),
            startDate: item.startDate,
            endDate: item.endDate,
            url: item.url,
            imageUrl: item.image,
            venueName: item.location?.name,
            address: item.location?.address?.streetAddress ||
              (typeof item.location?.address === 'string' ? item.location.address : ''),
            organizer: item.organizer?.name,
            isFree: item.isAccessibleForFree,
          });
        }
      }
    } catch { }
  });
  return events;
}

// ─── 11. RESIDENT ADVISOR ─────────────────────────────────────────────────────
async function fetchResidentAdvisor() {
  // RA has an unofficial GraphQL endpoint
  try {
    const query = `{
      eventListings(filters: {areas: {id: 28}, listingDate: {gte: "${new Date().toISOString().slice(0,10)}", lte: "${new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10)}"}}, pageSize: 50) {
        data { id listing { title startTime endTime venue { name } artists { name } contentUrl pick } }
      }
    }`;
    const res = await axios.post('https://ra.co/graphql', { query }, {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Referer': 'https://ra.co' },
    });
    return (res.data?.data?.eventListings?.data || []).map(e => ({
      name: e.listing.title,
      startDate: e.listing.startTime,
      endDate: e.listing.endTime,
      url: `https://ra.co${e.listing.contentUrl}`,
      venueName: e.listing.venue?.name,
      organizer: (e.listing.artists || []).map(a => a.name).join(', '),
      category: 'music',
      talkingCount: 0,
    }));
  } catch (err) {
    console.error('[Resident Advisor]', err.message);
    return [];
  }
}

// ─── 12. DICE.FM ──────────────────────────────────────────────────────────────
async function fetchDice() {
  try {
    const html = await fetchHtml('https://dice.fm/discover/events?location=sydney-nsw-australia');
    const events = extractJsonLd(html);
    if (events.length) return events;
    // Fallback: scrape event cards
    const $ = cheerio.load(html || '');
    const results = [];
    $('[data-testid="event-card"], .event-card, article').each((_, el) => {
      const name = $(el).find('h2, h3, [class*="title"]').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const venue = $(el).find('[class*="venue"], [class*="location"]').first().text().trim();
      const url = $(el).find('a').first().attr('href');
      if (name) results.push({ name, dateDisplay: date, venueName: venue, url: url ? `https://dice.fm${url}` : '', category: 'music' });
    });
    return results;
  } catch (err) {
    console.error('[Dice.fm]', err.message);
    return [];
  }
}

// ─── 13. TIMEOUT SYDNEY ───────────────────────────────────────────────────────
async function fetchTimeOut() {
  try {
    const html = await fetchHtml('https://www.timeout.com/sydney/things-to-do/best-things-to-do-in-sydney-this-weekend');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="card"]').each((_, el) => {
      const name = $(el).find('h2, h3, h4').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const url = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: url ? (url.startsWith('http') ? url : `https://www.timeout.com${url}`) : '' });
      }
    });
    return results.slice(0, 30);
  } catch (err) {
    console.error('[TimeOut Sydney]', err.message);
    return [];
  }
}

// ─── 14. BROADSHEET SYDNEY ────────────────────────────────────────────────────
async function fetchBroadsheet() {
  try {
    const urls = [
      'https://www.broadsheet.com.au/sydney/event-guide',
      'https://www.broadsheet.com.au/national/event-guide/article/things-to-do-sydney-this-weekend',
    ];
    for (const url of urls) {
      const html = await fetchHtml(url);
      const events = extractJsonLd(html);
      if (events.length) return events;
      const $ = cheerio.load(html || '');
      const results = [];
      $('article, [class*="card"], [class*="item"]').each((_, el) => {
        const name = $(el).find('h2, h3, h4').first().text().trim();
        const dateText = $(el).find('time, [class*="date"], [class*="when"]').first().text().trim();
        const venue = $(el).find('[class*="venue"], [class*="location"]').first().text().trim();
        const href = $(el).find('a').first().attr('href');
        if (name && name.length > 3) {
          results.push({ name, dateDisplay: dateText, venueName: venue, url: href ? `https://www.broadsheet.com.au${href}` : '' });
        }
      });
      if (results.length) return results.slice(0, 30);
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
    const results = [];
    $('article, [class*="event"], [class*="card"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://concreteplayground.com${href || ''}` });
      }
    });
    return results.slice(0, 30);
  } catch (err) {
    console.error('[Concrete Playground]', err.message);
    return [];
  }
}

// ─── 16. SYDNEY OPERA HOUSE ───────────────────────────────────────────────────
async function fetchSydneyOperaHouse() {
  try {
    const html = await fetchHtml('https://www.sydneyoperahouse.com/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Sydney Opera House', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event-card"], [class*="production"]').each((_, el) => {
      const name = $(el).find('h2, h3, h4').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Sydney Opera House', url: href ? `https://www.sydneyoperahouse.com${href}` : '', category: 'culture' });
      }
    });
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
    if (events.length) return events.map(e => ({ ...e, venueName: 'Art Gallery of NSW', category: 'art' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"], [class*="card"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Art Gallery of NSW', url: href ? `https://www.artgallery.nsw.gov.au${href}` : '', category: 'art' });
      }
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
    const html = await fetchHtml('https://www.mca.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Museum of Contemporary Art', category: 'art' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, venueName: 'Museum of Contemporary Art', url: href ? `https://www.mca.com.au${href}` : '', category: 'art' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[MCA]', err.message);
    return [];
  }
}

// ─── 19. CITY OF SYDNEY EVENTS ────────────────────────────────────────────────
async function fetchCityOfSydney() {
  try {
    const html = await fetchHtml('https://www.cityofsydney.nsw.gov.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    $('[class*="event"], article, [class*="card"]').each((_, el) => {
      const name = $(el).find('h2, h3, h4').first().text().trim();
      const date = $(el).find('time, [class*="date"]').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href ? `https://www.cityofsydney.nsw.gov.au${href}` : '' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('article, [class*="event"], [class*="card"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('[class*="date"], time').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.visitnsw.com${href || ''}` });
      }
    });
    return results.slice(0, 20);
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
    $('[class*="event-list"] li, article').each((_, el) => {
      const name = $(el).find('h2, h3, .title').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const venue = $(el).find('.location, .venue').first().text().trim();
      const href = $(el).find('a').first().attr('href');
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
    const results = [];
    $('[class*="event"], article, .result-item').each((_, el) => {
      const name = $(el).find('h2, h3, .event-name').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href ? `https://www.trybooking.com${href}` : '' });
      }
    });
    return results.slice(0, 20);
  } catch (err) {
    console.error('[TryBooking]', err.message);
    return [];
  }
}

// ─── 23. MOSHTIX ──────────────────────────────────────────────────────────────
async function fetchMoshtix() {
  try {
    const html = await fetchHtml('https://www.moshtix.com.au/v2/search?query=&state=NSW&genre=0');
    const events = extractJsonLd(html);
    if (events.length) return events;
    const $ = cheerio.load(html || '');
    const results = [];
    $('[class*="event"], .search-result').each((_, el) => {
      const name = $(el).find('h2, h3, .event-title').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const venue = $(el).find('.venue').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: venue, url: href ? `https://www.moshtix.com.au${href}` : '', category: 'music' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('[class*="event"], article').each((_, el) => {
      const name = $(el).find('h2, h3, .event-name').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://peatix.com${href || ''}` });
      }
    });
    return results.slice(0, 20);
  } catch (err) {
    console.error('[Peatix]', err.message);
    return [];
  }
}

// ─── 25. WETEACHME ────────────────────────────────────────────────────────────
async function fetchWeTeachMe() {
  try {
    const html = await fetchHtml('https://www.weteachme.com/s?near=Sydney%2C+NSW&page=1');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'education' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="class"], [class*="workshop"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.weteachme.com${href || ''}`, category: 'education' });
      }
    });
    return results.slice(0, 20);
  } catch (err) {
    console.error('[WeTeachMe]', err.message);
    return [];
  }
}

// ─── 26. CARRIAGEWORKS ────────────────────────────────────────────────────────
async function fetchCarriageworks() {
  try {
    const html = await fetchHtml('https://carriageworks.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Carriageworks, Eveleigh' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Carriageworks, Eveleigh', url: href ? `https://carriageworks.com.au${href}` : '' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Carriageworks]', err.message);
    return [];
  }
}

// ─── 27. SEYMOUR CENTRE ───────────────────────────────────────────────────────
async function fetchSeymourCentre() {
  try {
    const html = await fetchHtml('https://seymourcentre.com/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Seymour Centre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="show"], [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .dates').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Seymour Centre', url: href ? `https://seymourcentre.com${href}` : '', category: 'culture' });
      }
    });
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
    const $ = cheerio.load(html || '');
    const results = [];
    $('[class*="event"], [class*="gig"], article').each((_, el) => {
      const name = $(el).find('h2, h3, .title').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const venue = $(el).find('.venue, .location').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: venue, url: href?.startsWith('http') ? href : `https://themusic.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('[class*="event"], article, .nsw-card').each((_, el) => {
      const name = $(el).find('h2, h3, h4').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.nsw.gov.au${href || ''}` });
      }
    });
    return results.slice(0, 20);
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
    $('[data-testid="card-container"], [class*="cardCover"], article').each((_, el) => {
      const name = $(el).find('[data-testid="listing-card-title"], h3, h4').first().text().trim();
      const price = $(el).find('[data-testid="price-availability-row"], [class*="price"]').first().text().trim();
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
    const results = [];
    $('[class*="show"], [class*="event"], .show-listing').each((_, el) => {
      const name = $(el).find('h2, h3, .show-name').first().text().trim();
      const date = $(el).find('.date, time').first().text().trim();
      const venue = $(el).find('.venue').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: venue, url: href?.startsWith('http') ? href : `https://premier.ticketek.com.au${href || ''}` });
      }
    });
    return results.slice(0, 20);
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
      name: e.eventname,
      startDate: e.date,
      url: e.link,
      imageUrl: e.largeimageurl,
      venueName: e.venue?.name,
      address: e.venue?.address,
      category: 'music',
      talkingCount: e.goingcount || 0,
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
    const results = [];
    $('article, [class*="event"], [class*="show"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href ? `https://www.sydneyfestival.org.au${href}` : '', category: 'culture' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('article, [class*="event"], [class*="program"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href ? `https://www.mardigras.org.au${href}` : '', category: 'culture' });
      }
    });
    return results.slice(0, 15);
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
    const results = [];
    $('article, [class*="session"], [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.sxswsydney.com${href || ''}`, category: 'culture' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.vividsydney.com${href || ''}`, category: 'art' });
      }
    });
    return results.slice(0, 20);
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
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://fuzzy.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
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
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://astralpeople.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
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
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://sweatitout.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Sweat It Out]', err.message);
    return [];
  }
}

// ─── 40. GOODGOD SMALL CLUB ───────────────────────────────────────────────────
async function fetchGoodGod() {
  try {
    const html = await fetchHtml('https://goodgoodgood.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music', venueName: 'Goodgod Small Club' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Goodgod Small Club', url: href?.startsWith('http') ? href : '', category: 'music' });
      }
    });
    return results.slice(0, 10);
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
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Sydney Town Hall', url: href?.startsWith('http') ? href : `https://www.sydneytownhall.com.au${href || ''}` });
      }
    });
    return results.slice(0, 10);
  } catch (err) {
    console.error('[Sydney Town Hall]', err.message);
    return [];
  }
}

// ─── 42. ENMORE THEATRE ───────────────────────────────────────────────────────
async function fetchEnmore() {
  try {
    const html = await fetchHtml('https://www.enmoretheatre.com.au/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Enmore Theatre', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Enmore Theatre', url: href?.startsWith('http') ? href : `https://www.enmoretheatre.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Enmore Theatre]', err.message);
    return [];
  }
}

// ─── 43. METRO THEATRE ────────────────────────────────────────────────────────
async function fetchMetroTheatre() {
  try {
    const html = await fetchHtml('https://www.metrotheatre.com.au/events/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Metro Theatre', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Metro Theatre', url: href?.startsWith('http') ? href : `https://www.metrotheatre.com.au${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Metro Theatre]', err.message);
    return [];
  }
}

// ─── 44. HORDERN PAVILION ─────────────────────────────────────────────────────
async function fetchHordern() {
  try {
    const html = await fetchHtml('https://hordernpavilion.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Hordern Pavilion', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Hordern Pavilion', url: href?.startsWith('http') ? href : '', category: 'music' });
      }
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
    const html = await fetchHtml('https://factorytheatre.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Factory Theatre', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"], [class*="show"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Factory Theatre', url: href?.startsWith('http') ? href : `https://factorytheatre.com.au${href || ''}`, category: 'culture' });
      }
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
    const html = await fetchHtml('https://www.powerstationsydney.com.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Power Station Sydney', category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Power Station Sydney', url: href?.startsWith('http') ? href : '', category: 'music' });
      }
    });
    return results.slice(0, 10);
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
        results.push(...events.map(e => ({ ...e, category: 'market', venueName: market.name })));
      } else {
        results.push({
          name: market.name,
          venueName: market.name,
          url: market.url,
          category: 'market',
          description: 'Regular Sydney market — check website for current dates and traders.',
        });
      }
    } catch { }
  }
  return results;
}

// ─── 48. LANEWAY FESTIVAL / SECRET SOUNDS ─────────────────────────────────────
async function fetchSecretSounds() {
  try {
    const html = await fetchHtml('https://www.secretsounds.com/events');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, category: 'music' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, url: href?.startsWith('http') ? href : `https://www.secretsounds.com${href || ''}`, category: 'music' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Secret Sounds]', err.message);
    return [];
  }
}

// ─── 49. SYDNEY COMEDY STORE ──────────────────────────────────────────────────
async function fetchComedyStore() {
  try {
    const html = await fetchHtml('https://www.comedystore.com.au/whats-on/');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Sydney Comedy Store', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="show"], [class*="event"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Sydney Comedy Store', url: href?.startsWith('http') ? href : `https://www.comedystore.com.au${href || ''}`, category: 'culture' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Comedy Store]', err.message);
    return [];
  }
}

// ─── 50. SYDNEY POWERHOUSE MUSEUM ─────────────────────────────────────────────
async function fetchPowerhouse() {
  try {
    const html = await fetchHtml('https://www.powerhouse.com.au/whats-on');
    const events = extractJsonLd(html);
    if (events.length) return events.map(e => ({ ...e, venueName: 'Powerhouse Museum', category: 'culture' }));
    const $ = cheerio.load(html || '');
    const results = [];
    $('article, [class*="event"], [class*="exhibition"]').each((_, el) => {
      const name = $(el).find('h2, h3').first().text().trim();
      const date = $(el).find('time, .date').first().text().trim();
      const href = $(el).find('a').first().attr('href');
      if (name && name.length > 3) {
        results.push({ name, dateDisplay: date, venueName: 'Powerhouse Museum', url: href?.startsWith('http') ? href : `https://www.powerhouse.com.au${href || ''}`, category: 'culture' });
      }
    });
    return results.slice(0, 15);
  } catch (err) {
    console.error('[Powerhouse Museum]', err.message);
    return [];
  }
}

module.exports = {
  fetchResidentAdvisor,
  fetchDice,
  fetchTimeOut,
  fetchBroadsheet,
  fetchConcretePlayground,
  fetchSydneyOperaHouse,
  fetchAGNSW,
  fetchMCA,
  fetchCityOfSydney,
  fetchDestinationNSW,
  fetchEventfinda,
  fetchTryBooking,
  fetchMoshtix,
  fetchPeatix,
  fetchWeTeachMe,
  fetchCarriageworks,
  fetchSeymourCentre,
  fetchTheMusic,
  fetchNSWGov,
  fetchAirbnbExperiences,
  fetchTicketek,
  fetchSkiddle,
  fetchSydneyFestival,
  fetchMardiGras,
  fetchSXSWSydney,
  fetchVividSydney,
  fetchFuzzy,
  fetchAstralPeople,
  fetchSweatItOut,
  fetchGoodGod,
  fetchTownHall,
  fetchEnmore,
  fetchMetroTheatre,
  fetchHordern,
  fetchFactoryTheatre,
  fetchPowerStation,
  fetchSydneyMarkets,
  fetchSecretSounds,
  fetchComedyStore,
  fetchPowerhouse,
};
