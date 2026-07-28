// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouteServiceProvider } from '@/server/providers/routing/openrouteservice';
import { ApiError } from '@/lib/http/api-error';
import { defaultPreferences } from '@/features/routing/profiles';

const provider = new OpenRouteServiceProvider({
  apiKey: 'test-key-0123456789',
  baseUrl: 'https://api.openrouteservice.org',
  timeoutMs: 2_000,
});

const validResponse = {
  type: 'FeatureCollection',
  metadata: { id: 'route-1' },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.52, 51.65, 90],
          [-0.515, 51.652, 96],
          [-0.51, 51.655, 101],
          [-0.505, 51.657, 99],
        ],
      },
      properties: {
        summary: { distance: 1234.5, duration: 300 },
        ascent: 11,
        descent: 2,
        extras: {
          surface: {
            values: [
              [0, 2, 3],
              [2, 3, 10],
            ],
          },
          waytype: {
            values: [
              [0, 2, 3],
              [2, 3, 5],
            ],
          },
        },
      },
    },
  ],
};

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockImplementation((input, init) => Promise.resolve(handler(String(input), init ?? {})));
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe('OpenRouteServiceProvider', () => {
  it('normalises a GeoJSON directions response', async () => {
    mockFetch(() => new Response(JSON.stringify(validResponse), { status: 200 }));
    const result = await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.505, 51.657],
      ],
      preferences: defaultPreferences('gravel'),
    });

    const route = result.routes[0]!;
    expect(result.provider).toBe('openrouteservice');
    expect(route.distanceMetres).toBe(1234.5);
    expect(route.durationSeconds).toBe(300);
    expect(route.ascentMetres).toBe(11);
    expect(route.geometry.coordinates[0]).toEqual([-0.52, 51.65]);
    expect(route.isSyntheticData).toBe(false);
  });

  it('splits the geometry into segments using the extras ranges', async () => {
    mockFetch(() => new Response(JSON.stringify(validResponse), { status: 200 }));
    const { routes } = await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.505, 51.657],
      ],
      preferences: defaultPreferences('gravel'),
    });
    const segments = routes[0]!.segments;
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]!.surface).toBe('asphalt');
    expect(segments[0]!.wayType).toBe('street');
    expect(segments[1]!.surface).toBe('gravel');
    expect(segments[1]!.tags?.highway).toBe('track');
    expect(segments[0]!.distanceMetres).toBeGreaterThan(0);
  });

  it('sends the API key in a header and never in the URL', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify(validResponse), { status: 200 }));
    await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.505, 51.657],
      ],
      preferences: defaultPreferences('mtb'),
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).not.toContain('test-key');
    expect(String(url)).toContain('/v2/directions/cycling-mountain/geojson');
    expect((init?.headers as Record<string, string>).authorization).toBe('test-key-0123456789');
  });

  it('maps a 429 to a rate-limit error', async () => {
    mockFetch(() => new Response('slow down', { status: 429 }));
    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('maps a 500 to an upstream-unavailable error', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('rejects an unparseable response instead of trusting it', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
    );
    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('reports a timeout as UPSTREAM_TIMEOUT', async () => {
    mockFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 5);
        }),
    );
    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('requests alternatives only for two-point routes', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify(validResponse), { status: 200 }));
    await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.5, 51.66],
      ],
      preferences: defaultPreferences('mtb'),
      alternatives: 3,
    });
    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(body.alternative_routes).toBeDefined();
    expect(body.elevation).toBe(true);
  });
});
