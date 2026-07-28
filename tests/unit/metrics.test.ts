import { describe, expect, it } from 'vitest';
import {
  accessBreakdown,
  coverageBreakdown,
  designationBreakdown,
  repeatedFraction,
  surfaceBreakdown,
  type AnalysedSegment,
} from '@/features/route-analysis/metrics';
import { classifyPath } from '@/features/rights-of-way/access-policy';
import type { Coordinate } from '@/types/domain';

function segment(distanceMetres: number, tags: Record<string, string>, index = 0): AnalysedSegment {
  return {
    index,
    distanceMetres,
    tags,
    classification: classifyPath(tags, 'england-wales'),
    matchSource: 'provider-tags',
  };
}

describe('distance-weighted percentages', () => {
  const segments = [
    segment(9_000, { highway: 'track', designation: 'public_bridleway', surface: 'compacted' }, 0),
    segment(1_000, { highway: 'tertiary', surface: 'asphalt' }, 1),
  ];

  it('weights by distance rather than by feature count', () => {
    const surface = surfaceBreakdown(segments);
    expect(surface.unpavedPercent).toBeCloseTo(90, 5);
    expect(surface.pavedPercent).toBeCloseTo(10, 5);
    expect(surface.offRoadPercent).toBeCloseTo(90, 5);
  });

  it('splits designations by distance', () => {
    const designation = designationBreakdown(segments);
    expect(designation.publicBridlewayPercent).toBeCloseTo(90, 5);
    expect(designation.roadPercent).toBeCloseTo(10, 5);
    expect(designation.publicFootpathPercent).toBe(0);
  });

  it('reports access statuses by distance', () => {
    const access = accessBreakdown([
      segment(5_000, { highway: 'footway', designation: 'public_footpath' }, 0),
      segment(5_000, { highway: 'track', designation: 'public_bridleway' }, 1),
    ]);
    expect(access.notConfirmedPercent).toBeCloseTo(50, 5);
    expect(access.confirmedPercent).toBeCloseTo(50, 5);
  });

  it('reports coverage of access, surface and technical data', () => {
    const coverage = coverageBreakdown([
      segment(
        5_000,
        { highway: 'track', designation: 'public_bridleway', surface: 'gravel', 'mtb:scale': '1' },
        0,
      ),
      { index: 1, distanceMetres: 5_000, matchSource: 'unmatched' },
    ]);
    expect(coverage.accessDataPercent).toBeCloseTo(50, 5);
    expect(coverage.surfaceDataPercent).toBeCloseTo(50, 5);
    expect(coverage.technicalDataPercent).toBeCloseTo(50, 5);
  });

  it('returns zeroes rather than NaN for an empty route', () => {
    expect(surfaceBreakdown([]).pavedPercent).toBe(0);
    expect(accessBreakdown([]).confirmedPercent).toBe(0);
  });
});

describe('repeatedFraction', () => {
  it('is near zero for a simple loop', () => {
    const loop: Coordinate[] = [
      [-0.5, 51.65],
      [-0.49, 51.65],
      [-0.49, 51.66],
      [-0.5, 51.66],
      [-0.5, 51.65],
    ];
    expect(repeatedFraction(loop)).toBeLessThan(0.1);
  });

  it('is close to a half for an exact out-and-back', () => {
    const out: Coordinate[] = [
      [-0.5, 51.65],
      [-0.49, 51.65],
      [-0.48, 51.65],
    ];
    const there = [...out, ...[...out].reverse().slice(1)];
    expect(repeatedFraction(there)).toBeGreaterThan(0.4);
    expect(repeatedFraction(there)).toBeLessThan(0.6);
  });

  it('does not count consecutive samples in the same cell as repetition', () => {
    const straight: Coordinate[] = [
      [-0.5, 51.65],
      [-0.4, 51.65],
    ];
    expect(repeatedFraction(straight)).toBeLessThan(0.05);
  });
});
