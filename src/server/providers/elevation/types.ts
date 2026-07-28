import type { ElevationProfile } from '@/types/domain';
import type { LineString } from 'geojson';

export interface ElevationProvider {
  readonly name: string;
  readonly isSynthetic: boolean;
  getProfile(geometry: LineString, signal?: AbortSignal): Promise<ElevationProfile>;
}
