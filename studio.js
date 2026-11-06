// Field Studio: kits, a sound library and an ambience recorder built from the mics around the pin.
const B = () => window.biophony;
const $ = id => document.getElementById(id);
const h = (...a) => B().h(...a);
const COL = c => B().COLORS[c] || B().COLORS.bird;
const LABEL = c => B().CLS[c] || 'Sound';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const q = (arr, p) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
const db = v => 20 * Math.log10(Math.max(1e-9, v));
const hz = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' kHz' : Math.round(v) + ' Hz';
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = m => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// ---------------- audio ----------------
let ctx, master, limiter;
function audioCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    master = ctx.createGain(); master.gain.value = 0.9;
    limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    master.connect(limiter); limiter.connect(ctx.destination);
  }
  ctx.resume();
  return ctx;
}
// Every ▶ button in the studio goes through here, so its icon always matches what is playing.
function playBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle('playing', on); btn.setAttribute('aria-pressed', on);
  const l = btn.dataset.label;
  btn.textContent = l ? `${on ? '■' : '▶'} ${on ? (btn.dataset.stop || 'Stop') : l}` : on ? '■' : '▶';
}
let mon = null;      // the one preview playing right now
function stopMon() { if (!mon) return; const m = mon; mon = null; try { m.stop(); } catch { } playBtn(m.btn, false); m.row?.classList.remove('playing'); }
async function startMon(btn, row, starter, id) {
  if (mon && (mon.btn === btn || (id && mon.id === id))) { stopMon(); return; }
  stopMon(); B().pauseMain();
  const m = { btn, row, id, stop: () => {} }; mon = m;
  playBtn(btn, true); row?.classList.add('playing');
  try { const s = await starter(() => { if (mon === m) stopMon(); }); if (mon !== m) { s.stop(); return; } m.stop = s.stop; }
  catch (e) { if (mon === m) stopMon(); throw e; }
}
function playBuffer(buf, { rate = 1, gain = 1, from = 0, dur, onEnd } = {}) {
  audioCtx();
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
  s.connect(g); g.connect(master); s.start(0, Math.max(0, from), dur);
  s.onended = () => onEnd?.();
  return { stop: () => { s.onended = null; try { s.stop(); } catch { } } };
}
window.addEventListener('biophony:mainplay', () => { stopMon(); togglePlay(false); });

// ---------------- data ----------------
const FRAG = `id timestamp confidence species{ id commonName scientificName classification thumbnailUrl } station{ id name country state coords{lat lon} } soundscape{ url startTime endTime duration sampleRate }`;
const DQ = `query($ids:[ID!],$n:Int,$after:String){ detections(first:$n, after:$after, stationIds:$ids, validSoundscape:true){ pageInfo{ hasNextPage endCursor } nodes{ ${FRAG} } } }`;
const DQR = `query($ids:[ID!]){ detections(first:30, stationIds:$ids, validSoundscape:true, classifications:["insect","amphibian","bat","mammal"]){ nodes{ ${FRAG} } } }`;
const toSnd = n => ({ id: n.id, t: n.timestamp, conf: n.confidence, sp: n.species, cls: B().normCls(n.species?.classification), st: n.station, sc: n.soundscape });
const isUltra = s => (s.sc.sampleRate || 48000) > 96000;
const TX = s => isUltra(s) ? 10 : 1;          // time expansion for bat recordings

let region = null, pool = [], poolCursor = null, poolMore = false, poolBusy = null, gen = 0;
function setRegion(pin) {
  gen++;
  region = { ...pin, ids: pin.near.map(o => o.st.id) };
  pool = []; poolCursor = null; poolMore = false; poolBusy = null;
  const n = pin.near.length;
  $('stRegion').textContent = pin.label;
  $('stRegionSub').textContent = n ? `${n} nearest mic${n > 1 ? 's' : ''}, within ${B().kmTxt(pin.radius)}${pin.hydros.length ? ` · ${pin.hydros.length} hydrophone${pin.hydros.length > 1 ? 's' : ''}` : ''}` : 'No mics nearby';
  $('stSite').hidden = !n;
}
async function loadPool(more = false) {
  if (poolBusy) return poolBusy;
  const g = gen;
  poolBusy = (async () => {
    const { gql } = B(), ids = region.ids;
    if (!ids.length) return;
    const [d, extra] = await Promise.all([gql(DQ, { ids, n: 100, after: more ? poolCursor : null }), more ? null : gql(DQR, { ids }).catch(() => null)]);
    if (g !== gen) return;
    poolCursor = d.detections.pageInfo.endCursor; poolMore = d.detections.pageInfo.hasNextPage;
    const seen = new Set(pool.map(x => x.id));
    for (const n of [...(extra?.detections?.nodes || []), ...d.detections.nodes]) if (n.soundscape?.url && !seen.has(n.id)) { seen.add(n.id); pool.push(toSnd(n)); }
  })();
  try { await poolBusy; } finally { poolBusy = null; }
}

// Decoded audio is big, so only the most recent 30 clips stay in memory.
const bufCache = new Map();
function decode(snd) {
  const url = snd.sc.url;
  if (bufCache.has(url)) { const p = bufCache.get(url); bufCache.delete(url); bufCache.set(url, p); return p; }
  const p = (async () => {
    const sr = clamp(snd.sc.sampleRate || 48000, 8000, 384000);
    const ab = await (await fetch(url)).arrayBuffer();
    return new OfflineAudioContext(1, 1, sr).decodeAudioData(ab);
  })().catch(e => { bufCache.delete(url); throw e; });
  bufCache.set(url, p);
  while (bufCache.size > 30) bufCache.delete(bufCache.keys().next().value);
  return p;
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch { out[k] = null; } } }));
  return out;
}

// ---------------- analysis ----------------
const mono = buf => buf.getChannelData(0);
const hannCache = new Map();
const hann = N => { if (!hannCache.has(N)) hannCache.set(N, new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))); return hannCache.get(N); };

// Quality check for every recording (cached per detection):
//  - SNR: in the frequency band where the call stands out most, loud frames inside the
//    detection window (90th percentile) against quiet frames outside it (20th percentile).
//  - level: peak and RMS, so near-silent clips can be dropped and the rest levelled.
//  - tonality: how far the strongest spectral peak rises above the spectrum, its median
//    frequency (f0) and how much it wanders, which tells a whistle from a buzz or a click.
const inspected = new Map();
function inspect(snd) {
  if (!inspected.has(snd.id)) inspected.set(snd.id, decode(snd).then(buf => ({ ...inspectBuf(buf, snd), dur: buf.duration })).catch(e => { inspected.delete(snd.id); throw e; }));
  return inspected.get(snd.id);
}
function inspectBuf(buf, snd) {
  const { fft } = B(), x = mono(buf), sr = buf.sampleRate, tx = TX(snd);
  const N = 2 ** Math.round(Math.log2(sr * 0.021)), hop = N >> 1, K = N >> 1, bw = sr / N, win = hann(N);
  const fLo = tx > 1 ? 12000 : 250, fHi = Math.min(sr * 0.475, tx > 1 ? 150000 : 12000);
  const QB = 18, edges = []; for (let i = 0; i <= QB; i++) edges.push(clamp(Math.round(fLo * (fHi / fLo) ** (i / QB) / bw), 1, K - 1));
  const k0 = edges[0], k1 = edges[QB], nF = Math.max(0, Math.floor((x.length - N) / hop) + 1);
  const P = 360, peaks = new Float32Array(P * 2);
  for (let p = 0; p < P; p++) { let mn = 0, mx = 0; const a = Math.floor(p * x.length / P), b = Math.floor((p + 1) * x.length / P); for (let i = a; i < b; i++) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; } peaks[2 * p] = mn; peaks[2 * p + 1] = mx; }
  let pk = 0, ss = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; ss += v * v; }
  const base = { peaks, peakDb: db(pk), rmsDb: db(Math.sqrt(ss / Math.max(1, x.length))), tx };
  if (nF < 4 || pk === 0) return { ...base, snr: 0, label: 'silent', gain: 1, callRmsDb: -120, tonal: { prom: 0, f0: 0, spread: 99, voiced: 0, tPeak: 0 } };
  const E = new Float32Array(nF * QB), fe = new Float32Array(nF), pf = new Float32Array(nF), pr = new Float32Array(nF);
  const re = new Float64Array(N), im = new Float64Array(N), p2 = new Float32Array(K);
  for (let f = 0; f < nF; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let tot = 0, best = 0, bk = k0;
    for (let k = k0; k <= k1; k++) { const v = re[k] * re[k] + im[k] * im[k]; p2[k] = v; tot += v; if (v > best) { best = v; bk = k; } }
    for (let b = 0; b < QB; b++) { let s = 0; const e = Math.max(edges[b] + 1, edges[b + 1]); for (let k = edges[b]; k < e && k <= k1; k++) s += p2[k]; E[f * QB + b] = s; }
    fe[f] = tot; pf[f] = (bk * bw) / tx; pr[f] = 10 * Math.log10((best + 1e-20) / (tot / (k1 - k0 + 1) + 1e-20));
  }
  const st = snd.sc.startTime, en = snd.sc.endTime ?? (st != null ? st + 3 : null);
  const a = st != null ? clamp(Math.floor((st - 0.15) * sr / hop), 0, nF - 1) : 0, b = en != null ? clamp(Math.ceil((en + 0.15) * sr / hop), a + 1, nF) : nF;
  const callF = [], bgF = [];
  for (let f = 0; f < nF; f++) (f >= a && f < b ? callF : bgF).push(f);
  let bg = bgF;
  if (bg.length < 6) bg = [...Array(nF).keys()].sort((i, j) => fe[i] - fe[j]).slice(0, Math.max(3, Math.floor(nF * 0.3)));
  const sig = new Float32Array(QB), noi = new Float32Array(QB);
  for (let k = 0; k < QB; k++) { sig[k] = q(callF.map(f => E[f * QB + k]), 0.9); noi[k] = q(bg.map(f => E[f * QB + k]), 0.2) + 1e-14; }
  let bestR = 0, bestB = 0;
  for (let k = 0; k + 2 < QB; k++) { const r = (sig[k] + sig[k + 1] + sig[k + 2]) / (noi[k] + noi[k + 1] + noi[k + 2]); if (r > bestR) { bestR = r; bestB = k; } }
  const snr = 10 * Math.log10(Math.max(1e-6, bestR));
  const s0 = Math.floor(a * hop), s1 = Math.min(x.length, Math.floor(b * hop + N));
  let cp = 0, cs = 0; for (let i = s0; i < s1; i++) { const v = Math.abs(x[i]); if (v > cp) cp = v; cs += v * v; }
  const callRmsDb = db(Math.sqrt(cs / Math.max(1, s1 - s0)));
  const bgE = q(bg.map(f => fe[f]), 0.5);
  const voiced = callF.filter(f => fe[f] > bgE * 4);
  const vf = voiced.length >= 3 ? voiced : callF;
  let tPeak = st ?? 0, mp = -1; for (const f of vf) if (pr[f] > mp) { mp = pr[f]; tPeak = (f * hop) / sr; }
  const logs = vf.map(f => 12 * Math.log2(Math.max(20, pf[f])));
  const tonal = { prom: q(vf.map(f => pr[f]), 0.5), f0: q(vf.map(f => pf[f]), 0.5), spread: q(logs, 0.75) - q(logs, 0.25), voiced: voiced.length, tPeak };
  const label = base.peakDb < -78 || snr < 3 ? 'silent' : snr < 10 ? 'noisy' : snr < 16 ? 'ok' : 'clean';
  const gain = clamp(Math.min(10 ** ((-20 - callRmsDb) / 20), 0.95 / Math.max(1e-6, cp)), 0.3, 1000);   // field recorders often peak near -50 dBFS
  return { ...base, snr, label, gain, callRmsDb, band: Math.sqrt(edges[bestB] * edges[bestB + 3 > QB ? QB : bestB + 3]) * bw / tx, tonal };
}

