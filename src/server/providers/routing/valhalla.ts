import { z } from 'zod';
import type {
  Coordinate,
  NormalisedRoute,
  NormalisedRouteSegment,
  RoutePreferences,
} from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { fetchJson } from '@/lib/http/fetch-json';
import { boundingBoxOf, lineLengthMetres } from '@/lib/geo/geometry';
import { decodePolyline } from '@/lib/geo/polyline';
import type {
  ProviderHealth,
  ProviderRouteRequest,
  ProviderRouteResult,
  RoutingProvider,
} from '@/server/providers/routing/types';

const maneuverSchema = z.object({
  begin_shape_index: z.number(),
  end_shape_index: z.number(),
  street_names: z.array(z.string()).optional(),
  length: z.number().optional(),
});

const legSchema = z.object({
  shape: z.string(),
  maneuvers: z.array(maneuverSchema).optional(),
  summary: z.object({ length: z.number().optional(), time: z.number().optional() }).optional(),
});

const tripSchema = z.object({
  legs: z.array(legSchema).min(1),
  summary: z.object({ length: z.number().optional(), time: z.number().optional() }).optional(),
  status: z.number().optional(),
});

const responseSchema = z.object({
  trip: tripSchema,
  alternates: z.array(z.object({ trip: tripSchema })).optional(),
});

/**
 * Valhalla costing per activity *and* per stated preference.
 *
 * `bicycle_type` maps TrailLoop's activities exactly, and the user's off-road,
 * surface and climbing preferences are folded into the numeric weights — a
 * request to maximise off-road has to reach the engine, or it is not a
 * preference at all.
 *
 * Valhalla semantics: use_roads 0 = avoid roads entirely, 1 = prefer them;
 * avoid_bad_surfaces 0 = happy on rough ground, 1 = avoid it; use_hills 0 =
 * avoid climbing, 1 = seek it out.
 */
