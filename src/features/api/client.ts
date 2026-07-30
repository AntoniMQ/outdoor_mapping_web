import type {
  AccessPolicy,
  ActivityProfile,
  AnalysedRoute,
  BoundingBox,
  Coordinate,
  ElevationProfile,
  GeocodingResult,
  RightsOfWayCollection,
  RouteAnalysis,
} from '@/types/domain';
import type { CircularRequestInput, PlanRequestInput } from '@/lib/validation/schemas';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed with status ${response.status}`,
      body?.error?.code ?? 'UNKNOWN',
      response.status,
    );
  }
  return (await response.json()) as T;
}

export interface RouteListResponse {
  routes: AnalysedRoute[];
  provider: string;
  isSyntheticData: boolean;
  /** True when the caller must analyse each route separately. */
  analysisDeferred?: boolean;
  requestId: string;
}

export function generateCircularRoutes(
  body: CircularRequestInput,
  signal?: AbortSignal,
): Promise<RouteListResponse> {
  return request<RouteListResponse>('/api/routes/circular', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export function planRoute(
  body: PlanRequestInput,
  signal?: AbortSignal,
): Promise<RouteListResponse> {
  return request<RouteListResponse>('/api/routes/plan', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export interface AnalyseResponse {
  analysis: RouteAnalysis;
  elevation?: ElevationProfile;
  isSyntheticData: boolean;
}

export function analyseRoute(
  body: {
    geometry: { type: 'LineString'; coordinates: Coordinate[] };
    activityProfile: ActivityProfile;
    accessPolicy: AccessPolicy;
    segments?: Array<{ mode: 'routed' | 'freehand'; coordinates: Coordinate[] }>;
  },
  signal?: AbortSignal,
): Promise<AnalyseResponse> {
  return request<AnalyseResponse>('/api/routes/analyse', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export type RightsOfWayResponse = RightsOfWayCollection & {
  meta?: {
    zoomTooLow?: boolean;
    minZoom?: number;
    provider?: string;
    isSyntheticData?: boolean;
    featureCount?: number;
  };
};

export interface AnalyseBatchResponse {
  results: Array<{ id: string; analysis: RouteAnalysis; elevation?: ElevationProfile }>;
  isSyntheticData: boolean;
}

export function analyseRoutes(
  body: {
    routes: Array<{ id: string; geometry: { type: 'LineString'; coordinates: Coordinate[] } }>;
    activityProfile: ActivityProfile;
    accessPolicy: AccessPolicy;
  },
  signal?: AbortSignal,
): Promise<AnalyseBatchResponse> {
  return request<AnalyseBatchResponse>('/api/routes/analyse-batch', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export function fetchRightsOfWay(
  bbox: BoundingBox,
  zoom: number,
  signal?: AbortSignal,
): Promise<RightsOfWayResponse> {
  const params = new URLSearchParams({
    bbox: bbox.map((value) => value.toFixed(5)).join(','),
    zoom: zoom.toFixed(2),
  });
  return request<RightsOfWayResponse>(`/api/osm/rights-of-way?${params.toString()}`, { signal });
}

export function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<{ results: GeocodingResult[] }> {
  return request<{ results: GeocodingResult[] }>(
    `/api/geocode/search?q=${encodeURIComponent(query)}`,
    { signal },
  );
}

export interface GpxExportBody {
  name: string;
  description?: string;
  place?: string;
  activity?: ActivityProfile;
  segments: Array<{
    mode: 'routed' | 'freehand';
    coordinates: Coordinate[];
    elevations?: Array<number | null>;
  }>;
  waypoints: Array<{ coordinate: Coordinate; name: string; type?: 'start' | 'finish' | 'via' }>;
}

/** Downloads GPX through the API so filename and content type stay consistent. */
export async function downloadGpx(body: GpxExportBody): Promise<void> {
  const response = await fetch('/api/gpx/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiClientError(
      error?.error?.message ?? 'GPX export failed',
      'GPX_EXPORT_FAILED',
      response.status,
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'trailloop-route.gpx';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
