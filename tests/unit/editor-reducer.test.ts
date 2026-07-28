import { beforeEach, describe, expect, it } from 'vitest';
import type { Coordinate } from '@/types/domain';
import {
  combinedGeometry,
  createInitialHistory,
  createInitialState,
  editorReducer,
  historyReducer,
  resetIdCounter,
  totalDistanceMetres,
  type EditorState,
} from '@/features/manual-routing/reducer';

const A: Coordinate = [-0.52, 51.65];
const B: Coordinate = [-0.51, 51.655];
const C: Coordinate = [-0.5, 51.66];

function withPoints(...coordinates: Coordinate[]): EditorState {
  return coordinates.reduce(
    (state, coordinate) => editorReducer(state, { type: 'add-point', coordinate }),
    createInitialState('mtb'),
  );
}

beforeEach(() => resetIdCounter());

describe('point management', () => {
  it('adds a start point first and vias afterwards', () => {
    const state = withPoints(A, B);
    expect(state.points[0]!.type).toBe('start');
    expect(state.points[1]!.type).toBe('destination');
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]!.status).toBe('pending');
  });

  it('only invalidates the segments adjacent to a moved point', () => {
    let state = withPoints(A, B, C);
    state = {
      ...state,
      segments: state.segments.map((segment) => ({ ...segment, status: 'idle' })),
    };
    const moved = editorReducer(state, {
      type: 'move-point',
      pointId: state.points[0]!.id,
      coordinate: [-0.53, 51.64],
    });
    expect(moved.segments[0]!.status).toBe('pending');
    expect(moved.segments[1]!.status).toBe('idle');
    expect(moved.segments[1]).toBe(state.segments[1]);
  });

  it('inserts a shaping point into the clicked segment', () => {
    const state = withPoints(A, C);
    const next = editorReducer(state, {
      type: 'insert-shaping-point',
      segmentId: state.segments[0]!.id,
      coordinate: B,
    });
    expect(next.points).toHaveLength(3);
    expect(next.points[1]!.type).toBe('shaping');
    expect(next.segments).toHaveLength(2);
  });

  it('deletes a point and rebuilds the adjacent segment', () => {
    const state = withPoints(A, B, C);
    const next = editorReducer(state, { type: 'delete-point', pointId: state.points[1]!.id });
    expect(next.points).toHaveLength(2);
    expect(next.segments).toHaveLength(1);
  });

  it('reorders via points', () => {
    const state = withPoints(A, B, C);
    const next = editorReducer(state, { type: 'reorder-via', fromIndex: 2, toIndex: 1 });
    expect(next.points[1]!.coordinate).toEqual(C);
  });

  it('reverses the route', () => {
    const state = withPoints(A, B, C);
    const next = editorReducer(state, { type: 'reverse' });
    expect(next.points[0]!.coordinate).toEqual(C);
    expect(next.points[0]!.type).toBe('start');
  });

  it('closes and reopens a loop', () => {
    const state = withPoints(A, B, C);
    const closed = editorReducer(state, { type: 'close-loop' });
    expect(closed.closed).toBe(true);
    expect(closed.segments).toHaveLength(3);
    const reopened = editorReducer(closed, { type: 'open-loop' });
    expect(reopened.closed).toBe(false);
    expect(reopened.segments).toHaveLength(2);
  });

  it('refuses to close a loop with fewer than three points', () => {
    const state = withPoints(A, B);
    expect(editorReducer(state, { type: 'close-loop' }).closed).toBe(false);
  });

  it('clears everything', () => {
    const state = editorReducer(withPoints(A, B), { type: 'clear' });
    expect(state.points).toHaveLength(0);
    expect(state.segments).toHaveLength(0);
  });
});

describe('routing responses', () => {
  it('applies a matching response', () => {
    const state = withPoints(A, B);
    const segment = state.segments[0]!;
    const next = editorReducer(state, {
      type: 'segment-routed',
      segmentId: segment.id,
      version: segment.version,
      coordinates: [A, [-0.515, 51.652], B],
      distanceMetres: 1_234,
    });
    expect(next.segments[0]!.status).toBe('idle');
    expect(next.segments[0]!.distanceMetres).toBe(1_234);
  });

  it('discards a stale response from a superseded request', () => {
    const state = withPoints(A, B);
    const segment = state.segments[0]!;
    const next = editorReducer(state, {
      type: 'segment-routed',
      segmentId: segment.id,
      version: segment.version - 1,
      coordinates: [A, B],
      distanceMetres: 99,
    });
    expect(next.segments[0]!.distanceMetres).not.toBe(99);
  });

  it('records routing errors without discarding the route', () => {
    const state = withPoints(A, B);
    const segment = state.segments[0]!;
    const next = editorReducer(state, {
      type: 'segment-error',
      segmentId: segment.id,
      version: segment.version,
      message: 'No route found',
    });
    expect(next.segments[0]!.status).toBe('error');
    expect(next.points).toHaveLength(2);
  });
});

