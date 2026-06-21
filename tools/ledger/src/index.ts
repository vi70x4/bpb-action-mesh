/**
 * tools/ledger/src/index.ts — public API re-exports.
 */

export type { SwarmEvent, SwarmEventType } from "./types.js";
export { SwarmLedger } from "./ledger.js";
export {
  latestByKey,
  getNodeState,
  getDHTState,
  getKeyspaceHealth,
  getTunnelState,
} from "./projections.js";
export type {
  NodeStatus,
  NodeState,
  DHTState,
  KeyspaceHealth,
  TunnelStatus,
  TunnelState,
} from "./projections.js";
export { buildCausalEdges, getAncestors, getDescendants } from "./causal.js";
export type { CausalEdge } from "./causal.js";
export { replay, replayAt, replaySummary } from "./replay.js";
export type { ReplayFilter, ReplayResult } from "./replay.js";
export {
  detectContradictions,
  formatReport,
  ciExitCode,
} from "./contradictions.js";
export type {
  Contradiction,
  ContradictionSeverity,
  ContradictionReport,
} from "./contradictions.js";
export type { TemporalConfig } from "./contradictions.js";
export { DEFAULT_TEMPORAL_CONFIG } from "./contradictions.js";
export {
  CANONICAL_KEYS,
  normalizeKey,
  isValidKey,
  keysForDomain,
  captureFingerprint,
  compareFingerprints,
} from "./schema.js";
export type { CanonicalKey, EnvFingerprint } from "./schema.js";
