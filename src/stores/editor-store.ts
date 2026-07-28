'use client';

import { create } from 'zustand';
import type { ActivityProfile, Coordinate, RouteSegment } from '@/types/domain';
import {
  combinedGeometry,
  createInitialHistory,
  historyReducer,
  totalDistanceMetres,
  type EditorAction,
  type EditorHistoryState,
  type EditorState,
} from '@/features/manual-routing/reducer';

interface EditorStore {
  history: EditorHistoryState;
  dispatch: (action: EditorAction | { type: 'undo' } | { type: 'redo' }) => void;
  undo: () => void;
  redo: () => void;
  reset: (activityProfile?: ActivityProfile) => void;
}

/**
 * The editor store holds only serialisable route state. MapLibre objects are
 * deliberately kept out of it.
 */
export const useEditorStore = create<EditorStore>((set) => ({
  history: createInitialHistory('mtb'),
  dispatch: (action) => set((state) => ({ history: historyReducer(state.history, action) })),
  undo: () => set((state) => ({ history: historyReducer(state.history, { type: 'undo' }) })),
  redo: () => set((state) => ({ history: historyReducer(state.history, { type: 'redo' }) })),
  reset: (activityProfile = 'mtb') => set({ history: createInitialHistory(activityProfile) }),
}));

export const useEditorState = (): EditorState => useEditorStore((store) => store.history.present);
export const useCanUndo = (): boolean => useEditorStore((store) => store.history.past.length > 0);
export const useCanRedo = (): boolean => useEditorStore((store) => store.history.future.length > 0);

export function selectPendingSegments(state: EditorState): RouteSegment[] {
  return state.segments.filter(
    (segment) => segment.mode === 'routed' && segment.status === 'pending',
  );
}

export function selectRouteCoordinates(state: EditorState): Coordinate[] {
  return combinedGeometry(state);
}

export function selectTotalDistance(state: EditorState): number {
  return totalDistanceMetres(state);
}
