// The MapLibre globe, its base map and the dimmed data underlays/overlays.
import { GIBS } from '../core/api.js';
import { $, h } from '../core/util.js';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const isoDay = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const gibs = (layer, time, level, ext = 'png') => `${GIBS}/${layer}/default/${time}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;
// Base layers sit under the stations, dimmed and desaturated so the dots stay readable.
const BASES = {
  eco: { url: gibs('MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', 'default', 8), max: 8, legend: 'MODIS_IGBP_Land_Cover_Type', attr: 'NASA MODIS MCD12Q1 via GIBS' },
  anthro: { url: gibs('Anthropogenic_Biomes_of_the_World_2001-2006', 'default', 7), max: 7, legend: 'Anthropogenic_Biomes_of_the_World_2001-2006', attr: 'Anthromes v1, Ellis & Ramankutty 2008, NASA SEDAC via GIBS' },
  ndvi: { url: gibs('MODIS_Terra_NDVI_8Day', 'default', 9), max: 9, legend: 'MODIS_NDVI', attr: 'NASA MODIS via GIBS' },
  canopy: { url: gibs('GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303', 'default', 7), max: 7, legend: 'GEDI_RH100_Mean_Color_Index', attr: 'NASA GEDI lidar via GIBS' },
  night: { url: gibs('VIIRS_Black_Marble', '2016-01-01', 8), max: 8, legend: null, attr: 'NASA Black Marble via GIBS' },
  foot: { url: gibs('Human_Footprint_1995-2004', 'default', 7), max: 7, legend: 'Human_Footprint_1995-2004', attr: 'Human Footprint v2, WCS & CIESIN via GIBS' },
  true: { url: gibs('VIIRS_SNPP_CorrectedReflectance_TrueColor', isoDay(1), 9, 'jpg'), max: 9, legend: null, attr: 'NASA VIIRS via GIBS' },
};
const WDPA = 'https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';
export const LO = [212, 104, 63], MID = [123, 133, 132], HI = [42, 169, 139];
const rgb = a => `rgb(${a.join(',')})`;
export const empty = () => ({ type: 'FeatureCollection', features: [] });
const raster = (tiles, max, attribution) => ({ type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: max, ...(attribution ? { attribution } : {}) });
const DIM = { 'raster-opacity': 0.62, 'raster-saturation': -0.35, 'raster-brightness-max': 0.72, 'raster-contrast': -0.1 };

export const map = new maplibregl.Map({
  container: 'map', center: [-40, 28], zoom: 1.6, minZoom: 0.8, maxZoom: 14, attributionControl: { compact: true },
  style: {
    version: 8, projection: { type: 'globe' },
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
    sources: {
      base: raster(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, 16, 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors'),
      labels: raster(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, 16),
      shade: raster(`${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`, 13, 'Hillshade © Esri'),
      wdpa: raster(WDPA, 14, 'Protected areas: UNEP-WCMC & IUCN, WDPA'),
      stations: { type: 'geojson', data: empty() },
      grid: { type: 'geojson', data: empty() },
      hydros: { type: 'geojson', data: empty() },
      pinarea: { type: 'geojson', data: empty() },
      emit: { type: 'geojson', data: empty() },
      now: { type: 'geojson', data: empty() },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a1112' } },
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'shade', type: 'raster', source: 'shade', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.28 } },
      { id: 'wdpa', type: 'raster', source: 'wdpa', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.3 } },
      { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.75 } },
      { id: 'grid', type: 'fill', source: 'grid', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['get', 'o'], 'fill-outline-color': '#0b1314' } },
      { id: 'emit', type: 'line', source: 'emit', paint: { 'line-color': '#e3b765', 'line-width': 1.5, 'line-dasharray': [3, 3] } },
      { id: 'pinarea', type: 'fill', source: 'pinarea', paint: { 'fill-color': '#e9efe9', 'fill-opacity': 0.05 } },
      { id: 'pinline', type: 'line', source: 'pinarea', paint: { 'line-color': '#e9efe9', 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [2, 2] } },
      { id: 'stations', type: 'circle', source: 'stations', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['has', 's'], 2.2, 1.3], 5, ['case', ['has', 's'], 4, 2.4], 10, ['case', ['has', 's'], 6.5, 4]],
        'circle-color': ['case', ['has', 's'], ['interpolate', ['linear'], ['get', 's'], 0, rgb(LO), 50, rgb(MID), 100, rgb(HI)], '#56625f'],
        'circle-opacity': ['case', ['has', 's'], 0.95, 0.55],
        'circle-stroke-color': '#071011', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 6, 0.9] } },
      { id: 'sel', type: 'circle', source: 'stations', filter: ['in', ['get', 'id'], ['literal', []]], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4.5, 6, 7.5, 10, 10], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e9efe9', 'circle-stroke-width': 1.6 } },
      { id: 'hydros', type: 'circle', source: 'hydros', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 8, 8], 'circle-color': ['case', ['get', 'live'], 'rgba(111,179,255,0.35)', 'rgba(143,165,162,0.15)'],
        'circle-stroke-color': ['case', ['get', 'live'], '#6fb3ff', '#8fa5a2'], 'circle-stroke-width': 2 } },
      { id: 'now', type: 'circle', source: 'now', paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e3b765', 'circle-stroke-width': 2 } },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
export const ready = new Promise(r => map.once('load', r));
export const src = id => map.getSource(id);
export const inB = (b, lat, lon) => b.contains([lon, lat]);

function setBase(k) {
  if (map.getLayer('sat')) map.removeLayer('sat');
  if (map.getSource('sat')) map.removeSource('sat');
  const s = BASES[k], lg = $('legend');
  lg.replaceChildren(); lg.hidden = true;
  if (!s) return;
  map.addSource('sat', raster(s.url, s.max, s.attr));
  map.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: k === 'true' ? { ...DIM, 'raster-opacity': 0.75 } : k === 'night' ? { 'raster-opacity': 0.7, 'raster-saturation': -0.6, 'raster-brightness-max': 0.8 } : DIM }, 'shade');
  if (s.legend) { lg.append(h('img', { src: `https://gibs.earthdata.nasa.gov/legends/${s.legend}_H.svg`, alt: '', onerror: () => { lg.hidden = true; } })); lg.hidden = false; }
}
document.querySelectorAll('input[name=sat]').forEach(r => r.addEventListener('change', () => ready.then(() => setBase(r.value))));
const vis = (id, on) => ready.then(() => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
$('lyWdpa').addEventListener('change', e => vis('wdpa', e.target.checked));
$('lyShade').addEventListener('change', e => vis('shade', e.target.checked));
$('lyHydro').addEventListener('change', e => vis('hydros', e.target.checked));
