'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import type { BoundingBox, Coordinate, RouteControlPoint, RouteSegment } from '@/types/domain';
import { clientEnv } from '@/lib/env/client';
import { haversineMetres } from '@/lib/geo/geometry';
import { LEGEND_ORDER, RIGHTS_OF_WAY_STYLES } from '@/features/rights-of-way/styles';
import { CATEGORY_TO_LAYER, type RightsOfWayLayerVisibility } from '@/stores/planner-store';
import type { FlatRightsOfWayProperties } from '@/components/map/map-features';

export interface MapRoute {
  id: string;
  geometry: LineString;
  active: boolean;
}

export interface PlannerMapProps {
  rightsOfWay?: FeatureCollection<LineString, FlatRightsOfWayProperties>;
  rightsOfWayEnabled: boolean;
  layerVisibility: RightsOfWayLayerVisibility;
  routes: MapRoute[];
  freehandSegments: RouteSegment[];
  controlPoints: RouteControlPoint[];
  draggablePoints: boolean;
  freehandActive: boolean;
  fitToRouteKey?: string;
  onMapClick?: (coordinate: Coordinate) => void;
  onRouteClick?: (routeId: string, coordinate: Coordinate) => void;
  onFeatureClick?: (osmId: number) => void;
  onPointDragEnd?: (pointId: string, coordinate: Coordinate) => void;
  onFreehandStroke?: (coordinates: Coordinate[]) => void;
  onViewportChange?: (bbox: BoundingBox, zoom: number) => void;
  initialCentre?: Coordinate;
}

const EMPTY: FeatureCollection<LineString, never> = { type: 'FeatureCollection', features: [] };

/**
 * Blank local style used when NEXT_PUBLIC_MAP_STYLE_URL=offline. It needs no
 * network access, which keeps end-to-end tests and air-gapped demos working.
 */
const OFFLINE_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#e9e6dd' } },
  ],
};

