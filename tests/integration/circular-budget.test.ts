// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getCircularRouteGenerator } from '@/server/services/circular-route-generator';
import { getRoutingProvider } from '@/server/providers/routing';
import type { CircularRouteRequest } from '@/types/domain';
import { ApiError } from '@/lib/http/api-error';

const request: CircularRouteRequest = {
  start: [-0.5183, 51.6541],
  targetDistanceMetres: 18_000,
  activityProfile: 'mtb',
  climbing: 'no-preference',
  surface: 'no-preference',
  offRoad: 'balanced',
  technicality: 'no-preference',
  accessPolicy: 'permit-uncertain',
  loopDirection: 'automatic',
  loopShape: 'compact',
};

function context(
  overrides: Partial<Parameters<ReturnType<typeof getCircularRouteGenerator>['generate']>[1]> = {},
) {
  return {
    preferences: request,
    provider: getRoutingProvider(),
    requestId: 'test',
    concurrency: 4,
    candidateCount: 12,
    deadlineAt: Date.now() + 30_000,
    ...overrides,
  };
}

describe('circular generation budget', () => {
  it('returns three alternatives within a generous budget', async () => {
    const routes = await getCircularRouteGenerator().generate(request, context());
    expect(routes).toHaveLength(3);
    expect(routes.every((route) => route.route.geometry.coordinates.length > 2)).toBe(true);
  });

  it('stops instead of running past an expired deadline', async () => {
    const started = Date.now();
    await expect(
      getCircularRouteGenerator().generate(request, context({ deadlineAt: Date.now() - 1 })),
    ).rejects.toBeInstanceOf(ApiError);
    // The point is that it fails fast rather than grinding through candidates.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('honours a reduced candidate budget', async () => {
    const routes = await getCircularRouteGenerator().generate(
      request,
      context({ candidateCount: 6 }),
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.length).toBeLessThanOrEqual(3);
  });
});

describe('degraded results instead of failures', () => {
  it('returns routes with an explicit warning when there is no time to analyse them', async () => {
    // Enough budget to route, not enough to analyse (analysis needs >12s).
    const routes = await getCircularRouteGenerator().generate(
      request,
      context({ deadlineAt: Date.now() + 6_000, candidateCount: 6 }),
    );
    expect(routes.length).toBeGreaterThan(0);
    const warning = routes[0]!.analysis.warnings.find((item) => item.code === 'LOW_DATA_COVERAGE');
    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/could not be checked against mapped rights-of-way data/i);
    // Unknown, not zero-and-pretending.
    expect(routes[0]!.analysis.coverage.accessDataPercent).toBe(0);
    expect(routes[0]!.analysis.access.uncertainPercent).toBe(100);
  });
});
