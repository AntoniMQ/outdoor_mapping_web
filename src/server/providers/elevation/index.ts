import { serverEnv } from '@/lib/env/server';
import { FixtureElevationProvider } from '@/server/providers/elevation/fixture';
import { OpenMeteoElevationProvider } from '@/server/providers/elevation/open-meteo';
import type { ElevationProvider } from '@/server/providers/elevation/types';

let cached: ElevationProvider | null | undefined;

/** Returns null when elevation lookups are disabled (ELEVATION_PROVIDER=none). */
export function getElevationProvider(): ElevationProvider | null {
  if (cached !== undefined) return cached;
  const env = serverEnv();
  if (env.ELEVATION_PROVIDER === 'none') cached = null;
  else if (env.ELEVATION_PROVIDER === 'open-meteo') {
    cached = new OpenMeteoElevationProvider({
      baseUrl: env.ELEVATION_BASE_URL,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    });
  } else cached = new FixtureElevationProvider();
  return cached;
}

export function resetElevationProviderCache(): void {
  cached = undefined;
}
