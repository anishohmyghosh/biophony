# Biophony (beta)

A sound discovery globe for ecologists and sound designers. Drop a pin anywhere and Biophony gathers the nearest always-on acoustic monitors (birds, bats, insects, frogs, mammals, whales), checks every recording for noise and silence, and turns the clean ones into a **Field Studio**:

- **Kit**: 8 pads and a 16-step sequencer. Each sound is measured for tonality (how far its strongest spectral peak rises above the rest, its frequency, and how much it wanders) and for transients (spectral-flux onsets, flatness, centroid, attack). Steady calls become a low tom and a lead, retuned into one key chosen to need the least correction, and play generated melodies. Broadband fast-attack sounds become kick, snare, hats and perc; the brightest broadband sound becomes a crash (high-passed, detuned copies, plate reverb, bar 1 of 4). Each pad is levelled to a role loudness through a soft bus (high shelf, glue compressor, limiter). Knobs, a draggable envelope, mute/solo/level per row, drag-to-paint steps and drag-from-library onto pads. Thin areas widen the circle automatically (up to 48 mics). Exports: a ZIP of 24-bit WAVs named by note, with MIDI (drums on ch 10, tuned pads on ch 1–3), settings and credits; a seamless 4-bar loop; the pattern as MIDI. Bat recordings are slowed ×10.
- **Library**: audition and download the recordings from the pin's mics. Each shows an SNR estimate (call band, loud frames inside the detection window against quiet frames outside); near-silent and noisy clips are hidden by default, and everything plays levelled to the same loudness, since many field recorders peak near −50 dBFS.
- **Field recorder**: the mics near the pin, sorted by balance or distance, each with a preview. Pick up to 4 (or a live hydrophone) and render a level-matched, crossfaded ambience bed (15 s–5 min, mono or stereo, 48 kHz 24/16-bit) with a cue sheet.

The globe shows each station's **Soundscape Balance Index** (Hill-number diversity scored against stations at similar latitude, Pielou evenness, taxonomic breadth), as dots or a regional grid. Underlays, dimmed beneath the dots: MODIS land cover (ecosystem type), Anthromes, MODIS NDVI, GEDI canopy height, Black Marble night lights, Human Footprint, VIIRS true colour. Overlays: WDPA protected areas, terrain shading, hydrophones, EMIT methane plumes. The Balance drawer holds the balance breakdown, per-site health (balance + NDSI/ADI/entropy from the station's audio + MODIS Vegetation Condition Index + EMIT scenes) and methods with references.

- **Listening:** [BirdWeather](https://www.birdweather.com) public GraphQL API and [Orcasound](https://www.orcasound.net) live hydrophones.
- **Layers:** NASA GIBS, NASA CMR (EMIT), ORNL DAAC (MODIS), UNEP-WCMC (WDPA), Esri basemaps. Globe by MapLibre GL.
- Static site, no build step and no API keys. Run `python3 -m http.server` and open it.

Live: https://anishohmyghosh.github.io/biophony/

Made by [Anish Ghosh](https://anishohmyghosh.github.io/website/).
