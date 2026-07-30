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

/**
 * Optional configuration must never take the whole site down. Blank values,
 * placeholders and malformed URLs are treated as "not configured" — the
 * provider then downgrades to its fixture adapter, which is visible in the UI
 * and on /api/health, rather than throwing at startup.
 */
const optionalSecret = (minimumLength: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length >= minimumLength ? value : undefined));

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    try {
      new URL(value);
      return value;
    } catch {
      return undefined;
    }
  });

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_DATA_MODE: z.enum(['live', 'fixture']).default('fixture'),

  DATABASE_URL: optionalUrl,

  ROUTING_PROVIDER: z.enum(['valhalla', 'openrouteservice', 'fixture']).default('fixture'),
  VALHALLA_BASE_URL: z.string().url().default('https://valhalla1.openstreetmap.de'),
  ORS_API_KEY: optionalSecret(10),
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
  /** Lower this for rate-limited providers such as the openrouteservice free tier. */
  CIRCULAR_CANDIDATE_COUNT: z.coerce.number().int().min(6).max(48).default(24),
  /**
   * Wall-clock budget for circular generation. Generation returns the best
   * candidates found so far when it expires, rather than exceeding the
   * platform's function timeout and failing with a 504.
   */
  ROUTE_GENERATION_BUDGET_MS: z.coerce.number().int().min(5_000).max(120_000).default(35_000),
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
    // Selected but unusable: fall back rather than fail, and say why.
    console.warn(
      '[trailloop] ROUTING_PROVIDER=openrouteservice but ORS_API_KEY is missing or too short. Falling back to fixture routing.',
    );
    next.ROUTING_PROVIDER = 'fixture';
  }
  if (next.RIGHTS_OF_WAY_PROVIDER === 'postgis' && !next.DATABASE_URL) {
    console.warn(
      '[trailloop] RIGHTS_OF_WAY_PROVIDER=postgis but DATABASE_URL is missing or malformed. Falling back to fixture path data.',
    );
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
  return syntheticProviders(env).length > 0;
}

/**
 * Names the parts of the application that are still synthetic, so the demo
 * banner can be specific instead of implying everything is fake.
 */
export function syntheticProviders(env: ServerEnv = serverEnv()): string[] {
  const parts: string[] = [];
  if (env.ROUTING_PROVIDER === 'fixture') parts.push('routes');
  if (env.RIGHTS_OF_WAY_PROVIDER === 'fixture') parts.push('path and rights-of-way data');
  if (env.GEOCODING_PROVIDER === 'fixture') parts.push('place search');
  if (env.ELEVATION_PROVIDER === 'fixture') parts.push('elevation');
  return parts;
}

/** "routes and elevation" / "routes, place search and elevation" */
export function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
