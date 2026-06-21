/**
 * Causal index — builds a DAG of swarm reality from events.
 *
 * Edge rules:
 *   A → B if:
 *   - B.parent_id == A.id (explicit causality)
 *   OR
 *   - A.node_id == B.node_id AND A.logical_time < B.logical_time (same-node ordering)
 */

import type { SwarmEvent } from "./types.js";

export interface CausalEdge {
  from: string;
  to: string;
  kind: "explicit" | "same_node" | "same_run";
}

/**
 * Build causal edges from a set of events.
 * Returns edges sorted by logical_time of the source event.
 */
export function buildCausalEdges(events: SwarmEvent[]): CausalEdge[] {
  const edges: CausalEdge[] = [];
  const byId = new Map<string, SwarmEvent>();

  for (const e of events) {
    byId.set(e.id, e);
  }

  // Explicit parent_id edges
  for (const e of events) {
    if (e.parent_id && byId.has(e.parent_id)) {
      edges.push({
        from: e.parent_id,
        to: e.id,
        kind: "explicit",
      });
    }
  }

  // Same-node temporal edges
  const nodeSorted = new Map<string, SwarmEvent[]>();
  for (const e of events) {
    if (!e.node_id) continue;
    const arr = nodeSorted.get(e.node_id) ?? [];
    arr.push(e);
    nodeSorted.set(e.node_id, arr);
  }

  for (const [, nodeEvents] of nodeSorted) {
    const sorted = nodeEvents.sort((a, b) => a.logical_time - b.logical_time);
    for (let i = 1; i < sorted.length; i++) {
      edges.push({
        from: sorted[i - 1].id,
        to: sorted[i].id,
        kind: "same_node",
      });
    }
  }

  // Same-run temporal edges (lighter weight than per-node)
  const runSorted = new Map<string, SwarmEvent[]>();
  for (const e of events) {
    const arr = runSorted.get(e.run_id) ?? [];
    arr.push(e);
    runSorted.set(e.run_id, arr);
  }

  for (const [, runEvents] of runSorted) {
    const sorted = runEvents.sort((a, b) => a.logical_time - b.logical_time);
    for (let i = 1; i < sorted.length; i++) {
      // Only add run edges between different tools (to show cross-tool causality)
      if (sorted[i - 1].tool !== sorted[i].tool) {
        edges.push({
          from: sorted[i - 1].id,
          to: sorted[i].id,
          kind: "same_run",
        });
      }
    }
  }

  return edges;
}

/**
 * Get events reachable from a given event id by following causal edges.
 * Returns in topological order (ancestors first).
 */
export function getAncestors(events: SwarmEvent[], edges: CausalEdge[], eventId: string): SwarmEvent[] {
  const byId = new Map<string, SwarmEvent>();
  for (const e of events) byId.set(e.id, e);

  const visited = new Set<string>();
  const result: SwarmEvent[] = [];

  // Build reverse adjacency (child → parents)
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const arr = parents.get(edge.to) ?? [];
    arr.push(edge.from);
    parents.set(edge.to, arr);
  }

  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);

    const parentIds = parents.get(id) ?? [];
    for (const pid of parentIds) {
      walk(pid);
    }

    const evt = byId.get(id);
    if (evt) result.push(evt);
  };

  walk(eventId);
  return result;
}

/**
 * Get all events caused by a given event (descendants).
 */
export function getDescendants(events: SwarmEvent[], edges: CausalEdge[], eventId: string): SwarmEvent[] {
  const byId = new Map<string, SwarmEvent>();
  for (const e of events) byId.set(e.id, e);

  // Build forward adjacency
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const arr = children.get(edge.from) ?? [];
    arr.push(edge.to);
    children.set(edge.from, arr);
  }

  const visited = new Set<string>();
  const result: SwarmEvent[] = [];

  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);

    const kids = children.get(id) ?? [];
    for (const kid of kids) {
      walk(kid);
    }

    const evt = byId.get(id);
    if (evt) result.push(evt);
  };

  walk(eventId);
  return result;
}
