# Deployment

## Build and run

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start          # defaults to port 3000
```

The app needs a Node.js runtime: every API route is `runtime = 'nodejs'` because of the geospatial work and the
Postgres client. It is not compatible with a purely static export.

## Required configuration

Minimum for a live deployment:

```
APP_DATA_MODE=live
NEXT_PUBLIC_APP_URL=https://your-domain
NEXT_PUBLIC_MAP_STYLE_URL=https://your-tile-provider/style.json
ROUTING_PROVIDER=openrouteservice
ORS_API_KEY=…
RIGHTS_OF_WAY_PROVIDER=postgis
DATABASE_URL=postgresql://…
CONTACT_EMAIL=you@example.org
```

Then run migrations once: `pnpm db:migrate`.

## Security headers

`next.config.mjs` sets a Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and a
restrictive `Permissions-Policy`. The CSP’s `connect-src` and `worker-src`/`blob:` entries are what MapLibre needs;
`connect-src` is derived from `NEXT_PUBLIC_MAP_STYLE_URL`, so update that variable rather than hand-editing the policy
when you change tile providers.

## Rate limiting

`consumeRateLimit()` is an in-memory token bucket — per instance. For multiple instances, back it with Redis or an
edge rate limiter. Current defaults: circular 12/min, plan 60/min, analyse 60/min, rights of way 90/min, geocoding
30/min, GPX 60/min, per client IP.

## Caching

Provider responses are cached in `provider_cache` (PostgreSQL) with an in-memory front for the reduced mode. Rights of
way are cached for 15 minutes on a snapped bounding-box key; geocoding for 24 hours. Clear the table to force a
refresh after a data import.

## Health checks

`GET /api/health` returns the data mode, the active providers, whether a database is configured and a timestamp. Point
your orchestrator’s liveness probe at it.

## Scaling notes

- Circular generation is the expensive path (up to ~24 upstream routing calls). Consider a queue or a dedicated worker
  if traffic grows, and keep `ROUTE_CANDIDATE_CONCURRENCY` in line with your provider’s limits.
- Serve the rights-of-way overlay from vector tiles rather than GeoJSON once coverage extends beyond a city.
- Logs are structured JSON with request identifiers and redacted secrets; ship them somewhere searchable.

## MapLibre version pin

`maplibre-gl` is pinned to the 5.x line. MapLibre 6 moved the tile-parsing web worker from an inline blob into a
separate module file; when that chunk is not served correctly by the bundler the style still loads (so map attribution
appears) but no tiles are ever parsed, the `load` event never fires and the canvas stays blank. Before moving to 6.x,
verify in a real browser that vector tiles render and that `map.on('load')` fires.

## Docker

`docker-compose.yml` provides PostgreSQL 16 + PostGIS 3.4 for local development, plus an optional `web` profile. It is
a development convenience, not a production image: for production, build a distroless Node image running
`pnpm build && pnpm start` with a read-only filesystem.