export function PlannerMap(props: PlannerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const drawingRef = useRef<{ active: boolean; coordinates: Coordinate[] }>({
    active: false,
    coordinates: [],
  });
  const propsRef = useRef(props);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    propsRef.current = props;
  });

  const emitViewport = useCallback((map: MapLibreMap) => {
    const bounds = map.getBounds();
    const bbox: BoundingBox = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    propsRef.current.onViewportChange?.(bbox, map.getZoom());
  }, []);

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const markers = markersRef.current;

    // MapLibre is loaded dynamically: it cannot run during server rendering.
    void import('maplibre-gl')
      .then(({ Map, NavigationControl, ScaleControl, AttributionControl }) => {
        if (cancelled || !containerRef.current) return;
        map = new Map({
          container: containerRef.current,
          style:
            clientEnv.NEXT_PUBLIC_MAP_STYLE_URL === 'offline'
              ? OFFLINE_STYLE
              : clientEnv.NEXT_PUBLIC_MAP_STYLE_URL,
          center: propsRef.current.initialCentre ?? [-0.5183, 51.6541],
          zoom: 13,
          attributionControl: false,
          hash: false,
        });
        mapRef.current = map;
        map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
        map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
        map.addControl(
          new AttributionControl({
            compact: true,
            customAttribution:
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          }),
          'bottom-right',
        );

        map.on('load', () => {
          if (cancelled) return;
          installLayers(map!);
          setReady(true);
          emitViewport(map!);
        });
        map.on('error', (event) => {
          // Style/tile failures must not break the planner.
          console.warn('Map error', event.error?.message);
        });
        map.on('moveend', () => emitViewport(map!));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : 'Map failed to load');
      });

    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [emitViewport]);

  /* ------------------------------------------------------------- handlers */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const handleClick = (event: MapMouseEvent) => {
      const current = propsRef.current;
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      const features = map.queryRenderedFeatures(event.point, {
        layers: layerIdsForQuery(map),
      });
      const routeFeature = features.find((feature) => feature.layer.id === 'routes-line');
      if (routeFeature && current.onRouteClick) {
        current.onRouteClick(String(routeFeature.properties?.routeId ?? ''), coordinate);
        return;
      }
      const rowFeature = features.find((feature) => feature.layer.id.startsWith('row-'));
      if (rowFeature && current.onFeatureClick) {
        current.onFeatureClick(Number(rowFeature.properties?.osmId));
        return;
      }
      current.onMapClick?.(coordinate);
    };

    const handleDown = (event: MapMouseEvent) => {
      if (!propsRef.current.freehandActive) return;
      event.preventDefault();
      drawingRef.current = { active: true, coordinates: [[event.lngLat.lng, event.lngLat.lat]] };
      map.dragPan.disable();
    };

    const handleMove = (event: MapMouseEvent) => {
      if (!drawingRef.current.active) return;
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      const last = drawingRef.current.coordinates[drawingRef.current.coordinates.length - 1];
      // Sample at a controlled interval rather than on every pointer event.
      if (!last || haversineMetres(last, coordinate) >= 8) {
        drawingRef.current.coordinates.push(coordinate);
        updateSource(map, 'draft', {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: drawingRef.current.coordinates },
            },
          ],
        });
      }
    };

    const handleUp = () => {
      if (!drawingRef.current.active) return;
      const coordinates = drawingRef.current.coordinates;
      drawingRef.current = { active: false, coordinates: [] };
      map.dragPan.enable();
      updateSource(map, 'draft', EMPTY);
      if (coordinates.length >= 2) propsRef.current.onFreehandStroke?.(coordinates);
    };

    map.on('click', handleClick);
    map.on('mousedown', handleDown);
    map.on('mousemove', handleMove);
    map.on('mouseup', handleUp);
    map.on('touchstart', handleDown);
    map.on('touchmove', handleMove);
    map.on('touchend', handleUp);

    return () => {
      map.off('click', handleClick);
      map.off('mousedown', handleDown);
      map.off('mousemove', handleMove);
      map.off('mouseup', handleUp);
      map.off('touchstart', handleDown);
      map.off('touchmove', handleMove);
      map.off('touchend', handleUp);
    };
  }, [ready]);

  /* ------------------------------------------------------------- data sync */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateSource(map, 'rights-of-way', props.rightsOfWay ?? EMPTY);
  }, [props.rightsOfWay, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const category of LEGEND_ORDER) {
      const layerKey = CATEGORY_TO_LAYER[category];
      const visible =
        props.rightsOfWayEnabled && (layerKey ? props.layerVisibility[layerKey] : true);
      setVisibility(map, `row-${category}`, visible);
    }
    setVisibility(map, 'row-surface', props.rightsOfWayEnabled && props.layerVisibility.surface);
    setVisibility(
      map,
      'row-technical',
      props.rightsOfWayEnabled && props.layerVisibility.technical,
    );
  }, [props.layerVisibility, props.rightsOfWayEnabled, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateSource(map, 'routes', {
      type: 'FeatureCollection',
      features: props.routes.map((route) => ({
        type: 'Feature',
        properties: { routeId: route.id, active: route.active ? 1 : 0 },
        geometry: route.geometry,
      })),
    });
    updateSource(map, 'freehand', {
      type: 'FeatureCollection',
      features: props.freehandSegments.map((segment) => ({
        type: 'Feature',
        properties: { segmentId: segment.id },
        geometry: segment.geometry,
      })),
    });
  }, [props.routes, props.freehandSegments, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void syncMarkers(
      map,
      markersRef.current,
      props.controlPoints,
      props.draggablePoints,
      (id, coordinate) => propsRef.current.onPointDragEnd?.(id, coordinate),
    );
  }, [props.controlPoints, props.draggablePoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.fitToRouteKey) return;
    const active = props.routes.find((route) => route.active) ?? props.routes[0];
    if (!active || active.geometry.coordinates.length < 2) return;
    const coordinates = active.geometry.coordinates as Coordinate[];
    let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of coordinates) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 64, duration: 600 },
    );
    // Only refit when the caller explicitly changes the key — never on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitToRouteKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = props.freehandActive ? 'crosshair' : '';
  }, [props.freehandActive, ready]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="map-canvas"
        className="h-full w-full bg-[var(--color-surface-muted)]"
        aria-label="Route map. A text summary of the route is available in the route summary panel."
        role="application"
      />
      {!ready && !failed ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[var(--color-ink-muted)]"
          aria-live="polite"
        >
          Loading map…
        </div>
      ) : null}
      {failed ? (
        <div
          className="absolute inset-0 grid place-items-center p-6 text-center text-sm"
          role="alert"
        >
          The map could not be loaded ({failed}). Route planning still works, and the route summary
          below stays available.
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function layerIdsForQuery(map: MapLibreMap): string[] {
  return ['routes-line', ...LEGEND_ORDER.map((category) => `row-${category}`)].filter((id) =>
    Boolean(map.getLayer(id)),
  );
}

function updateSource(map: MapLibreMap, id: string, data: FeatureCollection): void {
  const source = map.getSource(id);
  if (source && 'setData' in source) {
    (source as { setData: (value: FeatureCollection) => void }).setData(data);
  }
}

function setVisibility(map: MapLibreMap, layerId: string, visible: boolean): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function installLayers(map: MapLibreMap): void {
  map.addSource('rights-of-way', { type: 'geojson', data: EMPTY });
  map.addSource('routes', { type: 'geojson', data: EMPTY });
  map.addSource('freehand', { type: 'geojson', data: EMPTY });
  map.addSource('draft', { type: 'geojson', data: EMPTY });

  for (const category of LEGEND_ORDER) {
    const style = RIGHTS_OF_WAY_STYLES[category];
    map.addLayer({
      id: `row-${category}`,
      type: 'line',
      source: 'rights-of-way',
      filter: ['==', ['get', 'category'], category],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': style.color,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          style.width * 0.6,
          16,
          style.width * 1.4,
        ],
        ...(style.dashArray.length ? { 'line-dasharray': style.dashArray } : {}),
        'line-opacity': 0.95,
      },
    });
  }

  map.addLayer({
    id: 'row-surface',
    type: 'line',
    source: 'rights-of-way',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'surfaceClass'],
        'paved',
        '#334155',
        'unpaved',
        '#b45309',
        '#94a3b8',
      ],
      'line-width': 1.4,
      'line-offset': 4,
    },
  });

  map.addLayer({
    id: 'row-technical',
    type: 'line',
    source: 'rights-of-way',
    filter: ['!=', ['get', 'mtbScale'], ''],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'mtbScale'],
        '0',
        '#22c55e',
        '1',
        '#eab308',
        '2',
        '#f97316',
        '#dc2626',
      ],
      'line-width': 2,
      'line-offset': -4,
    },
  });

  map.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'var(--color-route-casing)'.startsWith('var') ? '#ffffff' : '#ffffff',
      'line-width': ['case', ['==', ['get', 'active'], 1], 9, 6],
      'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.9, 0.4],
    },
  });

  map.addLayer({
    id: 'routes-line',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'active'], 1], '#e8590c', '#9a8c82'],
      'line-width': ['case', ['==', ['get', 'active'], 1], 5, 3],
      'line-opacity': ['case', ['==', ['get', 'active'], 1], 1, 0.65],
    },
  });

  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'routes-direction',
      type: 'symbol',
      source: 'routes',
      filter: ['==', ['get', 'active'], 1],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 120,
        'text-field': '▶',
        'text-size': 11,
        'text-keep-upright': false,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#e8590c', 'text-halo-width': 1.4 },
    });
  }

  map.addLayer({
    id: 'freehand-line',
    type: 'line',
    source: 'freehand',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#7c3aed', 'line-width': 4, 'line-dasharray': [1.4, 1.2] },
  });

  map.addLayer({
    id: 'draft-line',
    type: 'line',
    source: 'draft',
    paint: { 'line-color': '#7c3aed', 'line-width': 3, 'line-dasharray': [1, 1] },
  });
}

