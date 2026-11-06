// Site health for one station: soundscape indices, MODIS vegetation, EMIT scenes and methane plumes.
import { CMR, DAY, ORCA, getJSON, gql } from '../core/api.js';
import { fft } from '../core/dsp.js';
import { $, CLS, EMOJI, ago, cssVar, fmt, h, normCls } from '../core/util.js';
import { hydros } from '../globe/hydrophones.js';
import { empty, map, ready, src } from '../globe/map.js';
import { MIN_N, MIN_S, SBI_WORD, balance, chao1, coverage, diversity, hill1, hill2, median, nGroups, sbiColor } from '../globe/metrics.js';
import { dropPin, pin } from '../globe/pin.js';
import { stations } from '../globe/stations.js';
import { meter, meterScale } from './balance.js';
import { openInfo } from './drawer.js';
import { playHydro, setPlaylist } from '../player.js';

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
let siteToken = 0;
export function selectAt(lat, lon) { ready.then(() => src('now').setData(lat == null ? empty() : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] })); }
function siteLoading(title) { siteEl.replaceChildren(h('div', { class: 'site-head' }, h('h2', {}, title), h('p', {}, 'Loading…'))); openInfo('site'); ready.then(() => src('emit').setData(empty())); }
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

// The Site tab follows the pin: the closest mic's health, a hydrophone's if that is nearer.
let siteFor = null;
export function showClosestSite() {
  if (!pin || siteFor === pin) return;
  const st = pin.near[0], hy = pin.hydros[0];
  if (hy && (!st || hy.km < st.km)) openHydro(hy.hy.id); else if (st) openStation(st.st.id);
}
export async function openStation(id) {
  siteFor = pin;
  const tok = ++siteToken, st = stations.get(id);
  siteLoading(st?.name || 'Station');
  let s;
  try {
    s = (await gql(`query($id:ID!,$p:InputDuration){ station(id:$id){ id name type country location coords{lat lon} latestDetectionAt
      counts(period:$p){ detections species }
      topSpecies(limit:100, period:$p){ count species{ id commonName scientificName thumbnailUrl classification } }
      detections(first:10, validSoundscape:true){ nodes{ id timestamp confidence species{ commonName scientificName thumbnailUrl classification } soundscape{ url startTime endTime } } } } }`, { id, p: DAY })).station;
  } catch (e) { if (tok === siteToken) siteEl.replaceChildren(h('p', { class: 'empty' }, 'Could not load this station: ' + e.message)); return; }
  if (tok !== siteToken || !s) return;

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

export async function openHydro(fid) {
  siteFor = pin;
  const tok = ++siteToken, hy = hydros.get(fid);
  if (!hy) return;
  const { a } = hy;
  openInfo('site');
  const intro = new DOMParser().parseFromString(a.intro_html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').replace(/\*+[^*]*\*+/g, '').trim();
  const dets = h('ul', { class: 'dets' }, h('li', {}, 'Loading…'));
  const others = [...hydros.values()].filter(x => x.id !== fid && x.live);
  siteEl.replaceChildren(
    h('div', { class: 'site-head' }, h('h2', {}, a.name), h('p', {}, `Orcasound hydrophone · ${a.lat_lng.lat.toFixed(3)}, ${a.lat_lng.lng.toFixed(3)} · `, hy.live === false ? `offline${hy.last ? ', last audio ' + ago(hy.last) : ''}` : 'live')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => playHydro(fid) }, '▶ Listen live underwater'),
      hy.live === false && others.length ? h('button', { class: 'btn ghost', onclick: () => { dropPin(others[0].lat, others[0].lon); openHydro(others[0].id); playHydro(others[0].id); } }, `Try ${others[0].a.name} (live)`) : null),
    intro ? h('p', { class: 'note', style: 'margin-top:12px' }, intro.length > 420 ? intro.slice(0, 420).replace(/\s\S*$/, '') + '…' : intro) : null,
    h('div', { class: 'sec' }, h('h3', {}, 'Recent reports', h('small', {}, 'listeners + OrcaHello AI')), dets),
    h('p', { class: 'note', style: 'margin-top:12px' }, 'Hydrophones hear what land mics can\'t: orca and humpback calls, seals, snapping shrimp, and the vessel noise that masks them. In the Field Studio, pick this hydrophone as a mic to record it live.'),
    emitSection(a.lat_lng.lat, a.lat_lng.lng, tok),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `https://live.orcasound.net/listen/${a.slug}`, target: '_blank', rel: 'noopener' }, 'Open on Orcasound ↗')),
  );
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
        if (g.poly) { const ring = g.poly.map(([la, lo]) => [lo, la]); src('emit').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] }); const b = new maplibregl.LngLatBounds(); ring.forEach(p => b.extend(p)); map.fitBounds(b, { padding: 60, duration: 1000 }); }
        preview.hidden = false;
        preview.replaceChildren(
          g.browse ? h('img', { src: g.browse, alt: `EMIT reflectance preview, ${g.t.slice(0, 10)}` }) : h('p', {}, 'No preview image for this scene.'),
          h('p', {}, `False-colour preview in sensor orientation (not north-up), ${g.cloud ?? '?'}% cloud. The full scene holds 285 bands from 380–2500 nm at 60 m: enough to estimate leaf water, pigments, soil minerals and surface water quality. The gold outline on the globe is the scene footprint.`),
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
let plumeMarkers = [], plumeTimer = null, plumesOn = false;
async function loadPlumes() {
  if (!plumesOn) return;
  const b = map.getBounds(), w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()), so = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth());
  const d = await getJSON(`${CMR}?short_name=EMITL2BCH4PLM&bounding_box=${w},${so},${e},${n}&sort_key%5B%5D=-start_date&page_size=300`);
  plumeMarkers.forEach(m => m.remove()); plumeMarkers = [];
  if (!plumesOn) return;
  for (const g of d.feed.entry.map(granule)) {
    if (!g.poly?.length) continue;
    const c = g.poly.reduce((a, p) => [a[0] + p[0] / g.poly.length, a[1] + p[1] / g.poly.length], [0, 0]);
    const pop = new maplibregl.Popup({ offset: 10, className: 'plume-pop' }).setDOMContent(h('div', {}, h('strong', {}, 'EMIT methane plume'), h('br'), new Date(g.t).toLocaleString(),
      g.browse ? h('img', { src: g.browse, alt: 'Methane plume enhancement preview' }) : null,
      h('div', { style: 'margin-top:6px;color:#8fa5a2' }, 'Methane enhancement detected from orbit. Sources include landfills, oil & gas, agriculture and wetlands.')));
    const el = h('div', { class: 'plume-ic', title: 'EMIT methane plume' });
    el.addEventListener('click', ev => ev.stopPropagation());
    plumeMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([c[1], c[0]]).setPopup(pop).addTo(map));
  }
}
$('lyMethane').addEventListener('change', e => { plumesOn = e.target.checked; if (plumesOn) loadPlumes().catch(() => {}); else { plumeMarkers.forEach(m => m.remove()); plumeMarkers = []; } });
map.on('moveend', () => { clearTimeout(plumeTimer); plumeTimer = setTimeout(() => loadPlumes().catch(() => {}), 600); });
