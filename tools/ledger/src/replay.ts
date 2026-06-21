/**
 * Replay engine — deterministic reconstruction of swarm state from the ledger.
 *
 * Supports filtering by tool, node, time range, and logical_time.
 * All replayed events are returned in causal order (logical_time ascending).
 */

import type { SwarmEvent } from "./types.js";
import { captureFingerprint, compareFingerprints } from "./schema.js";
import type { EnvFingerprint } from "./schema.js";

export interface ReplayFilter {
  tool?: string;
  node_id?: string;
  run_id?: string;
  since_logical?: number;
  until_logical?: number;
  since_timestamp?: number;
  until_timestamp?: number;
  key_prefix?: string;
  fingerprint_check?: boolean;
}

export interface ReplayResult {
  events: SwarmEvent[];
  fingerprint_warning?: string;
}

/**
 * Replay events from the ledger with optional filters.
 * Events are sorted by logical_time (causal order).
 */
export function replay(
  events: SwarmEvent[],
  filter?: ReplayFilter,
): ReplayResult {
  let filtered = [...events];

  if (filter?.tool) {
    filtered = filtered.filter((e) => e.tool === filter.tool);
  }

  if (filter?.node_id) {
    filtered = filtered.filter((e) => e.node_id === filter.node_id);
  }

  if (filter?.run_id) {
    filtered = filtered.filter((e) => e.run_id === filter.run_id);
  }

  if (filter?.since_logical !== undefined) {
    filtered = filtered.filter((e) => e.logical_time >= filter.since_logical!);
  }

  if (filter?.until_logical !== undefined) {
    filtered = filtered.filter((e) => e.logical_time <= filter.until_logical!);
  }

  if (filter?.since_timestamp !== undefined) {
    filtered = filtered.filter((e) => e.timestamp >= filter.since_timestamp!);
  }

  if (filter?.until_timestamp !== undefined) {
    filtered = filtered.filter((e) => e.timestamp <= filter.until_timestamp!);
  }

  if (filter?.key_prefix) {
    filtered = filtered.filter((e) => e.key.startsWith(filter.key_prefix!));
  }

  // Causal order
  const sorted = filtered.sort((a, b) => a.logical_time - b.logical_time);

  // Fingerprint check
  let fingerprint_warning: string | undefined;
  if (filter?.fingerprint_check) {
    const fpEvent = events.find((e) => e.key === "env.fingerprint");
    if (fpEvent?.meta?.env) {
      const recorded = fpEvent.meta.env as EnvFingerprint;
      const current = captureFingerprint(fpEvent.run_id);
      const mismatch = compareFingerprints(recorded, current);
      if (mismatch) {
        fingerprint_warning = mismatch;
      }
    }
  }

  return { events: sorted, fingerprint_warning };
}

/**
 * Replay to a specific logical_time — reconstruct state as it was at that point.
 */
export function replayAt(
  events: SwarmEvent[],
  logicalTime: number,
): SwarmEvent[] {
  return events
    .filter((e) => e.logical_time <= logicalTime)
    .sort((a, b) => a.logical_time - b.logical_time);
}

/**
 * Summarize a replay: count events, list tools, time range.
 */
export function replaySummary(events: SwarmEvent[]): string {
  if (events.length === 0) return "No events in replay window.";

  const tools = new Set(events.map((e) => e.tool));
  const keys = new Set(events.map((e) => e.key));
  const ltMin = events[0].logical_time;
  const ltMax = events[events.length - 1].logical_time;
  const tsMin = new Date(
    Math.min(...events.map((e) => e.timestamp)),
  ).toISOString();
  const tsMax = new Date(
    Math.max(...events.map((e) => e.timestamp)),
  ).toISOString();

  return [
    `Replay: ${events.length} events`,
    `  Logical time: ${ltMin} → ${ltMax}`,
    `  Wall time: ${tsMin} → ${tsMax}`,
    `  Tools: ${[...tools].join(", ")}`,
    `  Keys: ${[...keys].join(", ")}`,
  ].join("\n");
}
