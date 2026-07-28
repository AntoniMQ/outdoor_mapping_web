import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from 'drizzle-orm/pg-core';

/** PostGIS geometry column (LineString, SRID 4326). */
const geometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
});

export const osmRightsOfWay = pgTable(
  'osm_rights_of_way',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    osmType: text('osm_type').notNull(),
    osmId: bigint('osm_id', { mode: 'number' }).notNull(),
    geometry: geometry('geometry').notNull(),
    highway: text('highway'),
    designation: text('designation'),
    access: text('access'),
    foot: text('foot'),
    bicycle: text('bicycle'),
    horse: text('horse'),
    motorVehicle: text('motor_vehicle'),
    surface: text('surface'),
    tracktype: text('tracktype'),
    smoothness: text('smoothness'),
    width: text('width'),
    incline: text('incline'),
    mtbScale: text('mtb_scale'),
    trailVisibility: text('trail_visibility'),
    name: text('name'),
    reference: text('reference'),
    prowRef: text('prow_ref'),
    tagsJson: jsonb('tags_json')
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text('source').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('osm_rights_of_way_source_osm_idx').on(table.source, table.osmType, table.osmId),
    index('osm_rights_of_way_designation_idx').on(table.designation),
    index('osm_rights_of_way_highway_idx').on(table.highway),
  ],
);

export const providerCache = pgTable(
  'provider_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    provider: text('provider').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').notNull(),
    status: text('status').notNull().default('fresh'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('provider_cache_expires_idx').on(table.expiresAt)],
);
