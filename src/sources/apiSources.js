const axios = require('axios');

const SYDNEY_LAT = -33.8688;
const SYDNEY_LNG = 151.2093;
const HEADERS = { 'User-Agent': 'FOMO-Sydney/1.0 (event discovery app)' };

// ─── 1. EVENTBRITE ────────────────────────────────────────────────────────────
async function fetchEventbrite() {
  if (!process.env.EVENTBRITE_TOKEN) return [];
  try {
    const res = await axios.get('https://www.eventbriteapi.com/v3/events/search/', {
      headers: { Authorization: `Bearer ${process.env.EVENTBRITE_TOKEN}` },
      params: {
        'location.address': 'Sydney, NSW, Australia',
        'location.within': '50km',
        expand: 'organizer,venue,category',
        'start_date.range_start': new Date().toISOString(),
        page_size: 50,
        sort_by: 'best',
      },
    });
    return (res.data.events || []).map(e => ({
      name: e.name?.text,
      description: e.description?.text?.slice(0, 500),
      startDate: e.start?.utc,
      endDate: e.end?.utc,
      dateDisplay: e.start?.local,
      url: e.url,
      imageUrl: e.logo?.url,
      venueName: e.venue?.name,
      address: e.venue?.address?.localized_address_display,
      lat: parseFloat(e.venue?.latitude),
      lng: parseFloat(e.venue?.longitude),
      organizer: e.organizer?.name,
      isFree: e.is_free,
      price: e.is_free ? 'Free' : null,
      talkingCount: e.capacity || 0,
      category: e.category?.short_name?.toLowerCase(),
    }));
  } catch (err) {
    console.error('[Eventbrite]', err.message);
    return [];
  }
}

// ─── 2. MEETUP ────────────────────────────────────────────────────────────────
async function fetchMeetup() {
  if (!process.env.MEETUP_KEY) return [];
  try {
    const res = await axios.get('https://api.meetup.com/find/upcoming_events', {
      params: {
        key: process.env.MEETUP_KEY,
        lat: SYDNEY_LAT, lon: SYDNEY_LNG,
        radius: 50, page: 50, sign: true,
      },
    });
    return (res.data.events || []).map(e => ({
      name: e.name,
      description: e.description?.replace(/<[^>]+>/g, '').slice(0, 500),
      startDate: new Date(e.time).toISOString(),
      url: e.link,
      venueName: e.venue?.name,
      address: `${e.venue?.address_1 || ''}, ${e.venue?.city || ''}`,
      lat: e.venue?.lat,
      lng: e.venue?.lon,
      organizer: e.group?.name,
      talkingCount: e.yes_rsvp_count || 0,
      isFree: e.fee == null,
    }));
  } catch (err) {
    console.error('[Meetup]', err.message);
    return [];
  }
}

// ─── 3. TICKETMASTER ──────────────────────────────────────────────────────────
async function fetchTicketmaster() {
  if (!process.env.TICKETMASTER_KEY) return [];
  try {
    const res = await axios.get('https://app.ticketmaster.com/discovery/v2/events.json', {
      params: {
        apikey: process.env.TICKETMASTER_KEY,
        city: 'Sydney', countryCode: 'AU',
        size: 50, sort: 'relevance,desc',
        startDateTime: new Date().toISOString().slice(0, 19) + 'Z',
      },
    });
    const events = res.data?._embedded?.events || [];
    return events.map(e => {
      const venue = e._embedded?.venues?.[0];
      return {
        name: e.name,
        startDate: e.dates?.start?.dateTime,
        dateDisplay: e.dates?.start?.localDate,
        url: e.url,
        imageUrl: e.images?.[0]?.url,
        venueName: venue?.name,
        address: venue?.address?.line1,
        lat: parseFloat(venue?.location?.latitude),
        lng: parseFloat(venue?.location?.longitude),
        organizer: e._embedded?.attractions?.[0]?.name,
        category: e.classifications?.[0]?.segment?.name?.toLowerCase(),
        talkingCount: 0,
      };
    });
  } catch (err) {
    console.error('[Ticketmaster]', err.message);
    return [];
  }
}

// ─── 4. SONGKICK ──────────────────────────────────────────────────────────────
async function fetchSongkick() {
  if (!process.env.SONGKICK_KEY) return [];
  try {
    const res = await axios.get('https://api.songkick.com/api/3.0/metro_areas/7853/calendar.json', {
      params: { apikey: process.env.SONGKICK_KEY, per_page: 50 },
    });
    const events = res.data?.resultsPage?.results?.event || [];
    return events.map(e => ({
      name: e.displayName,
      startDate: `${e.start.date}T${e.start.time || '00:00:00'}`,
      dateDisplay: e.start.date,
      url: e.uri,
      venueName: e.venue?.displayName,
      address: e.venue?.displayName,
      organizer: e.performance?.[0]?.artist?.displayName,
      category: 'music',
      talkingCount: 0,
    }));
  } catch (err) {
    console.error('[Songkick]', err.message);
    return [];
  }
}

