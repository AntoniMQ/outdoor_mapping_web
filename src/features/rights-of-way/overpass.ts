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
export function buildOverpassQuery(bbox: BoundingBox, timeoutSeconds = 25): string {
  const [minLon, minLat, maxLon, maxLat] = bbox.map((v) => Number(v.toFixed(6)));
  const box = `${minLat},${minLon},${maxLat},${maxLon}`;
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    '(',
    `  way["designation"~"^(public_footpath|public_bridleway|restricted_byway|byway_open_to_all_traffic)$"](${box});`,
    `  way["highway"~"^(path|footway|bridleway|track|cycleway)$"](${box});`,
    `  way["highway"]["access"~"^(permissive|private|no)$"](${box});`,
    ');',
    'out tags geom;',
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
