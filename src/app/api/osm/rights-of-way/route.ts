import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env/server';
import { ApiError, errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { rightsOfWayQuerySchema } from '@/lib/validation/schemas';
import { boundingBoxAreaSqKm } from '@/lib/geo/geometry';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import { boundingBoxCacheKey, readCache, writeCache } from '@/server/repositories/cache-repository';
import type { RightsOfWayCollection } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const MIN_ZOOM = 12;
const CACHE_TTL_MS = 15 * 60 * 1000;
const QUERY_VERSION = 'v1';

export async function GET(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'osm/rights-of-way'),
      limit: 90,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const url = new URL(request.url);
    const query = rightsOfWayQuerySchema.parse(Object.fromEntries(url.searchParams));

    if (query.zoom !== undefined && query.zoom < MIN_ZOOM) {
      return NextResponse.json(
        {
          type: 'FeatureCollection',
          features: [],
          meta: { zoomTooLow: true, minZoom: MIN_ZOOM, requestId },
        },
        { headers: { 'x-request-id': requestId } },
      );
    }

    const area = boundingBoxAreaSqKm(query.bbox);
    if (area > env.MAX_BBOX_AREA_SQ_KM) {
      throw new ApiError(
        'AREA_TOO_LARGE',
        `The requested area is ${Math.round(area)} km², which exceeds the ${env.MAX_BBOX_AREA_SQ_KM} km² limit. Zoom in further.`,
      );
    }

    const provider = getRightsOfWayProvider();
    const cacheKey = boundingBoxCacheKey(provider.name, QUERY_VERSION, query.bbox, [
      query.jurisdiction ?? 'england-wales',
    ]);

    const cached = await readCache<RightsOfWayCollection>(cacheKey, CACHE_TTL_MS / 3);
    if (cached && !cached.stale) {
      return NextResponse.json(
        {
          ...cached.value,
          meta: {
            cached: true,
            provider: provider.name,
            isSyntheticData: provider.isSynthetic,
            requestId,
          },
        },
        { headers: { 'x-request-id': requestId, 'cache-control': 'private, max-age=60' } },
      );
    }

    const collection = await provider.getFeatures(query.bbox, {
      jurisdiction: query.jurisdiction,
      limit: query.limit,
      signal: request.signal,
      requestId,
    });

    await writeCache(cacheKey, provider.name, QUERY_VERSION, collection, CACHE_TTL_MS);

    return NextResponse.json(
      {
        ...collection,
        meta: {
          cached: false,
          provider: provider.name,
          isSyntheticData: provider.isSynthetic,
          featureCount: collection.features.length,
          requestId,
        },
      },
      { headers: { 'x-request-id': requestId, 'cache-control': 'private, max-age=60' } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
