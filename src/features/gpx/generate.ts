import type { Coordinate, RouteSegmentMode } from '@/types/domain';
import { slugify } from '@/lib/format';

export interface GpxWaypoint {
  coordinate: Coordinate;
  name: string;
  type?: 'start' | 'finish' | 'via';
  description?: string;
  elevationMetres?: number;
}

export interface GpxTrackSegment {
  mode: RouteSegmentMode;
  coordinates: Coordinate[];
  /** Elevation per coordinate, where known. */
  elevations?: Array<number | undefined>;
}

export interface GpxDocumentInput {
  name: string;
  description?: string;
  creator?: string;
  time?: Date;
  waypoints?: GpxWaypoint[];
  segments: GpxTrackSegment[];
  keywords?: string[];
}

/** XML text escaping (also escapes quotes so the same helper is safe in attributes). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const coord = (value: number): string => value.toFixed(7);

/**
 * GPX 1.1 document. Routed and freehand sections are written as separate
 * <trkseg> elements so the distinction survives export, and every point keeps
 * full geometry resolution.
 */
export function buildGpx(input: GpxDocumentInput): string {
  const creator = input.creator ?? 'TrailLoop';
  const time = (input.time ?? new Date()).toISOString();
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1" ` +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );
  lines.push('  <metadata>');
  lines.push(`    <name>${escapeXml(input.name)}</name>`);
  if (input.description) lines.push(`    <desc>${escapeXml(input.description)}</desc>`);
  lines.push(`    <time>${time}</time>`);
  if (input.keywords?.length)
    lines.push(`    <keywords>${escapeXml(input.keywords.join(', '))}</keywords>`);
  lines.push('  </metadata>');

  for (const waypoint of input.waypoints ?? []) {
    lines.push(
      `  <wpt lat="${coord(waypoint.coordinate[1])}" lon="${coord(waypoint.coordinate[0])}">`,
    );
    if (waypoint.elevationMetres !== undefined) {
      lines.push(`    <ele>${waypoint.elevationMetres.toFixed(1)}</ele>`);
    }
    lines.push(`    <name>${escapeXml(waypoint.name)}</name>`);
    if (waypoint.description) lines.push(`    <desc>${escapeXml(waypoint.description)}</desc>`);
    if (waypoint.type) lines.push(`    <type>${escapeXml(waypoint.type)}</type>`);
    lines.push('  </wpt>');
  }

  lines.push('  <trk>');
  lines.push(`    <name>${escapeXml(input.name)}</name>`);
  if (input.description) lines.push(`    <desc>${escapeXml(input.description)}</desc>`);

  const segments = input.segments.filter((segment) => segment.coordinates.length >= 2);
  for (const segment of segments) {
    lines.push('    <trkseg>');
    segment.coordinates.forEach((position, index) => {
      const elevation = segment.elevations?.[index];
      lines.push(`      <trkpt lat="${coord(position[1])}" lon="${coord(position[0])}">`);
      if (elevation !== undefined && Number.isFinite(elevation)) {
        lines.push(`        <ele>${elevation.toFixed(1)}</ele>`);
      }
      lines.push('      </trkpt>');
    });
    lines.push('    </trkseg>');
  }

  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}

/** Safe, descriptive download filename. */
export function gpxFilename(parts: {
  place?: string;
  activity?: string;
  distanceMetres?: number;
  prefix?: string;
}): string {
  const chunks = [parts.prefix ?? 'trailloop'];
  if (parts.place) chunks.push(slugify(parts.place));
  if (parts.activity) chunks.push(slugify(parts.activity));
  if (parts.distanceMetres) chunks.push(`${Math.round(parts.distanceMetres / 1000)}km`);
  const name = chunks.filter(Boolean).join('-').replace(/-+/g, '-');
  return `${name || 'trailloop-route'}.gpx`;
}
