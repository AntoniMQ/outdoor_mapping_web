'use client';

import type { AutomaticRouteType, ManualDrawMode, PlanningMode } from '@/types/domain';
import { ACTIVITY_PROFILE_DEFINITIONS } from '@/features/routing/profiles';
import {
  usePlannerStore,
  LAYER_LABELS,
  type RightsOfWayLayerVisibility,
} from '@/stores/planner-store';
import { Button, Field, Panel, SegmentedControl, Select, Toggle } from '@/components/ui';
import { LocationSearch } from '@/components/planner/location-search';

export interface PlanningPanelProps {
  planningMode: PlanningMode;
  routeType: AutomaticRouteType;
  drawMode: ManualDrawMode;
  onPlanningModeChange: (mode: PlanningMode) => void;
  onRouteTypeChange: (type: AutomaticRouteType) => void;
  onDrawModeChange: (mode: ManualDrawMode) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  disabledReason: string | null;
}

export function PlanningPanel(props: PlanningPanelProps) {
  const store = usePlannerStore();

  return (
    <div className="space-y-3">
      <Panel title="Planning mode">
        <SegmentedControl
          name="planning-mode"
          ariaLabel="Planning mode"
          value={props.planningMode}
          onValueChange={props.onPlanningModeChange}
          options={[
            { value: 'automatic', label: 'Automatic' },
            { value: 'manual', label: 'Manual' },
          ]}
        />
        <div className="mt-2">
          {props.planningMode === 'automatic' ? (
            <SegmentedControl
              name="route-type"
              ariaLabel="Route type"
              value={props.routeType}
              onValueChange={props.onRouteTypeChange}
              options={[
                { value: 'circular', label: 'Circular' },
                { value: 'point-to-point', label: 'Point to point' },
                { value: 'out-and-back', label: 'Out and back' },
              ]}
            />
          ) : (
            <SegmentedControl
              name="draw-mode"
              ariaLabel="Drawing mode"
              value={props.drawMode}
              onValueChange={props.onDrawModeChange}
              options={[
                { value: 'snap', label: 'Snap to network' },
                { value: 'freehand', label: 'Freehand' },
              ]}
            />
          )}
        </div>
      </Panel>

      <Panel title="Activity">
        <SegmentedControl
          name="activity"
          ariaLabel="Activity profile"
          value={store.activityProfile}
          onValueChange={(value) => store.set('activityProfile', value)}
          options={Object.values(ACTIVITY_PROFILE_DEFINITIONS).map((definition) => ({
            value: definition.id,
            label: definition.label,
            description: definition.description,
          }))}
        />
        {ACTIVITY_PROFILE_DEFINITIONS[store.activityProfile].providerCaveat ? (
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            {ACTIVITY_PROFILE_DEFINITIONS[store.activityProfile].providerCaveat}
          </p>
        ) : null}
      </Panel>

      <Panel title="Start and destination">
        <LocationSearch
          onSelect={(coordinate, label) => store.setStart(coordinate, label)}
          label="Search for a start location"
        />
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]" data-testid="start-readout">
          {store.start
            ? `Start: ${store.startLabel ?? `${store.start[1].toFixed(4)}, ${store.start[0].toFixed(4)}`}`
            : 'Start: click the map or search for a place.'}
        </p>
        {props.planningMode === 'automatic' && props.routeType !== 'circular' ? (
          <p
            className="mt-1 text-xs text-[var(--color-ink-muted)]"
            data-testid="destination-readout"
          >
            {store.destination
              ? `Destination: ${store.destinationLabel ?? `${store.destination[1].toFixed(4)}, ${store.destination[0].toFixed(4)}`}`
              : 'Destination: click the map again to set it.'}
          </p>
        ) : null}
      </Panel>

      {props.planningMode === 'automatic' ? (
        <Panel title="Route shape">
          {props.routeType !== 'point-to-point' ? (
            <Field label={`Target distance (${store.distanceUnit})`} htmlFor="target-distance">
              <div className="flex gap-2">
                <input
                  id="target-distance"
                  type="number"
                  min={2}
                  max={300}
                  step={1}
                  value={store.targetDistance}
                  data-testid="target-distance"
                  onChange={(event) => store.set('targetDistance', Number(event.target.value))}
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-sm"
                />
                <Select
                  ariaLabel="Distance unit"
                  value={store.distanceUnit}
                  onValueChange={(value) => store.set('distanceUnit', value)}
                  options={[
                    { value: 'km', label: 'km' },
                    { value: 'mi', label: 'mi' },
                  ]}
                />
              </div>
            </Field>
          ) : null}

          {props.routeType === 'circular' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Loop direction" htmlFor="loop-direction">
                <Select
                  id="loop-direction"
                  value={store.loopDirection}
                  onValueChange={(value) => store.set('loopDirection', value)}
                  options={[
                    { value: 'automatic', label: 'Automatic' },
                    { value: 'clockwise', label: 'Clockwise' },
                    { value: 'anticlockwise', label: 'Anticlockwise' },
                  ]}
                />
              </Field>
              <Field label="Loop shape" htmlFor="loop-shape">
                <Select
                  id="loop-shape"
                  value={store.loopShape}
                  onValueChange={(value) => store.set('loopShape', value)}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'wide', label: 'Wide' },
                    { value: 'adventure', label: 'Adventure' },
                  ]}
                />
              </Field>
            </div>
          ) : null}

          {props.routeType === 'out-and-back' ? (
            <div className="mt-2">
              <Toggle
                id="varied-return"
                label="Vary the return leg where possible"
                checked={store.variedReturn}
                onCheckedChange={(checked) => store.set('variedReturn', checked)}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Preferences">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Climbing" htmlFor="climbing">
            <Select
              id="climbing"
              value={store.climbing}
              onValueChange={(value) => store.set('climbing', value)}
              options={[
                { value: 'no-preference', label: 'No preference' },
                { value: 'low', label: 'Low' },
                { value: 'moderate', label: 'Moderate' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Field>
          <Field label="Surface" htmlFor="surface">
            <Select
              id="surface"
              value={store.surface}
              onValueChange={(value) => store.set('surface', value)}
              options={[
                { value: 'no-preference', label: 'No preference' },
                { value: 'prefer-paved', label: 'Prefer paved' },
                { value: 'mixed', label: 'Mixed' },
                { value: 'prefer-unpaved', label: 'Prefer unpaved' },
              ]}
            />
          </Field>
          <Field label="Off-road" htmlFor="off-road">
            <Select
              id="off-road"
              value={store.offRoad}
              onValueChange={(value) => store.set('offRoad', value)}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'maximise', label: 'Maximise off-road' },
                { value: 'minimise', label: 'Minimise off-road' },
              ]}
            />
          </Field>
          <Field label="Technicality" htmlFor="technicality">
            <Select
              id="technicality"
              value={store.technicality}
              onValueChange={(value) => store.set('technicality', value)}
              options={[
                { value: 'no-preference', label: 'No preference' },
                { value: 'easy', label: 'Easy' },
                { value: 'moderate', label: 'Moderate' },
                { value: 'technical', label: 'Technical' },
              ]}
            />
          </Field>
        </div>
        <Field label="Access policy" htmlFor="access-policy" className="mt-3">
          <Select
            id="access-policy"
            value={store.accessPolicy}
            onValueChange={(value) => store.set('accessPolicy', value)}
            options={[
              { value: 'strict', label: 'Confirmed cycling access only' },
              { value: 'permit-uncertain', label: 'Permit uncertain access with warnings' },
              { value: 'show-all', label: 'Show all mapped paths (manual planning)' },
            ]}
          />
        </Field>
      </Panel>

      <Panel title="Rights-of-way overlay">
        <Toggle
          id="row-enabled"
          label="Show rights-of-way overlay"
          checked={store.rightsOfWayEnabled}
          onCheckedChange={(checked) => store.set('rightsOfWayEnabled', checked)}
        />
        <div className="mt-1 space-y-0.5">
          {(Object.keys(LAYER_LABELS) as Array<keyof RightsOfWayLayerVisibility>).map((key) => (
            <Toggle
              key={key}
              id={`layer-${key}`}
              label={LAYER_LABELS[key]}
              checked={store.layerVisibility[key]}
              onCheckedChange={() => store.toggleLayer(key)}
            />
          ))}
        </div>
      </Panel>

      {props.planningMode === 'automatic' ? (
        <div className="sticky bottom-0 bg-[var(--color-canvas)] pt-1 pb-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={props.onGenerate}
            disabled={props.isGenerating || Boolean(props.disabledReason)}
            data-testid="generate-routes"
          >
            {props.isGenerating ? 'Generating…' : 'Generate routes'}
          </Button>
          {props.disabledReason ? (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]" role="note">
              {props.disabledReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
