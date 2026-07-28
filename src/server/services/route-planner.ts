import type {
  AnalysedRoute,
  Coordinate,
  NormalisedRoute,
  OutAndBackRequest,
  PointToPointRequest,
} from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { boundingBoxOf, destination, haversineMetres, lineLengthMetres } from '@/lib/geo/geometry';
import { createRng } from '@/lib/geo/random';
import { getRoutingProvider } from '@/server/providers/routing';
import type { RoutingContext } from '@/server/providers/routing/types';
import { getRouteAnalysisService } from '@/server/services/route-analysis';

export interface PlannedRoutes {
  routes: AnalysedRoute[];
  provider: string;
  isSyntheticData: boolean;
}

export async function planPointToPoint(
  request: PointToPointRequest,
  context: RoutingContext,
): Promise<PlannedRoutes> {
  const provider = getRoutingProvider();
  const coordinates: Coordinate[] = [request.start, ...request.via, request.destination];
  const result = await provider.route({
    coordinates,
    preferences: request,
    alternatives: 3,
    signal: context.signal,
    requestId: context.requestId,
  });

  const analysisService = getRouteAnalysisService();
  const routes: AnalysedRoute[] = [];
  for (const route of result.routes) {
    const analysis = await analysisService.analyse(route, {
      activityProfile: request.activityProfile,
      accessPolicy: request.accessPolicy,
      signal: context.signal,
      requestId: context.requestId,
    });
    routes.push({
      route,
      analysis,
      label: routes.length === 0 ? 'Recommended' : `Alternative ${routes.length}`,
    });
  }
  return { routes, provider: result.provider, isSyntheticData: provider.isSynthetic };
}

/**
 * Out-and-back. Either to a chosen destination, or to a turnaround point
 * derived from the target distance. The return leg can optionally be varied
 * where the network allows it.
 */
export async function planOutAndBack(
  request: OutAndBackRequest,
  context: RoutingContext,
): Promise<PlannedRoutes> {
  const provider = getRoutingProvider();
  const analysisService = getRouteAnalysisService();

  const turnaround = request.destination ?? (await findTurnaround(request, context));
  const outbound = await provider.route({
    coordinates: [request.start, turnaround],
    preferences: request,
    signal: context.signal,
    requestId: context.requestId,
  });
  const outboundRoute = outbound.routes[0];
  if (!outboundRoute) throw new ApiError('NO_ROUTE_FOUND', 'No outbound route could be found.');

  let returnRoute: NormalisedRoute | null = null;
  if (request.variedReturn) {
    const avoidWayIds = outboundRoute.segments
      .map((segment) => segment.osmWayId)
      .filter((id): id is number => typeof id === 'number');
    const varied = await provider
      .route({
        coordinates: [turnaround, request.start],
        preferences: request,
        avoidWayIds,
        variantSeed: 7,
        signal: context.signal,
        requestId: context.requestId,
      })
      .catch(() => null);
    returnRoute = varied?.routes[0] ?? null;
  }

  const combined = combineRoutes(outboundRoute, returnRoute);
  const analysis = await analysisService.analyse(combined, {
    activityProfile: request.activityProfile,
    accessPolicy: request.accessPolicy,
    signal: context.signal,
    requestId: context.requestId,
  });

  const repeated = analysis.repeatedPercent;
  const label = returnRoute
    ? `Out and back with varied return — ${repeated.toFixed(0)}% of the distance is repeated`
    : 'Out and back — the return leg retraces the outbound leg exactly';

  return {
    routes: [{ route: combined, analysis, label }],
    provider: outbound.provider,
    isSyntheticData: provider.isSynthetic,
  };
}

/** Search outward for a turnaround point that yields roughly half the target distance. */
async function findTurnaround(
  request: OutAndBackRequest,
  context: RoutingContext,
): Promise<Coordinate> {
  const target = request.targetDistanceMetres;
  if (!target) {
    throw new ApiError('BAD_REQUEST', 'Provide either a destination or a target distance.');
  }
  const provider = getRoutingProvider();
  const rng = createRng(`${request.start.join(',')}:${target}`);
  const bearing = rng() * 360;
  let radius = target / 2 / 1.35;

  let bestPoint = destination(request.start, bearing, radius);
  let bestError = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const point = destination(request.start, bearing, radius);
    const result = await provider
      .route({ coordinates: [request.start, point], preferences: request, signal: context.signal })
      .catch(() => null);
    const route = result?.routes[0];
    if (!route) break;
    const achieved = route.distanceMetres * 2;
    const error = Math.abs(achieved - target) / target;
    if (error < bestError) {
      bestError = error;
      bestPoint = point;
    }
    if (error <= 0.1) break;
    radius *= Math.min(1.6, Math.max(0.6, target / Math.max(1, achieved)));
  }
  return bestPoint;
}

/** Joins the outbound route with a return leg (or its exact reverse). */
export function combineRoutes(
  outbound: NormalisedRoute,
  returnLeg: NormalisedRoute | null,
): NormalisedRoute {
  const outboundCoordinates = outbound.geometry.coordinates as Coordinate[];
  const returnCoordinates: Coordinate[] = returnLeg
    ? (returnLeg.geometry.coordinates as Coordinate[])
    : [...outboundCoordinates].reverse();

  const coordinates = [...outboundCoordinates, ...returnCoordinates.slice(1)];
  const segments = [
    ...outbound.segments,
    ...(returnLeg
      ? returnLeg.segments.map((segment, index) => ({
          ...segment,
          index: outbound.segments.length + index,
        }))
      : [...outbound.segments].reverse().map((segment, index) => ({
          ...segment,
          index: outbound.segments.length + index,
          coordinates: [...segment.coordinates].reverse(),
          ascentMetres: segment.descentMetres,
          descentMetres: segment.ascentMetres,
        }))),
  ];

  const distanceMetres = returnLeg
    ? outbound.distanceMetres + returnLeg.distanceMetres
    : outbound.distanceMetres * 2;

  return {
    ...outbound,
    id: `${outbound.id}-out-and-back`,
    geometry: { type: 'LineString', coordinates },
    distanceMetres: distanceMetres || lineLengthMetres(coordinates),
    durationSeconds: outbound.durationSeconds
      ? outbound.durationSeconds + (returnLeg?.durationSeconds ?? outbound.durationSeconds)
      : undefined,
    ascentMetres:
      (outbound.ascentMetres ?? 0) + (returnLeg?.ascentMetres ?? outbound.descentMetres ?? 0),
    descentMetres:
      (outbound.descentMetres ?? 0) + (returnLeg?.descentMetres ?? outbound.ascentMetres ?? 0),
    bbox: boundingBoxOf(coordinates),
    segments,
  };
}

export function isLoopClosed(coordinates: readonly Coordinate[], toleranceMetres = 150): boolean {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!first || !last) return false;
  return haversineMetres(first, last) <= toleranceMetres;
}
