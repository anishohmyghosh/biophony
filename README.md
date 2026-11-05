# Biophony

A live map of the planet's sound. Free, always-on acoustic monitors stream what they recognise (birds, bats, insects, frogs, mammals, whales), and NASA satellite layers add the view from orbit.

Instead of listing every recognition, Biophony scores each station with a **Soundscape Balance Index** (0–100) built from peer-reviewed diversity metrics: Hill-number diversity scored against stations at similar latitude, Pielou evenness, and taxonomic breadth. It maps the scores as a regional grid with a distribution and region breakdown for whatever is in view. Opening a station adds a site health score that combines the balance index with soundscape indices computed in the browser from the station's audio (NDSI, ADI, acoustic entropy) and the MODIS Vegetation Condition Index. Methods and references are in the About tab.

- **Listening:** [BirdWeather](https://www.birdweather.com) public GraphQL API (BirdNET recognitions from 10k+ stations, with audio clips) and [Orcasound](https://www.orcasound.net) live hydrophone streams and detections.
- **From orbit:** NASA EMIT scenes and methane plumes via the CMR search API, plus MODIS NDVI, PACE OCI chlorophyll and VIIRS true colour from NASA GIBS.
- **Readout per site:** species richness, Shannon diversity and evenness over 24 h, plus share of detections by animal group.
- Static site, no build step and no API keys. Run `python3 -m http.server` and open it.

Made by [Anish Ghosh](https://anishohmyghosh.github.io/website/).
