import { z } from 'zod';

/** Public configuration. Only NEXT_PUBLIC_* values may appear here. */
const clientSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('TrailLoop'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  /** A style URL, or "offline" for a blank local style (used by tests and air-gapped demos). */
  NEXT_PUBLIC_MAP_STYLE_URL: z
    .union([z.string().url(), z.literal('offline')])
    .default('https://tiles.openfreemap.org/styles/liberty'),
});

export type ClientEnv = z.infer<typeof clientSchema>;

export const clientEnv: ClientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
});

export const BRAND = {
  name: 'TrailLoop',
  tagline: 'Plan clearly. Ride confidently.',
} as const;
