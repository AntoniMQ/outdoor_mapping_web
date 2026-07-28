import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { gpxExportSchema, readJsonBody } from '@/lib/validation/schemas';
import { buildGpx, gpxFilename, type GpxTrackSegment } from '@/features/gpx/generate';
import type { Coordinate } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'gpx'),
      limit: 60,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const body = gpxExportSchema.parse(await readJsonBody(request));
    const segments: GpxTrackSegment[] = body.segments.map((segment) => ({
      mode: segment.mode,
      coordinates: segment.coordinates as Coordinate[],
      elevations: body.includeElevation
        ? segment.elevations?.map((value) => (value === null ? undefined : value))
        : undefined,
    }));

    const totalMetres = segments.reduce((sum, segment) => sum + segment.coordinates.length, 0);
    const hasFreehand = segments.some((segment) => segment.mode === 'freehand');

    const gpx = buildGpx({
      name: body.name,
      description: [
        body.description,
        env.APP_DATA_MODE === 'fixture'
          ? 'Generated in TrailLoop demo mode from synthetic data — not live routing or OpenStreetMap data.'
          : 'Generated with TrailLoop. Route data derived from OpenStreetMap contributors (ODbL).',
        hasFreehand ? 'Contains hand-drawn sections whose access status is unverified.' : undefined,
      ]
        .filter(Boolean)
        .join(' '),
      creator: 'TrailLoop',
      segments,
      waypoints: body.waypoints.map((waypoint) => ({
        coordinate: waypoint.coordinate as Coordinate,
        name: waypoint.name,
        type: waypoint.type,
      })),
      keywords: ['trailloop', body.activity ?? 'route'].filter(Boolean),
    });

    const filename = gpxFilename({
      place: body.place,
      activity: body.activity,
      distanceMetres: distanceFromSegments(segments),
    });

    return new Response(gpx, {
      status: 200,
      headers: {
        'content-type': 'application/gpx+xml; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-request-id': requestId,
        'x-point-count': String(totalMetres),
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

function distanceFromSegments(segments: GpxTrackSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.coordinates.length; i += 1) {
      const a = segment.coordinates[i - 1]!;
      const b = segment.coordinates[i]!;
      const dLat = ((b[1] - a[1]) * Math.PI) / 180;
      const dLon = ((b[0] - a[0]) * Math.PI) / 180;
      const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
      total += Math.hypot(dLat, dLon * Math.cos(lat)) * 6_371_008.8;
    }
  }
  return total;
}
