import { z } from 'zod';
import type {
  ActivityProfile,
  Coordinate,
  NormalisedRoute,
  NormalisedRouteSegment,
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
 * Valhalla costing options per activity. `bicycle_type` is Valhalla's own
 * enumeration and maps cleanly onto TrailLoop's profiles, so unlike the
 * openrouteservice adapter nothing has to be approximated.
 */
function costingFor(profile: ActivityProfile): {
  costing: string;
  costing_options: Record<string, unknown>;
} {
  switch (profile) {
    case 'mtb':
      return {
        costing: 'bicycle',
        costing_options: {
          bicycle: {
            bicycle_type: 'Mountain',
            use_roads: 0.2,
            use_hills: 0.6,
            avoid_bad_surfaces: 0.05,
          },
        },
      };
    case 'gravel':
      return {
        costing: 'bicycle',
        costing_options: {
          bicycle: {
            bicycle_type: 'Cross',
            use_roads: 0.4,
            use_hills: 0.5,
            avoid_bad_surfaces: 0.25,
          },
        },
      };
    case 'road':
      return {
        costing: 'bicycle',
        costing_options: {
          bicycle: {
            bicycle_type: 'Road',
            use_roads: 0.7,
            use_hills: 0.4,
            avoid_bad_surfaces: 0.9,
          },
        },
      };
    case 'hiking':
      return {
        costing: 'pedestrian',
        costing_options: {
          pedestrian: { walking_speed: 4.5, use_hills: 0.5, walkway_factor: 1.2 },
        },
      };
  }
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
  readonly maxConcurrency = 2;
  readonly maxCandidateCount = 12;

  constructor(private readonly options: ValhallaOptions) {}

  async route(request: ProviderRouteRequest): Promise<ProviderRouteResult> {
    if (request.coordinates.length < 2) {
      throw new ApiError('BAD_REQUEST', 'At least two coordinates are required.');
    }

    const { costing, costing_options } = costingFor(request.preferences.activityProfile);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/route`;
    const alternates = Math.max(0, Math.min(2, (request.alternatives ?? 1) - 1));

    const payload = await fetchJson<unknown>(url, {
      method: 'POST',
      provider: this.name,
      timeoutMs: this.options.timeoutMs,
      retries: 1,
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
