import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { planRequestSchema, readJsonBody } from '@/lib/validation/schemas';
import { getRoutingProvider } from '@/server/providers/routing';
import { getElevationProvider } from '@/server/providers/elevation';
import { planOutAndBack, planPointToPoint } from '@/server/services/route-planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'routes/plan'),
      limit: 60,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const body = planRequestSchema.parse(await readJsonBody(request));
    const provider = getRoutingProvider();
    const context = {
      preferences: body,
      provider,
      signal: request.signal,
      requestId,
      concurrency: env.ROUTE_CANDIDATE_CONCURRENCY,
    };

    const planned =
      body.type === 'point-to-point'
        ? await planPointToPoint(body, context)
        : await planOutAndBack(body, context);

    const elevationProvider = getElevationProvider();
    const routes = await Promise.all(
      planned.routes.map(async (item) => {
        if (!elevationProvider) return item;
        const elevation = await elevationProvider
          .getProfile(item.route.geometry, request.signal)
          .catch(() => undefined);
        return elevation
          ? {
              ...item,
              elevation,
              analysis: {
                ...item.analysis,
                ascentMetres: elevation.ascentMetres,
                descentMetres: elevation.descentMetres,
                highestPointMetres: elevation.maxElevationMetres,
                lowestPointMetres: elevation.minElevationMetres,
              },
            }
          : item;
      }),
    );

    return NextResponse.json(
      { routes, provider: planned.provider, isSyntheticData: planned.isSyntheticData, requestId },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
