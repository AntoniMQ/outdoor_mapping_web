import type { LineString } from 'geojson';
import type { Coordinate, ElevationProfile } from '@/types/domain';
import { downsample } from '@/lib/geo/geometry';
import { syntheticElevation } from '@/server/providers/fixtures/network';
import { buildProfile } from '@/server/providers/elevation/profile';
import type { ElevationProvider } from '@/server/providers/elevation/types';

export class FixtureElevationProvider implements ElevationProvider {
  readonly name = 'fixture';
  readonly isSynthetic = true;

  async getProfile(geometry: LineString): Promise<ElevationProfile> {
    const coordinates = downsample(geometry.coordinates as Coordinate[], 500);
    return buildProfile(
      coordinates,
      coordinates.map(syntheticElevation),
      'synthetic-terrain',
      true,
    );
  }
}
