// Studio audio context, mix bus, and the single preview voice behind every ▶ button.
import { pauseMain } from '../player.js';
import { meterLoop } from './widgets.js';

export let ctx, master, meterNode;
// Mix bus: a gentle high-shelf to take the edge off, a slow glue compressor, then a limiter.
export function bus(c, dest) {
  const inp = c.createGain(); inp.gain.value = 0.8;
  const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 7500; shelf.gain.value = -3;
  const glue = c.createDynamicsCompressor(); glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.18;
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  inp.connect(shelf); shelf.connect(glue); glue.connect(lim); lim.connect(dest);
  inp.out = lim;
  return inp;
}
export function audioCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    master = bus(ctx, ctx.destination);
    meterNode = ctx.createAnalyser(); meterNode.fftSize = 1024; master.out.connect(meterNode);
    requestAnimationFrame(meterLoop);
  }
  ctx.resume();
  return ctx;
}
// Every ▶ button in the studio goes through here, so its icon always matches what is playing.
export function playBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle('playing', on); btn.setAttribute('aria-pressed', on);
  const l = btn.dataset.label;
  btn.textContent = l ? `${on ? '■' : '▶'} ${on ? (btn.dataset.stop || 'Stop') : l}` : on ? '■' : '▶';
}
export let mon = null;      // the one preview playing right now
export function stopMon() { if (!mon) return; const m = mon; mon = null; try { m.stop(); } catch { } playBtn(m.btn, false); m.row?.classList.remove('playing'); }
export async function startMon(btn, row, starter, id) {
  if (mon && (mon.btn === btn || (id && mon.id === id))) { stopMon(); return; }
  stopMon(); pauseMain();
  const m = { btn, row, id, stop: () => {} }; mon = m;
  playBtn(btn, true); row?.classList.add('playing');
  try { const s = await starter(() => { if (mon === m) stopMon(); }); if (mon !== m) { s.stop(); return; } m.stop = s.stop; }
  catch (e) { if (mon === m) stopMon(); throw e; }
}
export function playBuffer(buf, { rate = 1, gain = 1, from = 0, dur, onEnd } = {}) {
  audioCtx();
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
  s.connect(g); g.connect(master); s.start(0, Math.max(0, from), dur);
  s.onended = () => onEnd?.();
  return { stop: () => { s.onended = null; try { s.stop(); } catch { } } };
}
// Safari: create/resume the studio's audio inside the first click, before any fetch can break the gesture.
['pointerdown', 'keydown', 'touchend'].forEach(t => document.addEventListener(t, () => { if (!ctx || ctx.state !== 'running') audioCtx(); }, { capture: true, passive: true }));
