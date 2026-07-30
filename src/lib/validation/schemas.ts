import { z } from 'zod';

export const coordinateSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe('[longitude, latitude]');

export const boundingBoxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([minLon, minLat, maxLon, maxLat]) => maxLon > minLon && maxLat > minLat, {
    message: 'Bounding box must be ordered [minLon, minLat, maxLon, maxLat].',
  });

export const activityProfileSchema = z.enum(['mtb', 'gravel', 'road', 'hiking']);
export const accessPolicySchema = z.enum(['strict', 'permit-uncertain', 'show-all']);

export const preferencesSchema = z.object({
  activityProfile: activityProfileSchema,
  climbing: z.enum(['low', 'moderate', 'high', 'no-preference']).default('no-preference'),
  surface: z
    .enum(['prefer-paved', 'mixed', 'prefer-unpaved', 'no-preference'])
    .default('no-preference'),
  offRoad: z.enum(['minimise', 'balanced', 'maximise']).default('balanced'),
  technicality: z.enum(['easy', 'moderate', 'technical', 'no-preference']).default('no-preference'),
  accessPolicy: accessPolicySchema.default('permit-uncertain'),
});

export const MIN_TARGET_DISTANCE_M = 2_000;
export const MAX_TARGET_DISTANCE_M = 300_000;

export const circularRequestSchema = preferencesSchema.extend({
  start: coordinateSchema,
  targetDistanceMetres: z.number().min(MIN_TARGET_DISTANCE_M).max(MAX_TARGET_DISTANCE_M),
  loopDirection: z.enum(['automatic', 'clockwise', 'anticlockwise']).default('automatic'),
  loopShape: z.enum(['compact', 'wide', 'adventure']).default('compact'),
  seed: z.number().int().optional(),
  /**
   * Return routes without analysing them. The client then analyses each route
   * separately, so generation stays fast and reliable at any distance.
   */
  deferAnalysis: z.boolean().default(false),
});

export const pointToPointRequestSchema = preferencesSchema.extend({
  type: z.literal('point-to-point'),
  start: coordinateSchema,
  destination: coordinateSchema,
  via: z.array(coordinateSchema).max(25).default([]),
});

export const outAndBackRequestSchema = preferencesSchema.extend({
  type: z.literal('out-and-back'),
  start: coordinateSchema,
  destination: coordinateSchema.optional(),
  targetDistanceMetres: z.number().min(MIN_TARGET_DISTANCE_M).max(MAX_TARGET_DISTANCE_M).optional(),
  variedReturn: z.boolean().default(false),
});

export const planRequestSchema = z.discriminatedUnion('type', [
  pointToPointRequestSchema,
  outAndBackRequestSchema,
]);

export const lineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(coordinateSchema).min(2).max(20_000),
});

export const analyseRequestSchema = z.object({
  geometry: lineStringSchema,
  activityProfile: activityProfileSchema,
  accessPolicy: accessPolicySchema.default('permit-uncertain'),
  manualSegmentIndexes: z.array(z.number().int().nonnegative()).max(500).default([]),
  /** Optional pre-split segments (used by the manual editor for hybrid routes). */
  segments: z
    .array(
      z.object({
        mode: z.enum(['routed', 'freehand']),
        coordinates: z.array(coordinateSchema).min(2).max(20_000),
      }),
    )
    .max(200)
    .optional(),
  includeElevation: z.boolean().default(true),
});

export const gpxExportSchema = z.object({
  name: z.string().min(1).max(120).default('TrailLoop route'),
  description: z.string().max(500).optional(),
  place: z.string().max(80).optional(),
  activity: activityProfileSchema.optional(),
  includeElevation: z.boolean().default(true),
  segments: z
    .array(
      z.object({
        mode: z.enum(['routed', 'freehand']),
        coordinates: z.array(coordinateSchema).min(2).max(20_000),
        elevations: z.array(z.number().nullable()).optional(),
      }),
    )
    .min(1)
    .max(200),
  waypoints: z
    .array(
      z.object({
        coordinate: coordinateSchema,
        name: z.string().min(1).max(80),
        type: z.enum(['start', 'finish', 'via']).optional(),
      }),
    )
    .max(60)
    .default([]),
});

export const geocodeQuerySchema = z.object({
  q: z.string().min(3).max(120),
});

export const rightsOfWayQuerySchema = z.object({
  bbox: z
    .string()
    .transform((value, ctx) => {
      const parts = value.split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        ctx.addIssue({ code: 'custom', message: 'bbox must be "minLon,minLat,maxLon,maxLat".' });
        return z.NEVER;
      }
      return parts as [number, number, number, number];
    })
    .pipe(boundingBoxSchema),
  zoom: z.coerce.number().min(0).max(24).optional(),
  jurisdiction: z.enum(['england-wales', 'scotland', 'northern-ireland', 'unknown']).optional(),
  limit: z.coerce.number().int().min(1).max(4000).optional(),
});

export type PlanRequestInput = z.infer<typeof planRequestSchema>;
export type CircularRequestInput = z.infer<typeof circularRequestSchema>;
export type AnalyseRequestInput = z.infer<typeof analyseRequestSchema>;
export type GpxExportInput = z.infer<typeof gpxExportSchema>;

/** Request bodies are size-limited before parsing to bound memory use. */
export const MAX_REQUEST_BYTES = 2_000_000;

export async function readJsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_REQUEST_BYTES) {
    throw new Error('Request body is too large.');
  }
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  return text.length === 0 ? {} : JSON.parse(text);
}
