// Biophony: live acoustic monitors + NASA views, all from free, keyless public APIs.
const BW = 'https://app.birdweather.com/graphql';
const ORCA = 'https://live.orcasound.net/api/json';
const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const DAY = { count: 1, unit: 'day' };
const CLS = { bird: 'Bird', bat: 'Bat', insect: 'Insect', amphibian: 'Frog', mammal: 'Mammal', whale: 'Underwater' };
const EMOJI = { bird: '🐦', bat: '🦇', insect: '🦗', amphibian: '🐸', mammal: '🐿', whale: '🐋' };

const $ = id => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const fmt = n => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString();
function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
const normCls = c => (c === 'avian' || !c) ? 'bird' : c;
const cssVar = c => `var(--${c in CLS ? c : 'bird'})`;
const COLORS = { bird: '#e3b765', bat: '#b59cf0', insect: '#a7d36a', amphibian: '#5fc7a0', mammal: '#e58c6a', whale: '#6fb3ff' };

async function gql(query, variables = {}) {
  const r = await fetch(BW, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); };

// ---------------- map ----------------
const map = L.map('map', { preferCanvas: true, worldCopyJump: true, minZoom: 2, zoomSnap: 0.5, attributionControl: true }).setView([30, -40], 2.5);
map.attributionControl.setPrefix(false);
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors' }).addTo(map);
map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
map.createPane('sat'); map.getPane('sat').style.zIndex = 250;
L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'labels', opacity: 0.8 }).addTo(map);
const renderer = L.canvas({ padding: 0.3 });

const isoDay = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const SAT = {
  ndvi: { url: `${GIBS}/MODIS_Terra_NDVI_8Day/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`, max: 9, op: 0.75,
    legend: ['Vegetation greenness (NDVI)', 'linear-gradient(90deg,#8c6239,#d9c27a,#9fcf6b,#3f9a3c,#0b4f1c)', 'bare / stressed', 'dense, healthy'] },
  chl: { url: `${GIBS}/OCI_PACE_Chlorophyll_a/default/${isoDay(2)}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, max: 7, op: 0.85,
    legend: [`Chlorophyll-a, ${isoDay(2)} (log scale)`, 'linear-gradient(90deg,#3b0f70,#2c5fbf,#21a0a6,#7ccf5a,#f5d33b,#d7301f)', 'clear, low', 'bloom, high'] },
  true: { url: `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, max: 9, op: 1, legend: null },
};
let satLayer = null;
document.querySelectorAll('input[name=sat]').forEach(r => r.addEventListener('change', () => {
  if (satLayer) { map.removeLayer(satLayer); satLayer = null; }
  const s = SAT[r.value], lg = $('legend');
  lg.hidden = true; lg.replaceChildren();
  if (!s) return;
  satLayer = L.tileLayer(s.url, { pane: 'sat', maxNativeZoom: s.max, maxZoom: 16, opacity: s.op, attribution: 'NASA GIBS' }).addTo(map);
  if (s.legend) {
    const [t, g, a, b] = s.legend;
    lg.append(h('div', {}, t), h('div', { class: 'bar', style: `background:${g}` }), h('div', { class: 'ends' }, h('span', {}, a), h('span', {}, b)));
    lg.hidden = false;
  }
}));

// ---------------- ecological metrics ----------------
// Detection counts per species over 24 h are the abundance proxy (calls, not individuals).
const GROUPS = ['bird', 'bat', 'insect', 'amphibian', 'mammal'];
const MIN_N = 30, MIN_S = 3;
function diversity(list) {               // list: [{n, c}]
  let N = 0; for (const x of list) N += x.n;
  const S = list.length; let H = 0, D = 0, f1 = 0, f2 = 0, mask = 0;
  for (const x of list) {
    const p = x.n / N; if (p > 0) { H -= p * Math.log(p); D += p * p; }
    if (x.n === 1) f1++; else if (x.n === 2) f2++;
    mask |= 1 << Math.max(0, GROUPS.indexOf(x.c));
  }
  return { N, S, H, D, f1, f2, mask };
}
const hill1 = m => Math.exp(m.H);                          // Hill 1973, q = 1
const hill2 = m => m.D ? 1 / m.D : 0;                      // inverse Simpson, q = 2
const pielou = m => m.S > 1 ? m.H / Math.log(m.S) : 0;     // Pielou 1966
const coverage = m => !m.f1 ? 1 : 1 - (m.f1 / m.N) * (((m.N - 1) * m.f1) / ((m.N - 1) * m.f1 + 2 * m.f2));   // Chao & Jost 2012
const chao1 = m => !m.N ? 0 : m.S + ((m.N - 1) / m.N) * (m.f1 * (m.f1 - 1)) / (2 * (m.f2 + 1));                        // bias-corrected Chao1
const nGroups = m => { let k = 0, x = m.mask; while (x) { k += x & 1; x >>= 1; } return k; };
const eligible = m => m && m.N >= MIN_N && m.S >= MIN_S;

