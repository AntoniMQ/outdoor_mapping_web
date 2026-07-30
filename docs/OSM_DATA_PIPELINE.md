# OSM data pipeline

## Development default: Overpass

`RIGHTS_OF_WAY_PROVIDER=overpass` issues a bounded query per viewport, server-side only. It is fine for development and
light use, but the public Overpass instances are a shared volunteer resource: do not point production traffic at them.

Mitigations already in place: server-side only, viewport-bounded queries, an area cap, debouncing, request
cancellation, response caching and an identifying `User-Agent` built from `CONTACT_EMAIL`.

## Production: regional extract → PostGIS

1. **Download an extract** (do not import the whole planet, and do not do this as part of normal dev setup):

   ```bash
   curl -O https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf
   ```

2. **Filter to what TrailLoop needs** — this keeps the import small:

   ```bash
   osmium tags-filter england-latest.osm.pbf \
     w/highway=path,footway,bridleway,track,cycleway \
     w/designation \
     -o rights-of-way.osm.pbf
   ```

3. **Import with osm2pgsql** into the PostGIS database created by `drizzle/0000_init.sql`:

   ```bash
   osm2pgsql --create --slim --output=flex --style=scripts/osm2pgsql-trailloop.lua \
     -d "$DATABASE_URL" rights-of-way.osm.pbf
   ```

   The flex style should write into `osm_rights_of_way`, keeping the individual tag columns plus the full `tags_json`
   payload, and setting `source='osm-postgis'`.

4. **Switch the provider**:

   ```
   RIGHTS_OF_WAY_PROVIDER=postgis
   DATABASE_URL=postgresql://…
   ```

   `PostgisRightsOfWayProvider` queries by `geometry && ST_MakeEnvelope(...)`, which uses the GiST index.

5. **Keep it fresh** — apply minutely/daily diffs with `osm2pgsql-replication` or `pyosmium-up-to-date`, then refresh
   any derived tiles. Update `source_updated_at` so the inspector can show a data timestamp.

## Vector tiles (recommended next step)

Serving hundreds of GeoJSON features per viewport is acceptable at city scale but not at national scale. Generate
vector tiles from the same table, e.g. with `ST_AsMVT` behind a `/api/tiles/{z}/{x}/{y}.mvt` route, or pre-render with
`tippecanoe`, and point the overlay layers at the tile source instead of the GeoJSON source. The classification should
be computed at tile-build time and stored as feature properties so styling stays identical.

## Corridor queries

Route analysis does not ask for a bounding box. It asks for everything within ~35 m of the route itself
(`buildOverpassCorridorQuery`, or `ST_DWithin` for the PostGIS provider). This matters at length: a 100 km loop has a
roughly 900 km² bounding box but only a few km² of corridor, so analysis cost scales with route length rather than
with the square of it. The circular generator issues one corridor query covering every candidate.

The map overlay still uses bounding boxes, because it genuinely needs everything in view — and it omits ordinary
roads, which analysis includes.

## Caching and licensing

Cached upstream responses are stored in `provider_cache` with a TTL. Anything derived from OpenStreetMap remains
subject to the ODbL: if you publish a produced work, credit OpenStreetMap contributors; if you distribute a derived
database, share it alike. See `docs/LEGAL_AND_DATA_LIMITATIONS.md`.
