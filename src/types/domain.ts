import type { Feature, FeatureCollection, LineString } from 'geojson';

/** [longitude, latitude] — always in this order, WGS84. */
export type Coordinate = [number, number];

/** [minLon, minLat, maxLon, maxLat] */
export type BoundingBox = [number, number, number, number];

export type ActivityProfile = 'mtb' | 'gravel' | 'road' | 'hiking';

export const ACTIVITY_PROFILES: readonly ActivityProfile[] = ['mtb', 'gravel', 'road', 'hiking'];

export type PlanningMode = 'automatic' | 'manual';
export type AutomaticRouteType = 'circular' | 'point-to-point' | 'out-and-back';
export type ManualDrawMode = 'snap' | 'freehand';

export type ClimbingPreference = 'low' | 'moderate' | 'high' | 'no-preference';
export type SurfacePreference = 'prefer-paved' | 'mixed' | 'prefer-unpaved' | 'no-preference';
export type OffRoadPreference = 'minimise' | 'balanced' | 'maximise';
export type TechnicalityPreference = 'easy' | 'moderate' | 'technical' | 'no-preference';
export type LoopDirection = 'automatic' | 'clockwise' | 'anticlockwise';
export type LoopShape = 'compact' | 'wide' | 'adventure';

/**
 * How strictly the planner treats mapped access information.
 * `strict` = only paths with confirmed cycling access.
 */
export type AccessPolicy = 'strict' | 'permit-uncertain' | 'show-all';

export type Jurisdiction = 'england-wales' | 'scotland' | 'northern-ireland' | 'unknown';

export type DistanceUnit = 'km' | 'mi';

/* -------------------------------------------------------------------------- */
/* Rights of way                                                               */
/* -------------------------------------------------------------------------- */

export type Designation =
  | 'public_footpath'
  | 'public_bridleway'
  | 'restricted_byway'
  | 'byway_open_to_all_traffic'
  | 'other'
  | 'none';

export type AccessConfidence = 'high' | 'medium' | 'low' | 'unknown';

export type CyclingStatus =
  'confirmed' | 'permissive' | 'uncertain' | 'not-confirmed' | 'prohibited';

export type WalkingStatus = CyclingStatus;

/** Raw OSM tags relevant to rights of way. Missing tags stay undefined — never invented. */
export interface OsmPathTags {
  highway?: string;
  designation?: string;
  access?: string;
  foot?: string;
  bicycle?: string;
  horse?: string;
  motor_vehicle?: string;
  vehicle?: string;
  surface?: string;
  tracktype?: string;
  smoothness?: string;
  width?: string;
  incline?: string;
  'mtb:scale'?: string;
  trail_visibility?: string;
  sac_scale?: string;
  name?: string;
  ref?: string;
  prow_ref?: string;
  operator?: string;
  lit?: string;
  bridge?: string;
  tunnel?: string;
  ford?: string;
  [key: string]: string | undefined;
}

export interface AccessAssessment {
  cyclingStatus: CyclingStatus;
  confidence: AccessConfidence;
  reasons: string[];
  source: 'osm' | 'local-authority' | 'inferred';
}

/** Full classification of a mapped way. */
export interface PathClassification {
  designation: Designation;
  /** Legal-ish category used for map styling and legend grouping. */
  category: RightsOfWayCategory;
  physicalType: string;
  jurisdiction: Jurisdiction;
  cycling: AccessAssessment;
  walking: { status: WalkingStatus; confidence: AccessConfidence; reasons: string[] };
  horse: { status: CyclingStatus; confidence: AccessConfidence };
  motorVehicle: { status: CyclingStatus; confidence: AccessConfidence };
  surfaceClass: SurfaceClass;
  isPermissive: boolean;
}

export type RightsOfWayCategory =
  | 'public_footpath'
  | 'public_bridleway'
  | 'restricted_byway'
  | 'byway_open_to_all_traffic'
  | 'permissive'
  | 'cycleway'
  | 'road'
  | 'track'
  | 'unknown';

export type SurfaceClass = 'paved' | 'unpaved' | 'unknown';

export interface RightsOfWayFeatureProperties extends Record<string, unknown> {
  osmType: 'way' | 'relation';
  osmId: number;
  tags: OsmPathTags;
  classification: PathClassification;
  source: 'osm-overpass' | 'osm-postgis' | 'fixture';
  sourceUpdatedAt?: string;
}

export type RightsOfWayFeature = Feature<LineString, RightsOfWayFeatureProperties>;
export type RightsOfWayCollection = FeatureCollection<LineString, RightsOfWayFeatureProperties>;

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

export interface NormalisedRouteSegment {
  index: number;
  coordinates: Coordinate[];
  distanceMetres: number;
  ascentMetres?: number;
  descentMetres?: number;
  osmWayId?: number;
  /** Tags supplied directly by the provider when available. */
  tags?: OsmPathTags;
  surface?: string;
  wayType?: string;
}

export type RouteWarningCode =
  | 'PUBLIC_FOOTPATH_CYCLING_UNCONFIRMED'
  | 'PRIVATE_ACCESS'
  | 'PERMISSIVE_ACCESS'
  | 'UNKNOWN_ACCESS'
  | 'UNKNOWN_SURFACE'
  | 'MANUAL_SEGMENT_UNVERIFIED'
  | 'HIGH_ROAD_STRESS'
  | 'FORD'
  | 'STEPS'
  | 'STEEP_SECTION'
  | 'LOW_DATA_COVERAGE'
  | 'DISTANCE_MISMATCH'
  | 'DEMO_DATA';