// ─── 5. BANDSINTOWN ───────────────────────────────────────────────────────────
async function fetchBandsintown() {
  if (!process.env.BANDSINTOWN_KEY) return [];
  try {
    const artists = ['triple j unearthed', 'local sydney bands'];
    const results = [];
    for (const artist of artists) {
      const res = await axios.get(`https://rest.bandsintown.com/artists/${encodeURIComponent(artist)}/events`, {
        params: { app_id: process.env.BANDSINTOWN_KEY, date: 'upcoming' },
      });
      for (const e of (res.data || [])) {
        if (e.venue?.city?.toLowerCase().includes('sydney')) {
          results.push({
            name: `${artist} — ${e.venue.name}`,
            startDate: e.datetime,
            url: e.url,
            venueName: e.venue.name,
            address: `${e.venue.street}, ${e.venue.city}`,
            lat: parseFloat(e.venue.latitude),
            lng: parseFloat(e.venue.longitude),
            organizer: artist,
            category: 'music',
            talkingCount: e.offers?.length ? 50 : 0,
          });
        }
      }
    }
    return results;
  } catch (err) {
    console.error('[Bandsintown]', err.message);
    return [];
  }
}

// ─── 6. HUMANITIX ─────────────────────────────────────────────────────────────
async function fetchHumanitix() {
  if (!process.env.HUMANITIX_KEY) return [];
  try {
    const res = await axios.get('https://api.humanitix.com/v1/events', {
      headers: { 'x-api-key': process.env.HUMANITIX_KEY },
      params: { city: 'Sydney', limit: 50, status: 'live' },
    });
    return (res.data?.events || []).map(e => ({
      name: e.name,
      description: e.description?.slice(0, 500),
      startDate: e.startDate,
      endDate: e.endDate,
      url: `https://events.humanitix.com/${e.slug}`,
      imageUrl: e.bannerImage,
      venueName: e.location?.venueName,
      address: e.location?.address,
      organizer: e.organiser?.name,
      isFree: e.isFree,
      talkingCount: e.ticketsSold || 0,
    }));
  } catch (err) {
    console.error('[Humanitix]', err.message);
    return [];
  }
}

// ─── 7. SEATGEEK ──────────────────────────────────────────────────────────────
async function fetchSeatGeek() {
  if (!process.env.SEATGEEK_CLIENT_ID) return [];
  try {
    const res = await axios.get('https://api.seatgeek.com/2/events', {
      params: {
        client_id: process.env.SEATGEEK_CLIENT_ID,
        'venue.city': 'Sydney', 'venue.country': 'AU',
        per_page: 50, sort: 'score.desc',
        'datetime_utc.gte': new Date().toISOString(),
      },
    });
    return (res.data?.events || []).map(e => ({
      name: e.title,
      startDate: e.datetime_utc,
      url: e.url,
      imageUrl: e.performers?.[0]?.image,
      venueName: e.venue?.name,
      address: e.venue?.address,
      lat: e.venue?.location?.lat,
      lng: e.venue?.location?.lon,
      organizer: e.performers?.[0]?.name,
      category: e.type,
      talkingCount: e.stats?.listing_count || 0,
    }));
  } catch (err) {
    console.error('[SeatGeek]', err.message);
    return [];
  }
}

// ─── 8. REDDIT r/sydney ───────────────────────────────────────────────────────
async function fetchReddit() {
  try {
    const subreddits = ['sydney', 'sydneymusic', 'sydneysocialclub'];
    const results = [];
    for (const sub of subreddits) {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/search.json`, {
        headers: HEADERS,
        params: { q: 'event OR happening OR tonight OR this weekend', sort: 'new', t: 'week', limit: 25 },
      });
      for (const post of (res.data?.data?.children || [])) {
        const d = post.data;
        if (d.score < 5) continue;
        results.push({
          name: d.title,
          description: (d.selftext || '').slice(0, 500),
          url: `https://reddit.com${d.permalink}`,
          organizer: `u/${d.author}`,
          talkingCount: d.score + d.num_comments,
          postCount: 1,
          comments: [],
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[Reddit]', err.message);
    return [];
  }
}

// ─── 9. YELP EVENTS ───────────────────────────────────────────────────────────
async function fetchYelp() {
  if (!process.env.YELP_KEY) return [];
  try {
    const res = await axios.get('https://api.yelp.com/v3/events', {
      headers: { Authorization: `Bearer ${process.env.YELP_KEY}` },
      params: { location: 'Sydney, NSW', limit: 50, sort_on: 'popularity', is_free: false },
    });
    return (res.data?.events || []).map(e => ({
      name: e.name,
      description: e.description?.slice(0, 500),
      startDate: new Date(e.time_start * 1000).toISOString(),
      url: e.event_site_url,
      imageUrl: e.image_url,
      venueName: e.location?.display_address?.join(', '),
      address: e.location?.display_address?.join(', '),
      isFree: e.is_free,
      talkingCount: e.interested_count || 0,
    }));
  } catch (err) {
    console.error('[Yelp]', err.message);
    return [];
  }
}

// ─── 10. GOOGLE PLACES (events via text search) ───────────────────────────────
async function fetchGooglePlaces() {
  if (!process.env.GOOGLE_PLACES_KEY) return [];
  try {
    const queries = ['events in Sydney this weekend', 'Sydney festival this month'];
    const results = [];
    for (const q of queries) {
      const res = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query: q, key: process.env.GOOGLE_PLACES_KEY, region: 'au' },
      });
      for (const place of (res.data?.results || []).slice(0, 10)) {
        results.push({
          name: place.name,
          venueName: place.name,
          address: place.formatted_address,
          lat: place.geometry?.location?.lat,
          lng: place.geometry?.location?.lng,
          url: '',
          talkingCount: place.user_ratings_total || 0,
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[Google Places]', err.message);
    return [];
  }
}

module.exports = {
  fetchEventbrite,
  fetchMeetup,
  fetchTicketmaster,
  fetchSongkick,
  fetchBandsintown,
  fetchHumanitix,
  fetchSeatGeek,
  fetchReddit,
  fetchYelp,
  fetchGooglePlaces,
};
