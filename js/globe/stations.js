// BirdWeather stations: loading, per-station metrics, cache, and drawing as dots or a grid.
import { DAY, gql } from '../core/api.js';
import { $, normCls } from '../core/util.js';
import { empty, map, ready, src } from './map.js';
import { balance, buildBands, diversity, median, sbiColor } from './metrics.js';
import { renderBalance } from '../info/balance.js';

export const stations = new Map();          // id -> {id, lat, lon, name, continent, country, state, m, bal}
export let viewMode = 'sites';
function addStation(s) {
  if (!s.coords) return null;
  let st = stations.get(s.id);
  if (!st) { st = { id: s.id, lat: s.coords.lat, lon: s.coords.lon, m: null, bal: null }; stations.set(s.id, st); }
  st.name = s.name ?? st.name; st.continent = s.continent ?? st.continent; st.country = s.country ?? st.country; st.state = s.state ?? st.state;
  return st;
}
export async function loadStations() {
  let after = null;
  for (let page = 0; page < 8; page++) {
    const d = await gql(`query($after:String,$p:InputDuration){ stations(first:2500, after:$after, period:$p){ pageInfo{hasNextPage endCursor} nodes{ id name continent country state coords{lat lon} } } }`, { after, p: DAY });
    d.stations.nodes.forEach(addStation);
    if (!d.stations.pageInfo.hasNextPage) break;
    after = d.stations.pageInfo.endCursor;
  }
}

const MQ = `query($ne:InputLocation,$sw:InputLocation,$after:String,$p:InputDuration){ stations(first:500, after:$after, period:$p, ne:$ne, sw:$sw){ pageInfo{hasNextPage endCursor} nodes{ id name continent country state coords{lat lon} topSpecies(limit:100, period:$p){ count species{ classification } } } } }`;
export const CACHE_KEY = 'biophony-metrics-v1', CACHE_MS = 2 * 3600e3;   // scores use 24 h of data, so a 2 h cache is plenty
export let analysed = 0, analysing = false, lastRun = 0;
function setMetrics(st, top) { st.m = diversity(top.map(x => ({ n: x.count, c: normCls(x.species?.classification) }))); }
function shards() {
  const out = [], lats = [[-90, 0], [0, 30], [30, 42], [42, 52], [52, 90]];
  for (let lon = -180; lon < 180; lon += 30) for (const [s, n] of lats) out.push({ sw: { lat: s, lon }, ne: { lat: n, lon: lon + 30 } });
  const c = map.getCenter(), lonC = ((c.lng + 540) % 360) - 180;
  const dist = x => Math.hypot((x.sw.lat + x.ne.lat) / 2 - c.lat, Math.min(Math.abs((x.sw.lon + 15) - lonC), 360 - Math.abs((x.sw.lon + 15) - lonC)));
  return out.sort((a, b) => dist(a) - dist(b));
}
async function runShard(sh) {
  let after = null;
  for (let page = 0; page < 20; page++) {
    const d = await gql(MQ, { ne: sh.ne, sw: sh.sw, after, p: DAY }, true);
    for (const n of d.stations.nodes) { const st = addStation(n); if (!st) continue; if (!st.m) analysed++; setMetrics(st, n.topSpecies || []); }
    scheduleRefresh();
    if (!d.stations.pageInfo.hasNextPage) break;
    after = d.stations.pageInfo.endCursor;
  }
}
export async function analyseAll() {
  if (analysing) return;
  analysing = true; lastRun = Date.now();
  const queue = shards();
  const worker = async () => { while (queue.length) { const sh = queue.shift(); await runShard(sh).catch(() => runShard(sh).catch(() => {})); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  analysing = false;
  saveCache(); scheduleRefresh();
}
function saveCache() {
  try {
    const d = {};
    for (const s of stations.values()) if (s.m) { const m = s.m; d[s.id] = [s.lat, s.lon, m.N, m.S, +m.H.toFixed(4), +m.D.toFixed(5), m.f1, m.f2, m.mask, s.name, s.continent, s.country, s.state]; }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: lastRun, d }));
  } catch { }
}
export function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || Date.now() - c.t > CACHE_MS) return false;
    for (const [id, a] of Object.entries(c.d)) {
      const st = addStation({ id, name: a[9], continent: a[10], country: a[11], state: a[12], coords: { lat: a[0], lon: a[1] } });
      st.m = { N: a[2], S: a[3], H: a[4], D: a[5], f1: a[6], f2: a[7], mask: a[8] };
    }
    analysed = Object.keys(c.d).length; lastRun = c.t;
    return true;
  } catch { return false; }
}

let refreshTimer = null;
export function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; rescore(); drawStations(); drawGrid(); renderBalance(); window.dispatchEvent(new Event('biophony:data')); }, 900); }
function rescore() { buildBands(); for (const s of stations.values()) s.bal = balance(s.lat, s.m); }
async function drawStations() {
  await ready;
  src('stations').setData({ type: 'FeatureCollection', features: [...stations.values()].map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: s.bal ? { id: s.id, s: s.bal.sbi } : { id: s.id } })) });
}
const cellSize = z => z < 2.5 ? 5 : z < 4 ? 2 : z < 5.5 ? 1 : z < 7 ? 0.5 : 0.25;
async function drawGrid() {
  await ready;
  if (viewMode !== 'grid') { src('grid').setData(empty()); return; }
  const cs = cellSize(map.getZoom()), cells = new Map();
  for (const s of stations.values()) {
    if (!s.bal) continue;
    const k = Math.floor(s.lat / cs) + ',' + Math.floor(s.lon / cs);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s.bal.sbi);
  }
  src('grid').setData({ type: 'FeatureCollection', features: [...cells].map(([k, v]) => {
    const [i, j] = k.split(',').map(Number), med = Math.round(median(v)), a = j * cs, b = i * cs;
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[a, b], [a + cs, b], [a + cs, b + cs], [a, b + cs], [a, b]]] }, properties: { c: sbiColor(med), o: Math.min(0.85, 0.4 + 0.08 * v.length), med, n: v.length } };
  }) });
}
function setView(v) {
  viewMode = v;
  ready.then(() => { map.setLayoutProperty('grid', 'visibility', v === 'grid' ? 'visible' : 'none'); map.setPaintProperty('stations', 'circle-opacity', v === 'grid' ? 0.25 : ['case', ['has', 's'], 0.95, 0.55]); drawGrid(); });
}
document.querySelectorAll('input[name=view]').forEach(r => r.addEventListener('change', () => setView(r.value)));
let lastCell = 0;
map.on('moveend', () => { const c = cellSize(map.getZoom()); if (viewMode === 'grid' && c !== lastCell) drawGrid(); lastCell = c; if (!$('info').hidden) renderBalance(); });
