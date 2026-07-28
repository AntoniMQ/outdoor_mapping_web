import { z } from 'zod';
import type {
  Coordinate,
  NormalisedRoute,
  NormalisedRouteSegment,
  RouteWarning,
} from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';
import { fetchJson } from '@/lib/http/fetch-json';
import { boundingBoxOf, lineLengthMetres } from '@/lib/geo/geometry';
import { toProviderProfile } from '@/features/routing/profiles';
import type {
  ProviderHealth,
  ProviderRouteRequest,
  ProviderRouteResult,
  RoutingProvider,
} from '@/server/providers/routing/types';

const extraSchema = z
  .object({ values: z.array(z.tuple([z.number(), z.number(), z.number()])) })
  .optional();

const featureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.array(z.number()).min(2)),
  }),
  properties: z.object({
    summary: z
      .object({ distance: z.number().optional(), duration: z.number().optional() })
      .optional(),
    ascent: z.number().optional(),
    descent: z.number().optional(),
    extras: z
      .object({ surface: extraSchema, waytype: extraSchema, steepness: extraSchema })
      .optional(),
    warnings: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  }),
});

const responseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema).min(1),
  metadata: z.object({ id: z.string().optional() }).optional(),
});

// openrouteservice waytype / surface enumerations (see ORS documentation).
const WAYTYPE: Record<number, string> = {
  0: 'unknown',
  1: 'state_road',
  2: 'road',
  3: 'street',
  4: 'path',
  5: 'track',
  6: 'cycleway',
  7: 'footway',
  8: 'steps',
  9: 'ferry',
  10: 'construction',
};

const SURFACE: Record<number, string> = {
  0: 'unknown',
  1: 'paved',
  2: 'unpaved',
  3: 'asphalt',
  4: 'concrete',
  6: 'metal',
  7: 'wood',
  8: 'compacted',
  9: 'fine_gravel',
  10: 'gravel',
  11: 'dirt',
  12: 'ground',
  13: 'ice',
  14: 'paving_stones',
  15: 'sand',
  16: 'woodchips',
  17: 'grass',
  18: 'grass_paver',
};

export interface OrsOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

/** openrouteservice adapter. The API key never leaves the server. */
export class OpenRouteServiceProvider implements RoutingProvider {
  readonly name = 'openrouteservice';
  readonly isSynthetic = false;

  constructor(private readonly options: OrsOptions) {}

