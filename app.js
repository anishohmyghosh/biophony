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

// ---------------- BirdWeather stations ----------------
const stations = new Map();          // id -> {lat, lon, marker}
const stationLayer = L.layerGroup().addTo(map);
async function loadStations() {
  let after = null, n = 0;
  for (let page = 0; page < 8; page++) {
    const d = await gql(`query($after:String,$p:InputDuration){ stations(first:2500, after:$after, period:$p){ pageInfo{hasNextPage endCursor} nodes{ id name coords{lat lon} } } }`, { after, p: DAY });
    for (const s of d.stations.nodes) {
      if (!s.coords || stations.has(s.id)) continue;
      const m = L.circleMarker([s.coords.lat, s.coords.lon], { renderer, radius: 2.4, stroke: false, fillColor: '#e3b765', fillOpacity: 0.5 });
      m.on('click', () => openStation(s.id));
      m.bindTooltip(s.name, { direction: 'top', offset: [0, -4] });
      stationLayer.addLayer(m);
      stations.set(s.id, { lat: s.coords.lat, lon: s.coords.lon, marker: m, name: s.name });
      n++;
    }
    if (!d.stations.pageInfo.hasNextPage) break;
    after = d.stations.pageInfo.endCursor;
  }
  return n;
}
$('lyStations').addEventListener('change', e => e.target.checked ? stationLayer.addTo(map) : map.removeLayer(stationLayer));

// ---------------- Orcasound hydrophones ----------------
const hydros = new Map();            // feed id -> {attrs, marker}
const hydroLayer = L.layerGroup().addTo(map);
async function loadHydros() {
  const d = await getJSON(`${ORCA}/feeds`);
  for (const f of d.data) {
    const a = f.attributes;
    if (!a.visible || !a.lat_lng) continue;
    const m = L.marker([a.lat_lng.lat, a.lat_lng.lng], { icon: L.divIcon({ className: '', html: '<div class="hydro-ic"></div>', iconSize: [0, 0] }), keyboard: true, title: a.name });
    m.on('click', () => openHydro(f.id));
    m.bindTooltip(`${a.name} · hydrophone`, { direction: 'top', offset: [0, -8] });
    hydroLayer.addLayer(m);
    hydros.set(f.id, { id: f.id, a, marker: m });
  }
  $('stHyd').textContent = hydros.size;
}
$('lyHydro').addEventListener('change', e => e.target.checked ? hydroLayer.addTo(map) : map.removeLayer(hydroLayer));

function pulse(lat, lon, cls) {
  if (!map.getBounds().pad(0.2).contains([lat, lon])) return;
  const p = L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: `<div class="pulse" style="--c:${COLORS[cls] || COLORS.bird}"></div>`, iconSize: [0, 0] }) }).addTo(map);
  setTimeout(() => map.removeLayer(p), 2500);
}

// ---------------- filters ----------------
const active = new Set(Object.keys(CLS));
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  const k = c.dataset.c, on = !active.has(k);
  on ? active.add(k) : active.delete(k);
  c.classList.toggle('on', on); c.setAttribute('aria-pressed', on);
  document.querySelectorAll('#feed li').forEach(li => { li.hidden = !active.has(li.dataset.c); });
}));

// ---------------- live feed ----------------
const feedEl = $('feed'), seen = new Set(), MAX_FEED = 90;
const DET_Q = `query($c:[String!],$n:Int){ detections(first:$n, classifications:$c, confidenceGte:0.7, validSoundscape:true){ nodes{
  id timestamp confidence species{ id commonName scientificName thumbnailUrl classification }
  station{ id name country coords{lat lon} } soundscape{ url startTime endTime } } } }`;

