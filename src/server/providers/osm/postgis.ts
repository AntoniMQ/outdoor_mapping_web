import type {
  BoundingBox,
  OsmPathTags,
  RightsOfWayCollection,
  RightsOfWayFeature,
} from '@/types/domain';
import { classifyPath } from '@/features/rights-of-way/access-policy';
import { getSql } from '@/server/db/client';
import { ApiError } from '@/lib/http/api-error';
import type { RightsOfWayProvider, RightsOfWayQueryOptions } from '@/server/providers/osm/types';

interface Row {
  osm_id: string;
  osm_type: string;
  geometry: string;
  tags_json: OsmPathTags;
  source: string;
  source_updated_at: string | null;
}

/**
 * Reads pre-imported OSM data from PostGIS (see docs/OSM_DATA_PIPELINE.md).
 * This is the recommended production path: it removes the dependency on the
 * public Overpass instances entirely.
 */
export class PostgisRightsOfWayProvider implements RightsOfWayProvider {
  readonly name = 'postgis';
  readonly isSynthetic = false;

  async getFeatures(
    bbox: BoundingBox,
    options: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const sql = getSql();
    if (!sql) {
      throw new ApiError(
        'NOT_CONFIGURED',
        'DATABASE_URL is not configured for the PostGIS provider.',
      );
    }
    const limit = options.limit ?? 3_000;
    const rows = (await sql`
      select osm_id, osm_type, st_asgeojson(geometry) as geometry, tags_json, source, source_updated_at
      from osm_rights_of_way
      where geometry && st_makeenvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
      limit ${limit}
    `) as unknown as Row[];

    return this.toCollection(rows, options);
  }

  private toCollection(rows: Row[], options: RightsOfWayQueryOptions): RightsOfWayCollection {
    const features: RightsOfWayFeature[] = rows.map((row) => {
      const tags = row.tags_json ?? {};
      const geometry = JSON.parse(row.geometry) as {
        type: 'LineString';
        coordinates: [number, number][];
      };
      return {
        type: 'Feature',
        id: `${row.osm_type}/${row.osm_id}`,
        geometry,
        properties: {
          osmType: row.osm_type === 'relation' ? 'relation' : 'way',
          osmId: Number(row.osm_id),
          tags,
          classification: classifyPath(tags, options.jurisdiction ?? 'england-wales'),
          source: 'osm-postgis',
          sourceUpdatedAt: row.source_updated_at ?? undefined,
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }
}