// Latitude-band reference distributions of Hill q1, so a boreal site isn't judged against the tropics.
let bands = new Map();
function buildBands() {
  bands = new Map();
  for (const s of stations.values()) if (eligible(s.m)) {
    const b = Math.floor(s.lat / 10);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push(hill1(s.m));
  }
  for (const a of bands.values()) a.sort((x, y) => x - y);
}
const lowerB = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; a[m] < v ? lo = m + 1 : hi = m; } return lo; };
const upperB = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; a[m] <= v ? lo = m + 1 : hi = m; } return lo; };
function latPercentile(lat, v) {
  const b0 = Math.floor(lat / 10);
  for (let k = 0; k <= 4; k++) {
    let tot = 0, below = 0;
    for (let b = b0 - k; b <= b0 + k; b++) { const a = bands.get(b); if (!a) continue; tot += a.length; below += (lowerB(a, v) + upperB(a, v)) / 2; }
    if (tot >= 25 || k === 4) return { p: tot ? below / tot : 0.5, n: tot, span: (2 * k + 1) * 10 };
  }
}
function balance(lat, m) {
  if (!eligible(m)) return null;
  const P = latPercentile(lat, hill1(m)), E = pielou(m), B = Math.min(1, (nGroups(m) - 1) / 2);
  return { sbi: Math.round(100 * (0.5 * P.p + 0.35 * E + 0.15 * B)), D: P.p, E, B, ref: P };
}
const SBI_WORD = v => v >= 65 ? 'Rich' : v >= 50 ? 'Balanced' : v >= 35 ? 'Thin' : 'Low';
// Diverging scale: rust (low) -> neutral grey (50) -> teal (high). Poles validated for CVD on the dark surface.
const LO = [212, 104, 63], MID = [123, 133, 132], HI = [42, 169, 139];
function sbiColor(v) {
  const t = Math.max(0, Math.min(100, v)) / 100, [a, b, u] = t < 0.5 ? [LO, MID, t * 2] : [MID, HI, (t - 0.5) * 2];
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * u)).join(',')})`;
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };

// ---------------- BirdWeather stations ----------------
const stations = new Map();          // id -> {id, lat, lon, name, continent, country, state, marker, m, bal}
const stationLayer = L.layerGroup();
const gridLayer = L.layerGroup().addTo(map);
let viewMode = 'grid';
function addStation(s) {
  if (!s.coords) return null;
  let st = stations.get(s.id);
  if (!st) {
    const m = L.circleMarker([s.coords.lat, s.coords.lon], { renderer, radius: 2.2, stroke: false, fillColor: '#4a5655', fillOpacity: 0.5 });
    st = { id: s.id, lat: s.coords.lat, lon: s.coords.lon, marker: m, m: null, bal: null };
    m.on('click', () => openStation(st.id, true));
    m.bindTooltip(() => `${st.name}${st.bal ? ` · balance ${st.bal.sbi}` : ''}`, { direction: 'top', offset: [0, -4] });
    stationLayer.addLayer(m);
    stations.set(s.id, st);
  }
  st.name = s.name ?? st.name; st.continent = s.continent ?? st.continent; st.country = s.country ?? st.country; st.state = s.state ?? st.state;
  return st;
}
async function loadStations() {
  let after = null;
  for (let page = 0; page < 8; page++) {
    const d = await gql(`query($after:String,$p:InputDuration){ stations(first:2500, after:$after, period:$p){ pageInfo{hasNextPage endCursor} nodes{ id name continent country state coords{lat lon} } } }`, { after, p: DAY });
    d.stations.nodes.forEach(addStation);
    if (!d.stations.pageInfo.hasNextPage) break;
    after = d.stations.pageInfo.endCursor;
  }
}

// Metrics come from per-station species counts, fetched in geographic shards in parallel (view first).
const MQ = `query($ne:InputLocation,$sw:InputLocation,$after:String,$p:InputDuration){ stations(first:500, after:$after, period:$p, ne:$ne, sw:$sw){ pageInfo{hasNextPage endCursor} nodes{ id name continent country state coords{lat lon} topSpecies(limit:100, period:$p){ count species{ classification } } } } }`;
const CACHE_KEY = 'biophony-metrics-v1', CACHE_MS = 40 * 60e3;
let analysed = 0, analysing = false, lastRun = 0;
function setMetrics(st, top) {
  st.m = diversity(top.map(x => ({ n: x.count, c: normCls(x.species?.classification) })));
}
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
    const d = await gql(MQ, { ne: sh.ne, sw: sh.sw, after, p: DAY });
    for (const n of d.stations.nodes) { const st = addStation(n); if (!st) continue; if (!st.m) analysed++; setMetrics(st, n.topSpecies || []); }
    scheduleRefresh();
    if (!d.stations.pageInfo.hasNextPage) break;
    after = d.stations.pageInfo.endCursor;
  }
}
async function analyseAll() {
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
function loadCache() {
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

// Rescore + redraw, throttled while data streams in.
let refreshTimer = null;
function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; rescore(); drawGrid(); renderBalance(); }, 900); }
function rescore() {
  buildBands();
  for (const s of stations.values()) {
    s.bal = balance(s.lat, s.m);
    s.marker.setStyle(s.bal ? { fillColor: sbiColor(s.bal.sbi), fillOpacity: 0.9, radius: 3.4 } : { fillColor: '#4a5655', fillOpacity: 0.45, radius: 2.2 });
  }
}
const cellSize = z => z < 3.5 ? 5 : z < 5 ? 2 : z < 6.5 ? 1 : z < 8 ? 0.5 : 0.25;
function drawGrid() {
  gridLayer.clearLayers();
  if (viewMode !== 'grid') return;
  const cs = cellSize(map.getZoom()), b = map.getBounds().pad(0.3), cells = new Map();
  for (const s of stations.values()) {
    if (!s.bal || !b.contains([s.lat, s.lon])) continue;
    const k = Math.floor(s.lat / cs) + ',' + Math.floor(s.lon / cs);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s.bal.sbi);
  }
  for (const [k, v] of cells) {
    const [i, j] = k.split(',').map(Number), med = Math.round(median(v));
    const r = L.rectangle([[i * cs, j * cs], [(i + 1) * cs, (j + 1) * cs]], { renderer, weight: 1, color: '#0b1314', opacity: 0.9, fillColor: sbiColor(med), fillOpacity: Math.min(0.85, 0.4 + 0.08 * v.length) });
    r.bindTooltip(`Balance ${med} · ${SBI_WORD(med).toLowerCase()} · ${v.length} station${v.length > 1 ? 's' : ''}`, { sticky: true });
    r.on('click', () => map.flyToBounds(r.getBounds().pad(0.6), { duration: 0.8 }));
    gridLayer.addLayer(r);
  }
}
function setView(v) {
  viewMode = v;
  if (v === 'grid') { map.removeLayer(stationLayer); gridLayer.addTo(map); }
  else { gridLayer.clearLayers(); stationLayer.addTo(map); }
  drawGrid();
}
document.querySelectorAll('input[name=view]').forEach(r => r.addEventListener('change', () => setView(r.value)));
map.on('moveend', () => { drawGrid(); renderBalance(); });

// ---------------- balance pane ----------------
const balEl = $('bal');
function meter(v, lo, hi) {
  return h('div', { class: 'meter', role: 'img', 'aria-label': `Balance ${v} of 100${lo != null ? `, middle half of stations ${Math.round(lo)} to ${Math.round(hi)}` : ''}` },
    h('div', { class: 'meter-track sbi-grad' }),
    lo != null ? h('div', { class: 'meter-iqr', style: `left:${lo}%;width:${Math.max(1, hi - lo)}%` }) : null,
    h('div', { class: 'meter-mark', style: `left:${v}%` }),
  );
}
const meterScale = () => h('div', { class: 'meter-scale' }, h('span', {}, '0 · low'), h('span', {}, '50'), h('span', {}, 'rich · 100'));
function histogram(vals) {
  const bins = Array(10).fill(0); vals.forEach(v => bins[Math.min(9, Math.floor(v / 10))]++);
  const mx = Math.max(...bins, 1), W = 300, H = 74, bw = W / 10;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 14}`); svg.setAttribute('class', 'hist'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Distribution of station balance scores: ' + bins.map((n, i) => `${i * 10}–${i * 10 + 10}: ${n}`).join(', '));
  const tip = h('div', { class: 'hist-tip', hidden: true });
  bins.forEach((n, i) => {
    const bh = Math.max(n ? 2 : 0, (n / mx) * (H - 4)), x = i * bw + 1, y = H - bh;
    const r = document.createElementNS(NS, 'path');
    const rr = Math.min(3, bh / 2), w = bw - 2;
    r.setAttribute('d', bh ? `M${x},${H} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${H} Z` : '');
    r.setAttribute('fill', sbiColor(i * 10 + 5));
    const hit = document.createElementNS(NS, 'rect');
    Object.entries({ x: i * bw, y: 0, width: bw, height: H, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v));
    hit.addEventListener('mouseenter', () => { tip.hidden = false; tip.textContent = `${n} station${n === 1 ? '' : 's'} scoring ${i * 10}–${i * 10 + 10}`; tip.style.left = `${((i + 0.5) / 10) * 100}%`; r.setAttribute('opacity', '0.75'); });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; r.removeAttribute('opacity'); });
    svg.append(r, hit);
  });
  const base = document.createElementNS(NS, 'line');
  Object.entries({ x1: 0, x2: W, y1: H + 0.5, y2: H + 0.5, stroke: '#2b4243' }).forEach(([k, v]) => base.setAttribute(k, v));
  svg.append(base);
  [0, 50, 100].forEach(v => { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', (v / 100) * W); t.setAttribute('y', H + 12); t.setAttribute('text-anchor', v === 0 ? 'start' : v === 100 ? 'end' : 'middle'); t.textContent = v; svg.append(t); });
  return h('div', { class: 'hist-wrap' }, svg, tip);
}
function regionKey(inView) {
  const conts = new Set(inView.map(s => s.continent || 'Other'));
  if (conts.size > 1) return [s => s.continent || 'Other', 'continent'];
  const ctry = new Set(inView.map(s => s.country || 'Other'));
  if (ctry.size > 1) return [s => s.country || 'Other', 'country'];
  return [s => s.state || s.country || 'Other', 'region'];
}
let balRaf = 0;
function renderBalance() {
  cancelAnimationFrame(balRaf);
  balRaf = requestAnimationFrame(() => {
    const b = map.getBounds();
    const all = [...stations.values()].filter(s => s.bal);
    const inView = all.filter(s => b.contains([s.lat, s.lon]));
    const total = +($('stSta').dataset.n || stations.size);
    const prog = analysing ? h('div', { class: 'prog' }, h('div', { class: 'prog-bar', style: `width:${Math.min(100, (analysed / Math.max(total, 1)) * 100)}%` }), h('span', {}, `Analysing stations… ${fmt(analysed)} of ~${fmt(total)}`)) : null;
    if (!inView.length) {
      balEl.replaceChildren(prog || '', h('p', { class: 'empty' }, all.length ? 'No stations with enough data in this view. Zoom out or pan to a monitored area.' : 'Gathering 24 hours of recognitions from every station…'));
      return;
    }
    const v = inView.map(s => s.bal.sbi), med = Math.round(median(v)), q1 = quant(v, 0.25), q3 = quant(v, 0.75);
    const netMed = Math.round(median(all.map(s => s.bal.sbi)));
    const diff = med - netMed;
    const comp = (label, val, hint) => h('div', { class: 'metric', title: hint }, h('b', {}, val), h('span', {}, label));
    const [key, level] = regionKey(inView);
    const groups = new Map(); for (const s of inView) { const k = key(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const rows = [...groups.entries()].filter(([, a]) => a.length >= 2).map(([k, a]) => { const sv = a.map(s => s.bal.sbi); return { k, a, n: a.length, med: median(sv), lo: quant(sv, 0.25), hi: quant(sv, 0.75) }; }).sort((x, y) => y.med - x.med).slice(0, 14);
    const lowSites = [...inView].sort((x, y) => x.bal.sbi - y.bal.sbi).slice(0, 3), topSites = [...inView].sort((x, y) => y.bal.sbi - x.bal.sbi).slice(0, 3);
    const siteBtn = s => h('button', { class: 'site-chip', onclick: () => openStation(s.id, true) }, h('i', { style: `background:${sbiColor(s.bal.sbi)}` }), h('span', {}, s.name), h('b', {}, s.bal.sbi));

    balEl.replaceChildren(
      prog || '',
      h('div', { class: 'hero' },
        h('p', { class: 'kicker' }, 'Soundscape balance · stations in view'),
        h('div', { class: 'hero-row' }, h('span', { class: 'hero-n' }, med), h('div', {}, h('p', { class: 'hero-w' }, SBI_WORD(med)),
          h('p', { class: 'hero-s' }, `${fmt(inView.length)} station${inView.length > 1 ? 's' : ''} · ${diff === 0 ? 'level with' : `${Math.abs(diff)} ${diff > 0 ? 'above' : 'below'}`} the network median (${netMed})`))),
        meter(med, q1, q3), meterScale(),
        h('p', { class: 'hint' }, 'The marker is the median; the shaded band covers the middle half of stations.')),
      h('div', { class: 'sec' }, h('h3', {}, 'Distribution', h('small', {}, 'stations by balance score')), histogram(v)),
      h('div', { class: 'metrics m4' },
        comp('effective species', median(inView.map(s => hill1(s.m))).toFixed(1), 'Median Hill number q=1, exp(H′): the number of equally common species that would give the same diversity'),
        comp('evenness J′', median(inView.map(s => pielou(s.m))).toFixed(2), 'Median Pielou evenness'),
        comp('multi-taxa sites', Math.round(100 * inView.filter(s => nGroups(s.m) > 1).length / inView.length) + '%', 'Share of stations also hearing insects, frogs, bats or mammals'),
        comp('sample coverage', Math.round(100 * median(inView.map(s => coverage(s.m)))) + '%', 'Median Good–Turing sample coverage (Chao & Jost 2012): how complete each 24 h sample is')),
      rows.length ? h('div', { class: 'sec' }, h('h3', {}, `By ${level}`, h('small', {}, 'median and middle half')),
        h('ul', { class: 'regions' }, rows.map(r => h('li', {}, h('button', { onclick: () => map.flyToBounds(L.latLngBounds(r.a.map(s => [s.lat, s.lon])).pad(0.15), { duration: 1 }) },
          h('span', { class: 'r-name' }, r.k, h('small', {}, ` ${r.n}`)),
          h('span', { class: 'r-plot' }, h('i', { class: 'r-iqr', style: `left:${r.lo}%;width:${Math.max(1, r.hi - r.lo)}%` }), h('i', { class: 'r-dot', style: `left:${r.med}%;background:${sbiColor(r.med)}` })),
          h('b', {}, Math.round(r.med))))))) : null,
      h('div', { class: 'sec two' },
        h('div', {}, h('h3', {}, 'Richest here'), ...topSites.map(siteBtn)),
        h('div', {}, h('h3', {}, 'Thinnest here'), ...lowSites.map(siteBtn))),
      h('p', { class: 'note', style: 'margin-top:16px' }, 'Each station\'s score blends diversity (Hill q1, compared with stations at similar latitude), evenness (Pielou J′) and taxonomic breadth over the last 24 hours. Open a station for its full site health, including soundscape noise and vegetation from NASA MODIS. Methods and references are in About.'),
    );
  });
}

// ---------------- Orcasound hydrophones ----------------
const hydros = new Map();            // feed id -> {attrs, marker, live}
const hydroLayer = L.layerGroup().addTo(map);
const hydroBase = a => `https://s3-${a.bucket_region || 'us-west-2'}.amazonaws.com/${a.bucket}/${a.node_name}`;
async function hydroStatus(hy) {
  try {
    const ts = (await (await fetch(`${hydroBase(hy.a)}/latest.txt`, { cache: 'no-store' })).text()).trim();
    const url = `${hydroBase(hy.a)}/hls/${ts}/live.m3u8`;
    const txt = await (await fetch(url, { cache: 'no-store' })).text();
    const last = [...txt.matchAll(/PROGRAM-DATE-TIME:([^\s]+)/g)].pop()?.[1];
    hy.url = url; hy.last = last; hy.live = !!last && Date.now() - new Date(last) < 10 * 60e3;
  } catch { hy.live = false; }
  hy.marker.getElement()?.querySelector('.hydro-ic')?.classList.toggle('off', !hy.live);
  return hy.live;
}
async function loadHydros() {
  const d = await getJSON(`${ORCA}/feeds`);
  for (const f of d.data) {
    const a = f.attributes;
    if (!a.visible || !a.lat_lng) continue;
    const m = L.marker([a.lat_lng.lat, a.lat_lng.lng], { icon: L.divIcon({ className: '', html: '<div class="hydro-ic"></div>', iconSize: [0, 0] }), keyboard: true, title: a.name });
    const hy = { id: f.id, a, marker: m, live: null };
    m.on('click', () => { openHydro(f.id); playHydro(f.id); });
    m.bindTooltip(() => `${a.name} · hydrophone${hy.live === false ? ' · offline' : hy.live ? ' · live' : ''}`, { direction: 'top', offset: [0, -8] });
    hydroLayer.addLayer(m);
    hydros.set(f.id, hy);
  }
  $('stHyd').textContent = hydros.size;
  Promise.all([...hydros.values()].map(hydroStatus)).then(r => { $('stHyd').textContent = `${r.filter(Boolean).length}/${r.length}`; $('stHyd').title = 'live / total'; });
}
$('lyHydro').addEventListener('change', e => e.target.checked ? hydroLayer.addTo(map) : map.removeLayer(hydroLayer));

function pulse(lat, lon, col) {
  if (!map.getBounds().pad(0.2).contains([lat, lon])) return;
  const p = L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: `<div class="pulse" style="--c:${col}"></div>`, iconSize: [0, 0] }) }).addTo(map);
  setTimeout(() => map.removeLayer(p), 2500);
}

