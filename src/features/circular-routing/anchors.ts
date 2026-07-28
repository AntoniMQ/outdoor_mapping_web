import type { CircularRouteRequest, Coordinate, LoopDirection } from '@/types/domain';
import { destination } from '@/lib/geo/geometry';
import { createRng } from '@/lib/geo/random';

export type LoopPattern =
  'triangle' | 'quadrilateral' | 'asymmetric-oval' | 'wide-loop' | 'compact-loop';

export interface AnchorCandidate {
  id: string;
  pattern: LoopPattern;
  startBearing: number;
  direction: 'clockwise' | 'anticlockwise';
  /** Radial distances (metres) for each anchor. */
  radii: number[];
  anchors: Coordinate[];
  /** Radius scaling applied so far — used by distance convergence. */
  scale: number;
}

const PATTERN_SHAPE: Record<
  LoopPattern,
  { anchorCount: number; angles: number[]; radiusFactors: number[]; circumferenceFactor: number }
> = {
  triangle: { anchorCount: 2, angles: [0, 120], radiusFactors: [1, 1], circumferenceFactor: 2.6 },
  quadrilateral: {
    anchorCount: 3,
    angles: [0, 90, 180],
    radiusFactors: [1, 1, 1],
    circumferenceFactor: 2.9,
  },
  'asymmetric-oval': {
    anchorCount: 3,
    angles: [0, 70, 150],
    radiusFactors: [1.25, 0.8, 1.05],
    circumferenceFactor: 2.7,
  },
  'wide-loop': {
    anchorCount: 3,
    angles: [0, 105, 200],
    radiusFactors: [1.15, 1.15, 0.9],
    circumferenceFactor: 2.5,
  },
  'compact-loop': {
    anchorCount: 2,
    angles: [0, 150],
    radiusFactors: [0.85, 0.85],
    circumferenceFactor: 3.1,
  },
};

const SHAPE_PREFERENCE: Record<CircularRouteRequest['loopShape'], LoopPattern[]> = {
  compact: ['compact-loop', 'triangle', 'quadrilateral'],
  wide: ['wide-loop', 'asymmetric-oval', 'quadrilateral'],
  adventure: ['asymmetric-oval', 'wide-loop', 'triangle', 'quadrilateral'],
};

export function baseRadiusMetres(targetDistanceMetres: number, pattern: LoopPattern): number {
  // A polygonal loop is shorter than a circle of the same radius, so the
  // circumference factor compensates per pattern.
  return targetDistanceMetres / PATTERN_SHAPE[pattern].circumferenceFactor / 2;
}

function resolveDirection(direction: LoopDirection, unit: number): 'clockwise' | 'anticlockwise' {
  if (direction === 'clockwise') return 'clockwise';
  if (direction === 'anticlockwise') return 'anticlockwise';
  return unit < 0.5 ? 'clockwise' : 'anticlockwise';
}

/**
 * Deterministic anchor generation. The same request always yields the same
 * candidate set, which keeps route generation reproducible and testable.
 */
export function generateAnchorCandidates(
  request: CircularRouteRequest,
  count = 24,
): AnchorCandidate[] {
  const rng = createRng(
    request.seed ??
      `${request.start[0].toFixed(4)}:${request.start[1].toFixed(4)}:${request.targetDistanceMetres}:${request.loopShape}:${request.activityProfile}`,
  );
  const patterns = SHAPE_PREFERENCE[request.loopShape];
  const candidates: AnchorCandidate[] = [];

  for (let index = 0; index < count; index += 1) {
    const pattern = patterns[index % patterns.length]!;
    const shape = PATTERN_SHAPE[pattern];
    const direction = resolveDirection(request.loopDirection, rng());
    const sign = direction === 'clockwise' ? 1 : -1;
    const startBearing = (index * (360 / count) + rng() * 22) % 360;
    const radius = baseRadiusMetres(request.targetDistanceMetres, pattern);

    const radii: number[] = [];
    const anchors: Coordinate[] = [];
    for (let a = 0; a < shape.anchorCount; a += 1) {
      const angleJitter = (rng() - 0.5) * 26;
      const radialJitter = 1 + (rng() - 0.5) * 0.3;
      const anchorRadius = radius * shape.radiusFactors[a]! * radialJitter;
      const bearing = (startBearing + sign * (shape.angles[a]! + angleJitter) + 360) % 360;
      radii.push(anchorRadius);
      anchors.push(destination(request.start, bearing, anchorRadius));
    }

    candidates.push({
      id: `${pattern}-${index}`,
      pattern,
      startBearing,
      direction,
      radii,
      anchors,
      scale: 1,
    });
  }

  return candidates;
}

/**
 * Distance convergence: rescale anchor radii toward the target distance.
 * The scale change is bounded so a single bad measurement cannot collapse
 * or explode the loop.
 */
export function rescaleCandidate(
  candidate: AnchorCandidate,
  start: Coordinate,
  achievedDistanceMetres: number,
  targetDistanceMetres: number,
): AnchorCandidate {
  const ratio = targetDistanceMetres / Math.max(1, achievedDistanceMetres);
  const bounded = Math.min(1.6, Math.max(0.6, ratio));
  const radii = candidate.radii.map((radius) => radius * bounded);
  const anchors = candidate.anchors.map((anchor, index) => {
    const bearing = bearingTo(start, anchor);
    return destination(start, bearing, radii[index]!);
  });
  return { ...candidate, radii, anchors, scale: candidate.scale * bounded };
}

function bearingTo(from: Coordinate, to: Coordinate): number {
  const dLon = ((to[0] - from[0]) * Math.PI) / 180;
  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
