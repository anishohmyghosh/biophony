// The listening bar over the globe: tours, playlists, live hydrophones, spectrogram.
import { gql } from './core/api.js';
import { $, ago, h, kmTxt } from './core/util.js';
import { hydroStatus, hydros } from './globe/hydrophones.js';
import { inB, map } from './globe/map.js';
import { pin } from './globe/pin.js';
import { stations } from './globe/stations.js';
import { selectAt } from './info/site.js';

export const audio = $('audio'), pbtn = $('pbtn'), pnext = $('pnext'), canvas = $('spec'), g2 = canvas.getContext('2d');
export let actx, analyser, agc, vol, hls = null, clipEnd = null, raf = 0, level = 0;
let playlist = [], pi = -1, pmode = 'idle', ptok = 0, advancing = false;
function ensureAudio() {
  if (actx) { actx.resume(); return; }
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const s = actx.createMediaElementSource(audio);
  // Many field recordings are very quiet. An automatic gain stage levels them, a limiter catches peaks.
  analyser = actx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.2; analyser.minDecibels = -100; analyser.maxDecibels = -25;
  agc = actx.createGain(); agc.gain.value = 4;
  const lim = actx.createDynamicsCompressor(); lim.threshold.value = -4; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
  vol = actx.createGain(); vol.gain.value = +$('vol').value;
  s.connect(analyser); s.connect(agc); agc.connect(lim); lim.connect(vol); vol.connect(actx.destination);
  actx.resume();
  drawTicks();
}
function stopHls() { if (hls) { hls.destroy(); hls = null; } }
// Safari only lets audio start inside a click, and clips here start after a network fetch.
// So on the first click anywhere, resume the audio graph and play the <audio> element once
// (silently); after that Safari lets the same element play whenever we ask.
// A quarter second of silence as a WAV, built in code (used to unlock audio in Safari).
export const SILENT = (() => {
  const n = 2000, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
})();
let unlocked = false, unlocking = false;
function unlock() {
  ensureAudio();
  if (unlocked || unlocking || !audio.paused || audio.getAttribute('src')) return;
  // play() inside the gesture is what Safari remembers. Keep trying on each gesture until it succeeds.
  unlocking = true; audio.src = SILENT;
  const done = ok => { if (audio.getAttribute('src') === SILENT) { audio.pause(); audio.removeAttribute('src'); audio.load(); $('player').classList.remove('busy', 'playing'); } if (ok) unlocked = true; setTimeout(() => { unlocking = false; }, 50); };
  const pr = audio.play();
  if (pr) pr.then(() => done(true), () => done(false)); else done(true);
}
['pointerdown', 'keydown', 'touchend'].forEach(t => document.addEventListener(t, unlock, { capture: true, passive: true }));
const real = () => !unlocking && audio.currentSrc !== SILENT;   // ignore events from the silent unlock clip
// A new pin stops the old pin's clips (a live hydrophone keeps playing). If something was
// playing, the tour carries straight on with the new pin's mics. An automatic widening of the
// same pin (auto) leaves the current tour alone.
export function onPin(auto = false) {
  if (pmode === 'live' || auto) return;
  const wasOn = advancing || (!audio.paused && real()) || $('player').classList.contains('busy');
  const tok = ++ptok; advancing = false; clipEnd = null;
  if (!audio.paused) audio.pause();
  setBusy(false); setIcon(false); pmode = 'idle'; pnext.disabled = true; pi = -1;
  // next tick, so a hydrophone click (pin + playHydro in one handler) wins
  if (wasOn) setTimeout(() => { if (pmode === 'idle' && tok === ptok) startTour(); }, 0);
}
export function setNow(title, sub) { $('ptitle').textContent = title; $('psub').textContent = sub; }
// One place decides the play/pause look: a class on the player swaps the icons in CSS.
function setIcon(on) { $('player').classList.toggle('playing', on); pbtn.setAttribute('aria-label', on ? 'Pause' : 'Play'); pbtn.setAttribute('aria-pressed', on); }
function setBusy(on) { $('player').classList.toggle('busy', on); if (on) setIcon(true); else if (audio.paused && !advancing) setIcon(false); }

