import type {
  AnalysedRoute,
  CandidateLabelKey,
  CircularRouteRequest,
  Coordinate,
  NormalisedRoute,
  RouteScoreComponents,
} from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { mapWithConcurrency } from '@/lib/http/fetch-json';
import { logger } from '@/lib/logging/logger';
import { haversineMetres } from '@/lib/geo/geometry';
import {
  generateAnchorCandidates,
  rescaleCandidate,
  type AnchorCandidate,
} from '@/features/circular-routing/anchors';
import {
  accessConfidenceScore,
  buildRationale,
  climbingFitScore,
  distanceFitScore,
  loopShapeScore,
  offRoadFitScore,
  roadStressScore,
  surfaceFitScore,
  totalScore,
  uniquenessScore,
} from '@/features/circular-routing/scoring';
import { dedupeRoutes } from '@/features/circular-routing/dedupe';
import { isHighStressRoad } from '@/features/rights-of-way/access-policy';
import { getRoutingProvider } from '@/server/providers/routing';
import type { RoutingContext } from '@/server/providers/routing/types';
import {
  getRouteAnalysisService,
  type RouteAnalysisResult,
} from '@/server/services/route-analysis';

export interface CircularRouteCandidate extends AnalysedRoute {
  score: number;
  scoreComponents: RouteScoreComponents;
  rationale: string[];
  pattern: string;
  direction: 'clockwise' | 'anticlockwise';
}

export interface CircularRouteGenerator {
  generate(
    request: CircularRouteRequest,
    context: RoutingContext,
  ): Promise<CircularRouteCandidate[]>;
}

const MAX_CONVERGENCE_ITERATIONS = 2;
const PREFERRED_TOLERANCE = 0.1;
const ACCEPTABLE_TOLERANCE = 0.2;

export class DefaultCircularRouteGenerator implements CircularRouteGenerator {
  async generate(
    request: CircularRouteRequest,
    context: RoutingContext,
  ): Promise<CircularRouteCandidate[]> {
    const candidateCount = 24;
    const anchors = generateAnchorCandidates(request, candidateCount);
    const analysisService = getRouteAnalysisService();

    const routed = await mapWithConcurrency(anchors, context.concurrency, (anchor, index) =>
      this.routeWithConvergence(request, anchor, index, context),
    );

    const successes = routed
      .filter(
        (result): result is PromiseFulfilledResult<RoutedCandidate | null> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((value): value is RoutedCandidate => value !== null);

    if (successes.length === 0) {
      throw new ApiError(
        'NO_ROUTE_FOUND',
        'No circular route could be generated from this start point with the selected preferences.',
      );
    }

    const analysed = await mapWithConcurrency(
      successes,
      Math.max(2, context.concurrency),
      async (item) => {
        const analysis = await analysisService.analyse(item.route, {
          activityProfile: request.activityProfile,
          accessPolicy: request.accessPolicy,
          signal: context.signal,
          requestId: context.requestId,
        });
        return { ...item, analysis };
      },
    );

    const scored: CircularRouteCandidate[] = [];
    for (const result of analysed) {
      if (result.status !== 'fulfilled') continue;
      const { route, anchor, analysis } = result.value;
      const rejection = rejectionReason(route, analysis, request);
      if (rejection) {
        logger.debug('Circular candidate rejected', { reason: rejection, candidate: anchor.id });
        continue;
      }
      const components = scoreCandidate(route, analysis, request);
      const score = totalScore(components);
      scored.push({
        route,
        analysis,
        score,
        scoreComponents: components,
        rationale: buildRationale({
          components,
          analysis,
          targetDistanceMetres: request.targetDistanceMetres,
        }),
        pattern: anchor.pattern,
        direction: anchor.direction,
      });
    }

    if (scored.length === 0) {
      throw new ApiError(
        'NO_ROUTE_FOUND',
        'Candidate loops were generated but none met the selected access and distance constraints. Try relaxing the access policy or changing the distance.',
      );
    }

    scored.sort((a, b) => b.score - a.score);
    const unique = dedupeRoutes(scored, 0.62).kept;
    return selectAlternatives(unique.length >= 3 ? unique : scored);
  }

  private async routeWithConvergence(
    request: CircularRouteRequest,
    initialAnchor: AnchorCandidate,
    index: number,
    context: RoutingContext,
  ): Promise<RoutedCandidate | null> {
    const provider = getRoutingProvider();
    let anchor = initialAnchor;
    let best: RoutedCandidate | null = null;

    for (let iteration = 0; iteration <= MAX_CONVERGENCE_ITERATIONS; iteration += 1) {
      if (context.signal?.aborted) return best;
      const coordinates: Coordinate[] = [request.start, ...anchor.anchors, request.start];
      let result;
      try {
        result = await provider.route({
          coordinates,
          preferences: request,
          variantSeed: index + iteration * 101 + 1,
          signal: context.signal,
          requestId: context.requestId,
        });
      } catch (error) {
        logger.debug('Circular candidate routing failed', {
          candidate: anchor.id,
          error: (error as Error).message,
        });
        return best;
      }

      const route = result.routes[0];
      if (!route) return best;
      const error =
        Math.abs(route.distanceMetres - request.targetDistanceMetres) /
        request.targetDistanceMetres;
      const candidate: RoutedCandidate = { route, anchor };
      if (!best || error < candidateError(best, request)) best = candidate;
      if (error <= PREFERRED_TOLERANCE) return candidate;
      anchor = rescaleCandidate(
        anchor,
        request.start,
        route.distanceMetres,
        request.targetDistanceMetres,
      );
    }
    return best;
  }
}

interface RoutedCandidate {
  route: NormalisedRoute;
  anchor: AnchorCandidate;
}

function candidateError(candidate: RoutedCandidate, request: CircularRouteRequest): number {
  return (
    Math.abs(candidate.route.distanceMetres - request.targetDistanceMetres) /
    request.targetDistanceMetres
  );
}

function rejectionReason(
  route: NormalisedRoute,
  analysis: RouteAnalysisResult,
  request: CircularRouteRequest,
): string | null {
  const error =
    Math.abs(route.distanceMetres - request.targetDistanceMetres) / request.targetDistanceMetres;
  if (error > ACCEPTABLE_TOLERANCE * 1.75) return 'distance-mismatch';
  if (analysis.access.prohibitedPercent > 0.5) return 'prohibited-access';
  if (request.accessPolicy === 'strict' && analysis.access.notConfirmedPercent > 1) {
    return 'footpath-only-section-under-strict-policy';
  }
  if (analysis.repeatedPercent > 42) return 'excessive-repeated-geometry';
  if (request.accessPolicy === 'strict' && analysis.coverage.accessDataPercent < 40) {
    return 'insufficient-access-data';
  }
  const coordinates = route.geometry.coordinates as Coordinate[];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!first || !last || haversineMetres(first, last) > 250) return 'loop-not-closed';
  return null;
}

