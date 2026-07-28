import { getSql } from '@/server/db/client';
import { logger } from '@/lib/logging/logger';

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();
const MAX_MEMORY_ENTRIES = 200;

export interface CacheReadResult<T> {
  value: T;
  stale: boolean;
}

/**
 * Upstream-response cache. Uses PostgreSQL when configured and an in-memory
 * LRU-ish map otherwise (documented reduced development mode).
 * Secrets are never cached — only normalised provider responses.
 */
export async function readCache<T>(
  key: string,
  staleAfterMs = 0,
): Promise<CacheReadResult<T> | null> {
  const entry = memory.get(key);
  if (entry) {
    if (entry.expiresAt > Date.now()) {
      return { value: entry.value as T, stale: entry.expiresAt - Date.now() < staleAfterMs };
    }
    memory.delete(key);
  }

  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      select response, expires_at from provider_cache where cache_key = ${key} limit 1
    `) as unknown as Array<{ response: T; expires_at: string }>;
    const row = rows[0];
    if (!row) return null;
    const expiresAt = new Date(row.expires_at).getTime();
    if (expiresAt <= Date.now()) return null;
    memory.set(key, { value: row.response, expiresAt });
    return { value: row.response, stale: expiresAt - Date.now() < staleAfterMs };
  } catch (error) {
    logger.warn('Cache read failed; continuing without cache', { error: (error as Error).message });
    return null;
  }
}

export async function writeCache(
  key: string,
  provider: string,
  requestHash: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  memory.set(key, { value, expiresAt });

  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      insert into provider_cache (cache_key, provider, request_hash, response, status, expires_at)
      values (${key}, ${provider}, ${requestHash}, ${JSON.stringify(value)}::jsonb, 'fresh', ${new Date(expiresAt)})
      on conflict (cache_key) do update
        set response = excluded.response,
            expires_at = excluded.expires_at,
            status = 'fresh'
    `;
  } catch (error) {
    logger.warn('Cache write failed; continuing', { error: (error as Error).message });
  }
}

export function clearMemoryCache(): void {
  memory.clear();
}

/** Stable cache key for a bounding box, snapped to a grid to maximise hits. */
export function boundingBoxCacheKey(
  provider: string,
  version: string,
  bbox: readonly number[],
  extra: string[] = [],
): string {
  const snapped = bbox.map((value) => (Math.round(value * 200) / 200).toFixed(3)).join(',');
  return [provider, version, snapped, ...extra].join('|');
}
