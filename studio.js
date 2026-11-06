// Field Studio: drum kits, a sound library and an ambience recorder built from the region in view.
const B = () => window.biophony;
const $ = id => document.getElementById(id);
const h = (...a) => B().h(...a);
const COL = c => B().COLORS[c] || B().COLORS.bird;
const LABEL = c => B().CLS[c] || 'Sound';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------- audio ----------------
let ctx, master, limiter, meterNode;
function audioCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    master = ctx.createGain(); master.gain.value = 0.85;
    limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    meterNode = ctx.createAnalyser(); meterNode.fftSize = 1024;
    master.connect(limiter); limiter.connect(meterNode); meterNode.connect(ctx.destination);
  }
  ctx.resume();
  return ctx;
}
let auditionSrc = null;
function stopAudition() { try { auditionSrc?.stop(); } catch { } auditionSrc = null; document.querySelectorAll('.lib-row.playing').forEach(r => r.classList.remove('playing')); }

// ---------------- data ----------------
const FRAG = `id timestamp confidence species{ id commonName scientificName classification thumbnailUrl } station{ id name country coords{lat lon} } soundscape{ url startTime endTime duration sampleRate }`;
const DQ = `query($ne:InputLocation,$sw:InputLocation,$n:Int,$after:String){ detections(first:$n, after:$after, ne:$ne, sw:$sw, validSoundscape:true, confidenceGte:0.6){ pageInfo{ hasNextPage endCursor } nodes{ ${FRAG} } } }`;
const DQS = `query($ne:InputLocation,$sw:InputLocation,$n:Int,$s:ID){ detections(first:$n, speciesId:$s, ne:$ne, sw:$sw, validSoundscape:true){ nodes{ ${FRAG} } } }`;
const RARE = `query($ne:InputLocation,$sw:InputLocation){ topSpecies(limit:6, period:{count:1,unit:"day"}, classifications:["insect","amphibian","bat","mammal"], ne:$ne, sw:$sw){ count species{ id commonName classification } } }`;
const toSnd = n => ({ id: n.id, t: n.timestamp, conf: n.confidence, sp: n.species, cls: B().normCls(n.species?.classification), st: n.station, sc: n.soundscape });
const isUltra = s => (s.sc.sampleRate || 48000) > 96000;
const TX = s => isUltra(s) ? 10 : 1;          // time expansion factor for bat recordings

let region = null, pool = [], poolCursor = null, poolMore = false, poolBusy = null;
function captureRegion() {
  const { map, stations } = B(), b = map.getBounds();
  const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()), s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  const inView = [...stations.values()].filter(x => b.contains([x.lat, x.lon]));
  const tally = k => { const m = new Map(); inView.forEach(x => { const v = x[k]; if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]); };
  const states = tally('state'), countries = tally('country'), conts = tally('continent');
  const cnt = k => inView.filter(x => x.country === k).length;
  if (countries.length > 1 && cnt(countries[0]) >= inView.length * 0.85) countries.length = 1;
  const label = countries.length === 1 && states.length ? states.slice(0, 2).join(' & ') + `, ${countries[0]}` : countries.length && countries.length <= 3 ? countries.join(', ') : conts.slice(0, 3).join(', ') || 'Current view';
  region = { ne: { lat: n, lon: e }, sw: { lat: s, lon: w }, label, inView, hydros: [...B().hydros.values()].filter(x => b.contains([x.a.lat_lng.lat, x.a.lat_lng.lng])) };
  pool = []; poolCursor = null; poolMore = false; poolBusy = null;
  $('stRegion').textContent = `${label} · ${inView.length.toLocaleString()} station${inView.length === 1 ? '' : 's'}${region.hydros.length ? ` · ${region.hydros.length} hydrophone${region.hydros.length > 1 ? 's' : ''}` : ''}`;
}
async function loadPool(more = false) {
  if (poolBusy) return poolBusy;
  poolBusy = (async () => {
    const { gql } = B(), v = { ne: region.ne, sw: region.sw };
    const main = gql(DQ, { ...v, n: 100, after: more ? poolCursor : null });
    const rare = more ? Promise.resolve(null) : gql(RARE, v).then(async r => {
      const sp = (r.topSpecies || []).slice(0, 4);
      const lists = await Promise.all(sp.map(x => gql(DQS, { ...v, n: 4, s: x.species.id }).then(d => d.detections.nodes).catch(() => [])));
      return lists.flat();
    }).catch(() => null);
    const [d, extra] = await Promise.all([main, rare]);
    poolCursor = d.detections.pageInfo.endCursor; poolMore = d.detections.pageInfo.hasNextPage;
    const seen = new Set(pool.map(x => x.id));
    for (const n of [...(extra || []), ...d.detections.nodes]) if (n.soundscape?.url && !seen.has(n.id)) { seen.add(n.id); pool.push(toSnd(n)); }
  })();
  try { await poolBusy; } finally { poolBusy = null; }
}

const bufCache = new Map();
async function decode(snd) {
  const url = snd.sc.url;
  if (!bufCache.has(url)) bufCache.set(url, (async () => {
    const sr = clamp(snd.sc.sampleRate || 48000, 8000, 384000);
    const ab = await (await fetch(url)).arrayBuffer();
    return new OfflineAudioContext(1, 1, sr).decodeAudioData(ab);
  })().catch(e => { bufCache.delete(url); throw e; }));
  return bufCache.get(url);
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch { out[k] = null; } } }));
  return out;
}

