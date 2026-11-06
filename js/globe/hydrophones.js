// Orcasound hydrophones, live recognition pulses and network counts.
import { DAY, ORCA, getJSON, gql } from '../core/api.js';
import { $, ago, fmt, h } from '../core/util.js';
import { inB, map, ready, src } from './map.js';
import { sbiColor } from './metrics.js';
import { stations } from './stations.js';

export const hydros = new Map();            // feed id -> {id, a, lat, lon, live}
const hydroBase = a => `https://s3-${a.bucket_region || 'us-west-2'}.amazonaws.com/${a.bucket}/${a.node_name}`;
async function drawHydros() { await ready; src('hydros').setData({ type: 'FeatureCollection', features: [...hydros.values()].map(x => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { id: x.id, live: x.live !== false } })) }); }
export async function hydroStatus(hy) {
  try {
    const ts = (await (await fetch(`${hydroBase(hy.a)}/latest.txt`, { cache: 'no-store' })).text()).trim();
    const url = `${hydroBase(hy.a)}/hls/${ts}/live.m3u8`;
    const txt = await (await fetch(url, { cache: 'no-store' })).text();
    const last = [...txt.matchAll(/PROGRAM-DATE-TIME:([^\s]+)/g)].pop()?.[1];
    hy.url = url; hy.last = last; hy.live = !!last && Date.now() - new Date(last) < 10 * 60e3;
  } catch { hy.live = false; }
  drawHydros();
  return hy.live;
}
export async function loadHydros() {
  const d = await getJSON(`${ORCA}/feeds`);
  for (const f of d.data) {
    const a = f.attributes;
    if (!a.visible || !a.lat_lng) continue;
    hydros.set(f.id, { id: f.id, a, lat: a.lat_lng.lat, lon: a.lat_lng.lng, live: null });
  }
  drawHydros();
  $('stHyd').textContent = hydros.size;
  Promise.all([...hydros.values()].map(hydroStatus)).then(r => { $('stHyd').textContent = `${r.filter(Boolean).length}/${r.length}`; $('stHyd').title = 'live / total'; window.dispatchEvent(new Event('biophony:data')); });
}

function pulse(lat, lon, col) {
  if (!inB(map.getBounds(), lat, lon)) return;
  const el = h('div', { class: 'pulse-m' }, h('div', { class: 'pulse', style: `--c:${col}` }));   // MapLibre positions the outer element with transform, so only the inner one animates
  const m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  setTimeout(() => m.remove(), 2500);
}
export const seen = new Set();
export async function pollPulses() {
  const d = await gql(`{ detections(first:14, confidenceGte:0.7){ nodes{ id station{ id coords{lat lon} } } } }`);
  const fresh = d.detections.nodes.filter(n => !seen.has(n.id) && n.station?.coords);
  fresh.forEach((n, i) => { seen.add(n.id); const st = stations.get(n.station.id); setTimeout(() => pulse(n.station.coords.lat, n.station.coords.lon, st?.bal ? sbiColor(st.bal.sbi) : '#cfd8d6'), i * 500); });
}
setInterval(() => document.querySelectorAll('.site time').forEach(t => { t.textContent = ago(t.dataset.t); }), 15000);

export async function loadCounts() {
  const d = await gql(`query($p:InputDuration){ counts(period:$p){ detections species stations } }`, { p: DAY });
  $('stDet').textContent = fmt(d.counts.detections); $('stSpe').textContent = fmt(d.counts.species); $('stSta').textContent = fmt(d.counts.stations); $('stSta').dataset.n = d.counts.stations;
}
