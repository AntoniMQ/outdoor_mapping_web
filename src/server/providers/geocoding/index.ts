import { serverEnv } from '@/lib/env/server';
import { FixtureGeocodingProvider } from '@/server/providers/geocoding/fixture';
import { NominatimGeocodingProvider } from '@/server/providers/geocoding/nominatim';
import type { GeocodingProvider } from '@/server/providers/geocoding/types';

let cached: GeocodingProvider | null = null;

export function getGeocodingProvider(): GeocodingProvider {
  if (cached) return cached;
  const env = serverEnv();
  cached =
    env.GEOCODING_PROVIDER === 'nominatim'
      ? new NominatimGeocodingProvider({
          baseUrl: env.GEOCODING_BASE_URL,
          timeoutMs: env.UPSTREAM_TIMEOUT_MS,
          userAgent: `TrailLoop/0.1 (+${env.CONTACT_EMAIL})`,
        })
      : new FixtureGeocodingProvider();
  return cached;
}

export function resetGeocodingProviderCache(): void {
  cached = null;
}