// ---------------- analysis: onsets + features ----------------
function mono(buf) { return buf.getChannelData(0); }
function stft(x, sr, N) {
  const { fft } = B(), hop = N >> 2, win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const frames = [], re = new Float64Array(N), im = new Float64Array(N);
  for (let o = 0; o + N <= x.length; o += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(N >> 1); for (let k = 0; k < m.length; k++) m[k] = Math.hypot(re[k], im[k]);
    frames.push(m);
  }
  return { frames, hop };
}
// Spectral-flux onset detection with an adaptive (moving median) threshold.
function onsets(buf) {
  const x = mono(buf), sr = buf.sampleRate, N = 2 ** Math.round(Math.log2(sr * 0.021));
  const { frames, hop } = stft(x, sr, N);
  const nov = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f++) { let s = 0; const a = frames[f], b = frames[f - 1]; for (let k = 1; k < a.length; k++) { const d = Math.log1p(100 * a[k]) - Math.log1p(100 * b[k]); if (d > 0) s += d; } nov[f] = s; }
  const mx = Math.max(...nov, 1e-9); for (let i = 0; i < nov.length; i++) nov[i] /= mx;
  const out = [], W = 8;
  for (let f = 2; f < nov.length - 2; f++) {
    const lo = Math.max(0, f - W), hi = Math.min(nov.length, f + W + 1), win = [...nov.slice(lo, hi)].sort((a, b) => a - b);
    const thr = win[win.length >> 1] + 0.12;
    if (nov[f] > thr && nov[f] >= nov[f - 1] && nov[f] >= nov[f + 1] && nov[f] >= nov[f - 2] && nov[f] >= nov[f + 2]) out.push({ t: (f * hop) / sr, s: nov[f] });
  }
  return out;
}
function makeSlice(buf, t0, maxLen) {
  const x = mono(buf), sr = buf.sampleRate, s0 = Math.max(0, Math.round((t0 - 0.004) * sr));
  const max = Math.min(x.length - s0, Math.round(maxLen * sr)), win = Math.max(1, Math.round(0.01 * sr));
  let peak = 0, peakAt = 0; for (let i = 0; i < Math.min(max, 0.06 * sr); i++) { const v = Math.abs(x[s0 + i]); if (v > peak) { peak = v; peakAt = i; } }
  let end = max;
  for (let i = peakAt; i + win < max; i += win) { let r = 0; for (let j = 0; j < win; j++) r = Math.max(r, Math.abs(x[s0 + i + j])); if (r < peak * 0.04 && i > 0.06 * sr) { end = i + win; break; } }
  const len = Math.max(Math.round(0.05 * sr), end);
  const out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: sr }), y = out.getChannelData(0);
  const fi = Math.round(0.002 * sr), fo = Math.min(len >> 1, Math.round(0.015 * sr));
  for (let i = 0; i < len; i++) { let g = 1; if (i < fi) g = i / fi; else if (i > len - fo) g = (len - i) / fo; y[i] = (x[s0 + i] || 0) * g; }
  return out;
}
function features(slice, tx) {
  const x = mono(slice), sr = slice.sampleRate, N = Math.min(2 ** Math.round(Math.log2(sr * 0.02)), 2 ** Math.floor(Math.log2(x.length)));
  const { frames } = stft(x, sr, Math.max(64, N)), K = frames[0]?.length || 1, avg = new Float64Array(K);
  frames.forEach(f => { for (let k = 0; k < K; k++) avg[k] += f[k]; });
  let num = 0, den = 0, lg = 0, ar = 0;
  for (let k = 1; k < K; k++) { const p = avg[k] + 1e-12, f = (k * sr) / (2 * K); num += f * p; den += p; lg += Math.log(p); ar += p; }
  let rms = 0; for (const v of x) rms += v * v;
  return { centroid: num / den / tx, flatness: Math.exp(lg / (K - 1)) / (ar / (K - 1)), dur: x.length / sr * tx, rms: Math.sqrt(rms / x.length) };
}
function bestOnset(snd, list) {
  const a = (snd.sc.startTime ?? 0) - 0.3, b = (snd.sc.endTime ?? 1e9) + 0.3;
  const inWin = list.filter(o => o.t >= a && o.t <= b);
  return (inWin.length ? inWin : list).reduce((m, o) => o.s > (m?.s ?? -1) ? o : m, null)?.t ?? Math.max(0, snd.sc.startTime || 0);
}

// ---------------- kit ----------------
const ROLES = [
  { k: 'kick', name: 'Kick', key: '1', note: 36, A: 0.001, D: 0.22, S: 0, R: 0.05, hp: 20, lp: 900, target: 110, max: 0.5 },
  { k: 'snare', name: 'Snare', key: '2', note: 38, A: 0.001, D: 0.16, S: 0.1, R: 0.08, hp: 220, lp: 12000, max: 0.5 },
  { k: 'clap', name: 'Clap', key: '3', note: 39, A: 0.002, D: 0.12, S: 0, R: 0.1, hp: 600, lp: 14000, max: 0.4 },
  { k: 'chat', name: 'Closed hat', key: '4', note: 42, A: 0.001, D: 0.045, S: 0, R: 0.02, hp: 4500, lp: 20000, max: 0.25 },
  { k: 'ohat', name: 'Open hat', key: '5', note: 46, A: 0.001, D: 0.28, S: 0.2, R: 0.15, hp: 3500, lp: 20000, max: 0.6 },
  { k: 'perc', name: 'Perc', key: '6', note: 37, A: 0.001, D: 0.12, S: 0, R: 0.05, hp: 300, lp: 16000, max: 0.4 },
  { k: 'tom', name: 'Low perc', key: '7', note: 45, A: 0.001, D: 0.24, S: 0, R: 0.08, hp: 40, lp: 2500, target: 260, max: 0.5 },
  { k: 'fx', name: 'Call', key: '8', note: 49, A: 0.02, D: 0.4, S: 0.7, R: 0.35, hp: 150, lp: 16000, max: 2.2, gate: 1.4 },
];
let pads = [], selPad = 0, candidates = [], kitBusy = false;

async function analyse(snd) {
  const buf = await decode(snd), tx = TX(snd);
  const list = onsets(buf), t0 = bestOnset(snd, list);
  const slice = makeSlice(buf, t0, 0.8 / tx), f = features(slice, tx);
  return { snd, buf, tx, onsets: list, t0, f };
}
function padFrom(role, c) {
  const p = { role, snd: c.snd, buf: c.buf, tx: c.tx, onsets: c.onsets, t0: c.t0, f: c.f, A: role.A, D: role.D, S: role.S, R: role.R, hp: role.hp, lp: role.lp, gain: 0.9, pitch: 0, rev: false };
  if (role.k === 'fx') { const st = p.snd.sc.startTime ?? p.t0; p.t0 = Math.max(0, st - 0.02); }
  p.pitch = role.target ? Math.round(clamp(12 * Math.log2(role.target / Math.max(60, c.f.centroid)), -36, 0)) : role.k === 'chat' || role.k === 'ohat' ? Math.round(clamp(12 * Math.log2(7000 / Math.max(500, c.f.centroid)), 0, 12)) : 0;
  reslice(p);
  return p;
}
function reslice(p) { p.slice = makeSlice(p.buf, p.t0, p.role.max / p.tx); p.rslice = null; }
function assign(cands) {
  const left = [...cands], take = fn => { if (!left.length) return null; left.sort(fn); return left.shift(); };
  const by = {};
  by.fx = take((a, b) => (a.f.flatness - b.f.flatness) || (b.f.dur - a.f.dur));
  by.chat = take((a, b) => b.f.centroid - a.f.centroid);
  by.ohat = take((a, b) => b.f.centroid - a.f.centroid);
  by.kick = take((a, b) => a.f.centroid - b.f.centroid);
  by.tom = take((a, b) => a.f.centroid - b.f.centroid);
  by.snare = take((a, b) => b.f.flatness - a.f.flatness);
  by.clap = take((a, b) => b.f.flatness - a.f.flatness);
  by.perc = take((a, b) => b.f.rms - a.f.rms);
  return ROLES.map(r => by[r.k] || cands[Math.floor(Math.random() * cands.length)]).map((c, i) => padFrom(ROLES[i], c));
}
function pickCandidates(n = 14) {
  const bySp = new Map();
  for (const s of [...pool].sort(() => Math.random() - 0.5)) if (!bySp.has(s.sp.id)) bySp.set(s.sp.id, s);
  const list = [...bySp.values()], rare = list.filter(s => s.cls !== 'bird'), birds = list.filter(s => s.cls === 'bird');
  return [...rare.slice(0, 4), ...birds].slice(0, n);
}
async function buildKit() {
  if (kitBusy) return; kitBusy = true;
  const st = $('kitStatus'); st.textContent = 'Collecting sounds from this region…';
  try {
    if (!pool.length) await loadPool();
    if (pool.length < 3) { st.textContent = 'Not enough recordings in this view. Zoom out or pan to a monitored area, then rebuild.'; return; }
    const picks = pickCandidates();
    let done = 0;
    const res = (await mapLimit(picks, 4, async s => { const r = await analyse(s); st.textContent = `Finding transients… ${++done} of ${picks.length}`; return r; })).filter(Boolean);
    if (res.length < 3) { st.textContent = 'Could not decode enough clips. Try again.'; return; }
    candidates = res;
    pads = assign(res);
    selPad = 0;
    renderPads(); renderEditor();
    if (!pattern.some(r => r.some(Boolean))) generate($('kStyle').value);
    st.textContent = `Kit built from ${new Set(pads.map(p => p.snd.sp.id)).size} species heard in ${region.label}. Press space to play.`;
  } catch (e) { st.textContent = 'Could not build a kit: ' + e.message; }
  finally { kitBusy = false; }
}
async function swapPad(i, snd) {
  const p = pads[i]; if (!p) return;
  const st = $('kitStatus'); st.textContent = 'Analysing new sound…';
  let c;
  if (snd) c = await analyse(snd);
  else {
    const used = new Set(pads.map(x => x.snd.id)), spare = candidates.filter(x => !used.has(x.snd.id));
    if (spare.length) c = spare[Math.floor(Math.random() * spare.length)];
    else { if (poolMore || !pool.length) await loadPool(true); const s = pool.filter(x => !used.has(x.id))[Math.floor(Math.random() * pool.length / 2)]; if (!s) { st.textContent = 'No more sounds in this region.'; return; } c = await analyse(s); candidates.push(c); }
  }
  const keep = { gain: p.gain, A: p.A, D: p.D, S: p.S, R: p.R, hp: p.hp, lp: p.lp };
  pads[i] = Object.assign(padFrom(p.role, c), keep);
  renderPads(); renderEditor(); trigger(pads[i], audioCtx().currentTime + 0.01);
  st.textContent = `${p.role.name} is now ${c.snd.sp.commonName}.`;
}

