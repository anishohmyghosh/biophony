// WAV, ZIP and MIDI writers and the kit/loop exports.
import { $, h } from '../core/util.js';
import { bus } from './audio.js';
import { isUltra, region } from './data.js';
import { pads, trigger } from './kit.js';
import { ROLES } from './roles.js';
import { key, semis } from './music.js';
import { STEPS, bpm, notes, pattern, scheduleStep, stepDur, swing } from './sequencer.js';
import { NOTE, clamp, noteName } from './util.js';

export function wav(buffer, bits = 24) {
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
export function zip(files) {     // store-only ZIP; files: [{name, data: Uint8Array}]
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
// Drums on channel 10 (GM notes); tuned pads on channels 1–3 at the pitch they actually sound.
export function midi(pat, tempo) {
  const evs = [];
  pat.forEach((row, i) => row.forEach((v, j) => {
    if (!v) return;
    const r = ROLES[i], p = pads[i];
    const n = r.tonal ? clamp(Math.round(p && p.m0 != null ? p.m0 + semis(p, notes[i][j]) : 60 + notes[i][j] * 2), 0, 127) : r.note, ch = r.tonal ? r.ch : 9;
    const len = r.tonal ? Math.round(24 * (r.steps || 2)) - 2 : 12;
    evs.push([j * 24, 0x90 | ch, n, Math.round(v * 127)]); evs.push([j * 24 + len, 0x80 | ch, n, 0]);
  }));
  evs.sort((a, b) => a[0] - b[0] || ((a[1] & 0xf0) === 0x80 ? -1 : 1));
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const us = Math.round(60e6 / tempo), trk = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  let last = 0; for (const [t, s, n, v] of evs) { trk.push(...vlq(t - last), s, n, v); last = t; }
  trk.push(...vlq(Math.max(0, STEPS * 24 - last)), 0xff, 0x2f, 0);
  const hd = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96], th = [0x4d, 0x54, 0x72, 0x6b, (trk.length >>> 24) & 255, (trk.length >> 16) & 255, (trk.length >> 8) & 255, trk.length & 255];
  return new Blob([new Uint8Array([...hd, ...th, ...trk])], { type: 'audio/midi' });
}
export function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
export const slug = s => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'sound';
export const credit = s => `${s.sp.commonName} (${s.sp.scientificName || ''}) · ${s.st?.name || 'station'}${s.st?.country ? ', ' + s.st.country : ''} · ${new Date(s.t).toISOString()} · BirdNET ${Math.round((s.conf || 0) * 100)}%${isUltra(s) ? ' · ultrasonic, ' + s.sc.sampleRate + ' Hz' : ''} · ${s.sc.url}`;
export const LICENSE = 'Recordings come from BirdWeather stations run by members of the public (app.birdweather.com), recognised by BirdNET. Credit the station and BirdWeather. Check BirdWeather\'s terms and contact the station owner before commercial use. Species labels are automated and can be wrong.';
export function normalize(buf, peakDb = -1) { let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) pk = Math.max(pk, Math.abs(v)); const g = pk ? 10 ** (peakDb / 20) / pk : 1; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } return buf; }
async function renderOneShot(p) {
  const playDur = p.slice.duration * p.tx / 2 ** (semis(p) / 12), gate = p.role.gate ?? (p.S > 0 ? Math.min(playDur, 0.6) : p.A + p.D);
  const len = (p.role.verb ? Math.max(2.4, p.D * 1.6) : Math.min(Math.max(playDur, p.body ? 0.2 : 0), p.S > 0 ? Math.max(gate, p.A + p.D) + p.R : p.A + p.D * 1.6)) + 0.05, oc = new OfflineAudioContext(1, Math.ceil(len * 48000), 48000);
  trigger(p, 0, 1, gate, oc, oc.destination);
  return normalize(await oc.startRendering(), -1);
}
export async function exportKit() {
  if (!pads.length) return;
  const st = $('kitStatus'); st.textContent = 'Rendering kit…';
  const files = [];
  for (const [i, p] of pads.entries()) files.push({ name: `${String(i + 1).padStart(2, '0')}_${p.role.name.replace(/\s/g, '-')}${p.m0 != null ? '_' + noteName(p.m0 + semis(p)).replace('♯', 's').replace('♭', 'b') : ''}_${slug(p.snd.sp.commonName)}.wav`, data: wav(await renderOneShot(p), 24) });
  files.push({ name: 'pattern.mid', data: new Uint8Array(await midi(pattern, bpm).arrayBuffer()) });
  files.push({ name: 'kit.json', data: new TextEncoder().encode(JSON.stringify({ place: region.label, pin: [region.lat, region.lon], key: `${NOTE[key.root]} ${key.scale}`, bpm, swing, pattern, notes, pads: pads.map(p => ({ role: p.role.name, species: p.snd.sp.commonName, scientific: p.snd.sp.scientificName, station: p.snd.st?.name, onset: +p.t0.toFixed(3), sourcePitchHz: p.m0 != null ? +p.ins.tonal.f0.toFixed(1) : null, playsAs: p.m0 != null ? noteName(p.m0 + semis(p)) : null, transpose: +semis(p).toFixed(2), snrDb: +p.ins.snr.toFixed(1), A: p.A, D: p.D, S: p.S, R: p.R, hp: p.hp, lp: p.lp, body: p.body || 0, reverse: p.rev, timeExpansion: p.tx, source: p.snd.sc.url })) }, null, 2)) });
  files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(`Biophony field kit · ${region.label} · ${NOTE[key.root]} ${key.scale}\n\n${pads.map((p, i) => `${i + 1}. ${p.role.name}: ${credit(p.snd)}`).join('\n')}\n\nThe kick includes a short tuned sine layer under the recorded transient (set "Body" to 0 to remove it).\n\n${LICENSE}\n`) });
  save(zip(files), `biophony-kit_${slug(region.label)}.zip`);
  st.textContent = 'Kit downloaded: 8 one-shots (24-bit WAV, tuned pads named by note), the pattern as MIDI, settings and credits.';
}
export async function exportLoop(bars = 4) {
  if (!pads.length) return;
  const sd = stepDur(), len = bars * STEPS * sd + 3, oc = new OfflineAudioContext(2, Math.ceil(len * 48000), 48000);
  const mb = bus(oc, oc.destination);
  for (let b = 0; b < bars; b++) for (let j = 0; j < STEPS; j++) scheduleStep(j, (b * STEPS + j) * sd + (j % 2 ? swing * sd : 0), b, oc, mb);
  const out = normalize(await oc.startRendering(), -1);
  const L = Math.round(bars * STEPS * sd * 48000), loop = new AudioBuffer({ length: L, numberOfChannels: 2, sampleRate: 48000 });
  for (let c = 0; c < 2; c++) { const s = out.getChannelData(c), d = loop.getChannelData(c); for (let i = 0; i < L; i++) d[i] = s[i] + (i + L < s.length ? s[i + L] : 0); }
  save(new Blob([wav(normalize(loop, -1), 24)], { type: 'audio/wav' }), `biophony-loop_${bpm}bpm_${NOTE[key.root].replace('♯', 's').replace('♭', 'b')}_${slug($('kStyle').value)}.wav`);
}
