// Keys, scales and tuning for the tonal pads.

export const SCALES = { 'minor pentatonic': [0, 3, 5, 7, 10], 'major pentatonic': [0, 2, 4, 7, 9], 'natural minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10], 'major': [0, 2, 4, 5, 7, 9, 11] };
export let key = { root: 9, scale: 'minor pentatonic' };
export const S = () => SCALES[key.scale];
export const noteAt = i => { const s = S(), n = s.length; return key.root + 12 * Math.floor(i / n) + s[((i % n) + n) % n]; };
function nearestIdx(m) { const n = S().length, i0 = (Math.floor((m - key.root) / 12) - 1) * n; let best = i0, bd = 1e9; for (let i = i0; i < i0 + 3 * n; i++) { const d = Math.abs(noteAt(i) - m); if (d < bd) { bd = d; best = i; } } return best; }
const pcDist = (a, b) => { const d = Math.abs(((a - b) % 12 + 12) % 12); return Math.min(d, 12 - d); };
// Pick the key that needs the least retuning across the tonal pads (most tonal pad wins ties).
export function autoKey(tonalPads) {
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
export function tune(p, keepOct) {
  p.base = nearestIdx(p.m0);
  if (keepOct) return;
  const e0 = noteAt(p.base) - p.m0, f0 = p.ins.tonal.f0;
  if (p.role.k === 'low') { let k = -3; while (k < 0 && f0 * 2 ** ((e0 + 12 * k) / 12) < 55) k++; p.pitch = 12 * k; }   // as low as it goes, but not below ~55 Hz
  else if (p.role.k === 'lead') p.pitch = f0 > 4000 ? -24 : f0 > 1500 ? -12 : 0;
  else p.pitch = f0 > 8000 ? -24 : f0 > 4000 ? -12 : 0;
}
export const semis = (p, deg = 0) => p.role.tonal && p.m0 != null ? noteAt(p.base + deg) - p.m0 + p.pitch : p.pitch;
export const kickHz = () => { let m = 24 + key.root; if (m < 29) m += 12; return 440 * 2 ** ((m - 69) / 12); };
