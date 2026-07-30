import type {
  RightsOfWayCollection,
  AccessPolicy,
  ActivityProfile,
  Coordinate,
  Jurisdiction,
  NormalisedRoute,
  RouteAnalysis,
  RouteWarning,
  RouteWarningCode,
  WarningSeverity,
} from '@/types/domain';
import { downsample, padBoundingBox } from '@/lib/geo/geometry';
import { travelModeOf } from '@/features/routing/profiles';
import {
  accessBreakdown,
  coverageBreakdown,
  designationBreakdown,
  repeatedFraction,
  surfaceBreakdown,
  totalDistance,
  type AnalysedSegment,
} from '@/features/route-analysis/metrics';
import { isHighStressRoad } from '@/features/rights-of-way/access-policy';
import { activityDefinition } from '@/features/routing/profiles';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import { matchRouteToRightsOfWay, type MatchDebugEntry } from '@/server/services/route-matching';

export interface RouteAnalysisContext {
  activityProfile: ActivityProfile;
  accessPolicy: AccessPolicy;
  jurisdiction?: Jurisdiction;
  signal?: AbortSignal;
  /** Segment indexes drawn by hand — access cannot be verified for these. */
  manualSegmentIndexes?: number[];
  requestId?: string;
  /**
   * Pre-fetched rights-of-way features. Supplying these lets a caller analysing
   * many routes in one area issue a single upstream query instead of one per
   * route — important with live Overpass data.
   */
  features?: RightsOfWayCollection;
}

export interface RouteAnalysisResult extends RouteAnalysis {
  debug: { match: MatchDebugEntry[] };
}

export interface RouteAnalysisService {
  analyse(route: NormalisedRoute, context: RouteAnalysisContext): Promise<RouteAnalysisResult>;
}

/**
 * England and Wales bounding box. Outside it, England-and-Wales legal
 * assumptions must not be applied.
 */
export function inferJurisdiction(coordinate: Coordinate): Jurisdiction {
  const [lon, lat] = coordinate;
  if (lat >= 49.8 && lat <= 55.81 && lon >= -5.75 && lon <= 1.78) return 'england-wales';
  if (lat > 54.6 && lat <= 61 && lon >= -8.7 && lon <= 0) return 'scotland';
  if (lat >= 54 && lat <= 55.4 && lon >= -8.2 && lon <= -5.4) return 'northern-ireland';
  return 'unknown';
}

export class DefaultRouteAnalysisService implements RouteAnalysisService {
  async analyse(
    route: NormalisedRoute,
    context: RouteAnalysisContext,
  ): Promise<RouteAnalysisResult> {
    const coordinates = route.geometry.coordinates as Coordinate[];
    const jurisdiction = context.jurisdiction ?? inferJurisdiction(coordinates[0] ?? [0, 0]);

    const provider = getRightsOfWayProvider();
    // A corridor must be sampled at least as densely as its own width or gaps
    // open up between the sample circles. Widening the corridor for longer
    // routes keeps the point count — and therefore the query cost — bounded.
    const corridorMetres = Math.min(
      200,
      Math.max(60, Math.round((route.distanceMetres / 1000) * 3)),
    );
    const corridorPoints = Math.min(
      400,
      Math.max(40, Math.ceil(route.distanceMetres / (corridorMetres * 2))),
    );
    const queryOptions = {
      jurisdiction,
      signal: context.signal,
      limit: 6_000,
      includeRoads: true,
      corridorMetres,
      requestId: context.requestId,
    };

    // Corridor queries stay small however long the route is; the bounding-box
    // path is only a fallback for providers that cannot do them.
    const features =
      context.features ??
      (await (
        provider.getFeaturesAlongRoutes
          ? provider.getFeaturesAlongRoutes([downsample(coordinates, corridorPoints)], queryOptions)
          : provider.getFeatures(padBoundingBox(route.bbox, 150), queryOptions)
      ).catch(() => ({ type: 'FeatureCollection' as const, features: [] })));

    const { segments, debug, matchedDistanceMetres } = matchRouteToRightsOfWay(route, features, {
      jurisdiction,
    });

    const manual = new Set(context.manualSegmentIndexes ?? []);
    for (const segment of segments) {
      if (manual.has(segment.index)) segment.matchSource = 'manual';
    }

    const mode = travelModeOf(context.activityProfile);
    const distance = totalDistance(segments) || route.distanceMetres;
    const surface = surfaceBreakdown(segments);
    const designation = designationBreakdown(segments);
    const access = accessBreakdown(segments, mode);
    const coverage = coverageBreakdown(segments);
    const repeated = repeatedFraction(coordinates);

    const hasElevationData = route.ascentMetres !== undefined;
    const duration =
      route.durationSeconds ?? distance / activityDefinition(context.activityProfile).baseSpeedMps;

    const warnings = [
      ...route.warnings,
      ...buildWarnings(segments, { jurisdiction, mode, manual }),
      ...(coverage.accessDataPercent < 60
        ? [
            warning(
              'LOW_DATA_COVERAGE',
              'caution',
              `Access information is missing or unclear for ${Math.round(100 - coverage.accessDataPercent)}% of this route. Verify locally where access is uncertain.`,
              distance * ((100 - coverage.accessDataPercent) / 100),
              [],
            ),
          ]
        : []),
    ];

    return {
      distanceMetres: distance,
      durationSeconds: duration,
      ascentMetres: route.ascentMetres ?? 0,
      descentMetres: route.descentMetres ?? 0,
      hasElevationData,
      analysed: true,
      highestPointMetres: undefined,
      lowestPointMetres: undefined,
      surface,
      designation,
      access,
      coverage,
      repeatedPercent: repeated * 100,
      warnings,
      jurisdiction,
      matchedDistanceMetres,
      isSyntheticData: route.isSyntheticData,
      debug: { match: debug },
    };
  }
}

