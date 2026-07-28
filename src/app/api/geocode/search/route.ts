import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env/server';
import { errorResponse } from '@/lib/http/api-error';
import { createRequestId } from '@/lib/logging/logger';
import { clientKeyFromRequest, enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { geocodeQuerySchema } from '@/lib/validation/schemas';
import { getGeocodingProvider } from '@/server/providers/geocoding';
import { readCache, writeCache } from '@/server/repositories/cache-repository';
import type { GeocodingResult } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const requestId = createRequestId();
  const env = serverEnv();
  try {
    enforceRateLimit({
      key: clientKeyFromRequest(request, 'geocode'),
      limit: 30,
      windowMs: 60_000,
      enabled: env.RATE_LIMIT_ENABLED,
    });

    const url = new URL(request.url);
    const { q } = geocodeQuerySchema.parse(Object.fromEntries(url.searchParams));
    const provider = getGeocodingProvider();
    const cacheKey = `geocode|${provider.name}|${q.trim().toLowerCase()}`;

    const cached = await readCache<GeocodingResult[]>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { results: cached.value, cached: true, provider: provider.name, requestId },
        { headers: { 'x-request-id': requestId } },
      );
    }

    const results = await provider.search(q, request.signal);
    await writeCache(cacheKey, provider.name, q, results, CACHE_TTL_MS);

    return NextResponse.json(
      {
        results,
        cached: false,
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
