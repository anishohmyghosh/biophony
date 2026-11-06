// Studio helpers: maths, labels and note names.
import { CLS, COLORS } from '../core/util.js';

export const COL = c => COLORS[c] || COLORS.bird;
export const LABEL = c => CLS[c] || 'Sound';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const q = (arr, p) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
export const db = v => 20 * Math.log10(Math.max(1e-9, v));
export const hz = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' kHz' : Math.round(v) + ' Hz';
export const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = m => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
