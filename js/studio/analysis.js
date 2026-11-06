// Per-recording analysis: SNR quality check, tonality, onsets, slicing, features.
import { fft } from '../core/dsp.js';
import { TX, decode } from './data.js';
import { clamp, db, q } from './util.js';

export const mono = buf => buf.getChannelData(0);
const hannCache = new Map();
const hann = N => { if (!hannCache.has(N)) hannCache.set(N, new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))); return hannCache.get(N); };

// Quality check for every recording (cached per detection):
//  - SNR: in the frequency band where the call stands out most, loud frames inside the
//    detection window (90th percentile) against quiet frames outside it (20th percentile).
//  - level: peak and RMS, so near-silent clips can be dropped and the rest levelled.
//  - tonality: how far the strongest spectral peak rises above the spectrum, its median
//    frequency (f0) and how much it wanders, which tells a whistle from a buzz or a click.
const inspected = new Map();
export function inspect(snd) {
  if (!inspected.has(snd.id)) inspected.set(snd.id, decode(snd).then(buf => ({ ...inspectBuf(buf, snd), dur: buf.duration })).catch(e => { inspected.delete(snd.id); throw e; }));
  return inspected.get(snd.id);
}
function inspectBuf(buf, snd) {
  const x = mono(buf), sr = buf.sampleRate, tx = TX(snd);
  const N = 2 ** Math.round(Math.log2(sr * 0.021)), hop = N, K = N >> 1, bw = sr / N, win = hann(N);   // no overlap: half the FFTs, same SNR estimate
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
  const bandE = new Float64Array(QB); for (let f = 0; f < nF; f++) for (let k = 0; k < QB; k++) bandE[k] += E[f * QB + k];
  let bt = 0; for (const v of bandE) bt += v; let ent = 0; if (bt > 0) for (const v of bandE) { const pp = v / bt; if (pp > 0) ent -= pp * Math.log(pp); }
  const eq = ent / Math.log(QB);   // Shannon evenness of energy across log-spaced bands: 1 = pink-balanced, 0 = one band dominates
  return { ...base, snr, label, gain, callRmsDb, eq, band: Math.sqrt(edges[bestB] * edges[bestB + 3 > QB ? QB : bestB + 3]) * bw / tx, tonal };
}

function stft(x, N) {
  const hop = N >> 2, win = hann(N), frames = [], re = new Float64Array(N), im = new Float64Array(N);
  for (let o = 0; o + N <= x.length; o += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(N >> 1); for (let k = 0; k < m.length; k++) m[k] = Math.hypot(re[k], im[k]);
    frames.push(m);
  }
  return { frames, hop };
}
// Spectral-flux onset detection with an adaptive (moving median) threshold.
export function onsets(buf) {
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
export function makeSlice(buf, t0, maxLen) {
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
export function features(slice, tx) {
  const x = mono(slice), sr = slice.sampleRate, N = Math.max(64, Math.min(2 ** Math.round(Math.log2(sr * 0.02)), 2 ** Math.floor(Math.log2(x.length))));
  const { frames } = stft(x, N), K = frames[0]?.length || 1, avg = new Float64Array(K);
  frames.forEach(f => { for (let k = 0; k < K; k++) avg[k] += f[k]; });
  let num = 0, den = 0, lg = 0, ar = 0, low = 0;
  for (let k = 1; k < K; k++) { const p = avg[k] + 1e-12, f = (k * sr) / (2 * K) / tx; num += f * p; den += p; lg += Math.log(p); ar += p; if (f < 500) low += p; }
  let rms = 0, pk = 0, pkAt = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); rms += v * v; if (v > pk) { pk = v; pkAt = i; } }
  let dec = x.length; for (let i = pkAt; i < x.length; i += 64) if (Math.abs(x[i]) < pk * 0.1) { let quiet = true; for (let j = i; j < Math.min(x.length, i + 256); j++) if (Math.abs(x[j]) > pk * 0.1) { quiet = false; break; } if (quiet) { dec = i; break; } }
  return { centroid: num / den, flatness: Math.exp(lg / (K - 1)) / (ar / (K - 1)), low: low / den, dur: x.length / sr * tx, rms: Math.sqrt(rms / x.length), attack: pkAt / sr * tx, decay: (dec - pkAt) / sr * tx };
}
export function bestOnset(snd, list) {
  const a = (snd.sc.startTime ?? 0) - 0.3, b = (snd.sc.endTime ?? 1e9) + 0.3;
  const inWin = list.filter(o => o.t >= a && o.t <= b);
  return (inWin.length ? inWin : list).reduce((m, o) => o.s > (m?.s ?? -1) ? o : m, null)?.t ?? Math.max(0, snd.sc.startTime || 0);
}