async function startClip(d) {
  ensureAudio(); stopHls();
  clipEnd = d.sc.endTime != null ? d.sc.endTime + 1.5 : null;
  const pos = playlist.length > 1 ? ` · ${pi + 1} of ${playlist.length}` : '';
  setNow(d.title, d.sub + pos); setBusy(true);
  selectAt(d.lat, d.lon);
  level = 0; agc.gain.setValueAtTime(20, actx.currentTime);
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
  setBusy(false); pi = playlist.length; pnext.disabled = true; selectAt(null);
  setNow(pmode === 'tour' ? 'Tour finished' : 'End of clips', pin ? 'Press play to hear around the pin again' : 'Drop a pin on the globe, then press play');
  pmode = 'idle';
}
export function setPlaylist(items, mode, start = 0) { playlist = items; pmode = mode; pi = -1; ensureAudio(); playIndex(start); }
function advance() { if (advancing || pmode === 'live' || pmode === 'idle') return; advancing = true; const tok = ptok; setTimeout(() => { advancing = false; if (tok === ptok) playIndex(pi + 1); }, 500); }

const RECENT = `query($id:ID!){ station(id:$id){ detections(first:4, validSoundscape:true){ nodes{ timestamp confidence species{ commonName } soundscape{ url startTime endTime } } } } }`;
// Tour: the mics around the pin, nearest first; without a pin, the stations in view by balance.
function startTour() {
  let list, around = !!pin;
  if (around) list = pin.near.map(o => ({ st: o.st, note: kmTxt(o.km) }));
  else {
    const b = map.getBounds();
    let all = [...stations.values()].filter(s => s.bal && inB(b, s.lat, s.lon)).sort((x, y) => y.bal.sbi - x.bal.sbi);
    if (all.length > 30) { const step = all.length / 30; all = Array.from({ length: 30 }, (_, i) => all[Math.floor(i * step)]); }
    list = all.map(st => ({ st, note: `balance ${st.bal.sbi}` }));
  }
  if (!list.length) { setNow(around ? 'Around the pin' : 'Soundscape tour', around ? 'No mics near the pin, try somewhere on land' : 'Still gathering station data, try again in a moment'); return; }
  if (around) {
    // one request for every mic around the pin, then one recent clip per mic, nearest first
    ensureAudio(); setBusy(true); pmode = 'tour'; const tok = ++ptok;
    gql(`query($ids:[ID!]){ detections(first:80, stationIds:$ids, validSoundscape:true, confidenceGte:0.5){ nodes{ timestamp confidence species{ commonName } station{ id } soundscape{ url startTime endTime } } } }`, { ids: list.map(x => x.st.id) }).then(d => {
      if (tok !== ptok) return;
      const by = new Map(); for (const n of d.detections.nodes) if (n.soundscape?.url && !by.has(n.station.id)) by.set(n.station.id, n);
      const items = list.filter(x => by.has(x.st.id)).map(({ st, note }) => { const n = by.get(st.id); return async () => ({ sc: n.soundscape, lat: st.lat, lon: st.lon, title: `${st.name} · ${note}`, sub: `${n.species.commonName}, ${ago(n.timestamp)}` }); });
      if (!items.length) { setBusy(false); pmode = 'idle'; setNow('Around the pin', 'No recent clips from these mics'); return; }
      setPlaylist(items, 'tour');
    }).catch(() => { if (tok === ptok) { setBusy(false); pmode = 'idle'; setNow('Around the pin', 'Could not reach the mics, try again'); } });
    return;
  }
  setPlaylist(list.map(({ st, note }) => async () => {
    const d = (await gql(RECENT, { id: st.id })).station;
    const n = d?.detections?.nodes?.find(x => x.soundscape?.url);
    return n ? { sc: n.soundscape, lat: st.lat, lon: st.lon, title: `${st.name} · ${note}`, sub: `${n.species.commonName}, ${ago(n.timestamp)}` } : null;
  }), 'tour');
}

