// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { XMLValidator } from 'fast-xml-parser';
import { GET as health } from '@/app/api/health/route';
import { GET as rightsOfWay } from '@/app/api/osm/rights-of-way/route';
import { GET as geocode } from '@/app/api/geocode/search/route';
import { POST as circular } from '@/app/api/routes/circular/route';
import { POST as plan } from '@/app/api/routes/plan/route';
import { POST as analyse } from '@/app/api/routes/analyse/route';
import { POST as analyseBatch } from '@/app/api/routes/analyse-batch/route';
import { POST as gpx } from '@/app/api/gpx/export/route';
import { clearMemoryCache } from '@/server/repositories/cache-repository';
import { resetRateLimits } from '@/lib/rate-limit/rate-limit';
import type { AnalysedRoute, RightsOfWayCollection } from '@/types/domain';

const START: [number, number] = [-0.5183, 51.6541];

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearMemoryCache();
  resetRateLimits();
});

describe('GET /api/health', () => {
  it('reports the active providers and fixture mode', async () => {
    const response = await health();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.fixtureMode).toBe(true);
    expect(body.providers).toMatchObject({ routing: 'fixture', rightsOfWay: 'fixture' });
  });
});

describe('GET /api/osm/rights-of-way', () => {
  it('returns classified features for a small bounding box', async () => {
    const response = await rightsOfWay(
      new Request('http://test/api/osm/rights-of-way?bbox=-0.53,51.645,-0.50,51.665&zoom=14'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as RightsOfWayCollection & {
      meta: { isSyntheticData: boolean };
    };
    expect(body.features.length).toBeGreaterThan(10);
    expect(body.meta.isSyntheticData).toBe(true);
    const categories = new Set(
      body.features.map((feature) => feature.properties.classification.category),
    );
    expect(categories.has('public_footpath')).toBe(true);
    expect(categories.has('public_bridleway')).toBe(true);
  });

  it('returns no features below the zoom threshold', async () => {
    const response = await rightsOfWay(
      new Request('http://test/api/osm/rights-of-way?bbox=-0.53,51.645,-0.50,51.665&zoom=9'),
    );
    const body = (await response.json()) as { features: unknown[]; meta: { zoomTooLow: boolean } };
    expect(body.features).toHaveLength(0);
    expect(body.meta.zoomTooLow).toBe(true);
  });

  it('rejects an oversized bounding box with a structured error', async () => {
    const response = await rightsOfWay(
      new Request('http://test/api/osm/rights-of-way?bbox=-4,50,1,55&zoom=14'),
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('AREA_TOO_LARGE');
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects a malformed bounding box', async () => {
    const response = await rightsOfWay(
      new Request('http://test/api/osm/rights-of-way?bbox=nonsense&zoom=14'),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('serves a second identical request from cache', async () => {
    const url = 'http://test/api/osm/rights-of-way?bbox=-0.53,51.645,-0.50,51.665&zoom=14';
    await rightsOfWay(new Request(url));
    const second = await rightsOfWay(new Request(url));
    const body = (await second.json()) as { meta: { cached: boolean } };
    expect(body.meta.cached).toBe(true);
  });
});

describe('POST /api/routes/circular', () => {
  it('returns three meaningfully different alternatives in fixture mode', async () => {
    const response = await circular(
      post('http://test/api/routes/circular', {
        start: START,
        targetDistanceMetres: 20_000,
        activityProfile: 'mtb',
        accessPolicy: 'permit-uncertain',
        loopShape: 'compact',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { routes: AnalysedRoute[]; isSyntheticData: boolean };
    expect(body.routes).toHaveLength(3);
    expect(body.isSyntheticData).toBe(true);

    const labels = body.routes.map((route) => route.label);
    expect(labels).toEqual(['Most off-road', 'Balanced', 'Easier / lower risk']);

    const geometries = new Set(
      body.routes.map((route) => JSON.stringify(route.route.geometry.coordinates)),
    );
    expect(geometries.size).toBe(3);

    for (const route of body.routes) {
      expect(route.analysis.distanceMetres).toBeGreaterThan(12_000);
      expect(route.analysis.distanceMetres).toBeLessThan(30_000);
      expect(route.scoreComponents).toBeDefined();
      expect(route.rationale?.length).toBeGreaterThan(0);
      expect(route.elevation?.points.length).toBeGreaterThan(10);
    }
  });

  it('is deterministic for the same request', async () => {
    const body = {
      start: START,
      targetDistanceMetres: 15_000,
      activityProfile: 'gravel',
      accessPolicy: 'permit-uncertain',
    };
    const first = (await (
      await circular(post('http://test/api/routes/circular', body))
    ).json()) as {
      routes: AnalysedRoute[];
    };
    const second = (await (
      await circular(post('http://test/api/routes/circular', body))
    ).json()) as {
      routes: AnalysedRoute[];
    };
    expect(first.routes.map((route) => route.route.geometry)).toEqual(
      second.routes.map((route) => route.route.geometry),
    );
  });

  it('validates the target distance', async () => {
    const response = await circular(
      post('http://test/api/routes/circular', {
        start: START,
        targetDistanceMetres: 10,
        activityProfile: 'mtb',
      }),
    );
    expect(response.status).toBe(422);
  });

  it('rejects out-of-range coordinates', async () => {
    const response = await circular(
      post('http://test/api/routes/circular', {
        start: [200, 100],
        targetDistanceMetres: 10_000,
        activityProfile: 'mtb',
      }),
    );
    expect(response.status).toBe(422);
  });

  it('excludes footpath sections under the strict access policy', async () => {
    const response = await circular(
      post('http://test/api/routes/circular', {
        start: START,
        targetDistanceMetres: 12_000,
        activityProfile: 'mtb',
        accessPolicy: 'strict',
      }),
    );
    if (response.status === 404) return; // no candidate met the strict policy — also acceptable
    const body = (await response.json()) as { routes: AnalysedRoute[] };
    for (const route of body.routes) {
      expect(route.analysis.access.notConfirmedPercent).toBeLessThanOrEqual(1);
    }
  });
});

describe('POST /api/routes/plan', () => {
  it('plans a point-to-point route', async () => {
    const response = await plan(
      post('http://test/api/routes/plan', {
        type: 'point-to-point',
        start: START,
        destination: [-0.47, 51.63],
        via: [],
        activityProfile: 'gravel',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { routes: AnalysedRoute[] };
    expect(body.routes.length).toBeGreaterThan(0);
    expect(body.routes[0]!.analysis.distanceMetres).toBeGreaterThan(1_000);
  });

  it('plans an out-and-back route and reports repetition', async () => {
    const response = await plan(
      post('http://test/api/routes/plan', {
        type: 'out-and-back',
        start: START,
        targetDistanceMetres: 10_000,
        variedReturn: false,
        activityProfile: 'hiking',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { routes: AnalysedRoute[] };
    const route = body.routes[0]!;
    expect(route.label).toMatch(/retraces the outbound leg/i);
    expect(route.analysis.repeatedPercent).toBeGreaterThan(30);
  });

  it('rejects an unknown route type', async () => {
    const response = await plan(
      post('http://test/api/routes/plan', { type: 'spiral', start: START }),
    );
    expect(response.status).toBe(422);
  });
});

describe('POST /api/routes/analyse', () => {
  it('analyses hybrid geometry and flags hand-drawn sections', async () => {
    const response = await analyse(
      post('http://test/api/routes/analyse', {
        geometry: {
          type: 'LineString',
          coordinates: [START, [-0.515, 51.655], [-0.512, 51.657], [-0.508, 51.659]],
        },
        activityProfile: 'mtb',
        accessPolicy: 'permit-uncertain',
        segments: [
          { mode: 'routed', coordinates: [START, [-0.515, 51.655]] },
          {
            mode: 'freehand',
            coordinates: [
              [-0.515, 51.655],
              [-0.512, 51.657],
              [-0.508, 51.659],
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      analysis: {
        warnings: Array<{ code: string; affectedDistanceMetres: number; segmentIndexes: number[] }>;
      };
      elevation: { points: unknown[] };
    };
    const manual = body.analysis.warnings.find(
      (warning) => warning.code === 'MANUAL_SEGMENT_UNVERIFIED',
    );
    expect(manual).toBeDefined();
    expect(manual!.segmentIndexes).toContain(1);
    expect(manual!.affectedDistanceMetres).toBeGreaterThan(0);
    expect(body.elevation.points.length).toBeGreaterThan(1);
  });

  it('rejects geometry with a single coordinate', async () => {
    const response = await analyse(
      post('http://test/api/routes/analyse', {
        geometry: { type: 'LineString', coordinates: [START] },
        activityProfile: 'mtb',
      }),
    );
    expect(response.status).toBe(422);
  });
});

describe('POST /api/gpx/export', () => {
  it('returns a valid GPX file with the right headers', async () => {
    const response = await gpx(
      post('http://test/api/gpx/export', {
        name: 'Demo & test route',
        activity: 'mtb',
        place: 'Chorleywood',
        segments: [
          { mode: 'routed', coordinates: [START, [-0.515, 51.655]], elevations: [90, 96] },
          {
            mode: 'freehand',
            coordinates: [
              [-0.515, 51.655],
              [-0.512, 51.657],
            ],
          },
        ],
        waypoints: [{ coordinate: START, name: 'Start', type: 'start' }],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/gpx+xml');
    expect(response.headers.get('content-disposition')).toContain('trailloop-chorleywood-mtb');
    const xml = await response.text();
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('Demo &amp; test route');
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  });

  it('rejects an export with no geometry', async () => {
    const response = await gpx(post('http://test/api/gpx/export', { name: 'Empty', segments: [] }));
    expect(response.status).toBe(422);
  });
});

describe('GET /api/geocode/search', () => {
  it('returns fixture places and caches them', async () => {
    const response = await geocode(new Request('http://test/api/geocode/search?q=chorleywood'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ label: string }>; cached: boolean };
    expect(body.results[0]!.label).toContain('Chorleywood');

    const second = (await (
      await geocode(new Request('http://test/api/geocode/search?q=chorleywood'))
    ).json()) as {
      cached: boolean;
    };
    expect(second.cached).toBe(true);
  });

  it('requires a minimum query length', async () => {
    const response = await geocode(new Request('http://test/api/geocode/search?q=ab'));
    expect(response.status).toBe(422);
  });
});

describe('POST /api/routes/analyse-batch', () => {
  const line = (offset: number) => ({
    type: 'LineString' as const,
    coordinates: [
      [START[0] + offset, START[1]],
      [START[0] + offset + 0.01, START[1] + 0.006],
      [START[0] + offset + 0.02, START[1] + 0.012],
    ],
  });

  it('analyses every route from a generation in one request', async () => {
    // Real generated geometry, so the routes genuinely lie on the network and
    // matching has something to find.
    const generated = (await (
      await circular(
        post('http://test/api/routes/circular', {
          start: START,
          targetDistanceMetres: 12_000,
          activityProfile: 'mtb',
          accessPolicy: 'permit-uncertain',
          deferAnalysis: true,
        }),
      )
    ).json()) as { routes: AnalysedRoute[] };

    const response = await analyseBatch(
      post('http://test/api/routes/analyse-batch', {
        routes: generated.routes.map((item) => ({
          id: item.route.id,
          geometry: item.route.geometry,
        })),
        activityProfile: 'mtb',
        accessPolicy: 'permit-uncertain',
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{
        id: string;
        analysis: {
          distanceMetres: number;
          analysed: boolean;
          access: { confirmedPercent: number };
        };
      }>;
    };
    expect(body.results).toHaveLength(generated.routes.length);
    for (const result of body.results) {
      expect(result.analysis.distanceMetres).toBeGreaterThan(0);
      expect(result.analysis.analysed).toBe(true);
      expect(result.analysis.access.confirmedPercent).toBeGreaterThan(0);
    }
  });

  it('reports a route as unanalysed when nothing matched, rather than as zero', async () => {
    const response = await analyseBatch(
      post('http://test/api/routes/analyse-batch', {
        // Mid-Atlantic: no path data anywhere near it.
        routes: [
          {
            id: 'nowhere',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-30, 45],
                [-30.01, 45.01],
              ],
            },
          },
        ],
        activityProfile: 'mtb',
      }),
    );

    const body = (await response.json()) as { results: Array<{ analysis: { analysed: boolean } }> };
    expect(body.results[0]!.analysis.analysed).toBe(false);
  });

  it('rejects an empty batch', async () => {
    const response = await analyseBatch(
      post('http://test/api/routes/analyse-batch', { routes: [], activityProfile: 'mtb' }),
    );
    expect(response.status).toBe(422);
  });

  it('caps the batch size so one request cannot fan out without bound', async () => {
    const response = await analyseBatch(
      post('http://test/api/routes/analyse-batch', {
        routes: Array.from({ length: 8 }, (_, index) => ({
          id: `r${index}`,
          geometry: line(index * 0.002),
        })),
        activityProfile: 'mtb',
      }),
    );
    expect(response.status).toBe(422);
  });
});