function scoreCandidate(
  route: NormalisedRoute,
  analysis: RouteAnalysisResult,
  request: CircularRouteRequest,
): RouteScoreComponents {
  const highStressDistance = route.segments
    .filter((segment) => segment.tags && isHighStressRoad(segment.tags))
    .reduce((sum, segment) => sum + segment.distanceMetres, 0);
  const highStressPercent =
    route.distanceMetres > 0 ? (highStressDistance / route.distanceMetres) * 100 : 0;

  return {
    distanceFit: distanceFitScore(route.distanceMetres, request.targetDistanceMetres),
    accessConfidence: accessConfidenceScore(analysis.access, analysis.coverage),
    offRoadFit: offRoadFitScore(analysis.surface, request.offRoad),
    roadStressFit: roadStressScore(highStressPercent),
    climbingFit: climbingFitScore(analysis.ascentMetres, route.distanceMetres, request.climbing),
    surfaceFit: surfaceFitScore(analysis.surface, request.surface),
    routeUniqueness: uniquenessScore(analysis.repeatedPercent),
    loopShapeQuality: loopShapeScore(
      polygonAreaSqMetres(route.geometry.coordinates as Coordinate[]),
      route.distanceMetres,
    ),
  };
}

/** Shoelace formula on a local equirectangular projection. */
export function polygonAreaSqMetres(coordinates: readonly Coordinate[]): number {
  if (coordinates.length < 3) return 0;
  const latRef = (coordinates[0]![1] * Math.PI) / 180;
  const mPerDegLat = 111_132;
  const mPerDegLon = 111_320 * Math.cos(latRef);
  let sum = 0;
  for (let i = 0; i < coordinates.length; i += 1) {
    const a = coordinates[i]!;
    const b = coordinates[(i + 1) % coordinates.length]!;
    sum += a[0] * mPerDegLon * (b[1] * mPerDegLat) - b[0] * mPerDegLon * (a[1] * mPerDegLat);
  }
  return Math.abs(sum) / 2;
}

const LABELS: Record<CandidateLabelKey, string> = {
  'most-off-road': 'Most off-road',
  balanced: 'Balanced',
  easier: 'Easier / lower risk',
};

/**
 * Picks three meaningfully different options rather than three copies of the
 * top-scoring geometry.
 */
export function selectAlternatives(candidates: CircularRouteCandidate[]): CircularRouteCandidate[] {
  if (candidates.length === 0) return [];
  const remaining = [...candidates];
  const chosen: CircularRouteCandidate[] = [];

  const take = (
    labelKey: CandidateLabelKey,
    compare: (a: CircularRouteCandidate, b: CircularRouteCandidate) => number,
  ) => {
    if (remaining.length === 0) return;
    remaining.sort(compare);
    const pick = remaining.shift()!;
    chosen.push({ ...pick, label: LABELS[labelKey], labelKey });
  };

  take(
    'most-off-road',
    (a, b) => b.analysis.surface.offRoadPercent - a.analysis.surface.offRoadPercent,
  );
  take('balanced', (a, b) => b.score - a.score);
  take('easier', (a, b) => easeScore(b) - easeScore(a));

  return chosen;
}

function easeScore(candidate: CircularRouteCandidate): number {
  const climbPerKm =
    candidate.analysis.ascentMetres / Math.max(1, candidate.analysis.distanceMetres / 1000);
  return (
    candidate.analysis.access.confirmedPercent / 100 +
    candidate.analysis.coverage.accessDataPercent / 200 -
    climbPerKm / 60 -
    candidate.analysis.access.uncertainPercent / 200
  );
}

let generator: CircularRouteGenerator | null = null;

export function getCircularRouteGenerator(): CircularRouteGenerator {
  generator ??= new DefaultCircularRouteGenerator();
  return generator;
}
