import type { Coordinate, NormalisedRouteSegment, RoutePreferences } from '@/types/domain';
import { haversineMetres } from '@/lib/geo/geometry';
import { classifyPath, isUsableForProfile } from '@/features/rights-of-way/access-policy';
import { travelModeOf, wayCostMultiplier } from '@/features/routing/profiles';
import {
  edgesFromNode,
  nearestNode,
  syntheticElevation,
  type NetworkEdge,
  type NetworkNode,
} from '@/server/providers/fixtures/network';

/** Minimal binary heap keyed by numeric priority. */
class MinHeap<T> {
  private readonly items: Array<{ key: number; value: T }> = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    this.items.push({ key, value });
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent]!.key <= this.items[index]!.key) break;
      [this.items[parent], this.items[index]] = [this.items[index]!, this.items[parent]!];
      index = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.items[left]!.key < this.items[smallest]!.key)
          smallest = left;
        if (right < this.items.length && this.items[right]!.key < this.items[smallest]!.key)
          smallest = right;
        if (smallest === index) break;
        [this.items[smallest], this.items[index]] = [this.items[index]!, this.items[smallest]!];
        index = smallest;
      }
    }
    return top.value;
  }
}

export interface FixtureRouteOptions {
  /** Extra multiplier applied per edge, keyed by way id, to diversify alternatives. */
  edgeBias?: (edge: NetworkEdge) => number;
  maxExpansions?: number;
  /** Ways to avoid (used for varied out-and-back returns). */
  avoidWayIds?: ReadonlySet<number>;
}

export interface FixtureRouteLeg {
  coordinates: Coordinate[];
  segments: NormalisedRouteSegment[];
  distanceMetres: number;
  ascentMetres: number;
  descentMetres: number;
}

const nodeKey = (node: NetworkNode): string => `${node.i}:${node.j}`;

function edgePassable(edge: NetworkEdge, preferences: RoutePreferences): boolean {
  const classification = classifyPath(edge.tags, 'england-wales');
  const mode = travelModeOf(preferences.activityProfile);
  const policy =
    preferences.accessPolicy === 'show-all' ? 'permit-uncertain' : preferences.accessPolicy;
  if (mode === 'walking') {
    return classification.walking.status !== 'prohibited';
  }
  return isUsableForProfile(classification, 'cycling', policy);
}

function edgeCost(
  edge: NetworkEdge,
  preferences: RoutePreferences,
  options: FixtureRouteOptions,
): number {
  let multiplier = wayCostMultiplier(edge.tags, preferences);
  if (options.edgeBias) multiplier *= options.edgeBias(edge);
  if (options.avoidWayIds?.has(edge.wayId)) multiplier *= 6;
  const classification = classifyPath(edge.tags, 'england-wales');
  if (classification.cycling.cyclingStatus === 'uncertain') multiplier *= 1.12;
  if (classification.cycling.cyclingStatus === 'not-confirmed') multiplier *= 2.4;
  return edge.lengthMetres * Math.max(0.2, multiplier);
}

function ascentDescent(coordinates: readonly Coordinate[]): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const delta = syntheticElevation(coordinates[i]!) - syntheticElevation(coordinates[i - 1]!);
    if (delta > 0) ascent += delta;
    else descent -= delta;
  }
  return { ascent, descent };
}

/**
 * A* over the deterministic synthetic network. This is a real shortest-path
 * search with access-aware costs — not a straight line between waypoints.
 */
export function routeLeg(
  from: Coordinate,
  to: Coordinate,
  preferences: RoutePreferences,
  options: FixtureRouteOptions = {},
): FixtureRouteLeg | null {
  const startNode = nearestNode(from);
  const goalNode = nearestNode(to);
  const maxExpansions = options.maxExpansions ?? 20_000;

  if (nodeKey(startNode) === nodeKey(goalNode)) {
    return {
      coordinates: [startNode.coordinate, goalNode.coordinate],
      segments: [],
      distanceMetres: haversineMetres(startNode.coordinate, goalNode.coordinate),
      ascentMetres: 0,
      descentMetres: 0,
    };
  }

  const cameFrom = new Map<string, { node: NetworkNode; edge: NetworkEdge }>();
  const gScore = new Map<string, number>([[nodeKey(startNode), 0]]);
  const open = new MinHeap<NetworkNode>();
  const visited = new Set<string>();
  open.push(0, startNode);
  let expansions = 0;

  while (open.size > 0 && expansions < maxExpansions) {
    const current = open.pop()!;
    const key = nodeKey(current);
    if (visited.has(key)) continue;
    visited.add(key);
    expansions += 1;

    if (key === nodeKey(goalNode)) {
      return reconstruct(startNode, goalNode, cameFrom, from, to);
    }

    for (const edge of edgesFromNode(current)) {
      if (!edgePassable(edge, preferences)) continue;
      const neighbourKey = nodeKey(edge.to);
      if (visited.has(neighbourKey)) continue;
      const tentative = (gScore.get(key) ?? Infinity) + edgeCost(edge, preferences, options);
      if (tentative >= (gScore.get(neighbourKey) ?? Infinity)) continue;
      gScore.set(neighbourKey, tentative);
      cameFrom.set(neighbourKey, { node: current, edge });
      const heuristic = haversineMetres(edge.to.coordinate, goalNode.coordinate) * 0.55;
      open.push(tentative + heuristic, edge.to);
    }
  }
  return null;
}

function reconstruct(
  startNode: NetworkNode,
  goalNode: NetworkNode,
  cameFrom: Map<string, { node: NetworkNode; edge: NetworkEdge }>,
  requestedFrom: Coordinate,
  requestedTo: Coordinate,
): FixtureRouteLeg {
  const edges: NetworkEdge[] = [];
  let cursor = goalNode;
  while (nodeKey(cursor) !== nodeKey(startNode)) {
    const previous = cameFrom.get(nodeKey(cursor));
    if (!previous) break;
    edges.unshift(previous.edge);
    cursor = previous.node;
  }

  const coordinates: Coordinate[] = [requestedFrom];
  const segments: NormalisedRouteSegment[] = [];
  let distanceMetres = haversineMetres(requestedFrom, startNode.coordinate);
  let ascentMetres = 0;
  let descentMetres = 0;

  edges.forEach((edge, index) => {
    const coords = edge.coordinates;
    for (let i = 0; i < coords.length; i += 1) {
      const point = coords[i]!;
      const last = coordinates[coordinates.length - 1]!;
      if (last[0] !== point[0] || last[1] !== point[1]) coordinates.push(point);
    }
    const { ascent, descent } = ascentDescent(coords);
    ascentMetres += ascent;
    descentMetres += descent;
    distanceMetres += edge.lengthMetres;
    segments.push({
      index,
      coordinates: [...coords],
      distanceMetres: edge.lengthMetres,
      ascentMetres: ascent,
      descentMetres: descent,
      osmWayId: edge.wayId,
      tags: edge.tags,
      surface: edge.tags.surface,
      wayType: edge.tags.highway,
    });
  });

  const tail = coordinates[coordinates.length - 1]!;
  if (tail[0] !== requestedTo[0] || tail[1] !== requestedTo[1]) {
    coordinates.push(requestedTo);
    distanceMetres += haversineMetres(tail, requestedTo);
  }

  return { coordinates, segments, distanceMetres, ascentMetres, descentMetres };
}

export { ascentDescent as syntheticAscentDescent };
