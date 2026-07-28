import type { Coordinate, ElevationPoint, ElevationProfile } from '@/types/domain';
import { cumulativeDistances } from '@/lib/geo/geometry';

/** Builds a profile (with ascent/descent) from coordinates and matching elevations. */
export function buildProfile(
  coordinates: readonly Coordinate[],
  elevations: readonly number[],
  source: string,
  isSyntheticData: boolean,
): ElevationProfile {
  const distances = cumulativeDistances(coordinates);
  const points: ElevationPoint[] = coordinates.map((coordinate, index) => ({
    coordinate,
    distanceMetres: distances[index] ?? 0,
    elevationMetres: elevations[index] ?? elevations[elevations.length - 1] ?? 0,
  }));

  let ascentMetres = 0;
  let descentMetres = 0;
  // Small threshold suppresses sampling noise being reported as real climbing.
  const threshold = 1.5;
  let reference = points[0]?.elevationMetres ?? 0;
  for (const point of points) {
    const delta = point.elevationMetres - reference;
    if (Math.abs(delta) < threshold) continue;
    if (delta > 0) ascentMetres += delta;
    else descentMetres -= delta;
    reference = point.elevationMetres;
  }

  const values = points.map((p) => p.elevationMetres);
  return {
    points,
    ascentMetres,
    descentMetres,
    minElevationMetres: values.length ? Math.min(...values) : 0,
    maxElevationMetres: values.length ? Math.max(...values) : 0,
    source,
    isSyntheticData,
  };
}
