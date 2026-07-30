import type {
  RightsOfWayCollection,
  RouteWarningCode,
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
import { boundingBoxAreaSqKm, haversineMetres, padBoundingBox } from '@/lib/geo/geometry';
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
import { getRightsOfWayProvider } from '@/server/providers/osm';
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

const PREFERRED_TOLERANCE = 0.1;
/** Candidates refined in phase two, and candidates analysed at all. */
const REFINEMENT_LIMIT = 8;
const ANALYSIS_LIMIT = 10;
const ACCEPTABLE_TOLERANCE = 0.2;

export class DefaultCircularRouteGenerator implements CircularRouteGenerator {
  async generate(
    request: CircularRouteRequest,
    context: RoutingContext,
  ): Promise<CircularRouteCandidate[]> {
    const candidateCount = context.candidateCount ?? 24;
    const deadlineAt = context.deadlineAt ?? Date.now() + 40_000;
    const anchors = generateAnchorCandidates(request, candidateCount);
    const analysisService = getRouteAnalysisService();

    // Shared state: once an upstream provider rate-limits us, generating more
    // candidates only makes it worse, so the rest are abandoned.
    const budget: GenerationBudget = { rateLimited: false, failures: 0, deadlineAt };

    // Phase 1 — one routing call per candidate. Cheap, and enough to rank by
    // distance fit. Anything more would multiply upstream calls for candidates
    // that are about to be discarded anyway.
    const firstPass = await mapWithConcurrency(anchors, context.concurrency, (anchor, index) =>
      this.routeCandidate(request, anchor, index, context, budget, 0),
    );

    let successes = firstPass
      .filter(
        (result): result is PromiseFulfilledResult<RoutedCandidate | null> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((value): value is RoutedCandidate => value !== null);

    if (successes.length === 0) {
      throw new ApiError(
        budget.rateLimited ? 'RATE_LIMITED' : 'NO_ROUTE_FOUND',
        budget.rateLimited
          ? 'The routing provider rate-limited this request before any route could be built. Wait a moment and try again, or lower CIRCULAR_CANDIDATE_COUNT.'
          : 'No circular route could be generated from this start point with the selected preferences.',
      );
    }

    // Phase 2 — refine only the candidates worth refining: those closest to the
    // target that are not yet within tolerance, and only while time remains.
    const needsWork = successes
      .filter((candidate) => candidateError(candidate, request) > PREFERRED_TOLERANCE)
      .sort((a, b) => candidateError(a, request) - candidateError(b, request))
      .slice(0, REFINEMENT_LIMIT);

    if (needsWork.length > 0 && this.timeRemaining(budget) > 0) {
      const refined = await mapWithConcurrency(needsWork, context.concurrency, (candidate) =>
        this.refineCandidate(request, candidate, context, budget),
      );
      refined.forEach((result, index) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const original = needsWork[index]!;
        if (candidateError(result.value, request) < candidateError(original, request)) {
          successes = successes.map((candidate) =>
            candidate === original ? result.value! : candidate,
          );
        }
      });
    }

    // Deduplicate on geometry before analysis: analysis is the expensive step,
    // so there is no sense analysing two copies of the same loop.
    const distinct = dedupeRoutes(
      successes.map((item) => ({ ...item, route: item.route })),
      0.62,
    ).kept.slice(0, ANALYSIS_LIMIT);

    // One rights-of-way query for the whole candidate set, rather than one per
    // candidate. With live Overpass data this is the difference between a
    // dozen upstream queries and one.
    const sharedFeatures = await this.loadSharedFeatures(distinct, context);

    const analysed = await mapWithConcurrency(
      distinct,
      Math.max(2, context.concurrency),
      async (item) => {
        const analysis = await analysisService.analyse(item.route, {
          activityProfile: request.activityProfile,
          accessPolicy: request.accessPolicy,
          signal: context.signal,
          requestId: context.requestId,
          features: sharedFeatures,
        });
        return { ...item, analysis };
      },
    );

    const passed: CircularRouteCandidate[] = [];
    const rejected: Array<{ candidate: CircularRouteCandidate; reason: RejectionReason }> = [];
    const rejectionCounts = new Map<RejectionReason, number>();

    for (const result of analysed) {
      if (result.status !== 'fulfilled') continue;
      const { route, anchor, analysis } = result.value;
      const components = scoreCandidate(route, analysis, request);
      const candidate: CircularRouteCandidate = {
        route,
        analysis,
        score: totalScore(components),
        scoreComponents: components,
        rationale: buildRationale({
          components,
          analysis,
          targetDistanceMetres: request.targetDistanceMetres,
        }),
        pattern: anchor.pattern,
        direction: anchor.direction,
      };

      const reason = rejectionReason(route, analysis, request);
      if (reason) {
        rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
        rejected.push({ candidate, reason });
        continue;
      }
      passed.push(candidate);
    }

    if (passed.length > 0) {
      passed.sort((a, b) => b.score - a.score);
      return selectAlternatives(passed);
    }

    // Nothing cleared every constraint. Returning the closest attempts with an
    // explicit warning is far more useful than refusing to answer — the user
    // can see what was wrong and adjust.
    if (rejected.length === 0) {
      throw new ApiError(
        budget.rateLimited ? 'RATE_LIMITED' : 'NO_ROUTE_FOUND',
        'No usable circular route could be built from this start point.',
      );
    }

    logger.warn('All circular candidates were rejected; returning best-effort routes', {
      requestId: context.requestId,
      rejections: Object.fromEntries(rejectionCounts),
    });

    rejected.sort((a, b) => b.candidate.score - a.candidate.score);
    const salvaged = rejected.slice(0, 6).map(({ candidate, reason }) => ({
      ...candidate,
      rationale: [`Below your constraints: ${REJECTION_TEXT[reason]}.`, ...candidate.rationale],
      analysis: {
        ...candidate.analysis,
        warnings: [
          {
            code: REJECTION_WARNING[reason],
            severity: 'caution' as const,
            message: `No loop met every constraint. This option ${REJECTION_TEXT[reason]}. Try a different target distance, loop shape, or a less strict access policy.`,
            affectedDistanceMetres: candidate.analysis.distanceMetres,
            segmentIndexes: [],
          },
          ...candidate.analysis.warnings,
        ],
      },
    }));

    return selectAlternatives(salvaged);
  }

  private timeRemaining(budget: GenerationBudget): number {
    return budget.deadlineAt - Date.now();
  }

  /** Routes one candidate, optionally iterating to converge on the target distance. */
  private async routeCandidate(
    request: CircularRouteRequest,
    initialAnchor: AnchorCandidate,
    index: number,
    context: RoutingContext,
    budget: GenerationBudget,
    extraIterations: number,
  ): Promise<RoutedCandidate | null> {
    const provider = getRoutingProvider();
    let anchor = initialAnchor;
    let best: RoutedCandidate | null = null;

    for (let iteration = 0; iteration <= extraIterations; iteration += 1) {
      if (context.signal?.aborted || budget.rateLimited) return best;
      // Stop cleanly before the platform kills the request.
      if (this.timeRemaining(budget) <= 0) {
        budget.timedOut = true;
        return best;
      }

      let result;
      try {
        result = await provider.route({
          coordinates: [request.start, ...anchor.anchors, request.start],
          preferences: request,
          variantSeed: index + iteration * 101 + 1,
          signal: context.signal,
          requestId: context.requestId,
        });
      } catch (error) {
        budget.failures += 1;
        if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
          budget.rateLimited = true;
          logger.warn('Routing provider rate-limited candidate generation', {
            candidate: anchor.id,
          });
        } else {
          logger.debug('Circular candidate routing failed', {
            candidate: anchor.id,
            error: (error as Error).message,
          });
        }
        return best;
      }

      const route = result.routes[0];
      if (!route) return best;
      const candidate: RoutedCandidate = { route, anchor };
      if (!best || candidateError(candidate, request) < candidateError(best, request))
        best = candidate;
      if (candidateError(candidate, request) <= PREFERRED_TOLERANCE) return candidate;
      anchor = rescaleCandidate(
        anchor,
        request.start,
        route.distanceMetres,
        request.targetDistanceMetres,
      );
    }
    return best;
  }

  /** One extra convergence attempt for a promising candidate. */
  private async refineCandidate(
    request: CircularRouteRequest,
    candidate: RoutedCandidate,
    context: RoutingContext,
    budget: GenerationBudget,
  ): Promise<RoutedCandidate | null> {
    const rescaled = rescaleCandidate(
      candidate.anchor,
      request.start,
      candidate.route.distanceMetres,
      request.targetDistanceMetres,
    );
    return this.routeCandidate(request, rescaled, 991, context, budget, 0);
  }

  /** Union bounding box of every candidate, queried once. */
  private async loadSharedFeatures(
    candidates: RoutedCandidate[],
    context: RoutingContext,
  ): Promise<RightsOfWayCollection | undefined> {
    if (candidates.length === 0) return undefined;
    let [minLon, minLat, maxLon, maxLat] = candidates[0]!.route.bbox;
    for (const candidate of candidates) {
      const [a, b, c, d] = candidate.route.bbox;
      minLon = Math.min(minLon, a);
      minLat = Math.min(minLat, b);
      maxLon = Math.max(maxLon, c);
      maxLat = Math.max(maxLat, d);
    }
    const bbox = padBoundingBox([minLon, minLat, maxLon, maxLat], 200);

    // Fall back to per-route queries if the union is too large to ask for at once.
    if (boundingBoxAreaSqKm(bbox) > 1_200) return undefined;

    return getRightsOfWayProvider()
      .getFeatures(bbox, {
        signal: context.signal,
        limit: 10_000,
        includeRoads: true,
        requestId: context.requestId,
      })
      .catch(() => undefined);
  }
}

