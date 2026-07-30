import type { BoundingBox, Jurisdiction, RightsOfWayCollection } from '@/types/domain';

export interface RightsOfWayQueryOptions {
  jurisdiction?: Jurisdiction;
  signal?: AbortSignal;
  /** Maximum features returned; providers must respect it to protect the browser. */
  limit?: number;
  /** Include ordinary roads. Used by route analysis, not by the map overlay. */
  includeRoads?: boolean;
  requestId?: string;
}

export interface RightsOfWayProvider {
  readonly name: string;
  readonly isSynthetic: boolean;
  getFeatures(bbox: BoundingBox, options?: RightsOfWayQueryOptions): Promise<RightsOfWayCollection>;
}
