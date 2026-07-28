import type { Coordinate, BoundingBox } from '@/types/domain';

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in metres between two [lon, lat] pairs. */
export function haversineMetres(a: Coordinate, b: Coordinate): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Length of a coordinate list in metres. */
export function lineLengthMetres(coordinates: readonly Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineMetres(coordinates[i - 1]!, coordinates[i]!);
  }
  return total;
}

/** Initial bearing in degrees (0-360) from a to b. */
export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given a start, bearing (degrees) and distance (metres). */
export function destination(
  origin: Coordinate,
  bearing: number,
  distanceMetres: number,
): Coordinate {
  const [lon, lat] = origin;
  const angular = distanceMetres / EARTH_RADIUS_M;
  const br = toRad(bearing);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [normaliseLongitude(toDeg(lon2)), toDeg(lat2)];
}

export function normaliseLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Smallest absolute difference between two bearings, in degrees (0-180). */
export function bearingDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export function boundingBoxOf(coordinates: readonly Coordinate[]): BoundingBox {
  if (coordinates.length === 0)
    throw new Error('Cannot compute a bounding box of zero coordinates');
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function padBoundingBox(bbox: BoundingBox, metres: number): BoundingBox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const latPad = metres / 111_320;
  const midLat = (minLat + maxLat) / 2;
  const lonPad = metres / (111_320 * Math.max(0.1, Math.cos(toRad(midLat))));
  return [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad];
}

/** Approximate bounding-box area in square kilometres. */
export function boundingBoxAreaSqKm(bbox: BoundingBox): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const heightKm = (maxLat - minLat) * 110.574;
  const widthKm = (maxLon - minLon) * 111.32 * Math.cos(toRad(midLat));
  return Math.abs(heightKm * widthKm);
}

export function bboxContains(bbox: BoundingBox, point: Coordinate): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return point[0] >= minLon && point[0] <= maxLon && point[1] >= minLat && point[1] <= maxLat;
}

export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Ramer-Douglas-Peucker simplification with a metre tolerance. */
export function simplify(coordinates: readonly Coordinate[], toleranceMetres = 4): Coordinate[] {
  if (coordinates.length <= 2) return [...coordinates];
  const keep = new Array<boolean>(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;
  const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistance = -1;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = perpendicularDistanceMetres(
        coordinates[i]!,
        coordinates[start]!,
        coordinates[end]!,
      );
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (maxDistance > toleranceMetres && index > 0) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return coordinates.filter((_, i) => keep[i]);
}

/** Distance from point p to the segment a-b, in metres (planar approximation). */
export function perpendicularDistanceMetres(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const scale = Math.cos(toRad(p[1]));
  const px = p[0] * scale;
  const py = p[1];
  const ax = a[0] * scale;
  const ay = a[1];
  const bx = b[0] * scale;
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const degrees = Math.hypot(px - cx, py - cy);
  return degrees * 111_320;
}

export interface NearestPointResult {
  distanceMetres: number;
  segmentIndex: number;
  point: Coordinate;
  fraction: number;
}

/** Nearest point on a polyline to p. */
export function nearestPointOnLine(line: readonly Coordinate[], p: Coordinate): NearestPointResult {
  let best: NearestPointResult = {
    distanceMetres: Number.POSITIVE_INFINITY,
    segmentIndex: 0,
    point: line[0] ?? p,
    fraction: 0,
  };
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const projected = projectOnSegment(p, a, b);
    const distance = haversineMetres(p, projected.point);
    if (distance < best.distanceMetres) {
      best = {
        distanceMetres: distance,
        segmentIndex: i - 1,
        point: projected.point,
        fraction: projected.t,
      };
    }
  }
  return best;
}

function projectOnSegment(
  p: Coordinate,
  a: Coordinate,
  b: Coordinate,
): { point: Coordinate; t: number } {
  const scale = Math.cos(toRad(p[1]));
  const ax = a[0] * scale;
  const ay = a[1];
  const bx = b[0] * scale;
  const by = b[1];
  const px = p[0] * scale;
  const py = p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { point: [(ax + t * dx) / scale, ay + t * dy], t };
}

/** Split a line into fixed-length chunks, returning the cumulative distance of each vertex. */
export function cumulativeDistances(coordinates: readonly Coordinate[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    out.push(out[i - 1]! + haversineMetres(coordinates[i - 1]!, coordinates[i]!));
  }
  return out;
}

/** Resample a line so vertices are at most `spacingMetres` apart. */
export function densify(coordinates: readonly Coordinate[], spacingMetres = 100): Coordinate[] {
  if (coordinates.length < 2) return [...coordinates];
  const out: Coordinate[] = [coordinates[0]!];
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const distance = haversineMetres(a, b);
    const steps = Math.floor(distance / spacingMetres);
    for (let s = 1; s <= steps; s += 1) {
      const t = (s * spacingMetres) / distance;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/** Evenly sample at most `maxPoints` positions along a line (keeps first and last). */
export function downsample(coordinates: readonly Coordinate[], maxPoints: number): Coordinate[] {
  if (coordinates.length <= maxPoints) return [...coordinates];
  const step = (coordinates.length - 1) / (maxPoints - 1);
  const out: Coordinate[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(coordinates[Math.round(i * step)]!);
  }
  return out;
}

export function coordinatesEqual(a: Coordinate, b: Coordinate, toleranceMetres = 1): boolean {
  return haversineMetres(a, b) <= toleranceMetres;
}

export function roundCoordinate([lon, lat]: Coordinate, decimals = 6): Coordinate {
  const factor = 10 ** decimals;
  return [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor];
}