function feedItem(d) {
  const cls = d.cls;
  const li = h('li', { 'data-c': cls, tabindex: 0, title: d.audio ? 'Play this recognition' : 'Listen to this hydrophone live' },
    d.img ? h('img', { class: 'thumb', src: d.img, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb' }, EMOJI[cls]),
    h('div', {},
      h('div', { class: 'f-name' }, d.name, d.sci ? h('em', {}, d.sci) : null),
      h('div', { class: 'f-where' }, h('button', { onclick: e => { e.stopPropagation(); d.open(); } }, d.where), d.country ? ` · ${d.country}` : '')),
    h('div', { class: 'f-meta' }, h('span', { class: 'tag', style: `--c:${cssVar(cls)}` }, CLS[cls] || 'Sound'), h('br'), d.conf != null ? `${Math.round(d.conf * 100)}% · ` : '', h('time', { 'data-t': d.t }, ago(d.t))));
  li.hidden = !active.has(cls);
  const go = () => { d.play(); markPlaying(li); };
  li.addEventListener('click', go);
  li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  return li;
}
function markPlaying(li) { feedEl.querySelectorAll('.playing').forEach(x => x.classList.remove('playing')); li?.classList.add('playing'); }
function pushFeed(items, stagger) {
  items.sort((a, b) => new Date(a.t) - new Date(b.t));
  items.forEach((d, i) => {
    const add = () => {
      feedEl.prepend(feedItem(d));
      while (feedEl.children.length > MAX_FEED) feedEl.lastElementChild.remove();
      if (d.lat != null) pulse(d.lat, d.lon, d.cls);
    };
    stagger ? setTimeout(add, i * (stagger / items.length)) : add();
  });
}
function bwToItem(n) {
  const cls = normCls(n.species?.classification);
  const st = n.station;
  return {
    id: 'bw' + n.id, cls, t: n.timestamp, name: n.species?.commonName || 'Unknown', sci: n.species?.scientificName,
    img: n.species?.thumbnailUrl, where: st?.name || 'Station', country: st?.country, conf: n.confidence,
    lat: st?.coords?.lat, lon: st?.coords?.lon, audio: n.soundscape?.url,
    open: () => openStation(st.id),
    play: () => playClip(n.soundscape, `${n.species?.commonName} · ${st?.name || ''}`, `${CLS[cls] || 'Sound'} recognised by BirdNET, ${Math.round(n.confidence * 100)}% confidence · ${new Date(n.timestamp).toLocaleString()}`),
  };
}
async function pollBW(first = 14, stagger = 0) {
  const d = await gql(DET_Q, { c: null, n: first });   // unfiltered is fastest; filtering happens client-side
  const fresh = d.detections.nodes.filter(n => !seen.has('bw' + n.id));
  fresh.forEach(n => seen.add('bw' + n.id));
  pushFeed(fresh.map(bwToItem), stagger);
}
// Rarer groups get their own small query so birds don't drown them out.
async function pollRare() {
  const c = ['bat', 'insect', 'amphibian', 'mammal'].filter(k => active.has(k));
  if (!c.length) return;
  const d = await gql(DET_Q, { c, n: 6 });
  const fresh = d.detections.nodes.filter(n => !seen.has('bw' + n.id));
  fresh.forEach(n => seen.add('bw' + n.id));
  pushFeed(fresh.map(bwToItem), 4000);
}
const ORCA_LABEL = { whale: 'Whale call', vessel: 'Vessel noise', other: 'Other sound' };
async function pollOrca(n = 8) {
  const d = await getJSON(`${ORCA}/detections?page%5Blimit%5D=${n}&sort=-timestamp`);
  const items = [];
  for (const x of d.data) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const fid = x.relationships?.feed?.data?.id, hy = hydros.get(fid);
    if (!hy) continue;
    const a = x.attributes;
    items.push({
      id: x.id, cls: 'whale', t: a.timestamp, name: ORCA_LABEL[a.category] || 'Sound',
      sci: a.source === 'machine' ? 'OrcaHello AI' : 'listener report', where: hy.a.name, country: 'Salish Sea',
      lat: hy.a.lat_lng.lat, lon: hy.a.lat_lng.lng, open: () => openHydro(fid), play: () => { openHydro(fid); playHydro(fid); },
    });
  }
  pushFeed(items, 0);
}
setInterval(() => document.querySelectorAll('#feed time, .site time').forEach(t => { t.textContent = ago(t.dataset.t); }), 15000);

async function loadCounts() {
  const d = await gql(`query($p:InputDuration){ counts(period:$p){ detections species stations } }`, { p: DAY });
  $('stDet').textContent = fmt(d.counts.detections); $('stSpe').textContent = fmt(d.counts.species); $('stSta').textContent = fmt(d.counts.stations);
}

// ---------------- tabs ----------------
function showTab(t) {
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + t; });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));

// ---------------- site panel ----------------
const siteEl = $('site');
let selRing = null, footprint = null, siteToken = 0;
function selectAt(lat, lon) {
  if (selRing) map.removeLayer(selRing);
  selRing = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 2, fill: false, interactive: false }).addTo(map);
  if (footprint) { map.removeLayer(footprint); footprint = null; }
}
function siteLoading(title) { siteEl.replaceChildren(h('div', { class: 'site-head' }, h('h2', {}, title), h('p', {}, 'Loading…'))); showTab('site'); }

