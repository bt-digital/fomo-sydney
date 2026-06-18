const { v4: uuidv4 } = require('uuid');

const CATEGORY_MAP = {
  music: ['music', 'concert', 'gig', 'band', 'dj', 'festival', 'electronic', 'jazz', 'hip hop', 'rock', 'pop', 'classical', 'indie', 'rave', 'nightclub', 'club night', 'live music', 'songkick', 'bandsintown', 'resident advisor'],
  food: ['food', 'drink', 'dining', 'restaurant', 'bar', 'wine', 'beer', 'cocktail', 'tasting', 'market', 'farmers', 'brunch', 'dinner', 'lunch', 'chef', 'culinary', 'gastro', 'noodle', 'bbq', 'feast'],
  art: ['art', 'gallery', 'exhibition', 'sculpture', 'painting', 'installation', 'photography', 'mural', 'design', 'illustration', 'print', 'ceramics', 'craft', 'vivid', 'light show'],
  sport: ['sport', 'run', 'race', 'triathlon', 'yoga', 'fitness', 'cycling', 'swim', 'surf', 'hike', 'walk', 'football', 'rugby', 'cricket', 'tennis', 'gym', 'crossfit', 'pilates', 'martial arts', 'boxing'],
  market: ['market', 'markets', 'flea', 'pop-up', 'pop up', 'bazaar', 'fair', 'stall', 'vendor', 'artisan', 'handmade'],
  film: ['film', 'cinema', 'movie', 'screening', 'documentary', 'short film', 'premiere', 'outdoor cinema', 'moonlight'],
  culture: ['culture', 'festival', 'comedy', 'theatre', 'theater', 'dance', 'performance', 'spoken word', 'poetry', 'literary', 'book', 'history', 'heritage', 'indigenous', 'aboriginal', 'community', 'lgbtq', 'pride'],
  wellness: ['wellness', 'meditation', 'mindfulness', 'health', 'wellbeing', 'mental health', 'spa', 'retreat', 'healing', 'holistic', 'naturopath'],
  tech: ['tech', 'technology', 'startup', 'hackathon', 'coding', 'ai', 'blockchain', 'developer', 'innovation', 'conference', 'networking'],
  education: ['workshop', 'class', 'course', 'seminar', 'talk', 'lecture', 'learn', 'training', 'skill', 'masterclass'],
};

function inferCategory(text) {
  const lower = (text || '').toLowerCase();
  let best = { cat: 'culture', score: 0 };
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > best.score) best = { cat, score };
  }
  return best.cat;
}

function decodeHtmlEntities(str) {
  return (str || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function normalize(raw, sourceName) {
  const name = decodeHtmlEntities((raw.name || raw.title || '').trim());
  if (!name) return null;

  const category = raw.category || inferCategory(name + ' ' + (raw.description || ''));

  // Extract per-source social signals — preserved separately so scorer can weight them
  const rawSignals = {
    rsvpCount:      raw.rsvpCount      || raw.yes_rsvp_count  || 0,
    interestedCount:raw.interestedCount|| raw.interested_count|| 0,
    redditScore:    raw.redditScore    || 0,
    redditComments: raw.redditComments || 0,
    listingCount:   raw.listingCount   || 0,   // SeatGeek / Ticketmaster demand
    capacity:       raw.capacity       || 0,   // Eventbrite
    ratingCount:    raw.ratingCount    || raw.user_ratings_total || 0, // Google/Yelp
    likeCount:      raw.likeCount      || 0,
  };

  return {
    id: uuidv4(),
    name,
    category,
    description: (raw.description || '').slice(0, 500),
    date: {
      start: raw.startDate || raw.start || null,
      end: raw.endDate || raw.end || null,
      display: raw.dateDisplay || raw.dateText || raw.startDate || null,
    },
    location: {
      name: raw.venueName || raw.venue || '',
      address: raw.address || '',
      suburb: raw.suburb || extractSuburb(raw.address || raw.venueName || raw.venue || ''),
      lat: raw.lat || null,
      lng: raw.lng || null,
    },
    hosts: Array.isArray(raw.hosts) ? raw.hosts : (raw.organizer ? [raw.organizer] : []),
    url: raw.url || '',
    imageUrl: raw.imageUrl || raw.image || '',
    sources: [{
      name: sourceName,
      url: raw.url || '',
      foundAt: new Date().toISOString(),
    }],
    // Aggregate engagement count (legacy field, kept for compat)
    talkingCount: raw.talkingCount || raw.attendeeCount || rawSignals.rsvpCount || rawSignals.interestedCount || 0,
    postCount: raw.postCount || 0,
    // Per-signal breakdown — accumulated by deduplicator and used by scorer
    rawSignals,
    trendScore: 0,
    trendLevel: 'steady',
    sentiment: raw.sentiment || { positive: 75, neutral: 20, negative: 5 },
    comments: raw.comments || [],
    tags: raw.tags || [],
    isFree: raw.isFree || raw.free || false,
    price: raw.price || null,
    lastUpdated: new Date().toISOString(),
  };
}

function extractSuburb(text) {
  const sydneySuburbs = [
    'CBD', 'Surry Hills', 'Newtown', 'Glebe', 'Darlinghurst', 'Paddington',
    'Bondi', 'Coogee', 'Manly', 'Balmain', 'Leichhardt', 'Marrickville',
    'Redfern', 'Chippendale', 'Pyrmont', 'Ultimo', 'Haymarket', 'Circular Quay',
    'The Rocks', 'Woolloomooloo', 'Potts Point', 'Kings Cross', 'Erskineville',
    'Alexandria', 'Eveleigh', 'Rosebery', 'Waterloo', 'Zetland', 'Green Square',
    'Parramatta', 'Chatswood', 'North Sydney', 'St Leonards', 'Crows Nest',
    'Neutral Bay', 'Mosman', 'Kirribilli', 'Milsons Point', 'McMahons Point',
    'Darling Harbour', 'Pyrmont', 'Barangaroo', 'Ultimo', 'Broadway',
    'Inner West', 'Eastern Suburbs', 'Northern Beaches', 'North Shore',
  ];
  for (const suburb of sydneySuburbs) {
    if (text.toLowerCase().includes(suburb.toLowerCase())) return suburb;
  }
  return 'Sydney';
}

module.exports = { normalize, inferCategory };
