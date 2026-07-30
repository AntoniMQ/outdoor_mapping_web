import { describe, expect, it } from 'vitest';
import type { AnalysedRoute, CircularRouteRequest, NormalisedRoute } from '@/types/domain';
import {
  generateAnchorCandidates,
  baseRadiusMetres,
  rescaleCandidate,
} from '@/features/circular-routing/anchors';
import { dedupeRoutes, routeOverlap, routeSignature } from '@/features/circular-routing/dedupe';
import { describeRoute, labelAlternatives } from '@/features/circular-routing/labels';
import {
  accessConfidenceScore,
  climbingFitScore,
  distanceFitScore,
  loopShapeScore,
  offRoadFitScore,
  SCORE_WEIGHTS,
  surfaceFitScore,
  totalScore,
  uniquenessScore,
} from '@/features/circular-routing/scoring';
import { haversineMetres } from '@/lib/geo/geometry';
import {
  distanceScaleFactor,
  polygonAreaSqMetres,
} from '@/server/services/circular-route-generator';

const request: CircularRouteRequest = {
  start: [-0.5183, 51.6541],
  targetDistanceMetres: 25_000,
  activityProfile: 'mtb',
  climbing: 'no-preference',
  surface: 'no-preference',
  offRoad: 'balanced',
  technicality: 'no-preference',
  accessPolicy: 'permit-uncertain',
  loopDirection: 'automatic',
  loopShape: 'compact',
};

describe('anchor generation', () => {
  it('is deterministic for the same request', () => {
    const a = generateAnchorCandidates(request, 12);
    const b = generateAnchorCandidates(request, 12);
    expect(a.map((item) => item.anchors)).toEqual(b.map((item) => item.anchors));
  });

  it('produces the requested number of candidates with varied bearings', () => {
    const candidates = generateAnchorCandidates(request, 24);
    expect(candidates).toHaveLength(24);
    const bearings = new Set(
      candidates.map((candidate) => Math.round(candidate.startBearing / 10)),
    );
    expect(bearings.size).toBeGreaterThan(8);
  });

  it('uses several loop patterns', () => {
    const patterns = new Set(
      generateAnchorCandidates(request, 24).map((candidate) => candidate.pattern),
    );
    expect(patterns.size).toBeGreaterThan(1);
  });

  it('honours an explicit loop direction', () => {
    const clockwise = generateAnchorCandidates({ ...request, loopDirection: 'clockwise' }, 6);
    expect(clockwise.every((candidate) => candidate.direction === 'clockwise')).toBe(true);
    const anticlockwise = generateAnchorCandidates(
      { ...request, loopDirection: 'anticlockwise' },
      6,
    );
    expect(anticlockwise.every((candidate) => candidate.direction === 'anticlockwise')).toBe(true);
  });

  it('scales anchor radius with the target distance', () => {
    expect(baseRadiusMetres(50_000, 'triangle')).toBeCloseTo(
      baseRadiusMetres(25_000, 'triangle') * 2,
      5,
    );
  });

  it('places anchors at roughly the intended radius from the start', () => {
    const [candidate] = generateAnchorCandidates(request, 4);
    for (const anchor of candidate!.anchors) {
      const distance = haversineMetres(request.start, anchor);
      expect(distance).toBeGreaterThan(2_000);
      expect(distance).toBeLessThan(9_000);
    }
  });
});

describe('distance convergence', () => {
  it('grows the loop when the achieved distance is short', () => {
    const [candidate] = generateAnchorCandidates(request, 4);
    const rescaled = rescaleCandidate(candidate!, request.start, 15_000, 25_000);
    expect(rescaled.radii[0]!).toBeGreaterThan(candidate!.radii[0]!);
  });

  it('bounds the scale change so a loop cannot explode or collapse', () => {
    const [candidate] = generateAnchorCandidates(request, 4);
    const huge = rescaleCandidate(candidate!, request.start, 1_000, 25_000);
    expect(huge.scale).toBeLessThanOrEqual(1.6);
    const tiny = rescaleCandidate(candidate!, request.start, 250_000, 25_000);
    expect(tiny.scale).toBeGreaterThanOrEqual(0.6);
  });
});

