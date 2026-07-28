import type {
  AccessAssessment,
  AccessConfidence,
  CyclingStatus,
  Designation,
  Jurisdiction,
  OsmPathTags,
  PathClassification,
  RightsOfWayCategory,
  SurfaceClass,
} from '@/types/domain';

/**
 * Access classification engine.
 *
 * Design rules (see docs/RIGHTS_OF_WAY.md):
 *  - physical path type, legal designation and mode access are separate concepts;
 *  - explicit prohibitions always win;
 *  - missing data is never silently converted into permission;
 *  - England-and-Wales legal assumptions are only applied inside that jurisdiction.
 */

const NO_VALUES = new Set([
  'no',
  'private',
  'discouraged',
  'restricted',
  'military',
  'destination_only',
]);
const HARD_NO_VALUES = new Set(['no', 'private']);
const YES_VALUES = new Set(['yes', 'designated', 'official', 'public', 'permitted']);
const PERMISSIVE_VALUES = new Set(['permissive', 'customers', 'destination']);

const PAVED_SURFACES = new Set([
  'paved',
  'asphalt',
  'concrete',
  'concrete:lanes',
  'concrete:plates',
  'paving_stones',
  'sett',
  'cobblestone',
  'metal',
  'wood',
  'chipseal',
  'unhewn_cobblestone',
]);
const UNPAVED_SURFACES = new Set([
  'unpaved',
  'compacted',
  'fine_gravel',
  'gravel',
  'pebblestone',
  'rock',
  'dirt',
  'earth',
  'grass',
  'grass_paver',
  'ground',
  'mud',
  'sand',
  'woodchips',
  'snow',
  'ice',
  'salt',
  'clay',
]);

const ROAD_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
]);

const HIGH_STRESS_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
]);

export const RECOGNISED_DESIGNATIONS: Record<string, Designation> = {
  public_footpath: 'public_footpath',
  public_bridleway: 'public_bridleway',
  restricted_byway: 'restricted_byway',
  byway_open_to_all_traffic: 'byway_open_to_all_traffic',
  // Common OSM synonyms encountered in UK data.
  byway: 'byway_open_to_all_traffic',
  boat: 'byway_open_to_all_traffic',
};

export function normaliseDesignation(raw: string | undefined): Designation {
  if (!raw) return 'none';
  const first = raw.split(';')[0]!.trim().toLowerCase();
  return RECOGNISED_DESIGNATIONS[first] ?? 'other';
}

export function classifySurface(tags: OsmPathTags): SurfaceClass {
  const surface = tags.surface?.split(';')[0]?.trim().toLowerCase();
  if (surface) {
    if (PAVED_SURFACES.has(surface)) return 'paved';
    if (UNPAVED_SURFACES.has(surface)) return 'unpaved';
  }
  if (tags.tracktype) return tags.tracktype === 'grade1' ? 'paved' : 'unpaved';
  if (tags.highway === 'cycleway' || (tags.highway && ROAD_HIGHWAYS.has(tags.highway))) {
    // Sealed by convention in Great Britain, but this is an inference, not mapped data.
    return tags.highway === 'service' || tags.highway === 'road' ? 'unknown' : 'paved';
  }
  return 'unknown';
}

export function isHighStressRoad(tags: OsmPathTags): boolean {
  return Boolean(tags.highway && HIGH_STRESS_HIGHWAYS.has(tags.highway));
}

export function isRoad(tags: OsmPathTags): boolean {
  return Boolean(tags.highway && ROAD_HIGHWAYS.has(tags.highway));
}

/** Off-road means "not a motor-traffic carriageway". */
export function isOffRoad(tags: OsmPathTags): boolean {
  if (!tags.highway) return false;
  return !ROAD_HIGHWAYS.has(tags.highway);
}

function tagValue(raw: string | undefined): string | undefined {
  return raw?.split(';')[0]?.trim().toLowerCase();
}

/**
 * Mode access assessment following the documented precedence:
 * 1. explicit prohibition, 2. explicit permission, 3. legal designation,
 * 4. mode-specific tags, 5. physical highway fallback, 6. unknown.
 */
