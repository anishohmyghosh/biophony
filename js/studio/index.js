// Field Studio shell: tabs, pin changes, suggestions and keyboard shortcuts.
import { $, h, kmTxt } from '../core/util.js';
import { hydros } from '../globe/hydrophones.js';
import { map } from '../globe/map.js';
import { median } from '../globe/metrics.js';
import { FAR_KM, dropPin, repin } from '../globe/pin.js';
import { stations } from '../globe/stations.js';
import { openHydro, openStation } from '../info/site.js';
import { audioCtx, stopMon } from './audio.js';
import { loadPool, pool, region, resetPool, setRegion } from './data.js';
import { exportKit, exportLoop, midi, save } from './export.js';
import { renderEditor, renderKey, renderPadsMeta, renderSeq, retune } from './kit-view.js';
import { buildKit, ensureKit, pads, resetKit, selPad, trigger } from './kit.js';
import { ROLES } from './roles.js';
import { inspectPool, libCur, renderLib, resetLibrary, resetScroll } from './library.js';
import { autoKey, key } from './music.js';
import { recBusy, renderRec, resetRecorder } from './recorder.js';
import { bpm, clearPattern, generate, mutate, pattern, playing, setSwing, setTempo, togglePlay } from './sequencer.js';
import { clamp } from './util.js';