// Faint live pulses: the network is listening, without listing every bird.
const seen = new Set();
async function pollPulses() {
  const d = await gql(`{ detections(first:14, confidenceGte:0.7){ nodes{ id station{ id coords{lat lon} } } } }`);
  const fresh = d.detections.nodes.filter(n => !seen.has(n.id) && n.station?.coords);
  fresh.forEach((n, i) => { seen.add(n.id); const st = stations.get(n.station.id); setTimeout(() => pulse(n.station.coords.lat, n.station.coords.lon, st?.bal ? sbiColor(st.bal.sbi) : '#cfd8d6'), i * 500); });
}
setInterval(() => document.querySelectorAll('.site time').forEach(t => { t.textContent = ago(t.dataset.t); }), 15000);

async function loadCounts() {
  const d = await gql(`query($p:InputDuration){ counts(period:$p){ detections species stations } }`, { p: DAY });
  $('stDet').textContent = fmt(d.counts.detections); $('stSpe').textContent = fmt(d.counts.species); $('stSta').textContent = fmt(d.counts.stations); $('stSta').dataset.n = d.counts.stations;
}

// ---------------- tabs ----------------
function showTab(t) {
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + t; });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));

// ---------------- soundscape indices (computed in the browser from the station's clips) ----------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const SR = 44100, NFFT = 1024, HZ = SR / NFFT;
async function soundscapeIndices(urls) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const win = new Float32Array(NFFT).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (NFFT - 1)));
  const K = NFFT / 2, psd = new Float64Array(K);
  const bandHit = new Float64Array(10), bandAll = new Float64Array(10);
  let Ht = 0, clips = 0, secs = 0;
  for (const url of urls) {
    let x;
    try { x = (await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0); } catch { continue; }
    if (x.length < NFFT * 4) continue;
    clips++; secs += x.length / SR;
    // temporal entropy of the amplitude envelope (Sueur et al. 2008)
    let sa = 0; for (let i = 0; i < x.length; i++) sa += Math.abs(x[i]);
    let ht = 0; if (sa > 0) for (let i = 0; i < x.length; i++) { const p = Math.abs(x[i]) / sa; if (p > 0) ht -= p * Math.log(p); }
    Ht += ht / Math.log(x.length);
    const frames = [], re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    let peak = 1e-12;
    for (let o = 0; o + NFFT <= x.length; o += NFFT) {
      for (let i = 0; i < NFFT; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      const mag = new Float32Array(K);
      for (let k = 0; k < K; k++) { mag[k] = Math.hypot(re[k], im[k]); psd[k] += mag[k] * mag[k]; if (mag[k] > peak) peak = mag[k]; }
      frames.push(mag);
    }
    // Acoustic Diversity Index: share of cells above -50 dB (re clip max) in ten 1 kHz bands (Villanueva-Rivera et al. 2011)
    const thr = peak * Math.pow(10, -50 / 20);
    for (const mag of frames) for (let k = 1; k < K; k++) { const b = Math.floor(k * HZ / 1000); if (b > 9) break; bandAll[b]++; if (mag[k] > thr) bandHit[b]++; }
  }
  if (!clips) return null;
  const band = (lo, hi) => { let s = 0; for (let k = 0; k < K; k++) { const f = k * HZ; if (f >= lo && f < hi) s += psd[k]; } return s; };
  const anthro = band(1000, 2000), bio = band(2000, 11000);
  const ndsi = (bio - anthro) / (bio + anthro || 1);                       // Kasten et al. 2012
  const props = [...bandHit].map((n, i) => bandAll[i] ? n / bandAll[i] : 0), ps = props.reduce((a, b) => a + b, 0);
  let adi = 0; if (ps > 0) for (const p of props) { const q = p / ps; if (q > 0) adi -= q * Math.log(q); }
  let st = 0; for (let k = 0; k < K; k++) st += Math.sqrt(psd[k]);
  let hf = 0; for (let k = 0; k < K; k++) { const p = Math.sqrt(psd[k]) / st; if (p > 0) hf -= p * Math.log(p); }
  hf /= Math.log(K);
  return { ndsi, adi, H: (Ht / clips) * hf, clips, secs };
}