describe('freehand and hybrid routes', () => {
  it('adds a simplified freehand segment', () => {
    const stroke: Coordinate[] = Array.from({ length: 40 }, (_, i) => [-0.52 + i * 0.0002, 51.65]);
    const state = editorReducer(createInitialState('mtb'), {
      type: 'add-freehand-stroke',
      coordinates: stroke,
    });
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]!.mode).toBe('freehand');
    expect(state.segments[0]!.geometry.coordinates.length).toBeLessThan(stroke.length);
    expect(state.segments[0]!.distanceMetres).toBeGreaterThan(0);
  });

  it('supports routed and freehand sections in one route', () => {
    let state = withPoints(A, B);
    state = editorReducer(state, {
      type: 'add-freehand-stroke',
      coordinates: [B, [-0.505, 51.657], C],
    });
    state = editorReducer(state, { type: 'add-point', coordinate: [-0.495, 51.663] });
    expect(state.segments.map((segment) => segment.mode)).toEqual(['routed', 'freehand', 'routed']);
    expect(combinedGeometry(state).length).toBeGreaterThan(3);
    expect(totalDistanceMetres(state)).toBeGreaterThan(0);
  });

  it('switches a section between routed and freehand', () => {
    const state = withPoints(A, B);
    const toFreehand = editorReducer(state, {
      type: 'set-segment-mode',
      segmentId: state.segments[0]!.id,
      mode: 'freehand',
    });
    expect(toFreehand.segments[0]!.mode).toBe('freehand');
    const backToRouted = editorReducer(toFreehand, {
      type: 'set-segment-mode',
      segmentId: state.segments[0]!.id,
      mode: 'routed',
    });
    expect(backToRouted.segments[0]!.mode).toBe('routed');
    expect(backToRouted.segments[0]!.status).toBe('pending');
  });
});

describe('undo and redo', () => {
  it('undoes and redoes structural edits', () => {
    let history = createInitialHistory('mtb');
    history = historyReducer(history, { type: 'add-point', coordinate: A });
    history = historyReducer(history, { type: 'add-point', coordinate: B });
    expect(history.present.points).toHaveLength(2);

    history = historyReducer(history, { type: 'undo' });
    expect(history.present.points).toHaveLength(1);

    history = historyReducer(history, { type: 'redo' });
    expect(history.present.points).toHaveLength(2);
  });

  it('treats a completed freehand stroke as a single undoable action', () => {
    let history = createInitialHistory('mtb');
    history = historyReducer(history, {
      type: 'add-freehand-stroke',
      coordinates: [A, [-0.515, 51.652], B],
    });
    expect(history.present.segments).toHaveLength(1);
    history = historyReducer(history, { type: 'undo' });
    expect(history.present.segments).toHaveLength(0);
  });

  it('does not create history entries for routing responses', () => {
    let history = createInitialHistory('mtb');
    history = historyReducer(history, { type: 'add-point', coordinate: A });
    history = historyReducer(history, { type: 'add-point', coordinate: B });
    const depth = history.past.length;
    const segment = history.present.segments[0]!;
    history = historyReducer(history, {
      type: 'segment-routed',
      segmentId: segment.id,
      version: segment.version,
      coordinates: [A, B],
      distanceMetres: 500,
    });
    expect(history.past.length).toBe(depth);
  });

  it('clears the redo stack after a new edit', () => {
    let history = createInitialHistory('mtb');
    history = historyReducer(history, { type: 'add-point', coordinate: A });
    history = historyReducer(history, { type: 'add-point', coordinate: B });
    history = historyReducer(history, { type: 'undo' });
    expect(history.future).toHaveLength(1);
    history = historyReducer(history, { type: 'add-point', coordinate: C });
    expect(history.future).toHaveLength(0);
  });

  it('is a no-op when there is nothing to undo', () => {
    const history = createInitialHistory('mtb');
    expect(historyReducer(history, { type: 'undo' })).toBe(history);
  });
});
