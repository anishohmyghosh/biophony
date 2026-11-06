// Field recorder tab: mic list, previews and ambience beds.
import { gql } from '../core/api.js';
import { $, h, kmTxt } from '../core/util.js';
import { hydroStatus, hydros } from '../globe/hydrophones.js';
import { sbiColor } from '../globe/metrics.js';
import { stations } from '../globe/stations.js';
import { SILENT } from '../player.js';
import { inspect } from './analysis.js';
import { audioCtx, ctx, master, mon, playBtn, playBuffer, startMon, stopMon } from './audio.js';
import { FRAG, decode, gen, isUltra, loadPool, mapLimit, pool, region, toSnd } from './data.js';
import { LICENSE, credit, normalize, save, slug, wav } from './export.js';
import { tab } from './index.js';
import { lvl } from './library.js';
import { clamp } from './util.js';
import { drawWave } from './widgets.js';

export let recMics = new Set(), recLen = 30, recResult = null, recBusy = false, micScoreFor = -1;
const micEq = new Map();   // station id -> mean spectral evenness of its recent audio
// Score each mic on a blend of: closeness to the pin, its balance index, and how even its spectrum is.
function micScore(o) {
  const near = 1 - Math.min(1, o.km / Math.max(1, region.radius)), bal = o.st.bal ? o.st.bal.sbi / 100 : 0.35, eq = micEq.get(o.st.id) ?? 0.5;
  return 0.35 * near + 0.35 * bal + 0.3 * eq;
}
function scoreMics() {
  if (micScoreFor === gen) return;
  micScoreFor = gen;
  const g = gen;
  const todo = region.near.filter(o => !micEq.has(o.st.id));
  (async () => {
    // one request for all mics (plus whatever the library already fetched), two clips per mic
    if (!pool.length) await loadPool().catch(() => {});
    const by = new Map();
    for (const s of pool) if (!isUltra(s)) { const a = by.get(s.st?.id) || []; if (a.length < 2 && !a.some(x => x.sc.url === s.sc.url)) a.push(s); by.set(s.st?.id, a); }
    await mapLimit(todo, 4, async o => {
      const r = (await mapLimit(by.get(o.st.id) || [], 2, inspect)).filter(x => x && x.label !== 'silent');
      micEq.set(o.st.id, r.length ? r.reduce((a, x) => a + x.eq, 0) / r.length : 0.3);
    });
  })().then(() => { if (g === gen && tab === 'rec' && !recBusy) renderRec(); });
}
const RECENT = `query($id:ID!){ station(id:$id){ detections(first:8, validSoundscape:true){ nodes{ ${FRAG} } } } }`;
function previewStation(st, btn, row) {
  return startMon(btn, row, async done => {
    const nodes = (await gql(RECENT, { id: st.id })).station?.detections?.nodes || [];
    const snds = [...new Map(nodes.filter(n => n.soundscape?.url).map(n => [n.soundscape.url, toSnd(n)])).values()].filter(s => !isUltra(s)).slice(0, 4);
    const res = (await mapLimit(snds, 4, async s => ({ s, ins: await inspect(s) }))).filter(r => r && r.ins.label !== 'silent').sort((a, b) => b.ins.snr - a.ins.snr);
    if (!res.length) throw new Error('nothing audible');
    const { s, ins } = res[0], b = await decode(s);
    return playBuffer(b, { gain: lvl(ins, -24), from: Math.max(0, (s.sc.startTime ?? 0) - 2), dur: 9, onEnd: done });
  }, 's:' + st.id).catch(() => { $('recMsg').textContent = `${st.name} has no audible recent audio.`; });
}
function previewHydro(hy, btn, row) {
  const el = new Audio(); el.crossOrigin = 'anonymous';
  el.src = SILENT; el.play().catch(() => {});          // claim the click for this element (Safari)
  return startMon(btn, row, async () => {
    if (!(await hydroStatus(hy))) throw new Error('offline');
    audioCtx();
    let hls = null;
    if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(el); } else el.src = hy.url;
    const s = ctx.createMediaElementSource(el), g = ctx.createGain(); g.gain.value = 2; s.connect(g); g.connect(master);
    await el.play();
    return { stop: () => { el.pause(); hls?.destroy(); s.disconnect(); } };
  }, 'h:' + hy.id).catch(() => { $('recMsg').textContent = `${hy.a.name} is offline right now.`; });
}
export function renderRec() {
  if (!region) return;
  const el = $('recMics');
  scoreMics();
  const st = [...region.near].sort((a, b) => micScore(b) - micScore(a));
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
    h('p', { class: 'lh' }, `Station mics · best match first`),
    ...st.map(o => { const { st: s, km } = o, eq = micEq.get(s.id); return row('s:' + s.id, s.name, `${kmTxt(km)}${s.m?.S ? ` · ${s.m.S} species` : ''}${eq != null ? ` · EQ ${Math.round(eq * 100)}` : ' · EQ …'}`,
      h('span', { class: 'pill', style: `background:${sbiColor(Math.round(micScore(o) * 100))}`, title: `Match ${Math.round(micScore(o) * 100)}: distance ${kmTxt(km)}, balance ${s.bal?.sbi ?? 'n/a'}, spectral evenness ${eq != null ? Math.round(eq * 100) : 'checking'}` }, Math.round(micScore(o) * 100)), 'st', (b, r) => previewStation(s, b, r)); }),
  ].filter(Boolean));
  const n = recMics.size, hyd = [...recMics].some(x => x.startsWith('h:'));
  $('recSel').textContent = n ? `${n} mic${n > 1 ? 's' : ''} selected${hyd ? ' (live, records in real time)' : n > 1 ? ' · spread across the stereo field' : ''}` : 'Choose up to 4 mics. ▶ previews one.';
  $('recGo').disabled = !n || recBusy;
}
async function stationClips(id) {
  const d = await gql(`query($id:ID!){ station(id:$id){ detections(first:60, validSoundscape:true){ nodes{ ${FRAG} } } } }`, { id });
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
    if (mics[0].startsWith('h:')) tracks = [await recordHydro(hydros.get(mics[0].slice(2)), L + (loopIt ? xf : 0) + 1.5, msg)];
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
        return { bufs, skipped, name: stations.get(m.slice(2))?.name };
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
  const el = new Audio(); el.crossOrigin = 'anonymous';
  el.src = SILENT; el.play().catch(() => {});          // claim the click for this element (Safari)
  const live = await hydroStatus(hy); if (!live) throw new Error('this hydrophone is offline right now');
  audioCtx();
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

export function resetRecorder() { micScoreFor = -1; recMics.clear(); recResult = null; }
document.querySelectorAll('#recLens button').forEach(b => b.addEventListener('click', () => { recLen = +b.dataset.s; document.querySelectorAll('#recLens button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); }));
$('recGo').addEventListener('click', buildBed);