function stft(x, N) {
  const { fft } = B(), hop = N >> 2, win = hann(N), frames = [], re = new Float64Array(N), im = new Float64Array(N);
  for (let o = 0; o + N <= x.length; o += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(N >> 1); for (let k = 0; k < m.length; k++) m[k] = Math.hypot(re[k], im[k]);
    frames.push(m);
  }
  return { frames, hop };
}
// Spectral-flux onset detection with an adaptive (moving median) threshold.
function onsets(buf) {
  const x = mono(buf), sr = buf.sampleRate, N = 2 ** Math.round(Math.log2(sr * 0.021));
  const { frames, hop } = stft(x, N);
  const nov = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f++) { let s = 0; const a = frames[f], b = frames[f - 1]; for (let k = 1; k < a.length; k++) { const d = Math.log1p(100 * a[k]) - Math.log1p(100 * b[k]); if (d > 0) s += d; } nov[f] = s; }
  let mx = 1e-9; for (const v of nov) if (v > mx) mx = v; for (let i = 0; i < nov.length; i++) nov[i] /= mx;
  const out = [], W = 8;
  for (let f = 2; f < nov.length - 2; f++) {
    const win = Array.from(nov.slice(Math.max(0, f - W), Math.min(nov.length, f + W + 1))).sort((a, b) => a - b);
    if (nov[f] > win[win.length >> 1] + 0.12 && nov[f] >= nov[f - 1] && nov[f] >= nov[f + 1] && nov[f] >= nov[f - 2] && nov[f] >= nov[f + 2]) out.push({ t: (f * hop) / sr, s: nov[f] });
  }
  return out;
}
function makeSlice(buf, t0, maxLen) {
  const x = mono(buf), sr = buf.sampleRate, s0 = Math.max(0, Math.round((t0 - 0.004) * sr));
  const max = Math.max(1, Math.min(x.length - s0, Math.round(maxLen * sr))), win = Math.max(1, Math.round(0.01 * sr));
  let peak = 0, peakAt = 0; for (let i = 0; i < Math.min(max, 0.06 * sr); i++) { const v = Math.abs(x[s0 + i]); if (v > peak) { peak = v; peakAt = i; } }
  let end = max;
  for (let i = peakAt; i + win < max; i += win) { let r = 0; for (let j = 0; j < win; j++) r = Math.max(r, Math.abs(x[s0 + i + j])); if (r < peak * 0.04 && i > 0.06 * sr) { end = i + win; break; } }
  const len = Math.max(Math.round(0.05 * sr), end);
  const out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: sr }), y = out.getChannelData(0);
  const fi = Math.round(0.002 * sr), fo = Math.min(len >> 1, Math.round(0.015 * sr));
  for (let i = 0; i < len; i++) { let g = 1; if (i < fi) g = i / fi; else if (i > len - fo) g = (len - i) / fo; y[i] = (x[s0 + i] || 0) * g; }
  return out;
}
function features(slice, tx) {
  const x = mono(slice), sr = slice.sampleRate, N = Math.max(64, Math.min(2 ** Math.round(Math.log2(sr * 0.02)), 2 ** Math.floor(Math.log2(x.length))));
  const { frames } = stft(x, N), K = frames[0]?.length || 1, avg = new Float64Array(K);
  frames.forEach(f => { for (let k = 0; k < K; k++) avg[k] += f[k]; });
  let num = 0, den = 0, lg = 0, ar = 0, low = 0;
  for (let k = 1; k < K; k++) { const p = avg[k] + 1e-12, f = (k * sr) / (2 * K) / tx; num += f * p; den += p; lg += Math.log(p); ar += p; if (f < 500) low += p; }
  let rms = 0, pk = 0, pkAt = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); rms += v * v; if (v > pk) { pk = v; pkAt = i; } }
  let dec = x.length; for (let i = pkAt; i < x.length; i += 64) if (Math.abs(x[i]) < pk * 0.1) { let quiet = true; for (let j = i; j < Math.min(x.length, i + 256); j++) if (Math.abs(x[j]) > pk * 0.1) { quiet = false; break; } if (quiet) { dec = i; break; } }
  return { centroid: num / den, flatness: Math.exp(lg / (K - 1)) / (ar / (K - 1)), low: low / den, dur: x.length / sr * tx, rms: Math.sqrt(rms / x.length), attack: pkAt / sr * tx, decay: (dec - pkAt) / sr * tx };
}
function bestOnset(snd, list) {
  const a = (snd.sc.startTime ?? 0) - 0.3, b = (snd.sc.endTime ?? 1e9) + 0.3;
  const inWin = list.filter(o => o.t >= a && o.t <= b);
  return (inWin.length ? inWin : list).reduce((m, o) => o.s > (m?.s ?? -1) ? o : m, null)?.t ?? Math.max(0, snd.sc.startTime || 0);
}

