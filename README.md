# Biophony (beta)

A sound discovery globe for ecologists and sound designers. Click anywhere and Biophony gathers the nearest always-on acoustic monitors (birds, bats, insects, frogs, mammals, whales), checks every recording for noise and silence, and turns the clean ones into a **Field Studio**:

- **Kit**: 8 pads and a 16-step sequencer. Each sound is measured for tonality (how far its strongest spectral peak rises above the rest, its frequency, how much it wanders) and for transients (spectral-flux onsets, flatness, centroid, attack). Steady calls become a tuned low tom and lead in one key, chosen to need the least retuning; broadband fast-attack sounds become kick, snare, hats and perc; the brightest wash becomes a crash. Pads are levelled to role loudness through a soft bus. Exports: 24-bit WAVs named by note, MIDI, settings and credits; a seamless 4-bar loop; the pattern as MIDI.
- **Library**: the cleanest recordings first (band SNR: loud frames inside the detection window against quiet frames outside), 10 at a time as you scroll, all played at the same loudness. Many field recorders peak near −50 dBFS.
- **Field recorder**: the mics near the pin, ordered by closeness, balance index and spectral evenness, each with a preview. Stitch up to 4 into a level-matched ambience bed (15 s–5 min, mono or stereo, 48 kHz 24/16-bit) with a cue sheet, or record a hydrophone live.

The globe colours each station by its **Soundscape Balance Index** (Hill-number diversity against stations at similar latitude, Pielou evenness, taxonomic breadth). Underlays: MODIS land cover, Anthromes, NDVI, GEDI canopy height, night lights, Human Footprint, true colour. Overlays: protected areas, terrain, hydrophones, EMIT methane plumes. The **Info** drawer has the balance breakdown, per-site health and methods with references.

Live: https://anishohmyghosh.github.io/biophony/

## Running it

A static site with no build step and no API keys.

```sh
npm start            # python3 -m http.server 8791, then open http://localhost:8791
npm install && npm run lint
```

## Code map

```
index.html            markup; loads MapLibre and hls.js from CDNs, then js/main.js
styles.css            one stylesheet, sectioned: base, header, globe, player, studio, kit, library, recorder, info drawer, responsive
js/
  main.js             entry: loads every module, boots data, polling and visibility handling
  core/
    api.js            BirdWeather GraphQL through a 4-wide queue that honours "retry after N seconds"; JSON fetch
    util.js           DOM builder h(), formatting, distances, taxon labels and colours
    dsp.js            FFT
  globe/
    map.js            MapLibre globe, base map, dimmed underlays and overlays
    metrics.js        Hill numbers, Pielou, coverage, Chao1, the balance index and its colour scale
    stations.js       station loading, per-station metrics (sharded, cached 2 h), dots and regional grid
    pin.js            hover tips, globe clicks, the pin and its nearest mics (Auto, 6, 12, 24, 48)
    hydrophones.js    Orcasound hydrophones, live pulses, network counts
  info/
    drawer.js         the Info drawer
    balance.js        Balance tab
    site.js           Site tab: soundscape indices, MODIS vegetation, EMIT scenes, methane plumes
  player.js           listening bar: tours, playlists, live hydrophones, auto-gain, spectrogram, Safari audio unlock
  studio/
    index.js          Field Studio shell: tabs, pin changes, suggestions, keyboard shortcuts
    audio.js          studio AudioContext, mix bus, the single preview voice behind every ▶
    data.js           recordings from the pin's mics, decoded-audio cache
    analysis.js       quality (SNR, level), tonality, onsets, slicing, features
    music.js          keys, scales, tuning
    roles.js          the 8 kit roles
    kit.js            choosing sounds for roles, levelling, playing a pad
    sequencer.js      16 steps, styles, generation
    kit-view.js       pads, sound details, key selector, sequencer grid
    widgets.js        waveforms, knobs, envelope editor, output meter
    export.js         WAV, ZIP and MIDI writers, kit and loop export
    library.js        Library tab
    recorder.js       Field recorder tab
```

Modules talk through imports, plus a few window events for loosely coupled moments: `biophony:pin` (a new pin), `biophony:data` (station scores updated), `biophony:mainplay` (the listening bar started, so studio audio stops) and `biophony:ratelimit` (show a countdown).

## Data

[BirdWeather](https://www.birdweather.com) GraphQL API (BirdNET recognitions with audio from 10k+ stations), [Orcasound](https://www.orcasound.net) hydrophones, NASA GIBS, NASA CMR (EMIT), ORNL DAAC (MODIS), UNEP-WCMC (WDPA) and Esri basemaps. Recordings belong to the station owners: exports include credits, and commercial use needs their permission.

Made by [Anish Ghosh](https://anishohmyghosh.github.io/website/).