export function costingFor(preferences: RoutePreferences): {
  costing: string;
  costing_options: Record<string, unknown>;
} {
  const { activityProfile, offRoad, surface, climbing } = preferences;

  if (activityProfile === 'hiking') {
    return {
      costing: 'pedestrian',
      costing_options: {
        pedestrian: {
          walking_speed: 4.5,
          use_hills: climbing === 'low' ? 0.2 : climbing === 'high' ? 0.9 : 0.5,
          walkway_factor: offRoad === 'minimise' ? 0.8 : 1.4,
          driveway_factor: 5,
        },
      },
    };
  }

  const bicycleType =
    activityProfile === 'mtb' ? 'Mountain' : activityProfile === 'gravel' ? 'Cross' : 'Road';

  // Baseline road appetite per activity, then shifted by the explicit preference.
  const baseUseRoads =
    activityProfile === 'mtb' ? 0.25 : activityProfile === 'gravel' ? 0.45 : 0.75;
  const useRoads = clamp01(
    baseUseRoads + (offRoad === 'maximise' ? -0.2 : offRoad === 'minimise' ? 0.25 : 0),
  );

  const baseAvoidBadSurfaces =
    activityProfile === 'mtb' ? 0.05 : activityProfile === 'gravel' ? 0.25 : 0.85;
  const avoidBadSurfaces = clamp01(
    baseAvoidBadSurfaces +
      (surface === 'prefer-paved' ? 0.3 : surface === 'prefer-unpaved' ? -0.2 : 0) +
      (offRoad === 'maximise' ? -0.1 : 0),
  );

  const useHills = clamp01(climbing === 'low' ? 0.15 : climbing === 'high' ? 0.9 : 0.5);

  return {
    costing: 'bicycle',
    costing_options: {
      bicycle: {
        bicycle_type: bicycleType,
        use_roads: useRoads,
        use_hills: useHills,
        avoid_bad_surfaces: avoidBadSurfaces,
        // Nudge the engine towards mapped cycle infrastructure and tracks when
        // the rider asked to stay off the road network.
        use_living_streets: offRoad === 'maximise' ? 0.8 : 0.5,
      },
    },
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
}

export interface ValhallaOptions {
  baseUrl: string;
  timeoutMs: number;
  userAgent: string;
}

/**
 * Valhalla adapter. The FOSSGIS instance at valhalla1.openstreetmap.de needs no
 * API key, which is what lets TrailLoop run with entirely real data and no
 * credentials. It is a shared community service, so the provider advertises
 * conservative concurrency and candidate limits.
 */
export class ValhallaRoutingProvider implements RoutingProvider {
  readonly name = 'valhalla';
  readonly isSynthetic = false;
  // Modest concurrency for a shared community instance, but high enough that a
  // dozen candidates do not serialise into a timeout.
  readonly maxConcurrency = 3;
  readonly maxCandidateCount = 8;

  constructor(private readonly options: ValhallaOptions) {}

  async route(request: ProviderRouteRequest): Promise<ProviderRouteResult> {
    if (request.coordinates.length < 2) {
      throw new ApiError('BAD_REQUEST', 'At least two coordinates are required.');
    }

    const { costing, costing_options } = costingFor(request.preferences);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/route`;
    const alternates = Math.max(0, Math.min(2, (request.alternatives ?? 1) - 1));

    const payload = await fetchJson<unknown>(url, {
      method: 'POST',
      provider: this.name,
      // A retry doubles the cost of an already slow call, which is the last
      // thing a time-bound caller wants.
      timeoutMs: request.timeoutMs ?? this.options.timeoutMs,
      retries: request.timeoutMs === undefined ? 1 : 0,
      signal: request.signal,
      allowedHosts: [new URL(this.options.baseUrl).host],
      headers: { 'user-agent': this.options.userAgent },
      body: {
        locations: request.coordinates.map(([lon, lat], index) => ({
          lon,
          lat,
          // Intermediate points are "through" points so the loop is not cut short.
          type: index === 0 || index === request.coordinates.length - 1 ? 'break' : 'through',
        })),
        costing,
        costing_options,
        directions_options: { units: 'kilometers', language: 'en-GB' },
        ...(alternates > 0 ? { alternates } : {}),
      },
    });

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError('UPSTREAM_INVALID_RESPONSE', 'Valhalla returned an unexpected response.');
    }

    const trips = [parsed.data.trip, ...(parsed.data.alternates ?? []).map((item) => item.trip)];
    const routes = trips.map((trip, index) => normaliseTrip(trip, index, this.name));
    if (routes.length === 0) {
      throw new ApiError('NO_ROUTE_FOUND', 'Valhalla found no route between these points.');
    }
    return { provider: this.name, routes };
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await fetchJson(`${this.options.baseUrl.replace(/\/$/, '')}/status`, {
        provider: this.name,
        timeoutMs: 5_000,
        allowedHosts: [new URL(this.options.baseUrl).host],
        headers: { 'user-agent': this.options.userAgent },
      });
      return { provider: this.name, healthy: true };
    } catch (error) {
      return { provider: this.name, healthy: false, detail: (error as Error).message };
    }
  }
}

type Trip = z.infer<typeof tripSchema>;

function normaliseTrip(trip: Trip, index: number, provider: string): NormalisedRoute {
  const coordinates: Coordinate[] = [];
  const segments: NormalisedRouteSegment[] = [];

  for (const leg of trip.legs) {
    const shape = decodePolyline(leg.shape, 6);
    const offset = coordinates.length === 0 ? 0 : 1;
    const base = coordinates.length - offset;
    coordinates.push(...shape.slice(offset));

    // One segment per manoeuvre gives analysis and warnings a sensible
    // granularity; OSM tags are attached later by spatial matching.
    for (const maneuver of leg.maneuvers ?? []) {
      const slice = shape.slice(maneuver.begin_shape_index, maneuver.end_shape_index + 1);
      if (slice.length < 2) continue;
      segments.push({
        index: segments.length,
        coordinates: slice,
        distanceMetres:
          maneuver.length !== undefined ? maneuver.length * 1000 : lineLengthMetres(slice),
        wayType: maneuver.street_names?.[0],
      });
    }
    void base;
  }

  if (segments.length === 0 && coordinates.length >= 2) {
    segments.push({
      index: 0,
      coordinates: [...coordinates],
      distanceMetres: lineLengthMetres(coordinates),
    });
  }

  const distanceMetres =
    trip.summary?.length !== undefined ? trip.summary.length * 1000 : lineLengthMetres(coordinates);

  return {
    id: `${provider}-${index}-${Math.round(distanceMetres)}`,
    geometry: { type: 'LineString', coordinates },
    distanceMetres,
    durationSeconds: trip.summary?.time,
    bbox: boundingBoxOf(coordinates),
    segments,
    provider,
    warnings: [],
    isSyntheticData: false,
  };
}
