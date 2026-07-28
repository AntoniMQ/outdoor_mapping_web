import { ApiError } from '@/lib/http/api-error';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  enabled?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/** Simple in-memory token bucket. Replace with a shared store for multi-instance deployments. */
export function consumeRateLimit({
  key,
  limit,
  windowMs,
  enabled = true,
}: RateLimitOptions): RateLimitResult {
  if (!enabled) return { allowed: true, remaining: limit, resetMs: 0 };
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  const tokens = Math.min(limit, bucket.tokens + Math.max(0, refill));
  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, remaining: 0, resetMs: Math.ceil((1 - tokens) * (windowMs / limit)) };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, remaining: Math.floor(tokens - 1), resetMs: 0 };
}

export function enforceRateLimit(options: RateLimitOptions): void {
  const result = consumeRateLimit(options);
  if (!result.allowed) {
    throw new ApiError('RATE_LIMITED', 'Too many requests. Please slow down.', {
      retryAfterMs: result.resetMs,
    });
  }
}

export function clientKeyFromRequest(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  return `${scope}:${ip}`;
}

export function resetRateLimits(): void {
  buckets.clear();
}
