import { serverEnv } from '@/lib/env/server';
import { FixtureRoutingProvider } from '@/server/providers/routing/fixture';
import { OpenRouteServiceProvider } from '@/server/providers/routing/openrouteservice';
import { ValhallaRoutingProvider } from '@/server/providers/routing/valhalla';
import type { RoutingProvider } from '@/server/providers/routing/types';

let cached: RoutingProvider | null = null;

export function getRoutingProvider(): RoutingProvider {
  if (cached) return cached;
  const env = serverEnv();

  if (env.ROUTING_PROVIDER === 'valhalla') {
    // Keyless: this is what allows a fully real deployment with no credentials.
    cached = new ValhallaRoutingProvider({
      baseUrl: env.VALHALLA_BASE_URL,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
      userAgent: `TrailLoop/0.1 (+${env.CONTACT_EMAIL})`,
    });
  } else if (env.ROUTING_PROVIDER === 'openrouteservice' && env.ORS_API_KEY) {
    cached = new OpenRouteServiceProvider({
      apiKey: env.ORS_API_KEY,
      baseUrl: env.ORS_BASE_URL,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    });
  } else {
    cached = new FixtureRoutingProvider();
  }
  return cached;
}

export function resetRoutingProviderCache(): void {
  cached = null;
}
