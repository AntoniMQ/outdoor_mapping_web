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
    // Which build is actually serving. Without this, "is my fix deployed?" is
    // guesswork, and stale builds get mistaken for broken code.
    const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
    return NextResponse.json({
      status: 'ok',
      build: {
        commit: commit ? commit.slice(0, 7) : 'unknown',
        ref: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? 'local',
      },
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