async function syncMarkers(
  map: MapLibreMap,
  markers: Map<string, Marker>,
  points: RouteControlPoint[],
  draggable: boolean,
  onDragEnd: (pointId: string, coordinate: Coordinate) => void,
): Promise<void> {
  const { Marker } = await import('maplibre-gl');
  const seen = new Set<string>();

  points.forEach((point, index) => {
    seen.add(point.id);
    const existing = markers.get(point.id);
    if (existing) {
      existing.setLngLat(point.coordinate);
      existing.setDraggable(draggable && !point.locked);
      const element = existing.getElement();
      element.dataset.pointType = point.type;
      element.textContent = markerLabel(point, index, points.length);
      element.style.background = markerColour(point);
      return;
    }

    const element = document.createElement('button');
    element.type = 'button';
    element.dataset.testid = `control-point-${index}`;
    element.dataset.pointId = point.id;
    element.dataset.pointType = point.type;
    element.setAttribute('aria-label', `${point.type} point ${index + 1}`);
    element.textContent = markerLabel(point, index, points.length);
    element.style.cssText = [
      'width:22px',
      'height:22px',
      'border-radius:999px',
      'border:2px solid #fff',
      'color:#fff',
      'font-size:10px',
      'font-weight:700',
      'cursor:pointer',
      'display:grid',
      'place-items:center',
      'box-shadow:0 1px 4px rgba(0,0,0,.4)',
      `background:${markerColour(point)}`,
    ].join(';');

    const marker = new Marker({ element, draggable: draggable && !point.locked })
      .setLngLat(point.coordinate)
      .addTo(map);
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      onDragEnd(point.id, [lngLat.lng, lngLat.lat]);
    });
    markers.set(point.id, marker);
  });

  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }
}

function markerLabel(point: RouteControlPoint, index: number, total: number): string {
  if (point.type === 'start') return 'S';
  if (point.type === 'destination' || index === total - 1) return 'F';
  if (point.type === 'shaping') return '•';
  return String(index);
}

function markerColour(point: RouteControlPoint): string {
  switch (point.type) {
    case 'start':
      return '#2f5d43';
    case 'destination':
      return '#b91c1c';
    case 'shaping':
      return '#64748b';
    case 'freehand':
      return '#7c3aed';
    default:
      return '#e8590c';
  }
}
