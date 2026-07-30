import type { Coordinate } from '@/types/domain';

/**
 * Google encoded-polyline decoder. Valhalla uses precision 6 by default,
 * most other engines use 5.
 */
export function decodePolyline(encoded: string, precision = 6): Coordinate[] {
  const factor = 10 ** precision;
  const coordinates: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}
