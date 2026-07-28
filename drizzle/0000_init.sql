-- TrailLoop initial schema.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS osm_rights_of_way (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  osm_type text NOT NULL,
  osm_id bigint NOT NULL,
  geometry geometry(LineString, 4326) NOT NULL,
  highway text,
  designation text,
  access text,
  foot text,
  bicycle text,
  horse text,
  motor_vehicle text,
  surface text,
  tracktype text,
  smoothness text,
  width text,
  incline text,
  mtb_scale text,
  trail_visibility text,
  name text,
  reference text,
  prow_ref text,
  tags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS osm_rights_of_way_source_osm_idx
  ON osm_rights_of_way (source, osm_type, osm_id);
CREATE INDEX IF NOT EXISTS osm_rights_of_way_geom_idx
  ON osm_rights_of_way USING gist (geometry);
CREATE INDEX IF NOT EXISTS osm_rights_of_way_designation_idx
  ON osm_rights_of_way (designation);
CREATE INDEX IF NOT EXISTS osm_rights_of_way_highway_idx
  ON osm_rights_of_way (highway);

CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  status text NOT NULL DEFAULT 'fresh',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_cache_expires_idx ON provider_cache (expires_at);