export type WarningSeverity = 'info' | 'caution' | 'critical';

export interface RouteWarning {
  code: RouteWarningCode;
  severity: WarningSeverity;
  message: string;
  affectedDistanceMetres: number;
  segmentIndexes: number[];
  geometry?: LineString;
}

export interface NormalisedRoute {
  id: string;
  geometry: LineString;
  distanceMetres: number;
  durationSeconds?: number;
  ascentMetres?: number;
  descentMetres?: number;
  bbox: BoundingBox;
  segments: NormalisedRouteSegment[];
  provider: string;
  providerRouteId?: string;
  warnings: RouteWarning[];
  /** True when the geometry came from deterministic synthetic fixtures. */
  isSyntheticData: boolean;
}

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

export interface SurfaceBreakdown {
  pavedPercent: number;
  unpavedPercent: number;
  unknownPercent: number;
  offRoadPercent: number;
}

export interface DesignationBreakdown {
  publicFootpathPercent: number;
  publicBridlewayPercent: number;
  restrictedBywayPercent: number;
  bywayOpenToAllTrafficPercent: number;
  permissivePercent: number;
  roadPercent: number;
  otherPercent: number;
}

export interface AccessBreakdown {
  confirmedPercent: number;
  permissivePercent: number;
  uncertainPercent: number;
  notConfirmedPercent: number;
  prohibitedPercent: number;
}

export interface CoverageBreakdown {
  accessDataPercent: number;
  surfaceDataPercent: number;
  technicalDataPercent: number;
}

export interface ElevationPoint {
  distanceMetres: number;
  elevationMetres: number;
  coordinate: Coordinate;
}

export interface ElevationProfile {
  points: ElevationPoint[];
  ascentMetres: number;
  descentMetres: number;
  minElevationMetres: number;
  maxElevationMetres: number;
  source: string;
  isSyntheticData: boolean;
}

export interface RouteScoreComponents {
  distanceFit: number;
  accessConfidence: number;
  offRoadFit: number;
  roadStressFit: number;
  climbingFit: number;
  surfaceFit: number;
  routeUniqueness: number;
  loopShapeQuality: number;
}

export interface RouteAnalysis {
  distanceMetres: number;
  durationSeconds: number;
  ascentMetres: number;
  descentMetres: number;
  highestPointMetres?: number;
  lowestPointMetres?: number;
  surface: SurfaceBreakdown;
  designation: DesignationBreakdown;
  access: AccessBreakdown;
  coverage: CoverageBreakdown;
  repeatedPercent: number;
  warnings: RouteWarning[];
  jurisdiction: Jurisdiction;
  matchedDistanceMetres: number;
  isSyntheticData: boolean;
}

export interface AnalysedRoute {
  route: NormalisedRoute;
  analysis: RouteAnalysis;
  elevation?: ElevationProfile;
  label?: string;
  labelKey?: CandidateLabelKey;
  score?: number;
  scoreComponents?: RouteScoreComponents;
  rationale?: string[];
}

export type CandidateLabelKey = 'most-off-road' | 'balanced' | 'easier';

/* -------------------------------------------------------------------------- */
/* Manual editing                                                              */
/* -------------------------------------------------------------------------- */

export type RouteControlPointType = 'start' | 'destination' | 'via' | 'shaping' | 'freehand';

export interface RouteControlPoint {
  id: string;
  type: RouteControlPointType;
  coordinate: Coordinate;
  sequence: number;
  name?: string;
  locked?: boolean;
}

export type RouteSegmentMode = 'routed' | 'freehand';

export interface RouteSegment {
  id: string;
  fromPointId: string;
  toPointId: string;
  mode: RouteSegmentMode;
  activityProfile: ActivityProfile;
  geometry: LineString;
  distanceMetres: number;
  ascentMetres?: number;
  descentMetres?: number;
  status: 'idle' | 'pending' | 'error';
  errorMessage?: string;
  /** Monotonic version used to discard out-of-order routing responses. */
  version: number;
  providerMetadata?: Record<string, unknown>;
}

export interface ManualRouteState {
  points: RouteControlPoint[];
  segments: RouteSegment[];
  closed: boolean;
  activityProfile: ActivityProfile;
  drawMode: ManualDrawMode;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

export interface RoutePreferences {
  activityProfile: ActivityProfile;
  climbing: ClimbingPreference;
  surface: SurfacePreference;
  offRoad: OffRoadPreference;
  technicality: TechnicalityPreference;
  accessPolicy: AccessPolicy;
}

export interface CircularRouteRequest extends RoutePreferences {
  start: Coordinate;
  targetDistanceMetres: number;
  loopDirection: LoopDirection;
  loopShape: LoopShape;
  seed?: number;
}

export interface PointToPointRequest extends RoutePreferences {
  start: Coordinate;
  destination: Coordinate;
  via: Coordinate[];
}

export interface OutAndBackRequest extends RoutePreferences {
  start: Coordinate;
  destination?: Coordinate;
  targetDistanceMetres?: number;
  variedReturn: boolean;
}

export interface GeocodingResult {
  id: string;
  label: string;
  coordinate: Coordinate;
  type?: string;
  county?: string;
  countryCode?: string;
  isSyntheticData: boolean;
}

export interface ReverseGeocodingResult {
  label: string;
  coordinate: Coordinate;
  isSyntheticData: boolean;
}
