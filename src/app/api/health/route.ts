import { NextResponse } from 'next/server';
import { serverEnv, isFixtureMode } from '@/lib/env/server';
import { isDatabaseConfigured } from '@/server/db/client';
import { getRoutingProvider } from '@/server/providers/routing';
import { getRightsOfWayProvider } from '@/server/providers/osm';
import { getGeocodingProvider } from '@/server/providers/geocoding';
import { getElevationProvider } from '@/server/providers/elevation';
import { errorResponse } from '@/lib/http/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const env = serverEnv();
    return NextResponse.json({
      status: 'ok',
      dataMode: env.APP_DATA_MODE,
      fixtureMode: isFixtureMode(env),
      database: isDatabaseConfigured() ? 'configured' : 'not-configured',
      providers: {
        routing: getRoutingProvider().name,
        rightsOfWay: getRightsOfWayProvider().name,
        geocoding: getGeocodingProvider().name,
        elevation: getElevationProvider()?.name ?? 'none',
      },
      time: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