export function assessCyclingAccess(
  tags: OsmPathTags,
  jurisdiction: Jurisdiction,
): AccessAssessment {
  const reasons: string[] = [];
  const designation = normaliseDesignation(tags.designation);
  const bicycle = tagValue(tags.bicycle);
  const access = tagValue(tags.access);
  const vehicle = tagValue(tags.vehicle);
  const highway = tagValue(tags.highway);

  // 1. Explicit prohibitions.
  if (bicycle && NO_VALUES.has(bicycle)) {
    reasons.push(`bicycle=${bicycle} explicitly restricts cycling.`);
    return { cyclingStatus: 'prohibited', confidence: 'high', reasons, source: 'osm' };
  }
  if (access && HARD_NO_VALUES.has(access) && !(bicycle && YES_VALUES.has(bicycle))) {
    reasons.push(`access=${access} applies to all users unless a mode tag overrides it.`);
    return { cyclingStatus: 'prohibited', confidence: 'high', reasons, source: 'osm' };
  }
  if (vehicle && HARD_NO_VALUES.has(vehicle) && !bicycle) {
    reasons.push(`vehicle=${vehicle} covers cycles unless bicycle=* states otherwise.`);
    return { cyclingStatus: 'prohibited', confidence: 'medium', reasons, source: 'osm' };
  }

  // 2. Explicit permission.
  if (bicycle && YES_VALUES.has(bicycle)) {
    reasons.push(`bicycle=${bicycle} explicitly permits cycling.`);
    const hasDesignation = designation !== 'none' && designation !== 'other';
    if (hasDesignation) reasons.push(`Recorded as ${humaniseDesignation(designation)}.`);
    return {
      cyclingStatus: 'confirmed',
      confidence: hasDesignation ? 'high' : 'medium',
      reasons,
      source: 'osm',
    };
  }
  if (bicycle && PERMISSIVE_VALUES.has(bicycle)) {
    reasons.push(`bicycle=${bicycle} indicates permissive rather than statutory access.`);
    return { cyclingStatus: 'permissive', confidence: 'medium', reasons, source: 'osm' };
  }
  if (access && PERMISSIVE_VALUES.has(access)) {
    reasons.push(`access=${access} indicates permissive access granted by the landowner.`);
    return { cyclingStatus: 'permissive', confidence: 'medium', reasons, source: 'osm' };
  }

  // 3. Legal designation (England and Wales only).
  if (jurisdiction === 'england-wales') {
    if (designation === 'public_bridleway') {
      reasons.push(
        'Public bridleways carry a right to cycle in England and Wales (Countryside Act 1968, s.30).',
      );
      return { cyclingStatus: 'confirmed', confidence: 'medium', reasons, source: 'osm' };
    }
    if (designation === 'restricted_byway' || designation === 'byway_open_to_all_traffic') {
      reasons.push(
        `${humaniseDesignation(designation)} carries a right of way for non-motorised vehicles.`,
      );
      return { cyclingStatus: 'confirmed', confidence: 'medium', reasons, source: 'osm' };
    }
    if (designation === 'public_footpath') {
      reasons.push('Public footpaths carry a right on foot only; cycling is not confirmed.');
      return { cyclingStatus: 'not-confirmed', confidence: 'medium', reasons, source: 'osm' };
    }
  } else if (designation !== 'none' && designation !== 'other') {
    reasons.push(
      `designation=${tags.designation} is recorded, but England-and-Wales rights-of-way law is not applied outside England and Wales.`,
    );
    return { cyclingStatus: 'uncertain', confidence: 'unknown', reasons, source: 'osm' };
  }

  // 4/5. Physical highway fallback.
  if (highway === 'cycleway') {
    reasons.push('highway=cycleway is mapped for cycle use.');
    return { cyclingStatus: 'confirmed', confidence: 'medium', reasons, source: 'osm' };
  }
  if (highway === 'bridleway') {
    if (jurisdiction === 'england-wales') {
      reasons.push(
        'highway=bridleway without designation=* — cycling is usually permitted but unverified.',
      );
      return { cyclingStatus: 'uncertain', confidence: 'low', reasons, source: 'inferred' };
    }
    reasons.push('highway=bridleway outside England and Wales — access rules vary.');
    return { cyclingStatus: 'uncertain', confidence: 'unknown', reasons, source: 'inferred' };
  }
  if (highway === 'footway' || highway === 'steps' || highway === 'pedestrian') {
    reasons.push(
      `highway=${highway} is mapped for pedestrians; no cycling permission is recorded.`,
    );
    return { cyclingStatus: 'not-confirmed', confidence: 'low', reasons, source: 'inferred' };
  }
  if (highway && ROAD_HIGHWAYS.has(highway)) {
    if (highway === 'motorway' || highway === 'motorway_link') {
      reasons.push('Cycling is prohibited on motorways.');
      return { cyclingStatus: 'prohibited', confidence: 'high', reasons, source: 'inferred' };
    }
    reasons.push(`highway=${highway} is a public carriageway open to cycles.`);
    return {
      cyclingStatus: 'confirmed',
      confidence: highway === 'service' ? 'low' : 'medium',
      reasons,
      source: 'inferred',
    };
  }
  if (highway === 'track') {
    reasons.push('highway=track without access tags — the legal status is not mapped.');
    return { cyclingStatus: 'uncertain', confidence: 'low', reasons, source: 'inferred' };
  }
  if (highway === 'path') {
    reasons.push('Generic highway=path with no access or designation tags.');
    return { cyclingStatus: 'uncertain', confidence: 'low', reasons, source: 'inferred' };
  }

  reasons.push('Insufficient tags to determine cycling access.');
  return { cyclingStatus: 'uncertain', confidence: 'unknown', reasons, source: 'osm' };
}

