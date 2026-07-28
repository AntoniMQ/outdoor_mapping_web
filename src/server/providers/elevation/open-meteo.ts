import { z } from 'zod';
import type { LineString } from 'geojson';
import type { Coordinate, ElevationProfile } from '@/types/domain';
import { downsample } from '@/lib/geo/geometry';
import { fetchJson } from '@/lib/http/fetch-json';
import { buildProfile } from '@/server/providers/elevation/profile';
import type { ElevationProvider } from '@/server/providers/elevation/types';

const schema = z.object({ elevation: z.array(z.number()) });

export interface OpenMeteoOptions {
  baseUrl: string;
  timeoutMs: number;
}

/** Open-Meteo elevation API adapter (Copernicus DEM). */
export class OpenMeteoElevationProvider implements ElevationProvider {
  readonly name = 'open-meteo';
  readonly isSynthetic = false;

  constructor(private readonly options: OpenMeteoOptions) {}

  async getProfile(geometry: LineString, signal?: AbortSignal): Promise<ElevationProfile> {
    // The API accepts up to 100 coordinates per request.
    const coordinates = downsample(geometry.coordinates as Coordinate[], 300);
    const chunks: Coordinate[][] = [];
    for (let i = 0; i < coordinates.length; i += 100) chunks.push(coordinates.slice(i, i + 100));

    const elevations: number[] = [];
    for (const chunk of chunks) {
      const url = new URL('/v1/elevation', this.options.baseUrl);
      url.searchParams.set('latitude', chunk.map((c) => c[1].toFixed(5)).join(','));
      url.searchParams.set('longitude', chunk.map((c) => c[0].toFixed(5)).join(','));
      const payload = await fetchJson<unknown>(url.toString(), {
        provider: this.name,
        timeoutMs: this.options.timeoutMs,
        retries: 1,
        signal,
        allowedHosts: [new URL(this.options.baseUrl).host],
      });
      const parsed = schema.safeParse(payload);
      if (!parsed.success) break;
      elevations.push(...parsed.data.elevation);
    }

    return buildProfile(coordinates, elevations, this.name, false);
  }
}
