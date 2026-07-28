import type { ActivityProfile, OsmPathTags, RoutePreferences } from '@/types/domain';
import { classifySurface, isHighStressRoad, isRoad } from '@/features/rights-of-way/access-policy';

export interface ActivityProfileDefinition {
  id: ActivityProfile;
  label: string;
  description: string;
  /** openrouteservice profile identifier. */
  orsProfile: string;
  /** Documented caveat where the provider has no exact equivalent. */
  providerCaveat?: string;
  /** Metres per second used when the provider gives no duration. */
  baseSpeedMps: number;
  travelMode: 'cycling' | 'walking';
}

export const ACTIVITY_PROFILE_DEFINITIONS: Record<ActivityProfile, ActivityProfileDefinition> = {
  mtb: {
    id: 'mtb',
    label: 'Mountain bike',
    description: 'Off-road biased. Prefers tracks, bridleways and byways.',
    orsProfile: 'cycling-mountain',
    baseSpeedMps: 3.9,
    travelMode: 'cycling',
  },
  gravel: {
    id: 'gravel',
    label: 'Gravel',
    description: 'Mixed surface riding — unsealed lanes, tracks and quiet roads.',
    orsProfile: 'cycling-regular',
    providerCaveat:
      'openrouteservice has no dedicated gravel profile. TrailLoop approximates it with cycling-regular plus an unpaved surface preference, so results may favour sealed lanes more than a true gravel engine would.',
    baseSpeedMps: 4.7,
    travelMode: 'cycling',
  },
  road: {
    id: 'road',
    label: 'Road cycling',
    description: 'Sealed surfaces and through routes.',
    orsProfile: 'cycling-road',
    baseSpeedMps: 5.8,
    travelMode: 'cycling',
  },
  hiking: {
    id: 'hiking',
    label: 'Hiking',
    description: 'Walking routes including public footpaths.',
    orsProfile: 'foot-hiking',
    baseSpeedMps: 1.25,
    travelMode: 'walking',
  },
};

export function activityDefinition(profile: ActivityProfile): ActivityProfileDefinition {
  return ACTIVITY_PROFILE_DEFINITIONS[profile];
}

export function toProviderProfile(profile: ActivityProfile): string {
  return ACTIVITY_PROFILE_DEFINITIONS[profile].orsProfile;
}

export function travelModeOf(profile: ActivityProfile): 'cycling' | 'walking' {
  return ACTIVITY_PROFILE_DEFINITIONS[profile].travelMode;
}

/**
 * Relative cost multiplier for a mapped way, given the user's preferences.
 * 1 = neutral, <1 = preferred, >1 = penalised. Used by the deterministic
 * fixture router and by candidate scoring.
 */
export function wayCostMultiplier(tags: OsmPathTags, preferences: RoutePreferences): number {
  const { activityProfile, surface, offRoad, technicality, climbing } = preferences;
  const surfaceClass = classifySurface(tags);
  const road = isRoad(tags);
  const highway = tags.highway ?? '';
  let cost = 1;

  if (activityProfile === 'road') {
    cost *= surfaceClass === 'paved' ? 0.8 : surfaceClass === 'unknown' ? 1.6 : 2.6;
    if (highway === 'path' || highway === 'bridleway' || highway === 'track') cost *= 1.8;
  } else if (activityProfile === 'mtb') {
    cost *= road ? 1.55 : 0.78;
    if (highway === 'track' || highway === 'bridleway' || highway === 'path') cost *= 0.82;
  } else if (activityProfile === 'gravel') {
    cost *= surfaceClass === 'unpaved' ? 0.85 : 1.05;
    if (highway === 'track') cost *= 0.9;
  } else {
    cost *= road ? 1.7 : 0.75;
    if (highway === 'footway' || highway === 'path') cost *= 0.85;
  }

  if (isHighStressRoad(tags)) cost *= activityProfile === 'road' ? 1.5 : 3.2;

  if (surface === 'prefer-paved') cost *= surfaceClass === 'paved' ? 0.85 : 1.35;
  else if (surface === 'prefer-unpaved') cost *= surfaceClass === 'unpaved' ? 0.85 : 1.3;

  if (offRoad === 'maximise') cost *= road ? 1.5 : 0.8;
  else if (offRoad === 'minimise') cost *= road ? 0.85 : 1.4;

  const mtbScale = Number.parseInt(tags['mtb:scale'] ?? '', 10);
  if (Number.isFinite(mtbScale)) {
    if (technicality === 'easy') cost *= 1 + mtbScale * 0.45;
    else if (technicality === 'technical') cost *= Math.max(0.7, 1 - mtbScale * 0.12);
  }

  const incline = Math.abs(Number.parseFloat((tags.incline ?? '').replace('%', '')));
  if (Number.isFinite(incline) && incline > 0) {
    if (climbing === 'low') cost *= 1 + incline * 0.05;
    else if (climbing === 'high') cost *= Math.max(0.75, 1 - incline * 0.02);
  }

  if (tags.surface === undefined && !road) cost *= 1.05;
  return cost;
}

export function defaultPreferences(activityProfile: ActivityProfile = 'mtb'): RoutePreferences {
  return {
    activityProfile,
    climbing: 'no-preference',
    surface: 'no-preference',
    offRoad: 'balanced',
    technicality: 'no-preference',
    accessPolicy: 'permit-uncertain',
  };
}
