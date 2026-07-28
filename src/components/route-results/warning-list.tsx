'use client';

import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { RouteWarning } from '@/types/domain';
import { formatDistance } from '@/lib/format';

export function WarningList({
  warnings,
  onSelect,
}: {
  warnings: RouteWarning[];
  onSelect?: (warning: RouteWarning) => void;
}) {
  if (warnings.length === 0) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">
        No access or surface warnings were raised.
      </p>
    );
  }
  const order = { critical: 0, caution: 1, info: 2 } as const;
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <ul className="space-y-1.5" aria-label="Route warnings" data-testid="warning-list">
      {sorted.map((warning) => {
        const Icon =
          warning.severity === 'critical'
            ? ShieldAlert
            : warning.severity === 'caution'
              ? AlertTriangle
              : Info;
        return (
          <li key={`${warning.code}-${warning.affectedDistanceMetres}`}>
            <button
              type="button"
              onClick={() => onSelect?.(warning)}
              className="flex w-full items-start gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-left text-xs hover:bg-[var(--color-surface-muted)]"
              data-warning-code={warning.code}
            >
              <Icon
                aria-hidden
                size={14}
                className={
                  warning.severity === 'critical'
                    ? 'mt-0.5 shrink-0 text-red-600'
                    : warning.severity === 'caution'
                      ? 'mt-0.5 shrink-0 text-amber-600'
                      : 'mt-0.5 shrink-0 text-sky-600'
                }
              />
              <span>
                <span className="font-medium">{warning.message}</span>
                {warning.affectedDistanceMetres > 0 ? (
                  <span className="block text-[var(--color-ink-muted)]">
                    Affects {formatDistance(warning.affectedDistanceMetres)}
                    {warning.segmentIndexes.length
                      ? ` across ${warning.segmentIndexes.length} sections`
                      : ''}
                    .
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
