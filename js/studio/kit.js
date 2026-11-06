// The 8-pad kit: choosing sounds for roles, levelling, and playing a pad.
import { $, kmTxt } from '../core/util.js';
import { expandPin } from '../globe/pin.js';
import { bestOnset, features, inspect, makeSlice, mono, onsets } from './analysis.js';
import { audioCtx, ctx, master } from './audio.js';
import { TX, decode, gen, loadPool, mapLimit, markWidened, pool, poolMore, region, widenDone } from './data.js';
import { tab } from './index.js';
import { renderEditor, renderKey, renderPads } from './kit-view.js';
import { autoKey, key, kickHz, semis, tune } from './music.js';
import { generate, mutes, pattern, solos, togglePlay } from './sequencer.js';
import { NOTE, clamp, pick } from './util.js';
import { ROLES } from './roles.js';

export let pads = [], selPad = 0, candidates = [], kitBusy = false, widen = false, kitFor = -1;
export const selectPad = i => { selPad = i; };
export function resetKit() { pads = []; candidates = []; kitFor = -1; }
// Build the kit once per pin, the first time the Kit tab is shown.
export function ensureKit() { if (kitFor !== gen) { kitFor = gen; buildKit(); } }

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
      : role.k === 'chat' || role.k === 'ohat' ? clamp(12 * Math.log2(8000 / cen), -7, 12) : role.k === 'crash' ? clamp(12 * Math.log2(6000 / cen), -12, 7) : clamp(12 * Math.log2(1800 / cen), -24, 12));
  }
  reslice(p);
  return p;
}
export function reslice(p) {
  p.slice = makeSlice(p.buf, p.t0, p.role.max / p.tx); p.rslice = null;
  const x = mono(p.slice), n = Math.min(x.length, Math.round(0.15 * p.slice.sampleRate));
  let pk = 0, ss = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i])); for (let i = 0; i < n; i++) ss += x[i] * x[i];
  const rms = Math.sqrt(ss / Math.max(1, n));
  p.ng = clamp(Math.min(10 ** (p.role.lvl / 20) / Math.max(1e-7, rms), 0.95 / Math.max(1e-7, pk)), 0.2, 1000);
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
  by.crash = take(c => c.f.flatness * 40 + c.f.centroid / 1500 + Math.min(1, c.f.dur) * 5 - Math.max(0, c.ins.tonal.prom - 18) * 0.3);
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
export async function buildKit() {
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
    const nSp = new Set(good.map(c => c.snd.sp.id)).size;
    if (nSp < 6 && widenDone !== gen) { widen = true; st.textContent = `Only ${nSp} clean species within ${kmTxt(region.radius)}. Widening the circle…`; return; }
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
  finally { kitBusy = false; if (widen && g === gen) { widen = false; if (!expandPin()) { markWidened(); if (tab === 'kit') { kitFor = gen; buildKit(); } else kitFor = -1; } } widen = false; }
}
export async function swapPad(i, snd) {
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
const verbs = new WeakMap();
function verb(c) {      // a short, dark plate made from decaying noise, one per audio context
  if (!verbs.has(c)) {
    const len = Math.round(2.4 * c.sampleRate), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.exp(-3.2 * i / len) * 2; } }
    const cv = c.createConvolver(); cv.buffer = ir;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    cv.connect(hp);
    verbs.set(c, { input: cv, out: hp, dests: new Set() });
  }
  return verbs.get(c);
}
export const audible = i => !mutes[i] && (!solos.some(Boolean) || solos[i]);
export function trigger(p, when, vel = 1, gate, c = audioCtx(), dest = master, deg = 0) {
  if (!p?.slice) return;
  if (p.role.k === 'chat' && voices.get('ohat') && c === ctx) { const v = voices.get('ohat'); try { v.g.gain.cancelScheduledValues(when); v.g.gain.setTargetAtTime(0, when, 0.01); } catch { } }
  const rate = (1 / p.tx) * 2 ** (semis(p, deg) / 12);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hp;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.lp;
  const g = c.createGain(), pk = vel * p.gain * p.ng, A = Math.max(0.001, p.A), D = Math.max(0.005, p.D);
  const gt = gate ?? p.role.gate ?? 0.12, tOff = when + Math.max(gt, A + D);
  if (p.S > 0) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(pk, when + A); g.gain.linearRampToValueAtTime(pk * p.S, when + A + D); g.gain.setValueAtTime(pk * p.S, tOff); g.gain.linearRampToValueAtTime(0, tOff + Math.max(0.005, p.R)); }
  else { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(pk, when + A); g.gain.setTargetAtTime(0, when + A, D / 4); }   // percussive: smooth exponential decay
  const end = p.S > 0 ? tOff + p.R + 0.05 : when + A + D * 1.6 + 0.05;
  const srcs = [[1, 0, 1]];
  if (p.role.k === 'crash') srcs.push([1.013, 0.011, 0.7], [0.987, 0.019, 0.6]);   // detuned copies smear the transient into a wash
  for (const [r, dl, lv] of srcs) {
    const s = c.createBufferSource(); s.buffer = p.rev ? reversed(p) : p.slice; s.playbackRate.value = rate * r;
    if (lv === 1) s.connect(hp); else { const sg = c.createGain(); sg.gain.value = lv; s.connect(sg); sg.connect(hp); }
    s.start(when + dl); s.stop(end + dl);
  }
  hp.connect(lp); lp.connect(g); g.connect(dest);
  if (p.role.verb) { const v = verb(c); if (!v.dests.has(dest)) { v.out.connect(dest); v.dests.add(dest); } const send = c.createGain(); send.gain.value = p.role.verb; g.connect(send); send.connect(v.input); }
  // Kick body: a short tuned sine drop under the field-recorded transient, so the kick has weight.
  if (p.role.k === 'kick' && p.body > 0) {
    const o = c.createOscillator(), og = c.createGain(), f = kickHz();
    o.frequency.setValueAtTime(f * 3.2, when); o.frequency.exponentialRampToValueAtTime(f, when + 0.045);
    const dur = Math.max(0.12, p.D * 1.3);
    og.gain.setValueAtTime(0, when); og.gain.linearRampToValueAtTime(vel * p.body * p.gain * 0.55, when + 0.003); og.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(og); og.connect(dest); o.start(when); o.stop(when + dur + 0.02);
  }
  if (c === ctx) { voices.set(p.role.k, { g }); flashPad(p, when); }
}
function flashPad(p, when) {
  const i = pads.indexOf(p), el = document.querySelector(`.pad[data-i="${i}"]`); if (!el) return;
  setTimeout(() => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }, Math.max(0, (when - ctx.currentTime) * 1000));
}
