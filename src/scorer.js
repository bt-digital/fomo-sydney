// Multi-signal social relevance scorer
// Produces a normalised 0-100 socialScore and assigns a socialRank (1 = most relevant)
//
// Score components (raw, before normalisation):
//   popularityScore  (0-75): Spotify artist popularity + Last.fm monthly listeners + Wikipedia page views
//   discussion       (0-30): Reddit mentions × votes × comments (broader multi-subreddit search)
//   sourceScore      (0-25): Source coverage — number of independent platforms listing the event
//   engagement       (0-15): RSVPs / interested / ticket demand (log-scaled)
//   velocity         (0-12): Source count growth since last crawl
//   urgency       (-30—+25): Time until event

function daysUntil(dateStr) {
  if (!dateStr) return 999;
  try { return (new Date(dateStr) - Date.now()) / 86400000; }
  catch { return 999; }
}

function rawSocialScore(ev) {
  const sig  = ev.rawSignals || {};
  const srcs = new Set((ev.sources || []).map(s => s.name));

  // ── 1. Artist / event popularity ───────────────────────────────────────────
  // Spotify popularity (0-100 scale): meaningful above ~15
  const spotifyScore = sig.spotifyPopularity > 0
    ? Math.min(50, Math.max(0, (sig.spotifyPopularity - 15) * 1.4))
    : 0;

  // Last.fm monthly listeners: < 100 = effectively nobody
  const lastfmScore = sig.lastfmListeners > 100
    ? Math.min(50, Math.max(0, (Math.log10(sig.lastfmListeners) - 2) * 12))
    : 0;

  // Wikipedia monthly page views: proxy for general search interest / fame
  // Works for both artists ("Flume") and events ("Sydney Film Festival")
  const wikiScore = sig.wikiMonthlyViews > 1000
    ? Math.min(25, Math.max(0, (Math.log10(sig.wikiMonthlyViews) - 3) * 10))
    : 0;

  // Take the strongest artist signal then add the wiki bonus separately
  const popularityScore = Math.max(spotifyScore, lastfmScore) + wikiScore; // max ~75

  // ── 2. Social discussion (Reddit multi-subreddit) ──────────────────────────
  const redditMentions = sig.redditMentions || 0;
  const redditVotes    = sig.redditScore    || 0;
  const redditComments = sig.redditComments || 0;
  const discussion = Math.min(30,
    redditMentions * 4 +
    Math.log10(redditVotes    + 1) * 4 +
    Math.log10(redditComments + 1) * 3
  );

  // ── 3. Source coverage ─────────────────────────────────────────────────────
  // Editorial and curated sources are harder to get on — weight them higher
  const SOURCE_WEIGHT = {
    'Resident Advisor': 1.5, 'Ticketmaster': 1.3, 'Dice.fm': 1.2, 'Dice FM Sydney': 1.2,
    'Eventbrite': 1.2, 'Eventbrite Sydney': 1.2,
    'TimeOut Sydney': 1.2, 'Broadsheet Sydney': 1.2, 'Concrete Playground': 1.1,
    'Moshtix': 1.0, 'Moshtix All Pages': 1.0,
  };
  let sourceScore = 0;
  for (const src of srcs) sourceScore += (SOURCE_WEIGHT[src] || 1.0) * 8;
  sourceScore = Math.min(25, sourceScore);

  // ── 4. Engagement (ticket demand, RSVPs, interest) ─────────────────────────
  const talking  = ev.talkingCount     || 0;
  const rsvp     = sig.rsvpCount       || 0;
  const interest = sig.interestedCount || 0;
  const listings = sig.listingCount    || 0;
  const engRaw   = talking + rsvp * 1.5 + interest + listings * 2;
  const engagement = engRaw > 0 ? Math.min(15, Math.log10(engRaw + 1) * 6) : 0;

  // ── 5. Velocity (source-count growth since last crawl) ─────────────────────
  const velocity = Math.min(12, (ev.velocityScore || 0) * 12);

  // ── 6. Time urgency ────────────────────────────────────────────────────────
  const days = daysUntil(ev.date?.start);
  let urgency = 0;
  if      (days < 0)    urgency = -30;
  else if (days <= 1)   urgency = 25;
  else if (days <= 3)   urgency = 20;
  else if (days <= 7)   urgency = 14;
  else if (days <= 14)  urgency = 8;
  else if (days <= 30)  urgency = 3;
  else if (days > 180)  urgency = -8;

  return popularityScore + discussion + sourceScore + engagement + velocity + urgency;
}

function trendLevel(score, sig) {
  const pop = Math.max(sig?.spotifyPopularity || 0, sig?.lastfmListeners > 10000 ? 60 : 0);
  if (score >= 70 || (sig?.redditMentions || 0) >= 3 || pop >= 70) return 'hot';
  if (score >= 38 || (sig?.redditMentions || 0) >= 1 || pop >= 30) return 'rising';
  return 'steady';
}

function trendLabel(level, sourceCount, sig) {
  const spotifyPop  = sig?.spotifyPopularity || 0;
  const lastfmList  = sig?.lastfmListeners   || 0;
  const redditMent  = sig?.redditMentions    || 0;
  const wikiViews   = sig?.wikiMonthlyViews  || 0;

  if (level === 'hot') {
    if (spotifyPop >= 65)   return `Trending · ${spotifyPop} Spotify popularity`;
    if (lastfmList >= 500000) return `Trending · ${(lastfmList / 1000000).toFixed(1)}M monthly listeners`;
    if (redditMent >= 3)    return `Trending · ${redditMent} Reddit threads this month`;
    return `Hot · ${sourceCount} sources`;
  }
  if (level === 'rising') {
    if (lastfmList >= 50000)  return `Rising · ${(lastfmList / 1000).toFixed(0)}k listeners`;
    if (redditMent >= 1)      return `Rising · discussed on Reddit`;
    if (wikiViews >= 5000)    return `Rising · ${(wikiViews / 1000).toFixed(0)}k Wikipedia views`;
    return `Rising · ${sourceCount > 1 ? sourceCount + ' sources' : 'Newly discovered'}`;
  }
  return `Steady · ${sourceCount > 1 ? sourceCount + ' sources' : 'Newly discovered'}`;
}

function scoreAll(events) {
  const withRaw = events.map(ev => ({ ev, raw: rawSocialScore(ev) }));
  const maxRaw  = Math.max(...withRaw.map(x => x.raw), 1);

  return withRaw
    .map(({ ev, raw }) => {
      const socialScore = Math.round((raw / maxRaw) * 100);
      const sourceCount = new Set((ev.sources || []).map(s => s.name)).size;
      const sig         = ev.rawSignals || {};
      const level       = trendLevel(socialScore, sig);

      return {
        ...ev,
        socialScore,
        trendScore:  socialScore,
        trendLevel:  level,
        trendLabel:  trendLabel(level, sourceCount, sig),
        sourceCount,
      };
    })
    .sort((a, b) => b.socialScore - a.socialScore)
    .map((ev, idx) => ({ ...ev, socialRank: idx + 1 }));
}

module.exports = { scoreAll };
