import { z } from 'zod';

/**
 * Centralised, strict environment validation.
 * Server-only values must never be imported from client components.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_DATA_MODE: z.enum(['live', 'fixture']).default('fixture'),

  DATABASE_URL: z.string().url().optional(),

  ROUTING_PROVIDER: z.enum(['openrouteservice', 'fixture']).default('fixture'),
  ORS_API_KEY: z.string().min(10).optional(),
  ORS_BASE_URL: z.string().url().default('https://api.openrouteservice.org'),

  RIGHTS_OF_WAY_PROVIDER: z.enum(['overpass', 'postgis', 'fixture']).default('fixture'),
  OVERPASS_API_URL: z.string().url().default('https://overpass-api.de/api/interpreter'),

  GEOCODING_PROVIDER: z.enum(['nominatim', 'fixture']).default('fixture'),
  GEOCODING_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),

  ELEVATION_PROVIDER: z.enum(['open-meteo', 'fixture', 'none']).default('fixture'),
  ELEVATION_BASE_URL: z.string().url().default('https://api.open-meteo.com'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  RATE_LIMIT_ENABLED: booleanish.default(true),

  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
  MAX_BBOX_AREA_SQ_KM: z.coerce.number().positive().max(10_000).default(400),
  ROUTE_CANDIDATE_CONCURRENCY: z.coerce.number().int().min(1).max(12).default(4),
  CONTACT_EMAIL: z.string().default('trailloop@example.org'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment configuration -> ${issues}`);
  }
  return applyModeConstraints(parsed.data);
}

/**
 * Fixture mode forces every provider to its deterministic adapter so the
 * application can never accidentally present synthetic data as live data
 * (or vice versa).
 */
function applyModeConstraints(env: ServerEnv): ServerEnv {
  if (env.APP_DATA_MODE === 'fixture') {
    return {
      ...env,
      ROUTING_PROVIDER: 'fixture',
      RIGHTS_OF_WAY_PROVIDER: 'fixture',
      GEOCODING_PROVIDER: 'fixture',
      ELEVATION_PROVIDER: 'fixture',
    };
  }
  const next = { ...env };
  if (next.ROUTING_PROVIDER === 'openrouteservice' && !next.ORS_API_KEY) {
    next.ROUTING_PROVIDER = 'fixture';
  }
  if (next.RIGHTS_OF_WAY_PROVIDER === 'postgis' && !next.DATABASE_URL) {
    next.RIGHTS_OF_WAY_PROVIDER = 'fixture';
  }
  return next;
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv();
  return cached;
}

export function resetServerEnvCache(): void {
  cached = null;
}

/** True when any provider is serving deterministic synthetic data. */
export function isFixtureMode(env: ServerEnv = serverEnv()): boolean {
  return (
    env.APP_DATA_MODE === 'fixture' ||
    env.ROUTING_PROVIDER === 'fixture' ||
    env.RIGHTS_OF_WAY_PROVIDER === 'fixture'
  );
}