// ---------------- key + scale ----------------
const SCALES = { 'minor pentatonic': [0, 3, 5, 7, 10], 'major pentatonic': [0, 2, 4, 7, 9], 'natural minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10], 'major': [0, 2, 4, 5, 7, 9, 11] };
let key = { root: 9, scale: 'minor pentatonic' };
const S = () => SCALES[key.scale];
const noteAt = i => { const s = S(), n = s.length; return key.root + 12 * Math.floor(i / n) + s[((i % n) + n) % n]; };
function nearestIdx(m) { const n = S().length, i0 = (Math.floor((m - key.root) / 12) - 1) * n; let best = i0, bd = 1e9; for (let i = i0; i < i0 + 3 * n; i++) { const d = Math.abs(noteAt(i) - m); if (d < bd) { bd = d; best = i; } } return best; }
const pcDist = (a, b) => { const d = Math.abs(((a - b) % 12 + 12) % 12); return Math.min(d, 12 - d); };
// Pick the key that needs the least retuning across the tonal pads (most tonal pad wins ties).
function autoKey(tonalPads) {
  const ms = tonalPads.map(p => ({ m: p.m0, w: 1 + Math.max(0, p.ins.tonal.prom - 15) / 10 }));
  if (!ms.length) return;
  let best = key.root, bc = 1e9;
  for (let r = 0; r < 12; r++) {
    const s = S(); let c = 0;
    for (const { m, w } of ms) c += w * Math.min(...s.map(x => pcDist(m, r + x)));
    c += pcDist(ms[0].m, r) * 0.01;
    if (c < bc - 1e-9) { bc = c; best = r; }
  }
  key.root = best;
}
function tune(p, keepOct) {
  p.base = nearestIdx(p.m0);
  if (keepOct) return;
  const e0 = noteAt(p.base) - p.m0, f0 = p.ins.tonal.f0;
  if (p.role.k === 'low') { let k = -3; while (k < 0 && f0 * 2 ** ((e0 + 12 * k) / 12) < 55) k++; p.pitch = 12 * k; }   // as low as it goes, but not below ~55 Hz
  else if (p.role.k === 'lead') p.pitch = f0 > 4000 ? -24 : f0 > 1500 ? -12 : 0;
  else p.pitch = f0 > 8000 ? -24 : f0 > 4000 ? -12 : 0;
}
const semis = (p, deg = 0) => p.role.tonal && p.m0 != null ? noteAt(p.base + deg) - p.m0 + p.pitch : p.pitch;
const kickHz = () => { let m = 24 + key.root; if (m < 29) m += 12; return 440 * 2 ** ((m - 69) / 12); };

// ---------------- kit ----------------
const ROLES = [
  { k: 'kick', name: 'Kick', key: '1', note: 36, A: 0.001, D: 0.22, S: 0, R: 0.05, hp: 20, lp: 1400, max: 0.45, body: 0.6 },
  { k: 'snare', name: 'Snare', key: '2', note: 38, A: 0.001, D: 0.16, S: 0.1, R: 0.08, hp: 200, lp: 12000, max: 0.45 },
  { k: 'chat', name: 'Closed hat', key: '3', note: 42, A: 0.001, D: 0.045, S: 0, R: 0.02, hp: 4000, lp: 20000, max: 0.25 },
  { k: 'ohat', name: 'Open hat', key: '4', note: 46, A: 0.001, D: 0.28, S: 0.2, R: 0.15, hp: 3000, lp: 20000, max: 0.6 },
  { k: 'perc', name: 'Perc', key: '5', note: 37, A: 0.001, D: 0.12, S: 0, R: 0.05, hp: 250, lp: 16000, max: 0.35 },
  { k: 'low', name: 'Low voice', key: '6', ch: 0, tonal: true, A: 0.004, D: 0.3, S: 0.65, R: 0.14, hp: 30, lp: 5000, max: 0.9, steps: 2 },
  { k: 'lead', name: 'Lead', key: '7', ch: 1, tonal: true, A: 0.006, D: 0.25, S: 0.55, R: 0.15, hp: 120, lp: 12000, max: 0.7, steps: 1.6 },
  { k: 'call', name: 'Call', key: '8', ch: 2, tonal: true, A: 0.02, D: 0.5, S: 0.7, R: 0.35, hp: 150, lp: 16000, max: 2.2, gate: 1.4 },
];
let pads = [], selPad = 0, candidates = [], kitBusy = false;

async function analyse(snd) {
  const buf = await decode(snd), ins = await inspect(snd), tx = TX(snd);
  const list = onsets(buf), t0d = bestOnset(snd, list);
  return { snd, buf, tx, ins, onsets: list, t0d, f: features(makeSlice(buf, t0d, 0.5 / tx), tx) };
}
const isTonal = c => c.ins.tonal.voiced >= 4 && c.ins.tonal.prom >= 14 && c.ins.tonal.f0 > 80;
const tonalScore = c => isTonal(c) ? c.ins.tonal.prom - 1.2 * Math.min(c.ins.tonal.spread, 12) : -99;
const percScore = c => c.f.flatness * 40 + (c.f.attack < 0.012 ? 4 : 0) - Math.max(0, c.ins.tonal.prom - 16) * 0.4;
function padFrom(role, c) {
  const p = { role, snd: c.snd, buf: c.buf, tx: c.tx, ins: c.ins, onsets: c.onsets, f: c.f, A: role.A, D: role.D, S: role.S, R: role.R, hp: role.hp, lp: role.lp, gain: 0.9, pitch: 0, rev: false, body: role.body || 0, m0: null };
  if (role.tonal) {
    const tp = c.ins.tonal.tPeak, before = c.onsets.filter(o => o.t <= tp + 0.01 && o.t >= tp - 0.5 / c.tx);
    p.t0 = before.length ? before.at(-1).t : Math.max(0, tp - 0.03 / c.tx);
    if (isTonal(c)) { p.m0 = 69 + 12 * Math.log2(c.ins.tonal.f0 / 440); tune(p); }
  } else {
    p.t0 = c.t0d;
    const cen = Math.max(60, c.f.centroid);
    p.pitch = Math.round(role.k === 'kick' ? clamp(12 * Math.log2(130 / cen), -36, 0) : role.k === 'snare' ? (cen > 5000 ? clamp(12 * Math.log2(3000 / cen), -24, 0) : 0)
      : role.k === 'chat' || role.k === 'ohat' ? clamp(12 * Math.log2(8000 / cen), -7, 12) : clamp(12 * Math.log2(1800 / cen), -24, 12));
  }
  reslice(p);
  return p;
}
function reslice(p) {
  p.slice = makeSlice(p.buf, p.t0, p.role.max / p.tx); p.rslice = null;
  let pk = 0; for (const v of mono(p.slice)) pk = Math.max(pk, Math.abs(v));
  p.ng = clamp(0.9 / Math.max(1e-6, pk), 0.5, 1000);         // every pad starts at the same peak level
}
// Roles by sound, not by chance: steady whistles become the tuned voices, noisy fast hits become drums.
function assign(cands) {
  const left = [...cands], usedSp = new Map();
  // Prefer a different species on every pad: each reuse of a species costs points.
  const take = score => { if (!left.length) return null; let bi = 0, bs = -1e9; left.forEach((c, i) => { const s = score(c) - 6 * (usedSp.get(c.snd.sp.id) || 0); if (s > bs) { bs = s; bi = i; } }); const c = left.splice(bi, 1)[0]; usedSp.set(c.snd.sp.id, (usedSp.get(c.snd.sp.id) || 0) + 1); return c; };
  const by = {};
  // the two steadiest tonal calls: the lower one becomes the low voice, the other the lead
  const t1 = take(c => tonalScore(c) - (c.ins.tonal.spread > 4 ? 8 : 0)), t2 = take(c => tonalScore(c) - (c.ins.tonal.spread > 4 ? 8 : 0));
  [by.low, by.lead] = t1 && t2 && isTonal(t1) && isTonal(t2) && t1.ins.tonal.f0 > t2.ins.tonal.f0 ? [t2, t1] : [t1, t2];
  by.call = take(c => isTonal(c) ? c.ins.tonal.prom * 0.5 + Math.min(12, c.ins.tonal.spread) + c.f.dur * 3 : c.f.dur * 3 - 10);
  by.chat = take(c => percScore(c) + c.f.centroid / 1500 - c.f.decay * 8);
  by.ohat = take(c => percScore(c) + c.f.centroid / 2000);
  by.snare = take(c => c.f.flatness * 50 + (c.f.centroid > 1200 && c.f.centroid < 8000 ? 3 : 0) + (c.f.attack < 0.012 ? 2 : 0));
  by.kick = take(c => -c.f.centroid / 900 + (c.f.attack < 0.015 ? 3 : 0) + c.f.low * 12 + c.f.flatness * 5);
  by.perc = take(c => percScore(c) - c.f.decay * 4);
  const ps = ROLES.map(r => padFrom(r, by[r.k] || pick(cands)));
  const tonalPads = ps.filter(p => p.m0 != null).sort((a, b) => (a.role.k === 'lead' ? -1 : 0) - (b.role.k === 'lead' ? -1 : 0));
  if ($('kRoot').value === 'auto') { autoKey(tonalPads); }
  tonalPads.forEach(p => tune(p));
  return ps;
}
async function buildKit() {
  if (kitBusy || !region) return; kitBusy = true;
  const g = gen, st = $('kitStatus');
  togglePlay(false);
  try {
    st.textContent = 'Collecting recordings from the mics around the pin…';
    if (!pool.length) await loadPool();
    if (g !== gen) return;
    if (pool.length < 3) { st.textContent = 'Not enough recordings near this pin. Try a busier area, or more mics.'; return; }
    // distinct species first (rarer groups up front), then everything else
    const bySp = new Map(), rest = [];
    for (const s of [...pool].sort(() => Math.random() - 0.5)) { if (bySp.has(s.sp.id)) rest.push(s); else bySp.set(s.sp.id, s); }
    const order = [...[...bySp.values()].filter(s => s.cls !== 'bird').slice(0, 4), ...[...bySp.values()].filter(s => s.cls === 'bird'), ...rest];
    const good = [], noisy = []; let tried = 0;
    for (let i = 0; i < order.length && (good.length < 14 || new Set(good.map(c => c.snd.sp.id)).size < 8) && tried < 44; i += 4) {
      const batch = order.slice(i, i + 4); tried += batch.length;
      const res = await mapLimit(batch, 4, analyse);
      if (g !== gen) return;
      for (const c of res) if (c) (c.ins.label === 'clean' || c.ins.label === 'ok' ? good : c.ins.label === 'noisy' ? noisy : []).push(c);
      st.textContent = `Checking recordings for noise and silence… ${good.length} clean of ${tried}`;
    }
    const cands = good.length >= 8 ? good : [...good, ...noisy.sort((a, b) => b.ins.snr - a.ins.snr)].slice(0, Math.max(8, good.length));
    if (cands.length < 3) { st.textContent = 'The recordings near this pin are too quiet or noisy for a kit. Try a busier area, or more mics.'; return; }
    candidates = cands;
    pads = assign(cands);
    selPad = 0;
    renderKey(); renderPads(); renderEditor();
    if (!pattern.some(r => r.some(Boolean))) generate($('kStyle').value);
    const nTonal = pads.filter(p => p.m0 != null).length;
    st.textContent = `Kit from ${new Set(pads.map(p => p.snd.sp.id)).size} species near ${region.label}. ${nTonal} tonal call${nTonal === 1 ? '' : 's'} tuned to ${NOTE[key.root]} ${key.scale}${good.length < 8 ? ', some recordings are noisy here' : ''}. Press space to play.`;
  } catch (e) { st.textContent = 'Could not build a kit: ' + e.message; }
  finally { kitBusy = false; }
}
async function swapPad(i, snd) {
  const p = pads[i]; if (!p) return;
  const st = $('kitStatus'); st.textContent = 'Analysing new sound…';
  let c;
  if (snd) c = await analyse(snd);
  else {
    const used = new Set(pads.map(x => x.snd.id)), spare = candidates.filter(x => !used.has(x.snd.id));
    const fit = p.role.tonal ? spare.filter(isTonal) : spare.filter(x => !isTonal(x));
    c = (fit.length ? fit : spare).sort((a, b) => (p.role.tonal ? tonalScore(b) - tonalScore(a) : percScore(b) - percScore(a)))[Math.floor(Math.random() * Math.min(3, (fit.length || spare.length)))];
    if (!c) {
      if (poolMore) await loadPool(true);
      const s = pool.filter(x => !used.has(x.id) && !candidates.some(y => y.snd.id === x.id));
      for (const x of s.slice(0, 8)) { const r = await analyse(x).catch(() => null); if (r && r.ins.label !== 'silent') { candidates.push(r); if (!c && (r.ins.label !== 'noisy')) c = r; } }
      if (!c) { st.textContent = 'No more clean sounds near this pin.'; return; }
    }
  }
  const keep = { gain: p.gain, A: p.A, D: p.D, S: p.S, R: p.R, hp: p.hp, lp: p.lp, body: p.body };
  pads[i] = Object.assign(padFrom(p.role, c), keep);
  renderPads(); renderEditor(); trigger(pads[i], audioCtx().currentTime + 0.01);
  st.textContent = `${p.role.name} is now ${c.snd.sp.commonName}${p.role.tonal && pads[i].m0 == null ? ' (not tonal, so it plays untuned)' : ''}.`;
}

function reversed(p) {
  if (!p.rslice) { const b = p.slice, r = new AudioBuffer({ length: b.length, numberOfChannels: 1, sampleRate: b.sampleRate }), x = b.getChannelData(0), y = r.getChannelData(0); for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i]; p.rslice = r; }
  return p.rslice;
}
const voices = new Map();
function trigger(p, when, vel = 1, gate, c = audioCtx(), dest = master, deg = 0) {
  if (!p?.slice) return;
  if (p.role.k === 'chat' && voices.get('ohat') && c === ctx) { const v = voices.get('ohat'); try { v.g.gain.cancelScheduledValues(when); v.g.gain.setTargetAtTime(0, when, 0.01); } catch { } }
  const s = c.createBufferSource(); s.buffer = p.rev ? reversed(p) : p.slice;
  s.playbackRate.value = (1 / p.tx) * 2 ** (semis(p, deg) / 12);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hp;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.lp;
  const g = c.createGain(), pk = vel * p.gain * p.ng, A = Math.max(0.001, p.A), D = Math.max(0.005, p.D);
  const gt = gate ?? p.role.gate ?? 0.12, tOff = when + Math.max(gt, A + D);
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(pk, when + A); g.gain.linearRampToValueAtTime(pk * p.S, when + A + D);
  g.gain.setValueAtTime(pk * p.S, tOff); g.gain.linearRampToValueAtTime(0, tOff + Math.max(0.005, p.R));
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(dest);
  s.start(when); s.stop(tOff + p.R + 0.05);
  // Kick body: a short tuned sine drop under the field-recorded transient, so the kick has weight.
  if (p.role.k === 'kick' && p.body > 0) {
    const o = c.createOscillator(), og = c.createGain(), f = kickHz() * 2 ** (Math.max(-12, Math.min(12, p.pitch - Math.round(clamp(12 * Math.log2(130 / Math.max(60, p.f.centroid)), -36, 0)))) / 12);
    o.frequency.setValueAtTime(f * 3.2, when); o.frequency.exponentialRampToValueAtTime(f, when + 0.045);
    const dur = Math.max(0.12, p.D * 1.3);
    og.gain.setValueAtTime(0, when); og.gain.linearRampToValueAtTime(vel * p.body * p.gain * 0.9, when + 0.003); og.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(og); og.connect(dest); o.start(when); o.stop(when + dur + 0.02);
  }
  if (c === ctx) { voices.set(p.role.k, { g }); flashPad(p, when); }
}
function flashPad(p, when) {
  const i = pads.indexOf(p), el = document.querySelector(`.pad[data-i="${i}"]`); if (!el) return;
  setTimeout(() => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }, Math.max(0, (when - ctx.currentTime) * 1000));
}

