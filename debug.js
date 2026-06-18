const axios = require('axios');
const cheerio = require('cheerio');
const H = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

async function probeSel(label, url, sel) {
  try {
    const r = await axios.get(url, { headers: H, timeout: 10000 });
    const $ = cheerio.load(r.data);
    console.log(label + ' [' + sel + ']: ' + $(sel).length);
    $(sel).slice(0,3).each((i,el) => {
      const t = $(el).text().replace(/\s+/g,' ').trim().slice(0,80);
      console.log('  ['+i+'] "'+t+'"');
    });
  } catch(e) { console.log(label + ': ' + e.message); }
}

(async () => {
  // Seymour correct URL
  console.log('=== Seymour ===');
  await probeSel('Seymour tiles', 'https://seymourcentre.com/what-s-on/all-events/', '.tile h2,.tile h3,.tile .title,.tile a');

  // Comedy Store root
  console.log('\n=== Comedy Store ===');
  const r = await axios.get('https://www.comedystore.com.au/', { headers: H, timeout: 10000 });
  const $ = cheerio.load(r.data);
  const cls = new Set();
  $('[class]').each((_,el) => $(el).attr('class').split(' ').forEach(c => { if(c.length>3 && c.length<50) cls.add(c); }));
  console.log('Classes:', [...cls].slice(0,30).join(', '));
  $('a[href]').each((_,el) => {
    const t = $(el).text().trim();
    const h = $(el).attr('href') || '';
    if(t.length>5 && t.length<80) console.log(' link:', t.slice(0,50), '->', h.slice(0,60));
  });

  // TimeOut — try listing pages that have real event articles
  console.log('\n=== TimeOut article listing ===');
  await probeSel('TimeOut arts', 'https://www.timeout.com/sydney/arts-culture', 'article,h3');
  await probeSel('TimeOut music', 'https://www.timeout.com/sydney/music', 'article,h3');

  // MCA calendar page
  console.log('\n=== MCA calendar ===');
  await probeSel('MCA calendar', 'https://www.mca.com.au/events-programs/calendar/', 'article,.program,[class*="event"],h2,h3');

  // SOH - try Ticketmaster for venue
  console.log('\n=== SOH via Ticketmaster ===');
  await probeSel('TM SOH', 'https://www.ticketmaster.com.au/sydney-opera-house-tickets-sydney/venue/11219', '[class*="EventCard"],h3,[class*="event"]');
})();
