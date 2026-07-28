'use client';

import { X } from 'lucide-react';
import type { RightsOfWayFeature } from '@/types/domain';
import { humaniseDesignation } from '@/features/rights-of-way/access-policy';
import { RIGHTS_OF_WAY_STYLES } from '@/features/rights-of-way/styles';
import { Badge, Button } from '@/components/ui';

const NOT_MAPPED = 'Not mapped';

function statusTone(status: string): 'positive' | 'caution' | 'critical' | 'info' | 'neutral' {
  switch (status) {
    case 'confirmed':
      return 'positive';
    case 'permissive':
      return 'info';
    case 'uncertain':
      return 'caution';
    case 'not-confirmed':
    case 'prohibited':
      return 'critical';
    default:
      return 'neutral';
  }
}

export function FeatureInspector({
  feature,
  onClose,
}: {
  feature: RightsOfWayFeature;
  onClose: () => void;
}) {
  const { tags, classification, osmId, source, sourceUpdatedAt } = feature.properties;
  const style = RIGHTS_OF_WAY_STYLES[classification.category];

  const rows: Array<[string, string]> = [
    ['Physical path type', tags.highway ?? NOT_MAPPED],
    ['Legal designation', humaniseDesignation(classification.designation)],
    ['Walking access', classification.walking.status],
    ['Cycling access', classification.cycling.cyclingStatus],
    ['Horse access', classification.horse.status],
    ['Motor-vehicle access', classification.motorVehicle.status],
    ['Surface', tags.surface ?? NOT_MAPPED],
    ['Track grade', tags.tracktype ?? NOT_MAPPED],
    ['Smoothness', tags.smoothness ?? NOT_MAPPED],
    ['MTB scale', tags['mtb:scale'] ?? NOT_MAPPED],
    ['Trail visibility', tags.trail_visibility ?? NOT_MAPPED],
    ['Width', tags.width ?? NOT_MAPPED],
    ['Incline', tags.incline ?? NOT_MAPPED],
    ['Name', tags.name ?? NOT_MAPPED],
    ['PRoW reference', tags.prow_ref ?? tags.ref ?? NOT_MAPPED],
    ['OSM object', `way/${osmId}`],
    ['Data source', source],
    ['Data timestamp', sourceUpdatedAt ?? NOT_MAPPED],
  ];

  return (
    <aside
      data-testid="feature-inspector"
      aria-label="Path details"
      className="pointer-events-auto max-h-[70vh] w-full overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-lg sm:max-w-sm"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: style.color }}
          />
          <h2 className="text-sm font-semibold">{style.label}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close path details">
          <X aria-hidden size={16} />
        </Button>
      </header>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge tone={statusTone(classification.cycling.cyclingStatus)}>
          Cycling: {classification.cycling.cyclingStatus}
        </Badge>
        <Badge tone="neutral">Confidence: {classification.cycling.confidence}</Badge>
        {classification.isPermissive ? <Badge tone="info">Permissive</Badge> : null}
      </div>

      <h3 className="mt-3 text-xs font-semibold tracking-wide uppercase">
        Why this classification
      </h3>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-[var(--color-ink-muted)]">
        {classification.cycling.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <h3 className="mt-3 text-xs font-semibold tracking-wide uppercase">Mapped attributes</h3>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[var(--color-ink-muted)]">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-ink-muted)]">
        OpenStreetMap access information is not legally authoritative. The local authority
        Definitive Map and on-site signage take precedence. Verify locally where access is
        uncertain.
      </p>
    </aside>
  );
}