export function assessWalkingAccess(
  tags: OsmPathTags,
  jurisdiction: Jurisdiction,
): { status: CyclingStatus; confidence: AccessConfidence; reasons: string[] } {
  const reasons: string[] = [];
  const foot = tagValue(tags.foot);
  const access = tagValue(tags.access);
  const designation = normaliseDesignation(tags.designation);
  const highway = tagValue(tags.highway);

  if (foot && NO_VALUES.has(foot)) {
    reasons.push(`foot=${foot} restricts walking.`);
    return { status: 'prohibited', confidence: 'high', reasons };
  }
  if (access && HARD_NO_VALUES.has(access) && !(foot && YES_VALUES.has(foot))) {
    reasons.push(`access=${access} restricts all users.`);
    return { status: 'prohibited', confidence: 'high', reasons };
  }
  if (foot && YES_VALUES.has(foot)) {
    reasons.push(`foot=${foot} explicitly permits walking.`);
    return { status: 'confirmed', confidence: 'high', reasons };
  }
  if (foot && PERMISSIVE_VALUES.has(foot)) {
    reasons.push(`foot=${foot} indicates permissive access.`);
    return { status: 'permissive', confidence: 'medium', reasons };
  }
  if (jurisdiction === 'england-wales' && designation !== 'none' && designation !== 'other') {
    reasons.push(`${humaniseDesignation(designation)} carries a public right on foot.`);
    return { status: 'confirmed', confidence: 'medium', reasons };
  }
  if (
    highway === 'footway' ||
    highway === 'path' ||
    highway === 'bridleway' ||
    highway === 'steps'
  ) {
    reasons.push(`highway=${highway} is walkable, but the legal status is not mapped.`);
    return { status: 'uncertain', confidence: 'low', reasons };
  }
  if (highway === 'motorway' || highway === 'motorway_link') {
    reasons.push('Walking is prohibited on motorways.');
    return { status: 'prohibited', confidence: 'high', reasons };
  }
  if (highway && ROAD_HIGHWAYS.has(highway)) {
    reasons.push(`highway=${highway} normally permits walking.`);
    return { status: 'confirmed', confidence: 'low', reasons };
  }
  reasons.push('Insufficient tags to determine walking access.');
  return { status: 'uncertain', confidence: 'unknown', reasons };
}

