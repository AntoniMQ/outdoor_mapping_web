import type { Coordinate, NormalisedRoute } from '@/types/domain';
import { densify } from '@/lib/geo/geometry';

export interface RouteSignature {
  wayIds: number[];
  cells: Set<string>;
}

/** Way-id signature first, spatial signature as the fallback. */
export function routeSignature(route: NormalisedRoute, cellMetres = 60): RouteSignature {
  const wayIds = route.segments
    .map((segment) => segment.osmWayId)
    .filter((id): id is number => typeof id === 'number');
  const cells = new Set<string>();
  const latCell = cellMetres / 111_320;
  for (const point of densify(route.geometry.coordinates as Coordinate[], cellMetres / 2)) {
    const lonCell = cellMetres / (111_320 * Math.max(0.2, Math.cos((point[1] * Math.PI) / 180)));
    cells.add(`${Math.round(point[0] / lonCell)}:${Math.round(point[1] / latCell)}`);
  }
  return { wayIds, cells };
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Overlap in [0,1]. Uses ordered way ids when both routes expose them. */
export function routeOverlap(a: RouteSignature, b: RouteSignature): number {
  if (a.wayIds.length > 0 && b.wayIds.length > 0) {
    const wayOverlap = jaccard(new Set(a.wayIds), new Set(b.wayIds));
    const spatialOverlap = jaccard(a.cells, b.cells);
    return Math.max(wayOverlap, spatialOverlap);
  }
  return jaccard(a.cells, b.cells);
}

export interface DedupeResult<T> {
  kept: T[];
  rejected: Array<{ item: T; overlapWith: number; overlap: number }>;
}

/** Greedy deduplication — keeps the first (highest ranked) of each similar group. */
export function dedupeRoutes<T extends { route: NormalisedRoute }>(
  items: readonly T[],
  maxOverlap = 0.65,
): DedupeResult<T> {
  const kept: T[] = [];
  const keptSignatures: RouteSignature[] = [];
  const rejected: DedupeResult<T>['rejected'] = [];

  items.forEach((item) => {
    const signature = routeSignature(item.route);
    let worstIndex = -1;
    let worstOverlap = 0;
    keptSignatures.forEach((existing, index) => {
      const overlap = routeOverlap(signature, existing);
      if (overlap > worstOverlap) {
        worstOverlap = overlap;
        worstIndex = index;
      }
    });
    if (worstOverlap > maxOverlap) {
      rejected.push({ item, overlapWith: worstIndex, overlap: worstOverlap });
      return;
    }
    kept.push(item);
    keptSignatures.push(signature);
  });

  return { kept, rejected };
}
