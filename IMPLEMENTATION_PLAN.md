# TrailLoop — implementation plan

Status: **all eight phases complete**, except where explicitly noted under “Verification”.

## Phase 1 — Foundation ✅

- Next.js 16 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`, `noImplicitOverride`).
- Tailwind CSS 4, ESLint flat config, Prettier.
- Central environment validation with a public/server split.
- Base layout, landing page, planner shell, MapLibre integration (dynamically imported).
- Docker Compose (PostgreSQL + PostGIS), SQL migrations, migration runner.

## Phase 2 — Domain model and fixture mode ✅

- Domain types: control points, segments, normalised routes, analysis, warnings.
- Provider interfaces for routing, rights of way, geocoding and elevation.
- Deterministic synthetic network (`src/server/providers/fixtures/network.ts`) shared by every fixture provider, so
  fixture routes, fixture path data and fixture elevation describe one coherent world.
- Fixture routing is a real A\* search over that network, not a straight line.

## Phase 3 — Manual planner ✅

- Pure reducer with click-to-add, drag, shaping points, delete, reorder, reverse, close/reopen loop.
- Bounded undo/redo; routing responses never create history entries and stale responses are discarded by version.
- Freehand drawing with controlled sampling and Douglas-Peucker simplification.
- Hybrid routes: routed and freehand sections coexist and export together.

## Phase 4 — Rights-of-way system ✅

- OSM tag model and a pure classification engine with documented precedence.
- England-and-Wales cycling policy, permissive/private/unknown handling, confidence levels with reasons.
- Jurisdiction guard: England-and-Wales law is not applied elsewhere.
- Map overlay (colour _and_ pattern per category), legend, feature inspector, warnings, coverage metrics.

## Phase 5 — Automatic routing ✅

- Seeded anchor generation across five loop patterns with radial/angular jitter and direction control.
- Bounded distance convergence, candidate rejection rules, weighted scoring with stored components.
- Way-id and spatial deduplication; three labelled alternatives (most off-road / balanced / easier).
- Point-to-point and out-and-back (exact or varied return) planning.

## Phase 6 — Live providers ✅

- openrouteservice adapter (profiles, extras → segments, elevation, alternatives, error mapping).
- Overpass adapter with a bounded server-side query; PostGIS adapter for production.
- Nominatim geocoding and Open-Meteo elevation adapters.
- Timeouts, abort signals, bounded retries for transient failures only, host allow-listing, caching, rate limiting.

## Phase 7 — GPX and refinement ✅

- GPX 1.1 generation with escaping, waypoints, per-mode track segments and safe filenames.
- Elevation chart with hover read-out and render-time downsampling.
- Responsive three-pane/stacked layout, dark mode, accessibility pass, `/about/data` and `/privacy`.

## Phase 8 — Verification ⚠️ partially blocked

- 150 unit and integration tests pass (Vitest), covering the access policy, scoring, reducer, GPX, metrics,
  environment validation, provider normalisation and every API route.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm build` pass.
- **Playwright end-to-end specs are written but were not executed in the build environment**: the Chromium download is
  blocked there. Run `pnpm test:e2e:install && pnpm test:e2e` on a machine with normal network access.

## Next engineering priorities

1. Run and stabilise the Playwright suite in CI.
2. Replace Overpass with the PostGIS pipeline described in `docs/OSM_DATA_PIPELINE.md`, plus vector tiles for the overlay.
3. Persist route drafts (local first, then optional accounts).
4. Improve route-to-path matching with map-matching rather than nearest-line heuristics.
5. Shared-store rate limiting and request-level tracing for multi-instance deployments.
