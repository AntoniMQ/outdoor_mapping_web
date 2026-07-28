import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_PROFILE_DEFINITIONS,
  defaultPreferences,
  toProviderProfile,
  travelModeOf,
  wayCostMultiplier,
} from '@/features/routing/profiles';

describe('activity profile mapping', () => {
  it('maps every profile to an openrouteservice profile', () => {
    expect(toProviderProfile('mtb')).toBe('cycling-mountain');
    expect(toProviderProfile('gravel')).toBe('cycling-regular');
    expect(toProviderProfile('road')).toBe('cycling-road');
    expect(toProviderProfile('hiking')).toBe('foot-hiking');
  });

  it('documents the gravel approximation', () => {
    expect(ACTIVITY_PROFILE_DEFINITIONS.gravel.providerCaveat).toMatch(
      /no dedicated gravel profile/i,
    );
  });

  it('maps hiking to the walking travel mode', () => {
    expect(travelModeOf('hiking')).toBe('walking');
    expect(travelModeOf('mtb')).toBe('cycling');
  });
});

describe('wayCostMultiplier', () => {
  it('prefers sealed surfaces for road cycling', () => {
    const preferences = defaultPreferences('road');
    const paved = wayCostMultiplier({ highway: 'tertiary', surface: 'asphalt' }, preferences);
    const rough = wayCostMultiplier({ highway: 'track', surface: 'dirt' }, preferences);
    expect(paved).toBeLessThan(rough);
  });

  it('prefers off-road ways for mountain biking', () => {
    const preferences = defaultPreferences('mtb');
    const track = wayCostMultiplier({ highway: 'track', surface: 'dirt' }, preferences);
    const road = wayCostMultiplier({ highway: 'secondary', surface: 'asphalt' }, preferences);
    expect(track).toBeLessThan(road);
  });

  it('heavily penalises high-stress roads for non-road profiles', () => {
    const preferences = defaultPreferences('gravel');
    expect(wayCostMultiplier({ highway: 'primary' }, preferences)).toBeGreaterThan(
      wayCostMultiplier({ highway: 'unclassified' }, preferences) * 2,
    );
  });

  it('responds to the off-road preference', () => {
    const road = { highway: 'unclassified', surface: 'asphalt' };
    const maximise = wayCostMultiplier(road, {
      ...defaultPreferences('gravel'),
      offRoad: 'maximise',
    });
    const minimise = wayCostMultiplier(road, {
      ...defaultPreferences('gravel'),
      offRoad: 'minimise',
    });
    expect(minimise).toBeLessThan(maximise);
  });
});
