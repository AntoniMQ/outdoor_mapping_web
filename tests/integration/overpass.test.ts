// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildOverpassCorridorQuery,
  buildOverpassQuery,
  overpassRemarkError,
  overpassToFeatureCollection,
  pickRetainedTags,
  type OverpassResponse,
} from '@/features/rights-of-way/overpass';

const response: OverpassResponse = {
  osm3s: { timestamp_osm_base: '2026-06-01T00:00:00Z' },
  elements: [
    {
      type: 'way',
      id: 101,
      tags: {
        highway: 'track',
        designation: 'public_bridleway',
        surface: 'compacted',
        ele: '120',
        source: 'survey',
      },
      geometry: [
        { lat: 51.65, lon: -0.52 },
        { lat: 51.652, lon: -0.515 },
      ],
    },
    {
      type: 'way',
      id: 102,
      tags: { highway: 'footway', designation: 'public_footpath' },
      geometry: [
        { lat: 51.66, lon: -0.51 },
        { lat: 51.661, lon: -0.508 },
      ],
    },
    { type: 'node', id: 999, tags: { highway: 'crossing' } },
    { type: 'way', id: 103, tags: { highway: 'path' }, geometry: [{ lat: 51.66, lon: -0.51 }] },
  ],
};

describe('Overpass query', () => {
  it('is bounded by the requested box and requests geometry', () => {
    const query = buildOverpassQuery([-0.53, 51.64, -0.5, 51.67], 25);
    expect(query).toContain('[out:json][timeout:25]');
    expect(query).toContain('51.64,-0.53,51.67,-0.5');
    expect(query).toContain('out tags geom;');
    expect(query).toContain('designation');
  });
});

describe('Overpass conversion', () => {
  it('converts ways to classified GeoJSON', () => {
    const collection = overpassToFeatureCollection(response);
    expect(collection.features).toHaveLength(2);
    const bridleway = collection.features[0]!;
    expect(bridleway.geometry.coordinates[0]).toEqual([-0.52, 51.65]);
    expect(bridleway.properties.classification.category).toBe('public_bridleway');
    expect(bridleway.properties.classification.cycling.cyclingStatus).toBe('confirmed');
    expect(bridleway.properties.sourceUpdatedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('classifies footpaths as not confirmed for cycling', () => {
    const footpath = overpassToFeatureCollection(response).features[1]!;
    expect(footpath.properties.classification.cycling.cyclingStatus).toBe('not-confirmed');
  });

  it('drops nodes and degenerate geometry', () => {
    const ids = overpassToFeatureCollection(response).features.map(
      (feature) => feature.properties.osmId,
    );
    expect(ids).not.toContain(999);
    expect(ids).not.toContain(103);
  });

  it('strips tags that the application does not use', () => {
    const tags = pickRetainedTags({
      highway: 'track',
      source: 'survey',
      ele: '120',
      surface: 'gravel',
    });
    expect(tags).toEqual({ highway: 'track', surface: 'gravel' });
  });

  it('respects the feature limit', () => {
    expect(overpassToFeatureCollection(response, { limit: 1 }).features).toHaveLength(1);
  });

  it('does not apply England-and-Wales rules elsewhere', () => {
    const collection = overpassToFeatureCollection(response, { jurisdiction: 'scotland' });
    expect(collection.features[1]!.properties.classification.cycling.cyclingStatus).not.toBe(
      'not-confirmed',
    );
  });
});

describe('road inclusion for analysis', () => {
  it('omits carriageways by default, so the overlay stays small', () => {
    const query = buildOverpassQuery([-0.53, 51.64, -0.5, 51.67]);
    expect(query).not.toContain('residential');
  });

  it('includes carriageways when analysis asks for them', () => {
    const query = buildOverpassQuery([-0.53, 51.64, -0.5, 51.67], 25, { includeRoads: true });
    expect(query).toContain('residential');
    expect(query).toContain('secondary');
    // Still bounded to the same box.
    expect(query.match(/51\.64,-0\.53,51\.67,-0\.5/g)?.length).toBeGreaterThan(3);
  });

  it('classifies a residential road as confirmed cycling access', () => {
    const collection = overpassToFeatureCollection({
      elements: [
        {
          type: 'way',
          id: 5,
          tags: { highway: 'residential', surface: 'asphalt' },
          geometry: [
            { lat: 51.65, lon: -0.52 },
            { lat: 51.652, lon: -0.515 },
          ],
        },
      ],
    });
    const classification = collection.features[0]!.properties.classification;
    expect(classification.cycling.cyclingStatus).toBe('confirmed');
    expect(classification.surfaceClass).toBe('paved');
  });
});

describe('corridor queries', () => {
  it('asks for ways near the route rather than a bounding box', () => {
    const query = buildOverpassCorridorQuery(
      [
        [-0.52, 51.65],
        [-0.5, 51.66],
      ],
      35,
      25,
    );
    expect(query).toContain('(around:35,51.65000,-0.52000,51.66000,-0.50000)');
    expect(query).toContain('out tags geom;');
  });

  it('stays compact for a long route', () => {
    // 300 points is what analysis downsamples a route to, however long it is.
    const coordinates: Array<[number, number]> = Array.from({ length: 300 }, (_, i) => [
      -0.52 + i * 0.002,
      51.65 + i * 0.001,
    ]);
    const query = buildOverpassCorridorQuery(coordinates);
    expect(query.length).toBeLessThan(12_000);
  });
});

describe('Overpass in-band failures', () => {
  it('treats a timeout remark as an error, not an empty result', () => {
    expect(
      overpassRemarkError({ remark: 'runtime error: Query timed out in "query" at line 3' }),
    ).toMatch(/timed out/i);
    expect(overpassRemarkError({ remark: 'runtime error: Query run out of memory' })).toBeTruthy();
  });

  it('ignores harmless remarks', () => {
    expect(overpassRemarkError({ remark: 'considered 12 elements' })).toBeNull();
    expect(overpassRemarkError({ elements: [] })).toBeNull();
  });

  it('produces a real multi-line query', () => {
    const query = buildOverpassCorridorQuery([
      [-0.52, 51.65],
      [-0.5, 51.66],
    ]);
    // A literal backslash-n here would be an Overpass syntax error.
    expect(query).not.toContain(String.raw`\n`);
    expect(query.split('\n').length).toBeGreaterThan(3);
  });
});
