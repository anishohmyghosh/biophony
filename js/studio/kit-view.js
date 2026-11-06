// Kit tab UI: pads, sound details editor, key selector and sequencer grid.
import { $, ago, h } from '../core/util.js';
import { audioCtx } from './audio.js';
import { pool } from './data.js';
import { audible, pads, reslice, selPad, selectPad, swapPad, trigger } from './kit.js';
import { ROLES } from './roles.js';
import { SCALES, key, noteAt, semis, tune } from './music.js';
import { STEPS, gateFor, mutes, notes, pattern, playing, solos } from './sequencer.js';
import { COL, NOTE, clamp, db, hz, noteName } from './util.js';
import { drawWave, envEditor, knob } from './widgets.js';

const padMeta = p => p.role.k === 'crash' ? `wash · ${hz(p.f.centroid * 2 ** (p.pitch / 12))} · plate` : p.m0 != null ? `tonal · ${hz(p.ins.tonal.f0)} → ${noteName(p.m0 + semis(p))}` : `${p.role.tonal ? 'untuned' : 'noisy hit'}${p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${Math.round(p.pitch)} st` : ''}`;
export function renderPads() {
  const el = $('pads');
  el.replaceChildren(...pads.map((p, i) => {
    const b = h('button', { class: 'pad' + (i === selPad ? ' sel' : '') + (p.role.tonal ? ' tonal' : ''), 'data-i': i, style: `--c:${COL(p.snd.cls)}`, title: `${p.role.name}: ${p.snd.sp.commonName}. Key ${p.role.key}` },
      h('span', { class: 'pad-role' }, p.role.name, h('kbd', {}, p.role.key)),
      h('span', { class: 'pad-sp' }, p.snd.sp.commonName),
      h('span', { class: 'pad-meta' }, padMeta(p), p.tx > 1 ? ' · bat ×10' : ''),
      h('canvas', { class: 'pad-wave' }));
    b.addEventListener('pointerdown', () => { selectPad(i); document.querySelectorAll('.pad').forEach((x, k) => x.classList.toggle('sel', k === i)); document.querySelectorAll('.rs-name').forEach((x, k) => x.classList.toggle('sel', k === i)); trigger(p, audioCtx().currentTime + 0.005); renderEditor(); });
    b.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-biophony')) { e.preventDefault(); b.classList.add('drop'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', e => { e.preventDefault(); b.classList.remove('drop'); const s = pool.find(x => x.id === e.dataTransfer.getData('text/x-biophony')); if (s) { selectPad(i); swapPad(i, s); } });
    return b;
  }));
  requestAnimationFrame(() => el.querySelectorAll('.pad-wave').forEach((cv, i) => drawWave(cv, pads[i].slice, { color: COL(pads[i].snd.cls) })));
  renderSeq();
}
export function renderPadsMeta() {
  document.querySelectorAll('.pad').forEach((b, i) => { const p = pads[i]; if (!p) return; b.querySelector('.pad-meta').textContent = padMeta(p) + (p.tx > 1 ? ' · bat ×10' : ''); drawWave(b.querySelector('.pad-wave'), p.slice, { color: COL(p.snd.cls) }); });
}
export function renderEditor() {
  const p = pads[selPad], el = $('editor');
  if ($('editor').hidden) { $('edToggleL').textContent = `Sound details${p ? ' · ' + p.role.name : ''}`; return; }
  if (!p) { el.replaceChildren(); return; }
  const sr = p.buf.sampleRate, s = p.snd, t = p.ins.tonal;
  const cv = h('canvas', { class: 'src-wave', title: 'Drag to move the slice start. It snaps to transients (the white ticks); hold alt for free placement.' });
  const ms = v => v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s', pct = v => Math.round(v * 100) + '%', st = v => `${v > 0 ? '+' : ''}${Math.round(v)} st`;
  const knobs = {};
  const play = () => trigger(p, audioCtx().currentTime + 0.005);
  const K = (k, label, min, max, opt) => (knobs[k] = knob({ label, min, max, value: p[k], def: opt.def ?? p.role[k] ?? p[k], log: opt.log, step: opt.step, fmt: opt.fmt, onInput: v => { p[k] = v; env.update(); if (k === 'pitch') renderPadsMeta(); }, onChange: play }));
  const env = envEditor(p, () => { knobs.A.update(p.A); knobs.D.update(p.D); knobs.S.update(p.S); knobs.R.update(p.R); });
  const why = p.m0 != null ? `Tonal: strongest partial ${Math.round(t.prom)} dB above the spectrum at ${hz(t.f0)}, wandering ${t.spread.toFixed(1)} st. Tuned to ${noteName(noteAt(p.base))} in ${NOTE[key.root]} ${key.scale}, then ${st(p.pitch)}.`
    : p.role.tonal ? 'No steady pitch in this recording, so it plays untuned.'
    : p.role.k === 'crash' ? `Crash: the brightest, most broadband sound near the pin (flatness ${p.f.flatness.toFixed(2)}, centre ${hz(p.f.centroid)}), high-passed, smeared with two detuned copies and sent to a plate reverb. Plays on bar 1 of every 4.`
    : `Picked as ${p.role.name.toLowerCase()} for its ${p.f.flatness > 0.25 ? 'noisy, broadband' : 'short'} transient (flatness ${p.f.flatness.toFixed(2)}, centre ${hz(p.f.centroid)}, attack ${Math.round(p.f.attack * 1000)} ms).`;
  el.replaceChildren(
    h('div', { class: 'ed-head' },
      s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
      h('div', {}, h('p', { class: 'ed-role' }, `Pad ${selPad + 1} · ${p.role.name}${p.m0 != null ? ' · plays ' + noteName(p.m0 + semis(p)) : ''}`), h('h3', {}, s.sp.commonName), h('p', { class: 'ed-sub' }, `${s.st?.name || ''}${s.st?.country ? ', ' + s.st.country : ''} · ${ago(s.t)} · SNR ${Math.round(p.ins.snr)} dB${p.tx > 1 ? ' · ultrasonic, slowed ×10' : ''}`)),
      h('div', { class: 'ed-btns' },
        h('button', { class: 'btn ghost sm', onclick: play, title: 'Audition (or press ' + p.role.key + ')' }, '▶ Hit'),
        h('button', { class: 'btn ghost sm', onclick: () => swapPad(selPad), title: p.role.tonal ? 'Replace with another tonal call from near the pin' : 'Replace with another sound from near the pin' }, '↻ Swap'),
        h('button', { class: 'btn ghost sm', 'aria-pressed': p.rev, onclick: e => { p.rev = !p.rev; e.currentTarget.setAttribute('aria-pressed', p.rev); play(); } }, '⇆ Reverse'))),
    cv,
    h('div', { class: 'ed-grid' },
      h('div', { class: 'ed-env' }, h('p', { class: 'lh' }, 'Envelope'), env,
        h('div', { class: 'knobs' }, K('A', 'Attack', 0.001, 0.5, { log: true, fmt: ms }), K('D', 'Decay', 0.005, 2, { log: true, fmt: ms }), K('S', 'Sustain', 0, 1, { fmt: pct }), K('R', 'Release', 0.005, 2, { log: true, fmt: ms }))),
      h('div', {}, h('p', { class: 'lh' }, 'Tone'),
        h('div', { class: 'knobs' }, K('pitch', p.role.tonal ? 'Octave' : 'Pitch', -48, 24, { step: 1, fmt: st, def: p.pitch }), K('gain', 'Level', 0, 2, { fmt: v => `${db(v) >= 0 ? '+' : ''}${db(Math.max(v, 1e-3)).toFixed(1)} dB`, def: 1 }),
          K('hp', 'Low cut', 20, 12000, { log: true, fmt: hz }), K('lp', 'High cut', 200, 20000, { log: true, fmt: hz }), p.role.k === 'kick' ? K('body', 'Body', 0, 1, { fmt: pct, def: 0.6 }) : null))),
    h('p', { class: 'hint' }, why),
  );
  const span = Math.min(p.buf.length, Math.round(Math.max(1.6, p.role.max * 1.6) * sr / p.tx)), from = clamp(Math.round(p.t0 * sr - span * 0.25), 0, Math.max(0, p.buf.length - span)), to = from + span;
  const call = s.sc.startTime != null ? [s.sc.startTime * sr, (s.sc.endTime ?? s.sc.startTime + 3) * sr] : null;
  const draw = () => drawWave(cv, p.buf, { from, to, ticks: p.onsets, mark: p.t0 * sr, hl: [p.t0 * sr, p.t0 * sr + p.slice.length], call, color: COL(s.cls) });
  requestAnimationFrame(draw);
  const place = e => {
    const r = cv.getBoundingClientRect(), tt = (from + clamp((e.clientX - r.left) / r.width, 0, 1) * (to - from)) / sr;
    const near = p.onsets.reduce((m, o) => Math.abs(o.t - tt) < Math.abs((m?.t ?? 1e9) - tt) ? o : m, null);
    p.t0 = !e.altKey && near && Math.abs(near.t - tt) < 0.08 / p.tx ? near.t : tt;
    reslice(p); draw();
  };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); place(e);
    const mv = ev => place(ev);
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerup', () => { cv.removeEventListener('pointermove', mv); renderPadsMeta(); play(); }, { once: true });
  });
}

export function renderKey() {
  const r = $('kRoot');
  if (!r.options.length) { r.append(h('option', { value: 'auto' }, 'Auto'), ...NOTE.map((n, i) => h('option', { value: i }, n))); Object.keys(SCALES).forEach(s => $('kScale').append(h('option', { value: s }, s))); }
  $('kScale').value = key.scale;
  $('kKeyNow').textContent = r.value === 'auto' ? `${NOTE[key.root]}` : '';
}
export function retune() { pads.forEach(p => { if (p.m0 != null) tune(p, true); }); renderKey(); renderPadsMeta(); renderEditor(); }
export let paint = null;
document.addEventListener('pointerup', () => { paint = null; });
function cellLabel(i, j) { const r = ROLES[i], v = pattern[i][j], p = pads[i], tonal = r.tonal && p?.m0 != null; return `${r.name}, step ${j + 1}${v ? ', on' : ''}${tonal && v ? `, ${noteName(p.m0 + semis(p, notes[i][j]))}` : ''}`; }
function paintCell(b, i, j) {
  const v = pattern[i][j], r = ROLES[i];
  b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', !!v); b.setAttribute('aria-label', cellLabel(i, j));
  b.style.setProperty('--v', v || 0); b.style.setProperty('--d', (clamp(notes[i][j], -2, 6) + 2) / 8);
  b.replaceChildren(...(r.tonal && v ? [h('i', { class: 'deg' })] : []));
  b.title = r.tonal && v && pads[i]?.m0 != null ? `${noteName(pads[i].m0 + semis(pads[i], notes[i][j]))} · alt-click for a higher note, alt+shift-click for lower` : '';
}
export function renderSeq() {
  const el = $('seq'), cols = [];
  for (let j = 0; j < STEPS; j++) {
    cols.push(h('div', { class: 'col' + (j % 4 === 0 ? ' beat' : '') }, ROLES.map((r, i) => {
      const b = h('button', { class: 'cell' + (r.tonal ? ' mel' : ''), style: `--c:${pads[i] ? COL(pads[i].snd.cls) : 'var(--teal)'}` });
      paintCell(b, i, j);
      const apply = (on, accent) => {
        if (!!pattern[i][j] === on && !accent) return;
        pattern[i][j] = on ? (accent ? 1 : 0.8) : 0;
        paintCell(b, i, j);
        if (on && pads[i] && !playing) trigger(pads[i], audioCtx().currentTime + 0.005, pattern[i][j], gateFor(i), undefined, undefined, notes[i][j]);
      };
      b.addEventListener('pointerdown', e => {
        if (e.button) return; e.preventDefault();
        // alt-click a melody step: up a note (alt+shift: down)
        if (e.altKey && r.tonal && pattern[i][j]) { notes[i][j] = clamp(notes[i][j] + (e.shiftKey ? -1 : 1), -2, 6); paintCell(b, i, j); if (pads[i] && !playing) trigger(pads[i], audioCtx().currentTime + 0.005, 0.8, gateFor(i), undefined, undefined, notes[i][j]); return; }
        paint = { on: !pattern[i][j], row: i }; apply(paint.on, e.shiftKey);
      });
      b.addEventListener('pointerenter', e => { if (paint && (e.buttons & 1) && paint.row === i) apply(paint.on); });
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); apply(!pattern[i][j], e.shiftKey); } });
      return b;
    })));
  }
  const strips = ROLES.map((r, i) => {
    const p = pads[i];
    const name = h('button', { class: 'rs-name' + (i === selPad ? ' sel' : ''), style: `--c:${p ? COL(p.snd.cls) : 'var(--line)'}`, title: p ? `${p.snd.sp.commonName} · click to hear and edit` : '' }, h('span', {}, r.name), r.bar4 ? h('small', {}, '1 / 4 bars') : null);
    name.addEventListener('click', () => { if (!p) return; selectPad(i); document.querySelectorAll('.pad').forEach((x, k) => x.classList.toggle('sel', k === i)); document.querySelectorAll('.rs-name').forEach((x, k) => x.classList.toggle('sel', k === i)); trigger(p, audioCtx().currentTime + 0.005); renderEditor(); });
    const tg = (label, arr, cls, tip) => { const b = h('button', { class: 'rs-t ' + cls, 'aria-pressed': arr[i], title: tip }, label); b.addEventListener('click', () => { arr[i] = !arr[i]; b.setAttribute('aria-pressed', arr[i]); document.querySelectorAll('.rs').forEach((x, k) => x.classList.toggle('muted', !audible(k))); }); return b; };
    const lvl = p ? knob({ label: 'Level', min: 0, max: 2, value: p.gain, def: 1, fmt: v => `${db(Math.max(v, 1e-3)).toFixed(1)} dB`, onInput: v => { p.gain = v; }, size: 'xs' }) : h('span', { class: 'knob xs' });
    return h('div', { class: 'rs' + (audible(i) ? '' : ' muted') }, name, tg('M', mutes, 'm', 'Mute'), tg('S', solos, 's', 'Solo'), lvl);
  });
  el.replaceChildren(h('div', { class: 'rows' }, strips), h('div', { class: 'grid' }, cols));
}
