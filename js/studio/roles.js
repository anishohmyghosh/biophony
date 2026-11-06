// The 8 kit roles: name, key, MIDI note, target loudness and default envelope/filters.
// lvl = target loudness (RMS dBFS) for each pad so the kit sits as a mix, not 8 pads at full scale.
export const ROLES = [
  { k: 'kick', name: 'Kick', key: '1', note: 36, lvl: -13, A: 0.001, D: 0.22, S: 0, R: 0.05, hp: 20, lp: 1400, max: 0.45, body: 0.6 },
  { k: 'snare', name: 'Snare', key: '2', note: 38, lvl: -18, A: 0.001, D: 0.16, S: 0.1, R: 0.08, hp: 200, lp: 11000, max: 0.45 },
  { k: 'chat', name: 'Closed hat', key: '3', note: 42, lvl: -27, A: 0.001, D: 0.045, S: 0, R: 0.02, hp: 5000, lp: 16000, max: 0.25 },
  { k: 'ohat', name: 'Open hat', key: '4', note: 46, lvl: -28, A: 0.001, D: 0.28, S: 0.2, R: 0.15, hp: 4000, lp: 15000, max: 0.6 },
  { k: 'perc', name: 'Perc', key: '5', note: 37, lvl: -22, A: 0.001, D: 0.12, S: 0, R: 0.05, hp: 250, lp: 12000, max: 0.35 },
  { k: 'low', name: 'Low tom', key: '6', note: 45, ch: 0, tonal: true, lvl: -17, A: 0.004, D: 0.3, S: 0.65, R: 0.14, hp: 30, lp: 5000, max: 0.9, steps: 2 },
  { k: 'lead', name: 'Lead', key: '7', ch: 1, tonal: true, lvl: -21, A: 0.006, D: 0.25, S: 0.55, R: 0.15, hp: 120, lp: 10000, max: 0.7, steps: 1.6 },
  { k: 'crash', name: 'Crash', key: '8', note: 49, lvl: -29, A: 0.004, D: 1.8, S: 0, R: 0.6, hp: 2800, lp: 13000, max: 1.4, gate: 0.05, verb: 0.5, bar4: true },
];
