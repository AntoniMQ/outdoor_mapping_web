import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { RightsOfWayCollection } from '@/types/domain';

export interface FlatRightsOfWayProperties {
  osmId: number;
  category: string;
  cyclingStatus: string;
  confidence: string;
  surfaceClass: string;
  designation: string;
  highway: string;
  name: string;
  mtbScale: string;
}

/**
 * MapLibre style expressions only read top-level feature properties reliably,
 * so the classification is flattened before the data reaches the map.
 */
export function toMapFeatures(
  collection: RightsOfWayCollection,
): FeatureCollection<LineString, FlatRightsOfWayProperties> {
  const features: Array<Feature<LineString, FlatRightsOfWayProperties>> = collection.features.map(
    (feature) => ({
      type: 'Feature',
      id: feature.properties.osmId,
      geometry: feature.geometry,
      properties: {
        osmId: feature.properties.osmId,
        category: feature.properties.classification.category,
        cyclingStatus: feature.properties.classification.cycling.cyclingStatus,
        confidence: feature.properties.classification.cycling.confidence,
        surfaceClass: feature.properties.classification.surfaceClass,
        designation: feature.properties.classification.designation,
        highway: feature.properties.tags.highway ?? '',
        name: feature.properties.tags.name ?? '',
        mtbScale: feature.properties.tags['mtb:scale'] ?? '',
      },
    }),
  );
  return { type: 'FeatureCollection', features };
}