function reversed(p) {
  if (!p.rslice) { const b = p.slice, r = new AudioBuffer({ length: b.length, numberOfChannels: 1, sampleRate: b.sampleRate }), x = b.getChannelData(0), y = r.getChannelData(0); for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i]; p.rslice = r; }
  return p.rslice;
}
const voices = new Map();
function trigger(p, when, vel = 1, gate, c = audioCtx(), dest = master, pan = 0) {
  if (!p?.slice) return;
  if (p.role.k === 'chat' && voices.get('ohat') && c === ctx) { const v = voices.get('ohat'); try { v.g.gain.cancelScheduledValues(when); v.g.gain.setTargetAtTime(0, when, 0.01); } catch { } }
  const src = c.createBufferSource(); src.buffer = p.rev ? reversed(p) : p.slice;
  src.playbackRate.value = (1 / p.tx) * 2 ** (p.pitch / 12);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hp;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.lp;
  const g = c.createGain(), pk = vel * p.gain, A = Math.max(0.001, p.A), D = Math.max(0.005, p.D);
  const gt = gate ?? p.role.gate ?? 0.12, tOff = when + Math.max(gt, A + D);
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(pk, when + A); g.gain.linearRampToValueAtTime(pk * p.S, when + A + D);
  g.gain.setValueAtTime(pk * p.S, tOff); g.gain.linearRampToValueAtTime(0, tOff + Math.max(0.005, p.R));
  let out = g;
  if (pan) { const pn = c.createStereoPanner(); pn.pan.value = pan; g.connect(pn); out = pn; }
  src.connect(hp); hp.connect(lp); lp.connect(g); out.connect(dest);
  src.start(when); src.stop(tOff + p.R + 0.05);
  if (c === ctx) { voices.set(p.role.k, { g }); flashPad(p, when); }
}
function flashPad(p, when) {
  const i = pads.indexOf(p), el = document.querySelector(`.pad[data-i="${i}"]`); if (!el) return;
  setTimeout(() => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }, Math.max(0, (when - ctx.currentTime) * 1000));
}

// ---------------- sequencer ----------------
const STEPS = 16;
let pattern = ROLES.map(() => Array(STEPS).fill(0)), bpm = 96, swing = 0.12, playing = false, step = 0, nextT = 0, schedTimer = null;
const STYLES = {
  'House': { bpm: 122, p: ['9000900090009000', '0000000000000000', '0000900000009000', '5050505050505050', '0090009000900090', '0002000300020004', '0000000000000300', '3000000000000000'] },
  'Boom bap': { bpm: 90, p: ['9000000690300000', '0000900000009000', '0000300000003001', '7070707070707070', '0000000000000005', '0010000100100001', '0000000000000040', '4000000000000000'] },
  'Breakbeat': { bpm: 132, p: ['9000000009300000', '0000900200009002', '0000000000000000', '8585858585858585', '0000000300000003', '0300003000300300', '0000000000000005', '3000000030000000'] },
  'Techno': { bpm: 130, p: ['9000900090009000', '0003000000300000', '0000700000007000', '0090009000900090', '0000000000000000', '3030303030303030', '0000040000000400', '2000000000000000'] },
  'Dembow': { bpm: 100, p: ['9000900090009000', '0009009000090090', '0000000000000000', '6060606060606060', '0000000000000000', '0000300000003000', '0000000000000003', '3000000000000000'] },
  'Dawn chorus': { bpm: 84, euclid: [3, 2, 0, 7, 2, 5, 3, 1] },
};
function euclid(k, n) { const out = []; let b = -1; for (let i = 0; i < n; i++) { const v = Math.floor((i * k) / n); out.push(v !== b ? 1 : 0); b = v; } return out; }
function generate(style) {
  const s = STYLES[style];
  bpm = s.bpm + Math.round(rnd(-3, 3)); $('kBpm').value = bpm; $('kBpmV').textContent = bpm;
  pattern = ROLES.map((r, i) => {
    if (s.euclid) { const k = s.euclid[i] ? s.euclid[i] + Math.round(rnd(-1, 1)) : 0, rot = Math.floor(rnd(0, 16)), e = euclid(clamp(k, 0, 16), STEPS); return e.map((_, j) => e[(j + rot) % STEPS] ? +(rnd(0.55, 1)).toFixed(2) : 0); }
    return [...s.p[i]].map((ch, j) => { const pr = +ch / 9; if (Math.random() >= pr) return 0; return +(j % 4 === 0 ? rnd(0.9, 1) : rnd(0.55, 0.85)).toFixed(2); });
  });
  if (!s.euclid) pattern[0][0] = 1;
  renderSeq();
}
function mutate() {
  for (let n = 0; n < 4; n++) { const r = 1 + Math.floor(Math.random() * 7), j = Math.floor(Math.random() * STEPS); pattern[r][j] = pattern[r][j] ? 0 : +rnd(0.5, 0.9).toFixed(2); }
  renderSeq();
}
const stepDur = () => 60 / bpm / 4;
function scheduleStep(j, t) { pattern.forEach((row, i) => { if (row[j] && pads[i]) trigger(pads[i], t, row[j], i === 4 ? stepDur() * 1.6 : undefined); }); }
function schedTick() {
  while (nextT < ctx.currentTime + 0.12) {
    const t = nextT + (step % 2 ? swing * stepDur() : 0);
    scheduleStep(step, t);
    const j = step; setTimeout(() => { if (playing) document.querySelectorAll('.seq .col').forEach((c, k) => c.classList.toggle('now', k === j)); }, Math.max(0, (t - ctx.currentTime) * 1000));
    step = (step + 1) % STEPS; nextT += stepDur();
  }
}
function togglePlay(on = !playing) {
  if (on && !pads.length) return;
  playing = on;
  $('kPlay').textContent = on ? '■ Stop' : '▶ Play';
  $('kPlay').setAttribute('aria-pressed', on);
  clearInterval(schedTimer);
  document.querySelectorAll('.seq .col').forEach(c => c.classList.remove('now'));
  if (on) { audioCtx(); step = 0; nextT = ctx.currentTime + 0.06; schedTimer = setInterval(schedTick, 25); schedTick(); }
}

