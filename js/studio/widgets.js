// Waveforms, knobs, the envelope editor and the output meter.
import { $, h } from '../core/util.js';
import { mono } from './analysis.js';
import { audioCtx, meterNode } from './audio.js';
import { trigger } from './kit.js';
import { clamp, db } from './util.js';

function sizeCv(cv) { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * dpr | 0); cv.height = Math.max(1, r.height * dpr | 0); return dpr; }
export function drawWave(cv, buf, opts = {}) {
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
export function drawPeaks(cv, peaks, opts = {}) {
  sizeCv(cv);
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, P = peaks.length / 2;
  g.clearRect(0, 0, W, H);
  if (opts.call) { g.fillStyle = 'rgba(227,183,101,.13)'; g.fillRect(opts.call[0] * W, 0, (opts.call[1] - opts.call[0]) * W, H); }
  let pk = 1e-6; for (const v of peaks) pk = Math.max(pk, Math.abs(v));
  const gain = Math.min(3000, 0.95 / pk);
  g.fillStyle = opts.color || '#78d6c0';
  for (let px = 0; px < W; px++) { const i = Math.min(P - 1, Math.floor(px / W * P)), mn = peaks[2 * i], mx = peaks[2 * i + 1]; g.fillRect(px, H / 2 - mx * gain * H * 0.48, 1, Math.max(1, (mx - mn) * gain * H * 0.48)); }
}

// ---------------- widgets: knobs, envelope, meter ----------------
export const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const arc = (cx, cy, r, a0, a1) => { const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`; };
// Drag up/down (shift for fine) or arrow keys; double-click resets. No scroll-wheel, so scrolling the page never changes anything.
export function knob({ label, min, max, value, def = value, log, step, fmt, onInput, onChange, size = '' }) {
  const L0 = log ? Math.log(min) : min, L1 = log ? Math.log(max) : max;
  const toN = v => ((log ? Math.log(v) : v) - L0) / (L1 - L0);
  const frN = n => { let v = L0 + n * (L1 - L0); if (log) v = Math.exp(v); return step ? Math.round(v / step) * step : v; };
  let n = clamp(toN(value), 0, 1);
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
  const svg = svgEl('svg', { viewBox: '0 0 40 40', 'aria-hidden': 'true' });
  const track = svgEl('path', { class: 'k-track', d: arc(20, 20, 15, A0, A1) }), val = svgEl('path', { class: 'k-val' }), dot = svgEl('line', { class: 'k-dot' });
  svg.append(track, val, dot);
  const out = h('output', {}), el = h('div', { class: 'knob ' + size, tabindex: 0, role: 'slider', 'aria-label': label, title: `${label} · drag up/down or use arrow keys · double-click to reset` }, svg, h('span', { class: 'k-l' }, label), out);
  const draw = () => {
    const a = A0 + n * (A1 - A0);
    val.setAttribute('d', n > 0.002 ? arc(20, 20, 15, A0, a) : '');
    dot.setAttribute('x1', 20 + 6 * Math.cos(a)); dot.setAttribute('y1', 20 + 6 * Math.sin(a)); dot.setAttribute('x2', 20 + 12 * Math.cos(a)); dot.setAttribute('y2', 20 + 12 * Math.sin(a));
    const v = frN(n); out.textContent = fmt(v); el.setAttribute('aria-valuetext', fmt(v)); el.setAttribute('aria-valuenow', +v.toFixed(4));
  };
  const set = (nn, commit) => { n = clamp(nn, 0, 1); draw(); onInput?.(frN(n)); if (commit) onChange?.(frN(n)); };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.focus(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    let y0 = e.clientY, n0 = n;
    const mv = ev => { set(n0 + (y0 - ev.clientY) / (ev.shiftKey ? 700 : 170)); };
    const up = () => { el.removeEventListener('pointermove', mv); el.classList.remove('drag'); onChange?.(frN(n)); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', up, { once: true });
  });
  el.addEventListener('dblclick', () => set(toN(def), true));
  el.addEventListener('keydown', e => { const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key]; if (d) { e.preventDefault(); e.stopPropagation(); set(n + d, true); } });
  el.update = v => { n = clamp(toN(v), 0, 1); draw(); };
  draw();
  return el;
}
// ADSR you can grab: attack peak, decay/sustain corner and release end.
export function envEditor(p, onEdit) {
  const W = 260, H = 84, T = 7, Bt = H - 7, xa = W * 0.22, xd = W * 0.28, xr0 = W * 0.72;
  const nl = (v, a, b) => (Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a)), dl = (n, a, b) => Math.exp(Math.log(a) + clamp(n, 0, 1) * (Math.log(b) - Math.log(a)));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'env', role: 'img', 'aria-label': 'Envelope: drag the handles' });
  const grid = svgEl('path', { class: 'env-grid', d: `M${xa},0 V${H} M${xa + xd},0 V${H} M${xr0},0 V${H}` });
  const fill = svgEl('path', { class: 'env-fill' }), line = svgEl('path', { class: 'env-line' });
  const hs = ['A', 'D', 'R'].map(k => { const c = svgEl('circle', { r: 5.5, class: 'env-h', 'data-k': k }); const t = svgEl('title'); t.textContent = { A: 'Attack', D: 'Decay and sustain', R: 'Release' }[k]; c.append(t); return c; });
  svg.append(grid, fill, line, ...hs);
  const pts = () => { const x1 = xa * nl(p.A, 0.001, 0.5), x2 = xa + xd * nl(p.D, 0.005, 2), y = Bt - p.S * (Bt - T), x3 = xr0 + (W - 6 - xr0) * nl(p.R, 0.005, 2); return { x1, x2, y, x3 }; };
  const draw = () => { const { x1, x2, y, x3 } = pts(); const d = `M2,${Bt} L${x1 + 2},${T} L${x2},${y} L${xr0},${y} L${x3},${Bt}`; line.setAttribute('d', d); fill.setAttribute('d', d + ' Z'); [[x1 + 2, T], [x2, y], [x3, Bt]].forEach(([x, yy], i) => { hs[i].setAttribute('cx', x); hs[i].setAttribute('cy', yy); }); };
  svg.addEventListener('pointerdown', e => {
    const r = svg.getBoundingClientRect(), sx = W / r.width, sy = H / r.height, X = (e.clientX - r.left) * sx, Y = (e.clientY - r.top) * sy, { x1, x2, y, x3 } = pts();
    const k = [['A', x1, T], ['D', x2, y], ['R', x3, Bt]].sort((a, b) => Math.hypot(a[1] - X, a[2] - Y) - Math.hypot(b[1] - X, b[2] - Y))[0][0];
    svg.setPointerCapture(e.pointerId); svg.classList.add('drag');
    const mv = ev => {
      const X = (ev.clientX - r.left) * sx, Y = (ev.clientY - r.top) * sy;
      if (k === 'A') p.A = +dl(X / xa, 0.001, 0.5).toFixed(4);
      if (k === 'D') { p.D = +dl((X - xa) / xd, 0.005, 2).toFixed(4); p.S = +clamp((Bt - Y) / (Bt - T), 0, 1).toFixed(3); }
      if (k === 'R') p.R = +dl((X - xr0) / (W - 6 - xr0), 0.005, 2).toFixed(4);
      draw(); onEdit?.();
    };
    mv(e);
    svg.addEventListener('pointermove', mv);
    svg.addEventListener('pointerup', () => { svg.removeEventListener('pointermove', mv); svg.classList.remove('drag'); trigger(p, audioCtx().currentTime + 0.005); }, { once: true });
  });
  draw();
  svg.update = draw;
  return svg;
}
// Master output meter (peak with hold).
let meterRaf = 0, hold = 0, holdT = 0;
export function meterLoop() {
  cancelAnimationFrame(meterRaf);
  const cv = $('meter'); if (!cv || !meterNode) return;
  const buf = new Float32Array(meterNode.fftSize);
  const tick = () => {
    if (document.hidden) return;
    meterNode.getFloatTimeDomainData(buf);
    let pk = 0, ss = 0; for (const v of buf) { pk = Math.max(pk, Math.abs(v)); ss += v * v; }
    const toX = d => clamp((d + 48) / 48, 0, 1), dP = db(pk), dR = db(Math.sqrt(ss / buf.length)), now = performance.now();
    if (dP > hold || now - holdT > 1200) { hold = dP; holdT = now; }
    const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2, g = cv.getContext('2d');
    g.fillStyle = '#0a1415'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#2aa98b'); gr.addColorStop(0.75, '#78d6c0'); gr.addColorStop(0.9, '#e3b765'); gr.addColorStop(1, '#d4683f');
    g.fillStyle = gr; g.globalAlpha = 0.45; g.fillRect(0, 0, toX(dP) * W, H); g.globalAlpha = 1; g.fillRect(0, H * 0.25, toX(dR) * W, H * 0.5);
    g.fillStyle = '#e9efe9'; g.fillRect(toX(hold) * W - 2, 0, 3, H);
    $('meterV').textContent = hold > -60 ? `${hold.toFixed(1)} dB` : '–∞';
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}
