// Hover tips, globe clicks and the pin: the nearest mics around a point.
import { h, km } from '../core/util.js';
import { hydros } from './hydrophones.js';
import { empty, map, ready, src } from './map.js';
import { SBI_WORD } from './metrics.js';
import { stations, viewMode } from './stations.js';
import { onPin, playHydro, setNow } from '../player.js';

export const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip', offset: 8 });
function hover(layer, text) {
  map.on('mousemove', layer, e => { map.getCanvas().style.cursor = 'pointer'; const t = text(e.features[0]); if (t) tip.setLngLat(e.lngLat).setText(t).addTo(map); });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; tip.remove(); });
}
hover('stations', f => { const s = stations.get(f.properties.id); return s ? `${s.name}${s.bal ? ` · balance ${s.bal.sbi}` : ''}` : null; });
hover('hydros', f => { const hy = hydros.get(f.properties.id); return hy ? `${hy.a.name} · hydrophone${hy.live === false ? ' · offline' : hy.live ? ' · live' : ''}` : null; });
hover('grid', f => viewMode === 'grid' ? `Balance ${f.properties.med} · ${SBI_WORD(f.properties.med).toLowerCase()} · ${f.properties.n} station${f.properties.n > 1 ? 's' : ''}` : null);
map.on('click', e => {
  const pad = 6, box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
  const hy = map.getLayer('hydros') && map.getLayoutProperty('hydros', 'visibility') !== 'none' ? map.queryRenderedFeatures(box, { layers: ['hydros'] })[0] : null;
  if (hy) { const x = hydros.get(hy.properties.id); dropPin(x.lat, x.lon); playHydro(x.id); return; }
  const st = map.queryRenderedFeatures(box, { layers: ['stations'] })[0];
  if (st) { const s = stations.get(st.properties.id); dropPin(s.lat, s.lon); return; }
  dropPin(e.lngLat.lat, e.lngLat.lng);
});

// ---------------- the pin: nearest mics around a point ----------------
export const FAR_KM = 600;
export let pin = null, pinN = 12, pinAuto = true, pinMaxKm = 200, pinMarker = null;
function circle(lat, lon, r) {
  const pts = [], R = 6371, d = r / R, la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  for (let i = 0; i <= 64; i++) {
    const b = (i / 64) * 2 * Math.PI, la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    pts.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
function placeLabel(list) {
  if (!list.length) return 'Open water';
  const tally = k => { const m = new Map(); list.forEach(x => { const v = x[k]; if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const c = tally('country'), s = tally('state');
  if (!c.length) return 'Unnamed area';
  if (c[0][1] >= list.length * 0.7) return s.length && s[0][1] >= list.length * 0.5 ? `${s[0][0]}, ${c[0][0]}` : c[0][0];
  return c.slice(0, 2).map(x => x[0]).join(' & ');
}
export function dropPin(lat, lon, auto = false) {
  if (!auto && pinAuto) { pinN = 12; pinMaxKm = 200; }   // a fresh pin in Auto starts from 12 mics within ~200 km
  const all = [...stations.values()].map(st => ({ st, km: km(lat, lon, st.lat, st.lon) })).sort((a, b) => a.km - b.km);
  let near = all.slice(0, pinN);
  // Auto: drop mics that would make the circle huge. Keep the nearest 4 unless even they are
  // absurdly far (open ocean, polar ice): then the studio says so instead of using them.
  if (pinAuto) near = near.filter((o, i) => o.km <= pinMaxKm || (i < 4 && o.km <= Math.max(FAR_KM, pinMaxKm)));
  const hy = [...hydros.values()].map(x => ({ hy: x, km: km(lat, lon, x.lat, x.lon) })).filter(o => o.km < 250).sort((a, b) => a.km - b.km);
  const radius = near.length ? near.at(-1).km : 0;
  pin = { lat, lon, near, hydros: hy, radius, closest: all[0], label: placeLabel(near.slice(0, 6).map(o => o.st)) };
  ready.then(() => {
    if (!pinMarker) { const el = h('div', { class: 'pin' }, h('i')); pinMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }); }
    pinMarker.setLngLat([lon, lat]).addTo(map);
    map.setFilter('sel', ['in', ['get', 'id'], ['literal', near.map(o => o.st.id)]]);
    src('pinarea').setData(radius ? { type: 'FeatureCollection', features: [circle(lat, lon, Math.max(1, radius))] } : empty());
  });
  setNow('Around the pin', `${pin.label} · press play to hear the ${near.length} nearest mics`);
  onPin();
  pin.auto = auto; pin.autoN = pinAuto;
  window.dispatchEvent(new CustomEvent('biophony:pin', { detail: pin }));
}
export function repin(n) { pinAuto = !n; pinN = n || 12; pinMaxKm = 200; if (pin) dropPin(pin.lat, pin.lon); }
// Thin area: double the number of mics (up to 48) and widen the circle. Returns false when already at the limit.
export function expandPin() {
  if (!pin) return false;
  if (pinAuto) { if (pinMaxKm >= 800 && pinN >= 24) return false; pinMaxKm = Math.min(800, pinMaxKm * 2); if (pin.near.length >= pinN) pinN = Math.min(24, pinN * 2); }
  else { if (pinN >= 48) return false; pinN = Math.min(48, pinN * 2); }
  dropPin(pin.lat, pin.lon, true); return true;
}
