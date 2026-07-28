import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Coordinate } from '@/types/domain';
import { buildGpx, escapeXml, gpxFilename } from '@/features/gpx/generate';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });

const LOOP: Coordinate[] = [
  [-0.5183, 51.6541],
  [-0.51, 51.66],
  [-0.5, 51.65],
  [-0.5183, 51.6541],
];

describe('GPX generation', () => {
  it('produces a valid GPX 1.1 document', () => {
    const xml = buildGpx({ name: 'Test route', segments: [{ mode: 'routed', coordinates: LOOP }] });
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = parser.parse(xml);
    expect(parsed.gpx['@version']).toBe('1.1');
    expect(parsed.gpx['@creator']).toBe('TrailLoop');
    expect(parsed.gpx['@xmlns']).toBe('http://www.topografix.com/GPX/1/1');
  });

  it('writes latitude and longitude in the correct attributes', () => {
    const xml = buildGpx({ name: 'Test', segments: [{ mode: 'routed', coordinates: LOOP }] });
    const points = parser.parse(xml).gpx.trk.trkseg.trkpt;
    expect(Number(points[0]['@lat'])).toBeCloseTo(51.6541, 4);
    expect(Number(points[0]['@lon'])).toBeCloseTo(-0.5183, 4);
  });

  it('keeps a closed loop closed', () => {
    const xml = buildGpx({ name: 'Loop', segments: [{ mode: 'routed', coordinates: LOOP }] });
    const points = parser.parse(xml).gpx.trk.trkseg.trkpt;
    expect(points[0]['@lat']).toBe(points[points.length - 1]['@lat']);
    expect(points[0]['@lon']).toBe(points[points.length - 1]['@lon']);
  });

  it('writes waypoints for start, finish and via points', () => {
    const xml = buildGpx({
      name: 'With waypoints',
      segments: [{ mode: 'routed', coordinates: LOOP }],
      waypoints: [
        { coordinate: LOOP[0]!, name: 'Start', type: 'start' },
        { coordinate: LOOP[1]!, name: 'Halfway', type: 'via' },
        { coordinate: LOOP[3]!, name: 'Finish', type: 'finish' },
      ],
    });
    const waypoints = parser.parse(xml).gpx.wpt;
    expect(waypoints).toHaveLength(3);
    expect(waypoints[1].name).toBe('Halfway');
    expect(waypoints[2].type).toBe('finish');
  });

  it('serialises elevation only where it is known', () => {
    const xml = buildGpx({
      name: 'Elevation',
      segments: [
        { mode: 'routed', coordinates: LOOP.slice(0, 3), elevations: [91.25, undefined, 104] },
      ],
    });
    const points = parser.parse(xml).gpx.trk.trkseg.trkpt;
    expect(points[0].ele).toBeCloseTo(91.3, 1);
    expect(points[1].ele).toBeUndefined();
    expect(points[2].ele).toBeCloseTo(104, 1);
  });

  it('writes routed and freehand sections as separate track segments', () => {
    const xml = buildGpx({
      name: 'Hybrid',
      segments: [
        { mode: 'routed', coordinates: LOOP.slice(0, 2) },
        { mode: 'freehand', coordinates: LOOP.slice(1, 4) },
      ],
    });
    const segments = parser.parse(xml).gpx.trk.trkseg;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments).toHaveLength(2);
  });

  it('escapes special characters', () => {
    expect(escapeXml(`Fred & <Ginger> "x" 'y'`)).toBe(
      'Fred &amp; &lt;Ginger&gt; &quot;x&quot; &apos;y&apos;',
    );
    const xml = buildGpx({
      name: 'Ride & <ride> "again"',
      description: "Tom's & Jerry's",
      segments: [{ mode: 'routed', coordinates: LOOP }],
    });
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parser.parse(xml).gpx.metadata.name).toBe('Ride & <ride> "again"');
  });

  it('ignores segments with fewer than two points', () => {
    const xml = buildGpx({
      name: 'Short',
      segments: [
        { mode: 'routed', coordinates: LOOP },
        { mode: 'freehand', coordinates: [LOOP[0]!] },
      ],
    });
    expect(Array.isArray(parser.parse(xml).gpx.trk.trkseg)).toBe(false);
  });
});

describe('gpxFilename', () => {
  it('builds a sanitised, descriptive filename', () => {
    expect(
      gpxFilename({ place: 'Chorleywood, Hertfordshire', activity: 'mtb', distanceMetres: 25_400 }),
    ).toBe('trailloop-chorleywood-hertfordshire-mtb-25km.gpx');
  });

  it('strips unsafe characters', () => {
    const name = gpxFilename({ place: '../../etc/passwd' });
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name.endsWith('.gpx')).toBe(true);
  });

  it('falls back to a default name', () => {
    expect(gpxFilename({})).toBe('trailloop.gpx');
  });
});
