import postgres, { type Sql } from 'postgres';
import { serverEnv } from '@/lib/env/server';
import { logger } from '@/lib/logging/logger';

let client: Sql | null = null;
let attempted = false;

/**
 * Returns a Postgres client, or null when DATABASE_URL is not configured.
 * The application runs in a documented reduced mode without a database.
 */
export function getSql(): Sql | null {
  if (attempted) return client;
  attempted = true;
  const url = serverEnv().DATABASE_URL;
  if (!url) {
    logger.info('DATABASE_URL not set — running in reduced mode with in-memory caching only.');
    return null;
  }
  client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return client;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(serverEnv().DATABASE_URL);
}

export async function closeSql(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
  attempted = false;
}
