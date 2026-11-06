// Library tab: cleanest-first browsing, auditioning and downloads.
import { $, ago, h, kmTxt } from '../core/util.js';
import { expandPin } from '../globe/pin.js';
import { inspect, mono } from './analysis.js';
import { ctx, mon, playBuffer, startMon } from './audio.js';
import { TX, decode, gen, isUltra, loadPool, mapLimit, markWidened, pool, poolMore, region, widenDone } from './data.js';
import { LICENSE, credit, normalize, save, slug, wav, zip } from './export.js';
import { tab } from './index.js';
import { pads, selPad, swapPad } from './kit.js';
import { COL, LABEL, clamp, hz, noteName } from './util.js';
import { drawPeaks } from './widgets.js';

let libFilter = 'all', libQuery = '', libSort = 'snr', libSel = new Set(), libCut = 'call', libQ = 10, inspecting = 0, libShown = 10;
// Gain that brings a whole clip to a target RMS without pushing its peak past -1 dBFS.
export const lvl = (ins, target) => clamp(Math.min(10 ** ((target - ins.rmsDb) / 20), 0.9 / 10 ** (ins.peakDb / 20)), 0.3, 1000);
const QLABEL = { clean: 'Clean', ok: 'Usable', noisy: 'Noisy', silent: 'Near-silent' };
// Library loads in waves: check the most promising recordings first (highest BirdNET confidence),
// show the 10 cleanest, and check more only as the list is scrolled.
export function inspectPool(n = 24) {
  const g = gen, todo = pool.filter(s => !s.ins && !s.insErr && !s.insQueued).sort((a, b) => b.conf - a.conf).slice(0, n);
  if (!todo.length) return;
  todo.forEach(s => { s.insQueued = true; });
  inspecting += todo.length;
  renderLib();
  mapLimit(todo, 6, async s => {
    try { s.ins = await inspect(s); } catch { s.insErr = true; }
    inspecting--;
    if (g !== gen) return;
    if (inspecting > 0) { libProgress(); return; }
    const passing = libItems().length, left = pool.some(x => !x.ins && !x.insErr && !x.insQueued);
    if (passing < libShown && left) { inspectPool(); return; }
    if (passing < libShown && poolMore) { loadPool(true).then(() => { if (g === gen) inspectPool(); }); return; }
    if (passing < 10 && widenDone !== gen) {
      $('libMsg').textContent = `Few clean recordings within ${kmTxt(region.radius)}. Widening the circle…`;
      setTimeout(() => { if (g === gen && !expandPin()) { markWidened(); renderLib(); } }, 400);
      return;
    }
    renderLib();
    if (scrolled && nearEnd()) moreLib();
  });
}
function libProgress() { if (tab !== 'lib') return; const e = document.querySelector('#libList .lib-wait'); if (e) e.textContent = `Listening for the cleanest recordings… ${pool.filter(x => x.ins).length} checked`; }
const sentinel = h('li', { class: 'lib-sent', 'aria-hidden': 'true' });
// Load more only when the person scrolls near the end of the list.
function nearEnd() { if (tab !== 'lib' || inspecting > 0 || !sentinel.isConnected) return false; const r = sentinel.getBoundingClientRect(); return r.top < innerHeight + 200; }
let scrolled = false, quietUntil = 0;
const onScroll = () => { if (performance.now() < quietUntil) return; scrolled = true; if (nearEnd()) moreLib(); };
$('studio').addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('scroll', onScroll, { passive: true });
function moreLib() {
  const items = libItems();
  if (libShown < items.length) { libShown += 10; renderLib(); }
  if (items.length < libShown + 10) { if (pool.some(x => !x.ins && !x.insErr && !x.insQueued)) inspectPool(); else if (poolMore) { const g = gen; loadPool(true).then(() => { if (g === gen) inspectPool(); }); } }
}
function libItems() {
  let l = pool.filter(s => s.ins && (libQ < 0 || (s.ins.label !== 'silent' && s.ins.snr >= libQ)) && (libFilter === 'all' || s.cls === libFilter) && (!libQuery || `${s.sp.commonName} ${s.sp.scientificName} ${s.st?.name} ${s.st?.country}`.toLowerCase().includes(libQuery)));
  l.sort(libSort === 'snr' ? (a, b) => b.ins.snr - a.ins.snr : libSort === 'conf' ? (a, b) => b.conf - a.conf : libSort === 'species' ? (a, b) => a.sp.commonName.localeCompare(b.sp.commonName) : (a, b) => new Date(b.t) - new Date(a.t));
  return l;
}
async function cutBuffer(s, mode = libCut) {
  const b = await decode(s);
  let out = b;
  if (mode !== 'full' && s.sc.startTime != null) {
    const sr = b.sampleRate, a = Math.max(0, Math.round((s.sc.startTime - 0.5) * sr)), e = Math.min(b.length, Math.round(((s.sc.endTime ?? s.sc.startTime + 3) + 0.5) * sr));
    out = new AudioBuffer({ length: e - a, numberOfChannels: 1, sampleRate: sr }); const y = out.getChannelData(0), x = mono(b), f = Math.round(0.01 * sr);
    for (let i = 0; i < y.length; i++) y[i] = x[a + i] * Math.min(1, i / f, (y.length - i) / f);
  } else { out = new AudioBuffer({ length: b.length, numberOfChannels: 1, sampleRate: b.sampleRate }); out.copyToChannel(mono(b).slice(), 0); }
  return $('libNorm').checked ? normalize(out, -1) : out;
}
export let libCur = null, phRaf = 0;
function audition(s, btn, row) {
  libCur = s.id; document.querySelectorAll('.lib-row.cur').forEach(r => r.classList.remove('cur')); row?.classList.add('cur');
  return startMon(btn, row, async done => {
    const b = await decode(s), ins = s.ins || await inspect(s);
    const from = Math.max(0, (s.sc.startTime ?? 0) - 0.4), dur = Math.min(b.duration - from, s.sc.endTime != null ? (s.sc.endTime - from + 0.6) : b.duration);
    const pb = playBuffer(b, { rate: 1 / TX(s), gain: ins.gain, from, dur, onEnd: done });
    // playhead across the row's waveform
    const ph = row?.querySelector('.ph'), t0 = ctx.currentTime, total = b.duration;
    if (ph) {
      ph.hidden = false; cancelAnimationFrame(phRaf);
      const step = () => { if (mon?.row !== row) { ph.hidden = true; return; } const t = from + (ctx.currentTime - t0) / (1 / TX(s)); ph.style.left = `${clamp(t / total, 0, 1) * 100}%`; phRaf = requestAnimationFrame(step); };
      step();
    }
    return { stop: () => { pb.stop(); if (ph) ph.hidden = true; } };
  }).catch(() => { $('libMsg').textContent = 'Could not play that recording.'; });
}
const fileName = s => `${slug(s.sp.commonName)}_${slug(s.st?.name)}_${s.t.slice(0, 19).replace(/[:T]/g, '-')}${libCut === 'call' ? '_call' : ''}.wav`;
async function downloadOne(s) { save(new Blob([wav(await cutBuffer(s), 24)], { type: 'audio/wav' }), fileName(s)); }
async function downloadSel() {
  const items = pool.filter(s => libSel.has(s.id)); if (!items.length) return;
  const btn = $('libZip'); btn.disabled = true; btn.textContent = 'Packing…';
  const files = (await mapLimit(items, 3, async s => ({ name: fileName(s), data: wav(await cutBuffer(s), 24) }))).filter(Boolean);
  files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(`Biophony sound pack · ${region.label}\n\n${items.map(s => `${credit(s)} · SNR ${Math.round(s.ins?.snr ?? 0)} dB`).join('\n')}\n\n${LICENSE}\n`) });
  save(zip(files), `biophony-sounds_${slug(region.label)}.zip`);
  btn.disabled = false; updateSelBtn();
}
function updateSelBtn() { const b = $('libZip'); b.textContent = libSel.size ? `⤓ Download ${libSel.size} as ZIP` : 'Select sounds to pack'; b.disabled = !libSel.size; }
export function renderLib() {
  if (tab !== 'lib' || !region) return;
  const list = $('libList'), items = libItems(), shown = items.slice(0, libShown);
  const done = pool.filter(s => s.ins), counts = {}; done.forEach(s => counts[s.cls] = (counts[s.cls] || 0) + 1);
  const hidden = done.filter(s => libQ >= 0 && (s.ins.label === 'silent' || s.ins.snr < libQ)), silent = hidden.filter(s => s.ins.label === 'silent').length;
  $('libChips').replaceChildren(...['all', 'bird', 'insect', 'amphibian', 'bat', 'mammal'].filter(c => c === 'all' || counts[c]).map(c => {
    const b = h('button', { class: 'fchip' + (libFilter === c ? ' on' : ''), 'aria-pressed': libFilter === c, style: c === 'all' ? '' : `--c:${COL(c)}` }, c === 'all' ? 'All' : `${LABEL(c)}s`);
    b.addEventListener('click', () => { libFilter = c; libShown = 10; renderLib(); });
    return b;
  }));
  $('libMsg').textContent = !pool.length ? 'Loading recordings from the mics around the pin…'
    : `Cleanest first · ${done.length} of ${pool.length}${poolMore ? '+' : ''} recordings checked${hidden.length ? `, ${hidden.length} hidden (${silent ? `${silent} near-silent, ` : ''}${hidden.length - silent} too noisy)` : ''}. Click a row to play, ↑↓ to browse, drag onto a kit pad. Scroll for more.`;
  // while the first wave is being checked, wait rather than reshuffle rows under the cursor
  if (!shown.length || (inspecting > 0 && !list.querySelector('.lib-row'))) {
    list.replaceChildren(h('li', { class: 'empty lib-wait' }, !pool.length || inspecting > 0 ? `Listening for the cleanest recordings… ${done.length} checked` : 'No sounds pass the quality filter here. Set Quality to Everything, or drop the pin somewhere busier.'));
    updateSelBtn(); return;
  }
  const old = new Map([...list.querySelectorAll('.lib-row')].map(r => [r.dataset.id, r]));
  list.replaceChildren(...shown.map(s => old.get(s.id) || libRow(s)));
  const more = items.length > libShown || pool.some(x => !x.ins && !x.insErr) || poolMore;
  if (more) { sentinel.textContent = inspecting > 0 ? 'Checking more recordings…' : 'Scroll for more'; list.append(sentinel); }
  updateSelBtn();
}
function libRow(s) {
  const ins = s.ins;
  const playB = h('button', { class: 'ib play', title: 'Play the call', 'aria-label': `Play ${s.sp.commonName}`, 'aria-pressed': 'false' }, '▶');
  const row = h('li', { class: 'lib-row' + (libCur === s.id ? ' cur' : ''), 'data-id': s.id },
    h('input', { type: 'checkbox', 'aria-label': `Select ${s.sp.commonName}`, checked: libSel.has(s.id) || null, onchange: e => { e.target.checked ? libSel.add(s.id) : libSel.delete(s.id); updateSelBtn(); } }),
    playB,
    s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
    h('div', { class: 'lib-name' }, h('b', {}, s.sp.commonName), h('span', {}, h('i', { class: 'gdot', style: `background:${COL(s.cls)}` }), `${LABEL(s.cls)} · ${s.st?.name || ''} · ${ago(s.t)}${isUltra(s) ? ' · ultrasonic' : ''}`)),
    h('div', { class: 'lib-wv' }, h('canvas', { class: 'lib-wave' }), h('i', { class: 'ph', hidden: true })),
    h('span', { class: 'lib-tag' }, ins.tonal.voiced >= 4 && ins.tonal.prom >= 14 && ins.tonal.f0 > 80 ? `♪ ${noteName(69 + 12 * Math.log2(ins.tonal.f0 / 440))}` : 'texture', h('small', {}, (ins.dur || s.sc.duration || 0).toFixed(0) + ' s')),
    h('span', { class: 'lib-q q-' + ins.label, title: `Signal-to-noise ${ins.snr.toFixed(1)} dB in the band where the call is strongest (around ${hz(ins.band || 0)})` }, h('b', {}, `${Math.round(ins.snr)} dB`), QLABEL[ins.label]),
    h('div', { class: 'lib-act' },
      h('button', { class: 'ib', title: `Load onto pad ${selPad + 1} of the kit`, 'aria-label': 'Add to kit', onclick: async () => { if (!pads.length) { $('libMsg').textContent = 'Build a kit first, then load sounds onto pads.'; return; } await swapPad(selPad, s); $('libMsg').textContent = `Loaded onto pad ${selPad + 1} (${pads[selPad].role.name}).`; } }, '＋'),
      h('button', { class: 'ib', title: 'Download WAV', 'aria-label': `Download ${s.sp.commonName}`, onclick: () => downloadOne(s) }, '⤓')));
  playB.addEventListener('click', e => { e.stopPropagation(); audition(s, playB, row); });
  row.addEventListener('click', e => { if (e.target.closest('button, input')) return; audition(s, playB, row); });
  row.draggable = true; row.title = 'Click to play · ↑↓ to browse · drag onto a kit pad';
  row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-biophony', s.id); e.dataTransfer.effectAllowed = 'copy'; document.body.classList.add('dragging'); });
  row.addEventListener('dragend', () => document.body.classList.remove('dragging'));
  const dur = ins.dur || s.sc.duration || 1;
  requestAnimationFrame(() => drawPeaks(row.querySelector('canvas'), ins.peaks, { color: COL(s.cls), call: s.sc.startTime != null ? [s.sc.startTime / dur, (s.sc.endTime ?? s.sc.startTime + 3) / dur] : null }));
  return row;
}

export function resetLibrary() { libSel.clear(); libShown = 10; scrolled = false; libCur = null; }
export function resetScroll() { scrolled = false; quietUntil = performance.now() + 800; }
$('libSearch').addEventListener('input', e => { libQuery = e.target.value.trim().toLowerCase(); libShown = 10; renderLib(); });
$('libSort').addEventListener('change', e => { libSort = e.target.value; libShown = 10; renderLib(); });
$('libQ').addEventListener('change', e => { libQ = +e.target.value; libShown = 10; renderLib(); });
$('libCut').addEventListener('change', e => { libCut = e.target.value; });
$('libZip').addEventListener('click', () => downloadSel());