// ---------------- vegetation: MODIS NDVI + Vegetation Condition Index ----------------
const MODIS = 'https://modis.ornl.gov/rst/api/v1/MOD13Q1';
async function vegetation(lat, lon) {
  const q = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  const dates = (await getJSON(`${MODIS}/dates?${q}`)).dates.map(d => d.modis_date);
  const last = dates.at(-1), doy = last.slice(5), yr = +last.slice(1, 5), have = new Set(dates);
  const want = []; for (let y = yr; y >= yr - 9; y--) { const md = `A${y}${doy}`; if (have.has(md)) want.push(md); }
  const vals = await Promise.all(want.map(md => getJSON(`${MODIS}/subset?${q}&band=250m_16_days_NDVI&startDate=${md}&endDate=${md}&kmAboveBelow=1&kmLeftRight=1`)
    .then(r => { const px = (r.subset?.[0]?.data || []).filter(v => v > -2000); return px.length ? median(px) * 1e-4 : null; }).catch(() => null)));
  const now = vals[0], hist = vals.filter(v => v != null);
  if (now == null || hist.length < 3) return now == null ? null : { now, vci: null, years: hist.length, date: last };
  const mn = Math.min(...hist), mx = Math.max(...hist);
  return { now, vci: mx - mn > 0.02 ? (now - mn) / (mx - mn) : 0.5, years: hist.length, date: new Date(Date.UTC(yr, 0, +doy)).toISOString().slice(0, 10), mn, mx };
}

// ---------------- site panel ----------------
const siteEl = $('site');
let selRing = null, footprint = null, siteToken = 0;
function selectAt(lat, lon) {
  if (selRing) map.removeLayer(selRing);
  selRing = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 2, fill: false, interactive: false }).addTo(map);
  if (footprint) { map.removeLayer(footprint); footprint = null; }
}
function siteLoading(title) { siteEl.replaceChildren(h('div', { class: 'site-head' }, h('h2', {}, title), h('p', {}, 'Loading…'))); showTab('site'); }
const bar = (label, v, txt, hint) => h('div', { class: 'pillar', title: hint || '' },
  h('span', { class: 'pl' }, label),
  h('span', { class: 'pt' }, v != null ? h('i', { style: `width:${Math.max(2, v)}%;background:${sbiColor(v)}` }) : h('i', { class: 'na' })),
  h('span', { class: 'pv' }, txt));

function clipItem(n, s) {
  return async () => n.soundscape?.url ? {
    sc: n.soundscape, title: `${n.species.commonName} · ${s.name}`,
    sub: `BirdNET ${Math.round(n.confidence * 100)}% · ${new Date(n.timestamp).toLocaleString()}`,
  } : null;
}

