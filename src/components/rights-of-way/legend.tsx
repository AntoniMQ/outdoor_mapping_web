'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { LEGEND_ORDER, RIGHTS_OF_WAY_STYLES } from '@/features/rights-of-way/styles';
import { Button } from '@/components/ui';

export function RightsOfWayLegend() {
  const [open, setOpen] = useState(true);
  return (
    <div className="pointer-events-auto max-w-[15rem] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/95 p-2 text-xs shadow-md backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Rights of way</h2>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="legend-body"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp aria-hidden size={14} /> : <ChevronDown aria-hidden size={14} />}
          <span className="sr-only">{open ? 'Collapse legend' : 'Expand legend'}</span>
        </Button>
      </div>
      {open ? (
        <ul id="legend-body" className="mt-2 space-y-1.5">
          {LEGEND_ORDER.map((category) => {
            const style = RIGHTS_OF_WAY_STYLES[category];
            return (
              <li key={category} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0 w-8 shrink-0 border-t-[3px]"
                  style={{
                    borderColor: style.color,
                    borderStyle: style.dashArray.length ? 'dashed' : 'solid',
                  }}
                />
                <span className="text-[var(--color-ink)]">{style.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
