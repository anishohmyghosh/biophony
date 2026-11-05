# Biophony

A live map of the planet's sound. Free, always-on acoustic monitors stream what they recognise (birds, bats, insects, frogs, mammals, whales), and NASA satellite layers add the view from orbit.

- **Listening:** [BirdWeather](https://www.birdweather.com) public GraphQL API (BirdNET recognitions from 10k+ stations, with audio clips) and [Orcasound](https://www.orcasound.net) live hydrophone streams and detections.
- **From orbit:** NASA EMIT scenes and methane plumes via the CMR search API, plus MODIS NDVI, PACE OCI chlorophyll and VIIRS true colour from NASA GIBS.
- **Readout per site:** species richness, Shannon diversity and evenness over 24 h, plus share of detections by animal group.
- Static site, no build step and no API keys. Run `python3 -m http.server` and open it.

Made by [Anish Ghosh](https://anishohmyghosh.github.io/website/).