async function openStation(id) {
  const tok = ++siteToken, st = stations.get(id);
  siteLoading(st?.name || 'Station');
  if (st) { selectAt(st.lat, st.lon); if (map.getZoom() < 5) map.flyTo([st.lat, st.lon], 7, { duration: 1.2 }); }
  let s;
  try {
    s = (await gql(`query($id:ID!,$p:InputDuration){ station(id:$id){ id name type country location coords{lat lon} latestDetectionAt
      counts(period:$p){ detections species }
      topSpecies(limit:100, period:$p){ count species{ id commonName scientificName thumbnailUrl classification } }
      detections(first:8, validSoundscape:true){ nodes{ id timestamp confidence species{ commonName scientificName thumbnailUrl classification } soundscape{ url startTime endTime } } } } }`, { id, p: DAY })).station;
  } catch (e) { if (tok === siteToken) siteEl.replaceChildren(h('p', { class: 'empty' }, 'Could not load this station: ' + e.message)); return; }
  if (tok !== siteToken || !s) return;
  if (!st && s.coords) { selectAt(s.coords.lat, s.coords.lon); map.flyTo([s.coords.lat, s.coords.lon], 7); }

  const top = s.topSpecies || [], total = top.reduce((a, x) => a + x.count, 0);
  const S = s.counts?.species ?? top.length;
  let H = 0; for (const x of top) { const p = x.count / total; if (p > 0) H -= p * Math.log(p); }
  const J = top.length > 1 ? H / Math.log(top.length) : 0;
  const byCls = {}; for (const x of top) { const c = normCls(x.species.classification); byCls[c] = (byCls[c] || 0) + x.count; }

  const max = top[0]?.count || 1;
  siteEl.replaceChildren(
    h('div', { class: 'site-head' }, h('h2', {}, s.name),
      h('p', {}, [s.location, s.country].filter(Boolean).join(', ') || `${s.coords.lat.toFixed(2)}, ${s.coords.lon.toFixed(2)}`, ' · BirdWeather ', s.type === 'puc' ? 'PUC' : s.type, ' · last heard ', h('time', { 'data-t': s.latestDetectionAt }, ago(s.latestDetectionAt)))),
    h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('b', {}, S), h('span', {}, 'species, 24 h')),
      h('div', { class: 'metric', title: 'Shannon diversity index H′ from 24 h detection counts' }, h('b', {}, H.toFixed(2)), h('span', {}, 'Shannon H′')),
      h('div', { class: 'metric', title: 'Pielou evenness J′ = H′ / ln(S)' }, h('b', {}, J.toFixed(2)), h('span', {}, 'evenness J′'))),
    h('p', { class: 'note' }, `${fmt(s.counts?.detections)} recognitions in 24 h (${Math.round((s.counts?.detections || 0) / 24)}/hour). `,
      J > 0.75 ? 'Activity is spread across many species.' : J > 0.5 ? 'A few species lead, with a varied supporting cast.' : 'A handful of species dominate what this microphone hears.'),
    Object.keys(byCls).length ? h('div', { class: 'sec' }, h('h3', {}, 'Who is calling', h('small', {}, 'share of detections')),
      h('div', { class: 'taxa' }, Object.entries(byCls).map(([c, n]) => h('span', { style: `--c:${cssVar(c)};width:${(n / total) * 100}%`, title: `${CLS[c] || c}: ${n}` }))),
      h('div', { class: 'taxa-key' }, Object.entries(byCls).map(([c, n]) => h('span', {}, h('i', { style: `--c:${cssVar(c)}` }), `${CLS[c] || c} ${Math.round((n / total) * 100)}%`)))) : null,
    h('div', { class: 'sec' }, h('h3', {}, 'Top species', h('small', {}, 'last 24 h')),
      h('ul', { class: 'sp' }, top.slice(0, 10).map(x => h('li', {},
        x.species.thumbnailUrl ? h('img', { src: x.species.thumbnailUrl, alt: '', loading: 'lazy' }) : h('span', {}, EMOJI[normCls(x.species.classification)] || ''),
        h('div', {}, x.species.commonName, h('div', { class: 'bar', style: `width:${(x.count / max) * 100}%;--c:${cssVar(normCls(x.species.classification))}` })),
        h('span', { class: 'n' }, x.count))))),
    h('div', { class: 'sec' }, h('h3', {}, 'Latest recognitions', h('small', {}, 'tap to listen')),
      h('ul', { class: 'dets' }, (s.detections?.nodes || []).map(n => h('li', { style: 'cursor:pointer', onclick: () => playClip(n.soundscape, `${n.species.commonName} · ${s.name}`, `${Math.round(n.confidence * 100)}% confidence · ${new Date(n.timestamp).toLocaleString()}`) },
        h('span', {}, '▸ ', n.species.commonName), h('span', {}, h('time', { 'data-t': n.timestamp }, ago(n.timestamp))))))),
    emitSection(s.coords.lat, s.coords.lon, tok),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `https://app.birdweather.com/stations/${s.id}`, target: '_blank', rel: 'noopener' }, 'Open on BirdWeather ↗')),
  );
}

