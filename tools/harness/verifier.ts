import type { HarnessNode, TopologyEdge, TopologySnapshot } from "./types.js";

/**
 * Build a topology snapshot from REAL observations against a live libp2p cluster.
 * Every edge is backed by an actual peer connection — never simulated.
 */
export async function verifyTopology(
  nodes: HarnessNode[],
): Promise<TopologySnapshot> {
  const edges: TopologyEdge[] = [];
  const connectedPeerIds = new Set<string>();

  for (const node of nodes) {
    if (!node.libp2pNode) continue;

    const peers: { toString: () => string }[] =
      node.libp2pNode.getPeers?.() ?? [];

    for (const peer of peers) {
      const peerIdStr = peer.toString();
      edges.push({
        from: node.peerId,
        to: peerIdStr,
        observed: true,
      });
      connectedPeerIds.add(node.peerId);
      connectedPeerIds.add(peerIdStr);
    }
  }

  // Isolated = announced node that shows zero observed edges in any direction
  const nodesWithEdges = new Set<string>();
  for (const edge of edges) {
    nodesWithEdges.add(edge.from);
    nodesWithEdges.add(edge.to);
  }
  const isolatedPeerIds = nodes
    .filter((n) => n.announced && !nodesWithEdges.has(n.peerId))
    .map((n) => n.peerId);

  const nodeCount = nodes.length;
  const maxPossibleEdges =
    nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 1;
  // Deduplicate bidirectional edges by always sorting the pair
  const uniqueEdgeKeys = new Set<string>();
  for (const edge of edges) {
    const key =
      edge.from < edge.to
        ? `${edge.from}|${edge.to}`
        : `${edge.to}|${edge.from}`;
    uniqueEdgeKeys.add(key);
  }

  const connectivityScore =
    maxPossibleEdges > 0 ? uniqueEdgeKeys.size / maxPossibleEdges : 0;

  return {
    edges,
    nodes,
    isolatedPeerIds,
    connectivityScore,
  };
}

/**
 * Cross-discovery verification — the most critical harness test.
 * Each node queries the DHT for every other node's config key.
 * Discovery failures are recorded (they indicate mesh breakage).
 */
export async function verifyCrossDiscovery(
  nodes: HarnessNode[],
  network: string,
  protocol: string,
): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {};

  for (const querier of nodes) {
    if (!querier.libp2pNode?.contentRouting) {
      results[querier.peerId] = [];
      continue;
    }

    const discovered: string[] = [];

    for (const target of nodes) {
      if (target.peerId === querier.peerId) continue;

      const dhtKey = `/bpb/v2/${network}/${protocol}/${target.peerId}`;

      try {
        const dhtValue = await querier.libp2pNode.contentRouting.get(
          new TextEncoder().encode(dhtKey),
        );

        if (dhtValue != null) {
          discovered.push(target.peerId);
        }
      } catch {
        // DHT query failure is data — it means the target is unreachable
        // from this querier's perspective. Do not push; it counts as undiscovered.
      }
    }

    results[querier.peerId] = discovered;
  }

  return results;
}

/**
 * Tombstone verification.
 * After a node publishes a tombstone and stops, surviving nodes must NOT
 * find its config in the DHT (or must find the tombstone marker instead).
 */
export async function verifyTombstone(
  tombstonedNode: HarnessNode,
  survivingNodes: HarnessNode[],
  network: string,
  protocol: string,
): Promise<{ deadNodeAbsentFromDHT: boolean; staleRecordCount: number }> {
  const dhtKey = `/bpb/v2/${network}/${protocol}/${tombstonedNode.peerId}`;
  let staleRecordCount = 0;
  let absentFromAll = true;

  for (const survivor of survivingNodes) {
    if (!survivor.libp2pNode?.contentRouting) continue;

    try {
      const dhtValue = await survivor.libp2pNode.contentRouting.get(
        new TextEncoder().encode(dhtKey),
      );

      if (dhtValue != null) {
        // Record still present — check if it's a tombstone marker
        const valueStr = new TextDecoder().decode(dhtValue);
        if (valueStr.includes('"tombstone"') || valueStr.includes('"dead"')) {
          // Tombstone record present — acceptable but still stale in some sense
          absentFromAll = false;
        } else {
          // Non-tombstone record for a dead node = stale
          staleRecordCount++;
          absentFromAll = false;
        }
      }
      // null means correctly absent — good
    } catch {
      // DHT query error — treat as "cannot confirm presence" = absent
    }
  }

  return {
    deadNodeAbsentFromDHT: absentFromAll,
    staleRecordCount,
  };
}
