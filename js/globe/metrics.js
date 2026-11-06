// Diversity metrics and the Soundscape Balance Index.
import { HI, LO, MID } from './map.js';
import { stations } from './stations.js';

// Detection counts per species over 24 h are the abundance proxy (calls, not individuals).
const GROUPS = ['bird', 'bat', 'insect', 'amphibian', 'mammal'];
export const MIN_N = 30, MIN_S = 3;
export function diversity(list) {               // list: [{n, c}]
  let N = 0; for (const x of list) N += x.n;
  const S = list.length; let H = 0, D = 0, f1 = 0, f2 = 0, mask = 0;
  for (const x of list) {
    const p = x.n / N; if (p > 0) { H -= p * Math.log(p); D += p * p; }
    if (x.n === 1) f1++; else if (x.n === 2) f2++;
    mask |= 1 << Math.max(0, GROUPS.indexOf(x.c));
  }
  return { N, S, H, D, f1, f2, mask };
}
export const hill1 = m => Math.exp(m.H);                          // Hill 1973, q = 1
export const hill2 = m => m.D ? 1 / m.D : 0;                      // inverse Simpson, q = 2
export const pielou = m => m.S > 1 ? m.H / Math.log(m.S) : 0;     // Pielou 1966
export const coverage = m => !m.f1 ? 1 : 1 - (m.f1 / m.N) * (((m.N - 1) * m.f1) / ((m.N - 1) * m.f1 + 2 * m.f2));   // Chao & Jost 2012
export const chao1 = m => !m.N ? 0 : m.S + ((m.N - 1) / m.N) * (m.f1 * (m.f1 - 1)) / (2 * (m.f2 + 1));                        // bias-corrected Chao1
export const nGroups = m => { let k = 0, x = m.mask; while (x) { k += x & 1; x >>= 1; } return k; };
const eligible = m => m && m.N >= MIN_N && m.S >= MIN_S;

let bands = new Map();
export function buildBands() {
  bands = new Map();
  for (const s of stations.values()) if (eligible(s.m)) {
    const b = Math.floor(s.lat / 10);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push(hill1(s.m));
  }
  for (const a of bands.values()) a.sort((x, y) => x - y);
}
const lowerB = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; a[m] < v ? lo = m + 1 : hi = m; } return lo; };
const upperB = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; a[m] <= v ? lo = m + 1 : hi = m; } return lo; };
function latPercentile(lat, v) {
  const b0 = Math.floor(lat / 10);
  for (let k = 0; k <= 4; k++) {
    let tot = 0, below = 0;
    for (let b = b0 - k; b <= b0 + k; b++) { const a = bands.get(b); if (!a) continue; tot += a.length; below += (lowerB(a, v) + upperB(a, v)) / 2; }
    if (tot >= 25 || k === 4) return { p: tot ? below / tot : 0.5, n: tot, span: (2 * k + 1) * 10 };
  }
}
export function balance(lat, m) {
  if (!eligible(m)) return null;
  const P = latPercentile(lat, hill1(m)), E = pielou(m), B = Math.min(1, (nGroups(m) - 1) / 2);
  return { sbi: Math.round(100 * (0.5 * P.p + 0.35 * E + 0.15 * B)), D: P.p, E, B, ref: P };
}
export const SBI_WORD = v => v >= 65 ? 'Rich' : v >= 50 ? 'Balanced' : v >= 35 ? 'Thin' : 'Low';
export function sbiColor(v) {
  const t = Math.max(0, Math.min(100, v)) / 100, [a, b, u] = t < 0.5 ? [LO, MID, t * 2] : [MID, HI, (t - 0.5) * 2];
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * u)).join(',')})`;
}
export const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
