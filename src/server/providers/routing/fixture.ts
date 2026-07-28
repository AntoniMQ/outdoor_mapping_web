import type { NormalisedRoute, NormalisedRouteSegment, Coordinate } from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { boundingBoxOf } from '@/lib/geo/geometry';
import { unitHash } from '@/lib/geo/random';
import { activityDefinition } from '@/features/routing/profiles';
import { routeLeg } from '@/server/providers/fixtures/router';
import type { NetworkEdge } from '@/server/providers/fixtures/network';
import type {
  ProviderHealth,
  ProviderRouteRequest,
  ProviderRouteResult,
  RoutingProvider,
} from '@/server/providers/routing/types';

/**
 * Deterministic routing over the synthetic fixture network.
 * Produces genuinely different geometry for different inputs, but the data is
 * SYNTHETIC and is always flagged as such.
 */
export class FixtureRoutingProvider implements RoutingProvider {
  readonly name = 'fixture';
  readonly isSynthetic = true;

  async route(request: ProviderRouteRequest): Promise<ProviderRouteResult> {
    const wanted = Math.max(1, Math.min(3, request.alternatives ?? 1));
    const routes: NormalisedRoute[] = [];
    const seen = new Set<string>();

    for (let variant = 0; variant < wanted; variant += 1) {
      const route = this.routeOnce({
        ...request,
        variantSeed: (request.variantSeed ?? 0) + variant * 37,
      });
      // Only keep alternatives that are actually different.
      const signature = route.segments
        .map((segment) => segment.osmWayId)
        .filter(Boolean)
        .join(',');
      if (seen.has(signature)) continue;
      seen.add(signature);
      routes.push(route);
    }

    return { provider: this.name, routes };
  }

  private routeOnce(request: ProviderRouteRequest): NormalisedRoute {
    const { coordinates, preferences, variantSeed = 0 } = request;
    if (coordinates.length < 2) {
      throw new ApiError('BAD_REQUEST', 'At least two coordinates are required.');
    }

    const avoid = new Set(request.avoidWayIds ?? []);
    const edgeBias = variantSeed === 0 ? undefined : makeEdgeBias(variantSeed);

    const allCoordinates: Coordinate[] = [];
    const segments: NormalisedRouteSegment[] = [];
    let distanceMetres = 0;
    let ascentMetres = 0;
    let descentMetres = 0;

    for (let i = 1; i < coordinates.length; i += 1) {
      if (request.signal?.aborted)
        throw new ApiError('UPSTREAM_TIMEOUT', 'Route request cancelled.');
      const leg = routeLeg(coordinates[i - 1]!, coordinates[i]!, preferences, {
        edgeBias,
        avoidWayIds: avoid,
      });
      if (!leg) {
        throw new ApiError(
          'NO_ROUTE_FOUND',
          'No route could be found between the selected points.',
        );
      }
      const offset = allCoordinates.length === 0 ? 0 : 1;
      allCoordinates.push(...leg.coordinates.slice(offset));
      for (const segment of leg.segments) {
        segments.push({ ...segment, index: segments.length });
      }
      distanceMetres += leg.distanceMetres;
      ascentMetres += leg.ascentMetres;
      descentMetres += leg.descentMetres;
    }

    const speed = activityDefinition(preferences.activityProfile).baseSpeedMps;
    const route: NormalisedRoute = {
      id: `fixture-${variantSeed}-${unitHash(coordinates[0]![0], coordinates[0]![1], variantSeed, distanceMetres).toFixed(9)}`,
      geometry: { type: 'LineString', coordinates: allCoordinates },
      distanceMetres,
      durationSeconds: distanceMetres / speed + (ascentMetres / 600) * 60,
      ascentMetres,
      descentMetres,
      bbox: boundingBoxOf(allCoordinates),
      segments,
      provider: this.name,
      warnings: [
        {
          code: 'DEMO_DATA',
          severity: 'info',
          message:
            'Demo data — this route was generated from a synthetic network, not live routing or OSM data.',
          affectedDistanceMetres: distanceMetres,
          segmentIndexes: [],
        },
      ],
      isSyntheticData: true,
    };

    return route;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      healthy: true,
      detail: 'Deterministic fixture routing is always available.',
    };
  }
}

function makeEdgeBias(seed: number): (edge: NetworkEdge) => number {
  return (edge) => 0.75 + unitHash(edge.wayId, seed) * 0.7;
}
