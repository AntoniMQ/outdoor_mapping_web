# Rights of way

Implementation: `src/features/rights-of-way/access-policy.ts` (pure, heavily unit-tested).

## Five separate concepts

1. **Physical / functional path type** — `highway=*`.
2. **Legal designation** — `designation=*`.
3. **Mode-specific access** — `bicycle`, `foot`, `horse`, `motor_vehicle`, `vehicle`, `access`.
4. **Surface and rideability** — `surface`, `tracktype`, `smoothness`, `width`, `mtb:scale`, `trail_visibility`.
5. **Data confidence** — how much the first four actually tell us.

A way tagged `highway=track` + `designation=public_bridleway` is presented as a **public bridleway** whose physical form
is a track. Legal designation is never inferred from `highway=*` alone.

## Precedence

1. Explicit prohibition — `bicycle=no`, `access=no|private`, `vehicle=no` (unless a mode tag overrides it).
2. Explicit permission — `bicycle=yes|designated|permissive`, `access=permissive`.
3. Legal designation (England and Wales only).
4. Mode-specific tags.
5. Physical `highway=*` fallback.
6. Unknown.

Missing data is never converted into permission.

## England-and-Wales cycling policy

**Normally cycle-compatible unless explicitly restricted**

- `designation=public_bridleway` (Countryside Act 1968 s.30)
- `designation=restricted_byway`
- `designation=byway_open_to_all_traffic`
- explicit `bicycle=yes` / `designated` / `permissive`

**Not confirmed for cycling**

- `designation=public_footpath` without explicit cycling permission
- `highway=footway` without explicit cycling permission
- generic `highway=path` with no usable access information

**Blocked**

- `bicycle=no`, `access=no`, `access=private`, motorways

Permissive access is always reported separately from statutory rights, because permission can be withdrawn.

## Confidence

| Level     | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `high`    | Explicit designation _and_ compatible explicit mode access, or an authoritative local-authority import.   |
| `medium`  | Recognised designation with no contradictory access tags, or explicit bicycle access with no designation. |
| `low`     | Inferred only from the physical highway type.                                                             |
| `unknown` | Insufficient or conflicting tags.                                                                         |

Every assessment carries `reasons: string[]` — the exact sentences shown in the feature inspector.

## Jurisdiction

`Jurisdiction` is inferred from the route’s start coordinate. Outside England and Wales the policy engine:

- exposes the raw tags;
- applies only unambiguous explicit restrictions;
- refuses to interpret `designation=*` legally;
- makes the UI display a jurisdiction note.

Scotland’s statutory access rights differ substantially and are deliberately **not** modelled in this release.

## Visual encoding

Colour _and_ pattern differ per category (`src/features/rights-of-way/styles.ts`), shared by the map, the legend and
the inspector, so nothing depends on colour alone:

| Category                  | Colour | Pattern         |
| ------------------------- | ------ | --------------- |
| Public footpath           | amber  | fine dots       |
| Public bridleway          | blue   | dashes          |
| Restricted byway          | purple | dash-dot        |
| Byway open to all traffic | red    | solid, heavier  |
| Permissive path           | green  | long dashes     |
| Cycleway                  | cyan   | short dashes    |
| Track (status not mapped) | ochre  | even dashes     |
| Unknown access            | grey   | fine dots, thin |

## Overlay behaviour

- Detailed features load only at zoom ≥ 12; below that the map says “Zoom in to display rights-of-way details.”
- Viewport requests are debounced (350 ms) and cancelled when superseded.
- Bounding boxes above `MAX_BBOX_AREA_SQ_KM` (default 400 km²) are rejected with `AREA_TOO_LARGE`.
- Responses are cached server-side on a snapped bounding-box grid key.

## Route matching

1. Tags supplied directly by the routing provider.
2. OSM way identifiers returned by the provider.
3. Spatial matching — nearest line within ~18 m **and** within 42° of the route bearing.

If a second candidate way is within 4 m of the best match, the section is left unmatched rather than being attributed to
a parallel footpath. Match evidence is returned in `debug.match` for troubleshooting.