// ---------------- sequencer ----------------
const STEPS = 16;
let pattern = ROLES.map(() => Array(STEPS).fill(0)), notes = ROLES.map(() => Array(STEPS).fill(0)), bpm = 96, swing = 0.12, playing = false, step = 0, nextT = 0, schedTimer = null;
// rows: kick, snare, closed hat, open hat, perc, low voice, lead, call (digits = chance out of 9)
const STYLES = {
  'House': { bpm: 122, p: ['9000900090009000', '0000900000009000', '5555555555555555', '0090009000900090', '0002000300020004', '9000000700900000', '0060030000600300', '3000000000000000'] },
  'Boom bap': { bpm: 90, p: ['9000000690300000', '0000900000009000', '7070707070707070', '0000000000000005', '0010000100100001', '9000000090000000', '0000005000050000', '4000000000000000'] },
  'Breakbeat': { bpm: 132, p: ['9000000009300000', '0000900200009002', '8585858585858585', '0000000300000003', '0300003000300300', '9000000009000000', '0005000000050300', '3000000030000000'] },
  'Techno': { bpm: 130, p: ['9000900090009000', '0003000000300000', '0090009000900090', '0000000000000000', '3030303030303030', '0090009000900090', '0000040000000400', '2000000000000000'] },
  'Dembow': { bpm: 100, p: ['9000900090009000', '0009009000090090', '6060606060606060', '0000000000000000', '0000300000003000', '9000000090000000', '0000000600000060', '3000000000000000'] },
  'Dawn chorus': { bpm: 84, euclid: [3, 2, 7, 2, 5, 3, 5, 2] },
};
function euclid(k, n) { const out = []; let b = -1; for (let i = 0; i < n; i++) { const v = Math.floor((i * k) / n); out.push(v !== b ? 1 : 0); b = v; } return out; }
function melody(i) {
  const k = ROLES[i].k; let d = 0;
  return pattern[i].map((v, j) => {
    if (!v) return 0;
    if (k === 'low') return pick([0, 0, 0, 0, -2, 3]);
    if (k === 'call') return pick([0, 0, 3, 5]);
    d = clamp(d + pick([-2, -1, -1, 0, 1, 1, 2]), -2, 6);
    return j >= 12 && !pattern[i].slice(j + 1).some(Boolean) ? pick([0, 2]) : d;
  });
}
function generate(style) {
  const s = STYLES[style];
  bpm = s.bpm + Math.round(rnd(-3, 3)); $('kBpm').value = bpm; $('kBpmV').textContent = bpm;
  pattern = ROLES.map((r, i) => {
    if (s.euclid) { const k = s.euclid[i] ? s.euclid[i] + Math.round(rnd(-1, 1)) : 0, rot = Math.floor(rnd(0, 16)), e = euclid(clamp(k, 0, 16), STEPS); return e.map((_, j) => e[(j + rot) % STEPS] ? +(rnd(0.55, 1)).toFixed(2) : 0); }
    return [...s.p[i]].map((ch, j) => { const pr = +ch / 9; if (Math.random() >= pr) return 0; return +(j % 4 === 0 ? rnd(0.9, 1) : rnd(0.55, 0.85)).toFixed(2); });
  });
  if (!s.euclid) pattern[0][0] = 1;
  notes = ROLES.map((r, i) => r.tonal ? melody(i) : Array(STEPS).fill(0));
  renderSeq();
}
function mutate() {
  for (let n = 0; n < 4; n++) { const r = 1 + Math.floor(Math.random() * 7), j = Math.floor(Math.random() * STEPS); pattern[r][j] = pattern[r][j] ? 0 : +rnd(0.5, 0.9).toFixed(2); if (ROLES[r].tonal && pattern[r][j]) notes[r][j] = pick([0, 1, 2, 3, -1]); }
  for (let n = 0; n < 2; n++) { const j = Math.floor(Math.random() * STEPS); if (pattern[6][j]) notes[6][j] = clamp(notes[6][j] + pick([-1, 1, 2, -2]), -2, 6); }
  renderSeq();
}
const stepDur = () => 60 / bpm / 4;
const gateFor = i => ROLES[i].k === 'ohat' ? stepDur() * 1.6 : ROLES[i].steps ? stepDur() * ROLES[i].steps : undefined;
function scheduleStep(j, t) { pattern.forEach((row, i) => { if (row[j] && pads[i]) trigger(pads[i], t, row[j], gateFor(i), undefined, undefined, notes[i][j]); }); }
function schedTick() {
  while (nextT < ctx.currentTime + 0.12) {
    const t = nextT + (step % 2 ? swing * stepDur() : 0);
    scheduleStep(step, t);
    const j = step; setTimeout(() => { if (playing) document.querySelectorAll('.seq .col').forEach((c, k) => c.classList.toggle('now', k === j)); }, Math.max(0, (t - ctx.currentTime) * 1000));
    step = (step + 1) % STEPS; nextT += stepDur();
  }
}
function togglePlay(on = !playing) {
  if (on && !pads.length) return;
  if (on) { stopMon(); B().pauseMain(); }
  playing = on;
  playBtn($('kPlay'), on);
  clearInterval(schedTimer);
  document.querySelectorAll('.seq .col').forEach(c => c.classList.remove('now'));
  if (on) { audioCtx(); step = 0; nextT = ctx.currentTime + 0.06; schedTimer = setInterval(schedTick, 25); schedTick(); }
}

// ---------------- export helpers ----------------
function wav(buffer, bits = 24) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length, by = bits / 8, dl = len * ch * by;
  const ab = new ArrayBuffer(44 + dl), dv = new DataView(ab), ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); dv.setUint32(4, 36 + dl, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * by, true); dv.setUint16(32, ch * by, true); dv.setUint16(34, bits, true); ws(36, 'data'); dv.setUint32(40, dl, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = clamp(data[c][i], -1, 1);
    if (bits === 16) { dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    else { const v = Math.round(s * 8388607); dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3; }
  }
  return new Uint8Array(ab);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zip(files) {     // store-only ZIP; files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), parts = [], cent = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true));
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true));
    cent.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const csz = cent.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, csz, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  return new Blob([...parts, ...cent, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
// Drums on channel 10 (GM notes); tuned pads on channels 1–3 at the pitch they actually sound.
function midi(pat, tempo) {
  const evs = [];
  pat.forEach((row, i) => row.forEach((v, j) => {
    if (!v) return;
    const r = ROLES[i], p = pads[i];
    const n = r.tonal ? clamp(Math.round(p && p.m0 != null ? p.m0 + semis(p, notes[i][j]) : 60 + notes[i][j] * 2), 0, 127) : r.note, ch = r.tonal ? r.ch : 9;
    const len = r.tonal ? Math.round(24 * (r.steps || 2)) - 2 : 12;
    evs.push([j * 24, 0x90 | ch, n, Math.round(v * 127)]); evs.push([j * 24 + len, 0x80 | ch, n, 0]);
  }));
  evs.sort((a, b) => a[0] - b[0] || ((a[1] & 0xf0) === 0x80 ? -1 : 1));
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const us = Math.round(60e6 / tempo), trk = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  let last = 0; for (const [t, s, n, v] of evs) { trk.push(...vlq(t - last), s, n, v); last = t; }
  trk.push(...vlq(Math.max(0, STEPS * 24 - last)), 0xff, 0x2f, 0);
  const hd = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96], th = [0x4d, 0x54, 0x72, 0x6b, (trk.length >>> 24) & 255, (trk.length >> 16) & 255, (trk.length >> 8) & 255, trk.length & 255];
  return new Blob([new Uint8Array([...hd, ...th, ...trk])], { type: 'audio/midi' });
}
function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const slug = s => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'sound';
const credit = s => `${s.sp.commonName} (${s.sp.scientificName || ''}) · ${s.st?.name || 'station'}${s.st?.country ? ', ' + s.st.country : ''} · ${new Date(s.t).toISOString()} · BirdNET ${Math.round((s.conf || 0) * 100)}%${isUltra(s) ? ' · ultrasonic, ' + s.sc.sampleRate + ' Hz' : ''} · ${s.sc.url}`;
const LICENSE = 'Recordings come from BirdWeather stations run by members of the public (app.birdweather.com), recognised by BirdNET. Credit the station and BirdWeather. Check BirdWeather\'s terms and contact the station owner before commercial use. Species labels are automated and can be wrong.';
function normalize(buf, peakDb = -1) { let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) pk = Math.max(pk, Math.abs(v)); const g = pk ? 10 ** (peakDb / 20) / pk : 1; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } return buf; }
async function renderOneShot(p) {
  const playDur = p.slice.duration * p.tx / 2 ** (semis(p) / 12), gate = p.role.gate ?? (p.S > 0 ? Math.min(playDur, 0.6) : p.A + p.D);
  const len = Math.min(Math.max(playDur, p.body ? 0.2 : 0), Math.max(gate, p.A + p.D) + p.R) + 0.05, oc = new OfflineAudioContext(1, Math.ceil(len * 48000), 48000);
  trigger(p, 0, 1, gate, oc, oc.destination);
  return normalize(await oc.startRendering(), -1);
}
async function exportKit() {
  if (!pads.length) return;
  const st = $('kitStatus'); st.textContent = 'Rendering kit…';
  const files = [];
  for (const [i, p] of pads.entries()) files.push({ name: `${String(i + 1).padStart(2, '0')}_${p.role.name.replace(/\s/g, '-')}${p.m0 != null ? '_' + noteName(p.m0 + semis(p)).replace('♯', 's').replace('♭', 'b') : ''}_${slug(p.snd.sp.commonName)}.wav`, data: wav(await renderOneShot(p), 24) });
  files.push({ name: 'pattern.mid', data: new Uint8Array(await midi(pattern, bpm).arrayBuffer()) });
  files.push({ name: 'kit.json', data: new TextEncoder().encode(JSON.stringify({ place: region.label, pin: [region.lat, region.lon], key: `${NOTE[key.root]} ${key.scale}`, bpm, swing, pattern, notes, pads: pads.map(p => ({ role: p.role.name, species: p.snd.sp.commonName, scientific: p.snd.sp.scientificName, station: p.snd.st?.name, onset: +p.t0.toFixed(3), sourcePitchHz: p.m0 != null ? +p.ins.tonal.f0.toFixed(1) : null, playsAs: p.m0 != null ? noteName(p.m0 + semis(p)) : null, transpose: +semis(p).toFixed(2), snrDb: +p.ins.snr.toFixed(1), A: p.A, D: p.D, S: p.S, R: p.R, hp: p.hp, lp: p.lp, body: p.body || 0, reverse: p.rev, timeExpansion: p.tx, source: p.snd.sc.url })) }, null, 2)) });
  files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(`Biophony field kit · ${region.label} · ${NOTE[key.root]} ${key.scale}\n\n${pads.map((p, i) => `${i + 1}. ${p.role.name}: ${credit(p.snd)}`).join('\n')}\n\nThe kick includes a short tuned sine layer under the recorded transient (set "Body" to 0 to remove it).\n\n${LICENSE}\n`) });
  save(zip(files), `biophony-kit_${slug(region.label)}.zip`);
  st.textContent = 'Kit downloaded: 8 one-shots (24-bit WAV, tuned pads named by note), the pattern as MIDI, settings and credits.';
}
async function exportLoop(bars = 4) {
  if (!pads.length) return;
  const sd = stepDur(), len = bars * STEPS * sd + 2.5, oc = new OfflineAudioContext(2, Math.ceil(len * 48000), 48000);
  const comp = oc.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 12; comp.connect(oc.destination);
  for (let b = 0; b < bars; b++) for (let j = 0; j < STEPS; j++) { const t = (b * STEPS + j) * sd + (j % 2 ? swing * sd : 0); pattern.forEach((row, i) => { if (row[j]) trigger(pads[i], t, row[j], gateFor(i), oc, comp, notes[i][j]); }); }
  const out = normalize(await oc.startRendering(), -1);
  const L = Math.round(bars * STEPS * sd * 48000), loop = new AudioBuffer({ length: L, numberOfChannels: 2, sampleRate: 48000 });
  for (let c = 0; c < 2; c++) { const s = out.getChannelData(c), d = loop.getChannelData(c); for (let i = 0; i < L; i++) d[i] = s[i] + (i + L < s.length ? s[i + L] : 0); }
  save(new Blob([wav(normalize(loop, -1), 24)], { type: 'audio/wav' }), `biophony-loop_${bpm}bpm_${NOTE[key.root].replace('♯', 's').replace('♭', 'b')}_${slug($('kStyle').value)}.wav`);
}

