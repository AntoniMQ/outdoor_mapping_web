import type { Coordinate, NormalisedRoute, RoutePreferences } from '@/types/domain';

export interface ProviderRouteRequest {
  /** At least two coordinates, in visiting order. */
  coordinates: Coordinate[];
  preferences: RoutePreferences;
  /** Number of route alternatives requested (providers may return fewer). */
  alternatives?: number;
  signal?: AbortSignal;
  requestId?: string;
  /** Deterministic variation hint used by candidate generation. */
  variantSeed?: number;
  /** Ways the caller would rather avoid (used for varied out-and-back returns). */
  avoidWayIds?: number[];
}

export interface ProviderRouteResult {
  provider: string;
  routes: NormalisedRoute[];
}

export interface ProviderHealth {
  provider: string;
  healthy: boolean;
  detail?: string;
}

export interface RoutingProvider {
  readonly name: string;
  readonly isSynthetic: boolean;
  /** Upper bound this provider is comfortable with (shared community services are low). */
  readonly maxConcurrency?: number;
  readonly maxCandidateCount?: number;
  route(request: ProviderRouteRequest): Promise<ProviderRouteResult>;
  healthCheck?(): Promise<ProviderHealth>;
}

export interface RoutingContext {
  preferences: RoutePreferences;
  provider: RoutingProvider;
  signal?: AbortSignal;
  requestId: string;
  concurrency: number;
  /** How many circular candidates to generate. Lower it for rate-limited providers. */
  candidateCount?: number;
}

export function requireCoordinates(coordinates: Coordinate[]): void {
  if (coordinates.length < 2) {
    throw new Error('At least two coordinates are required to build a route.');
  }
}
