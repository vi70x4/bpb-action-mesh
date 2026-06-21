import type {
  HarnessMetrics,
  TopologySnapshot,
} from "./types.js";

/**
 * Compute the single scalar truth signal from real cluster observations.
 * Combines topology, discovery, and tombstone scores into a health verdict.
 */
export function computeMetrics(
  topology: TopologySnapshot,
  discoveryResults: Record<string, string[]>,
  tombstoneResult: { deadNodeAbsentFromDHT: boolean; staleRecordCount: number },
  totalNodes: number,
): HarnessMetrics {
  // --- connectivityScore with isolation penalty ---
  const isolatedCount = topology.isolatedPeerIds.length;
  const rawConnectivity = topology.connectivityScore;
  const connectivityScore = Math.max(
    0,
    Math.min(1, rawConnectivity - isolatedCount * 0.15),
  );

  // --- discoveryScore ---
  // Each of N nodes should discover N-1 others. Total possible = N*(N-1).
  let actualDiscoveries = 0;
  for (const discovered of Object.values(discoveryResults)) {
    actualDiscoveries += discovered.length;
  }
  const totalPossible = totalNodes > 0 ? totalNodes * (totalNodes - 1) : 0;
  const discoveryScore =
    totalPossible > 0 ? actualDiscoveries / totalPossible : 0;

  // --- tombstoneScore ---
  let tombstoneScore: number;
  if (tombstoneResult.deadNodeAbsentFromDHT) {
    tombstoneScore = 1.0;
  } else if (tombstoneResult.staleRecordCount > 0) {
    // Stale non-tombstone records present — partial credit only
    tombstoneScore = 0.5;
  } else {
    // Record present but apparently tombstoned (handled by verifier setting
    // deadNodeAbsentFromDHT=false with staleRecordCount=0)
    tombstoneScore = 0.5;
  }
  tombstoneScore = Math.max(
    0,
    tombstoneScore - tombstoneResult.staleRecordCount * 0.1,
  );

  // --- health ---
  const scores = [connectivityScore, discoveryScore, tombstoneScore];
  let health: HarnessMetrics["health"];
  if (scores.every((s) => s > 0.8)) {
    health = "GREEN";
  } else if (scores.some((s) => s < 0.5)) {
    health = "RED";
  } else {
    health = "YELLOW";
  }

  // --- peerCounts ---
  const peerCounts: Record<string, number> = {};
  for (const node of topology.nodes) {
    if (node.libp2pNode?.getPeers) {
      peerCounts[node.peerId] = node.libp2pNode.getPeers().length;
    } else {
      peerCounts[node.peerId] = 0;
    }
  }

  return {
    connectivityScore,
    discoveryScore,
    tombstoneScore,
    staleRecordCount: tombstoneResult.staleRecordCount,
    isolatedCount,
    health,
    peerCounts,
    discoveryResults,
  };
}
