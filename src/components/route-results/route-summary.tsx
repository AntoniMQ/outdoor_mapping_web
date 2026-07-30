'use client';

import type { AnalysedRoute, DistanceUnit } from '@/types/domain';
import { formatDistance, formatDuration, formatElevation, formatPercent } from '@/lib/format';
import { Panel, StatGrid } from '@/components/ui';
import { WarningList } from '@/components/route-results/warning-list';
import { ElevationChart } from '@/components/elevation/elevation-chart';

export function RouteSummary({
  result,
  unit = 'km',
}: {
  result: AnalysedRoute;
  unit?: DistanceUnit;
}) {
  const { analysis, elevation } = result;

  return (
    <div className="space-y-3" data-testid="route-summary">
      <Panel title="Route summary">
        <StatGrid
          items={[
            { label: 'Distance', value: formatDistance(analysis.distanceMetres, unit) },
            {
              label: 'Ascent',
              value: formatElevation(analysis.hasElevationData ? analysis.ascentMetres : undefined),
            },
            {
              label: 'Descent',
              value: formatElevation(
                analysis.hasElevationData ? analysis.descentMetres : undefined,
              ),
            },
            { label: 'Estimated time', value: formatDuration(analysis.durationSeconds) },
            { label: 'Off-road', value: formatPercent(analysis.surface.offRoadPercent) },
            { label: 'Repeated', value: formatPercent(analysis.repeatedPercent) },
          ]}
        />
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Percentages are weighted by distance. Estimated time assumes steady progress and no stops.
          {analysis.hasElevationData
            ? ''
            : ' The elevation provider did not respond, so ascent and descent are unknown rather than zero.'}
        </p>
      </Panel>

      <Panel title="Surface and designation">
        <StatGrid
          items={[
            { label: 'Paved', value: formatPercent(analysis.surface.pavedPercent) },
            { label: 'Unpaved', value: formatPercent(analysis.surface.unpavedPercent) },
            { label: 'Surface unknown', value: formatPercent(analysis.surface.unknownPercent) },
            {
              label: 'Public bridleway',
              value: formatPercent(analysis.designation.publicBridlewayPercent),
            },
            {
              label: 'Public footpath',
              value: formatPercent(analysis.designation.publicFootpathPercent),
            },
            {
              label: 'Restricted byway',
              value: formatPercent(analysis.designation.restrictedBywayPercent),
            },
            {
              label: 'BOAT',
              value: formatPercent(analysis.designation.bywayOpenToAllTrafficPercent),
            },
            { label: 'Permissive', value: formatPercent(analysis.designation.permissivePercent) },
            { label: 'Road', value: formatPercent(analysis.designation.roadPercent) },
          ]}
        />
      </Panel>

      <Panel title="Access confidence">
        <StatGrid
          items={[
            { label: 'Confirmed', value: formatPercent(analysis.access.confirmedPercent) },
            { label: 'Permissive', value: formatPercent(analysis.access.permissivePercent) },
            { label: 'Uncertain', value: formatPercent(analysis.access.uncertainPercent) },
            { label: 'Not confirmed', value: formatPercent(analysis.access.notConfirmedPercent) },
            {
              label: 'Access data coverage',
              value: formatPercent(analysis.coverage.accessDataPercent),
            },
            {
              label: 'Surface data coverage',
              value: formatPercent(analysis.coverage.surfaceDataPercent),
            },
          ]}
        />
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Jurisdiction: {analysis.jurisdiction.replace('-', ' and ')}.{' '}
          {analysis.jurisdiction === 'england-wales'
            ? 'England-and-Wales rights-of-way rules were applied.'
            : 'England-and-Wales legal assumptions were NOT applied here; only explicit mapped restrictions are shown.'}
        </p>
      </Panel>

      {elevation ? (
        <Panel title="Elevation profile">
          <ElevationChart profile={elevation} />
        </Panel>
      ) : null}

      <Panel title="Warnings">
        <WarningList warnings={analysis.warnings} />
      </Panel>
    </div>
  );
}

/** Non-map textual summary, always available to assistive technology. */
export function TextRouteSummary({
  result,
  unit = 'km',
}: {
  result: AnalysedRoute;
  unit?: DistanceUnit;
}) {
  const { analysis } = result;
  return (
    <p className="text-xs text-[var(--color-ink-muted)]" data-testid="text-route-summary">
      {result.label ? `${result.label}: ` : ''}
      {formatDistance(analysis.distanceMetres, unit)} route with{' '}
      {formatElevation(analysis.ascentMetres)} of ascent,{' '}
      {formatPercent(analysis.surface.offRoadPercent)} off-road,{' '}
      {formatPercent(analysis.access.confirmedPercent)} of the distance with confirmed access and{' '}
      {formatPercent(analysis.access.uncertainPercent)} uncertain. {analysis.warnings.length}{' '}
      warning{analysis.warnings.length === 1 ? '' : 's'}.
    </p>
  );
}