interface GenerationBudget {
  rateLimited: boolean;
  failures: number;
  deadlineAt: number;
  timedOut?: boolean;
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

type RejectionReason =
  | 'distance-mismatch'
  | 'prohibited-access'
  | 'footpath-only-section-under-strict-policy'
  | 'excessive-repeated-geometry'
  | 'insufficient-access-data'
  | 'loop-not-closed';

const REJECTION_TEXT: Record<RejectionReason, string> = {
  'distance-mismatch': 'is well outside your target distance',
  'prohibited-access': 'crosses ways mapped as private or prohibited',
  'footpath-only-section-under-strict-policy':
    'uses paths where cycling is not confirmed, which your strict access policy excludes',
  'excessive-repeated-geometry': 'retraces too much of itself',
  'insufficient-access-data': 'runs mostly over paths with no mapped access information',
  'loop-not-closed': 'does not return cleanly to the start',
};

const REJECTION_WARNING: Record<RejectionReason, RouteWarningCode> = {
  'distance-mismatch': 'DISTANCE_MISMATCH',
  'prohibited-access': 'PRIVATE_ACCESS',
  'footpath-only-section-under-strict-policy': 'PUBLIC_FOOTPATH_CYCLING_UNCONFIRMED',
  'excessive-repeated-geometry': 'DISTANCE_MISMATCH',
  'insufficient-access-data': 'LOW_DATA_COVERAGE',
  'loop-not-closed': 'DISTANCE_MISMATCH',
};

function rejectionReason(
  route: NormalisedRoute,
  analysis: RouteAnalysisResult,
  request: CircularRouteRequest,
): RejectionReason | null {
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