async function openStation(id, autoplay = false) {
  const tok = ++siteToken, st = stations.get(id);
  siteLoading(st?.name || 'Station');
  if (st) { selectAt(st.lat, st.lon); if (map.getZoom() < 5) map.flyTo([st.lat, st.lon], 7, { duration: 1.2 }); }
  let s;
  try {
    s = (await gql(`query($id:ID!,$p:InputDuration){ station(id:$id){ id name type country location coords{lat lon} latestDetectionAt
      counts(period:$p){ detections species }
      topSpecies(limit:100, period:$p){ count species{ id commonName scientificName thumbnailUrl classification } }
      detections(first:10, validSoundscape:true){ nodes{ id timestamp confidence species{ commonName scientificName thumbnailUrl classification } soundscape{ url startTime endTime } } } } }`, { id, p: DAY })).station;
  } catch (e) { if (tok === siteToken) siteEl.replaceChildren(h('p', { class: 'empty' }, 'Could not load this station: ' + e.message)); return; }
  if (tok !== siteToken || !s) return;
  if (!st && s.coords) { selectAt(s.coords.lat, s.coords.lon); map.flyTo([s.coords.lat, s.coords.lon], 7); }

  const top = s.topSpecies || [], total = top.reduce((a, x) => a + x.count, 0);
  const m = diversity(top.map(x => ({ n: x.count, c: normCls(x.species.classification) })));
  const bal = balance(s.coords.lat, m);
  const byCls = {}; for (const x of top) { const c = normCls(x.species.classification); byCls[c] = (byCls[c] || 0) + x.count; }
  const dets = s.detections?.nodes || [];

  // Combined site health: mean of the pillars that are available.
  const pillars = { bio: bal?.sbi ?? null, sound: undefined, veg: undefined };
  const healthBox = h('div', { class: 'health' });
  const soundTxt = h('div', { class: 'idx' }, h('p', { class: 'note' }, dets.length ? `Analysing ${Math.min(6, dets.length)} recent clips in your browser…` : 'No recent audio to analyse.'));
  const vegTxt = h('div', { class: 'idx' }, h('p', { class: 'note' }, 'Fetching MODIS greenness for this spot…'));
  const drawHealth = () => {
    const have = Object.values(pillars).filter(v => v != null);
    const pending = Object.values(pillars).some(v => v === undefined);
    const score = have.length ? Math.round(have.reduce((a, b) => a + b, 0) / have.length) : null;
    healthBox.replaceChildren(
      h('div', { class: 'hero-row' }, h('span', { class: 'hero-n' }, score ?? '–'), h('div', {}, h('p', { class: 'hero-w' }, score != null ? SBI_WORD(score) : 'Not enough data'),
        h('p', { class: 'hero-s' }, `Site health · ${have.length} of 3 measures${pending ? ', more loading…' : ''}`))),
      score != null ? meter(score) : null, score != null ? meterScale() : null,
      h('div', { class: 'pillars' },
        bar('Biodiversity', pillars.bio, pillars.bio != null ? String(pillars.bio) : 'too little data', 'Soundscape Balance Index from 24 h of recognitions'),
        bar('Soundscape', pillars.sound ?? null, pillars.sound === undefined ? '…' : pillars.sound == null ? 'n/a' : String(pillars.sound), 'NDSI rescaled to 0–100: high when biological sound outweighs traffic/machine noise'),
        bar('Vegetation', pillars.veg ?? null, pillars.veg === undefined ? '…' : pillars.veg == null ? 'n/a' : String(pillars.veg), 'MODIS Vegetation Condition Index: greenness vs the same date in past years')),
    );
  };
  drawHealth();

  const max = top[0]?.count || 1;
  siteEl.replaceChildren(
    h('div', { class: 'site-head' }, h('h2', {}, s.name),
      h('p', {}, [s.location, s.country].filter(Boolean).join(', ') || `${s.coords.lat.toFixed(2)}, ${s.coords.lon.toFixed(2)}`, ' · BirdWeather ', s.type === 'puc' ? 'PUC' : s.type, ' · last heard ', h('time', { 'data-t': s.latestDetectionAt }, ago(s.latestDetectionAt)))),
    h('div', { class: 'row' }, dets.length ? h('button', { class: 'btn', onclick: () => setPlaylist(dets.map(n => clipItem(n, s)), 'station') }, '▶ Play recent clips') : null),
    h('div', { class: 'sec' }, h('h3', {}, 'Site health', h('small', {}, 'sound + vegetation')), healthBox),
    h('div', { class: 'sec' }, h('h3', {}, 'Biodiversity', h('small', {}, `${fmt(s.counts?.detections)} recognitions, 24 h`)),
      bal ? h('div', { class: 'pillars' },
        bar('Diversity', Math.round(bal.D * 100), `${Math.round(bal.D * 100)}th pct`, `Hill q1 percentile among ${bal.ref.n} stations within ${bal.ref.span}° latitude band`),
        bar('Evenness', Math.round(bal.E * 100), bal.E.toFixed(2), 'Pielou J′'),
        bar('Breadth', Math.round(bal.B * 100), `${nGroups(m)} group${nGroups(m) > 1 ? 's' : ''}`, 'Animal groups heard: birds, insects, frogs, bats, mammals')) :
        h('p', { class: 'note' }, `Not enough recognitions for a reliable score (needs ${MIN_N}+ recognitions and ${MIN_S}+ species in 24 h).`),
      h('div', { class: 'metrics m4' },
        h('div', { class: 'metric', title: 'Observed species richness (Hill q0)' }, h('b', {}, m.S), h('span', {}, 'species')),
        h('div', { class: 'metric', title: 'Hill q1 = exp(H′): effective number of species' }, h('b', {}, hill1(m).toFixed(1)), h('span', {}, 'effective q1')),
        h('div', { class: 'metric', title: 'Hill q2 = 1/Σp²: effective number of dominant species (inverse Simpson)' }, h('b', {}, hill2(m).toFixed(1)), h('span', {}, 'dominant q2')),
        h('div', { class: 'metric', title: 'Bias-corrected Chao1 estimate of total richness' }, h('b', {}, Math.round(chao1(m))), h('span', {}, 'Chao1 est.'))),
      h('p', { class: 'hint' }, `Shannon H′ ${m.H.toFixed(2)} · sample coverage ${Math.round(coverage(m) * 100)}% · `,
        hill2(m) < hill1(m) / 2 ? 'a few species dominate what this microphone hears.' : 'activity is spread across many species.')),
    h('div', { class: 'sec' }, h('h3', {}, 'Soundscape', h('small', {}, 'acoustic indices from recent clips')), soundTxt),
    h('div', { class: 'sec' }, h('h3', {}, 'Vegetation', h('small', {}, 'NASA MODIS, 250 m')), vegTxt),
    Object.keys(byCls).length ? h('div', { class: 'sec' }, h('h3', {}, 'Who is calling', h('small', {}, 'share of detections')),
      h('div', { class: 'taxa' }, Object.entries(byCls).map(([c, n]) => h('span', { style: `--c:${cssVar(c)};width:${(n / total) * 100}%`, title: `${CLS[c] || c}: ${n}` }))),
      h('div', { class: 'taxa-key' }, Object.entries(byCls).map(([c, n]) => h('span', {}, h('i', { style: `--c:${cssVar(c)}` }), `${CLS[c] || c} ${Math.round((n / total) * 100)}%`)))) : null,
    h('div', { class: 'sec' }, h('h3', {}, 'Top species', h('small', {}, 'last 24 h')),
      h('ul', { class: 'sp' }, top.slice(0, 10).map(x => h('li', {},
        x.species.thumbnailUrl ? h('img', { src: x.species.thumbnailUrl, alt: '', loading: 'lazy' }) : h('span', {}, EMOJI[normCls(x.species.classification)] || ''),
        h('div', {}, x.species.commonName, h('div', { class: 'bar', style: `width:${(x.count / max) * 100}%;--c:${cssVar(normCls(x.species.classification))}` })),
        h('span', { class: 'n' }, x.count))))),
    h('div', { class: 'sec' }, h('h3', {}, 'Latest recognitions', h('small', {}, 'tap to listen')),
      h('ul', { class: 'dets' }, dets.map((n, i) => h('li', { class: 'clickable', onclick: () => setPlaylist(dets.map(x => clipItem(x, s)), 'station', i) },
        h('span', {}, '▸ ', n.species.commonName), h('span', {}, h('time', { 'data-t': n.timestamp }, ago(n.timestamp))))))),
    emitSection(s.coords.lat, s.coords.lon, tok),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `https://app.birdweather.com/stations/${s.id}`, target: '_blank', rel: 'noopener' }, 'Open on BirdWeather ↗')),
  );
  if (autoplay && dets.length) setPlaylist(dets.map(n => clipItem(n, s)), 'station');

  // async measurements
  const urls = [...new Set(dets.map(n => n.soundscape?.url).filter(Boolean))].slice(0, 6);
  (urls.length ? soundscapeIndices(urls) : Promise.resolve(null)).then(r => {
    if (tok !== siteToken) return;
    pillars.sound = r ? Math.round(((r.ndsi + 1) / 2) * 100) : null;
    soundTxt.replaceChildren(r ? h('div', { class: 'metrics' },
      h('div', { class: 'metric', title: 'Normalized Difference Soundscape Index, −1 (all machine/traffic band) to +1 (all biological band)' }, h('b', {}, (r.ndsi >= 0 ? '+' : '') + r.ndsi.toFixed(2)), h('span', {}, 'NDSI')),
      h('div', { class: 'metric', title: 'Acoustic Diversity Index: Shannon index across ten 1 kHz bands (max ln 10 = 2.30)' }, h('b', {}, r.adi.toFixed(2)), h('span', {}, 'ADI')),
      h('div', { class: 'metric', title: 'Acoustic entropy H = Ht × Hf, 0 (pure tone) to 1 (white noise)' }, h('b', {}, r.H.toFixed(2)), h('span', {}, 'entropy H'))) : h('p', { class: 'note' }, 'Could not analyse audio for this station.'),
      r ? h('p', { class: 'hint' }, `${r.clips} clips, ${Math.round(r.secs)} s of audio. `, r.ndsi > 0.5 ? 'Biological sound clearly outweighs the traffic and machinery band.' : r.ndsi > 0 ? 'Biological sound leads, with noticeable low-frequency noise.' : 'The 1–2 kHz band, where traffic and machinery sit, outweighs the biological band.', ' Clips are saved when a bird is recognised, so these lean biological.') : null);
    drawHealth();
  }).catch(() => { if (tok === siteToken) { pillars.sound = null; soundTxt.replaceChildren(h('p', { class: 'note' }, 'Could not analyse audio.')); drawHealth(); } });

  vegetation(s.coords.lat, s.coords.lon).then(v => {
    if (tok !== siteToken) return;
    pillars.veg = v?.vci != null ? Math.round(v.vci * 100) : null;
    vegTxt.replaceChildren(v ? h('div', { class: 'metrics' },
      h('div', { class: 'metric', title: 'Median NDVI in a ~2 km box around the station' }, h('b', {}, v.now.toFixed(2)), h('span', {}, 'NDVI now')),
      h('div', { class: 'metric', title: 'Vegetation Condition Index (Kogan 1995): 0 = lowest greenness for this date in the record, 1 = highest' }, h('b', {}, v.vci != null ? v.vci.toFixed(2) : '–'), h('span', {}, 'VCI')),
      h('div', { class: 'metric' }, h('b', {}, v.years), h('span', {}, 'years compared'))) : h('p', { class: 'note' }, 'No MODIS vegetation data here.'),
      v ? h('p', { class: 'hint' }, `16-day composite from ${v.date}. `, v.now < 0.15 ? 'Little vegetation: urban, bare ground, snow or water. ' : v.now > 0.6 ? 'Dense green vegetation. ' : '',
        v.vci == null ? '' : v.vci < 0.35 ? 'Greenness is near the low end for this time of year, which can signal drought or disturbance.' : v.vci > 0.65 ? 'Greener than usual for this time of year.' : 'Greenness is typical for this time of year.') : null);
    drawHealth();
  }).catch(() => { if (tok === siteToken) { pillars.veg = null; vegTxt.replaceChildren(h('p', { class: 'note' }, 'Could not reach MODIS right now.')); drawHealth(); } });
}

