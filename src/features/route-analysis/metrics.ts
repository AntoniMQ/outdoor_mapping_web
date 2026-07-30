import type {
  AccessBreakdown,
  Coordinate,
  CoverageBreakdown,
  DesignationBreakdown,
  OsmPathTags,
  PathClassification,
  SurfaceBreakdown,
} from '@/types/domain';
import { isRoad } from '@/features/rights-of-way/access-policy';
import { densify } from '@/lib/geo/geometry';

export interface NearbyNetwork {
  /** Off-road ways a cyclist may use: bridleways, byways, cycleways, explicit permission. */
  cycleLegalKm: number;
  /** Off-road ways that are walking-only, chiefly public footpaths. */
  footpathOnlyKm: number;
  /** Off-road ways whose status OpenStreetMap does not record. */
  unknownKm: number;
  /** Carriageways, which cyclists may use but which are not off-road. */
  roadKm: number;
}

export interface AnalysedSegment {
  index: number;
  distanceMetres: number;
  tags?: OsmPathTags;
  classification?: PathClassification;
  matchSource: 'provider-tags' | 'osm-way-id' | 'spatial' | 'manual' | 'unmatched';
}

const pct = (part: number, total: number): number => (total <= 0 ? 0 : (part / total) * 100);

export function totalDistance(segments: readonly AnalysedSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.distanceMetres, 0);
}

/**
 * Summarises the mapped network around a route, so a road-heavy result can be
 * explained rather than left looking like a routing failure. An area with one
 * bridleway and thirty public footpaths cannot produce an off-road ride,
 * however the preferences are set.
 */
export function summariseNearbyNetwork(
  features: ReadonlyArray<{
    tags: OsmPathTags;
    classification: PathClassification;
    lengthMetres: number;
  }>,
): NearbyNetwork {
  const totals = { cycleLegalKm: 0, footpathOnlyKm: 0, unknownKm: 0, roadKm: 0 };
  for (const feature of features) {
    const km = feature.lengthMetres / 1000;
    if (isRoad(feature.tags)) {
      totals.roadKm += km;
      continue;
    }
    const status = feature.classification.cycling.cyclingStatus;
    if (status === 'confirmed' || status === 'permissive') totals.cycleLegalKm += km;
    else if (status === 'not-confirmed' || status === 'prohibited') totals.footpathOnlyKm += km;
    else totals.unknownKm += km;
  }
  return {
    cycleLegalKm: Number(totals.cycleLegalKm.toFixed(1)),
    footpathOnlyKm: Number(totals.footpathOnlyKm.toFixed(1)),
    unknownKm: Number(totals.unknownKm.toFixed(1)),
    roadKm: Number(totals.roadKm.toFixed(1)),
  };
}

/** All percentages are weighted by segment distance, never by feature count. */
export function surfaceBreakdown(segments: readonly AnalysedSegment[]): SurfaceBreakdown {
  const total = totalDistance(segments);
  let paved = 0;
  let unpaved = 0;
  let unknown = 0;
  let offRoad = 0;
  for (const segment of segments) {
    const surface = segment.classification?.surfaceClass ?? 'unknown';
    if (surface === 'paved') paved += segment.distanceMetres;
    else if (surface === 'unpaved') unpaved += segment.distanceMetres;
    else unknown += segment.distanceMetres;
    if (segment.tags && !isRoad(segment.tags)) offRoad += segment.distanceMetres;
  }
  return {
    pavedPercent: pct(paved, total),
    unpavedPercent: pct(unpaved, total),
    unknownPercent: pct(unknown, total),
    offRoadPercent: pct(offRoad, total),
  };
}

export function designationBreakdown(segments: readonly AnalysedSegment[]): DesignationBreakdown {
  const total = totalDistance(segments);
  const buckets: Record<string, number> = {};
  for (const segment of segments) {
    const category = segment.classification?.category ?? 'unknown';
    buckets[category] = (buckets[category] ?? 0) + segment.distanceMetres;
  }
  return {
    publicFootpathPercent: pct(buckets.public_footpath ?? 0, total),
    publicBridlewayPercent: pct(buckets.public_bridleway ?? 0, total),
    restrictedBywayPercent: pct(buckets.restricted_byway ?? 0, total),
    bywayOpenToAllTrafficPercent: pct(buckets.byway_open_to_all_traffic ?? 0, total),
    permissivePercent: pct(buckets.permissive ?? 0, total),
    roadPercent: pct((buckets.road ?? 0) + (buckets.cycleway ?? 0), total),
    otherPercent: pct((buckets.track ?? 0) + (buckets.unknown ?? 0), total),
  };
}

export function accessBreakdown(
  segments: readonly AnalysedSegment[],
  mode: 'cycling' | 'walking' = 'cycling',
): AccessBreakdown {
  const total = totalDistance(segments);
  const buckets: Record<string, number> = {};
  for (const segment of segments) {
    const classification = segment.classification;
    const status = classification
      ? mode === 'cycling'
        ? classification.cycling.cyclingStatus
        : classification.walking.status
      : 'uncertain';
    buckets[status] = (buckets[status] ?? 0) + segment.distanceMetres;
  }
  return {
    confirmedPercent: pct(buckets.confirmed ?? 0, total),
    permissivePercent: pct(buckets.permissive ?? 0, total),
    uncertainPercent: pct(buckets.uncertain ?? 0, total),
    notConfirmedPercent: pct(buckets['not-confirmed'] ?? 0, total),
    prohibitedPercent: pct(buckets.prohibited ?? 0, total),
  };
}

export function coverageBreakdown(segments: readonly AnalysedSegment[]): CoverageBreakdown {
  const total = totalDistance(segments);
  let access = 0;
  let surface = 0;
  let technical = 0;
  for (const segment of segments) {
    const tags = segment.tags;
    const confidence = segment.classification?.cycling.confidence;
    if (tags && confidence && confidence !== 'unknown') access += segment.distanceMetres;
    if (tags?.surface || tags?.tracktype) surface += segment.distanceMetres;
    if (tags?.['mtb:scale'] || tags?.smoothness || tags?.sac_scale || tags?.trail_visibility) {
      technical += segment.distanceMetres;
    }
  }
  return {
    accessDataPercent: pct(access, total),
    surfaceDataPercent: pct(surface, total),
    technicalDataPercent: pct(technical, total),
  };
}

/**
 * Fraction of a route that revisits ground it has already covered.
 * Uses a coarse spatial grid so direction and small offsets do not matter.
 */
export function repeatedFraction(coordinates: readonly Coordinate[], cellMetres = 40): number {
  if (coordinates.length < 2) return 0;
  const dense = densify(coordinates, cellMetres / 2);
  const seen = new Set<string>();
  let repeated = 0;
  let total = 0;
  let previousKey: string | null = null;
  const latCell = cellMetres / 111_320;
  for (const point of dense) {
    const lonCell = cellMetres / (111_320 * Math.max(0.2, Math.cos((point[1] * Math.PI) / 180)));
    const key = `${Math.round(point[0] / lonCell)}:${Math.round(point[1] / latCell)}`;
    // Consecutive samples inside the same cell are the same piece of ground,
    // not a revisit — only count a cell the first time it is entered.
    if (key === previousKey) continue;
    previousKey = key;
    total += 1;
    if (seen.has(key)) repeated += 1;
    else seen.add(key);
  }
  return total === 0 ? 0 : repeated / total;
}
