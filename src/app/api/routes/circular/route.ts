import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId, logger } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { circularRequestSchema, readJsonBody } from '@/lib/validation/schemas';
import { getRoutingProvider } from '@/server/providers/routing';
import { getElevationProvider } from '@/server/providers/elevation';
import { getCircularRouteGenerator } from '@/server/services/circular-route-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'routes/circular'),
      limit: 12,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const body = circularRequestSchema.parse(await readJsonBody(request));
    const provider = getRoutingProvider();
    const generator = getCircularRouteGenerator();

    const candidates = await generator.generate(body, {
      preferences: body,
      provider,
      signal: request.signal,
      requestId,
      concurrency: Math.min(
        env.ROUTE_CANDIDATE_CONCURRENCY,
        provider.maxConcurrency ?? Number.MAX_SAFE_INTEGER,
      ),
      candidateCount: Math.min(
        env.CIRCULAR_CANDIDATE_COUNT,
        provider.maxCandidateCount ?? Number.MAX_SAFE_INTEGER,
      ),
    });

    const elevationProvider = getElevationProvider();
    const withElevation = await Promise.all(
      candidates.map(async (candidate) => {
        if (!elevationProvider) return candidate;
        const elevation = await elevationProvider
          .getProfile(candidate.route.geometry, request.signal)
          .catch(() => undefined);
        return {
          ...candidate,
          elevation,
          analysis: elevation
            ? {
                ...candidate.analysis,
                ascentMetres: elevation.ascentMetres,
                descentMetres: elevation.descentMetres,
                highestPointMetres: elevation.maxElevationMetres,
                lowestPointMetres: elevation.minElevationMetres,
              }
            : candidate.analysis,
        };
      }),
    );

    logger.info('Circular routes generated', {
      requestId,
      candidates: withElevation.length,
      provider: provider.name,
    });

    return NextResponse.json(
      {
        routes: withElevation,
        provider: provider.name,
        isSyntheticData: provider.isSynthetic,
        requestId,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
