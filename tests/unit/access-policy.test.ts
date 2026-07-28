import { describe, expect, it } from 'vitest';
import {
  assessCyclingAccess,
  classifyPath,
  classifySurface,
  isUsableForProfile,
  normaliseDesignation,
} from '@/features/rights-of-way/access-policy';

describe('normaliseDesignation', () => {
  it('recognises the four England-and-Wales designations', () => {
    expect(normaliseDesignation('public_footpath')).toBe('public_footpath');
    expect(normaliseDesignation('public_bridleway')).toBe('public_bridleway');
    expect(normaliseDesignation('restricted_byway')).toBe('restricted_byway');
    expect(normaliseDesignation('byway_open_to_all_traffic')).toBe('byway_open_to_all_traffic');
  });

  it('treats unknown values as other and missing values as none', () => {
    expect(normaliseDesignation('something_else')).toBe('other');
    expect(normaliseDesignation(undefined)).toBe('none');
  });
});

describe('cycling access precedence', () => {
  it('puts explicit prohibition above everything else', () => {
    const result = assessCyclingAccess(
      { designation: 'public_bridleway', bicycle: 'no' },
      'england-wales',
    );
    expect(result.cyclingStatus).toBe('prohibited');
    expect(result.confidence).toBe('high');
  });

  it('lets an explicit mode permission override a blanket access=no', () => {
    const result = assessCyclingAccess({ access: 'no', bicycle: 'yes' }, 'england-wales');
    expect(result.cyclingStatus).toBe('confirmed');
  });

  it('confirms cycling on a public bridleway with medium confidence', () => {
    const result = assessCyclingAccess(
      { highway: 'track', designation: 'public_bridleway' },
      'england-wales',
    );
    expect(result.cyclingStatus).toBe('confirmed');
    expect(result.confidence).toBe('medium');
    expect(result.reasons.join(' ')).toMatch(/bridleway/i);
  });

  it('does not confirm cycling on a public footpath', () => {
    const result = assessCyclingAccess(
      { highway: 'footway', designation: 'public_footpath' },
      'england-wales',
    );
    expect(result.cyclingStatus).toBe('not-confirmed');
  });

  it('reports permissive access separately from statutory rights', () => {
    const result = assessCyclingAccess({ highway: 'path', bicycle: 'permissive' }, 'england-wales');
    expect(result.cyclingStatus).toBe('permissive');
  });

  it('treats access=private as prohibited', () => {
    expect(
      assessCyclingAccess({ highway: 'track', access: 'private' }, 'england-wales').cyclingStatus,
    ).toBe('prohibited');
  });

  it('never converts missing data into permission', () => {
    const result = assessCyclingAccess({ highway: 'path' }, 'england-wales');
    expect(result.cyclingStatus).toBe('uncertain');
    expect(result.confidence).toBe('low');
  });

  it('returns unknown confidence when there are no usable tags', () => {
    const result = assessCyclingAccess({}, 'england-wales');
    expect(result.cyclingStatus).toBe('uncertain');
    expect(result.confidence).toBe('unknown');
  });

  it('gives high confidence when designation and explicit access agree', () => {
    const result = assessCyclingAccess(
      { highway: 'track', designation: 'public_bridleway', bicycle: 'designated' },
      'england-wales',
    );
    expect(result.confidence).toBe('high');
  });

  it('prohibits cycling on motorways', () => {
    expect(assessCyclingAccess({ highway: 'motorway' }, 'england-wales').cyclingStatus).toBe(
      'prohibited',
    );
  });
});

describe('jurisdiction handling', () => {
  it('does not apply England-and-Wales law in Scotland', () => {
    const result = assessCyclingAccess(
      { highway: 'path', designation: 'public_footpath' },
      'scotland',
    );
    expect(result.cyclingStatus).not.toBe('not-confirmed');
    expect(result.reasons.join(' ')).toMatch(/not applied outside England and Wales/i);
  });

  it('still honours explicit restrictions outside England and Wales', () => {
    expect(assessCyclingAccess({ highway: 'path', bicycle: 'no' }, 'scotland').cyclingStatus).toBe(
      'prohibited',
    );
  });
});

describe('classifyPath', () => {
  it('keeps physical type and legal designation separate', () => {
    const classification = classifyPath({ highway: 'track', designation: 'public_bridleway' });
    expect(classification.physicalType).toBe('track');
    expect(classification.designation).toBe('public_bridleway');
    expect(classification.category).toBe('public_bridleway');
  });

  it('reports missing physical type honestly', () => {
    expect(classifyPath({ designation: 'public_footpath' }).physicalType).toBe('not mapped');
  });

  it('classifies horse and motor-vehicle access from the designation', () => {
    const boat = classifyPath({ highway: 'track', designation: 'byway_open_to_all_traffic' });
    expect(boat.motorVehicle.status).toBe('confirmed');
    const restricted = classifyPath({ highway: 'track', designation: 'restricted_byway' });
    expect(restricted.horse.status).toBe('confirmed');
    expect(restricted.motorVehicle.status).not.toBe('confirmed');
  });
});

describe('classifySurface', () => {
  it('separates paved, unpaved and unknown', () => {
    expect(classifySurface({ surface: 'asphalt' })).toBe('paved');
    expect(classifySurface({ surface: 'gravel' })).toBe('unpaved');
    expect(classifySurface({ highway: 'path' })).toBe('unknown');
    expect(classifySurface({ highway: 'track', tracktype: 'grade4' })).toBe('unpaved');
  });
});

describe('isUsableForProfile', () => {
  const footpath = classifyPath({ highway: 'footway', designation: 'public_footpath' });
  const bridleway = classifyPath({ highway: 'track', designation: 'public_bridleway' });
  const unknown = classifyPath({ highway: 'path' });

  it('excludes footpaths for cycling under the strict policy', () => {
    expect(isUsableForProfile(footpath, 'cycling', 'strict')).toBe(false);
    expect(isUsableForProfile(bridleway, 'cycling', 'strict')).toBe(true);
  });

  it('excludes uncertain ways under strict but allows them when uncertainty is permitted', () => {
    expect(isUsableForProfile(unknown, 'cycling', 'strict')).toBe(false);
    expect(isUsableForProfile(unknown, 'cycling', 'permit-uncertain')).toBe(true);
  });

  it('never allows prohibited ways', () => {
    const private_ = classifyPath({ highway: 'track', access: 'private' });
    expect(isUsableForProfile(private_, 'cycling', 'show-all')).toBe(false);
  });
});
