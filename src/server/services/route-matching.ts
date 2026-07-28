import type {
  Coordinate,
  NormalisedRoute,
  OsmPathTags,
  RightsOfWayCollection,
  Jurisdiction,
} from '@/types/domain';
import {
  bearingDegrees,
  bearingDifference,
  haversineMetres,
  nearestPointOnLine,
} from '@/lib/geo/geometry';
import { classifyPath } from '@/features/rights-of-way/access-policy';
import type { AnalysedSegment } from '@/features/route-analysis/metrics';

export interface MatchOptions {
  toleranceMetres?: number;
  /** Maximum bearing difference for a spatial match, in degrees. */
  bearingToleranceDegrees?: number;
  jurisdiction?: Jurisdiction;
}

export interface MatchDebugEntry {
  segmentIndex: number;
  matchSource: AnalysedSegment['matchSource'];
  osmId?: number;
  distanceMetres?: number;
  bearingDeltaDegrees?: number;
}

export interface MatchResult {
  segments: AnalysedSegment[];
  debug: MatchDebugEntry[];
  matchedDistanceMetres: number;
}

/**
 * Route → OSM matching hierarchy:
 *   1. tags supplied directly by the routing provider,
 *   2. OSM way identifiers returned by the provider,
 *   3. spatial matching with a distance *and* bearing test.
 * Ambiguous sections stay unmatched rather than being guessed.
 */
export function matchRouteToRightsOfWay(
  route: NormalisedRoute,
  features: RightsOfWayCollection,
  options: MatchOptions = {},
): MatchResult {
  const tolerance = options.toleranceMetres ?? 18;
  const bearingTolerance = options.bearingToleranceDegrees ?? 42;
  const jurisdiction = options.jurisdiction ?? 'england-wales';

  const byWayId = new Map<number, OsmPathTags>();
  for (const feature of features.features) {
    byWayId.set(feature.properties.osmId, feature.properties.tags);
  }

  const segments: AnalysedSegment[] = [];
  const debug: MatchDebugEntry[] = [];
  let matchedDistanceMetres = 0;

  for (const segment of route.segments) {
    const midpoint = midpointOf(segment.coordinates);
    let tags: OsmPathTags | undefined;
    let matchSource: AnalysedSegment['matchSource'] = 'unmatched';
    let osmId: number | undefined;
    let matchDistance: number | undefined;
    let bearingDelta: number | undefined;

    if (segment.tags && Object.keys(segment.tags).length > 0) {
      tags = segment.tags;
      matchSource = 'provider-tags';
      osmId = segment.osmWayId;
    } else if (segment.osmWayId !== undefined && byWayId.has(segment.osmWayId)) {
      tags = byWayId.get(segment.osmWayId);
      matchSource = 'osm-way-id';
      osmId = segment.osmWayId;
    } else if (midpoint) {
      const spatial = spatialMatch(segment.coordinates, features, tolerance, bearingTolerance);
      if (spatial) {
        tags = spatial.tags;
        matchSource = 'spatial';
        osmId = spatial.osmId;
        matchDistance = spatial.distanceMetres;
        bearingDelta = spatial.bearingDelta;
      }
    }

    if (tags) matchedDistanceMetres += segment.distanceMetres;
    segments.push({
      index: segment.index,
      distanceMetres: segment.distanceMetres,
      tags,
      classification: tags ? classifyPath(tags, jurisdiction) : undefined,
      matchSource,
    });
    debug.push({
      segmentIndex: segment.index,
      matchSource,
      osmId,
      distanceMetres: matchDistance,
      bearingDeltaDegrees: bearingDelta,
    });
  }

  return { segments, debug, matchedDistanceMetres };
}

function midpointOf(coordinates: readonly Coordinate[]): Coordinate | undefined {
  if (coordinates.length === 0) return undefined;
  return coordinates[Math.floor(coordinates.length / 2)];
}

function segmentBearing(coordinates: readonly Coordinate[]): number | undefined {
  if (coordinates.length < 2) return undefined;
  return bearingDegrees(coordinates[0]!, coordinates[coordinates.length - 1]!);
}

function spatialMatch(
  coordinates: readonly Coordinate[],
  features: RightsOfWayCollection,
  tolerance: number,
  bearingTolerance: number,
): { tags: OsmPathTags; osmId: number; distanceMetres: number; bearingDelta: number } | null {
  const midpoint = midpointOf(coordinates);
  if (!midpoint) return null;
  const routeBearing = segmentBearing(coordinates);

  let best: {
    tags: OsmPathTags;
    osmId: number;
    distanceMetres: number;
    bearingDelta: number;
  } | null = null;
  let runnerUpDistance = Number.POSITIVE_INFINITY;

  for (const feature of features.features) {
    const line = feature.geometry.coordinates as Coordinate[];
    if (line.length < 2) continue;
    // Cheap rejection before the expensive projection.
    if (haversineMetres(midpoint, line[0]!) > 5_000) continue;
    const nearest = nearestPointOnLine(line, midpoint);
    if (nearest.distanceMetres > tolerance) continue;

    let bearingDelta = 0;
    if (routeBearing !== undefined) {
      const a = line[Math.max(0, nearest.segmentIndex)]!;
      const b = line[Math.min(line.length - 1, nearest.segmentIndex + 1)]!;
      const featureBearing = bearingDegrees(a, b);
      bearingDelta = Math.min(
        bearingDifference(routeBearing, featureBearing),
        bearingDifference(routeBearing, (featureBearing + 180) % 360),
      );
      if (bearingDelta > bearingTolerance) continue;
    }

    if (!best || nearest.distanceMetres < best.distanceMetres) {
      if (best) runnerUpDistance = best.distanceMetres;
      best = {
        tags: feature.properties.tags,
        osmId: feature.properties.osmId,
        distanceMetres: nearest.distanceMetres,
        bearingDelta,
      };
    } else if (nearest.distanceMetres < runnerUpDistance) {
      runnerUpDistance = nearest.distanceMetres;
    }
  }

  // Ambiguous: a parallel way is essentially as close, so do not guess.
  if (best && runnerUpDistance - best.distanceMetres < 4) return null;
  return best;
}