// ---------------- rendering + export helpers ----------------
function wav(buffer, bits = 24) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length, by = bits / 8, dl = len * ch * by;
  const ab = new ArrayBuffer(44 + dl), dv = new DataView(ab), ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); dv.setUint32(4, 36 + dl, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * by, true); dv.setUint16(32, ch * by, true); dv.setUint16(34, bits, true); ws(36, 'data'); dv.setUint32(40, dl, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = clamp(data[c][i], -1, 1);
    if (bits === 16) { dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    else { const v = Math.round(s * 8388607); dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3; }
  }
  return new Uint8Array(ab);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zip(files) {     // store-only ZIP; files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), parts = [], cent = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true));
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true));
    cent.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const csz = cent.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, csz, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  return new Blob([...parts, ...cent, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function midi(pat, tempo) {
  const evs = [];
  pat.forEach((row, i) => row.forEach((v, j) => { if (v) { evs.push([j * 24, 0x99, ROLES[i].note, Math.round(v * 127)]); evs.push([j * 24 + 12, 0x89, ROLES[i].note, 0]); } }));
  evs.sort((a, b) => a[0] - b[0] || (a[1] === 0x89 ? -1 : 1));
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const us = Math.round(60e6 / tempo), trk = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  let last = 0; for (const [t, s, n, v] of evs) { trk.push(...vlq(t - last), s, n, v); last = t; }
  trk.push(...vlq(STEPS * 24 - last), 0xff, 0x2f, 0);
  const hd = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96], th = [0x4d, 0x54, 0x72, 0x6b, (trk.length >>> 24) & 255, (trk.length >> 16) & 255, (trk.length >> 8) & 255, trk.length & 255];
  return new Blob([new Uint8Array([...hd, ...th, ...trk])], { type: 'audio/midi' });
}
function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const slug = s => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'sound';
const credit = s => `${s.sp.commonName} (${s.sp.scientificName || ''}) · ${s.st?.name || 'station'}${s.st?.country ? ', ' + s.st.country : ''} · ${new Date(s.t).toISOString()} · BirdNET ${Math.round((s.conf || 0) * 100)}%${isUltra(s) ? ' · ultrasonic, ' + s.sc.sampleRate + ' Hz' : ''} · ${s.sc.url}`;
const LICENSE = 'Recordings come from BirdWeather stations run by members of the public (app.birdweather.com), recognised by BirdNET. Credit the station and BirdWeather. Check BirdWeather\'s terms and contact the station owner before commercial use. Species labels are automated and can be wrong.';
function normalize(buf, peakDb = -1) { let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) pk = Math.max(pk, Math.abs(v)); const g = pk ? 10 ** (peakDb / 20) / pk : 1; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } return buf; }
async function renderOneShot(p) {
  const playDur = p.slice.duration * p.tx / 2 ** (p.pitch / 12), gate = p.role.gate ?? (p.S > 0 ? playDur : p.A + p.D);
  const len = Math.min(playDur, Math.max(gate, p.A + p.D) + p.R) + 0.05, oc = new OfflineAudioContext(1, Math.ceil(len * 48000), 48000);
  trigger(p, 0, 1, gate, oc, oc.destination);
  return normalize(await oc.startRendering(), -1);
}
async function exportKit() {
  if (!pads.length) return;
  const st = $('kitStatus'); st.textContent = 'Rendering kit…';
  const files = [];
  for (const [i, p] of pads.entries()) files.push({ name: `${String(i + 1).padStart(2, '0')}_${p.role.name.replace(/\s/g, '-')}_${slug(p.snd.sp.commonName)}.wav`, data: wav(await renderOneShot(p), 24) });
  files.push({ name: 'pattern.mid', data: new Uint8Array(await midi(pattern, bpm).arrayBuffer()) });
  files.push({ name: 'kit.json', data: new TextEncoder().encode(JSON.stringify({ region: region.label, bpm, swing, pattern, pads: pads.map(p => ({ role: p.role.name, species: p.snd.sp.commonName, scientific: p.snd.sp.scientificName, station: p.snd.st?.name, onset: +p.t0.toFixed(3), pitch: p.pitch, A: p.A, D: p.D, S: p.S, R: p.R, hp: p.hp, lp: p.lp, reverse: p.rev, timeExpansion: p.tx, source: p.snd.sc.url })) }, null, 2)) });
  files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(`Biophony field kit · ${region.label}\n\n${pads.map((p, i) => `${i + 1}. ${p.role.name}: ${credit(p.snd)}`).join('\n')}\n\n${LICENSE}\n`) });
  save(zip(files), `biophony-kit_${slug(region.label)}.zip`);
  st.textContent = 'Kit downloaded: 8 one-shots (24-bit WAV), the pattern as MIDI, settings and credits.';
}
async function exportLoop(bars = 4) {
  if (!pads.length) return;
  const sd = stepDur(), len = bars * STEPS * sd + 2, oc = new OfflineAudioContext(2, Math.ceil(len * 48000), 48000);
  const comp = oc.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 12; comp.connect(oc.destination);
  for (let b = 0; b < bars; b++) for (let j = 0; j < STEPS; j++) { const t = (b * STEPS + j) * sd + (j % 2 ? swing * sd : 0); pattern.forEach((row, i) => { if (row[j]) trigger(pads[i], t, row[j], i === 4 ? sd * 1.6 : undefined, oc, comp); }); }
  const out = normalize(await oc.startRendering(), -1);
  // trim to exact bar length but fold the tail into the start so the loop is seamless
  const L = Math.round(bars * STEPS * sd * 48000), loop = new AudioBuffer({ length: L, numberOfChannels: 2, sampleRate: 48000 });
  for (let c = 0; c < 2; c++) { const s = out.getChannelData(c), d = loop.getChannelData(c); for (let i = 0; i < L; i++) d[i] = s[i] + (i + L < s.length ? s[i + L] : 0); }
  save(new Blob([wav(normalize(loop, -1), 24)], { type: 'audio/wav' }), `biophony-loop_${bpm}bpm_${slug($('kStyle').value)}.wav`);
}

