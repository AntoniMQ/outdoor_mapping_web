# Routing

## Providers

| Provider           | Credentials | Notes                                                                                                     |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `valhalla`         | none        | Recommended for a fully live deployment. Profiles map exactly; no way ids, so analysis matches spatially. |
| `openrouteservice` | API key     | Returns surface/waytype extras, so segment attribution is richer. Gravel is approximated.                 |
| `fixture`          | none        | Deterministic synthetic A* over a generated lattice. Demo and tests only.                                 |

## Activity profiles

| TrailLoop | openrouteservice profile | Notes                                                                                                                                  |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mtb`     | `cycling-mountain`       | Off-road biased costs.                                                                                                                 |
| `gravel`  | `cycling-regular`        | **Approximation.** ORS has no gravel profile; TrailLoop adds an unpaved surface preference and surfaces this caveat in the planner UI. |
| `road`    | `cycling-road`           | Sealed surfaces preferred, unpaved heavily penalised.                                                                                  |
| `hiking`  | `foot-hiking`            | Walking access rules apply, footpaths are usable.                                                                                      |

Mapping lives in `src/features/routing/profiles.ts`. Provider names appear nowhere else in the codebase.

## Cost model

`wayCostMultiplier(tags, preferences)` returns a relative multiplier used by the fixture router and by scoring:

- profile bias (road prefers sealed, MTB prefers tracks and paths, hiking prefers non-carriageways);
- high-stress roads (motorway/trunk/primary) heavily penalised for non-road profiles;
- surface preference, off-road preference;
- `mtb:scale` weighted by the technicality preference;
- `incline` weighted by the climbing preference.

## Normalised route

Every provider returns the same shape (`NormalisedRoute`): geometry, distance, duration, ascent/descent, bbox,
segments, provider name, warnings and an `isSyntheticData` flag. Provider-specific metadata stays outside the domain
model.

openrouteservice `extras` (surface, waytype, steepness) are converted into segments by cutting the geometry at every
extras boundary, so surface and way-type percentages are distance-weighted rather than per-request averages.

## Point-to-point

`POST /api/routes/plan` with `type: "point-to-point"`, a start, a destination and optional via points. Alternatives are
requested from the provider when only two coordinates are supplied (an ORS constraint).

## Out-and-back

`type: "out-and-back"`. Either a destination or a target distance is required. Without a destination, TrailLoop
searches outward along a seeded bearing for a turnaround point that yields roughly half the target, then either
retraces the outbound leg exactly or asks the provider for a return leg that avoids the outbound way ids. The label and
the summary always state how much of the route is repeated.

## Manual routing

The manual editor routes one segment at a time through the same endpoint. Each segment carries a monotonically
increasing `version`; responses whose version no longer matches are discarded, which is what makes rapid dragging safe.

## Reliability

- Timeouts on every outbound request (`UPSTREAM_TIMEOUT_MS`, default 15 s).
- `AbortController` throughout; a cancelled browser request cancels the upstream work.
- Retries only for transient failures (timeouts, 408/425/429/5xx) with bounded exponential backoff. Invalid input and
  “no route found” are never retried.
- Outbound hosts are allow-listed from the configured base URLs (SSRF guard).
- Candidate generation runs with bounded concurrency (`ROUTE_CANDIDATE_CONCURRENCY`, default 4).
