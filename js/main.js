// Entry point: boots data loading, polling and the studio.
import { $ } from './core/util.js';
import { loadCounts, loadHydros, pollPulses } from './globe/hydrophones.js';
import { CACHE_MS, analyseAll, lastRun, loadCache, loadStations, scheduleRefresh } from './globe/stations.js';
import { audio } from './player.js';
// Modules that only wire up UI when loaded:
import './globe/pin.js';
import './info/drawer.js';
import './info/balance.js';
import './info/site.js';
import './studio/index.js';

const timers = [];
function setLive(ok) { $('liveDot').classList.toggle('on', ok); $('liveText').textContent = ok ? 'live' : 'reconnecting…'; }
function startPolling() {
  stopPolling();
  timers.push(setInterval(() => pollPulses().then(() => setLive(true)).catch(() => setLive(false)), 20000));
  timers.push(setInterval(() => loadCounts().catch(() => {}), 60000));
  timers.push(setInterval(() => { if (Date.now() - lastRun > CACHE_MS) analyseAll(); }, 60000));
}
function stopPolling() { timers.splice(0).forEach(clearInterval); }
let resumeAudio = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPolling(); resumeAudio = !audio.paused; if (resumeAudio) audio.pause(); }
  else { startPolling(); if (resumeAudio) { resumeAudio = false; audio.play().catch(() => {}); } }
});

// Boot: counts, hydrophones and pulses straight away; station scores from cache if fresh.
(async () => {
  loadCounts().then(scheduleRefresh).catch(() => {});
  loadHydros().catch(() => {});
  pollPulses().then(() => setLive(true)).catch(() => setLive(false));
  startPolling();
  if (loadCache()) scheduleRefresh();
  else { analyseAll(); scheduleRefresh(); loadStations().then(scheduleRefresh).catch(() => {}); }
})();