// ---------------- drawing ----------------
function sizeCv(cv) { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * dpr | 0); cv.height = Math.max(1, r.height * dpr | 0); return dpr; }
function drawWave(cv, buf, opts = {}) {
  const dpr = sizeCv(cv), g = cv.getContext('2d'), W = cv.width, H = cv.height, x = mono(buf), n = x.length, a = opts.from ?? 0, b = opts.to ?? n;
  g.clearRect(0, 0, W, H);
  if (opts.hl) { g.fillStyle = 'rgba(120,214,192,.14)'; g.fillRect(((opts.hl[0] - a) / (b - a)) * W, 0, ((opts.hl[1] - opts.hl[0]) / (b - a)) * W, H); }
  if (opts.call) { g.fillStyle = 'rgba(227,183,101,.10)'; g.fillRect(((opts.call[0] - a) / (b - a)) * W, 0, ((opts.call[1] - opts.call[0]) / (b - a)) * W, H); }
  g.fillStyle = opts.color || '#78d6c0';
  const per = (b - a) / W;
  let pk = 1e-6; for (let i = a; i < b; i += Math.max(1, ((b - a) / 4000) | 0)) pk = Math.max(pk, Math.abs(x[i] || 0));
  const gain = Math.min(3000, 0.95 / pk);
  for (let px = 0; px < W; px++) { let mn = 1, mx = -1; const s = a + Math.floor(px * per), e = Math.min(n, s + Math.max(1, Math.floor(per))); for (let i = s; i < e; i += Math.max(1, (per / 64) | 0)) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; } if (mx < mn) continue; g.fillRect(px, H / 2 - mx * gain * H * 0.48, 1, Math.max(1, (mx - mn) * gain * H * 0.48)); }
  if (opts.ticks) { g.fillStyle = 'rgba(233,239,233,.55)'; for (const t of opts.ticks) { const X = ((t.t * buf.sampleRate - a) / (b - a)) * W; g.fillRect(X, 0, Math.max(1, dpr), H * (0.15 + 0.35 * t.s)); } }
  if (opts.mark != null) { g.fillStyle = '#e3b765'; g.fillRect(((opts.mark - a) / (b - a)) * W - dpr, 0, 2 * dpr, H); }
}
function drawPeaks(cv, peaks, opts = {}) {
  sizeCv(cv);
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, P = peaks.length / 2;
  g.clearRect(0, 0, W, H);
  if (opts.call) { g.fillStyle = 'rgba(227,183,101,.13)'; g.fillRect(opts.call[0] * W, 0, (opts.call[1] - opts.call[0]) * W, H); }
  let pk = 1e-6; for (const v of peaks) pk = Math.max(pk, Math.abs(v));
  const gain = Math.min(3000, 0.95 / pk);
  g.fillStyle = opts.color || '#78d6c0';
  for (let px = 0; px < W; px++) { const i = Math.min(P - 1, Math.floor(px / W * P)), mn = peaks[2 * i], mx = peaks[2 * i + 1]; g.fillRect(px, H / 2 - mx * gain * H * 0.48, 1, Math.max(1, (mx - mn) * gain * H * 0.48)); }
}

