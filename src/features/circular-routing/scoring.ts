import type {
  AccessBreakdown,
  CoverageBreakdown,
  RouteAnalysis,
  RouteScoreComponents,
  RoutePreferences,
  SurfaceBreakdown,
} from '@/types/domain';

export const SCORE_WEIGHTS: Record<keyof RouteScoreComponents, number> = {
  distanceFit: 0.24,
  accessConfidence: 0.18,
  offRoadFit: 0.15,
  roadStressFit: 0.12,
  climbingFit: 0.1,
  surfaceFit: 0.08,
  routeUniqueness: 0.07,
  loopShapeQuality: 0.06,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 1 at the target distance, falling away linearly; 0 beyond ±35%. */
export function distanceFitScore(actualMetres: number, targetMetres: number): number {
  if (targetMetres <= 0) return 0;
  const error = Math.abs(actualMetres - targetMetres) / targetMetres;
  return clamp01(1 - error / 0.35);
}

export function accessConfidenceScore(
  access: AccessBreakdown,
  coverage: CoverageBreakdown,
): number {
  const permitted = (access.confirmedPercent + access.permissivePercent * 0.85) / 100;
  const penalty = (access.notConfirmedPercent * 1.2 + access.prohibitedPercent * 2) / 100;
  return clamp01(permitted * 0.75 + (coverage.accessDataPercent / 100) * 0.25 - penalty);
}

export function offRoadFitScore(
  surface: SurfaceBreakdown,
  preference: RoutePreferences['offRoad'],
): number {
  const offRoad = surface.offRoadPercent / 100;
  if (preference === 'maximise') return clamp01(offRoad);
  if (preference === 'minimise') return clamp01(1 - offRoad);
  return clamp01(1 - Math.abs(offRoad - 0.55) / 0.55);
}

export function roadStressScore(highStressPercent: number): number {
  return clamp01(1 - highStressPercent / 25);
}

export function climbingFitScore(
  ascentMetres: number,
  distanceMetres: number,
  preference: RoutePreferences['climbing'],
): number {
  if (distanceMetres <= 0) return 0;
  const metresPerKm = ascentMetres / (distanceMetres / 1000);
  const targets: Record<RoutePreferences['climbing'], number | null> = {
    low: 6,
    moderate: 14,
    high: 24,
    'no-preference': null,
  };
  const target = targets[preference];
  if (target === null) return clamp01(1 - Math.abs(metresPerKm - 14) / 30);
  return clamp01(1 - Math.abs(metresPerKm - target) / 20);
}

export function surfaceFitScore(
  surface: SurfaceBreakdown,
  preference: RoutePreferences['surface'],
): number {
  const paved = surface.pavedPercent / 100;
  const unpaved = surface.unpavedPercent / 100;
  const known = clamp01(paved + unpaved);
  if (preference === 'prefer-paved') return clamp01(paved * 0.85 + known * 0.15);
  if (preference === 'prefer-unpaved') return clamp01(unpaved * 0.85 + known * 0.15);
  if (preference === 'mixed') return clamp01(1 - Math.abs(paved - unpaved)) * 0.8 + known * 0.2;
  return clamp01(0.6 + known * 0.4);
}

/** Loops should not retrace themselves; 1 = no repetition. */
export function uniquenessScore(repeatedPercent: number): number {
  return clamp01(1 - repeatedPercent / 40);
}

/**
 * Loop-shape quality rewards a compact enclosing area relative to length
 * (a circle scores 1, an out-and-back line scores ~0).
 */
export function loopShapeScore(areaSqMetres: number, perimeterMetres: number): number {
  if (perimeterMetres <= 0) return 0;
  const isoperimetric = (4 * Math.PI * Math.abs(areaSqMetres)) / perimeterMetres ** 2;
  return clamp01(isoperimetric * 1.35);
}

export function totalScore(components: RouteScoreComponents): number {
  return (Object.keys(SCORE_WEIGHTS) as Array<keyof RouteScoreComponents>).reduce(
    (sum, key) => sum + components[key] * SCORE_WEIGHTS[key],
    0,
  );
}

export interface RationaleInput {
  components: RouteScoreComponents;
  analysis: RouteAnalysis;
  targetDistanceMetres?: number;
}

/** Human-readable explanation of why a candidate ranked where it did. */
export function buildRationale({
  components,
  analysis,
  targetDistanceMetres,
}: RationaleInput): string[] {
  const reasons: string[] = [];
  if (targetDistanceMetres) {
    const deltaPercent =
      ((analysis.distanceMetres - targetDistanceMetres) / targetDistanceMetres) * 100;
    reasons.push(
      Math.abs(deltaPercent) <= 10
        ? `Within ${Math.abs(deltaPercent).toFixed(0)}% of your target distance.`
        : `${deltaPercent > 0 ? 'Longer' : 'Shorter'} than requested by ${Math.abs(deltaPercent).toFixed(0)}%.`,
    );
  }
  reasons.push(`${analysis.surface.offRoadPercent.toFixed(0)}% off-road by distance.`);
  reasons.push(
    `${analysis.access.confirmedPercent.toFixed(0)}% of the distance has confirmed access for this activity.`,
  );
  if (analysis.access.uncertainPercent > 10) {
    reasons.push(`${analysis.access.uncertainPercent.toFixed(0)}% has uncertain mapped access.`);
  }
  if (components.routeUniqueness < 0.8) {
    reasons.push(`Retraces ${analysis.repeatedPercent.toFixed(0)}% of its own distance.`);
  }
  return reasons;
}
