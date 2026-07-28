'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type {
  AnalysedRoute,
  AutomaticRouteType,
  BoundingBox,
  Coordinate,
  ManualDrawMode,
  PlanningMode,
  RightsOfWayFeature,
} from '@/types/domain';
import { unitToMetres } from '@/lib/format';
import { combinedGeometry } from '@/features/manual-routing/reducer';
import { toMapFeatures } from '@/components/map/map-features';
import { useRightsOfWay, RIGHTS_OF_WAY_MIN_ZOOM } from '@/features/api/hooks';
import {
  analyseRoute,
  downloadGpx,
  generateCircularRoutes,
  planRoute,
  ApiClientError,
} from '@/features/api/client';
import { usePlannerStore } from '@/stores/planner-store';
import { useCanRedo, useCanUndo, useEditorState, useEditorStore } from '@/stores/editor-store';
import { PlannerMap, type MapRoute } from '@/components/map/planner-map';
import { PlanningPanel } from '@/components/planner/planning-panel';
import { ManualToolbar } from '@/components/route-editor/manual-toolbar';
import { RouteCard } from '@/components/route-results/route-card';
import { RouteSummary, TextRouteSummary } from '@/components/route-results/route-summary';
import { RightsOfWayLegend } from '@/components/rights-of-way/legend';
import { FeatureInspector } from '@/components/rights-of-way/feature-inspector';
import { Button, Panel, Spinner } from '@/components/ui';