// ---------------- kit UI ----------------
const padMeta = p => p.m0 != null ? `tonal · ${hz(p.ins.tonal.f0)} → ${noteName(p.m0 + semis(p))}` : `${p.role.tonal ? 'untuned' : 'noisy hit'}${p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${Math.round(p.pitch)} st` : ''}`;
function renderPads() {
  const el = $('pads');
  el.replaceChildren(...pads.map((p, i) => {
    const b = h('button', { class: 'pad' + (i === selPad ? ' sel' : '') + (p.role.tonal ? ' tonal' : ''), 'data-i': i, style: `--c:${COL(p.snd.cls)}`, title: `${p.role.name}: ${p.snd.sp.commonName}. Key ${p.role.key}` },
      h('span', { class: 'pad-role' }, p.role.name, h('kbd', {}, p.role.key)),
      h('span', { class: 'pad-sp' }, p.snd.sp.commonName),
      h('span', { class: 'pad-meta' }, padMeta(p), p.tx > 1 ? ' · bat ×10' : ''),
      h('canvas', { class: 'pad-wave' }));
    b.addEventListener('pointerdown', () => { selPad = i; document.querySelectorAll('.pad').forEach((x, k) => x.classList.toggle('sel', k === i)); trigger(p, audioCtx().currentTime + 0.005); renderEditor(); });
    return b;
  }));
  requestAnimationFrame(() => el.querySelectorAll('.pad-wave').forEach((cv, i) => drawWave(cv, pads[i].slice, { color: COL(pads[i].snd.cls) })));
  renderSeq();
}
function renderPadsMeta() {
  document.querySelectorAll('.pad').forEach((b, i) => { const p = pads[i]; if (!p) return; b.querySelector('.pad-meta').textContent = padMeta(p) + (p.tx > 1 ? ' · bat ×10' : ''); drawWave(b.querySelector('.pad-wave'), p.slice, { color: COL(p.snd.cls) }); });
}
function envSvg(p) {
  const NS = 'http://www.w3.org/2000/svg', W = 200, H = 60, tot = p.A + p.D + 0.25 + p.R, X = t => (t / tot) * W, Y = v => H - 4 - v * (H - 8);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'env'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M0,${Y(0)} L${X(p.A)},${Y(1)} L${X(p.A + p.D)},${Y(p.S)} L${X(p.A + p.D + 0.25)},${Y(p.S)} L${X(tot)},${Y(0)}`);
  svg.append(path);
  return svg;
}
function renderEditor() {
  const p = pads[selPad], el = $('editor');
  if (!p) { el.replaceChildren(); return; }
  const sr = p.buf.sampleRate, s = p.snd, t = p.ins.tonal;
  const cv = h('canvas', { class: 'src-wave', title: 'Click to move the slice start. Ticks are detected transients; the gold line is the slice start.' });
  const env = h('div', { class: 'env-wrap' }, envSvg(p));
  const ctl = (label, k, min, max, stepv, fmtv, log) => {
    const toS = v => log ? Math.log(v) : v, frS = v => log ? Math.exp(v) : v;
    const out = h('output', {}, fmtv(p[k]));
    const inp = h('input', { type: 'range', min: toS(min), max: toS(max), step: log ? 0.01 : stepv, value: toS(p[k]), 'aria-label': label });
    inp.addEventListener('input', () => { p[k] = +(+frS(+inp.value)).toFixed(4); if (k === 'pitch') p.pitch = Math.round(p.pitch); out.textContent = fmtv(p[k]); env.replaceChildren(envSvg(p)); if (k === 'pitch') renderPadsMeta(); });
    inp.addEventListener('change', () => trigger(p, audioCtx().currentTime + 0.005));
    return h('label', { class: 'ctl' }, h('span', {}, label), inp, out);
  };
  const ms = v => v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
  const why = p.m0 != null ? `Tonal call: the strongest partial sits ${Math.round(t.prom)} dB above the rest of the spectrum at about ${hz(t.f0)}, wandering ${t.spread.toFixed(1)} semitones. Tuned to ${noteName(noteAt(p.base))} in ${NOTE[key.root]} ${key.scale}, then moved ${p.pitch} st, so it plays melody notes.`
    : p.role.tonal ? 'No steady pitch found in this recording, so it plays untuned.' : `Picked as a ${p.role.name.toLowerCase()} for its ${p.f.flatness > 0.25 ? 'noisy, broadband' : 'short'} transient (spectral flatness ${p.f.flatness.toFixed(2)}, centre ${hz(p.f.centroid)}, attack ${Math.round(p.f.attack * 1000)} ms).`;
  el.replaceChildren(
    h('div', { class: 'ed-head' },
      s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
      h('div', {}, h('p', { class: 'ed-role' }, `Pad ${selPad + 1} · ${p.role.name}`), h('h3', {}, s.sp.commonName), h('p', { class: 'ed-sub' }, `${s.st?.name || ''}${s.st?.country ? ', ' + s.st.country : ''} · ${B().ago(s.t)} · SNR ${Math.round(p.ins.snr)} dB${p.tx > 1 ? ' · ultrasonic, slowed ×10' : ''}`)),
      h('div', { class: 'ed-btns' },
        h('button', { class: 'btn ghost sm', onclick: () => swapPad(selPad), title: p.role.tonal ? 'Replace with another tonal call from near the pin' : 'Replace with another percussive sound from near the pin' }, '↻ Swap'),
        h('button', { class: 'btn ghost sm', 'aria-pressed': p.rev, onclick: e => { p.rev = !p.rev; e.currentTarget.setAttribute('aria-pressed', p.rev); trigger(p, audioCtx().currentTime + 0.005); } }, '⇆ Reverse'))),
    cv,
    h('p', { class: 'hint' }, why, ' Click the waveform to move the slice start; it snaps to the nearest transient.'),
    h('div', { class: 'ed-grid' },
      h('div', {}, h('p', { class: 'lh' }, 'Envelope · ADSR'), env,
        ctl('Attack', 'A', 0.001, 0.5, 0.001, ms, true), ctl('Decay', 'D', 0.005, 2, 0.001, ms, true),
        ctl('Sustain', 'S', 0, 1, 0.01, v => Math.round(v * 100) + '%'), ctl('Release', 'R', 0.005, 2, 0.001, ms, true)),
      h('div', {}, h('p', { class: 'lh' }, 'Tone'),
        ctl(p.role.tonal ? 'Octave/st' : 'Pitch', 'pitch', -48, 24, 1, v => `${v > 0 ? '+' : ''}${Math.round(v)} st`), ctl('Gain', 'gain', 0, 1.5, 0.01, v => Math.round(v * 100) + '%'),
        ctl('Low cut', 'hp', 20, 12000, 1, hz, true), ctl('High cut', 'lp', 200, 20000, 1, hz, true),
        p.role.k === 'kick' ? ctl('Body', 'body', 0, 1, 0.01, v => Math.round(v * 100) + '%') : null)),
  );
  const span = Math.min(p.buf.length, Math.round(Math.max(1.6, p.role.max * 1.6) * sr / p.tx)), from = clamp(Math.round(p.t0 * sr - span * 0.25), 0, Math.max(0, p.buf.length - span)), to = from + span;
  const call = s.sc.startTime != null ? [s.sc.startTime * sr, (s.sc.endTime ?? s.sc.startTime + 3) * sr] : null;
  const draw = () => drawWave(cv, p.buf, { from, to, ticks: p.onsets, mark: p.t0 * sr, hl: [p.t0 * sr, p.t0 * sr + p.slice.length], call, color: COL(s.cls) });
  requestAnimationFrame(draw);
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), tt = (from + ((e.clientX - r.left) / r.width) * (to - from)) / sr;
    const near = p.onsets.reduce((m, o) => Math.abs(o.t - tt) < Math.abs((m?.t ?? 1e9) - tt) ? o : m, null);
    p.t0 = near && Math.abs(near.t - tt) < 0.08 / p.tx ? near.t : tt;
    reslice(p); draw(); renderPadsMeta(); trigger(p, audioCtx().currentTime + 0.005);
  });
}
function renderKey() {
  const r = $('kRoot');
  if (!r.options.length) { r.append(h('option', { value: 'auto' }, 'Auto'), ...NOTE.map((n, i) => h('option', { value: i }, n))); Object.keys(SCALES).forEach(s => $('kScale').append(h('option', { value: s }, s))); }
  $('kScale').value = key.scale;
  $('kKeyNow').textContent = r.value === 'auto' ? `${NOTE[key.root]}` : '';
}
function retune() { pads.forEach(p => { if (p.m0 != null) tune(p, true); }); renderKey(); renderPadsMeta(); renderEditor(); }
function renderSeq() {
  const el = $('seq'), cols = [];
  for (let j = 0; j < STEPS; j++) {
    cols.push(h('div', { class: 'col' + (j % 4 === 0 ? ' beat' : '') }, ROLES.map((r, i) => {
      const v = pattern[i][j], d = notes[i][j], tonal = r.tonal && pads[i]?.m0 != null;
      const b = h('button', { class: 'cell' + (v ? ' on' : '') + (r.tonal ? ' mel' : ''), style: `--v:${v || 0};--c:${pads[i] ? COL(pads[i].snd.cls) : 'var(--teal)'};--d:${(clamp(d, -2, 6) + 2) / 8}`, 'aria-label': `${r.name}, step ${j + 1}${v ? ', on' : ''}${tonal && v ? `, ${noteName(pads[i].m0 + semis(pads[i], d))}` : ''}`, 'aria-pressed': !!v, title: tonal && v ? `${noteName(pads[i].m0 + semis(pads[i], d))} · scroll or alt-click to change the note` : '' },
        r.tonal && v ? h('i', { class: 'deg' }) : null);
      b.addEventListener('click', e => {
        if (e.altKey && r.tonal && v) { notes[i][j] = clamp(d + (e.shiftKey ? -1 : 1), -2, 6); }
        else { pattern[i][j] = v ? 0 : (e.shiftKey ? 1 : 0.8); if (!v && r.tonal) notes[i][j] = notes[i][j] || 0; }
        renderSeq();
        if (pattern[i][j] && pads[i] && !playing) trigger(pads[i], audioCtx().currentTime + 0.005, pattern[i][j], gateFor(i), undefined, undefined, notes[i][j]);
      });
      if (r.tonal) b.addEventListener('wheel', e => { if (!pattern[i][j]) return; e.preventDefault(); notes[i][j] = clamp(notes[i][j] + (e.deltaY < 0 ? 1 : -1), -2, 6); renderSeq(); if (pads[i] && !playing) trigger(pads[i], audioCtx().currentTime + 0.005, 0.8, gateFor(i), undefined, undefined, notes[i][j]); }, { passive: false });
      return b;
    })));
  }
  el.replaceChildren(h('div', { class: 'rows' }, ROLES.map((r, i) => h('span', { title: pads[i]?.snd.sp.commonName || '', class: r.tonal ? 'mel' : '' }, r.name))), h('div', { class: 'grid' }, cols));
}

