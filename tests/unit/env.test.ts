import { describe, expect, it } from 'vitest';
import { formatList, isFixtureMode, parseServerEnv, syntheticProviders } from '@/lib/env/server';

const base = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;

describe('server environment validation', () => {
  it('defaults to fixture mode with safe provider choices', () => {
    const env = parseServerEnv(base);
    expect(env.APP_DATA_MODE).toBe('fixture');
    expect(env.ROUTING_PROVIDER).toBe('fixture');
    expect(env.RIGHTS_OF_WAY_PROVIDER).toBe('fixture');
  });

  it('forces every provider to fixture when APP_DATA_MODE=fixture', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'fixture',
      ROUTING_PROVIDER: 'openrouteservice',
      ORS_API_KEY: 'x'.repeat(20),
    });
    expect(env.ROUTING_PROVIDER).toBe('fixture');
  });

  it('falls back to fixture routing when the ORS key is missing in live mode', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      ROUTING_PROVIDER: 'openrouteservice',
    });
    expect(env.ROUTING_PROVIDER).toBe('fixture');
  });

  it('keeps openrouteservice when a key is supplied in live mode', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      ROUTING_PROVIDER: 'openrouteservice',
      ORS_API_KEY: 'k'.repeat(24),
    });
    expect(env.ROUTING_PROVIDER).toBe('openrouteservice');
  });

  it('falls back from postgis to fixture without DATABASE_URL', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      RIGHTS_OF_WAY_PROVIDER: 'postgis',
    });
    expect(env.RIGHTS_OF_WAY_PROVIDER).toBe('fixture');
  });

  it('rejects invalid values loudly', () => {
    expect(() => parseServerEnv({ ...base, APP_DATA_MODE: 'nonsense' })).toThrow(
      /Invalid server environment/,
    );
    expect(() => parseServerEnv({ ...base, ORS_BASE_URL: 'not-a-url' })).toThrow();
    expect(() => parseServerEnv({ ...base, MAX_BBOX_AREA_SQ_KM: '-5' })).toThrow();
  });

  it('parses boolean-ish rate limit flags', () => {
    expect(parseServerEnv({ ...base, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(parseServerEnv({ ...base, RATE_LIMIT_ENABLED: '1' }).RATE_LIMIT_ENABLED).toBe(true);
  });
});

describe('resilience to bad optional configuration', () => {
  it('treats a placeholder ORS key as not configured instead of throwing', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      ROUTING_PROVIDER: 'openrouteservice',
      ORS_API_KEY: '..',
    });
    expect(env.ORS_API_KEY).toBeUndefined();
    expect(env.ROUTING_PROVIDER).toBe('fixture');
  });

  it('ignores an empty or whitespace-only key', () => {
    expect(parseServerEnv({ ...base, ORS_API_KEY: '   ' }).ORS_API_KEY).toBeUndefined();
  });

  it('ignores a malformed DATABASE_URL rather than failing to boot', () => {
    const env = parseServerEnv({ ...base, APP_DATA_MODE: 'live', DATABASE_URL: 'not-a-url' });
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('still accepts a real key and a real database URL', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      ROUTING_PROVIDER: 'openrouteservice',
      ORS_API_KEY: 'k'.repeat(32),
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/trailloop',
    });
    expect(env.ROUTING_PROVIDER).toBe('openrouteservice');
    expect(env.DATABASE_URL).toContain('postgresql://');
  });
});

describe('keyless live configuration', () => {
  it('allows a fully live setup with no credentials at all', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      ROUTING_PROVIDER: 'valhalla',
      RIGHTS_OF_WAY_PROVIDER: 'overpass',
      GEOCODING_PROVIDER: 'nominatim',
      ELEVATION_PROVIDER: 'open-meteo',
    });
    expect(env.ROUTING_PROVIDER).toBe('valhalla');
    expect(env.RIGHTS_OF_WAY_PROVIDER).toBe('overpass');
    expect(isFixtureMode(env)).toBe(false);
    expect(syntheticProviders(env)).toEqual([]);
  });

  it('names exactly which parts are still synthetic', () => {
    const env = parseServerEnv({
      ...base,
      APP_DATA_MODE: 'live',
      RIGHTS_OF_WAY_PROVIDER: 'overpass',
      GEOCODING_PROVIDER: 'nominatim',
      ELEVATION_PROVIDER: 'open-meteo',
    });
    expect(syntheticProviders(env)).toEqual(['routes']);
    expect(formatList(syntheticProviders(env))).toBe('routes');
    expect(formatList(['routes', 'elevation'])).toBe('routes and elevation');
    expect(formatList(['routes', 'place search', 'elevation'])).toBe(
      'routes, place search and elevation',
    );
  });
});
