import type {
  ActivityProfile,
  Coordinate,
  ManualDrawMode,
  RouteControlPoint,
  RouteControlPointType,
  RouteSegment,
} from '@/types/domain';
import { lineLengthMetres, simplify } from '@/lib/geo/geometry';

export interface EditorState {
  points: RouteControlPoint[];
  segments: RouteSegment[];
  closed: boolean;
  activityProfile: ActivityProfile;
  drawMode: ManualDrawMode;
  selectedSegmentId: string | null;
}

export interface EditorHistoryState {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

export const HISTORY_LIMIT = 60;

export type EditorAction =
  | { type: 'add-point'; coordinate: Coordinate; pointType?: RouteControlPointType; name?: string }
  | { type: 'move-point'; pointId: string; coordinate: Coordinate }
  | { type: 'delete-point'; pointId: string }
  | { type: 'insert-shaping-point'; segmentId: string; coordinate: Coordinate }
  | { type: 'reorder-via'; fromIndex: number; toIndex: number }
  | { type: 'reverse' }
  | { type: 'clear' }
  | { type: 'close-loop' }
  | { type: 'open-loop' }
  | { type: 'set-activity'; activityProfile: ActivityProfile }
  | { type: 'set-draw-mode'; drawMode: ManualDrawMode }
  | { type: 'select-segment'; segmentId: string | null }
  | { type: 'set-segment-mode'; segmentId: string; mode: RouteSegment['mode'] }
  | { type: 'add-freehand-stroke'; coordinates: Coordinate[] }
  | {
      type: 'segment-routed';
      segmentId: string;
      version: number;
      coordinates: Coordinate[];
      distanceMetres: number;
      ascentMetres?: number;
      descentMetres?: number;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: 'segment-error'; segmentId: string; version: number; message: string }
  | { type: 'replace-state'; state: EditorState };

/** Actions that do not create an undo entry (async results and pure selection). */
const NON_HISTORY_ACTIONS = new Set<EditorAction['type']>([
  'segment-routed',
  'segment-error',
  'select-segment',
]);

let idCounter = 0;
export function createId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createInitialState(activityProfile: ActivityProfile = 'mtb'): EditorState {
  return {
    points: [],
    segments: [],
    closed: false,
    activityProfile,
    drawMode: 'snap',
    selectedSegmentId: null,
  };
}

export function createInitialHistory(activityProfile: ActivityProfile = 'mtb'): EditorHistoryState {
  return { past: [], present: createInitialState(activityProfile), future: [] };
}

function segmentKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

/**
 * Rebuilds the segment list from the current points, preserving geometry for
 * pairs that are unchanged so unaffected sections survive an edit.
 */
export function rebuildSegments(
  state: EditorState,
  invalidatedPointIds: string[] = [],
): RouteSegment[] {
  const previous = new Map(
    state.segments.map((segment) => [segmentKey(segment.fromPointId, segment.toPointId), segment]),
  );
  const invalidated = new Set(invalidatedPointIds);
  const pairs: Array<[RouteControlPoint, RouteControlPoint]> = [];

  for (let i = 1; i < state.points.length; i += 1) {
    pairs.push([state.points[i - 1]!, state.points[i]!]);
  }
  if (state.closed && state.points.length > 2) {
    pairs.push([state.points[state.points.length - 1]!, state.points[0]!]);
  }

  return pairs.map(([from, to]) => {
    const existing = previous.get(segmentKey(from.id, to.id));
    const dirty = invalidated.has(from.id) || invalidated.has(to.id);
    if (existing && !dirty) return existing;
    if (existing && dirty) {
      return existing.mode === 'freehand'
        ? existing
        : {
            ...existing,
            status: 'pending',
            version: existing.version + 1,
            errorMessage: undefined,
            geometry: { type: 'LineString', coordinates: [from.coordinate, to.coordinate] },
            distanceMetres: lineLengthMetres([from.coordinate, to.coordinate]),
          };
    }
    return {
      id: createId('seg'),
      fromPointId: from.id,
      toPointId: to.id,
      mode: 'routed',
      activityProfile: state.activityProfile,
      geometry: { type: 'LineString', coordinates: [from.coordinate, to.coordinate] },
      distanceMetres: lineLengthMetres([from.coordinate, to.coordinate]),
      status: 'pending',
      version: 1,
    };
  });
}

function resequence(points: RouteControlPoint[], closed: boolean): RouteControlPoint[] {
  return points.map((point, index) => ({
    ...point,
    sequence: index,
    type:
      point.type === 'freehand'
        ? 'freehand'
        : index === 0
          ? 'start'
          : !closed && index === points.length - 1 && points.length > 1
            ? 'destination'
            : point.type === 'shaping'
              ? 'shaping'
              : 'via',
  }));
}

/** Pure editor reducer. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-point': {
      const point: RouteControlPoint = {
        id: createId('pt'),
        type: action.pointType ?? (state.points.length === 0 ? 'start' : 'via'),
        coordinate: action.coordinate,
        sequence: state.points.length,
        name: action.name,
      };
      const next: EditorState = {
        ...state,
        points: resequence([...state.points, point], state.closed),
        closed: state.closed,
      };
      return { ...next, segments: rebuildSegments(next) };
    }

    case 'move-point': {
      const points = state.points.map((point) =>
        point.id === action.pointId ? { ...point, coordinate: action.coordinate } : point,
      );
      const next = { ...state, points };
      return { ...next, segments: rebuildSegments(next, [action.pointId]) };
    }

    case 'delete-point': {
      const points = resequence(
        state.points.filter((point) => point.id !== action.pointId),
        state.closed,
      );
      const neighbours = neighbourIds(state.points, action.pointId);
      const next: EditorState = {
        ...state,
        points,
        closed: points.length > 2 ? state.closed : false,
        segments: state.segments.filter(
          (segment) =>
            segment.fromPointId !== action.pointId && segment.toPointId !== action.pointId,
        ),
      };
      return { ...next, segments: rebuildSegments(next, neighbours) };
    }

    case 'insert-shaping-point': {
      const segment = state.segments.find((item) => item.id === action.segmentId);
      if (!segment) return state;
      const insertAt = state.points.findIndex((point) => point.id === segment.toPointId);
      const point: RouteControlPoint = {
        id: createId('pt'),
        type: 'shaping',
        coordinate: action.coordinate,
        sequence: insertAt,
      };
      const points = [...state.points];
      points.splice(insertAt === -1 ? points.length : insertAt, 0, point);
      const next: EditorState = {
        ...state,
        points: resequence(points, state.closed),
        segments: state.segments.filter((item) => item.id !== action.segmentId),
      };
      return { ...next, segments: rebuildSegments(next, [segment.fromPointId, segment.toPointId]) };
    }

    case 'reorder-via': {
      const points = [...state.points];
      const [moved] = points.splice(action.fromIndex, 1);
      if (!moved) return state;
      points.splice(action.toIndex, 0, moved);
      const next = { ...state, points: resequence(points, state.closed) };
      return {
        ...next,
        segments: rebuildSegments(
          next,
          points.map((point) => point.id),
        ),
      };
    }

    case 'reverse': {
      const points = resequence([...state.points].reverse(), state.closed);
      const next = { ...state, points, segments: [] };
      return { ...next, segments: rebuildSegments(next) };
    }

    case 'clear':
      return createInitialState(state.activityProfile);

    case 'close-loop': {
      if (state.points.length < 3 || state.closed) return state;
      const next = { ...state, closed: true, points: resequence(state.points, true) };
      return { ...next, segments: rebuildSegments(next) };
    }

    case 'open-loop': {
      if (!state.closed) return state;
      const first = state.points[0];
      const last = state.points[state.points.length - 1];
      const next: EditorState = {
        ...state,
        closed: false,
        points: resequence(state.points, false),
        segments: state.segments.filter(
          (segment) =>
            !(first && last && segment.fromPointId === last.id && segment.toPointId === first.id),
        ),
      };
      return { ...next, segments: rebuildSegments(next) };
    }

    case 'set-activity': {
      const next: EditorState = {
        ...state,
        activityProfile: action.activityProfile,
        segments: state.segments.map((segment) =>
          segment.mode === 'freehand'
            ? { ...segment, activityProfile: action.activityProfile }
            : {
                ...segment,
                activityProfile: action.activityProfile,
                status: 'pending',
                version: segment.version + 1,
              },
        ),
      };
      return next;
    }

    case 'set-draw-mode':
      return { ...state, drawMode: action.drawMode };

    case 'select-segment':
      return { ...state, selectedSegmentId: action.segmentId };

    case 'set-segment-mode': {
      return {
        ...state,
        segments: state.segments.map((segment) => {
          if (segment.id !== action.segmentId || segment.mode === action.mode) return segment;
          if (action.mode === 'freehand') {
            return { ...segment, mode: 'freehand', status: 'idle', version: segment.version + 1 };
          }
          const from = state.points.find((point) => point.id === segment.fromPointId);
          const to = state.points.find((point) => point.id === segment.toPointId);
          const coordinates: Coordinate[] = from && to ? [from.coordinate, to.coordinate] : [];
          return {
            ...segment,
            mode: 'routed',
            status: 'pending',
            version: segment.version + 1,
            geometry: { type: 'LineString', coordinates },
          };
        }),
      };
    }

    case 'add-freehand-stroke': {
      const simplified = simplify(action.coordinates, 3);
      if (simplified.length < 2) return state;
      const first = simplified[0]!;
      const last = simplified[simplified.length - 1]!;
      const points = [...state.points];
      if (points.length === 0) {
        points.push({ id: createId('pt'), type: 'start', coordinate: first, sequence: 0 });
      }
      const fromPoint = points[points.length - 1]!;
      const toPoint: RouteControlPoint = {
        id: createId('pt'),
        type: 'freehand',
        coordinate: last,
        sequence: points.length,
      };
      points.push(toPoint);

      const segment: RouteSegment = {
        id: createId('seg'),
        fromPointId: fromPoint.id,
        toPointId: toPoint.id,
        mode: 'freehand',
        activityProfile: state.activityProfile,
        geometry: { type: 'LineString', coordinates: simplified },
        distanceMetres: lineLengthMetres(simplified),
        status: 'idle',
        version: 1,
      };

      const next: EditorState = {
        ...state,
        points: resequence(points, state.closed),
        segments: [...state.segments, segment],
      };
      return { ...next, segments: rebuildSegments(next) };
    }

    case 'segment-routed': {
      return {
        ...state,
        segments: state.segments.map((segment) => {
          // Discard stale responses from superseded requests.
          if (segment.id !== action.segmentId || segment.version !== action.version) return segment;
          return {
            ...segment,
            status: 'idle',
            errorMessage: undefined,
            geometry: { type: 'LineString', coordinates: action.coordinates },
            distanceMetres: action.distanceMetres,
            ascentMetres: action.ascentMetres,
            descentMetres: action.descentMetres,
            providerMetadata: action.providerMetadata,
          };
        }),
      };
    }

    case 'segment-error': {
      return {
        ...state,
        segments: state.segments.map((segment) =>
          segment.id === action.segmentId && segment.version === action.version
            ? { ...segment, status: 'error', errorMessage: action.message }
            : segment,
        ),
      };
    }

    case 'replace-state':
      return action.state;

    default:
      return state;
  }
}

function neighbourIds(points: RouteControlPoint[], pointId: string): string[] {
  const index = points.findIndex((point) => point.id === pointId);
  if (index === -1) return [];
  return [points[index - 1]?.id, points[index + 1]?.id].filter((id): id is string => Boolean(id));
}

/** Undo/redo wrapper. A completed drag or freehand stroke is one undoable action. */
export function historyReducer(
  state: EditorHistoryState,
  action: EditorAction | { type: 'undo' } | { type: 'redo' },
): EditorHistoryState {
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
    };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: next,
      future: state.future.slice(1),
    };
  }

  const present = editorReducer(state.present, action as EditorAction);
  if (present === state.present) return state;
  if (NON_HISTORY_ACTIONS.has((action as EditorAction).type)) {
    return { ...state, present };
  }
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
  };
}

/** Combined geometry across routed and freehand segments. */
export function combinedGeometry(state: EditorState): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const segment of state.segments) {
    const segmentCoordinates = segment.geometry.coordinates as Coordinate[];
    for (const point of segmentCoordinates) {
      const last = coordinates[coordinates.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) coordinates.push(point);
    }
  }
  return coordinates;
}

export function totalDistanceMetres(state: EditorState): number {
  return state.segments.reduce((sum, segment) => sum + segment.distanceMetres, 0);
}

export function hasRoutableGeometry(state: EditorState): boolean {
  return combinedGeometry(state).length >= 2;
}
