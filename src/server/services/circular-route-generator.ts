import type {
  AnalysedRoute,
  RightsOfWayCollection,
  RouteWarningCode,
  CircularRouteRequest,
  Coordinate,
  NormalisedRoute,
  RouteScoreComponents,
} from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { mapWithConcurrency } from '@/lib/http/fetch-json';
import { logger } from '@/lib/logging/logger';
import {
  boundingBoxAreaSqKm,
  downsample,
  haversineMetres,
  padBoundingBox,
} from '@/lib/geo/geometry';
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
import { labelAlternatives } from '@/features/circular-routing/labels';
import { isHighStressRoad } from '@/features/rights-of-way/access-policy';
import { getRoutingProvider } from '@/server/providers/routing';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import type { RoutingContext } from '@/server/providers/routing/types';
import {
  getRouteAnalysisService,
  inferJurisdiction,
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
/** Below this much remaining budget, analysis is skipped entirely. */
const ANALYSIS_MINIMUM_MS = 12_000;
const ACCEPTABLE_TOLERANCE = 0.2;

export class DefaultCircularRouteGenerator implements CircularRouteGenerator {
  async generate(
    request: CircularRouteRequest,
    context: RoutingContext,
  ): Promise<CircularRouteCandidate[]> {
    // Long loops take proportionally longer per routing call, so fewer
    // candidates are attempted to stay inside the time budget.
    const requested = context.candidateCount ?? 24;
    const candidateCount = Math.max(
      6,
      Math.round(requested * distanceScaleFactor(request.targetDistanceMetres)),
    );
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
    // so there is no sense analysing two copies of the same loop. Long routes
    // are analysed in smaller numbers because each one costs more.
    const analysisLimit = Math.max(
      3,
      Math.round(ANALYSIS_LIMIT * distanceScaleFactor(request.targetDistanceMetres)),
    );
    const distinct = dedupeRoutes(
      successes.map((item) => ({ ...item, route: item.route })),
      0.62,
    ).kept.slice(0, analysisLimit);

    // One rights-of-way query for the whole candidate set, rather than one per
    // candidate. With live Overpass data this is the difference between a
    // dozen upstream queries and one.
    // Analysis needs upstream path data, the slowest remaining step. If too
    // little budget is left, skip it and say so rather than running past the
    // platform's function timeout and returning nothing at all.
    const analysisPossible =
      !context.deferAnalysis && this.timeRemaining(budget) > ANALYSIS_MINIMUM_MS;
    const sharedFeatures = analysisPossible
      ? await this.loadSharedFeatures(distinct, context)
      : undefined;
    const analysisAffordable = analysisPossible && this.timeRemaining(budget) > 4_000;

    if (!analysisAffordable && !context.deferAnalysis) {
      logger.warn('Skipped route analysis to stay inside the time budget', {
        requestId: context.requestId,
        candidates: distinct.length,
      });
    }

    const analysed = analysisAffordable
      ? await mapWithConcurrency(distinct, Math.max(2, context.concurrency), async (item) => {
          const analysis = await analysisService.analyse(item.route, {
            activityProfile: request.activityProfile,
            accessPolicy: request.accessPolicy,
            signal: context.signal,
            requestId: context.requestId,
            features: sharedFeatures,
          });
          return { ...item, analysis };
        })
      : distinct.map((item) => ({
          status: 'fulfilled' as const,
          value: { ...item, analysis: unanalysedResult(item.route, request) },
        }));

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
      return labelAlternatives(
        dedupeRoutes(passed, 0.62).kept.slice(0, 3),
      ) as CircularRouteCandidate[];
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

    return labelAlternatives(
      dedupeRoutes(salvaged, 0.62).kept.slice(0, 3),
    ) as CircularRouteCandidate[];
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
          // Bound each call so the overshoot past the deadline stays small.
          timeoutMs: Math.max(4_000, Math.min(10_000, Math.round(this.timeRemaining(budget) / 2))),
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

  /**
   * One query covering every candidate. A corridor around all candidate routes
   * scales with route length rather than area, so a 100 km loop costs about the
   * same as a 20 km one; the bounding-box path remains for providers that
   * cannot do corridor queries, guarded by an area limit.
   */
  private async loadSharedFeatures(
    candidates: RoutedCandidate[],
    context: RoutingContext,
  ): Promise<RightsOfWayCollection | undefined> {
    if (candidates.length === 0) return undefined;
    const provider = getRightsOfWayProvider();
    const queryOptions = {
      signal: context.signal,
      limit: 10_000,
      includeRoads: true,
      requestId: context.requestId,
    };

    if (provider.getFeaturesAlongRoutes) {
      // Corridor sampling must stay dense relative to its radius or gaps open
      // up, so long routes use a wider corridor and coarser sampling instead of
      // an unbounded number of points.
      const longest = Math.max(...candidates.map((candidate) => candidate.route.distanceMetres));
      const corridorMetres = Math.min(150, Math.max(35, Math.round(longest / 900)));
      const pointsPerRoute = Math.min(400, Math.max(60, Math.ceil(longest / (corridorMetres * 2))));
      const corridors = candidates
        .slice(0, 6)
        .map((candidate) =>
          downsample(candidate.route.geometry.coordinates as Coordinate[], pointsPerRoute),
        );
      return provider
        .getFeaturesAlongRoutes(corridors, { ...queryOptions, corridorMetres })
        .catch(() => undefined);
    }

    let [minLon, minLat, maxLon, maxLat] = candidates[0]!.route.bbox;
    for (const candidate of candidates) {
      const [a, b, c, d] = candidate.route.bbox;
      minLon = Math.min(minLon, a);
      minLat = Math.min(minLat, b);
      maxLon = Math.max(maxLon, c);
      maxLat = Math.max(maxLat, d);
    }
    const bbox = padBoundingBox([minLon, minLat, maxLon, maxLat], 200);
    if (boundingBoxAreaSqKm(bbox) > 1_200) return undefined;
    return provider.getFeatures(bbox, queryOptions).catch(() => undefined);
  }
}

/**
 * Used when there was no time left to analyse a route. Everything is reported
 * as unknown rather than guessed, and a warning explains why.
 */
function unanalysedResult(
  route: NormalisedRoute,
  request: CircularRouteRequest,
): RouteAnalysisResult {
  const zeroed = { pavedPercent: 0, unpavedPercent: 0, unknownPercent: 100, offRoadPercent: 0 };
  return {
    distanceMetres: route.distanceMetres,
    durationSeconds: route.durationSeconds ?? 0,
    ascentMetres: route.ascentMetres ?? 0,
    descentMetres: route.descentMetres ?? 0,
    hasElevationData: route.ascentMetres !== undefined,
    analysed: false,
    surface: zeroed,
    designation: {
      publicFootpathPercent: 0,
      publicBridlewayPercent: 0,
      restrictedBywayPercent: 0,
      bywayOpenToAllTrafficPercent: 0,
      permissivePercent: 0,
      roadPercent: 0,
      otherPercent: 100,
    },
    access: {
      confirmedPercent: 0,
      permissivePercent: 0,
      uncertainPercent: 100,
      notConfirmedPercent: 0,
      prohibitedPercent: 0,
    },
    coverage: { accessDataPercent: 0, surfaceDataPercent: 0, technicalDataPercent: 0 },
    repeatedPercent: 0,
    warnings: [
      {
        code: 'LOW_DATA_COVERAGE',
        severity: 'caution',
        message:
          'This route was generated but could not be checked against mapped rights-of-way data in the time available, so access, surface and designation figures are unknown. Try a shorter target distance for full analysis.',
        affectedDistanceMetres: route.distanceMetres,
        segmentIndexes: [],
      },
    ],
    jurisdiction: inferJurisdiction(
      (route.geometry.coordinates as Coordinate[])[0] ?? request.start,
    ),
    matchedDistanceMetres: 0,
    isSyntheticData: route.isSyntheticData,
    debug: { match: [] },
  };
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

/** 1 up to ~50 km, tapering to 0.4 for very long loops. */
export function distanceScaleFactor(targetDistanceMetres: number): number {
  if (targetDistanceMetres <= 50_000) return 1;
  if (targetDistanceMetres <= 80_000) return 0.75;
  if (targetDistanceMetres <= 120_000) return 0.55;
  return 0.4;
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

let generator: CircularRouteGenerator | null = null;

export function getCircularRouteGenerator(): CircularRouteGenerator {
  generator ??= new DefaultCircularRouteGenerator();
  return generator;
}