async function openHydro(fid) {
  const tok = ++siteToken, hy = hydros.get(fid);
  if (!hy) return;
  const { a } = hy;
  selectAt(a.lat_lng.lat, a.lat_lng.lng);
  if (map.getZoom() < 6) map.flyTo([a.lat_lng.lat, a.lat_lng.lng], 8, { duration: 1.2 });
  const intro = new DOMParser().parseFromString(a.intro_html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').replace(/\*+[^*]*\*+/g, '').trim();
  const dets = h('ul', { class: 'dets' }, h('li', {}, 'Loading…'));
  const others = [...hydros.values()].filter(x => x.id !== fid && x.live);
  siteEl.replaceChildren(
    h('div', { class: 'site-head' }, h('h2', {}, a.name), h('p', {}, `Orcasound hydrophone · ${a.lat_lng.lat.toFixed(3)}, ${a.lat_lng.lng.toFixed(3)} · `, hy.live === false ? `offline${hy.last ? ', last audio ' + ago(hy.last) : ''}` : 'live')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => playHydro(fid) }, '▶ Listen live underwater'),
      hy.live === false && others.length ? h('button', { class: 'btn ghost', onclick: () => { openHydro(others[0].id); playHydro(others[0].id); } }, `Try ${others[0].a.name} (live)`) : null),
    intro ? h('p', { class: 'note', style: 'margin-top:12px' }, intro.length > 420 ? intro.slice(0, 420).replace(/\s\S*$/, '') + '…' : intro) : null,
    h('div', { class: 'sec' }, h('h3', {}, 'Recent reports', h('small', {}, 'listeners + OrcaHello AI')), dets),
    h('p', { class: 'note', style: 'margin-top:12px' }, 'For water health here, switch the layer to Ocean chlorophyll (PACE): high chlorophyll means more phytoplankton, the base of the food web orcas and salmon depend on, but very high values can mean blooms.'),
    emitSection(a.lat_lng.lat, a.lat_lng.lng, tok),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `https://live.orcasound.net/listen/${a.slug}`, target: '_blank', rel: 'noopener' }, 'Open on Orcasound ↗')),
  );
  showTab('site');
  try {
    const d = await getJSON(`${ORCA}/detections?filter%5Bfeed_id%5D=${encodeURIComponent(fid)}&page%5Blimit%5D=12&sort=-timestamp`);
    if (tok !== siteToken) return;
    dets.replaceChildren(...(d.data.length ? d.data.map(x => h('li', {},
      h('span', {}, `${ORCA_LABEL[x.attributes.category] || x.attributes.category}`, x.attributes.source === 'machine' ? ' · AI' : '', x.attributes.description ? ` · ${x.attributes.description.slice(0, 60)}` : ''),
      h('span', {}, h('time', { 'data-t': x.attributes.timestamp }, ago(x.attributes.timestamp))))) : [h('li', {}, 'No reports yet.')]));
  } catch { dets.replaceChildren(h('li', {}, 'Could not load reports.')); }
}
const ORCA_LABEL = { whale: 'Whale call', vessel: 'Vessel noise', other: 'Other sound' };
// ---------------- EMIT ----------------
function parsePoly(p) {
  const n = String(p).trim().split(/\s+/).map(Number), pts = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  return pts;
}
function granule(e) {
  const links = e.links || [];
  return {
    title: e.title, t: e.time_start, cloud: e.cloud_cover != null ? Math.round(+e.cloud_cover) : null,
    poly: e.polygons?.[0]?.[0] ? parsePoly(e.polygons[0][0]) : null,
    browse: links.find(l => l.href.startsWith('https') && /\.(png|jpe?g)$/i.test(l.href))?.href,
    data: links.find(l => l.href.startsWith('https') && /\/EMIT_L2A_RFL_\d+_[^/]+\.nc$/.test(l.href))?.href,
    concept: e.collection_concept_id,
  };
}
function emitSection(lat, lon, tok) {
  const box = h('div', { class: 'sec' }, h('h3', {}, 'EMIT from orbit', h('small', {}, 'NASA imaging spectrometer on the ISS')));
  if (Math.abs(lat) > 52) { box.append(h('p', { class: 'note' }, 'Outside EMIT coverage. The ISS orbit only reaches about 52° north and south.')); return box; }
  const body = h('div', {}, h('p', { class: 'note' }, 'Searching NASA CMR for EMIT scenes over this site…'));
  box.append(body);
  (async () => {
    try {
      const [rfl, plm] = await Promise.all([
        getJSON(`${CMR}?short_name=EMITL2ARFL&point=${lon},${lat}&sort_key%5B%5D=-start_date&page_size=8`),
        getJSON(`${CMR}?short_name=EMITL2BCH4PLM&bounding_box=${lon - 1},${lat - 1},${lon + 1},${lat + 1}&page_size=50`).catch(() => null),
      ]);
      if (tok !== siteToken) return;
      const scenes = rfl.feed.entry.map(granule);
      const nPlm = plm?.feed?.entry?.length || 0;
      if (!scenes.length) { body.replaceChildren(h('p', { class: 'note' }, 'No EMIT reflectance scenes cover this exact point yet. EMIT samples Earth unevenly as the ISS passes over.')); return; }
      const preview = h('div', { class: 'browse', hidden: true });
      const list = h('ul', { class: 'scenes' });
      const pick = (g, btn) => {
        list.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
        if (footprint) map.removeLayer(footprint);
        if (g.poly) { footprint = L.polygon(g.poly, { color: '#e3b765', weight: 1.5, fillOpacity: 0.08, dashArray: '4 4', interactive: false }).addTo(map); map.flyToBounds(footprint.getBounds().pad(0.25), { duration: 1 }); }
        preview.hidden = false;
        preview.replaceChildren(
          g.browse ? h('img', { src: g.browse, alt: `EMIT reflectance preview, ${g.t.slice(0, 10)}` }) : h('p', {}, 'No preview image for this scene.'),
          h('p', {}, `False-colour preview in sensor orientation (not north-up), ${g.cloud ?? '?'}% cloud. The full scene holds 285 bands from 380–2500 nm at 60 m: enough to estimate leaf water, pigments, soil minerals and surface water quality. The gold outline on the map is the scene footprint.`),
          h('div', { class: 'row' },
            g.data ? h('a', { class: 'btn ghost', href: g.data, target: '_blank', rel: 'noopener' }, 'Reflectance data (.nc) ↗') : null,
            h('a', { class: 'btn ghost', href: `https://search.earthdata.nasa.gov/search/granules?p=${g.concept}&q=${encodeURIComponent(g.title)}`, target: '_blank', rel: 'noopener' }, 'Earthdata Search ↗')),
          h('p', {}, 'Downloading the data needs a free NASA Earthdata login; searching and previews don\'t.'));
      };
      scenes.forEach(g => {
        const b = h('button', {}, h('span', {}, new Date(g.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })),
          h('span', { class: 'cloud' }, g.cloud != null ? `${g.cloud}% cloud` : 'cloud ?', h('i', { style: `--p:${g.cloud ?? 0}%` })));
        b.addEventListener('click', () => pick(g, b));
        list.append(h('li', {}, b));
      });
      const best = scenes.reduce((a, g) => (g.cloud ?? 100) < (a.cloud ?? 100) ? g : a, scenes[0]);
      body.replaceChildren(
        h('p', { class: 'note' }, `${scenes.length === 8 ? '8+' : scenes.length} recent scenes cover this site. Clearest: ${new Date(best.t).toLocaleDateString()} (${best.cloud ?? '?'}% cloud). `,
          nPlm ? `${nPlm} EMIT methane plume detection${nPlm > 1 ? 's' : ''} within ~100 km.` : 'No EMIT methane plumes detected within ~100 km.'),
        h('div', { style: 'margin-top:8px' }, list), preview);
    } catch (e) { if (tok === siteToken) body.replaceChildren(h('p', { class: 'note' }, 'Could not reach NASA CMR right now.')); }
  })();
  return box;
}