// ---------------- library ----------------
let libFilter = 'all', libQuery = '', libSort = 'snr', libSel = new Set(), libCut = 'call', libQ = 10, libRaf = 0, inspecting = 0;
// Gain that brings a whole clip to a target RMS without pushing its peak past -1 dBFS.
const lvl = (ins, target) => clamp(Math.min(10 ** ((target - ins.rmsDb) / 20), 0.9 / 10 ** (ins.peakDb / 20)), 0.3, 1000);
const QLABEL = { clean: 'Clean', ok: 'Usable', noisy: 'Noisy', silent: 'Near-silent' };
function inspectPool() {
  const g = gen, todo = pool.filter(s => !s.ins && !s.insErr && !s.insQueued);
  todo.forEach(s => { s.insQueued = true; });
  inspecting += todo.length;
  mapLimit(todo, 6, async s => {
    try { s.ins = await inspect(s); } catch { s.insErr = true; }
    inspecting--;
    if (g === gen) { cancelAnimationFrame(libRaf); libRaf = requestAnimationFrame(renderLib); }
  });
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
function audition(s, btn, row) {
  return startMon(btn, row, async done => {
    const b = await decode(s), ins = s.ins || await inspect(s);
    const from = Math.max(0, (s.sc.startTime ?? 0) - 0.4), dur = s.sc.endTime != null ? (s.sc.endTime - from + 0.6) : undefined;
    return playBuffer(b, { rate: 1 / TX(s), gain: ins.gain, from, dur, onEnd: done });
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
function renderLib() {
  if (tab !== 'lib' || !region) return;
  const list = $('libList'), items = libItems();
  const done = pool.filter(s => s.ins), counts = {}; done.forEach(s => counts[s.cls] = (counts[s.cls] || 0) + 1);
  const hidden = done.filter(s => libQ >= 0 && (s.ins.label === 'silent' || s.ins.snr < libQ)), silent = hidden.filter(s => s.ins.label === 'silent').length;
  $('libChips').replaceChildren(...['all', 'bird', 'insect', 'amphibian', 'bat', 'mammal'].filter(c => c === 'all' || counts[c]).map(c => {
    const b = h('button', { class: 'fchip' + (libFilter === c ? ' on' : ''), 'aria-pressed': libFilter === c, style: c === 'all' ? '' : `--c:${COL(c)}` }, c === 'all' ? 'All' : `${LABEL(c)}s`);
    b.addEventListener('click', () => { libFilter = c; renderLib(); });
    return b;
  }));
  $('libMsg').textContent = !pool.length ? 'Loading recordings from the mics around the pin…'
    : `${items.length} sound${items.length === 1 ? '' : 's'}${inspecting > 0 ? ` · checking ${inspecting} more for noise and silence…` : ''}${hidden.length ? ` · ${hidden.length} hidden (${silent ? `${silent} near-silent, ` : ''}${hidden.length - silent} too noisy)` : ''}. Every sound plays levelled to the same loudness.`;
  const old = new Map([...list.children].map(r => [r.dataset.id, r]));
  const rows = items.map(s => old.get(s.id) || libRow(s));
  list.replaceChildren(...rows);
  if (!items.length) list.append(h('li', { class: 'empty' }, !pool.length || inspecting > 0 ? 'Listening through the recordings…' : 'No sounds pass the quality filter here. Set Quality to Everything, or drop the pin somewhere busier.'));
  $('libMore').hidden = !poolMore;
  updateSelBtn();
}
function libRow(s) {
  const ins = s.ins;
  const playB = h('button', { class: 'ib play', title: 'Play the call', 'aria-label': `Play ${s.sp.commonName}`, 'aria-pressed': 'false' }, '▶');
  const row = h('li', { class: 'lib-row', 'data-id': s.id },
    h('input', { type: 'checkbox', 'aria-label': `Select ${s.sp.commonName}`, checked: libSel.has(s.id) || null, onchange: e => { e.target.checked ? libSel.add(s.id) : libSel.delete(s.id); updateSelBtn(); } }),
    playB,
    s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
    h('div', { class: 'lib-name' }, h('b', {}, s.sp.commonName), h('span', {}, h('i', { class: 'gdot', style: `background:${COL(s.cls)}` }), `${LABEL(s.cls)} · ${s.st?.name || ''} · ${B().ago(s.t)}${isUltra(s) ? ' · ultrasonic' : ''}`)),
    h('canvas', { class: 'lib-wave' }),
    h('span', { class: 'lib-q q-' + ins.label, title: `Signal-to-noise ${ins.snr.toFixed(1)} dB in the band where the call is strongest (around ${hz(ins.band || 0)})` }, h('b', {}, `${Math.round(ins.snr)} dB`), QLABEL[ins.label]),
    h('div', { class: 'lib-act' },
      h('button', { class: 'ib', title: `Load onto pad ${selPad + 1} of the kit`, 'aria-label': 'Add to kit', onclick: async () => { if (!pads.length) { $('libMsg').textContent = 'Build a kit first, then load sounds onto pads.'; return; } await swapPad(selPad, s); $('libMsg').textContent = `Loaded onto pad ${selPad + 1} (${pads[selPad].role.name}).`; } }, '＋'),
      h('button', { class: 'ib', title: 'Download WAV', 'aria-label': `Download ${s.sp.commonName}`, onclick: () => downloadOne(s) }, '⤓')));
  playB.addEventListener('click', () => audition(s, playB, row));
  const dur = ins.dur || s.sc.duration || 1;
  requestAnimationFrame(() => drawPeaks(row.querySelector('canvas'), ins.peaks, { color: COL(s.cls), call: s.sc.startTime != null ? [s.sc.startTime / dur, (s.sc.endTime ?? s.sc.startTime + 3) / dur] : null }));
  return row;
}

// ---------------- field recorder ----------------
let recMics = new Set(), recLen = 30, recResult = null, recBusy = false, recSort = 'bal';
const RECENT = `query($id:ID!){ station(id:$id){ detections(first:8, validSoundscape:true){ nodes{ ${FRAG} } } } }`;
function previewStation(st, btn, row) {
  return startMon(btn, row, async done => {
    const nodes = (await B().gql(RECENT, { id: st.id })).station?.detections?.nodes || [];
    const snds = [...new Map(nodes.filter(n => n.soundscape?.url).map(n => [n.soundscape.url, toSnd(n)])).values()].filter(s => !isUltra(s)).slice(0, 4);
    const res = (await mapLimit(snds, 4, async s => ({ s, ins: await inspect(s) }))).filter(r => r && r.ins.label !== 'silent').sort((a, b) => b.ins.snr - a.ins.snr);
    if (!res.length) throw new Error('nothing audible');
    const { s, ins } = res[0], b = await decode(s);
    return playBuffer(b, { gain: lvl(ins, -24), from: Math.max(0, (s.sc.startTime ?? 0) - 2), dur: 9, onEnd: done });
  }, 's:' + st.id).catch(() => { $('recMsg').textContent = `${st.name} has no audible recent audio.`; });
}
function previewHydro(hy, btn, row) {
  return startMon(btn, row, async () => {
    if (!(await B().hydroStatus(hy))) throw new Error('offline');
    audioCtx();
    const el = new Audio(); el.crossOrigin = 'anonymous';
    let hls = null;
    if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(el); } else el.src = hy.url;
    const s = ctx.createMediaElementSource(el), g = ctx.createGain(); g.gain.value = 2; s.connect(g); g.connect(master);
    await el.play();
    return { stop: () => { el.pause(); hls?.destroy(); s.disconnect(); } };
  }, 'h:' + hy.id).catch(() => { $('recMsg').textContent = `${hy.a.name} is offline right now.`; });
}
function renderRec() {
  if (!region) return;
  const el = $('recMics'), { sbiColor, kmTxt } = B();
  const st = [...region.near].sort(recSort === 'bal' ? (a, b) => (b.st.bal?.sbi ?? -1) - (a.st.bal?.sbi ?? -1) || a.km - b.km : (a, b) => a.km - b.km);
  const row = (id, name, sub, pill, kind, preview) => {
    const on = recMics.has(id);
    const pv = h('button', { class: 'ib play', title: 'Preview this mic', 'aria-label': `Preview ${name}`, 'aria-pressed': 'false' }, '▶');
    const sel = h('button', { class: 'mic-sel', 'aria-pressed': on }, h('span', { class: 'mic-ic ' + kind }), h('span', { class: 'mic-n' }, name, h('small', {}, sub)), pill);
    const r = h('div', { class: 'mic' + (on ? ' on' : '') }, pv, sel);
    if (mon?.id === id) { mon.btn = pv; mon.row = r; playBtn(pv, true); r.classList.add('playing'); }
    pv.addEventListener('click', () => preview(pv, r));
    sel.addEventListener('click', () => {
      const isH = id.startsWith('h:');
      if (recMics.has(id)) recMics.delete(id);
      else { if ([...recMics].some(x => x.startsWith('h:') !== isH)) recMics.clear(); if (isH) recMics.clear(); if (recMics.size >= 4) { $('recMsg').textContent = 'Up to 4 mics.'; return; } recMics.add(id); }
      renderRec();
    });
    return r;
  };
  el.replaceChildren(...[
    region.hydros.length ? h('p', { class: 'lh' }, 'Hydrophones · live, records in real time') : null,
    ...region.hydros.map(({ hy, km }) => row('h:' + hy.id, hy.a.name, `${kmTxt(km)} · ${hy.live === false ? 'offline' : 'Orcasound live stream'}`, h('span', { class: 'pill' + (hy.live === false ? ' off' : ' live') }, hy.live === false ? 'off' : 'live'), 'hy', (b, r) => previewHydro(hy, b, r))),
    h('p', { class: 'lh' }, `Station mics · ${st.length} nearest`),
    ...st.map(({ st: s, km }) => row('s:' + s.id, s.name, `${kmTxt(km)} away${s.m?.S ? ` · ${s.m.S} species today` : ''}`, s.bal ? h('span', { class: 'pill', style: `background:${sbiColor(s.bal.sbi)}`, title: 'Balance index' }, s.bal.sbi) : h('span', { class: 'pill off', title: 'Not enough data for a balance score' }, '–'), 'st', (b, r) => previewStation(s, b, r))),
  ].filter(Boolean));
  const n = recMics.size, hyd = [...recMics].some(x => x.startsWith('h:'));
  $('recSel').textContent = n ? `${n} mic${n > 1 ? 's' : ''} selected${hyd ? ' (live, records in real time)' : n > 1 ? ' · spread across the stereo field' : ''}` : 'Choose up to 4 mics. ▶ previews one.';
  $('recGo').disabled = !n || recBusy;
}
async function stationClips(id) {
  const d = await B().gql(`query($id:ID!){ station(id:$id){ detections(first:60, validSoundscape:true){ nodes{ ${FRAG} } } } }`, { id });
  const seen = new Set(), out = [];
  for (const n of d.station?.detections?.nodes || []) { if (!n.soundscape?.url || seen.has(n.soundscape.url)) continue; seen.add(n.soundscape.url); out.push(toSnd(n)); }
  return out;
}
async function buildBed() {
  if (recBusy) return; recBusy = true; renderRec(); stopMon();
  const msg = $('recMsg'), opt = k => $(k).value, chk = k => $(k).checked;
  const L = recLen, xf = +opt('recXf'), fade = +opt('recFade'), stereo = opt('recCh') === '2', bits = +opt('recBits'), loopIt = chk('recLoop'), hp = chk('recHp');
  try {
    const mics = [...recMics];
    let tracks;
    if (mics[0].startsWith('h:')) tracks = [await recordHydro(B().hydros.get(mics[0].slice(2)), L + (loopIt ? xf : 0) + 1.5, msg)];
    else {
      msg.textContent = `Gathering and checking audio from ${mics.length} mic${mics.length > 1 ? 's' : ''}…`;
      tracks = await Promise.all(mics.map(async m => {
        const clips = (await stationClips(m.slice(2))).filter(c => !isUltra(c));
        const need = L + (loopIt ? xf : 0), bufs = []; let tot = 0, skipped = 0;
        for (const c of clips) {
          try {
            const ins = await inspect(c);
            if (ins.label === 'silent' || ins.snr < 4) { skipped++; continue; }      // drop dead air and clips buried in noise
            const b = await decode(c); bufs.push({ b, c, g: lvl(ins, -28) }); tot += b.duration - xf;
          } catch { }
          if (tot >= need) break;
        }
        return { bufs, skipped, name: B().stations.get(m.slice(2))?.name };
      }));
    }
    msg.textContent = 'Rendering…';
    const sr = 48000, total = L + (loopIt ? xf : 0), oc = new OfflineAudioContext(stereo ? 2 : 1, Math.ceil(total * sr), sr);
    let bus = oc.destination;
    if (hp) { const f = oc.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 80; f.Q.value = 0.6; f.connect(oc.destination); bus = f; }
    const used = [];
    tracks.forEach((tr, k) => {
      const pan = !stereo ? 0 : tracks.length === 1 ? 0 : tracks.length === 2 ? (k ? 0.7 : -0.7) : -0.8 + (1.6 * k) / (tracks.length - 1);
      if (!tr.bufs.length) return;
      let t = 0, i = 0, alt = 0;
      while (t < total - 0.05) {
        const { b, c, g: lg = 1 } = tr.bufs[i % tr.bufs.length]; if (i >= tr.bufs.length) tr.repeat = true;
        const s = oc.createBufferSource(); s.buffer = b;
        const g = oc.createGain(), dur = b.duration, lv = lg / Math.sqrt(tracks.length), x = Math.min(xf, dur / 3);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv, t + x);
        g.gain.setValueAtTime(lv, t + dur - x); g.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(g);
        if (stereo) { const p = oc.createStereoPanner(); p.pan.value = clamp(pan + (tracks.length === 1 ? (alt++ % 2 ? 0.25 : -0.25) : 0), -1, 1); g.connect(p); p.connect(bus); } else g.connect(bus);
        s.start(t); if (c) used.push({ c, t, mic: tr.name });
        t += Math.max(0.5, dur - x); i++;
      }
    });
    if (!used.length && !mics[0].startsWith('h:')) throw new Error('none of the selected mics has audible recent audio');
    let out = await oc.startRendering();
    const N = Math.round(L * sr);
    if (loopIt) { const X = Math.round(xf * sr), res = new AudioBuffer({ length: N, numberOfChannels: out.numberOfChannels, sampleRate: sr });
      for (let c = 0; c < out.numberOfChannels; c++) { const s = out.getChannelData(c), d = res.getChannelData(c); for (let i = 0; i < N; i++) { d[i] = s[i]; if (i < X) { const a = i / X; d[i] = s[i] * Math.sqrt(a) + s[N + i] * Math.sqrt(1 - a); } } }
      out = res; }
    else if (fade) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c), F = Math.round(fade * sr); for (let i = 0; i < Math.min(F, d.length); i++) { d[i] *= i / F; d[d.length - 1 - i] *= i / F; } }
    normalize(out, +opt('recPeak'));
    const short = tracks.some(t => t.repeat), skipped = tracks.reduce((a, t) => a + (t.skipped || 0), 0);
    recResult = { buf: out, bits, used, short, L, mics: tracks.map(t => t.name).filter(Boolean) };
    showBed();
    msg.textContent = `Done.${skipped ? ` Skipped ${skipped} silent or very noisy clip${skipped > 1 ? 's' : ''}.` : ''}${short ? ' Some mics had less fresh audio than the length you asked for, so their clips repeat.' : ''}`;
  } catch (e) { msg.textContent = 'Could not build the recording: ' + e.message; }
  finally { recBusy = false; renderRec(); }
}
async function recordHydro(hy, secs, msg) {
  if (!hy) throw new Error('hydrophone not found');
  const live = await B().hydroStatus(hy); if (!live) throw new Error('this hydrophone is offline right now');
  audioCtx();
  const el = new Audio(); el.crossOrigin = 'anonymous';
  let hls = null;
  if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(el); } else el.src = hy.url;
  const s = ctx.createMediaElementSource(el), dest = ctx.createMediaStreamDestination(), monG = ctx.createGain(); monG.gain.value = 0.5;
  s.connect(dest); s.connect(monG); monG.connect(master);
  await el.play();
  const mr = new MediaRecorder(dest.stream), chunks = []; mr.ondataavailable = e => chunks.push(e.data);
  mr.start(500);
  const t0 = performance.now();
  await new Promise(res => { const iv = setInterval(() => { const left = secs - (performance.now() - t0) / 1000; msg.textContent = `Recording ${hy.a.name} live… ${Math.max(0, Math.ceil(left))} s left (you're hearing it)`; if (left <= 0) { clearInterval(iv); res(); } }, 250); });
  await new Promise(res => { mr.onstop = res; mr.stop(); });
  el.pause(); hls?.destroy(); s.disconnect();
  const buf = await ctx.decodeAudioData(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer());
  return { bufs: [{ b: buf, c: null }], name: hy.a.name };
}
function showBed() {
  const r = recResult, el = $('recOut');
  const cv = h('canvas', { class: 'bed-wave' });
  const play = h('button', { class: 'btn', 'data-label': 'Preview', 'aria-pressed': 'false' }, '▶ Preview');
  play.addEventListener('click', () => startMon(play, null, async done => playBuffer(r.buf, { onEnd: done })));
  const species = [...new Set(r.used.map(u => u.c.sp.commonName))];
  const name = `biophony-ambience_${slug(r.mics.join('-') || region.label)}_${r.L}s_${r.buf.numberOfChannels === 2 ? 'stereo' : 'mono'}`;
  el.replaceChildren(
    h('div', { class: 'bed' },
      cv,
      h('div', { class: 'row' }, play,
        h('button', { class: 'btn', onclick: () => save(new Blob([wav(r.buf, r.bits)], { type: 'audio/wav' }), name + '.wav') }, `⤓ WAV · ${r.buf.sampleRate / 1000} kHz / ${r.bits}-bit`),
        h('button', { class: 'btn ghost', onclick: () => save(new Blob([`${name}\n${r.L} s · ${r.buf.numberOfChannels === 2 ? 'stereo' : 'mono'} · ${r.buf.sampleRate} Hz\nMics: ${r.mics.join(', ')}\n\nClips used (offset in file → source):\n${r.used.map(u => `${u.t.toFixed(1)} s → ${credit(u.c)}`).join('\n') || 'Live Orcasound hydrophone stream (orcasound.net)'}\n\n${r.used.length ? LICENSE : 'Orcasound audio: credit Orcasound (orcasound.net); check their terms before commercial use.'}\n`], { type: 'text/plain' }), name + '_credits.txt') }, 'Credits & cue sheet')),
      h('p', { class: 'hint' }, `${r.L} s ${r.buf.numberOfChannels === 2 ? 'stereo' : 'mono'} from ${r.mics.join(', ') || 'the selected mics'}. `, species.length ? `Heard in it: ${species.slice(0, 8).join(', ')}${species.length > 8 ? ` and ${species.length - 8} more` : ''}.` : '', r.short ? ' Some clips repeat.' : '')));
  requestAnimationFrame(() => drawWave(cv, r.buf, { color: '#78d6c0' }));
}

