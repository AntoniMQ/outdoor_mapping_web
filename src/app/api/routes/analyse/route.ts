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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      const chunkSize = 25;
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

    return NextResponse.json(
      {
        analysis: {
          ...analysis,
          highestPointMetres: elevation?.maxElevationMetres,
          lowestPointMetres: elevation?.minElevationMetres,
        },
        elevation,
        isSyntheticData: provider.isSynthetic,
        requestId,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
