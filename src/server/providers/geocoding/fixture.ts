import type { Coordinate, GeocodingResult, ReverseGeocodingResult } from '@/types/domain';
import { haversineMetres } from '@/lib/geo/geometry';
import type { GeocodingProvider } from '@/server/providers/geocoding/types';

/** A small, fixed list of real place centroids used only to position the demo map. */
const PLACES: ReadonlyArray<{ id: string; label: string; coordinate: Coordinate; county: string }> =
  [
    {
      id: 'chorleywood',
      label: 'Chorleywood, Hertfordshire',
      coordinate: [-0.5183, 51.6541],
      county: 'Hertfordshire',
    },
    { id: 'peaslake', label: 'Peaslake, Surrey', coordinate: [-0.4396, 51.1907], county: 'Surrey' },
    {
      id: 'hebden-bridge',
      label: 'Hebden Bridge, West Yorkshire',
      coordinate: [-2.0155, 53.7423],
      county: 'West Yorkshire',
    },
    {
      id: 'bakewell',
      label: 'Bakewell, Derbyshire',
      coordinate: [-1.6752, 53.2129],
      county: 'Derbyshire',
    },
    {
      id: 'machynlleth',
      label: 'Machynlleth, Powys',
      coordinate: [-3.8514, 52.5906],
      county: 'Powys',
    },
    { id: 'exeter', label: 'Exeter, Devon', coordinate: [-3.5339, 50.7184], county: 'Devon' },
    {
      id: 'salisbury',
      label: 'Salisbury, Wiltshire',
      coordinate: [-1.7945, 51.0688],
      county: 'Wiltshire',
    },
    { id: 'keswick', label: 'Keswick, Cumbria', coordinate: [-3.1347, 54.6013], county: 'Cumbria' },
    { id: 'brecon', label: 'Brecon, Powys', coordinate: [-3.3924, 51.9481], county: 'Powys' },
    { id: 'norwich', label: 'Norwich, Norfolk', coordinate: [1.2974, 52.6309], county: 'Norfolk' },
  ];

export class FixtureGeocodingProvider implements GeocodingProvider {
  readonly name = 'fixture';
  readonly isSynthetic = true;

  async search(query: string): Promise<GeocodingResult[]> {
    const needle = query.trim().toLowerCase();
    return PLACES.filter((place) => place.label.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((place) => ({
        id: place.id,
        label: place.label,
        coordinate: place.coordinate,
        county: place.county,
        countryCode: 'gb',
        type: 'settlement',
        isSyntheticData: true,
      }));
  }

  async reverse(coordinate: Coordinate): Promise<ReverseGeocodingResult | null> {
    let best = PLACES[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const place of PLACES) {
      const distance = haversineMetres(coordinate, place.coordinate);
      if (distance < bestDistance) {
        best = place;
        bestDistance = distance;
      }
    }
    return {
      label: `Demo location near ${best.label}`,
      coordinate,
      isSyntheticData: true,
    };
  }
}

export const FIXTURE_PLACES = PLACES;
