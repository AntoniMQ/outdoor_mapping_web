# Architecture

## Layers

| Layer         | Location                    | Rules                                                                     |
| ------------- | --------------------------- | ------------------------------------------------------------------------- |
| Pages / UI    | `src/app`, `src/components` | May import features, stores and lib. Never imports providers directly.    |
| Domain logic  | `src/features`              | Pure and synchronous where possible. No I/O, no React, fully unit-tested. |
| Server        | `src/server`                | Providers, services, repositories, database. Server-only.                 |
| Cross-cutting | `src/lib`                   | Environment, geometry, HTTP, logging, rate limiting, validation.          |
| State         | `src/stores`                | Zustand stores holding serialisable state only.                           |

The API route handlers in `src/app/api/**` act as a backend-for-frontend: they validate input with Zod, apply rate
limits, call services, and return a consistent error envelope. The browser never talks to an upstream provider
directly, so API keys stay on the server and Overpass/Nominatim usage policies can be honoured centrally.

## Request flow — circular route

```
POST /api/routes/circular
  └── zod validation + rate limit
      └── DefaultCircularRouteGenerator
          ├── generateAnchorCandidates()          seeded, deterministic
          ├── RoutingProvider.route() ×N          bounded concurrency, abortable
          ├── distance convergence                bounded rescale, ≤2 iterations
          ├── RouteAnalysisService.analyse()
          │     ├── RightsOfWayProvider.getFeatures(bbox)
          │     ├── matchRouteToRightsOfWay()      way id → spatial (+bearing test)
          │     └── distance-weighted metrics + warnings
          ├── rejection rules + weighted scoring
          ├── dedupeRoutes()                       way-id then spatial overlap
          └── selectAlternatives()                 most off-road / balanced / easier
      └── ElevationProvider.getProfile() per candidate
```

## Deferred analysis

Routing and analysis have very different costs, so the planner does not force them into one request:

1. `POST /api/routes/circular` with `deferAnalysis: true` returns geometry only — fast and predictable at any distance.
2. The client renders the routes immediately, then calls `POST /api/routes/analyse` once per route.
3. Each analysis gets its own request budget, so a slow path-data lookup degrades one card rather than failing the
   whole generation.
4. Headline labels ("Most off-road", "Balanced", "Easier / lower risk") are applied by
   `features/circular-routing/labels.ts` once analysis lands. Until then the options are numbered, because those
   labels are claims about data nobody has looked at yet.

The same module labels routes when analysis runs inline, so behaviour is identical either way.

## Provider abstraction

Every external dependency is an interface with at least two implementations — a live adapter and a deterministic
fixture:

| Concern       | Interface             | Live                         | Fixture                      |
| ------------- | --------------------- | ---------------------------- | ---------------------------- |
| Routing       | `RoutingProvider`     | `OpenRouteServiceProvider`   | `FixtureRoutingProvider`     |
| Rights of way | `RightsOfWayProvider` | `Overpass…`, `Postgis…`      | `FixtureRightsOfWayProvider` |
| Geocoding     | `GeocodingProvider`   | `NominatimGeocodingProvider` | `FixtureGeocodingProvider`   |
| Elevation     | `ElevationProvider`   | `OpenMeteoElevationProvider` | `FixtureElevationProvider`   |

Adding Valhalla, GraphHopper or a self-hosted engine means writing one adapter that returns `NormalisedRoute`; no UI
code changes.

## The fixture world

`src/server/providers/fixtures/network.ts` defines an infinite lattice of paths as a pure function of integer grid
indices. Tags, names, elevation and way identifiers are all derived deterministically from those indices, so:

- fixture routing, fixture path data and fixture elevation always agree with each other;
- the same request always produces the same route, which makes tests reliable;
- nothing needs to be stored on disk, and no real path is given fabricated legal metadata (fixture names are
  explicitly demo names).

`src/server/providers/fixtures/router.ts` runs A\* over that lattice with access-aware, preference-aware edge costs.

## State management

- **TanStack Query** — server state: rights-of-way viewport queries, with debouncing, cancellation and caching.
- **Zustand** — `planner-store` (mode, preferences, results, overlay toggles) and `editor-store` (undo/redo history).
- **Reducer** — `features/manual-routing/reducer.ts` is pure and independently tested; the store is a thin wrapper.

MapLibre objects live in refs inside `PlannerMap` and never enter application state.

## Error handling

`ApiError` carries a machine-readable code that maps to an HTTP status. Everything returned to the client uses:

```json
{ "error": { "code": "...", "message": "...", "details": {}, "requestId": "..." } }
```

Upstream failures are mapped (`UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`, …) so the UI can distinguish
“try again” from “this will never work”. A routing failure never clears the user’s existing route.
