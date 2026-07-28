import type { Coordinate, GeocodingResult, ReverseGeocodingResult } from '@/types/domain';

export interface GeocodingProvider {
  readonly name: string;
  readonly isSynthetic: boolean;
  search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]>;
  reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<ReverseGeocodingResult | null>;
}
