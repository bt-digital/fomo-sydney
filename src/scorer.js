// Multi-signal social relevance scorer
// Produces a normalised 0-100 socialScore and assigns a socialRank (1 = most relevant)

function daysUntil(dateStr) {
  if (!dateStr) return 999;
  try {
    return Math.max(0, (new Date(dateStr) - Date.now()) / 86400000);
  } catch { return 999; }
}

// Per-event raw score (unbounded — normalised later)
function rawSocialScore(ev) {
  const sig   = ev.rawSignals  || {};
  const srcs  = new Set((ev.sources || []).map(s => s.name));

  // ── 1. Source coverage (breadth signal) ────────────────────────────────────
  // Each independent source that independently discovered this event is strong
  // evidence of real-world buzz. Weighted by how "hard" each source is to appear on.
  const SOURCE_WEIGHT = {
    'Eventbrite': 1.2, 'Ticketmaster': 1.3, 'Resident Advisor': 1.4,
    'TimeOut Sydney': 1.2, 'Broadsheet Sydney': 1.2, 'Moshtix': 1.1,
    'Meetup': 1.1, 'Concrete Playground': 1.1, 'Dice.fm': 1.2,
  };
  let sourceScore = 0;
  for (const src of srcs) sourceScore += (SOURCE_WEIGHT[src] || 1.0) * 10;
  sourceScore = Math.min(60, sourceScore);

  // ── 2. Social engagement (depth signal) ────────────────────────────────────
  const talking = ev.talkingCount || 0;
  const rsvp    = sig.rsvpCount || 0;
  const interest= sig.interestedCount || 0;
  const listings= sig.listingCount || 0;   // SeatGeek / ticket demand proxy
  const ratings = sig.ratingCount || 0;    // Yelp/Google review volume

  const engagementRaw = talking + rsvp * 1.5 + interest + listings * 2 + ratings * 0.5;
  const engagementScore = engagementRaw > 0 ? Math.log10(engagementRaw + 1) * 14 : 0;

  // ── 3. Reddit / social discussion ──────────────────────────────────────────
  const redditMentions = sig.redditMentions || 0;
  const redditVotes    = sig.redditScore    || 0;
  const redditComments = sig.redditComments || 0;

  const redditScore = Math.min(35,
    redditMentions * 5 +
    Math.log10(redditVotes + 1) * 5 +
    Math.log10(redditComments + 1) * 4
  );

  // ── 4. Time urgency ─────────────────────────────────────────────────────────
  const days = daysUntil(ev.date?.start);
  let urgency = 0;
  if      (days <= 1)  urgency = 28;
  else if (days <= 3)  urgency = 22;
  else if (days <= 7)  urgency = 15;
  else if (days <= 14) urgency = 8;
  else if (days <= 30) urgency = 3;
  else if (days > 180) urgency = -8;  // very far-future events penalised

  // ── 5. Velocity (momentum signal) ──────────────────────────────────────────
  // velocityScore is set externally by agent.js after comparing to previous crawl
  const velocityScore = Math.min(20, (ev.velocityScore || 0) * 20);

  // ── 6. Comment/post depth ───────────────────────────────────────────────────
  const comments = (ev.comments?.length || 0) + (ev.postCount || 0);
  const commentScore = comments > 0 ? Math.log10(comments + 1) * 6 : 0;

  return sourceScore + engagementScore + redditScore + urgency + velocityScore + commentScore;
}

function trendLevel(score, sourceCount) {
  if (score >= 75 || sourceCount >= 5) return 'hot';
  if (score >= 45 || sourceCount >= 3) return 'rising';
  return 'steady';
}

function trendLabel(level, sourceCount, days) {
  const sourceStr = sourceCount > 1 ? `${sourceCount} sources` : 'Newly discovered';
  if (level === 'hot')    return `Hot · ${sourceStr}`;
  if (level === 'rising') return days <= 7 ? `Rising · this week` : `Rising · ${sourceStr}`;
  return `Steady · ${sourceStr}`;
}

function scoreAll(events) {
  // Compute raw scores
  const withRaw = events.map(ev => ({ ev, raw: rawSocialScore(ev) }));

  // Normalise to 0–100 using the top event as the ceiling
  const maxRaw = Math.max(...withRaw.map(x => x.raw), 1);

  return withRaw
    .map(({ ev, raw }, idx) => {
      const socialScore = Math.round((raw / maxRaw) * 100);
      const sourceCount = new Set((ev.sources || []).map(s => s.name)).size;
      const days        = daysUntil(ev.date?.start);
      const level       = trendLevel(socialScore, sourceCount);

      return {
        ...ev,
        socialScore,
        // Keep trendScore as alias so existing API consumers don't break
        trendScore: socialScore,
        trendLevel: level,
        trendLabel: trendLabel(level, sourceCount, days),
        sourceCount,
        // socialRank assigned after sort below
      };
    })
    .sort((a, b) => b.socialScore - a.socialScore)
    .map((ev, idx) => ({ ...ev, socialRank: idx + 1 }));
}

module.exports = { scoreAll };
