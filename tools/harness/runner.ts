import { spawnCluster } from "./cluster.js";
import {
  verifyTopology,
  verifyCrossDiscovery,
  verifyTombstone,
} from "./verifier.js";
import { computeMetrics } from "./metrics.js";
import { publishTombstone } from "../../node/src/announce.js";
import type {
  HarnessOptions,
  HarnessResult,
  HarnessMetrics,
  TopologySnapshot,
} from "./types.js";

export async function runHarness(opts: HarnessOptions): Promise<HarnessResult> {
  const errors: string[] = [];
  const start = performance.now();

  // 1. Spawn cluster
  let cluster: Awaited<ReturnType<typeof spawnCluster>> | null = null;
  try {
    cluster = await spawnCluster(opts);
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    return {
      success: false,
      metrics: emptyMetrics(),
      topology: {
        nodes: [],
        edges: [],
        isolatedPeerIds: [],
        connectivityScore: 0,
      },
      errors: [
        `Cluster spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      durationMs,
    };
  }

  // 2. Run topology verification
  let topology: TopologySnapshot = {
    nodes: [],
    edges: [],
    isolatedPeerIds: [],
    connectivityScore: 0,
  };
  try {
    topology = await verifyTopology(cluster.nodes);
  } catch (err) {
    errors.push(
      `Topology verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Run cross-discovery verification
  let discoveryResults: Record<string, string[]> = {};
  try {
    discoveryResults = await verifyCrossDiscovery(
      cluster.nodes,
      opts.network,
      opts.protocol,
    );
  } catch (err) {
    errors.push(
      `Cross-discovery verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Tombstone verification (conditional)
  let tombstoneResult = { deadNodeAbsentFromDHT: true, staleRecordCount: 0 };
  if (opts.verifyTombstones) {
    try {
      const killIndex = opts.killNodeIndex ?? cluster.nodes.length - 1;
      const doomed = cluster.nodes[killIndex];

      if (doomed) {
        // Publish tombstone before stopping
        await publishTombstone(
          doomed.libp2pNode,
          opts.network,
          opts.protocol,
          doomed.peerId,
        );

        // Stop the doomed node
        await doomed.libp2pNode.stop();

        // Wait for DHT propagation
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const survivors = cluster.nodes.filter((_, i) => i !== killIndex);
        tombstoneResult = await verifyTombstone(
          doomed,
          survivors,
          opts.network,
          opts.protocol,
        );

        if (
          tombstoneResult.deadNodeAbsentFromDHT === false ||
          tombstoneResult.staleRecordCount > 0
        ) {
          const score = tombstoneResult.deadNodeAbsentFromDHT
            ? 1 - tombstoneResult.staleRecordCount / opts.nodeCount
            : 0;
          if (score < 1.0) {
            errors.push(
              `Tombstone incomplete: deadNodeAbsent=${tombstoneResult.deadNodeAbsentFromDHT}, staleRecords=${tombstoneResult.staleRecordCount} (score=${(score * 100).toFixed(1)}%)`,
            );
          }
        }
      }
    } catch (err) {
      errors.push(
        `Tombstone verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Compute metrics
  const metrics = computeMetrics(
    topology,
    discoveryResults,
    tombstoneResult,
    opts.nodeCount,
  );

  // 6. Stop all remaining nodes
  try {
    await cluster.stopAll();
  } catch (err) {
    errors.push(
      `Cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 7. Determine success
  const success = metrics.health === "GREEN" || metrics.health === "YELLOW";
  const durationMs = Math.round(performance.now() - start);

  return { success, metrics, topology, errors, durationMs };
}

function emptyMetrics(): HarnessMetrics {
  return {
    health: "RED",
    connectivityScore: 0,
    discoveryScore: 0,
    tombstoneScore: 0,
    staleRecordCount: 0,
    isolatedCount: 0,
    peerCounts: {},
    discoveryResults: {},
  };
}
