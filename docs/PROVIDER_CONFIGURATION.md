# Provider configuration

Set `APP_DATA_MODE=live` first — in `fixture` mode every provider is forced to its deterministic adapter so synthetic
data can never be mistaken for live data.

If a live provider is selected but its credentials are missing, TrailLoop falls back to the fixture adapter rather than
failing to boot, and the demo banner stays visible.

## Routing — openrouteservice

```
ROUTING_PROVIDER=openrouteservice
ORS_API_KEY=…            # server-only, never exposed to the browser
ORS_BASE_URL=https://api.openrouteservice.org
```

Free keys are rate-limited (roughly 40 requests/minute at the time of writing). Circular generation issues up to ~24
routing requests per attempt, so either lower `ROUTE_CANDIDATE_CONCURRENCY`, self-host ORS, or expect throttling.
`/api/health` reports which provider is active.

## Rights of way — Overpass or PostGIS

```
RIGHTS_OF_WAY_PROVIDER=overpass
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
CONTACT_EMAIL=you@example.org     # used in the User-Agent, as the usage policy requires
```

or, for production:

```
RIGHTS_OF_WAY_PROVIDER=postgis
DATABASE_URL=postgresql://…
```

See `docs/OSM_DATA_PIPELINE.md`.

## Geocoding — Nominatim

```
GEOCODING_PROVIDER=nominatim
GEOCODING_BASE_URL=https://nominatim.openstreetmap.org
```

The public instance requires an identifying `User-Agent`, forbids autocomplete-style per-keystroke queries and expects
caching. TrailLoop submits searches explicitly, caches results for 24 hours and rate-limits the endpoint. For anything
beyond light use, self-host Nominatim or use a commercial geocoder behind the same interface.

## Elevation — Open-Meteo

```
ELEVATION_PROVIDER=open-meteo
ELEVATION_BASE_URL=https://api.open-meteo.com
```

Requests are batched 100 coordinates at a time and the geometry is downsampled to at most 300 points. Set
`ELEVATION_PROVIDER=none` to disable elevation entirely; the app degrades gracefully and reports “Not available”.

## Basemap

```
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

Any MapLibre style URL works. Use `offline` for a blank local style (tests, air-gapped demos). If your tile provider
requires a browser token, the style URL is the only place it belongs — and the Content-Security-Policy in
`next.config.mjs` derives its `connect-src` from this value, so update it when you change providers.

Do not use the public OpenStreetMap raster tile service as production infrastructure.

## Adding a new provider

1. Implement the relevant interface in `src/server/providers/<concern>/`.
2. Return the normalised domain type — never leak provider-specific shapes upward.
3. Register it in that folder’s `index.ts` factory and extend the enum in `src/lib/env/server.ts`.
4. Add an integration test that mocks `fetch` and asserts normalisation plus error mapping.