export async function playHydro(fid) {
  const hy = hydros.get(fid); if (!hy) return;
  const tok = ++ptok;
  ensureAudio(); stopHls(); audio.pause(); clipEnd = null; pmode = 'live'; pnext.disabled = true;
  setNow(`${hy.a.name} · live hydrophone`, 'Connecting to the stream…'); setBusy(true); selectAt(hy.lat, hy.lon);
  try {
    const live = await hydroStatus(hy);
    if (tok !== ptok) return;
    if (!live) {
      const alt = [...hydros.values()].find(x => x.live);
      setBusy(false); pmode = 'idle';
      setNow(`${hy.a.name} · offline`, hy.last ? `No audio since ${ago(hy.last)}${alt ? `. Try ${alt.a.name}, it's live.` : '.'}` : `Stream unavailable${alt ? `. Try ${alt.a.name}, it's live.` : '.'}`);
      return;
    }
    level = 0; agc.gain.setValueAtTime(2, actx.currentTime);
    if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(audio); }
    else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = hy.url;
    else throw new Error('HLS unsupported');
    await audio.play();
    $('psub').textContent = 'Live from the Salish Sea · whales, vessels, seals, snapping shrimp';
  } catch (e) { if (tok === ptok) { setBusy(false); pmode = 'idle'; $('psub').textContent = 'Stream unavailable right now.'; } }
}
export function pauseMain() { ++ptok; advancing = false; stopHls(); audio.pause(); setBusy(false); setIcon(false); if (pmode === 'live') pmode = 'idle'; }
audio.addEventListener('timeupdate', () => { if (real() && clipEnd && audio.currentTime > clipEnd && !audio.paused) { audio.pause(); advance(); } });
audio.addEventListener('ended', () => { if (real()) advance(); });
audio.addEventListener('playing', () => { if (real()) setBusy(false); });
audio.addEventListener('waiting', () => { if (real()) setBusy(true); });
audio.addEventListener('play', () => { if (!real()) return; setIcon(true); loop(); window.dispatchEvent(new Event('biophony:mainplay')); });
audio.addEventListener('pause', () => { if (!real()) return; if (!advancing) setIcon(false); $('player').classList.remove('busy'); });
pbtn.addEventListener('click', () => {
  if ((!audio.paused && real()) || $('player').classList.contains('busy')) { pauseMain(); return; }
  if (pmode === 'idle' || (!audio.getAttribute('src') && !hls)) { startTour(); return; }
  ensureAudio();
  if (clipEnd && audio.currentTime > clipEnd - 0.1) { playIndex(pi + 1); return; }
  audio.play().catch(() => {});
});
pnext.addEventListener('click', () => { if (pmode !== 'live') playIndex(pi + 1); });
$('vol').addEventListener('input', e => { if (vol) vol.gain.value = +e.target.value; });

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
  el.replaceChildren(...[100, 1000, 10000].filter(f => f < ny).map(f => h('span', { style: `top:${H - (Math.log(f / FMIN) / Math.log(ny / FMIN)) * H}px` }, f >= 1000 ? f / 1000 + 'k' : f)));
}
new ResizeObserver(sizeCanvas).observe(canvas);
export let bins, td;
export function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (audio.paused || !analyser) return;
    // automatic gain: follow the loud parts of the raw signal and aim them at about -16 dBFS
    if (!td) td = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(td);
    let s = 0; for (let i = 0; i < td.length; i++) s += td[i] * td[i];
    const r = Math.sqrt(s / td.length);
    level = r > level ? level + (r - level) * 0.3 : level * 0.997;
    if (level > 1e-7) agc.gain.setTargetAtTime(Math.max(0.5, Math.min(600, 0.16 / level)), actx.currentTime, 0.25);
    const W = canvas.width, H = canvas.height, ny = actx.sampleRate / 2, N = analyser.frequencyBinCount;
    if (!bins || bins.length !== N) bins = new Uint8Array(N);
    analyser.getByteFrequencyData(bins);
    const dx = 2;
    g2.drawImage(canvas, dx, 0, W - dx, H, 0, 0, W - dx, H);
    const col = g2.createImageData(dx, H), boost = Math.min(50, 20 * Math.log10(Math.max(1, agc.gain.value)));
    for (let y = 0; y < H; y++) {
      const f = FMIN * Math.pow(ny / FMIN, (H - 1 - y) / (H - 1));
      const v = Math.min(255, bins[Math.min(N - 1, Math.round((f / ny) * N))] + boost * 3) | 0;
      for (let x = 0; x < dx; x++) { const o = (y * dx + x) * 4; col.data[o] = LUT[v * 3]; col.data[o + 1] = LUT[v * 3 + 1]; col.data[o + 2] = LUT[v * 3 + 2]; col.data[o + 3] = 255; }
    }
    g2.putImageData(col, W - dx, 0);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
