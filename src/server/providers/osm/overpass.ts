import type { BoundingBox, RightsOfWayCollection } from '@/types/domain';
import { fetchJson } from '@/lib/http/fetch-json';
import { ApiError } from '@/lib/http/api-error';
import {
  buildOverpassCorridorQuery,
  buildOverpassQuery,
  overpassRemarkError,
  overpassToFeatureCollection,
  type OverpassResponse,
} from '@/features/rights-of-way/overpass';
import type { RightsOfWayProvider, RightsOfWayQueryOptions } from '@/server/providers/osm/types';

export interface OverpassOptions {
  endpoint: string;
  timeoutMs: number;
  userAgent: string;
}

/**
 * Server-side Overpass adapter. The browser never contacts Overpass directly,
 * and every query is bounded by the requested viewport.
 */
export class OverpassRightsOfWayProvider implements RightsOfWayProvider {
  readonly name = 'overpass';
  readonly isSynthetic = false;

  constructor(private readonly options: OverpassOptions) {}

  /**
   * Corridor query — everything within ~35 m of the supplied routes. Bounded by
   * route length rather than area, so a 100 km loop costs about the same as a
   * 20 km one instead of demanding a ~900 km² bounding box.
   */
  async getFeaturesAlongRoutes(
    routes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    queryOptions: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const coordinates = routes.flat();
    if (coordinates.length === 0) return { type: 'FeatureCollection', features: [] };
    // Corridor queries cover a whole route, so they get a longer allowance than
    // a viewport query — and the fetch timeout is raised to match, otherwise we
    // would abort a query Overpass was still willing to answer.
    const corridorTimeoutMs = Math.max(this.options.timeoutMs, 28_000);
    const query = buildOverpassCorridorQuery(
      coordinates,
      queryOptions.corridorMetres ?? 60,
      Math.floor(corridorTimeoutMs / 1000),
      { includeRoads: queryOptions.includeRoads },
    );
    return this.run(query, queryOptions, corridorTimeoutMs);
  }

  async getFeatures(
    bbox: BoundingBox,
    queryOptions: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const query = buildOverpassQuery(bbox, Math.floor(this.options.timeoutMs / 1000), {
      includeRoads: queryOptions.includeRoads,
    });
    return this.run(query, queryOptions);
  }

  private async run(
    query: string,
    queryOptions: RightsOfWayQueryOptions,
    timeoutMs = this.options.timeoutMs,
  ): Promise<RightsOfWayCollection> {
    const url = this.options.endpoint;
    const response = await fetchJson<OverpassResponse>(url, {
      method: 'POST',
      provider: this.name,
      timeoutMs,
      retries: 1,
      signal: queryOptions.signal,
      allowedHosts: [new URL(url).host],
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.options.userAgent,
      },
      rawBody: `data=${encodeURIComponent(query)}`,
    }).catch((error: unknown) => {
      throw error instanceof ApiError
        ? error
        : new ApiError('UPSTREAM_UNAVAILABLE', 'Overpass request failed.');
    });

    const remark = overpassRemarkError(response);
    if (remark) {
      throw new ApiError(
        'UPSTREAM_TIMEOUT',
        `Overpass could not complete the query in time (${remark}). The route was not checked against mapped path data.`,
      );
    }

    return overpassToFeatureCollection(response, {
      jurisdiction: queryOptions.jurisdiction,
      limit: queryOptions.limit,
    });
  }
}
