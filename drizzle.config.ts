import type { Config } from 'drizzle-kit';

export default {
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://trailloop:trailloop@localhost:5432/trailloop',
  },
  verbose: true,
  strict: true,
} satisfies Config;
