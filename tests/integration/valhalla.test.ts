// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValhallaRoutingProvider } from '@/server/providers/routing/valhalla';
import { decodePolyline } from '@/lib/geo/polyline';
import { defaultPreferences } from '@/features/routing/profiles';

const provider = new ValhallaRoutingProvider({
  baseUrl: 'https://valhalla1.openstreetmap.de',
  timeoutMs: 2_000,
  userAgent: 'TrailLoop/test',
});

// Encoded with precision 6, matching Valhalla's default.
const SHAPE = 'gjrgrAxfyaCoBqBsB{B';

const trip = {
  legs: [
    {
      shape: SHAPE,
      summary: { length: 1.2, time: 260 },
      maneuvers: [
        { begin_shape_index: 0, end_shape_index: 1, street_names: ['Shire Lane'], length: 0.6 },
        { begin_shape_index: 1, end_shape_index: 2, street_names: ['Common Road'], length: 0.6 },
      ],
    },
  ],
  summary: { length: 1.2, time: 260 },
};

function mockFetch(handler: () => Response) {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockImplementation(() => Promise.resolve(handler()));
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe('decodePolyline', () => {
  it('decodes to [lon, lat] pairs', () => {
    const coordinates = decodePolyline(SHAPE, 6);
    expect(coordinates.length).toBeGreaterThan(1);
    for (const [lon, lat] of coordinates) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });
});

describe('ValhallaRoutingProvider', () => {
  it('normalises a trip into a route with manoeuvre segments', async () => {
    mockFetch(() => new Response(JSON.stringify({ trip }), { status: 200 }));
    const result = await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.5, 51.66],
      ],
      preferences: defaultPreferences('mtb'),
    });

    const route = result.routes[0]!;
    expect(result.provider).toBe('valhalla');
    expect(route.isSyntheticData).toBe(false);
    expect(route.distanceMetres).toBeCloseTo(1200, 0);
    expect(route.durationSeconds).toBe(260);
    expect(route.segments).toHaveLength(2);
    expect(route.segments[0]!.wayType).toBe('Shire Lane');
    expect(route.geometry.coordinates.length).toBeGreaterThan(1);
  });

  it('maps each activity to the right costing model', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ trip }), { status: 200 }));
    const cases: Array<[Parameters<typeof defaultPreferences>[0], string, string | undefined]> = [
      ['mtb', 'bicycle', 'Mountain'],
      ['gravel', 'bicycle', 'Cross'],
      ['road', 'bicycle', 'Road'],
      ['hiking', 'pedestrian', undefined],
    ];

    for (const [activity, costing, bicycleType] of cases) {
      spy.mockClear();
      await provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences(activity),
      });
      const body = JSON.parse(String(spy.mock.calls[0]![1]!.body)) as {
        costing: string;
        costing_options: { bicycle?: { bicycle_type?: string } };
      };
      expect(body.costing).toBe(costing);
      expect(body.costing_options.bicycle?.bicycle_type).toBe(bicycleType);
    }
  });

  it('marks intermediate points as through points so loops are not truncated', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ trip }), { status: 200 }));
    await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.5, 51.66],
        [-0.48, 51.64],
        [-0.52, 51.65],
      ],
      preferences: defaultPreferences('gravel'),
    });
    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body)) as {
      locations: Array<{ type: string }>;
    };
    expect(body.locations.map((location) => location.type)).toEqual([
      'break',
      'through',
      'through',
      'break',
    ]);
  });

  it('returns alternates as additional routes', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ trip, alternates: [{ trip }] }), { status: 200 }),
    );
    const result = await provider.route({
      coordinates: [
        [-0.52, 51.65],
        [-0.5, 51.66],
      ],
      preferences: defaultPreferences('mtb'),
      alternatives: 2,
    });
    expect(result.routes).toHaveLength(2);
  });

  it('advertises conservative limits for the shared public instance', () => {
    expect(provider.maxConcurrency).toBeLessThanOrEqual(3);
    expect(provider.maxCandidateCount).toBeLessThanOrEqual(8);
  });

  it('maps upstream failures to structured errors', async () => {
    mockFetch(() => new Response('too many requests', { status: 429 }));
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

  it('rejects an unparseable response', async () => {
    mockFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });
});

describe('time-bound calls', () => {
  it('uses the caller supplied timeout and skips retries', async () => {
    let attempts = 0;
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockImplementation(() => {
      attempts += 1;
      return Promise.resolve(new Response('boom', { status: 503 }));
    });

    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

    // One attempt only: a retry would double the cost for a time-bound caller.
    expect(attempts).toBe(1);
  });

  it('still retries transient failures when no deadline is imposed', async () => {
    let attempts = 0;
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockImplementation(() => {
      attempts += 1;
      return Promise.resolve(new Response('boom', { status: 503 }));
    });

    await expect(
      provider.route({
        coordinates: [
          [-0.52, 51.65],
          [-0.5, 51.66],
        ],
        preferences: defaultPreferences('mtb'),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

    expect(attempts).toBe(2);
  });
});
