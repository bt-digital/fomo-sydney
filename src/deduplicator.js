const stringSimilarity = require('string-similarity');

function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function sameDay(d1, d2) {
  if (!d1 || !d2) return false;
  try {
    return new Date(d1).toDateString() === new Date(d2).toDateString();
  } catch { return false; }
}

function deduplicate(events) {
  const merged = [];

  for (const ev of events) {
    let matched = false;
    for (const existing of merged) {
      const nameSim = stringSimilarity.compareTwoStrings(
        normalizeTitle(ev.name),
        normalizeTitle(existing.name)
      );
      const dateMatch = sameDay(ev.date?.start, existing.date?.start) ||
        (!ev.date?.start && !existing.date?.start);

      if (nameSim > 0.75 && dateMatch) {
        // Merge: accumulate sources, pick highest talkingCount, union tags
        existing.sources.push(...ev.sources);
        existing.talkingCount = Math.max(existing.talkingCount, ev.talkingCount);
        existing.postCount = (existing.postCount || 0) + (ev.postCount || 0);
        existing.tags = [...new Set([...(existing.tags || []), ...(ev.tags || [])])];
        if (!existing.imageUrl && ev.imageUrl) existing.imageUrl = ev.imageUrl;
        if (!existing.location.lat && ev.location?.lat) existing.location = ev.location;
        if ((ev.description || '').length > (existing.description || '').length) {
          existing.description = ev.description;
        }
        matched = true;
        break;
      }
    }
    if (!matched) merged.push({ ...ev });
  }

  return merged;
}

module.exports = { deduplicate };
