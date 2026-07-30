import type {
  BoundingBox,
  Coordinate,
  Jurisdiction,
  OsmPathTags,
  RightsOfWayCollection,
  RightsOfWayFeature,
} from '@/types/domain';
import { classifyPath } from '@/features/rights-of-way/access-policy';

/** Tags copied from Overpass results. Everything else is discarded to keep payloads small. */
export const RETAINED_TAGS = [
  'highway',
  'designation',
  'access',
  'foot',
  'bicycle',
  'horse',
  'motor_vehicle',
  'vehicle',
  'surface',
  'tracktype',
  'smoothness',
  'width',
  'incline',
  'mtb:scale',
  'trail_visibility',
  'sac_scale',
  'name',
  'ref',
  'prow_ref',
  'operator',
  'lit',
  'bridge',
  'tunnel',
  'ford',
] as const;

/**
 * Bounded Overpass QL query. Only ways that are plausibly rights of way or
 * off-road links are requested, and only within the supplied bounding box.
 */
export function buildOverpassQuery(
  bbox: BoundingBox,
  timeoutSeconds = 25,
  options: { includeRoads?: boolean } = {},
): string {
  const [minLon, minLat, maxLon, maxLat] = bbox.map((v) => Number(v.toFixed(6)));
  const box = `${minLat},${minLon},${maxLat},${maxLon}`;
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    '(',
    `  way["designation"~"^(public_footpath|public_bridleway|restricted_byway|byway_open_to_all_traffic)$"](${box});`,
    `  way["highway"~"^(path|footway|bridleway|track|cycleway)$"](${box});`,
    `  way["highway"]["access"~"^(permissive|private|no)$"](${box});`,
    // Carriageways are only requested for route analysis: without them every
    // road section of a route is unmatched and reported as "uncertain access",
    // which is both wrong and alarming. The map overlay omits them to keep
    // payloads small.
    ...(options.includeRoads
      ? [
          `  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)$"](${box});`,
        ]
      : []),
    ');',
    'out tags geom;',
  ].join('\n');
}

/**
 * Corridor query: everything within `radiusMetres` of the supplied polyline.
 *
 * For route analysis this is strictly better than a bounding box — a 100 km
 * loop has a ~900 km² bbox but only a few km² of corridor, so the query stays
 * small no matter how long the route is.
 */
export function buildOverpassCorridorQuery(
  coordinates: ReadonlyArray<readonly [number, number]>,
  radiusMetres = 30,
  timeoutSeconds = 25,
  options: { includeRoads?: boolean } = {},
): string {
  const points = coordinates.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',');
  const around = `(around:${Math.round(radiusMetres)},${points})`;
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    '(',
    `  way["highway"]${around};`,
    ');',
    'out tags geom;',
    // `options` is accepted for symmetry with buildOverpassQuery; a corridor is
    // already tight enough that filtering by highway type saves little.
    ...(options.includeRoads === false ? [] : []),
  ].join('\n');
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassResponse {
  elements?: OverpassWay[];
  osm3s?: { timestamp_osm_base?: string };
}

export function pickRetainedTags(tags: Record<string, string> | undefined): OsmPathTags {
  const out: OsmPathTags = {};
  if (!tags) return out;
  for (const key of RETAINED_TAGS) {
    const value = tags[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Convert an Overpass `out geom` response into classified GeoJSON. */
export function overpassToFeatureCollection(
  response: OverpassResponse,
  options: {
    jurisdiction?: Jurisdiction;
    limit?: number;
    source?: 'osm-overpass' | 'osm-postgis';
  } = {},
): RightsOfWayCollection {
  const jurisdiction = options.jurisdiction ?? 'england-wales';
  const limit = options.limit ?? 3_000;
  const features: RightsOfWayFeature[] = [];

  for (const element of response.elements ?? []) {
    if (features.length >= limit) break;
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
    const tags = pickRetainedTags(element.tags);
    if (!tags.highway && !tags.designation) continue;
    const coordinates: Coordinate[] = element.geometry.map((p) => [p.lon, p.lat]);
    features.push({
      type: 'Feature',
      id: `way/${element.id}`,
      geometry: { type: 'LineString', coordinates },
      properties: {
        osmType: 'way',
        osmId: element.id,
        tags,
        classification: classifyPath(tags, jurisdiction),
        source: options.source ?? 'osm-overpass',
        sourceUpdatedAt: response.osm3s?.timestamp_osm_base,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
