// The 16-step sequencer, its styles and pattern generation.
import { $ } from '../core/util.js';
import { pauseMain } from '../player.js';
import { audioCtx, ctx, playBtn, stopMon } from './audio.js';
import { renderSeq } from './kit-view.js';
import { audible, pads, trigger } from './kit.js';
import { ROLES } from './roles.js';
import { clamp, pick, rnd } from './util.js';

export const STEPS = 16;
export let mutes = ROLES.map(() => false), solos = ROLES.map(() => false), bar = 0;
export let pattern = ROLES.map(() => Array(STEPS).fill(0)), notes = ROLES.map(() => Array(STEPS).fill(0)), bpm = 96, swing = 0.12, playing = false, step = 0, nextT = 0, schedTimer = null;
// rows: kick, snare, closed hat, open hat, perc, low tom, lead, crash (crash only sounds on bar 1 of every 4) (digits = chance out of 9)
const STYLES = {
  'House': { bpm: 122, p: ['9000900090009000', '0000900000009000', '5555555555555555', '0090009000900090', '0002000300020004', '9000000700900000', '0060030000600300', '9000000000000000'] },
  'Boom bap': { bpm: 90, p: ['9000000690300000', '0000900000009000', '7070707070707070', '0000000000000005', '0010000100100001', '9000000090000000', '0000005000050000', '9000000000000000'] },
  'Breakbeat': { bpm: 132, p: ['9000000009300000', '0000900200009002', '8585858585858585', '0000000300000003', '0300003000300300', '9000000009000000', '0005000000050300', '9000000000000000'] },
  'Techno': { bpm: 130, p: ['9000900090009000', '0003000000300000', '0090009000900090', '0000000000000000', '3030303030303030', '0090009000900090', '0000040000000400', '9000000000000000'] },
  'Dembow': { bpm: 100, p: ['9000900090009000', '0009009000090090', '6060606060606060', '0000000000000000', '0000300000003000', '9000000090000000', '0000000600000060', '9000000000000000'] },
  'Dawn chorus': { bpm: 84, euclid: [3, 2, 7, 2, 5, 3, 5, 1] },
};
function euclid(k, n) { const out = []; let b = -1; for (let i = 0; i < n; i++) { const v = Math.floor((i * k) / n); out.push(v !== b ? 1 : 0); b = v; } return out; }
function melody(i) {
  const k = ROLES[i].k; let d = 0;
  return pattern[i].map((v, j) => {
    if (!v) return 0;
    if (k === 'low') return pick([0, 0, 0, 0, -2, 3]);
    d = clamp(d + pick([-2, -1, -1, 0, 1, 1, 2]), -2, 6);
    return j >= 12 && !pattern[i].slice(j + 1).some(Boolean) ? pick([0, 2]) : d;
  });
}
export function generate(style) {
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
export function mutate() {
  for (let n = 0; n < 4; n++) { const r = 1 + Math.floor(Math.random() * 6), j = Math.floor(Math.random() * STEPS); pattern[r][j] = pattern[r][j] ? 0 : +rnd(0.5, 0.9).toFixed(2); if (ROLES[r].tonal && pattern[r][j]) notes[r][j] = pick([0, 1, 2, 3, -1]); }
  for (let n = 0; n < 2; n++) { const j = Math.floor(Math.random() * STEPS); if (pattern[6][j]) notes[6][j] = clamp(notes[6][j] + pick([-1, 1, 2, -2]), -2, 6); }
  renderSeq();
}
export const stepDur = () => 60 / bpm / 4;
export const setTempo = v => { bpm = v; }, setSwing = v => { swing = v; };
export function clearPattern() { pattern = ROLES.map(() => Array(STEPS).fill(0)); notes = ROLES.map(() => Array(STEPS).fill(0)); }
export const gateFor = i => ROLES[i].k === 'ohat' ? stepDur() * 1.6 : ROLES[i].steps ? stepDur() * ROLES[i].steps : undefined;
export function scheduleStep(j, t, b = bar, c, dest) { pattern.forEach((row, i) => { if (row[j] && pads[i] && audible(i) && !(ROLES[i].bar4 && b % 4)) trigger(pads[i], t, row[j], gateFor(i), c, dest, notes[i][j]); }); }
function schedTick() {
  while (nextT < ctx.currentTime + 0.12) {
    const t = nextT + (step % 2 ? swing * stepDur() : 0);
    scheduleStep(step, t);
    const j = step; setTimeout(() => { if (playing) document.querySelectorAll('.seq .col').forEach((c, k) => c.classList.toggle('now', k === j)); }, Math.max(0, (t - ctx.currentTime) * 1000));
    step = (step + 1) % STEPS; if (!step) bar++; nextT += stepDur();
  }
}
export function togglePlay(on = !playing) {
  if (on && !pads.length) return;
  if (on) { stopMon(); pauseMain(); }
  playing = on;
  playBtn($('kPlay'), on);
  clearInterval(schedTimer);
  document.querySelectorAll('.seq .col').forEach(c => c.classList.remove('now'));
  if (on) { audioCtx(); step = 0; bar = 0; nextT = ctx.currentTime + 0.06; schedTimer = setInterval(schedTick, 25); schedTick(); }
}
