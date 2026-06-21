/**
 * SwarmLedger — append-only event store with causal + temporal indexing.
 *
 * The single source of truth. Tools write events; projections read them.
 * Never mutate, never delete. Corrections are new events referencing originals.
 *
 * Storage: JSONL (one event per line). Sharded by run_id in practice.
 */

import type { SwarmEvent } from "./types.js";
import {
  existsSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeKey, isValidKey } from "./schema.js";

export class SwarmLedger {
  private filePath: string;
  private logicalClock: number;
  private cache: SwarmEvent[] | null;

  constructor(filePath = "./ledger.jsonl") {
    this.filePath = resolve(filePath);
    this.logicalClock = 0;
    this.cache = null;

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create file if it doesn't exist
    if (!existsSync(this.filePath)) {
      appendFileSync(this.filePath, "");
    } else {
      // Bootstrap logical clock from existing events
      this.clockFromExisting();
    }
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Append a new event. Returns the full event with id, logical_time filled in.
   * `id` and `logical_time` are assigned by the ledger — callers must not set them.
   */
  append(partial: Omit<SwarmEvent, "id" | "logical_time">): SwarmEvent {
    // Validate + canonicalize key before writing
    const canonicalKey = normalizeKey(partial.key);

    const event: SwarmEvent = {
      ...partial,
      key: canonicalKey,
      id: randomUUID(),
      logical_time: ++this.logicalClock,
    };

    appendFileSync(this.filePath, JSON.stringify(event) + "\n");

    // Invalidate read cache
    this.cache = null;

    return event;
  }

  /**
   * Convenience: emit a correction targeting a previous event.
   * The original event is never modified.
   */
  correct(
    targetId: string,
    correctedValue: unknown,
    opts: {
      tool: string;
      run_id: string;
      confidence?: number;
    },
  ): SwarmEvent {
    return this.append({
      tool: opts.tool,
      key: "correction",
      value: correctedValue,
      confidence: opts.confidence ?? 1.0,
      type: "CORRECTION",
      timestamp: Date.now(),
      run_id: opts.run_id,
      parent_id: targetId,
      meta: { target_event_id: targetId },
    });
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /** Load all events from the ledger file. Cached after first read. */
  loadAll(): SwarmEvent[] {
    if (this.cache) return this.cache;

    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) {
      this.cache = [];
      return [];
    }

    this.cache = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SwarmEvent);

    return this.cache;
  }

  /** Load events that match a predicate. */
  filter(predicate: (e: SwarmEvent) => boolean): SwarmEvent[] {
    return this.loadAll().filter(predicate);
  }

  /** Get a single event by id. */
  getById(id: string): SwarmEvent | undefined {
    return this.loadAll().find((e) => e.id === id);
  }

  /** Get the latest event for a given key (by logical_time). */
  getLatestByKey(key: string): SwarmEvent | undefined {
    const events = this.loadAll().filter((e) => e.key === key);
    if (events.length === 0) return undefined;
    return events.reduce((a, b) => (a.logical_time > b.logical_time ? a : b));
  }

  /** Stats for introspection. */
  stats(): {
    count: number;
    tools: Set<string>;
    keys: Set<string>;
    timeRange: { min: number; max: number } | null;
  } {
    const events = this.loadAll();
    const tools = new Set<string>();
    const keys = new Set<string>();
    let min = Infinity;
    let max = -Infinity;

    for (const e of events) {
      tools.add(e.tool);
      keys.add(e.key);
      if (e.timestamp < min) min = e.timestamp;
      if (e.timestamp > max) max = e.timestamp;
    }

    return {
      count: events.length,
      tools,
      keys,
      timeRange: events.length > 0 ? { min, max } : null,
    };
  }

  /** Check all existing events for invalid keys. Returns violations. */
  validateEvents(): Array<{ event_id: string; key: string }> {
    const events = this.loadAll();
    const violations: Array<{ event_id: string; key: string }> = [];
    for (const e of events) {
      if (!isValidKey(e.key)) {
        violations.push({ event_id: e.id, key: e.key });
      }
    }
    return violations;
  }

  // ---------------------------------------------------------------------------
  // Reset (testing only)
  // ---------------------------------------------------------------------------

  /** Clear the ledger file and reset clock. Use in tests only. */
  _reset(): void {
    writeFileSync(this.filePath, "");
    this.logicalClock = 0;
    this.cache = null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private clockFromExisting(): void {
    const events = this.loadAll();
    if (events.length > 0) {
      this.logicalClock = Math.max(...events.map((e) => e.logical_time));
      this.cache = null; // invalidate since we just read for bootstrap
    }
  }
}