  async route(request: ProviderRouteRequest): Promise<ProviderRouteResult> {
    const profile = toProviderProfile(request.preferences.activityProfile);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/v2/directions/${profile}/geojson`;
    const wantsAlternatives = (request.alternatives ?? 1) > 1 && request.coordinates.length === 2;

    const body: Record<string, unknown> = {
      coordinates: request.coordinates,
      elevation: true,
      instructions: false,
      extra_info: ['surface', 'waytype', 'steepness'],
      preference: request.preferences.offRoad === 'minimise' ? 'fastest' : 'recommended',
      units: 'm',
    };
    if (wantsAlternatives) {
      body.alternative_routes = {
        target_count: Math.min(3, request.alternatives ?? 1),
        share_factor: 0.6,
        weight_factor: 1.6,
      };
    }

    const payload = await fetchJson<unknown>(url, {
      method: 'POST',
      provider: this.name,
      body,
      timeoutMs: this.options.timeoutMs,
      retries: 1,
      signal: request.signal,
      allowedHosts: [new URL(this.options.baseUrl).host],
      headers: {
        authorization: this.options.apiKey,
        'content-type': 'application/json',
      },
    });

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        'UPSTREAM_INVALID_RESPONSE',
        'openrouteservice returned an unexpected response.',
      );
    }

    const routes = parsed.data.features.map((feature, index) =>
      normaliseFeature(feature, index, this.name, parsed.data.metadata?.id),
    );
    if (routes.length === 0) {
      throw new ApiError('NO_ROUTE_FOUND', 'openrouteservice found no route for these points.');
    }
    return { provider: this.name, routes };
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await fetchJson(`${this.options.baseUrl.replace(/\/$/, '')}/v2/health`, {
        provider: this.name,
        timeoutMs: 5_000,
        allowedHosts: [new URL(this.options.baseUrl).host],
      });
      return { provider: this.name, healthy: true };
    } catch (error) {
      return { provider: this.name, healthy: false, detail: (error as Error).message };
    }
  }
}

type OrsFeature = z.infer<typeof featureSchema>;

function normaliseFeature(
  feature: OrsFeature,
  index: number,
  provider: string,
  metadataId: string | undefined,
): NormalisedRoute {
  const coordinates: Coordinate[] = feature.geometry.coordinates.map((c) => [c[0]!, c[1]!]);
  const elevations = feature.geometry.coordinates.map((c) => c[2]);
  const boundaries = new Set<number>([0, coordinates.length - 1]);
  const extras = feature.properties.extras;
  for (const extra of [extras?.surface, extras?.waytype]) {
    extra?.values.forEach(([from, to]) => {
      boundaries.add(from);
      boundaries.add(to);
    });
  }
  const cuts = [...boundaries].sort((a, b) => a - b);

  const segments: NormalisedRouteSegment[] = [];
  for (let i = 1; i < cuts.length; i += 1) {
    const from = cuts[i - 1]!;
    const to = cuts[i]!;
    const slice = coordinates.slice(from, to + 1);
    if (slice.length < 2) continue;
    const surfaceCode = valueAt(extras?.surface?.values, from);
    const wayTypeCode = valueAt(extras?.waytype?.values, from);
    const surface = surfaceCode === undefined ? undefined : SURFACE[surfaceCode];
    const wayType = wayTypeCode === undefined ? undefined : WAYTYPE[wayTypeCode];
    segments.push({
      index: segments.length,
      coordinates: slice,
      distanceMetres: lineLengthMetres(slice),
      surface,
      wayType,
      tags: surface || wayType ? { surface, highway: mapWayTypeToHighway(wayType) } : undefined,
      ...elevationDelta(elevations.slice(from, to + 1)),
    });
  }

  const warnings: RouteWarning[] = (feature.properties.warnings ?? []).map((warning) => ({
    code: 'UNKNOWN_ACCESS' as const,
    severity: 'info' as const,
    message: warning.message,
    affectedDistanceMetres: 0,
    segmentIndexes: [],
  }));

  return {
    id: `${provider}-${metadataId ?? 'route'}-${index}`,
    geometry: { type: 'LineString', coordinates },
    distanceMetres: feature.properties.summary?.distance ?? lineLengthMetres(coordinates),
    durationSeconds: feature.properties.summary?.duration,
    ascentMetres: feature.properties.ascent,
    descentMetres: feature.properties.descent,
    bbox: boundingBoxOf(coordinates),
    segments,
    provider,
    providerRouteId: metadataId,
    warnings,
    isSyntheticData: false,
  };
}

function valueAt(
  values: Array<[number, number, number]> | undefined,
  index: number,
): number | undefined {
  return values?.find(([from, to]) => index >= from && index < to)?.[2];
}

function elevationDelta(values: Array<number | undefined>): {
  ascentMetres?: number;
  descentMetres?: number;
} {
  let ascent = 0;
  let descent = 0;
  let seen = false;
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    if (a === undefined || b === undefined) continue;
    seen = true;
    const delta = b - a;
    if (delta > 0) ascent += delta;
    else descent -= delta;
  }
  return seen ? { ascentMetres: ascent, descentMetres: descent } : {};
}

function mapWayTypeToHighway(wayType: string | undefined): string | undefined {
  switch (wayType) {
    case 'path':
      return 'path';
    case 'track':
      return 'track';
    case 'cycleway':
      return 'cycleway';
    case 'footway':
      return 'footway';
    case 'steps':
      return 'steps';
    case 'street':
      return 'residential';
    case 'road':
      return 'unclassified';
    case 'state_road':
      return 'primary';
    default:
      return undefined;
  }
}