async function openHydro(fid) {
  const tok = ++siteToken, hy = hydros.get(fid);
  if (!hy) return;
  const { a } = hy;
  selectAt(a.lat_lng.lat, a.lat_lng.lng);
  if (map.getZoom() < 6) map.flyTo([a.lat_lng.lat, a.lat_lng.lng], 8, { duration: 1.2 });
  const intro = new DOMParser().parseFromString(a.intro_html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').replace(/\*+[^*]*\*+/g, '').trim();
  const dets = h('ul', { class: 'dets' }, h('li', {}, 'Loading…'));
  siteEl.replaceChildren(
    h('div', { class: 'site-head' }, h('h2', {}, a.name), h('p', {}, `Orcasound hydrophone · ${a.lat_lng.lat.toFixed(3)}, ${a.lat_lng.lng.toFixed(3)}`)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => playHydro(fid) }, '▶ Listen live underwater')),
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

// ---------------- player + spectrogram ----------------
const audio = $('audio'), pbtn = $('pbtn'), canvas = $('spec'), g2 = canvas.getContext('2d');
let actx, analyser, gain, hls = null, clipEnd = null, raf = 0, hasSource = false;
function ensureAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const src = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.2; analyser.minDecibels = -100; analyser.maxDecibels = -25;
  gain = actx.createGain(); gain.gain.value = +$('vol').value;
  src.connect(analyser); analyser.connect(gain); gain.connect(actx.destination);
  drawTicks();
}
function stopHls() { if (hls) { hls.destroy(); hls = null; } }
function setNow(title, sub) { $('ptitle').textContent = title; $('psub').textContent = sub; pbtn.disabled = false; hasSource = true; }
async function playClip(sc, title, sub) {
  if (!sc?.url) return;
  ensureAudio(); actx.resume(); stopHls();
  clipEnd = sc.endTime != null ? sc.endTime + 1.5 : null;
  audio.src = sc.url;
  setNow(title, sub);
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, (sc.startTime || 0) - 0.75); }, { once: true });
  try { await audio.play(); } catch (e) { $('psub').textContent = 'Could not play this clip.'; }
}
async function playHydro(fid) {
  const hy = hydros.get(fid); if (!hy) return;
  ensureAudio(); actx.resume(); stopHls(); clipEnd = null;
  const base = `https://s3-${hy.a.bucket_region || 'us-west-2'}.amazonaws.com/${hy.a.bucket}/${hy.a.node_name}`;
  setNow(`${hy.a.name} · live hydrophone`, 'Connecting to the stream…');
  try {
    const ts = (await (await fetch(`${base}/latest.txt`, { cache: 'no-store' })).text()).trim();
    const url = `${base}/hls/${ts}/live.m3u8`;
    const txt = await (await fetch(url, { cache: 'no-store' })).text();
    const last = [...txt.matchAll(/PROGRAM-DATE-TIME:([^\s]+)/g)].pop()?.[1];
    if (last && Date.now() - new Date(last) > 10 * 60e3) { $('psub').textContent = `Offline · last audio ${ago(last)}`; return; }
    if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(url); hls.attachMedia(audio); }
    else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = url;
    else throw new Error('HLS unsupported');
    await audio.play();
    $('psub').textContent = 'Live from the Salish Sea · whales, vessels, seals, snapping shrimp';
  } catch (e) { $('psub').textContent = 'Stream unavailable right now.'; }
}
audio.addEventListener('timeupdate', () => { if (clipEnd && audio.currentTime > clipEnd) audio.pause(); });
audio.addEventListener('play', () => { $('icPlay').hidden = true; $('icStop').hidden = false; pbtn.setAttribute('aria-label', 'Pause'); loop(); });
audio.addEventListener('pause', () => { $('icPlay').hidden = false; $('icStop').hidden = true; pbtn.setAttribute('aria-label', 'Play'); });
pbtn.addEventListener('click', () => {
  if (!hasSource) return;
  if (audio.paused) { actx?.resume(); if (clipEnd && audio.currentTime > clipEnd - 0.1) audio.currentTime = Math.max(0, clipEnd - 6); audio.play(); }
  else audio.pause();
});
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
  timers.push(setInterval(() => pollBW(14, 7000).then(() => setLive(true)).catch(() => setLive(false)), 8000));
  timers.push(setInterval(() => pollRare().catch(() => {}), 30000));
  timers.push(setInterval(() => pollOrca().catch(() => {}), 45000));
  timers.push(setInterval(() => loadCounts().catch(() => {}), 60000));
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
  loadCounts().catch(() => {});
  await loadHydros().catch(() => {});
  await Promise.all([
    pollBW(20, 0).then(() => setLive(true)).catch(() => setLive(false)),
    pollRare().catch(() => {}),
    pollOrca(6).catch(() => {}),
  ]);
  startPolling();
  loadStations().catch(() => {});
})();
