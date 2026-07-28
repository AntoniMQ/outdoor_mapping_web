# TrailLoop

**Plan clearly. Ride confidently.**

TrailLoop is an OpenStreetMap-based outdoor route planner for cycling and hiking in England and Wales. It generates
circular, point-to-point and out-and-back routes, supports manual and freehand planning, and — the part that
distinguishes it — makes public rights of way legible: public footpaths, public bridleways, restricted byways, byways
open to all traffic, permissive paths, and the paths where the access data simply is not there yet.

TrailLoop never claims that OpenStreetMap is legally authoritative. It presents _mapped access information_ with a
confidence level and the reasoning behind it, and says so when data is missing.

## What it does

- **Automatic circular routes** — give a start and a target distance; TrailLoop generates ~24 candidate loops, converges
  them on the requested distance, scores them against your preferences and returns three meaningfully different options.
- **Point-to-point and out-and-back** — with optional via points, and a clear figure for how much of an out-and-back is
  repeated.
- **Manual planning** — click to add waypoints, drag to move them (only adjacent sections re-route), click the line to
  insert a shaping point, reorder, reverse, close the loop, undo and redo.
- **Freehand and hybrid routes** — draw a section by hand, mix it with routed sections, and export the lot.
- **Rights-of-way overlay** — each category drawn with its own colour _and_ line pattern, with a legend and a feature
  inspector that exposes the underlying OSM tags.
- **Route analysis** — distance-weighted percentages for surface, designation and access, plus data-coverage figures and
  structured warnings that point at the affected sections.
- **GPX export** — GPX 1.1 with waypoints, elevation where known, and hand-drawn sections preserved as separate track
  segments.

## Screenshots

_Not yet captured. Run the app locally with `pnpm dev` and open <http://localhost:3000/planner>._

## Architecture at a glance

```
Next.js App Router (React 19, TypeScript strict, Tailwind 4)
├── app/                     pages + API route handlers (backend-for-frontend)
├── components/              map, planner, route editor, results, rights-of-way, UI
├── features/                pure domain logic (access policy, scoring, GPX, reducer)
├── server/
│   ├── providers/           routing · rights of way · geocoding · elevation (+ fixtures)
│   ├── services/            circular generation, planning, analysis, matching
│   ├── repositories/        upstream-response cache
│   └── db/                  Drizzle schema + Postgres client
├── stores/                  Zustand stores (planner + editor history)
└── lib/                     env, geo, http, logging, rate limiting, validation
```

Every provider sits behind an interface with a deterministic fixture implementation, so the whole application runs
without credentials. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 20.11+ (22 recommended)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Optional: Docker, for PostgreSQL + PostGIS

## Installation

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open <http://localhost:3000>. The default configuration is **fixture mode**: no API keys, no external calls for routing
or path data, and a visible “Demo data” banner.

## Environment configuration

All variables are documented in [`.env.example`](.env.example) and validated centrally in `src/lib/env/server.ts`
(server) and `src/lib/env/client.ts` (public). Server-only values never reach the browser.

The important switch is `APP_DATA_MODE`:

| Value     | Behaviour                                                                                  |
| --------- | ------------------------------------------------------------------------------------------ |
| `fixture` | Deterministic synthetic routing, paths, geocoding and elevation. No credentials needed.    |
| `live`    | Uses the configured providers. Any provider missing its credentials falls back to fixture. |

See [docs/PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md) for live setup.

## Docker

```bash
docker compose up -d db          # PostgreSQL 16 + PostGIS 3.4 on :5432
docker compose --profile web up  # optionally run the app in a container too
```

## Database migrations

The app runs without a database (in-memory caching, fixture rights of way). With `DATABASE_URL` set:

```bash
pnpm db:migrate     # applies drizzle/*.sql in order, tracked in _trailloop_migrations
pnpm db:generate    # regenerate SQL from the Drizzle schema after schema changes
pnpm db:studio      # browse the database
```

## Development commands

| Command             | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `pnpm dev`          | Development server                                       |
| `pnpm build`        | Production build                                         |
| `pnpm start`        | Serve the production build                               |
| `pnpm lint`         | ESLint (flat config, `eslint-config-next`)               |
| `pnpm format`       | Prettier write                                           |
| `pnpm format:check` | Prettier check                                           |
| `pnpm typecheck`    | `tsc --noEmit`                                           |
| `pnpm check`        | format:check + lint + typecheck + unit/integration tests |

## Testing

```bash
pnpm test              # Vitest: unit + integration
pnpm test:unit
pnpm test:integration
pnpm test:e2e          # Playwright, against a production build in fixture mode
pnpm test:e2e:install  # one-off: download the Chromium binary
```

End-to-end tests run against `APP_DATA_MODE=fixture` with `NEXT_PUBLIC_MAP_STYLE_URL=offline`, so they need no API keys
and no tile service. Set `E2E_SKIP_BUILD=1` to reuse an existing `pnpm build` output.

## Production build

```bash
pnpm build && pnpm start
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deployment notes, headers and scaling considerations.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database
Licence. Attribution is displayed on the map and in the site footer. Routing, geocoding and elevation providers are
credited on `/about/data`. Read [docs/LEGAL_AND_DATA_LIMITATIONS.md](docs/LEGAL_AND_DATA_LIMITATIONS.md) before
deploying publicly.

## Known limitations

- Fixture mode is synthetic. It exercises every code path but the geometry is not a real place.
- openrouteservice has no dedicated gravel profile; TrailLoop approximates it and says so in the UI.
- Live rights-of-way data comes from Overpass by default, which is unsuitable for production traffic — see
  [docs/OSM_DATA_PIPELINE.md](docs/OSM_DATA_PIPELINE.md) for the PostGIS route.
- Route-to-path matching can be ambiguous where ways run in parallel; those sections are reported as uncertain rather
  than guessed.
- Rate limiting is in-memory, so it is per-instance. Use a shared store for multi-instance deployments.
- Saved route libraries and accounts are deliberately out of scope for this release.
