# Biophony

A live map of the planet's sound. Free, always-on acoustic monitors stream what they recognise (birds, bats, insects, frogs, mammals, whales), and NASA satellite layers add the view from orbit.

Instead of listing every recognition, Biophony scores each station with a **Soundscape Balance Index** (0–100) built from peer-reviewed diversity metrics: Hill-number diversity scored against stations at similar latitude, Pielou evenness, and taxonomic breadth. It maps the scores as a regional grid with a distribution and region breakdown for whatever is in view. Opening a station adds a site health score that combines the balance index with soundscape indices computed in the browser from the station's audio (NDSI, ADI, acoustic entropy) and the MODIS Vegetation Condition Index. Methods and references are in the About tab.

**Field Studio** (experiment) turns the region in view into a sound toolkit:

- **Kit**: picks 8 species' recordings, finds transients by spectral-flux onset detection, slices one-shots, assigns drum roles by spectral centroid and flatness, and applies per-pad ADSR, pitch and filters. A 16-step sequencer has generated patterns (house, boom bap, breakbeat, techno, dembow, a Euclidean "dawn chorus"). It exports the kit as a ZIP of 24-bit WAVs with MIDI, settings and credits, a seamless 4-bar loop, or the pattern as MIDI. Bat recordings are slowed ×10 (time expansion).
- **Library**: search, filter, audition and download every recognised recording in the region, singly or as a ZIP with credits.
- **Field recorder**: choose up to 4 station mics (or a live hydrophone) and a length from 15 s to 5 min, and render a crossfaded mono or stereo ambience bed (48 kHz, 24/16-bit, rumble cut, fades, seamless loop) with a cue sheet.

- **Listening:** [BirdWeather](https://www.birdweather.com) public GraphQL API (BirdNET recognitions from 10k+ stations, with audio clips) and [Orcasound](https://www.orcasound.net) live hydrophone streams and detections.
- **From orbit:** NASA EMIT scenes and methane plumes via the CMR search API, plus MODIS NDVI, PACE OCI chlorophyll and VIIRS true colour from NASA GIBS.
- **Readout per site:** species richness, Shannon diversity and evenness over 24 h, plus share of detections by animal group.
- Static site, no build step and no API keys. Run `python3 -m http.server` and open it.

Made by [Anish Ghosh](https://anishohmyghosh.github.io/website/).
