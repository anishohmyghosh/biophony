// Network: BirdWeather GraphQL (queued, rate-limit aware) and plain JSON fetches.

const BW = 'https://app.birdweather.com/graphql';
export const ORCA = 'https://live.orcasound.net/api/json';
export const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json';
export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const DAY = { count: 1, unit: 'day' };

// BirdWeather is free and rate-limits each network. All requests go through one queue
// (at most 4 at a time); if it says "retry after N seconds", everything waits and then carries on.
let gqlActive = 0, pausedUntil = 0;
const gqlQueue = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function gqlNext() { while (gqlActive < 4 && gqlQueue.length) { gqlActive++; gqlQueue.shift()(); } }
export async function gql(query, variables = {}, low = false) {
  await new Promise(r => { low ? gqlQueue.push(r) : gqlQueue.unshift(r); gqlNext(); });
  try {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() < pausedUntil) await sleep(pausedUntil - Date.now());
      const r = await fetch(BW, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      const j = await r.json().catch(() => ({ errors: [{ message: 'HTTP ' + r.status }] }));
      const msg = j.errors?.[0]?.message || '';
      const wait = r.status === 429 || /rate limit/i.test(msg) ? +(msg.match(/(\d+)\s*second/)?.[1] || 30) : 0;
      if (wait && attempt < 8) {   // the server says exactly when to come back, so keep honouring it
        pausedUntil = Math.max(pausedUntil, Date.now() + wait * 1000 + 500);
        window.dispatchEvent(new CustomEvent('biophony:ratelimit', { detail: { until: pausedUntil } }));
        continue;
      }
      if (j.errors) throw new Error(msg);
      return j.data;
    }
  } finally { gqlActive--; gqlNext(); }
}
export const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); };
