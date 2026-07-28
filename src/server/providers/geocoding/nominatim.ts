import { z } from 'zod';
import type { Coordinate, GeocodingResult, ReverseGeocodingResult } from '@/types/domain';
import { fetchJson } from '@/lib/http/fetch-json';
import type { GeocodingProvider } from '@/server/providers/geocoding/types';

const searchSchema = z.array(
  z.object({
    place_id: z.union([z.number(), z.string()]),
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
    type: z.string().optional(),
    address: z
      .object({ county: z.string().optional(), country_code: z.string().optional() })
      .optional(),
  }),
);

const reverseSchema = z.object({ display_name: z.string().optional() });

export interface NominatimOptions {
  baseUrl: string;
  timeoutMs: number;
  userAgent: string;
}

/** Nominatim adapter. Usage policy requires an identifying User-Agent and caching. */
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = 'nominatim';
  readonly isSynthetic = false;

  constructor(private readonly options: NominatimOptions) {}

  async search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
    const url = new URL('/search', this.options.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');
    url.searchParams.set('countrycodes', 'gb');

    const payload = await fetchJson<unknown>(url.toString(), {
      provider: this.name,
      timeoutMs: this.options.timeoutMs,
      signal,
      allowedHosts: [new URL(this.options.baseUrl).host],
      headers: { 'user-agent': this.options.userAgent },
    });

    const parsed = searchSchema.safeParse(payload);
    if (!parsed.success) return [];
    return parsed.data.map((item) => ({
      id: String(item.place_id),
      label: item.display_name,
      coordinate: [Number(item.lon), Number(item.lat)] as Coordinate,
      type: item.type,
      county: item.address?.county,
      countryCode: item.address?.country_code,
      isSyntheticData: false,
    }));
  }

  async reverse(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodingResult | null> {
    const url = new URL('/reverse', this.options.baseUrl);
    url.searchParams.set('lon', coordinate[0].toFixed(6));
    url.searchParams.set('lat', coordinate[1].toFixed(6));
    url.searchParams.set('format', 'jsonv2');

    const payload = await fetchJson<unknown>(url.toString(), {
      provider: this.name,
      timeoutMs: this.options.timeoutMs,
      signal,
      allowedHosts: [new URL(this.options.baseUrl).host],
      headers: { 'user-agent': this.options.userAgent },
    });
    const parsed = reverseSchema.safeParse(payload);
    if (!parsed.success || !parsed.data.display_name) return null;
    return { label: parsed.data.display_name, coordinate, isSyntheticData: false };
  }
}
