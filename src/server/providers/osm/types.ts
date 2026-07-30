import type { BoundingBox, Jurisdiction, RightsOfWayCollection } from '@/types/domain';

export interface RightsOfWayQueryOptions {
  jurisdiction?: Jurisdiction;
  signal?: AbortSignal;
  /** Maximum features returned; providers must respect it to protect the browser. */
  limit?: number;
  /** Include ordinary roads. Used by route analysis, not by the map overlay. */
  includeRoads?: boolean;
  /** Corridor half-width for route-based queries, in metres. */
  corridorMetres?: number;
  requestId?: string;
}

export interface RightsOfWayProvider {
  readonly name: string;
  readonly isSynthetic: boolean;
  getFeatures(bbox: BoundingBox, options?: RightsOfWayQueryOptions): Promise<RightsOfWayCollection>;
  /**
   * Features within a short distance of one or more routes. Providers that can
   * do this cheaply should, because it keeps analysis of long routes bounded.
   */
  getFeaturesAlongRoutes?(
    routes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    options?: RightsOfWayQueryOptions,
  ): Promise<RightsOfWayCollection>;
}
