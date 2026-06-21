/**
 * SwarmEvent — the single atomic truth unit for the BPB mesh.
 *
 * Every tool output normalizes into this shape. The ledger is append-only.
 * Tools are noisy sensors; the ledger is the shared reality they observe.
 */

export type SwarmEventType =
  | "FACT"        // verified measurement (peer count, connectivity)
  | "STATE"       // transitional state (node bootstrapping, tunnel connecting)
  | "OBSERVATION" // subjective finding (ghost detected, orphan key)
  | "CORRECTION";  // retroactive fix targeting a previous event

export type SwarmEvent = {
  /** Unique event identifier (UUID or deterministic hash). */
  id: string;

  /** Causal parent — links to the event this one follows from. */
  parent_id?: string;

  /** Wall-clock time (epoch ms). */
  timestamp: number;

  /** Lamport-style monotonic counter for causal ordering. */
  logical_time: number;

  /** Tool that produced this event. */
  tool: string;

  /** Peer/node this event is about (if applicable). */
  node_id?: string;

  /** CI run or local session identifier. */
  run_id: string;

  /** Canonical dimension key — e.g. "dht.peer_count", "node.status". */
  key: string;

  /** Measured or observed value. */
  value: unknown;

  /** Confidence in this event (0.0–1.0). 1.0 = deterministic. */
  confidence: number;

  /** Event classification. */
  type: SwarmEventType;

  /** Arbitrary extension data. */
  meta?: Record<string, unknown>;
};
