// Recordings from the mics around the pin, and a small decoded-audio cache.
import { gql } from '../core/api.js';
import { $, kmTxt, normCls } from '../core/util.js';
import { clamp } from './util.js';

export const FRAG = `id timestamp confidence species{ id commonName scientificName classification thumbnailUrl } station{ id name country state coords{lat lon} } soundscape{ url startTime endTime duration sampleRate }`;
const DQ = `query($ids:[ID!],$n:Int,$after:String){ detections(first:$n, after:$after, stationIds:$ids, validSoundscape:true){ pageInfo{ hasNextPage endCursor } nodes{ ${FRAG} } } }`;
const DQR = `query($ids:[ID!]){ detections(first:30, stationIds:$ids, validSoundscape:true, classifications:["insect","amphibian","bat","mammal"]){ nodes{ ${FRAG} } } }`;
export const toSnd = n => ({ id: n.id, t: n.timestamp, conf: n.confidence, sp: n.species, cls: normCls(n.species?.classification), st: n.station, sc: n.soundscape });
export const isUltra = s => (s.sc.sampleRate || 48000) > 96000;
export const TX = s => isUltra(s) ? 10 : 1;          // time expansion for bat recordings

export let region = null, pool = [], poolCursor = null, poolMore = false, poolBusy = null, gen = 0, widenDone = -1;
export function resetPool() { pool = []; poolCursor = null; poolMore = false; poolBusy = null; }
// Once the circle can't widen any further for this pin, stop asking.
export const markWidened = () => { widenDone = gen; };
export function setRegion(pin) {
  gen++;
  region = { ...pin, ids: pin.near.map(o => o.st.id) };
  resetPool();
  const n = pin.near.length;
  $('stRegion').textContent = pin.label; $('stRegion').hidden = false;
  $('stRegionSub').textContent = n ? `${n} nearest mic${n > 1 ? 's' : ''}, within ${kmTxt(pin.radius)}${pin.hydros.length ? ` · ${pin.hydros.length} hydrophone${pin.hydros.length > 1 ? 's' : ''}` : ''}` : 'No mics nearby';
  $('stSite').hidden = !n;
  $('stRegionLine').hidden = false;   // (not CSS :has(), which WebKit fails to re-evaluate here)
}
export async function loadPool(more = false) {
  if (poolBusy) return poolBusy;
  const g = gen;
  poolBusy = (async () => {
    const ids = region.ids;
    if (!ids.length) return;
    const [d, extra] = await Promise.all([gql(DQ, { ids, n: 100, after: more ? poolCursor : null }), more ? null : gql(DQR, { ids }).catch(() => null)]);
    if (g !== gen) return;
    poolCursor = d.detections.pageInfo.endCursor; poolMore = d.detections.pageInfo.hasNextPage;
    const seen = new Set(pool.map(x => x.id));
    for (const n of [...(extra?.detections?.nodes || []), ...d.detections.nodes]) if (n.soundscape?.url && !seen.has(n.id)) { seen.add(n.id); pool.push(toSnd(n)); }
  })();
  try { await poolBusy; } finally { poolBusy = null; }
}

// Decoded audio is big, so only the most recent 30 clips stay in memory.
const bufCache = new Map();
export function decode(snd) {
  const url = snd.sc.url;
  if (bufCache.has(url)) { const p = bufCache.get(url); bufCache.delete(url); bufCache.set(url, p); return p; }
  const p = (async () => {
    const sr = clamp(snd.sc.sampleRate || 48000, 8000, 384000);
    const ab = await (await fetch(url)).arrayBuffer();
    return new OfflineAudioContext(1, 1, sr).decodeAudioData(ab);
  })().catch(e => { bufCache.delete(url); throw e; });
  bufCache.set(url, p);
  while (bufCache.size > 30) bufCache.delete(bufCache.keys().next().value);
  return p;
}
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch { out[k] = null; } } }));
  return out;
}
