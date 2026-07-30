'use client';

import type { AnalysedRoute, DistanceUnit } from '@/types/domain';
import { formatDistance, formatDuration, formatElevation, formatPercent } from '@/lib/format';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export function RouteCard({
  result,
  selected,
  onSelect,
  unit = 'km',
  index,
  analysing = false,
}: {
  result: AnalysedRoute;
  selected: boolean;
  onSelect: () => void;
  unit?: DistanceUnit;
  index: number;
  analysing?: boolean;
}) {
  const { analysis } = result;
  const unknown = analysing ? '…' : '—';
  const pct = (value: number) => (analysis.analysed ? formatPercent(value) : unknown);
  const critical = analysis.warnings.filter((warning) => warning.severity === 'critical');
  const caution = analysis.warnings.filter((warning) => warning.severity === 'caution');

  return (
    <article
      data-testid={`route-card-${index}`}
      className={cn(
        'rounded-lg border p-3 transition-colors',
        selected
          ? 'border-[var(--color-moss)] bg-[var(--color-surface)] shadow-sm'
          : 'border-[var(--color-line)] bg-[var(--color-surface)]/70',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{result.label ?? `Option ${index + 1}`}</h3>
        <Button
          size="sm"
          variant={selected ? 'primary' : 'secondary'}
          onClick={onSelect}
          aria-pressed={selected}
          data-testid={`select-route-${index}`}
        >
          {selected ? 'Selected' : 'Select'}
        </Button>
      </header>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-[var(--color-ink-muted)]">Distance</dt>
          <dd className="font-semibold" data-testid={`route-distance-${index}`}>
            {formatDistance(analysis.distanceMetres, unit)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-ink-muted)]">Ascent</dt>
          <dd className="font-semibold">
            {formatElevation(analysis.hasElevationData ? analysis.ascentMetres : undefined)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-ink-muted)]">Time</dt>
          <dd className="font-semibold">{formatDuration(analysis.durationSeconds)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-ink-muted)]">Off-road</dt>
          <dd className="font-semibold">{pct(analysis.surface.offRoadPercent)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-ink-muted)]">Confirmed access</dt>
          <dd className="font-semibold">{pct(analysis.access.confirmedPercent)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-ink-muted)]">Uncertain</dt>
          <dd className="font-semibold">{pct(analysis.access.uncertainPercent)}</dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {analysis.analysed ? (
          <Badge tone="neutral">
            Surface data {formatPercent(analysis.coverage.surfaceDataPercent)}
          </Badge>
        ) : (
          <Badge tone={analysing ? 'info' : 'caution'}>
            {analysing ? 'Analysing…' : 'Not analysed'}
          </Badge>
        )}
        {critical.length > 0 ? (
          <Badge tone="critical">{critical.length} critical warning(s)</Badge>
        ) : null}
        {caution.length > 0 ? <Badge tone="caution">{caution.length} caution(s)</Badge> : null}
      </div>

      {result.rationale?.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-[var(--color-ink-muted)]">
            Why this option was selected
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {result.rationale.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            Ranked as the best match for your stated preferences — not an objectively best route.
          </p>
        </details>
      ) : null}
    </article>
  );
}