// ---------------- shell ----------------
let tab = 'kit', kitFor = -1;
function showStudioTab(t) {
  tab = t;
  document.querySelectorAll('.st-tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.st-pane').forEach(p => { p.hidden = p.id !== 'st-' + t; });
  if (!region) return;
  if (t === 'kit' && kitFor !== gen) { kitFor = gen; buildKit(); }
  if (t === 'kit') requestAnimationFrame(() => { if (pads.length) { renderPadsMeta(); renderEditor(); } });
  if (t === 'lib') { renderLib(); if (!pool.length) loadPool().then(() => { inspectPool(); renderLib(); }).catch(() => { $('libMsg').textContent = 'Could not load sounds.'; }); else inspectPool(); }
  if (t === 'rec') renderRec();
}
window.addEventListener('biophony:pin', e => {
  togglePlay(false); stopMon();
  setRegion(e.detail);
  pads = []; candidates = []; libSel.clear(); recMics.clear(); recResult = null;
  $('recOut').replaceChildren(); $('pads').replaceChildren(); $('editor').replaceChildren(); $('libList').replaceChildren(); $('kitStatus').textContent = '';
  $('stEmpty').hidden = true; $('stBody').hidden = false;
  renderSeq();
  kitFor = -1;
  showStudioTab(tab);
});
// Before any pin: suggest places where the soundscape is rich right now.
function suggest() {
  if (region) return;
  const { stations, median, hydros } = B(), cells = new Map();
  for (const s of stations.values()) { if (!s.bal) continue; const k = Math.floor(s.lat / 3) + ',' + Math.floor(s.lon / 3); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s); }
  const spots = [...cells.values()].filter(a => a.length >= 4).map(a => ({ a, med: median(a.map(s => s.bal.sbi)) })).sort((x, y) => y.med - x.med);
  const out = [], used = new Set();
  for (const sp of spots) {
    const c = sp.a[0].country || '?'; if (used.has(c)) continue; used.add(c);
    const top = [...sp.a].sort((x, y) => y.bal.sbi - x.bal.sbi)[0];
    out.push({ lat: top.lat, lon: top.lon, label: `${top.state ? top.state + ', ' : ''}${top.country || ''}`, sub: `${sp.a.length} mics · balance ${Math.round(sp.med)}` });
    if (out.length >= 6) break;
  }
  const hy = [...hydros.values()].find(x => x.live);
  if (hy) out.push({ lat: hy.lat, lon: hy.lon, label: 'Salish Sea, underwater', sub: 'live hydrophones' });
  $('stSuggest').replaceChildren(...(out.length ? out.map(o => h('button', { class: 'suggest', onclick: () => B().dropPin(o.lat, o.lon) }, h('b', {}, o.label), h('span', {}, o.sub))) : [h('p', { class: 'hint' }, 'Gathering today\'s recordings from every station…')]));
}
window.addEventListener('biophony:data', () => { suggest(); if (region && tab === 'rec' && !recBusy) renderRec(); });
$('stSite').addEventListener('click', () => { const s = region?.near[0]?.st; if (s) B().openStation(s.id); });
document.querySelectorAll('#pinN button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#pinN button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); B().repin(+b.dataset.n); }));
document.querySelectorAll('.st-tab').forEach(b => b.addEventListener('click', () => showStudioTab(b.dataset.t)));
$('kPlay').addEventListener('click', () => togglePlay());
$('kGen').addEventListener('click', () => generate($('kStyle').value));
$('kStyle').addEventListener('change', () => generate($('kStyle').value));
$('kMut').addEventListener('click', mutate);
$('kClear').addEventListener('click', () => { pattern = ROLES.map(() => Array(STEPS).fill(0)); notes = ROLES.map(() => Array(STEPS).fill(0)); renderSeq(); });
$('kNew').addEventListener('click', () => { pool = []; poolCursor = null; buildKit(); });
$('kRoot').addEventListener('change', e => { if (e.target.value === 'auto') autoKey(pads.filter(p => p.m0 != null)); else key.root = +e.target.value; retune(); });
$('kScale').addEventListener('change', e => { key.scale = e.target.value; if ($('kRoot').value === 'auto') autoKey(pads.filter(p => p.m0 != null)); retune(); });
$('kBpm').addEventListener('input', e => { bpm = +e.target.value; $('kBpmV').textContent = bpm; });
$('kSwing').addEventListener('input', e => { swing = +e.target.value / 100; $('kSwingV').textContent = e.target.value + '%'; });
$('kKit').addEventListener('click', () => exportKit().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kLoop').addEventListener('click', () => exportLoop().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kMidi').addEventListener('click', () => save(midi(pattern, bpm), `biophony-pattern_${bpm}bpm.mid`));
$('libSearch').addEventListener('input', e => { libQuery = e.target.value.trim().toLowerCase(); renderLib(); });
$('libSort').addEventListener('change', e => { libSort = e.target.value; renderLib(); });
$('libQ').addEventListener('change', e => { libQ = +e.target.value; renderLib(); });
$('libCut').addEventListener('change', e => { libCut = e.target.value; });
$('libZip').addEventListener('click', () => downloadSel());
$('libMore').addEventListener('click', async () => { $('libMore').disabled = true; await loadPool(true).catch(() => {}); $('libMore').disabled = false; inspectPool(); renderLib(); });
$('recSort').addEventListener('change', e => { recSort = e.target.value; renderRec(); });
document.querySelectorAll('#recLens button').forEach(b => b.addEventListener('click', () => { recLen = +b.dataset.s; document.querySelectorAll('#recLens button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); }));
$('recGo').addEventListener('click', buildBed);
document.addEventListener('keydown', e => {
  if (!region || !$('info').hidden || e.metaKey || e.ctrlKey) return;
  if (e.target.closest('input, select, textarea, [contenteditable]') && e.target.type !== 'range') return;
  if (tab !== 'kit') return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); return; }
  const i = ROLES.findIndex(r => r.key === e.key);
  if (i >= 0 && pads[i]) trigger(pads[i], audioCtx().currentTime + 0.003);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (playing) togglePlay(false); stopMon(); } });
renderKey(); renderSeq(); suggest();
