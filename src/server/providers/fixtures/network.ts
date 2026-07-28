import type { BoundingBox, Coordinate, OsmPathTags } from '@/types/domain';
import { haversineMetres } from '@/lib/geo/geometry';
import { pickWeighted, unitHash } from '@/lib/geo/random';

/**
 * Deterministic synthetic path network used by fixture mode.
 *
 * The network is an infinite lattice defined purely as a function of integer
 * grid indices, so every provider (routing, rights of way, elevation) sees the
 * same world for the same coordinates without any shared state or fixtures on
 * disk. All values are SYNTHETIC and must never be presented as OSM data.
 */

export const LON_STEP = 0.0062;
export const LAT_STEP = 0.004;
export const SYNTHETIC_WAY_ID_BASE = 900_000_000;

export interface NetworkNode {
  i: number;
  j: number;
  coordinate: Coordinate;
}

export interface NetworkEdge {
  wayId: number;
  from: NetworkNode;
  to: NetworkNode;
  coordinates: Coordinate[];
  lengthMetres: number;
  tags: OsmPathTags;
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Tag templates, ordered so every rights-of-way class appears in the fixture world. */
const TAG_TEMPLATES: ReadonlyArray<readonly [OsmPathTags, number]> = [
  [
    {
      highway: 'track',
      designation: 'public_bridleway',
      surface: 'compacted',
      tracktype: 'grade3',
      prow_ref: 'FX/1',
    },
    14,
  ],
  [
    {
      highway: 'path',
      designation: 'public_bridleway',
      surface: 'ground',
      'mtb:scale': '1',
      trail_visibility: 'good',
    },
    10,
  ],
  [{ highway: 'footway', designation: 'public_footpath', surface: 'ground', foot: 'yes' }, 13],
  [{ highway: 'path', designation: 'public_footpath', surface: 'grass' }, 8],
  [
    {
      highway: 'track',
      designation: 'restricted_byway',
      surface: 'gravel',
      tracktype: 'grade2',
      motor_vehicle: 'no',
    },
    5,
  ],
  [
    {
      highway: 'track',
      designation: 'byway_open_to_all_traffic',
      surface: 'dirt',
      tracktype: 'grade4',
    },
    4,
  ],
  [
    {
      highway: 'path',
      access: 'permissive',
      bicycle: 'permissive',
      surface: 'compacted',
      operator: 'Fixture Estate',
    },
    5,
  ],
  [{ highway: 'path', surface: 'ground' }, 7],
  [{ highway: 'track' }, 6],
  [{ highway: 'cycleway', surface: 'asphalt', bicycle: 'designated' }, 4],
  [{ highway: 'unclassified', surface: 'asphalt' }, 9],
  [{ highway: 'residential', surface: 'asphalt', lit: 'yes' }, 5],
  [{ highway: 'tertiary', surface: 'asphalt' }, 4],
  [{ highway: 'secondary', surface: 'asphalt' }, 2],
  [{ highway: 'primary', surface: 'asphalt' }, 1],
  [{ highway: 'path', access: 'private', bicycle: 'no' }, 2],
  [{ highway: 'bridleway', surface: 'dirt', 'mtb:scale': '2' }, 6],
  [{ highway: 'service', surface: 'gravel' }, 3],
];

export function nodeAt(i: number, j: number): NetworkNode {
  const jitterLon = (unitHash(i, j, 11) - 0.5) * LON_STEP * 0.45;
  const jitterLat = (unitHash(i, j, 23) - 0.5) * LAT_STEP * 0.45;
  return { i, j, coordinate: [i * LON_STEP + jitterLon, j * LAT_STEP + jitterLat] };
}

export function nearestNode(coordinate: Coordinate): NetworkNode {
  const i = Math.round(coordinate[0] / LON_STEP);
  const j = Math.round(coordinate[1] / LAT_STEP);
  let best = nodeAt(i, j);
  let bestDistance = haversineMetres(coordinate, best.coordinate);
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      const candidate = nodeAt(i + di, j + dj);
      const distance = haversineMetres(coordinate, candidate.coordinate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function edgeExists(i: number, j: number, dirIndex: number): boolean {
  const roll = unitHash(i, j, dirIndex, 7);
  // Orthogonal links are dense; diagonals are sparser, producing an irregular network.
  return dirIndex < 2 ? roll > 0.08 : roll > 0.62;
}

export function edgeTags(i: number, j: number, dirIndex: number): OsmPathTags {
  const template = pickWeighted(TAG_TEMPLATES, unitHash(i, j, dirIndex, 31));
  const tags: OsmPathTags = { ...template };
  const nameRoll = unitHash(i, j, dirIndex, 47);
  if (nameRoll > 0.55) {
    tags.name = `${FIXTURE_NAMES[Math.floor(nameRoll * FIXTURE_NAMES.length) % FIXTURE_NAMES.length]}`;
  }
  if (unitHash(i, j, dirIndex, 53) > 0.94) tags.ford = 'yes';
  if (unitHash(i, j, dirIndex, 59) > 0.97) tags.bridge = 'yes';
  return tags;
}

/** Deliberately fictional names so no real path is given fabricated legal metadata. */
const FIXTURE_NAMES = [
  'Demo Coppice Track',
  'Sample Ridge Path',
  'Fixture Common Byway',
  'Synthetic Mill Lane',
  'Example Beacon Trail',
  'Demo Waterworks Path',
];

export function edgeId(i: number, j: number, dirIndex: number): number {
  return (
    SYNTHETIC_WAY_ID_BASE +
    (Math.abs((i * 73856093) ^ (j * 19349663) ^ (dirIndex * 83492791)) % 89_999_999)
  );
}

function buildEdge(i: number, j: number, dirIndex: number): NetworkEdge {
  const dir = DIRECTIONS[dirIndex]!;
  const from = nodeAt(i, j);
  const to = nodeAt(i + dir[0], j + dir[1]);
  const bend = (unitHash(i, j, dirIndex, 67) - 0.5) * 0.35;
  const mid: Coordinate = [
    (from.coordinate[0] + to.coordinate[0]) / 2 + bend * LAT_STEP,
    (from.coordinate[1] + to.coordinate[1]) / 2 - bend * LON_STEP,
  ];
  const coordinates: Coordinate[] = [from.coordinate, mid, to.coordinate];
  return {
    wayId: edgeId(i, j, dirIndex),
    from,
    to,
    coordinates,
    lengthMetres: haversineMetres(from.coordinate, mid) + haversineMetres(mid, to.coordinate),
    tags: edgeTags(i, j, dirIndex),
  };
}

/** All edges incident to a node (both directions). */
export function edgesFromNode(node: NetworkNode): NetworkEdge[] {
  const out: NetworkEdge[] = [];
  for (let d = 0; d < DIRECTIONS.length; d += 1) {
    const dir = DIRECTIONS[d]!;
    if (edgeExists(node.i, node.j, d)) out.push(buildEdge(node.i, node.j, d));
    const bi = node.i - dir[0];
    const bj = node.j - dir[1];
    if (edgeExists(bi, bj, d)) {
      const edge = buildEdge(bi, bj, d);
      out.push({
        ...edge,
        from: edge.to,
        to: edge.from,
        coordinates: [...edge.coordinates].reverse(),
      });
    }
  }
  return out;
}

/** Every edge whose geometry intersects the bounding box. */
export function edgesInBoundingBox(bbox: BoundingBox, limit = 4_000): NetworkEdge[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const iMin = Math.floor(minLon / LON_STEP) - 1;
  const iMax = Math.ceil(maxLon / LON_STEP) + 1;
  const jMin = Math.floor(minLat / LAT_STEP) - 1;
  const jMax = Math.ceil(maxLat / LAT_STEP) + 1;
  const out: NetworkEdge[] = [];
  for (let i = iMin; i <= iMax && out.length < limit; i += 1) {
    for (let j = jMin; j <= jMax && out.length < limit; j += 1) {
      for (let d = 0; d < DIRECTIONS.length; d += 1) {
        if (!edgeExists(i, j, d)) continue;
        const edge = buildEdge(i, j, d);
        const touches = edge.coordinates.some(
          ([lon, lat]) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
        );
        if (touches) out.push(edge);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/** Smooth synthetic terrain model — deterministic and continuous. */
export function syntheticElevation([lon, lat]: Coordinate): number {
  // Wavelengths are chosen so a 15 km loop crosses several ridges and valleys.
  const regional = Math.sin(lon * 9.1) * Math.cos(lat * 7.7) * 70;
  const ridges = Math.sin(lon * 121 + lat * 37) * 46;
  const valleys = Math.cos(lat * 168 - lon * 29) * 32;
  const detail = Math.sin((lon + lat) * 640) * 7;
  return 110 + regional + ridges + valleys + detail;
}

export function tagsForWayId(
  wayId: number,
  near: Coordinate,
  radiusMetres = 3_000,
): OsmPathTags | undefined {
  const bbox: BoundingBox = [
    near[0] - radiusMetres / 70_000,
    near[1] - radiusMetres / 111_000,
    near[0] + radiusMetres / 70_000,
    near[1] + radiusMetres / 111_000,
  ];
  return edgesInBoundingBox(bbox).find((edge) => edge.wayId === wayId)?.tags;
}
