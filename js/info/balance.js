// The Balance tab of the Info drawer.
import { $, fmt, h } from '../core/util.js';
import { inB, map } from '../globe/map.js';
import { SBI_WORD, coverage, hill1, median, nGroups, pielou, quant, sbiColor } from '../globe/metrics.js';
import { dropPin } from '../globe/pin.js';
import { analysed, analysing, stations } from '../globe/stations.js';
import { openStation } from './site.js';

const balEl = $('bal');
export function meter(v, lo, hi) {
  return h('div', { class: 'meter', role: 'img', 'aria-label': `Balance ${v} of 100${lo != null ? `, middle half of stations ${Math.round(lo)} to ${Math.round(hi)}` : ''}` },
    h('div', { class: 'meter-track sbi-grad' }),
    lo != null ? h('div', { class: 'meter-iqr', style: `left:${lo}%;width:${Math.max(1, hi - lo)}%` }) : null,
    h('div', { class: 'meter-mark', style: `left:${v}%` }),
  );
}
export const meterScale = () => h('div', { class: 'meter-scale' }, h('span', {}, '0 · low'), h('span', {}, '50'), h('span', {}, 'rich · 100'));
function histogram(vals) {
  const bins = Array(10).fill(0); vals.forEach(v => bins[Math.min(9, Math.floor(v / 10))]++);
  const mx = Math.max(...bins, 1), W = 300, H = 74, bw = W / 10;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 14}`); svg.setAttribute('class', 'hist'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Distribution of station balance scores: ' + bins.map((n, i) => `${i * 10}–${i * 10 + 10}: ${n}`).join(', '));
  const tipEl = h('div', { class: 'hist-tip', hidden: true });
  bins.forEach((n, i) => {
    const bh = Math.max(n ? 2 : 0, (n / mx) * (H - 4)), x = i * bw + 1, y = H - bh;
    const r = document.createElementNS(NS, 'path');
    const rr = Math.min(3, bh / 2), w = bw - 2;
    r.setAttribute('d', bh ? `M${x},${H} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${H} Z` : '');
    r.setAttribute('fill', sbiColor(i * 10 + 5));
    const hit = document.createElementNS(NS, 'rect');
    Object.entries({ x: i * bw, y: 0, width: bw, height: H, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v));
    hit.addEventListener('mouseenter', () => { tipEl.hidden = false; tipEl.textContent = `${n} station${n === 1 ? '' : 's'} scoring ${i * 10}–${i * 10 + 10}`; tipEl.style.left = `${((i + 0.5) / 10) * 100}%`; r.setAttribute('opacity', '0.75'); });
    hit.addEventListener('mouseleave', () => { tipEl.hidden = true; r.removeAttribute('opacity'); });
    svg.append(r, hit);
  });
  const base = document.createElementNS(NS, 'line');
  Object.entries({ x1: 0, x2: W, y1: H + 0.5, y2: H + 0.5, stroke: '#2b4243' }).forEach(([k, v]) => base.setAttribute(k, v));
  svg.append(base);
  [0, 50, 100].forEach(v => { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', (v / 100) * W); t.setAttribute('y', H + 12); t.setAttribute('text-anchor', v === 0 ? 'start' : v === 100 ? 'end' : 'middle'); t.textContent = v; svg.append(t); });
  return h('div', { class: 'hist-wrap' }, svg, tipEl);
}
function regionKey(inView) {
  const conts = new Set(inView.map(s => s.continent || 'Other'));
  if (conts.size > 1) return [s => s.continent || 'Other', 'continent'];
  const ctry = new Set(inView.map(s => s.country || 'Other'));
  if (ctry.size > 1) return [s => s.country || 'Other', 'country'];
  return [s => s.state || s.country || 'Other', 'region'];
}
function flyToStations(list) { const b = new maplibregl.LngLatBounds(); list.forEach(s => b.extend([s.lon, s.lat])); map.fitBounds(b, { padding: 60, maxZoom: 9, duration: 1000 }); }
let balRaf = 0;
export function renderBalance() {
  cancelAnimationFrame(balRaf);
  balRaf = requestAnimationFrame(() => {
    const b = map.getBounds();
    const all = [...stations.values()].filter(s => s.bal);
    const inView = all.filter(s => inB(b, s.lat, s.lon));
    const total = +($('stSta').dataset.n || stations.size);
    const prog = analysing ? h('div', { class: 'prog' }, h('div', { class: 'prog-bar', style: `width:${Math.min(100, (analysed / Math.max(total, 1)) * 100)}%` }), h('span', {}, `Analysing stations… ${fmt(analysed)} of ~${fmt(total)}`)) : null;
    if (!inView.length) {
      balEl.replaceChildren(prog || '', h('p', { class: 'empty' }, all.length ? 'No stations with enough data in this view. Zoom out or turn the globe to a monitored area.' : 'Gathering 24 hours of recognitions from every station…'));
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
    const siteBtn = s => h('button', { class: 'site-chip', onclick: () => { dropPin(s.lat, s.lon); openStation(s.id); } }, h('i', { style: `background:${sbiColor(s.bal.sbi)}` }), h('span', {}, s.name), h('b', {}, s.bal.sbi));

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
        comp('effective species', median(inView.map(s => hill1(s.m))).toFixed(1), 'Median Hill number q=1, exp(H′)'),
        comp('evenness J′', median(inView.map(s => pielou(s.m))).toFixed(2), 'Median Pielou evenness'),
        comp('multi-taxa sites', Math.round(100 * inView.filter(s => nGroups(s.m) > 1).length / inView.length) + '%', 'Share of stations also hearing insects, frogs, bats or mammals'),
        comp('sample coverage', Math.round(100 * median(inView.map(s => coverage(s.m)))) + '%', 'Median sample coverage (Chao & Jost 2012)')),
      rows.length ? h('div', { class: 'sec' }, h('h3', {}, `By ${level}`, h('small', {}, 'median and middle half')),
        h('ul', { class: 'regions' }, rows.map(r => h('li', {}, h('button', { onclick: () => flyToStations(r.a) },
          h('span', { class: 'r-name' }, r.k, h('small', {}, ` ${r.n}`)),
          h('span', { class: 'r-plot' }, h('i', { class: 'r-iqr', style: `left:${r.lo}%;width:${Math.max(1, r.hi - r.lo)}%` }), h('i', { class: 'r-dot', style: `left:${r.med}%;background:${sbiColor(r.med)}` })),
          h('b', {}, Math.round(r.med))))))) : null,
      h('div', { class: 'sec two' },
        h('div', {}, h('h3', {}, 'Richest here'), ...topSites.map(siteBtn)),
        h('div', {}, h('h3', {}, 'Thinnest here'), ...lowSites.map(siteBtn))),
      h('p', { class: 'note', style: 'margin-top:16px' }, 'Each station\'s score blends diversity (Hill q1, compared with stations at similar latitude), evenness (Pielou J′) and taxonomic breadth over the last 24 hours. Methods and references are in About.'),
    );
  });
}
