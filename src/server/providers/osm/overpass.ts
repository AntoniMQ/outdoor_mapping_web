import type { BoundingBox, RightsOfWayCollection } from '@/types/domain';
import { fetchJson } from '@/lib/http/fetch-json';
import { ApiError } from '@/lib/http/api-error';
import {
  buildOverpassQuery,
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

  async getFeatures(
    bbox: BoundingBox,
    queryOptions: RightsOfWayQueryOptions = {},
  ): Promise<RightsOfWayCollection> {
    const query = buildOverpassQuery(bbox, Math.floor(this.options.timeoutMs / 1000));
    const url = this.options.endpoint;
    const response = await fetchJson<OverpassResponse>(url, {
      method: 'POST',
      provider: this.name,
      timeoutMs: this.options.timeoutMs,
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

    return overpassToFeatureCollection(response, {
      jurisdiction: queryOptions.jurisdiction,
      limit: queryOptions.limit,
    });
  }
}
