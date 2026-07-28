import { serverEnv } from '@/lib/env/server';
import { FixtureRightsOfWayProvider } from '@/server/providers/osm/fixture';
import { OverpassRightsOfWayProvider } from '@/server/providers/osm/overpass';
import { PostgisRightsOfWayProvider } from '@/server/providers/osm/postgis';
import type { RightsOfWayProvider } from '@/server/providers/osm/types';

let cached: RightsOfWayProvider | null = null;

export function getRightsOfWayProvider(): RightsOfWayProvider {
  if (cached) return cached;
  const env = serverEnv();
  if (env.RIGHTS_OF_WAY_PROVIDER === 'overpass') {
    cached = new OverpassRightsOfWayProvider({
      endpoint: env.OVERPASS_API_URL,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
      userAgent: `TrailLoop/0.1 (+${env.CONTACT_EMAIL})`,
    });
  } else if (env.RIGHTS_OF_WAY_PROVIDER === 'postgis') {
    cached = new PostgisRightsOfWayProvider();
  } else {
    cached = new FixtureRightsOfWayProvider();
  }
  return cached;
}

export function resetRightsOfWayProviderCache(): void {
  cached = null;
}