// Methane plumes in view
const plumeLayer = L.layerGroup();
let plumeTimer = null;
async function loadPlumes() {
  if (!map.hasLayer(plumeLayer)) return;
  const b = map.getBounds(), w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()), s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth());
  const d = await getJSON(`${CMR}?short_name=EMITL2BCH4PLM&bounding_box=${w},${s},${e},${n}&sort_key%5B%5D=-start_date&page_size=300`);
  plumeLayer.clearLayers();
  for (const g of d.feed.entry.map(granule)) {
    if (!g.poly?.length) continue;
    const c = g.poly.reduce((a, p) => [a[0] + p[0] / g.poly.length, a[1] + p[1] / g.poly.length], [0, 0]);
    const m = L.marker(c, { icon: L.divIcon({ className: '', html: '<div class="plume-ic"></div>', iconSize: [0, 0] }), title: 'EMIT methane plume' });
    m.bindPopup(() => h('div', {}, h('strong', {}, 'EMIT methane plume'), h('br'), new Date(g.t).toLocaleString(),
      g.browse ? h('img', { src: g.browse, alt: 'Methane plume enhancement preview' }) : null,
      h('div', { style: 'margin-top:6px;color:#8fa5a2' }, 'Methane concentration enhancement detected from orbit. Sources include landfills, oil & gas, agriculture and wetlands.')));
    plumeLayer.addLayer(m);
  }
}
$('lyMethane').addEventListener('change', e => { if (e.target.checked) { plumeLayer.addTo(map); loadPlumes().catch(() => {}); } else map.removeLayer(plumeLayer); });
map.on('moveend', () => { clearTimeout(plumeTimer); plumeTimer = setTimeout(() => loadPlumes().catch(() => {}), 600); });

// ---------------- player: playlists, live streams, soundscape tour ----------------
const audio = $('audio'), pbtn = $('pbtn'), pnext = $('pnext'), canvas = $('spec'), g2 = canvas.getContext('2d');
let actx, analyser, gain, hls = null, clipEnd = null, raf = 0;
let playlist = [], pi = -1, pmode = 'idle', ptok = 0, advancing = false;
function ensureAudio() {
  if (actx) { actx.resume(); return; }
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const src = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.2; analyser.minDecibels = -100; analyser.maxDecibels = -25;
  gain = actx.createGain(); gain.gain.value = +$('vol').value;
  src.connect(analyser); analyser.connect(gain); gain.connect(actx.destination);
  actx.resume();
  drawTicks();
}
function stopHls() { if (hls) { hls.destroy(); hls = null; } }
function setNow(title, sub) { $('ptitle').textContent = title; $('psub').textContent = sub; }
function setBusy(on) { $('player').classList.toggle('busy', on); }

async function startClip(d) {
  ensureAudio(); stopHls();
  clipEnd = d.sc.endTime != null ? d.sc.endTime + 1.5 : null;
  const pos = playlist.length > 1 ? ` · ${pi + 1} of ${playlist.length}` : '';
  setNow(d.title, d.sub + pos); setBusy(true);
  if (d.lat != null) selectAt(d.lat, d.lon);
  audio.src = d.sc.url;
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, (d.sc.startTime || 0) - 0.75); }, { once: true });
  try { await audio.play(); }
  catch (e) { setBusy(false); if (e.name !== 'AbortError') { $('psub').textContent = 'Could not play this clip, skipping…'; setTimeout(advance, 900); } }
}
async function playIndex(i) {
  const tok = ++ptok;
  pnext.disabled = false;
  for (; i < playlist.length; i++) {
    setBusy(true);
    let d = null; try { d = await playlist[i](); } catch { }
    if (tok !== ptok) return;
    if (d) { pi = i; await startClip(d); return; }
  }
  setBusy(false); pi = playlist.length; pnext.disabled = true;
  setNow(pmode === 'tour' ? 'Tour finished' : 'End of clips', 'Press play for a soundscape tour of the sites in view');
  pmode = 'idle';
}
function setPlaylist(items, mode, start = 0) {
  playlist = items; pmode = mode; pi = -1;
  ensureAudio();
  playIndex(start);
}
function advance() { if (advancing || pmode === 'live' || pmode === 'idle') return; advancing = true; setTimeout(() => { advancing = false; playIndex(pi + 1); }, 500); }