export function Planner({ fixtureMode }: { fixtureMode: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const store = usePlannerStore();
  const editor = useEditorState();
  const dispatch = useEditorStore((state) => state.dispatch);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const [panelOpen, setPanelOpen] = useState(true);
  const [viewport, setViewport] = useState<{ bbox: BoundingBox | null; zoom: number }>({
    bbox: null,
    zoom: 13,
  });
  const [manualResult, setManualResult] = useState<AnalysedRoute | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [fitKey, setFitKey] = useState<string | undefined>(undefined);
  const generationAbort = useRef<AbortController | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);

  /* ------------------------------------------------------------- URL state */
  const planningMode = (searchParams.get('mode') as PlanningMode | null) ?? store.planningMode;
  const routeType = (searchParams.get('type') as AutomaticRouteType | null) ?? store.routeType;

  const updateUrl = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(next).forEach(([key, value]) => params.set(key, value));
      router.replace(`/planner?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (planningMode !== store.planningMode) store.set('planningMode', planningMode);
    if (routeType !== store.routeType) store.set('routeType', routeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningMode, routeType]);

  useEffect(() => {
    if (editor.activityProfile !== store.activityProfile) {
      dispatch({ type: 'set-activity', activityProfile: store.activityProfile });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activityProfile]);

  /* --------------------------------------------------------- rights of way */
  const rightsOfWay = useRightsOfWay(viewport.bbox, viewport.zoom, store.rightsOfWayEnabled);
  const mapFeatures = useMemo(
    () => (rightsOfWay.collection ? toMapFeatures(rightsOfWay.collection) : undefined),
    [rightsOfWay.collection],
  );
  const inspectedFeature: RightsOfWayFeature | null = useMemo(() => {
    if (!store.inspectedFeatureId || !rightsOfWay.collection) return null;
    return (
      rightsOfWay.collection.features.find(
        (feature) => String(feature.properties.osmId) === store.inspectedFeatureId,
      ) ?? null
    );
  }, [store.inspectedFeatureId, rightsOfWay.collection]);

  /* ------------------------------------------------- manual segment routing */
  useEffect(() => {
    const pending = editor.segments.filter(
      (segment) => segment.mode === 'routed' && segment.status === 'pending',
    );
    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const segment of pending) {
        const from = editor.points.find((point) => point.id === segment.fromPointId);
        const to = editor.points.find((point) => point.id === segment.toPointId);
        if (!from || !to) continue;
        try {
          const response = await planRoute({
            type: 'point-to-point',
            start: from.coordinate,
            destination: to.coordinate,
            via: [],
            activityProfile: editor.activityProfile,
            accessPolicy: store.accessPolicy,
            climbing: store.climbing,
            surface: store.surface,
            offRoad: store.offRoad,
            technicality: store.technicality,
          });
          if (cancelled) return;
          const first = response.routes[0];
          if (!first) throw new Error('No route returned');
          dispatch({
            type: 'segment-routed',
            segmentId: segment.id,
            version: segment.version,
            coordinates: first.route.geometry.coordinates as Coordinate[],
            distanceMetres: first.route.distanceMetres,
            ascentMetres: first.route.ascentMetres,
            descentMetres: first.route.descentMetres,
            providerMetadata: { provider: first.route.provider },
          });
        } catch (error) {
          if (cancelled) return;
          dispatch({
            type: 'segment-error',
            segmentId: segment.id,
            version: segment.version,
            message:
              error instanceof ApiClientError ? error.message : 'Routing failed for this section.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.segments, editor.points, editor.activityProfile]);

  /* ------------------------------------------------------- manual analysis */
  const manualCoordinates = useMemo(() => combinedGeometry(editor), [editor]);
  const manualSignature = useMemo(
    () =>
      `${manualCoordinates.length}:${editor.segments.map((segment) => `${segment.id}:${segment.version}:${Math.round(segment.distanceMetres)}`).join('|')}`,
    [manualCoordinates.length, editor.segments],
  );

  useEffect(() => {
    if (planningMode !== 'manual') return;
    if (editor.segments.some((segment) => segment.status === 'pending')) return;

    const timer = setTimeout(() => {
      if (manualCoordinates.length < 2) {
        setManualResult(null);
        return;
      }
      analysisAbort.current?.abort();
      const controller = new AbortController();
      analysisAbort.current = controller;
      setManualBusy(true);
      void analyseRoute(
        {
          geometry: { type: 'LineString', coordinates: manualCoordinates },
          activityProfile: editor.activityProfile,
          accessPolicy: store.accessPolicy,
          segments: editor.segments.map((segment) => ({
            mode: segment.mode,
            coordinates: segment.geometry.coordinates as Coordinate[],
          })),
        },
        controller.signal,
      )
        .then((response) => {
          setManualResult({
            route: {
              id: 'manual-route',
              geometry: { type: 'LineString', coordinates: manualCoordinates },
              distanceMetres: response.analysis.distanceMetres,
              bbox: [0, 0, 0, 0],
              segments: [],
              provider: 'manual',
              warnings: response.analysis.warnings,
              isSyntheticData: response.isSyntheticData,
            },
            analysis: response.analysis,
            elevation: response.elevation,
            label: 'Manual route',
          });
        })
        .catch(() => undefined)
        .finally(() => setManualBusy(false));
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSignature, planningMode, store.accessPolicy]);

  /* ------------------------------------------------------------- generation */
  const disabledReason = useMemo(() => {
    if (planningMode !== 'automatic') return null;
    if (!store.start) return 'Set a start point on the map or with the search box first.';
    if (routeType === 'point-to-point' && !store.destination)
      return 'Set a destination by clicking the map.';
    if (routeType !== 'point-to-point' && store.targetDistance <= 0)
      return 'Enter a target distance.';
    return null;
  }, [planningMode, routeType, store.start, store.destination, store.targetDistance]);

  const generate = useCallback(async () => {
    if (!store.start || disabledReason) return;
    generationAbort.current?.abort();
    const controller = new AbortController();
    generationAbort.current = controller;
    store.set('isGenerating', true);
    store.set('generationError', null);

    const preferences = {
      activityProfile: store.activityProfile,
      climbing: store.climbing,
      surface: store.surface,
      offRoad: store.offRoad,
      technicality: store.technicality,
      accessPolicy: store.accessPolicy,
    } as const;

    try {
      const targetMetres = unitToMetres(store.targetDistance, store.distanceUnit);
      const response =
        routeType === 'circular'
          ? await generateCircularRoutes(
              {
                ...preferences,
                start: store.start,
                targetDistanceMetres: targetMetres,
                loopDirection: store.loopDirection,
                loopShape: store.loopShape,
              },
              controller.signal,
            )
          : routeType === 'point-to-point'
            ? await planRoute(
                {
                  ...preferences,
                  type: 'point-to-point',
                  start: store.start,
                  destination: store.destination!,
                  via: [],
                },
                controller.signal,
              )
            : await planRoute(
                {
                  ...preferences,
                  type: 'out-and-back',
                  start: store.start,
                  destination: store.destination ?? undefined,
                  targetDistanceMetres: store.destination ? undefined : targetMetres,
                  variedReturn: store.variedReturn,
                },
                controller.signal,
              );

      store.setResults(response.routes);
      setFitKey(`${Date.now()}`);
    } catch (error) {
      store.set(
        'generationError',
        error instanceof ApiClientError
          ? error.message
          : 'Route generation failed. Please try again.',
      );
    } finally {
      store.set('isGenerating', false);
    }
  }, [disabledReason, routeType, store]);

  /* ------------------------------------------------------------ map wiring */
  const selectedResult =
    store.results.find((result) => result.route.id === store.selectedRouteId) ??
    store.results[0] ??
    null;

  const mapRoutes: MapRoute[] = useMemo(() => {
    if (planningMode === 'manual') {
      return editor.segments
        .filter((segment) => segment.mode === 'routed')
        .map((segment) => ({ id: segment.id, geometry: segment.geometry, active: true }));
    }
    return store.results.map((result) => ({
      id: result.route.id,
      geometry: result.route.geometry,
      active: result.route.id === selectedResult?.route.id,
    }));
  }, [planningMode, editor.segments, store.results, selectedResult]);

  const handleMapClick = useCallback(
    (coordinate: Coordinate) => {
      store.set('inspectedFeatureId', null);
      if (planningMode === 'manual') {
        if (editor.drawMode === 'freehand') return;
        dispatch({ type: 'add-point', coordinate });
        return;
      }
      if (!store.start || routeType === 'circular') {
        store.setStart(coordinate, null);
        return;
      }
      store.setDestination(coordinate, null);
    },
    [planningMode, editor.drawMode, routeType, store, dispatch],
  );

  const handleRouteClick = useCallback(
    (routeId: string, coordinate: Coordinate) => {
      if (planningMode === 'manual') {
        const segment = editor.segments.find((item) => item.id === routeId);
        if (segment) {
          dispatch({ type: 'select-segment', segmentId: segment.id });
          dispatch({ type: 'insert-shaping-point', segmentId: segment.id, coordinate });
        }
        return;
      }
      store.selectRoute(routeId);
    },
    [planningMode, editor.segments, dispatch, store],
  );

  /* ----------------------------------------------------------- GPX export */
  const exportTarget = planningMode === 'manual' ? manualResult : selectedResult;
  const canExport =
    planningMode === 'manual'
      ? manualCoordinates.length >= 2
      : Boolean(selectedResult && selectedResult.route.geometry.coordinates.length >= 2);

  const handleExport = useCallback(async () => {
    if (planningMode === 'manual') {
      await downloadGpx({
        name: 'TrailLoop manual route',
        activity: editor.activityProfile,
        place: store.startLabel ?? undefined,
        segments: editor.segments.map((segment) => ({
          mode: segment.mode,
          coordinates: segment.geometry.coordinates as Coordinate[],
        })),
        waypoints: editor.points
          .filter((point) => point.type !== 'shaping')
          .map((point, index) => ({
            coordinate: point.coordinate,
            name: point.name ?? `${point.type} ${index + 1}`,
            type:
              point.type === 'start' ? 'start' : point.type === 'destination' ? 'finish' : 'via',
          })),
      });
      return;
    }
    if (!selectedResult) return;
    const coordinates = selectedResult.route.geometry.coordinates as Coordinate[];
    await downloadGpx({
      name: `TrailLoop ${selectedResult.label ?? 'route'}`,
      activity: store.activityProfile,
      place: store.startLabel ?? undefined,
      segments: [
        {
          mode: 'routed',
          coordinates,
          elevations: selectedResult.elevation
            ? matchElevations(
                coordinates,
                selectedResult.elevation.points.map((point) => point.elevationMetres),
              )
            : undefined,
        },
      ],
      waypoints: [
        { coordinate: coordinates[0]!, name: 'Start', type: 'start' },
        { coordinate: coordinates[coordinates.length - 1]!, name: 'Finish', type: 'finish' },
      ],
    });
  }, [planningMode, selectedResult, editor, store]);

  /* ------------------------------------------------------------------ view */
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside
        className={`order-2 w-full shrink-0 overflow-y-auto border-[var(--color-line)] bg-[var(--color-canvas)] p-3 lg:order-1 lg:h-[calc(100vh-8rem)] lg:border-r ${panelOpen ? 'lg:w-[22rem]' : 'lg:w-12'}`}
        aria-label="Planning controls"
      >
        <div className="mb-2 hidden justify-end lg:flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPanelOpen((value) => !value)}
            aria-expanded={panelOpen}
          >
            {panelOpen ? (
              <PanelLeftClose aria-hidden size={16} />
            ) : (
              <PanelLeftOpen aria-hidden size={16} />
            )}
            <span className="sr-only">
              {panelOpen ? 'Collapse planning panel' : 'Expand planning panel'}
            </span>
          </Button>
        </div>
        {panelOpen ? (
          <>
            <PlanningPanel
              planningMode={planningMode}
              routeType={routeType}
              drawMode={editor.drawMode}
              onPlanningModeChange={(mode) => {
                store.set('planningMode', mode);
                updateUrl({ mode });
              }}
              onRouteTypeChange={(type) => {
                store.set('routeType', type);
                updateUrl({ type });
              }}
              onDrawModeChange={(mode: ManualDrawMode) =>
                dispatch({ type: 'set-draw-mode', drawMode: mode })
              }
              onGenerate={() => void generate()}
              isGenerating={store.isGenerating}
              disabledReason={disabledReason}
            />
            {planningMode === 'manual' ? (
              <div className="mt-3">
                <ManualToolbar
                  state={editor}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  dispatch={dispatch}
                  onUndo={undo}
                  onRedo={redo}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </aside>

      <div className="relative order-1 h-[52vh] w-full lg:order-2 lg:h-[calc(100vh-8rem)] lg:flex-1">
        <PlannerMap
          rightsOfWay={mapFeatures}
          rightsOfWayEnabled={store.rightsOfWayEnabled}
          layerVisibility={store.layerVisibility}
          routes={mapRoutes}
          freehandSegments={editor.segments.filter((segment) => segment.mode === 'freehand')}
          controlPoints={
            planningMode === 'manual'
              ? editor.points
              : [
                  ...(store.start
                    ? [
                        {
                          id: 'start',
                          type: 'start' as const,
                          coordinate: store.start,
                          sequence: 0,
                        },
                      ]
                    : []),
                  ...(store.destination && routeType !== 'circular'
                    ? [
                        {
                          id: 'destination',
                          type: 'destination' as const,
                          coordinate: store.destination,
                          sequence: 1,
                        },
                      ]
                    : []),
                ]
          }
          draggablePoints={planningMode === 'manual'}
          freehandActive={planningMode === 'manual' && editor.drawMode === 'freehand'}
          fitToRouteKey={fitKey}
          initialCentre={store.start ?? undefined}
          onMapClick={handleMapClick}
          onRouteClick={handleRouteClick}
          onFeatureClick={(osmId) => store.set('inspectedFeatureId', String(osmId))}
          onPointDragEnd={(pointId, coordinate) =>
            dispatch({ type: 'move-point', pointId, coordinate })
          }
          onFreehandStroke={(coordinates) => dispatch({ type: 'add-freehand-stroke', coordinates })}
          onViewportChange={(bbox, zoom) => setViewport({ bbox, zoom })}
        />

        <div className="pointer-events-none absolute top-2 left-2 flex flex-col gap-2">
          <RightsOfWayLegend />
          {store.rightsOfWayEnabled && viewport.zoom < RIGHTS_OF_WAY_MIN_ZOOM ? (
            <p
              className="pointer-events-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]/95 px-2 py-1 text-xs"
              role="status"
            >
              Zoom in to display rights-of-way details.
            </p>
          ) : null}
          {rightsOfWay.isFetching ? (
            <span className="pointer-events-auto rounded-md bg-[var(--color-surface)]/95 px-2 py-1">
              <Spinner label="Loading rights of way…" />
            </span>
          ) : null}
        </div>

        {inspectedFeature ? (
          <div className="pointer-events-none absolute right-2 bottom-2 left-2 sm:left-auto">
            <FeatureInspector
              feature={inspectedFeature}
              onClose={() => store.set('inspectedFeatureId', null)}
            />
          </div>
        ) : null}
      </div>

      <section
        className="order-3 w-full overflow-y-auto border-t border-[var(--color-line)] bg-[var(--color-canvas)] p-3 lg:h-[calc(100vh-8rem)] lg:w-[24rem] lg:border-t-0 lg:border-l"
        aria-label="Route results"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {planningMode === 'manual' ? 'Manual route' : 'Route options'}
          </h2>
          <Button
            variant="primary"
            size="sm"
            disabled={!canExport}
            onClick={() => void handleExport()}
            data-testid="download-gpx"
          >
            <Download aria-hidden size={14} /> Download GPX
          </Button>
        </div>

        <div aria-live="polite" className="mb-2 text-xs text-[var(--color-ink-muted)]">
          {store.isGenerating ? <Spinner label="Generating route options…" /> : null}
          {manualBusy ? <Spinner label="Analysing route…" /> : null}
          {store.generationError ? (
            <span role="alert" className="text-red-600" data-testid="generation-error">
              {store.generationError}
            </span>
          ) : null}
          {fixtureMode ? (
            <span>Demo data is active — figures come from a synthetic network.</span>
          ) : null}
        </div>

        {planningMode === 'automatic' ? (
          <div className="space-y-2" data-testid="route-cards">
            {store.results.length === 0 && !store.isGenerating ? (
              <Panel>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Set a start point, choose a distance and select <strong>Generate routes</strong>.
                  Circular planning returns three meaningfully different options.
                </p>
              </Panel>
            ) : null}
            {store.results.map((result, index) => (
              <RouteCard
                key={result.route.id}
                result={result}
                index={index}
                unit={store.distanceUnit}
                selected={result.route.id === selectedResult?.route.id}
                onSelect={() => {
                  store.selectRoute(result.route.id);
                  setFitKey(`${Date.now()}`);
                }}
              />
            ))}
          </div>
        ) : null}

        {exportTarget ? (
          <div className="mt-3 space-y-3">
            <TextRouteSummary result={exportTarget} unit={store.distanceUnit} />
            <RouteSummary result={exportTarget} unit={store.distanceUnit} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Elevation profiles are downsampled; map them back onto the full geometry. */
function matchElevations(coordinates: Coordinate[], elevations: number[]): Array<number | null> {
  if (elevations.length === 0) return coordinates.map(() => null);
  return coordinates.map((_, index) => {
    const ratio = coordinates.length <= 1 ? 0 : index / (coordinates.length - 1);
    return elevations[Math.round(ratio * (elevations.length - 1))] ?? null;
  });
}
