import { NextResponse } from 'next/server';
import type { Coordinate, NormalisedRoute, NormalisedRouteSegment } from '@/types/domain';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { analyseRequestSchema, readJsonBody } from '@/lib/validation/schemas';
import { boundingBoxOf, lineLengthMetres } from '@/lib/geo/geometry';
import { getElevationProvider } from '@/server/providers/elevation';
import { getRouteAnalysisService } from '@/server/services/route-analysis';
import { getRoutingProvider } from '@/server/providers/routing';
import { readCache, writeCache } from '@/server/repositories/cache-repository';
import { hashString } from '@/lib/geo/random';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vertices per analysis segment. Long chunks span several ways, and a chunk's
 * overall bearing then matches none of them, so everything falls through as
 * unmatched. Short chunks keep each segment on one way.
 */
const ANALYSIS_CHUNK_VERTICES = 8;

const ANALYSIS_CACHE_VERSION = 'v1';
const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Analyses arbitrary geometry — used by the manual editor, including hybrid
 * routes that mix routed and hand-drawn sections.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'routes/analyse'),
      limit: 60,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const body = analyseRequestSchema.parse(await readJsonBody(request));
    const coordinates = body.geometry.coordinates as Coordinate[];

    // Analysing the same geometry twice is pure waste: the three alternatives
    // overlap heavily, and users reselect routes constantly.
    const cacheKey = [
      'analyse',
      ANALYSIS_CACHE_VERSION,
      body.activityProfile,
      body.accessPolicy,
      body.includeElevation ? 'ele' : 'no-ele',
      hashString(
        coordinates
          .filter((_, index) => index % 5 === 0)
          .map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`)
          .join(';'),
      ).toString(36),
    ].join('|');

    if (!body.segments?.length) {
      const cached = await readCache<Record<string, unknown>>(cacheKey);
      if (cached) {
        return NextResponse.json(
          { ...cached.value, cached: true, requestId },
          { headers: { 'x-request-id': requestId } },
        );
      }
    }

    const manualSegmentIndexes: number[] = [...body.manualSegmentIndexes];
    const segments: NormalisedRouteSegment[] = [];
    if (body.segments?.length) {
      body.segments.forEach((segment) => {
        const index = segments.length;
        if (segment.mode === 'freehand') manualSegmentIndexes.push(index);
        segments.push({
          index,
          coordinates: segment.coordinates as Coordinate[],
          distanceMetres: lineLengthMetres(segment.coordinates as Coordinate[]),
        });
      });
    } else {
      // Split long geometry into analysable chunks so warnings can point at sections.
      const chunkSize = ANALYSIS_CHUNK_VERTICES;
      for (let i = 0; i < coordinates.length - 1; i += chunkSize) {
        const slice = coordinates.slice(i, Math.min(coordinates.length, i + chunkSize + 1));
        if (slice.length < 2) continue;
        segments.push({
          index: segments.length,
          coordinates: slice,
          distanceMetres: lineLengthMetres(slice),
        });
      }
    }

    const provider = getRoutingProvider();
    const route: NormalisedRoute = {
      id: `analyse-${requestId}`,
      geometry: body.geometry,
      distanceMetres: lineLengthMetres(coordinates),
      bbox: boundingBoxOf(coordinates),
      segments,
      provider: provider.name,
      warnings: [],
      isSyntheticData: provider.isSynthetic,
    };

    const elevationProvider = body.includeElevation ? getElevationProvider() : null;
    const elevation = elevationProvider
      ? await elevationProvider.getProfile(body.geometry, request.signal).catch(() => undefined)
      : undefined;
    if (elevation) {
      route.ascentMetres = elevation.ascentMetres;
      route.descentMetres = elevation.descentMetres;
    }

    const analysis = await getRouteAnalysisService().analyse(route, {
      activityProfile: body.activityProfile,
      accessPolicy: body.accessPolicy,
      manualSegmentIndexes,
      signal: request.signal,
      requestId,
    });

    const payload = {
      analysis: {
        ...analysis,
        highestPointMetres: elevation?.maxElevationMetres,
        lowestPointMetres: elevation?.minElevationMetres,
      },
      elevation,
      isSyntheticData: provider.isSynthetic,
    };

    // Only cache complete results: a partially analysed route should be retried,
    // not remembered.
    if (!body.segments?.length && analysis.analysed) {
      await writeCache(
        cacheKey,
        'route-analysis',
        ANALYSIS_CACHE_VERSION,
        payload,
        ANALYSIS_CACHE_TTL_MS,
      );
    }

    return NextResponse.json(
      { ...payload, cached: false, requestId },
      {
        headers: { 'x-request-id': requestId },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
