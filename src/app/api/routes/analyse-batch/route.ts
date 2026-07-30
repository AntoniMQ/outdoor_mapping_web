import { NextResponse } from 'next/server';
import type { Coordinate, NormalisedRoute, RightsOfWayCollection } from '@/types/domain';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId, logger } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { analyseBatchSchema, readJsonBody } from '@/lib/validation/schemas';
import { boundingBoxOf, downsample, lineLengthMetres } from '@/lib/geo/geometry';
import { getElevationProvider } from '@/server/providers/elevation';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import { getRoutingProvider } from '@/server/providers/routing';
import { getRouteAnalysisService } from '@/server/services/route-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vertices per analysis segment. Long chunks span several ways, and a chunk's
 * overall bearing then matches none of them, so everything falls through as
 * unmatched. Short chunks keep each segment on one way.
 */
const ANALYSIS_CHUNK_VERTICES = 8;

/**
 * Analyses several routes with one upstream path-data query.
 *
 * Three alternatives from the same generation cover largely the same ground, so
 * querying separately triples the load on a shared service for no extra
 * information — and is what makes later routes fail while the first succeeds.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'routes/analyse-batch'),
      limit: 30,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const body = analyseBatchSchema.parse(await readJsonBody(request));
    const provider = getRoutingProvider();
    const rightsOfWay = getRightsOfWayProvider();

    const routes: NormalisedRoute[] = body.routes.map((item, index) => {
      const coordinates = item.geometry.coordinates as Coordinate[];
      const chunkSize = ANALYSIS_CHUNK_VERTICES;
      const segments = [];
      for (let i = 0; i < coordinates.length - 1; i += chunkSize) {
        const slice = coordinates.slice(i, Math.min(coordinates.length, i + chunkSize + 1));
        if (slice.length < 2) continue;
        segments.push({
          index: segments.length,
          coordinates: slice,
          distanceMetres: lineLengthMetres(slice),
        });
      }
      return {
        id: item.id || `route-${index}`,
        geometry: item.geometry,
        distanceMetres: lineLengthMetres(coordinates),
        bbox: boundingBoxOf(coordinates),
        segments,
        provider: provider.name,
        warnings: [],
        isSyntheticData: provider.isSynthetic,
      };
    });

    // One corridor covering every route.
    const longest = Math.max(...routes.map((route) => route.distanceMetres));
    const corridorMetres = Math.min(200, Math.max(60, Math.round((longest / 1000) * 3)));
    const pointsPerRoute = Math.min(400, Math.max(40, Math.ceil(longest / (corridorMetres * 2))));

    const features: RightsOfWayCollection | undefined = rightsOfWay.getFeaturesAlongRoutes
      ? await rightsOfWay
          .getFeaturesAlongRoutes(
            routes.map((route) =>
              downsample(route.geometry.coordinates as Coordinate[], pointsPerRoute),
            ),
            {
              signal: request.signal,
              limit: 10_000,
              includeRoads: true,
              corridorMetres,
              requestId,
            },
          )
          .catch((error: unknown) => {
            logger.warn('Shared path-data query failed; routes will be reported as unanalysed', {
              requestId,
              error: (error as Error).message,
            });
            return undefined;
          })
      : undefined;

    const analysisService = getRouteAnalysisService();
    const elevationProvider = body.includeElevation ? getElevationProvider() : null;

    const results = await Promise.all(
      routes.map(async (route) => {
        const elevation = elevationProvider
          ? await elevationProvider
              .getProfile(route.geometry, request.signal)
              .catch(() => undefined)
          : undefined;
        if (elevation) {
          route.ascentMetres = elevation.ascentMetres;
          route.descentMetres = elevation.descentMetres;
        }

        const analysis = await analysisService.analyse(route, {
          activityProfile: body.activityProfile,
          accessPolicy: body.accessPolicy,
          signal: request.signal,
          requestId,
          features,
        });

        return {
          id: route.id,
          analysis: {
            ...analysis,
            highestPointMetres: elevation?.maxElevationMetres,
            lowestPointMetres: elevation?.minElevationMetres,
          },
          elevation,
        };
      }),
    );

    return NextResponse.json(
      { results, isSyntheticData: provider.isSynthetic, requestId },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