// ---------------- kit UI ----------------
function drawWave(cv, buf, opts = {}) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * dpr | 0); cv.height = Math.max(1, r.height * dpr | 0);
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, x = mono(buf), n = x.length, a = opts.from ?? 0, b = opts.to ?? n;
  g.clearRect(0, 0, W, H);
  if (opts.hl) { g.fillStyle = 'rgba(120,214,192,.14)'; g.fillRect(((opts.hl[0] - a) / (b - a)) * W, 0, ((opts.hl[1] - opts.hl[0]) / (b - a)) * W, H); }
  if (opts.call) { g.fillStyle = 'rgba(227,183,101,.10)'; g.fillRect(((opts.call[0] - a) / (b - a)) * W, 0, ((opts.call[1] - opts.call[0]) / (b - a)) * W, H); }
  g.fillStyle = opts.color || '#78d6c0';
  const per = (b - a) / W;
  let pk = 1e-6; for (let i = a; i < b; i += Math.max(1, ((b - a) / 4000) | 0)) pk = Math.max(pk, Math.abs(x[i] || 0));
  const gain = Math.min(30, 0.95 / pk);
  for (let px = 0; px < W; px++) { let mn = 1, mx = -1; const s = a + Math.floor(px * per), e = Math.min(n, s + Math.max(1, Math.floor(per))); for (let i = s; i < e; i += Math.max(1, (per / 64) | 0)) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; } if (mx < mn) continue; g.fillRect(px, H / 2 - mx * gain * H * 0.48, 1, Math.max(1, (mx - mn) * gain * H * 0.48)); }
  if (opts.ticks) { g.fillStyle = 'rgba(233,239,233,.55)'; for (const t of opts.ticks) { const X = ((t.t * buf.sampleRate - a) / (b - a)) * W; g.fillRect(X, 0, Math.max(1, dpr), H * (0.15 + 0.35 * t.s)); } }
  if (opts.mark != null) { g.fillStyle = '#e3b765'; g.fillRect(((opts.mark - a) / (b - a)) * W - dpr, 0, 2 * dpr, H); }
}
function renderPads() {
  const el = $('pads');
  el.replaceChildren(...pads.map((p, i) => {
    const b = h('button', { class: 'pad' + (i === selPad ? ' sel' : ''), 'data-i': i, style: `--c:${COL(p.snd.cls)}`, title: `${p.role.name}: ${p.snd.sp.commonName}. Key ${p.role.key}` },
      h('span', { class: 'pad-role' }, p.role.name, h('kbd', {}, p.role.key)),
      h('span', { class: 'pad-sp' }, p.snd.sp.commonName),
      h('span', { class: 'pad-meta' }, LABEL(p.snd.cls), p.tx > 1 ? ' · ×10 slowed' : '', p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${p.pitch} st` : ''),
      h('canvas', { class: 'pad-wave' }));
    b.addEventListener('pointerdown', () => { selPad = i; document.querySelectorAll('.pad').forEach((x, k) => x.classList.toggle('sel', k === i)); trigger(p, audioCtx().currentTime + 0.005); renderEditor(); });
    return b;
  }));
  requestAnimationFrame(() => el.querySelectorAll('.pad-wave').forEach((cv, i) => drawWave(cv, pads[i].slice, { color: COL(pads[i].snd.cls) })));
  renderSeq();
}
function envSvg(p) {
  const NS = 'http://www.w3.org/2000/svg', W = 200, H = 60, tot = p.A + p.D + 0.25 + p.R, X = t => (t / tot) * W, Y = v => H - 4 - v * (H - 8);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'env'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M0,${Y(0)} L${X(p.A)},${Y(1)} L${X(p.A + p.D)},${Y(p.S)} L${X(p.A + p.D + 0.25)},${Y(p.S)} L${X(tot)},${Y(0)}`);
  svg.append(path);
  return svg;
}
function renderEditor() {
  const p = pads[selPad], el = $('editor');
  if (!p) { el.replaceChildren(); return; }
  const sr = p.buf.sampleRate, s = p.snd;
  const cv = h('canvas', { class: 'src-wave', title: 'Click to move the slice start. Ticks are detected transients; the gold line is the slice start.' });
  const env = h('div', { class: 'env-wrap' }, envSvg(p));
  const ctl = (label, key, min, max, stepv, fmtv, log) => {
    const toS = v => log ? Math.log(v) : v, frS = v => log ? Math.exp(v) : v;
    const out = h('output', {}, fmtv(p[key]));
    const inp = h('input', { type: 'range', min: toS(min), max: toS(max), step: log ? 0.01 : stepv, value: toS(p[key]), 'aria-label': label });
    inp.addEventListener('input', () => { p[key] = +(+frS(+inp.value)).toFixed(4); if (key === 'pitch') p.pitch = Math.round(p.pitch); out.textContent = fmtv(p[key]); env.replaceChildren(envSvg(p)); if (key === 'pitch') renderPadsMeta(); });
    inp.addEventListener('change', () => trigger(p, audioCtx().currentTime + 0.005));
    return h('label', { class: 'ctl' }, h('span', {}, label), inp, out);
  };
  const ms = v => v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s', hz = v => v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
  el.replaceChildren(
    h('div', { class: 'ed-head' },
      s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
      h('div', {}, h('p', { class: 'ed-role' }, `Pad ${selPad + 1} · ${p.role.name}`), h('h3', {}, s.sp.commonName), h('p', { class: 'ed-sub' }, `${s.sp.scientificName || ''} · ${s.st?.name || ''}${s.st?.country ? ', ' + s.st.country : ''} · ${B().ago(s.t)}${p.tx > 1 ? ' · ultrasonic, slowed ×10' : ''}`)),
      h('div', { class: 'ed-btns' },
        h('button', { class: 'btn ghost sm', onclick: () => swapPad(selPad), title: 'Replace with another sound from this region' }, '↻ Swap'),
        h('button', { class: 'btn ghost sm', 'aria-pressed': p.rev, onclick: e => { p.rev = !p.rev; e.currentTarget.setAttribute('aria-pressed', p.rev); trigger(p, audioCtx().currentTime + 0.005); } }, '⇆ Reverse'))),
    cv,
    h('p', { class: 'hint' }, `${p.onsets.length} transients detected by spectral flux. The highlighted band is the slice; amber shading marks where BirdNET heard the ${LABEL(s.cls).toLowerCase()}. Click anywhere on the waveform to move the slice start (it snaps to the nearest transient).`),
    h('div', { class: 'ed-grid' },
      h('div', {}, h('p', { class: 'lh' }, 'Envelope · ADSR'), env,
        ctl('Attack', 'A', 0.001, 0.5, 0.001, ms, true), ctl('Decay', 'D', 0.005, 2, 0.001, ms, true),
        ctl('Sustain', 'S', 0, 1, 0.01, v => Math.round(v * 100) + '%'), ctl('Release', 'R', 0.005, 2, 0.001, ms, true)),
      h('div', {}, h('p', { class: 'lh' }, 'Tone'),
        ctl('Pitch', 'pitch', -36, 24, 1, v => `${v > 0 ? '+' : ''}${Math.round(v)} st`), ctl('Gain', 'gain', 0, 1.5, 0.01, v => Math.round(v * 100) + '%'),
        ctl('Low cut', 'hp', 20, 12000, 1, hz, true), ctl('High cut', 'lp', 200, 20000, 1, hz, true))),
  );
  const span = Math.min(p.buf.length, Math.round(Math.max(1.6, p.role.max * 1.6) * sr / p.tx)), from = clamp(Math.round(p.t0 * sr - span * 0.25), 0, Math.max(0, p.buf.length - span)), to = from + span;
  const call = s.sc.startTime != null ? [s.sc.startTime * sr, (s.sc.endTime ?? s.sc.startTime + 3) * sr] : null;
  const draw = () => drawWave(cv, p.buf, { from, to, ticks: p.onsets, mark: p.t0 * sr, hl: [p.t0 * sr, p.t0 * sr + p.slice.length], call, color: COL(s.cls) });
  requestAnimationFrame(draw);
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), t = (from + ((e.clientX - r.left) / r.width) * (to - from)) / sr;
    const near = p.onsets.reduce((m, o) => Math.abs(o.t - t) < Math.abs((m?.t ?? 1e9) - t) ? o : m, null);
    p.t0 = near && Math.abs(near.t - t) < 0.08 / p.tx ? near.t : t;
    reslice(p); draw(); renderPadsMeta(); trigger(p, audioCtx().currentTime + 0.005);
  });
}
function renderPadsMeta() {
  document.querySelectorAll('.pad').forEach((b, i) => { const p = pads[i]; b.querySelector('.pad-meta').textContent = `${LABEL(p.snd.cls)}${p.tx > 1 ? ' · ×10 slowed' : ''}${p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${p.pitch} st` : ''}`; drawWave(b.querySelector('.pad-wave'), p.slice, { color: COL(p.snd.cls) }); });
}
function renderSeq() {
  const el = $('seq');
  const cols = [];
  for (let j = 0; j < STEPS; j++) {
    cols.push(h('div', { class: 'col' + (j % 4 === 0 ? ' beat' : '') }, ROLES.map((r, i) => {
      const v = pattern[i][j];
      const b = h('button', { class: 'cell' + (v ? ' on' : ''), style: `--v:${v || 0};--c:${pads[i] ? COL(pads[i].snd.cls) : 'var(--teal)'}`, 'aria-label': `${r.name}, step ${j + 1}${v ? ', on' : ''}`, 'aria-pressed': !!v });
      b.addEventListener('click', e => { pattern[i][j] = pattern[i][j] ? 0 : (e.shiftKey ? 1 : 0.8); renderSeq(); if (pattern[i][j] && pads[i] && !playing) trigger(pads[i], audioCtx().currentTime + 0.005, pattern[i][j]); });
      return b;
    })));
  }
  el.replaceChildren(h('div', { class: 'rows' }, ROLES.map((r, i) => h('span', { title: pads[i]?.snd.sp.commonName || '' }, r.name))), h('div', { class: 'grid' }, cols));
}

// ---------------- library ----------------
let libFilter = 'all', libQuery = '', libSort = 'new', libSel = new Set(), libCut = 'call';
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); paintRowWave(e.target); } }), { root: null, rootMargin: '200px' }) : null;
async function paintRowWave(row) {
  const s = pool.find(x => x.id === row.dataset.id); if (!s) return;
  try { const b = await decode(s), sr = b.sampleRate; drawWave(row.querySelector('canvas'), b, { call: s.sc.startTime != null ? [s.sc.startTime * sr, (s.sc.endTime ?? s.sc.startTime + 3) * sr] : null, color: COL(s.cls) }); row.querySelector('.lib-dur').textContent = b.duration.toFixed(1) + ' s'; } catch { }
}
function libItems() {
  let l = pool.filter(s => (libFilter === 'all' || s.cls === libFilter) && (!libQuery || `${s.sp.commonName} ${s.sp.scientificName} ${s.st?.name} ${s.st?.country}`.toLowerCase().includes(libQuery)));
  l.sort(libSort === 'conf' ? (a, b) => b.conf - a.conf : libSort === 'species' ? (a, b) => a.sp.commonName.localeCompare(b.sp.commonName) : (a, b) => new Date(b.t) - new Date(a.t));
  return l;
}
async function cutBuffer(s, mode = libCut) {
  const b = await decode(s);
  if (mode === 'full' || s.sc.startTime == null) return b;
  const sr = b.sampleRate, a = Math.max(0, Math.round((s.sc.startTime - 0.5) * sr)), e = Math.min(b.length, Math.round(((s.sc.endTime ?? s.sc.startTime + 3) + 0.5) * sr));
  const out = new AudioBuffer({ length: e - a, numberOfChannels: 1, sampleRate: sr }), y = out.getChannelData(0), x = mono(b), f = Math.round(0.01 * sr);
  for (let i = 0; i < y.length; i++) y[i] = x[a + i] * Math.min(1, i / f, (y.length - i) / f);
  return out;
}
async function audition(s, row) {
  stopAudition(); audioCtx();
  const b = await cutBuffer(s, 'call'), src = ctx.createBufferSource();
  src.buffer = b; src.playbackRate.value = 1 / TX(s); src.connect(master); src.start();
  auditionSrc = src; row?.classList.add('playing');
  src.onended = () => { if (auditionSrc === src) stopAudition(); };
}
const fileName = s => `${slug(s.sp.commonName)}_${slug(s.st?.name)}_${s.t.slice(0, 19).replace(/[:T]/g, '-')}${libCut === 'call' ? '_call' : ''}.wav`;
async function downloadOne(s) { save(new Blob([wav(await cutBuffer(s), 24)], { type: 'audio/wav' }), fileName(s)); }
async function downloadSel() {
  const items = pool.filter(s => libSel.has(s.id)); if (!items.length) return;
  const btn = $('libZip'); btn.disabled = true; btn.textContent = 'Packing…';
  const files = (await mapLimit(items, 3, async s => ({ name: fileName(s), data: wav(await cutBuffer(s), 24) }))).filter(Boolean);
  files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(`Biophony sound pack · ${region.label}\n\n${items.map(credit).join('\n')}\n\n${LICENSE}\n`) });
  save(zip(files), `biophony-sounds_${slug(region.label)}.zip`);
  btn.disabled = false; updateSelBtn();
}
function updateSelBtn() { const b = $('libZip'); b.textContent = libSel.size ? `⤓ Download ${libSel.size} as ZIP` : 'Select sounds to pack'; b.disabled = !libSel.size; }
function renderLib() {
  const list = $('libList'), items = libItems();
  const counts = {}; pool.forEach(s => counts[s.cls] = (counts[s.cls] || 0) + 1);
  $('libChips').replaceChildren(...['all', 'bird', 'insect', 'amphibian', 'bat', 'mammal'].filter(c => c === 'all' || counts[c]).map(c => {
    const b = h('button', { class: 'fchip' + (libFilter === c ? ' on' : ''), 'aria-pressed': libFilter === c, style: c === 'all' ? '' : `--c:${COL(c)}` }, c === 'all' ? `All ${pool.length}` : `${LABEL(c)}s ${counts[c]}`);
    b.addEventListener('click', () => { libFilter = c; renderLib(); });
    return b;
  }));
  list.replaceChildren(...items.map(s => {
    const row = h('li', { class: 'lib-row', 'data-id': s.id },
      h('input', { type: 'checkbox', 'aria-label': `Select ${s.sp.commonName}`, checked: libSel.has(s.id) || null, onchange: e => { e.target.checked ? libSel.add(s.id) : libSel.delete(s.id); updateSelBtn(); } }),
      s.sp.thumbnailUrl ? h('img', { src: s.sp.thumbnailUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'ed-ph', style: `--c:${COL(s.cls)}` }),
      h('div', { class: 'lib-name' }, h('b', {}, s.sp.commonName), h('span', {}, h('i', { class: 'gdot', style: `background:${COL(s.cls)}` }), `${LABEL(s.cls)} · ${s.st?.name || ''}${s.st?.country ? ', ' + s.st.country : ''} · ${B().ago(s.t)}${isUltra(s) ? ' · ultrasonic' : ''}`)),
      h('canvas', { class: 'lib-wave' }),
      h('span', { class: 'lib-dur' }, `${s.sc.duration || '?'} s`),
      h('div', { class: 'lib-act' },
        h('button', { class: 'ib', title: 'Play the call', 'aria-label': `Play ${s.sp.commonName}`, onclick: () => audition(s, row) }, '▶'),
        h('button', { class: 'ib', title: `Load onto pad ${selPad + 1} of the kit`, 'aria-label': 'Add to kit', onclick: async () => { if (!pads.length) { $('libMsg').textContent = 'Build a kit first, then load sounds onto pads.'; return; } await swapPad(selPad, s); $('libMsg').textContent = `Loaded onto pad ${selPad + 1} (${pads[selPad].role.name}).`; } }, '＋'),
        h('button', { class: 'ib', title: 'Download WAV', 'aria-label': `Download ${s.sp.commonName}`, onclick: () => downloadOne(s) }, '⤓')));
    io ? io.observe(row) : paintRowWave(row);
    return row;
  }));
  if (!items.length) list.append(h('li', { class: 'empty' }, pool.length ? 'No sounds match.' : 'Loading sounds from this region…'));
  $('libMore').hidden = !poolMore;
  updateSelBtn();
}

// ---------------- field recorder ----------------
let recMics = new Set(), recLen = 30, recResult = null, recSrc = null, recBusy = false;
function renderRec() {
  const el = $('recMics'), { stations, sbiColor } = B();
  const st = region.inView.filter(s => s.bal).sort((a, b) => b.bal.sbi - a.bal.sbi).slice(0, 40);
  const hy = region.hydros;
  const row = (id, name, sub, pill, kind) => {
    const on = recMics.has(id);
    const b = h('button', { class: 'mic' + (on ? ' on' : ''), 'aria-pressed': on },
      h('span', { class: 'mic-ic ' + kind }), h('span', { class: 'mic-n' }, name, h('small', {}, sub)), pill);
    b.addEventListener('click', () => {
      const isH = id.startsWith('h:');
      if (recMics.has(id)) recMics.delete(id);
      else { if ([...recMics].some(x => x.startsWith('h:') !== isH)) recMics.clear(); if (isH) recMics.clear(); if (recMics.size >= 4) return; recMics.add(id); }
      renderRec();
    });
    return b;
  };
  el.replaceChildren(...[
    hy.length ? h('p', { class: 'lh' }, 'Hydrophones · live, records in real time') : null,
    ...hy.map(x => row('h:' + x.id, x.a.name, x.live === false ? 'offline' : 'Orcasound · live stream', h('span', { class: 'pill' + (x.live === false ? ' off' : ' live') }, x.live === false ? 'off' : 'live'), 'hy')),
    h('p', { class: 'lh' }, `Stations · ${st.length ? 'sorted by balance' : 'none with data in view'}`),
    ...st.map(s => row('s:' + s.id, s.name, `${s.state ? s.state + ', ' : ''}${s.country || ''} · ${s.m?.S ?? '?'} species today`, h('span', { class: 'pill', style: `background:${sbiColor(s.bal.sbi)}` }, s.bal.sbi), 'st')),
  ].filter(Boolean));
  const n = recMics.size, hyd = [...recMics].some(x => x.startsWith('h:'));
  $('recSel').textContent = n ? `${n} mic${n > 1 ? 's' : ''} selected${hyd ? ' (live, records in real time)' : n > 1 ? ' · spread across the stereo field' : ''}` : 'Choose up to 4 mics';
  $('recGo').disabled = !n || recBusy;
}
async function stationClips(id) {
  const d = await B().gql(`query($id:ID!){ station(id:$id){ id name country coords{lat lon} detections(first:60, validSoundscape:true){ nodes{ ${FRAG} } } } }`, { id });
  const seen = new Set(), out = [];
  for (const n of d.station?.detections?.nodes || []) { if (!n.soundscape?.url || seen.has(n.soundscape.url)) continue; seen.add(n.soundscape.url); out.push(toSnd(n)); }
  return out;
}
async function buildBed() {
  if (recBusy) return; recBusy = true; renderRec();
  const msg = $('recMsg'), opt = k => $(k).value, chk = k => $(k).checked;
  const L = recLen, xf = +opt('recXf'), fade = +opt('recFade'), stereo = opt('recCh') === '2', bits = +opt('recBits'), loopIt = chk('recLoop'), hp = chk('recHp');
  try {
    const mics = [...recMics];
    let tracks;
    if (mics[0].startsWith('h:')) tracks = [await recordHydro(B().hydros.get(mics[0].slice(2)), L + (loopIt ? xf : 0) + 1.5, msg)];
    else {
      tracks = await Promise.all(mics.map(async (m, k) => {
        const clips = await stationClips(m.slice(2)); msg.textContent = `Gathering audio from ${mics.length} mic${mics.length > 1 ? 's' : ''}…`;
        const need = L + (loopIt ? xf : 0), bufs = []; let tot = 0;
        for (const c of clips) { if (isUltra(c)) continue; try { const b = await decode(c); bufs.push({ b, c }); tot += b.duration - xf; } catch { } if (tot >= need) break; }
        return { bufs, short: tot < need, name: B().stations.get(m.slice(2))?.name };
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
        const { b, c } = tr.bufs[i % tr.bufs.length]; if (i >= tr.bufs.length) tr.repeat = true;
        const src = oc.createBufferSource(); src.buffer = b;
        const g = oc.createGain(), dur = b.duration;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1 / Math.sqrt(tracks.length), t + Math.min(xf, dur / 3));
        g.gain.setValueAtTime(1 / Math.sqrt(tracks.length), t + dur - Math.min(xf, dur / 3)); g.gain.linearRampToValueAtTime(0, t + dur);
        src.connect(g);
        if (stereo) { const p = oc.createStereoPanner(); p.pan.value = clamp(pan + (tracks.length === 1 ? (alt++ % 2 ? 0.25 : -0.25) : 0), -1, 1); g.connect(p); p.connect(bus); } else g.connect(bus);
        src.start(t); if (c) used.push({ c, t, mic: tr.name });
        t += Math.max(0.5, dur - Math.min(xf, dur / 3)); i++;
      }
    });
    let out = await oc.startRendering();
    const N = Math.round(L * sr);
    if (loopIt) { const X = Math.round(xf * sr), res = new AudioBuffer({ length: N, numberOfChannels: out.numberOfChannels, sampleRate: sr });
      for (let c = 0; c < out.numberOfChannels; c++) { const s = out.getChannelData(c), d = res.getChannelData(c); for (let i = 0; i < N; i++) { d[i] = s[i]; if (i < X) { const a = i / X; d[i] = s[i] * Math.sqrt(a) + s[N + i] * Math.sqrt(1 - a); } } }
      out = res; }
    else if (fade) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c), F = Math.round(fade * sr); for (let i = 0; i < Math.min(F, d.length); i++) { d[i] *= i / F; d[d.length - 1 - i] *= i / F; } }
    normalize(out, +opt('recPeak'));
    const short = tracks.some(t => t.repeat);
    recResult = { buf: out, bits, used, short, L, mics: tracks.map(t => t.name).filter(Boolean) };
    showBed();
    msg.textContent = short ? 'Done. Some mics had less fresh audio than the length you asked for, so their clips repeat.' : 'Done.';
  } catch (e) { msg.textContent = 'Could not build the recording: ' + e.message; }
  finally { recBusy = false; renderRec(); }
}
async function recordHydro(hy, secs, msg) {
  if (!hy) throw new Error('hydrophone not found');
  const live = await B().hydroStatus(hy); if (!live) throw new Error('this hydrophone is offline right now');
  audioCtx();
  const el = new Audio(); el.crossOrigin = 'anonymous';
  let hls = null;
  if (window.Hls?.isSupported()) { hls = new Hls({ liveSyncDuration: 20 }); hls.loadSource(hy.url); hls.attachMedia(el); } else el.src = hy.url;
  const src = ctx.createMediaElementSource(el), dest = ctx.createMediaStreamDestination(), mon = ctx.createGain(); mon.gain.value = 0.5;
  src.connect(dest); src.connect(mon); mon.connect(master);
  await el.play();
  const mr = new MediaRecorder(dest.stream), chunks = []; mr.ondataavailable = e => chunks.push(e.data);
  mr.start(500);
  const t0 = performance.now();
  await new Promise(res => { const iv = setInterval(() => { const left = secs - (performance.now() - t0) / 1000; msg.textContent = `Recording ${hy.a.name} live… ${Math.max(0, Math.ceil(left))} s left (you're hearing it)`; if (left <= 0) { clearInterval(iv); res(); } }, 250); });
  await new Promise(res => { mr.onstop = res; mr.stop(); });
  el.pause(); hls?.destroy(); src.disconnect();
  const buf = await ctx.decodeAudioData(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer());
  return { bufs: [{ b: buf, c: null }], name: hy.a.name };
}
function showBed() {
  const r = recResult, el = $('recOut');
  const cv = h('canvas', { class: 'bed-wave' });
  const play = h('button', { class: 'btn' }, '▶ Preview');
  play.addEventListener('click', () => {
    if (recSrc) { try { recSrc.stop(); } catch { } recSrc = null; play.textContent = '▶ Preview'; return; }
    audioCtx(); recSrc = ctx.createBufferSource(); recSrc.buffer = r.buf; recSrc.connect(master); recSrc.start(); play.textContent = '■ Stop';
    recSrc.onended = () => { recSrc = null; play.textContent = '▶ Preview'; };
  });
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

// ---------------- shell ----------------
let built = false, tab = 'kit';
function showStudioTab(t) {
  tab = t;
  document.querySelectorAll('.st-tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.st-pane').forEach(p => { p.hidden = p.id !== 'st-' + t; });
  if (t === 'lib') { renderLib(); if (!pool.length) loadPool().then(renderLib).catch(() => { $('libMsg').textContent = 'Could not load sounds.'; }); }
  if (t === 'rec') renderRec();
  if (t === 'kit') requestAnimationFrame(() => { if (pads.length) { renderPadsMeta(); renderEditor(); } });
}
function openStudio() {
  B().pauseMain();
  const prev = region && region.label;
  captureRegion();
  $('studio').hidden = false; document.body.classList.add('studio-open');
  $('stClose').focus();
  if (!built || prev !== region.label) { built = true; pads = []; candidates = []; libSel.clear(); recMics.clear(); recResult = null; $('recOut').replaceChildren(); $('pads').replaceChildren(); $('editor').replaceChildren(); renderSeq(); buildKit(); }
  showStudioTab(tab);
}
function closeStudio() { togglePlay(false); stopAudition(); if (recSrc) { try { recSrc.stop(); } catch { } recSrc = null; } $('studio').hidden = true; document.body.classList.remove('studio-open'); $('openStudio').focus(); }

$('openStudio').addEventListener('click', openStudio);
$('stClose').addEventListener('click', closeStudio);
$('stRebuild').addEventListener('click', () => { closeStudio(); });
document.querySelectorAll('.st-tab').forEach(b => b.addEventListener('click', () => showStudioTab(b.dataset.t)));
$('kPlay').addEventListener('click', () => togglePlay());
$('kGen').addEventListener('click', () => generate($('kStyle').value));
$('kStyle').addEventListener('change', () => generate($('kStyle').value));
$('kMut').addEventListener('click', mutate);
$('kClear').addEventListener('click', () => { pattern = ROLES.map(() => Array(STEPS).fill(0)); renderSeq(); });
$('kNew').addEventListener('click', () => { pool = []; poolCursor = null; buildKit(); });
$('kBpm').addEventListener('input', e => { bpm = +e.target.value; $('kBpmV').textContent = bpm; });
$('kSwing').addEventListener('input', e => { swing = +e.target.value / 100; $('kSwingV').textContent = e.target.value + '%'; });
$('kKit').addEventListener('click', () => exportKit().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kLoop').addEventListener('click', () => exportLoop().catch(e => { $('kitStatus').textContent = 'Export failed: ' + e.message; }));
$('kMidi').addEventListener('click', () => save(midi(pattern, bpm), `biophony-pattern_${bpm}bpm.mid`));
$('libSearch').addEventListener('input', e => { libQuery = e.target.value.trim().toLowerCase(); renderLib(); });
$('libSort').addEventListener('change', e => { libSort = e.target.value; renderLib(); });
$('libCut').addEventListener('change', e => { libCut = e.target.value; });
$('libZip').addEventListener('click', () => downloadSel());
$('libMore').addEventListener('click', async () => { $('libMore').disabled = true; await loadPool(true).catch(() => {}); $('libMore').disabled = false; renderLib(); });
document.querySelectorAll('#recLens button').forEach(b => b.addEventListener('click', () => { recLen = +b.dataset.s; document.querySelectorAll('#recLens button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); }));
$('recGo').addEventListener('click', buildBed);
document.addEventListener('keydown', e => {
  if ($('studio').hidden) return;
  if (e.key === 'Escape') { closeStudio(); return; }
  if (e.target.closest('input, select, textarea') && e.target.type !== 'range') return;
  if (tab === 'kit' && e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
  const i = ROLES.findIndex(r => r.key === e.key);
  if (tab === 'kit' && i >= 0 && pads[i]) { trigger(pads[i], audioCtx().currentTime + 0.003); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) togglePlay(false); });