// Tour: the stations in view, from richest to thinnest balance, one recent clip each.
function startTour() {
  const b = map.getBounds();
  let list = [...stations.values()].filter(s => s.bal && b.contains([s.lat, s.lon])).sort((x, y) => y.bal.sbi - x.bal.sbi);
  if (!list.length) list = [...stations.values()].filter(s => s.bal).sort((x, y) => y.bal.sbi - x.bal.sbi);
  if (list.length > 30) { const step = list.length / 30; list = Array.from({ length: 30 }, (_, i) => list[Math.floor(i * step)]); }
  if (!list.length) { setNow('Soundscape tour', 'Still gathering station data, try again in a moment'); return; }
  setPlaylist(list.map(st => async () => {
    const d = (await gql(`query($id:ID!){ station(id:$id){ detections(first:3, validSoundscape:true){ nodes{ timestamp confidence species{ commonName } soundscape{ url startTime endTime } } } } }`, { id: st.id })).station;
    const n = d?.detections?.nodes?.find(x => x.soundscape?.url);
    return n ? { sc: n.soundscape, lat: st.lat, lon: st.lon, title: `${st.name} · balance ${st.bal.sbi}`, sub: `${n.species.commonName}, ${ago(n.timestamp)}` } : null;
  }), 'tour');
}

async function playHydro(fid) {
  const hy = hydros.get(fid); if (!hy) return;
  const tok = ++ptok;
  ensureAudio(); stopHls(); audio.pause(); clipEnd = null; pmode = 'live'; pnext.disabled = true;
  setNow(`${hy.a.name} · live hydrophone`, 'Connecting to the stream…'); setBusy(true);
  try {
    const live = await hydroStatus(hy);
    if (tok !== ptok) return;
    if (!live) {
      const alt = [...hydros.values()].find(x => x.live);
      setBusy(false); pmode = 'idle';
      setNow(`${hy.a.name} · offline`, hy.last ? `No audio since ${ago(hy.last)}${alt ? `. Try ${alt.a.name}, it's live.` : '.'}` : `Stream unavailable${alt ? `. Try ${alt.a.name}, it's live.` : '.'}`);
      return;
    }
    if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(audio); }
    else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = hy.url;
    else throw new Error('HLS unsupported');
    await audio.play();
    $('psub').textContent = 'Live from the Salish Sea · whales, vessels, seals, snapping shrimp';
  } catch (e) { if (tok === ptok) { setBusy(false); pmode = 'idle'; $('psub').textContent = 'Stream unavailable right now.'; } }
}
audio.addEventListener('timeupdate', () => { if (clipEnd && audio.currentTime > clipEnd && !audio.paused) { audio.pause(); advance(); } });
audio.addEventListener('ended', () => advance());
audio.addEventListener('playing', () => setBusy(false));
audio.addEventListener('waiting', () => setBusy(true));
audio.addEventListener('play', () => { $('icPlay').hidden = true; $('icStop').hidden = false; pbtn.setAttribute('aria-label', 'Pause'); loop(); });
audio.addEventListener('pause', () => { $('icPlay').hidden = false; $('icStop').hidden = true; pbtn.setAttribute('aria-label', 'Play'); setBusy(false); });
pbtn.addEventListener('click', () => {
  if (!audio.paused) { ++ptok; audio.pause(); return; }
  if (pmode === 'idle' || (!audio.src && !hls)) { startTour(); return; }
  ensureAudio();
  if (clipEnd && audio.currentTime > clipEnd - 0.1) { playIndex(pi + 1); return; }
  audio.play().catch(() => {});
});
pnext.addEventListener('click', () => { if (pmode !== 'live') playIndex(pi + 1); });
$('vol').addEventListener('input', e => { if (gain) gain.gain.value = +e.target.value; });
// colour map: night -> teal -> gold -> white
const LUT = (() => {
  const stops = [[0, [7, 16, 17]], [0.35, [20, 70, 80]], [0.6, [60, 170, 150]], [0.82, [227, 183, 101]], [1, [255, 248, 230]]];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255; let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ca] = stops[k], [b, cb] = stops[k + 1], t = (v - a) / (b - a);
    for (let j = 0; j < 3; j++) out[i * 3 + j] = ca[j] + (cb[j] - ca[j]) * t;
  }
  return out;
})();
const FMIN = 60;
function sizeCanvas() { const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); canvas.width = Math.max(1, r.width * dpr | 0); canvas.height = Math.max(1, r.height * dpr | 0); g2.fillStyle = '#071011'; g2.fillRect(0, 0, canvas.width, canvas.height); drawTicks(); }
function drawTicks() {
  const el = $('ticks'), ny = actx ? actx.sampleRate / 2 : 24000, H = canvas.getBoundingClientRect().height;
  el.replaceChildren(...[100, 1000, 10000].filter(f => f < ny).map(f => {
    const y = H - (Math.log(f / FMIN) / Math.log(ny / FMIN)) * H;
    return h('span', { style: `top:${y}px` }, f >= 1000 ? f / 1000 + 'k' : f);
  }));
}
new ResizeObserver(sizeCanvas).observe(canvas);
let bins;
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (audio.paused || !analyser) return;
    const W = canvas.width, H = canvas.height, ny = actx.sampleRate / 2, N = analyser.frequencyBinCount;
    if (!bins || bins.length !== N) bins = new Uint8Array(N);
    analyser.getByteFrequencyData(bins);
    const dx = 2;
    g2.drawImage(canvas, dx, 0, W - dx, H, 0, 0, W - dx, H);
    const col = g2.createImageData(dx, H);
    for (let y = 0; y < H; y++) {
      const f = FMIN * Math.pow(ny / FMIN, (H - 1 - y) / (H - 1));
      const v = bins[Math.min(N - 1, Math.round((f / ny) * N))];
      for (let x = 0; x < dx; x++) { const o = (y * dx + x) * 4; col.data[o] = LUT[v * 3]; col.data[o + 1] = LUT[v * 3 + 1]; col.data[o + 2] = LUT[v * 3 + 2]; col.data[o + 3] = 255; }
    }
    g2.putImageData(col, W - dx, 0);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// ---------------- polling + visibility ----------------
const timers = [];
function setLive(ok) { $('liveDot').classList.toggle('on', ok); $('liveText').textContent = ok ? 'live' : 'reconnecting…'; }
function startPolling() {
  stopPolling();
  timers.push(setInterval(() => pollPulses().then(() => setLive(true)).catch(() => setLive(false)), 8000));
  timers.push(setInterval(() => loadCounts().catch(() => {}), 60000));
  timers.push(setInterval(() => { if (Date.now() - lastRun > CACHE_MS) analyseAll(); }, 60000));
}
function stopPolling() { timers.splice(0).forEach(clearInterval); }
let resumeAudio = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPolling(); resumeAudio = !audio.paused; if (resumeAudio) audio.pause(); }
  else { startPolling(); if (resumeAudio) { resumeAudio = false; audio.play().catch(() => {}); } }
});

// ---------------- boot ----------------
if (innerWidth < 640) document.querySelector('.layers').open = false;
(async () => {
  loadCounts().then(scheduleRefresh).catch(() => {});
  loadHydros().catch(() => {});
  pollPulses().then(() => setLive(true)).catch(() => setLive(false));
  startPolling();
  if (loadCache()) scheduleRefresh();
  else { analyseAll(); scheduleRefresh(); }
  loadStations().then(scheduleRefresh).catch(() => {});
})();
