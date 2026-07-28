'use client';

import {
  ArrowDown,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Repeat,
  RotateCcw,
  Spline,
  Trash2,
  Waypoints,
} from 'lucide-react';
import type { EditorState, EditorAction } from '@/features/manual-routing/reducer';
import { formatDistance } from '@/lib/format';
import { Button, Panel } from '@/components/ui';

export function ManualToolbar({
  state,
  canUndo,
  canRedo,
  dispatch,
  onUndo,
  onRedo,
}: {
  state: EditorState;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (action: EditorAction) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const selected = state.segments.find((segment) => segment.id === state.selectedSegmentId) ?? null;
  const viaPoints = state.points;

  return (
    <div className="space-y-3">
      <Panel title="Route editing">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={onUndo} disabled={!canUndo} data-testid="undo">
            <CornerUpLeft aria-hidden size={14} /> Undo
          </Button>
          <Button size="sm" onClick={onRedo} disabled={!canRedo} data-testid="redo">
            <CornerUpRight aria-hidden size={14} /> Redo
          </Button>
          <Button
            size="sm"
            onClick={() => dispatch({ type: 'reverse' })}
            disabled={state.points.length < 2}
            data-testid="reverse-route"
          >
            <Repeat aria-hidden size={14} /> Reverse
          </Button>
          {state.closed ? (
            <Button
              size="sm"
              onClick={() => dispatch({ type: 'open-loop' })}
              data-testid="open-loop"
            >
              <Spline aria-hidden size={14} /> Reopen route
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => dispatch({ type: 'close-loop' })}
              disabled={state.points.length < 3}
              data-testid="close-loop"
            >
              <RotateCcw aria-hidden size={14} /> Close loop
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            onClick={() => dispatch({ type: 'clear' })}
            data-testid="clear-route"
          >
            <Trash2 aria-hidden size={14} /> Clear
          </Button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Click the map to add points. Drag a point to move it — only the adjacent sections are
          recalculated. Click the route line to insert a shaping point.
        </p>
      </Panel>

      {selected ? (
        <Panel title="Selected section">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>
              {selected.mode === 'freehand' ? 'Hand-drawn section' : 'Routed section'} ·{' '}
              {formatDistance(selected.distanceMetres)}
            </span>
            <Button
              size="sm"
              data-testid="toggle-segment-mode"
              onClick={() =>
                dispatch({
                  type: 'set-segment-mode',
                  segmentId: selected.id,
                  mode: selected.mode === 'freehand' ? 'routed' : 'freehand',
                })
              }
            >
              Switch to {selected.mode === 'freehand' ? 'routed' : 'freehand'}
            </Button>
          </div>
          {selected.mode === 'freehand' ? (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
              This section was drawn by hand. It is not matched to the mapped network, so its access
              and legal status are unverified.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title={`Points (${viaPoints.length})`}>
        {viaPoints.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">No points yet.</p>
        ) : (
          <ol className="space-y-1" data-testid="point-list">
            {viaPoints.map((point, index) => (
              <li
                key={point.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <Waypoints aria-hidden size={12} />
                  <span className="font-medium capitalize">{point.type}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    {point.coordinate[1].toFixed(4)}, {point.coordinate[0].toFixed(4)}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move point ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() =>
                      dispatch({ type: 'reorder-via', fromIndex: index, toIndex: index - 1 })
                    }
                  >
                    <ArrowUp aria-hidden size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move point ${index + 1} later`}
                    disabled={index === viaPoints.length - 1}
                    onClick={() =>
                      dispatch({ type: 'reorder-via', fromIndex: index, toIndex: index + 1 })
                    }
                  >
                    <ArrowDown aria-hidden size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete point ${index + 1}`}
                    data-testid={`delete-point-${index}`}
                    onClick={() => dispatch({ type: 'delete-point', pointId: point.id })}
                  >
                    <Trash2 aria-hidden size={12} />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {state.segments.some((segment) => segment.status === 'error') ? (
          <p className="mt-2 text-xs text-red-600" role="alert">
            One or more sections could not be routed. Your existing route has been kept — try moving
            the point or switching that section to freehand.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
