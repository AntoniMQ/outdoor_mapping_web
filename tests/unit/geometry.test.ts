import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  bearingDifference,
  boundingBoxAreaSqKm,
  boundingBoxOf,
  cumulativeDistances,
  densify,
  destination,
  downsample,
  haversineMetres,
  lineLengthMetres,
  nearestPointOnLine,
  simplify,
} from '@/lib/geo/geometry';
import type { Coordinate } from '@/types/domain';

describe('geometry helpers', () => {
  it('measures distance within 0.5% of a known value', () => {
    // Approximately 1 degree of latitude at the equator.
    const metres = haversineMetres([0, 0], [0, 1]);
    expect(metres).toBeGreaterThan(110_000);
    expect(metres).toBeLessThan(111_600);
  });

  it('round-trips destination and bearing', () => {
    const start: Coordinate = [-0.5, 51.65];
    const end = destination(start, 90, 1_000);
    expect(haversineMetres(start, end)).toBeCloseTo(1_000, 0);
    expect(bearingDegrees(start, end)).toBeCloseTo(90, 0);
  });

  it('computes the smallest bearing difference across 0/360', () => {
    expect(bearingDifference(350, 10)).toBeCloseTo(20);
    expect(bearingDifference(10, 350)).toBeCloseTo(20);
  });

  it('simplifies a dense straight line to its endpoints', () => {
    const line: Coordinate[] = Array.from({ length: 50 }, (_, i) => [-0.5 + i * 0.0001, 51.65]);
    expect(simplify(line, 5)).toHaveLength(2);
  });

  it('keeps meaningful vertices when simplifying', () => {
    const line: Coordinate[] = [
      [-0.5, 51.65],
      [-0.499, 51.6512],
      [-0.498, 51.65],
    ];
    expect(simplify(line, 5).length).toBe(3);
  });

  it('finds the nearest point on a line', () => {
    const line: Coordinate[] = [
      [-0.5, 51.65],
      [-0.49, 51.65],
    ];
    const result = nearestPointOnLine(line, [-0.495, 51.6505]);
    expect(result.distanceMetres).toBeLessThan(80);
    expect(result.segmentIndex).toBe(0);
  });

  it('densifies and downsamples consistently', () => {
    const line: Coordinate[] = [
      [-0.5, 51.65],
      [-0.48, 51.65],
    ];
    const dense = densify(line, 100);
    expect(dense.length).toBeGreaterThan(10);
    expect(downsample(dense, 5)).toHaveLength(5);
    expect(cumulativeDistances(dense).at(-1)).toBeCloseTo(lineLengthMetres(line), 0);
  });

  it('computes bounding boxes and areas', () => {
    const bbox = boundingBoxOf([
      [-0.5, 51.6],
      [-0.4, 51.7],
    ]);
    expect(bbox).toEqual([-0.5, 51.6, -0.4, 51.7]);
    expect(boundingBoxAreaSqKm(bbox)).toBeGreaterThan(50);
  });
});