function warning(
  code: RouteWarningCode,
  severity: WarningSeverity,
  message: string,
  affectedDistanceMetres: number,
  segmentIndexes: number[],
): RouteWarning {
  return { code, severity, message, affectedDistanceMetres, segmentIndexes };
}

function buildWarnings(
  segments: readonly AnalysedSegment[],
  options: { jurisdiction: Jurisdiction; mode: 'cycling' | 'walking'; manual: Set<number> },
): RouteWarning[] {
  const accumulator = new Map<RouteWarningCode, { distance: number; indexes: number[] }>();
  const add = (code: RouteWarningCode, segment: AnalysedSegment) => {
    const entry = accumulator.get(code) ?? { distance: 0, indexes: [] };
    entry.distance += segment.distanceMetres;
    entry.indexes.push(segment.index);
    accumulator.set(code, entry);
  };

  for (const segment of segments) {
    if (options.manual.has(segment.index)) {
      add('MANUAL_SEGMENT_UNVERIFIED', segment);
      continue;
    }
    const classification = segment.classification;
    if (!classification) {
      add('UNKNOWN_ACCESS', segment);
      continue;
    }
    const status =
      options.mode === 'cycling'
        ? classification.cycling.cyclingStatus
        : classification.walking.status;
    if (status === 'prohibited') add('PRIVATE_ACCESS', segment);
    else if (status === 'not-confirmed' && options.mode === 'cycling') {
      add('PUBLIC_FOOTPATH_CYCLING_UNCONFIRMED', segment);
    } else if (status === 'permissive') add('PERMISSIVE_ACCESS', segment);
    else if (status === 'uncertain') add('UNKNOWN_ACCESS', segment);

    if (classification.surfaceClass === 'unknown') add('UNKNOWN_SURFACE', segment);
    if (segment.tags && isHighStressRoad(segment.tags)) add('HIGH_ROAD_STRESS', segment);
    if (segment.tags?.ford) add('FORD', segment);
    if (segment.tags?.highway === 'steps') add('STEPS', segment);
    const incline = Math.abs(Number.parseFloat((segment.tags?.incline ?? '').replace('%', '')));
    if (Number.isFinite(incline) && incline >= 12) add('STEEP_SECTION', segment);
  }

  const messages: Record<string, { severity: WarningSeverity; text: (km: string) => string }> = {
    PUBLIC_FOOTPATH_CYCLING_UNCONFIRMED: {
      severity: 'critical',
      text: (km) =>
        `${km} km follows paths where cycling is not confirmed (typically public footpaths). Cycling there may not be permitted.`,
    },
    PRIVATE_ACCESS: {
      severity: 'critical',
      text: (km) => `${km} km crosses ways mapped as private or otherwise prohibited.`,
    },
    PERMISSIVE_ACCESS: {
      severity: 'caution',
      text: (km) =>
        `${km} km uses permissive paths. Permission is granted by the landowner and can be withdrawn.`,
    },
    UNKNOWN_ACCESS: {
      severity: 'caution',
      text: (km) => `${km} km has incomplete access information in OpenStreetMap. Verify locally.`,
    },
    UNKNOWN_SURFACE: {
      severity: 'info',
      text: (km) => `${km} km has no mapped surface tag, so surface figures are incomplete.`,
    },
    MANUAL_SEGMENT_UNVERIFIED: {
      severity: 'caution',
      text: (km) =>
        `${km} km was drawn by hand. It is not matched to the mapped network and its access status is unverified.`,
    },
    HIGH_ROAD_STRESS: {
      severity: 'caution',
      text: (km) => `${km} km follows main roads that may carry fast traffic.`,
    },
    FORD: { severity: 'caution', text: (km) => `Route crosses a ford (${km} km affected).` },
    STEPS: { severity: 'caution', text: (km) => `Route includes steps (${km} km affected).` },
    STEEP_SECTION: { severity: 'info', text: (km) => `${km} km is mapped with a steep gradient.` },
  };

  return [...accumulator.entries()].map(([code, entry]) => {
    const template = messages[code] ?? {
      severity: 'info' as WarningSeverity,
      text: (km: string) => `${km} km affected.`,
    };
    return warning(
      code,
      template.severity,
      template.text((entry.distance / 1000).toFixed(1)),
      entry.distance,
      entry.indexes,
    );
  });
}

let service: RouteAnalysisService | null = null;

export function getRouteAnalysisService(): RouteAnalysisService {
  service ??= new DefaultRouteAnalysisService();
  return service;
}