describe('scoring', () => {
  it('weights sum to one', () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((total, weight) => total + weight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('scores an exact distance match highest', () => {
    expect(distanceFitScore(25_000, 25_000)).toBe(1);
    expect(distanceFitScore(27_500, 25_000)).toBeLessThan(1);
    expect(distanceFitScore(40_000, 25_000)).toBe(0);
  });

  it('rewards confirmed access and penalises prohibited sections', () => {
    const good = accessConfidenceScore(
      {
        confirmedPercent: 90,
        permissivePercent: 10,
        uncertainPercent: 0,
        notConfirmedPercent: 0,
        prohibitedPercent: 0,
      },
      { accessDataPercent: 95, surfaceDataPercent: 80, technicalDataPercent: 20 },
    );
    const bad = accessConfidenceScore(
      {
        confirmedPercent: 30,
        permissivePercent: 0,
        uncertainPercent: 20,
        notConfirmedPercent: 40,
        prohibitedPercent: 10,
      },
      { accessDataPercent: 40, surfaceDataPercent: 20, technicalDataPercent: 0 },
    );
    expect(good).toBeGreaterThan(bad);
  });

  it('follows the off-road preference', () => {
    const surface = {
      pavedPercent: 20,
      unpavedPercent: 70,
      unknownPercent: 10,
      offRoadPercent: 80,
    };
    expect(offRoadFitScore(surface, 'maximise')).toBeGreaterThan(
      offRoadFitScore(surface, 'minimise'),
    );
  });

  it('matches climbing preferences', () => {
    expect(climbingFitScore(150, 25_000, 'low')).toBeGreaterThan(
      climbingFitScore(700, 25_000, 'low'),
    );
    expect(climbingFitScore(700, 25_000, 'high')).toBeGreaterThan(
      climbingFitScore(100, 25_000, 'high'),
    );
  });

  it('rewards unrepeated loops', () => {
    expect(uniquenessScore(0)).toBe(1);
    expect(uniquenessScore(40)).toBe(0);
  });

  it('prefers surfaces the rider asked for', () => {
    const unpaved = {
      pavedPercent: 10,
      unpavedPercent: 80,
      unknownPercent: 10,
      offRoadPercent: 85,
    };
    expect(surfaceFitScore(unpaved, 'prefer-unpaved')).toBeGreaterThan(
      surfaceFitScore(unpaved, 'prefer-paved'),
    );
  });

  it('scores a circle-like loop above a there-and-back line', () => {
    const circle = loopShapeScore(Math.PI * 1_000 ** 2, 2 * Math.PI * 1_000);
    expect(circle).toBeGreaterThan(0.9);
    expect(loopShapeScore(0, 10_000)).toBe(0);
  });

  it('combines components with the documented weights', () => {
    const components = {
      distanceFit: 1,
      accessConfidence: 1,
      offRoadFit: 1,
      roadStressFit: 1,
      climbingFit: 1,
      surfaceFit: 1,
      routeUniqueness: 1,
      loopShapeQuality: 1,
    };
    expect(totalScore(components)).toBeCloseTo(1, 6);
  });
});

describe('polygon area', () => {
  it('computes a positive area for a closed loop', () => {
    const square = [
      [-0.5, 51.65],
      [-0.49, 51.65],
      [-0.49, 51.66],
      [-0.5, 51.66],
    ] as [number, number][];
    expect(polygonAreaSqMetres(square)).toBeGreaterThan(500_000);
  });
});

function makeRoute(
  id: string,
  coordinates: [number, number][],
  wayIds: number[] = [],
): NormalisedRoute {
  return {
    id,
    geometry: { type: 'LineString', coordinates },
    distanceMetres: 1_000,
    bbox: [0, 0, 1, 1],
    segments: wayIds.map((wayId, index) => ({
      index,
      coordinates,
      distanceMetres: 100,
      osmWayId: wayId,
    })),
    provider: 'test',
    warnings: [],
    isSyntheticData: true,
  };
}

describe('route deduplication', () => {
  const a = makeRoute(
    'a',
    [
      [-0.5, 51.65],
      [-0.49, 51.65],
    ],
    [1, 2, 3],
  );
  const nearlyIdentical = makeRoute(
    'b',
    [
      [-0.5, 51.65],
      [-0.49, 51.6501],
    ],
    [1, 2, 3],
  );
  const different = makeRoute(
    'c',
    [
      [-0.6, 51.75],
      [-0.59, 51.75],
    ],
    [7, 8, 9],
  );

  it('detects overlap via way ids and geometry', () => {
    expect(routeOverlap(routeSignature(a), routeSignature(nearlyIdentical))).toBeGreaterThan(0.65);
    expect(routeOverlap(routeSignature(a), routeSignature(different))).toBeLessThan(0.1);
  });

  it('drops near-duplicate candidates but keeps distinct ones', () => {
    const result = dedupeRoutes([{ route: a }, { route: nearlyIdentical }, { route: different }]);
    expect(result.kept).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it('does not compare routes by total distance alone', () => {
    const sameLengthDifferentPlace = makeRoute('d', [
      [-1.5, 52.65],
      [-1.49, 52.65],
    ]);
    const result = dedupeRoutes([{ route: a }, { route: sameLengthDifferentPlace }]);
    expect(result.kept).toHaveLength(2);
  });
});

describe('distance scaling', () => {
  it('keeps the full candidate budget for ordinary loops', () => {
    expect(distanceScaleFactor(25_000)).toBe(1);
    expect(distanceScaleFactor(50_000)).toBe(1);
  });

  it('reduces the budget for long loops so generation stays within its time limit', () => {
    expect(distanceScaleFactor(80_000)).toBeLessThan(1);
    expect(distanceScaleFactor(100_000)).toBeLessThan(distanceScaleFactor(80_000));
    expect(distanceScaleFactor(200_000)).toBeGreaterThan(0.3);
  });
});

describe('alternative labelling', () => {
  const base: AnalysedRoute = {
    route: makeRoute('x', [
      [-0.5, 51.65],
      [-0.49, 51.65],
    ]),
    analysis: {
      distanceMetres: 25_000,
      durationSeconds: 7_200,
      ascentMetres: 300,
      descentMetres: 300,
      hasElevationData: true,
      analysed: true,
      surface: { pavedPercent: 40, unpavedPercent: 40, unknownPercent: 20, offRoadPercent: 50 },
      designation: {
        publicFootpathPercent: 0,
        publicBridlewayPercent: 30,
        restrictedBywayPercent: 0,
        bywayOpenToAllTrafficPercent: 0,
        permissivePercent: 0,
        roadPercent: 50,
        otherPercent: 20,
      },
      access: {
        confirmedPercent: 70,
        permissivePercent: 0,
        uncertainPercent: 30,
        notConfirmedPercent: 0,
        prohibitedPercent: 0,
      },
      coverage: { accessDataPercent: 80, surfaceDataPercent: 70, technicalDataPercent: 10 },
      repeatedPercent: 5,
      warnings: [],
      jurisdiction: 'england-wales' as const,
      matchedDistanceMetres: 20_000,
      isSyntheticData: false,
    },
  };

  it('labels the three headline options once analysis is available', () => {
    const routes = [
      {
        ...base,
        score: 0.5,
        analysis: { ...base.analysis, surface: { ...base.analysis.surface, offRoadPercent: 90 } },
      },
      { ...base, score: 0.9 },
      {
        ...base,
        score: 0.2,
        analysis: {
          ...base.analysis,
          ascentMetres: 50,
          access: { ...base.analysis.access, confirmedPercent: 95, uncertainPercent: 5 },
        },
      },
    ];
    const labelled = labelAlternatives(routes);
    expect(labelled.map((route) => route.label)).toEqual([
      'Most off-road',
      'Balanced',
      'Easier / lower risk',
    ]);
  });

  it('uses neutral labels when routes have not been analysed', () => {
    const routes = [
      { ...base, analysis: { ...base.analysis, analysed: false } },
      { ...base, analysis: { ...base.analysis, analysed: false } },
    ];
    const labelled = labelAlternatives(routes);
    expect(labelled.map((route) => route.label)).toEqual(['Option 1', 'Option 2']);
    expect(labelled.every((route) => route.labelKey === undefined)).toBe(true);
  });
});

describe('route descriptions', () => {
  const analysed: AnalysedRoute = {
    route: makeRoute('d', [
      [-0.5, 51.65],
      [-0.49, 51.65],
    ]),
    analysis: {
      distanceMetres: 24_900,
      durationSeconds: 6_360,
      ascentMetres: 402,
      descentMetres: 402,
      hasElevationData: true,
      analysed: true,
      surface: { pavedPercent: 40, unpavedPercent: 15, unknownPercent: 45, offRoadPercent: 15 },
      designation: {
        publicFootpathPercent: 0,
        publicBridlewayPercent: 10,
        restrictedBywayPercent: 0,
        bywayOpenToAllTrafficPercent: 0,
        permissivePercent: 0,
        roadPercent: 60,
        otherPercent: 30,
      },
      access: {
        confirmedPercent: 66,
        permissivePercent: 0,
        uncertainPercent: 28,
        notConfirmedPercent: 6,
        prohibitedPercent: 0,
      },
      coverage: { accessDataPercent: 72, surfaceDataPercent: 45, technicalDataPercent: 5 },
      repeatedPercent: 2,
      warnings: [],
      jurisdiction: 'england-wales',
      matchedDistanceMetres: 18_000,
      isSyntheticData: false,
    },
  };

  it('describes the route using the figures actually measured', () => {
    const reasons = describeRoute(analysed, 25_000);
    expect(reasons.join(' ')).toContain('15% off-road');
    expect(reasons.join(' ')).toContain('66% of the distance has confirmed access');
    expect(reasons.join(' ')).toContain('28% has uncertain mapped access');
    // Must never contradict the card it sits under.
    expect(reasons.join(' ')).not.toContain('0% off-road');
  });

  it('says plainly when a route was never analysed', () => {
    const reasons = describeRoute(
      { ...analysed, analysis: { ...analysed.analysis, analysed: false } },
      25_000,
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/not been checked against mapped path data/i);
  });
});
