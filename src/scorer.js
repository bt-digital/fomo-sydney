// Score and rank events by how much buzz they're generating across sources

const SOURCE_WEIGHTS = {
  'Eventbrite': 1.0,
  'Meetup': 0.9,
  'Ticketmaster': 1.1,
  'Songkick': 1.0,
  'Bandsintown': 0.9,
  'Resident Advisor': 1.2,
  'Dice.fm': 1.0,
  'Humanitix': 0.8,
  'TimeOut Sydney': 1.1,
  'Broadsheet Sydney': 1.1,
  'Concrete Playground': 1.0,
  'Reddit r/sydney': 0.9,
  'Google Places': 0.7,
  'Moshtix': 0.9,
  'TryBooking': 0.7,
};

function daysUntil(dateStr) {
  if (!dateStr) return 999;
  try {
    const diff = new Date(dateStr) - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  } catch { return 999; }
}

function score(event) {
  let s = 0;

  // Multi-source coverage is the strongest signal
  const uniqueSources = new Set(event.sources.map(src => src.name));
  s += uniqueSources.size * 15;

  // Source quality weighting
  for (const src of uniqueSources) {
    s += (SOURCE_WEIGHTS[src] || 0.8) * 5;
  }

  // Talking count (log scale)
  if (event.talkingCount > 0) s += Math.log10(event.talkingCount + 1) * 10;

  // Post count
  if (event.postCount > 0) s += Math.log10(event.postCount + 1) * 5;

  // Recency boost — events happening soon rank higher
  const days = daysUntil(event.date?.start);
  if (days <= 3) s += 20;
  else if (days <= 7) s += 15;
  else if (days <= 14) s += 10;
  else if (days <= 30) s += 5;
  else if (days > 180) s -= 10;

  // Cap at 100
  return Math.min(100, Math.round(s));
}

function trendLevel(score, sourceCount) {
  if (score >= 75 || sourceCount >= 5) return 'hot';
  if (score >= 45 || sourceCount >= 3) return 'rising';
  return 'steady';
}

function trendLabel(level, sourceCount, days) {
  const sourceStr = sourceCount > 1 ? `Found on ${sourceCount} sources` : 'Newly discovered';
  if (level === 'hot') return `Hot — ${sourceStr}`;
  if (level === 'rising') {
    if (days <= 7) return `Rising — happening this week`;
    return `Rising — ${sourceStr}`;
  }
  return `Steady — ${sourceStr}`;
}

function scoreAll(events) {
  return events.map(ev => {
    const s = score(ev);
    const sourceCount = new Set(ev.sources.map(src => src.name)).size;
    const days = daysUntil(ev.date?.start);
    const level = trendLevel(s, sourceCount);
    return {
      ...ev,
      trendScore: s,
      trendLevel: level,
      trendLabel: trendLabel(level, sourceCount, days),
      sourceCount,
    };
  }).sort((a, b) => b.trendScore - a.trendScore);
}

module.exports = { scoreAll };
