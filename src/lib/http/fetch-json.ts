import { ApiError } from '@/lib/http/api-error';
import { logger } from '@/lib/logging/logger';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** Pre-encoded body (e.g. form-encoded Overpass queries). Takes precedence over `body`. */
  rawBody?: string;
  timeoutMs?: number;
  /** Retries are only attempted for transient failures (timeouts, 5xx, 429). */
  retries?: number;
  signal?: AbortSignal;
  provider: string;
  /** Allowed hosts. Requests to other hosts are rejected (SSRF guard). */
  allowedHosts?: string[];
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly provider: string,
  ) {
    super(`${provider} responded with HTTP ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof UpstreamHttpError) return TRANSIENT_STATUS.has(error.status);
  if (error instanceof ApiError) return error.code === 'UPSTREAM_TIMEOUT';
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function assertAllowedHost(url: string, allowedHosts?: string[]): void {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError('BAD_REQUEST', 'Only http(s) upstream URLs are permitted.');
  }
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
    throw new ApiError('BAD_REQUEST', `Upstream host ${parsed.host} is not allow-listed.`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON fetch with timeout, abort support, SSRF host allow-listing and bounded retries. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const { timeoutMs = 15_000, retries = 0, provider, allowedHosts } = options;
  assertAllowedHost(url, allowedHosts);

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onExternalAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body !== undefined && options.rawBody === undefined
            ? { 'content-type': 'application/json' }
            : {}),
          ...options.headers,
        },
        body:
          options.rawBody !== undefined
            ? options.rawBody
            : options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new UpstreamHttpError(response.status, text.slice(0, 500), provider);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw new ApiError('UPSTREAM_TIMEOUT', 'Request cancelled.');
      if (!isTransient(error) || attempt === retries) break;
      const backoff = Math.min(2_000, 200 * 2 ** attempt);
      logger.warn('Retrying upstream request', { provider, attempt, backoff });
      await sleep(backoff);
      attempt += 1;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw mapUpstreamError(lastError, provider);
}

export function mapUpstreamError(error: unknown, provider: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof UpstreamHttpError) {
    if (error.status === 429) {
      return new ApiError('RATE_LIMITED', `${provider} rate limit reached. Try again shortly.`);
    }
    if (error.status >= 500) {
      return new ApiError('UPSTREAM_UNAVAILABLE', `${provider} is currently unavailable.`);
    }
    return new ApiError('UPSTREAM_INVALID_RESPONSE', `${provider} rejected the request.`, {
      status: error.status,
    });
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ApiError('UPSTREAM_TIMEOUT', `${provider} did not respond in time.`);
  }
  return new ApiError('UPSTREAM_UNAVAILABLE', `${provider} request failed.`);
}

/** Run tasks with bounded concurrency, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
