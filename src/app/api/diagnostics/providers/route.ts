import { NextResponse } from 'next/server';
import type { Coordinate, OsmPathTags } from '@/types/domain';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { destination, downsample, lineLengthMetres } from '@/lib/geo/geometry';
import { defaultPreferences } from '@/features/routing/profiles';
import { costingFor } from '@/server/providers/routing/valhalla';
import { getRoutingProvider } from '@/server/providers/routing';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import { getRouteAnalysisService } from '@/server/services/route-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Read-only end-to-end probe of the live providers.
 *
 * It routes a short loop, asks for the path data around it and analyses the
 * result, reporting raw counts at every stage. The point is to make "why is
 * this route reported as 100% unknown?" a measurement rather than a guess.
 */
export async function GET(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'diagnostics'),
      limit: 10,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const url = new URL(request.url);
    const lon = Number(url.searchParams.get('lon') ?? '-0.5183');
    const lat = Number(url.searchParams.get('lat') ?? '51.6541');
    const activityProfile = (url.searchParams.get('activity') ?? 'mtb') as
      'mtb' | 'gravel' | 'road' | 'hiking';
    const start: Coordinate = [lon, lat];

    const preferences = {
      ...defaultPreferences(activityProfile),
      offRoad: 'maximise' as const,
      surface: 'prefer-unpaved' as const,
    };

    const stages: Record<string, unknown> = {
      config: {
        routing: env.ROUTING_PROVIDER,
        rightsOfWay: env.RIGHTS_OF_WAY_PROVIDER,
        dataMode: env.APP_DATA_MODE,
        commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
      },
      costingSent: costingFor(preferences),
    };

    /* 1. Routing ---------------------------------------------------------- */
    const routingProvider = getRoutingProvider();
    const waypoints: Coordinate[] = [
      start,
      destination(start, 30, 2_500),
      destination(start, 150, 2_500),
      start,
    ];

    let coordinates: Coordinate[] = [];
    try {
      const routed = await routingProvider.route({
        coordinates: waypoints,
        preferences,
        timeoutMs: 20_000,
      });
      const route = routed.routes[0];
      coordinates = (route?.geometry.coordinates ?? []) as Coordinate[];
      stages.routing = {
        provider: routingProvider.name,
        ok: Boolean(route),
        distanceKm: route ? Number((route.distanceMetres / 1000).toFixed(2)) : null,
        points: coordinates.length,
        segments: route?.segments.length ?? 0,
        sampleStreetNames: (route?.segments ?? [])
          .map((segment) => segment.wayType)
          .filter(Boolean)
          .slice(0, 12),
      };
    } catch (error) {
      stages.routing = {
        provider: routingProvider.name,
        ok: false,
        error: (error as Error).message,
      };
    }

    /* 2. Path data -------------------------------------------------------- */
    const rightsOfWay = getRightsOfWayProvider();
    let features: Array<{ tags: OsmPathTags }> = [];
    if (coordinates.length >= 2) {
      try {
        const collection = rightsOfWay.getFeaturesAlongRoutes
          ? await rightsOfWay.getFeaturesAlongRoutes([downsample(coordinates, 120)], {
              includeRoads: true,
              corridorMetres: 60,
              limit: 4_000,
            })
          : { features: [] };
        features = collection.features.map((feature) => ({ tags: feature.properties.tags }));
        const highways: Record<string, number> = {};
        const designations: Record<string, number> = {};
        for (const feature of features) {
          const highway = feature.tags.highway ?? 'none';
          highways[highway] = (highways[highway] ?? 0) + 1;
          if (feature.tags.designation) {
            designations[feature.tags.designation] =
              (designations[feature.tags.designation] ?? 0) + 1;
          }
        }
        stages.pathData = {
          provider: rightsOfWay.name,
          ok: true,
          featureCount: features.length,
          highways,
          designations,
        };
      } catch (error) {
        stages.pathData = {
          provider: rightsOfWay.name,
          ok: false,
          error: (error as Error).message,
        };
      }
    }

    /* 3. Matching --------------------------------------------------------- */
    if (coordinates.length >= 2) {
      try {
        const analysis = await getRouteAnalysisService().analyse(
          {
            id: 'diagnostic',
            geometry: { type: 'LineString', coordinates },
            distanceMetres: 0,
            bbox: [
              Math.min(...coordinates.map((c) => c[0])),
              Math.min(...coordinates.map((c) => c[1])),
              Math.max(...coordinates.map((c) => c[0])),
              Math.max(...coordinates.map((c) => c[1])),
            ],
            segments: chunk(coordinates, 8),
            provider: routingProvider.name,
            warnings: [],
            isSyntheticData: routingProvider.isSynthetic,
          },
          { activityProfile, accessPolicy: 'permit-uncertain', requestId },
        );
        stages.matching = {
          ...analysis.debug.diagnostics,
          offRoadPercent: Number(analysis.surface.offRoadPercent.toFixed(1)),
          confirmedPercent: Number(analysis.access.confirmedPercent.toFixed(1)),
          uncertainPercent: Number(analysis.access.uncertainPercent.toFixed(1)),
        };
      } catch (error) {
        stages.matching = { ok: false, error: (error as Error).message };
      }
    }

    return NextResponse.json({ requestId, ...stages }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

function chunk(coordinates: Coordinate[], size: number) {
  const segments = [];
  for (let i = 0; i < coordinates.length - 1; i += size) {
    const slice = coordinates.slice(i, Math.min(coordinates.length, i + size + 1));
    if (slice.length < 2) continue;
    segments.push({
      index: segments.length,
      coordinates: slice,
      distanceMetres: lineLengthMetres(slice),
    });
  }
  return segments;
}