function simpleModeAccess(
  value: string | undefined,
  access: string | undefined,
  positiveDesignations: Designation[],
  designation: Designation,
  jurisdiction: Jurisdiction,
): { status: CyclingStatus; confidence: AccessConfidence } {
  const mode = tagValue(value);
  if (mode && NO_VALUES.has(mode)) return { status: 'prohibited', confidence: 'high' };
  if (mode && YES_VALUES.has(mode)) return { status: 'confirmed', confidence: 'high' };
  if (mode && PERMISSIVE_VALUES.has(mode)) return { status: 'permissive', confidence: 'medium' };
  const acc = tagValue(access);
  if (acc && HARD_NO_VALUES.has(acc)) return { status: 'prohibited', confidence: 'high' };
  if (jurisdiction === 'england-wales' && positiveDesignations.includes(designation)) {
    return { status: 'confirmed', confidence: 'medium' };
  }
  if (jurisdiction === 'england-wales' && designation === 'public_footpath') {
    return { status: 'not-confirmed', confidence: 'medium' };
  }
  return { status: 'uncertain', confidence: 'unknown' };
}

export function categoriseFeature(
  tags: OsmPathTags,
  cycling: AccessAssessment,
): RightsOfWayCategory {
  const designation = normaliseDesignation(tags.designation);
  if (designation === 'public_footpath') return 'public_footpath';
  if (designation === 'public_bridleway') return 'public_bridleway';
  if (designation === 'restricted_byway') return 'restricted_byway';
  if (designation === 'byway_open_to_all_traffic') return 'byway_open_to_all_traffic';
  if (cycling.cyclingStatus === 'permissive') return 'permissive';
  const highway = tagValue(tags.highway);
  if (highway === 'cycleway') return 'cycleway';
  if (highway && ROAD_HIGHWAYS.has(highway)) return 'road';
  if (highway === 'track') return 'track';
  if (highway === 'footway' || highway === 'path' || highway === 'bridleway') return 'unknown';
  return 'unknown';
}

export function humaniseDesignation(designation: Designation): string {
  switch (designation) {
    case 'public_footpath':
      return 'Public footpath';
    case 'public_bridleway':
      return 'Public bridleway';
    case 'restricted_byway':
      return 'Restricted byway';
    case 'byway_open_to_all_traffic':
      return 'Byway open to all traffic';
    case 'other':
      return 'Other designation';
    default:
      return 'No designation mapped';
  }
}

/** Full classification used by the overlay, inspector and route analysis. */
export function classifyPath(
  tags: OsmPathTags,
  jurisdiction: Jurisdiction = 'england-wales',
): PathClassification {
  const designation = normaliseDesignation(tags.designation);
  const cycling = assessCyclingAccess(tags, jurisdiction);
  const walking = assessWalkingAccess(tags, jurisdiction);
  return {
    designation,
    category: categoriseFeature(tags, cycling),
    physicalType: tags.highway ?? 'not mapped',
    jurisdiction,
    cycling,
    walking,
    horse: simpleModeAccess(
      tags.horse,
      tags.access,
      ['public_bridleway', 'restricted_byway', 'byway_open_to_all_traffic'],
      designation,
      jurisdiction,
    ),
    motorVehicle: simpleModeAccess(
      tags.motor_vehicle ?? tags.vehicle,
      tags.access,
      ['byway_open_to_all_traffic'],
      designation,
      jurisdiction,
    ),
    surfaceClass: classifySurface(tags),
    isPermissive: cycling.cyclingStatus === 'permissive' || tagValue(tags.access) === 'permissive',
  };
}

/** Does the requested access policy allow riding/walking this way? */
export function isUsableForProfile(
  classification: PathClassification,
  profile: 'cycling' | 'walking',
  policy: 'strict' | 'permit-uncertain' | 'show-all',
): boolean {
  const assessment = profile === 'cycling' ? classification.cycling : classification.walking;
  const status = 'cyclingStatus' in assessment ? assessment.cyclingStatus : assessment.status;
  if (status === 'prohibited') return false;
  if (policy === 'show-all') return true;
  if (policy === 'permit-uncertain') return status !== 'not-confirmed' || profile === 'walking';
  return status === 'confirmed' || status === 'permissive';
}
