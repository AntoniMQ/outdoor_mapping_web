'use client';

import { create } from 'zustand';
import type {
  AccessPolicy,
  ActivityProfile,
  AnalysedRoute,
  AutomaticRouteType,
  ClimbingPreference,
  Coordinate,
  DistanceUnit,
  LoopDirection,
  LoopShape,
  OffRoadPreference,
  PlanningMode,
  RightsOfWayCategory,
  SurfacePreference,
  TechnicalityPreference,
} from '@/types/domain';

export interface RightsOfWayLayerVisibility {
  public_footpath: boolean;
  public_bridleway: boolean;
  restricted_byway: boolean;
  byway_open_to_all_traffic: boolean;
  permissive: boolean;
  unknown: boolean;
  surface: boolean;
  technical: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: RightsOfWayLayerVisibility = {
  public_footpath: true,
  public_bridleway: true,
  restricted_byway: true,
  byway_open_to_all_traffic: true,
  permissive: true,
  unknown: true,
  surface: false,
  technical: false,
};

interface PlannerStore {
  planningMode: PlanningMode;
  routeType: AutomaticRouteType;
  activityProfile: ActivityProfile;
  start: Coordinate | null;
  startLabel: string | null;
  destination: Coordinate | null;
  destinationLabel: string | null;
  targetDistance: number;
  distanceUnit: DistanceUnit;
  climbing: ClimbingPreference;
  surface: SurfacePreference;
  offRoad: OffRoadPreference;
  technicality: TechnicalityPreference;
  loopDirection: LoopDirection;
  loopShape: LoopShape;
  accessPolicy: AccessPolicy;
  variedReturn: boolean;

  results: AnalysedRoute[];
  selectedRouteId: string | null;
  isGenerating: boolean;
  generationError: string | null;

  rightsOfWayEnabled: boolean;
  layerVisibility: RightsOfWayLayerVisibility;
  inspectedFeatureId: string | null;

  set: <K extends keyof PlannerStore>(key: K, value: PlannerStore[K]) => void;
  setStart: (coordinate: Coordinate | null, label?: string | null) => void;
  setDestination: (coordinate: Coordinate | null, label?: string | null) => void;
  setResults: (results: AnalysedRoute[]) => void;
  selectRoute: (id: string | null) => void;
  toggleLayer: (key: keyof RightsOfWayLayerVisibility) => void;
  reset: () => void;
}

const initial = {
  planningMode: 'automatic' as PlanningMode,
  routeType: 'circular' as AutomaticRouteType,
  activityProfile: 'mtb' as ActivityProfile,
  start: null,
  startLabel: null,
  destination: null,
  destinationLabel: null,
  targetDistance: 25,
  distanceUnit: 'km' as DistanceUnit,
  climbing: 'no-preference' as ClimbingPreference,
  surface: 'no-preference' as SurfacePreference,
  offRoad: 'balanced' as OffRoadPreference,
  technicality: 'no-preference' as TechnicalityPreference,
  loopDirection: 'automatic' as LoopDirection,
  loopShape: 'compact' as LoopShape,
  accessPolicy: 'permit-uncertain' as AccessPolicy,
  variedReturn: true,
  results: [] as AnalysedRoute[],
  selectedRouteId: null,
  isGenerating: false,
  generationError: null,
  rightsOfWayEnabled: true,
  layerVisibility: DEFAULT_LAYER_VISIBILITY,
  inspectedFeatureId: null,
};

export const usePlannerStore = create<PlannerStore>((set) => ({
  ...initial,
  set: (key, value) => set({ [key]: value } as Pick<PlannerStore, typeof key>),
  setStart: (coordinate, label = null) => set({ start: coordinate, startLabel: label }),
  setDestination: (coordinate, label = null) =>
    set({ destination: coordinate, destinationLabel: label }),
  setResults: (results) =>
    set({ results, selectedRouteId: results[0]?.route.id ?? null, generationError: null }),
  selectRoute: (id) => set({ selectedRouteId: id }),
  toggleLayer: (key) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [key]: !state.layerVisibility[key] },
    })),
  reset: () => set(initial),
}));

export const LAYER_LABELS: Record<keyof RightsOfWayLayerVisibility, string> = {
  public_footpath: 'Public footpaths',
  public_bridleway: 'Public bridleways',
  restricted_byway: 'Restricted byways',
  byway_open_to_all_traffic: 'Byways open to all traffic',
  permissive: 'Permissive paths',
  unknown: 'Unknown-access paths',
  surface: 'Surface condition',
  technical: 'Technical trail data',
};

export const CATEGORY_TO_LAYER: Partial<
  Record<RightsOfWayCategory, keyof RightsOfWayLayerVisibility>
> = {
  public_footpath: 'public_footpath',
  public_bridleway: 'public_bridleway',
  restricted_byway: 'restricted_byway',
  byway_open_to_all_traffic: 'byway_open_to_all_traffic',
  permissive: 'permissive',
  unknown: 'unknown',
  track: 'unknown',
};