window.addEventListener('biophony:mainplay', () => { stopMon(); togglePlay(false); });
window.addEventListener('biophony:ratelimit', e => {
  const el = $(tab === 'lib' ? 'libMsg' : tab === 'rec' ? 'recMsg' : 'kitStatus'), msg = s => `BirdWeather (the free source of these recordings) asked us to slow down. Continuing in ${s} s…`;
  const tick = () => {
    const s = Math.ceil((e.detail.until - Date.now()) / 1000);
    if (s > 0) { el.textContent = msg(s); setTimeout(tick, 1000); }
    else if (el.textContent.startsWith('BirdWeather (the free')) el.textContent = 'Continuing…';   // the task's own status replaces this
  };
  tick();
});
export let tab = 'kit';
function showStudioTab(t) {
  if (t !== tab) { togglePlay(false); stopMon(); $('studio').scrollTop = 0; resetScroll(); }
  tab = t;
  document.querySelectorAll('.st-tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.st-pane').forEach(p => { p.hidden = p.id !== 'st-' + t; });
  if (!region) return;
  if (t === 'kit') ensureKit();
  if (t === 'kit') requestAnimationFrame(() => { if (pads.length) { renderPadsMeta(); renderEditor(); } });
  if (t === 'lib') { renderLib(); if (!pool.length) loadPool().then(() => { inspectPool(); renderLib(); }).catch(() => { $('libMsg').textContent = 'Could not load sounds.'; }); else if (!pool.some(x => x.ins || x.insQueued)) inspectPool(); }
  if (t === 'rec') renderRec();
}
window.addEventListener('biophony:pin', e => {
  togglePlay(false); stopMon();
  setRegion(e.detail);
  document.querySelectorAll('#pinN button').forEach(x => { const n = +x.dataset.n, on = e.detail.autoN ? n === 0 : n === e.detail.near.length || (n === 48 && e.detail.near.length > 24); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  resetKit(); resetLibrary(); resetRecorder();
  $('recOut').replaceChildren(); $('pads').replaceChildren(); $('editor').replaceChildren(); $('libList').replaceChildren(); $('kitStatus').textContent = e.detail.auto ? `Widened to ${e.detail.near.length} mics within ${kmTxt(e.detail.radius)}…` : '';
  // Nothing within reach (open ocean, ice): say so rather than build from mics thousands of km away.
  const far = !e.detail.near.length && !e.detail.hydros.length;
  $('stEmpty').hidden = true; $('stBody').hidden = far; $('stFar').hidden = !far;
  if (far) { suggest(); const c = e.detail.closest; $('stFarMsg').textContent = c ? `No listening stations within ${kmTxt(FAR_KM)} of here. The nearest is ${c.st.name}${c.st.country ? ' in ' + c.st.country : ''}, ${kmTxt(c.km)} away.` : 'No listening stations loaded yet.'; return; }
  renderSeq();
  showStudioTab(tab);
});
// Before any pin: suggest places where the soundscape is rich right now.
function suggest() {
  if (region && $('stFar').hidden) return;
  const cells = new Map();
  for (const s of stations.values()) { if (!s.bal) continue; const k = Math.floor(s.lat / 3) + ',' + Math.floor(s.lon / 3); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s); }
  const spots = [...cells.values()].filter(a => a.length >= 4).map(a => ({ a, med: median(a.map(s => s.bal.sbi)) })).sort((x, y) => y.med - x.med);
  const out = [], used = new Set();
  for (const sp of spots) {
    const c = sp.a[0].country || '?'; if (used.has(c)) continue; used.add(c);
    const top = [...sp.a].sort((x, y) => y.bal.sbi - x.bal.sbi)[0];
    out.push({ lat: top.lat, lon: top.lon, label: `${top.state ? top.state + ', ' : ''}${top.country || ''}`, sub: sp.med >= 65 ? 'Very lively right now' : 'Lively right now' });
    if (out.length >= 6) break;
  }
  const hy = [...hydros.values()].find(x => x.live);
  if (hy) out.push({ lat: hy.lat, lon: hy.lon, label: 'Salish Sea', sub: 'Underwater, live' });
  const items = () => ((out.length ? out.map(o => h('button', { class: 'suggest', onclick: () => { map.easeTo({ center: [o.lon, o.lat], duration: 900 }); dropPin(o.lat, o.lon); } }, h('b', {}, o.label), h('span', {}, o.sub))) : [h('p', { class: 'hint' }, 'Finding lively places…')]));
  $('stSuggest').replaceChildren(...items());
  $('stFarSuggest').replaceChildren(...items());
}
window.addEventListener('biophony:data', () => { suggest(); if (region && tab === 'rec' && !recBusy) renderRec(); });
// "site health": the closest mic's panel, a hydrophone's if one is nearer than any station.
$('stFarGo').addEventListener('click', () => repin(12));
$('stSite').addEventListener('click', () => {
  const st = region?.near[0], hy = region?.hydros[0];
  if (hy && (!st || hy.km < st.km)) openHydro(hy.hy.id); else if (st) openStation(st.st.id);
});
document.querySelectorAll('#pinN button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#pinN button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); repin(+b.dataset.n); }));
document.querySelectorAll('.st-tab').forEach(b => b.addEventListener('click', () => showStudioTab(b.dataset.t)));
$('kPlay').addEventListener('click', () => togglePlay());
// Sound details (waveform, envelope, knobs) fold away under the pads; remembered per browser.
function setDetails(open) {
  $('editor').hidden = !open; $('edToggle').setAttribute('aria-expanded', open);
  $('edToggleL').textContent = open ? 'Hide details' : `Sound details${pads[selPad] ? ' · ' + pads[selPad].role.name : ''}`;
  try { localStorage.setItem('biophony-details', open ? '1' : '0'); } catch { }
  if (open) requestAnimationFrame(renderEditor);
}
$('edToggle').addEventListener('click', () => setDetails($('editor').hidden));
try { if (localStorage.getItem('biophony-details') === '1') setDetails(true); } catch { }
$('kGen').addEventListener('click', () => generate($('kStyle').value));
$('kStyle').addEventListener('change', () => generate($('kStyle').value));
$('kMut').addEventListener('click', mutate);
$('kClear').addEventListener('click', () => { clearPattern(); renderSeq(); });
$('kNew').addEventListener('click', () => { resetPool(); buildKit(); });
$('kRoot').addEventListener('change', e => { if (e.target.value === 'auto') autoKey(pads.filter(p => p.m0 != null)); else key.root = +e.target.value; retune(); });
$('kScale').addEventListener('change', e => { key.scale = e.target.value; if ($('kRoot').value === 'auto') autoKey(pads.filter(p => p.m0 != null)); retune(); });
$('kBpm').addEventListener('input', e => { setTempo(+e.target.value); $('kBpmV').textContent = e.target.value; });
$('kSwing').addEventListener('input', e => { setSwing(+e.target.value / 100); $('kSwingV').textContent = e.target.value + '%'; });
$('kKit').addEventListener('click', () => exportKit().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kLoop').addEventListener('click', () => exportLoop().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kMidi').addEventListener('click', () => save(midi(pattern, bpm), `biophony-pattern_${bpm}bpm.mid`));
document.addEventListener('keydown', e => {
  if (!region || !$('info').hidden || e.metaKey || e.ctrlKey) return;
  if (e.target.closest('input, select, textarea, [contenteditable]') && e.target.type !== 'range') return;
  if (tab === 'lib' && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.code === 'Space')) {
    const rows = [...document.querySelectorAll('#libList .lib-row')]; if (!rows.length) return;
    e.preventDefault();
    let k = rows.findIndex(r => r.dataset.id === libCur);
    if (e.code === 'Space') { if (k < 0) k = 0; } else k = clamp(k + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1);
    const r = rows[k]; r.scrollIntoView({ block: 'nearest' }); r.click(); return;
  }
  if (tab !== 'kit') return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); return; }
  const i = ROLES.findIndex(r => r.key === e.key);
  if (i >= 0 && pads[i]) trigger(pads[i], audioCtx().currentTime + 0.003);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (playing) togglePlay(false); stopMon(); } });
renderKey(); renderSeq(); suggest();
