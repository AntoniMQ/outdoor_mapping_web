import type {
  BoundingBox,
  Coordinate,
  RightsOfWayCollection,
  RightsOfWayFeature,
} from '@/types/domain';
import { boundingBoxAreaSqKm, boundingBoxOf, padBoundingBox } from '@/lib/geo/geometry';
import { classifyPath } from '@/features/rights-of-way/access-policy';
import { edgesInBoundingBox } from '@/server/providers/fixtures/network';
import type { RightsOfWayProvider, RightsOfWayQueryOptions } from '@/server/providers/osm/types';

/**
 * Deterministic synthetic rights-of-way features.
 * Geometry, tags and names are invented; no real path is given fabricated
 * legal metadata (all fixture names are explicitly demo names).
 */
export class FixtureRightsOfWayProvider implements RightsOfWayProvider {
  readonly name = 'fixture';
  readonly isSynthetic = true;

  /** The synthetic network is generated on demand, so a padded bbox is cheap. */
  async getFeaturesAlongRoutes(
    routes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    options: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const coordinates = routes.flat() as Coordinate[];
    if (coordinates.length === 0) return { type: 'FeatureCollection', features: [] };
    return this.getFeatures(padBoundingBox(boundingBoxOf(coordinates), 100), options);
  }

  async getFeatures(
    bbox: BoundingBox,
    options: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const limit = options.limit ?? (boundingBoxAreaSqKm(bbox) > 60 ? 1_500 : 2_500);
    const jurisdiction = options.jurisdiction ?? 'england-wales';
    const features: RightsOfWayFeature[] = edgesInBoundingBox(bbox, limit).map((edge) => ({
      type: 'Feature',
      id: `way/${edge.wayId}`,
      geometry: { type: 'LineString', coordinates: edge.coordinates },
      properties: {
        osmType: 'way',
        osmId: edge.wayId,
        tags: edge.tags,
        classification: classifyPath(edge.tags, jurisdiction),
        source: 'fixture',
        sourceUpdatedAt: '2026-01-01T00:00:00Z',
      },
    }));
    return { type: 'FeatureCollection', features };
  }
}
