import { createDHTNode } from "../../node/src/dht.js";
import { announceProxyConfig } from "../../node/src/announce.js";
import type { ProxyConfig } from "../../node/src/announce.js";
import type { HarnessNode, HarnessOptions } from "./types.js";
import { multiaddr } from "@multiformats/multiaddr";

export interface Cluster {
  nodes: HarnessNode[];
  stopAll(): Promise<void>;
  getMultiaddrs(nodeIndex: number): string[];
}

const BASE_PORT = 25001; // wider port range to avoid collisions

/**
 * Build a fake-but-valid ProxyConfig for a harness node.
 * Uses the dedicated harness network namespace — never "bpb-default".
 */
function buildHarnessProxyConfig(
  peerId: string,
  index: number,
  opts: HarnessOptions,
): ProxyConfig {
  const now = Date.now();
  const ttlMs = opts.ttlSeconds * 1000;
  return {
    peerId,
    protocol: opts.protocol,
    host: `harness-node-${index}.test`,
    port: 10000 + index,
    uuid:
      opts.protocol === "vless"
        ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
        : undefined,
    password: opts.protocol === "hysteria2" ? `harness-pw-${index}` : undefined,
    sni: `harness-node-${index}.test`,
    security: "none",
    network: opts.network,
    ttl: opts.ttlSeconds,
    bornAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

/**
 * Convenience sleep — real timers, no simulation.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Spawn a cluster of REAL libp2p DHT nodes and have each announce a ProxyConfig.
 *
 * Node-0 is the bootstrap: starts first on BASE_PORT with no peers.
 * Subsequent nodes start on BASE_PORT+1, BASE_PORT+2, etc., and dial
 * node-0 to join the DHT.
 *
 * IMPORTANT: we spawn ALL nodes and connect them BEFORE announcing.
 * contentRouting.put() hangs on an isolated node (no peers to replicate
 * to), so announcements must happen after the mesh is formed.
 *
 * Flow: create all → dial all → wait for convergence → announce all
 */
export async function spawnCluster(opts: HarnessOptions): Promise<Cluster> {
  const nodes: HarnessNode[] = [];
  const errors: string[] = [];

  // --- 1. Create node-0 (bootstrap) ---
  let node0Libp2p: any;
  try {
    node0Libp2p = await createDHTNode(BASE_PORT);
  } catch (err) {
    throw new Error(
      `Failed to start bootstrap node on port ${BASE_PORT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const node0PeerId = node0Libp2p.peerId.toString();
  const node0Multiaddrs = node0Libp2p.getMultiaddrs();
  const node0MultiaddrStrs = node0Multiaddrs.map(
    (ma: { toString: () => string }) => ma.toString(),
  );

  nodes.push({
    id: "node-0",
    peerId: node0PeerId,
    libp2pNode: node0Libp2p,
    multiaddrs: node0MultiaddrStrs,
    announced: false,
    tombstoned: false,
  });

  // Wait for node-0 to settle before others try to dial it
  await sleep(1000);

  // --- 2. Create subsequent nodes and dial node-0 ---
  for (let i = 1; i < opts.nodeCount; i++) {
    const port = BASE_PORT + i * 2;
    let libp2pNode: any;
    try {
      libp2pNode = await createDHTNode(port);
    } catch (err) {
      errors.push(
        `Failed to start node-${i} on port ${port}: ${err instanceof Error ? err.message : String(err)}`,
      );
      nodes.push({
        id: `node-${i}`,
        peerId: "",
        libp2pNode: null,
        multiaddrs: [],
        announced: false,
        tombstoned: false,
      });
      continue;
    }

    const peerId = libp2pNode.peerId.toString();
    const multiaddrs = libp2pNode
      .getMultiaddrs()
      .map((ma: { toString: () => string }) => ma.toString());

    // Dial node-0 to join the DHT mesh
    const node0addrs = node0Multiaddrs
      .map((ma: { toString: () => string }) => ma.toString())
      .map((s: string) => multiaddr(s.replace(/\/p2p\/.*$/, "")));
    try {
      await libp2pNode.peerStore.merge(node0Libp2p.peerId, {
        multiaddrs: node0addrs,
      });
      await libp2pNode.dial(node0Libp2p.peerId);
    } catch (err) {
      errors.push(
        `node-${i} failed to dial bootstrap node-0: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    nodes.push({
      id: `node-${i}`,
      peerId,
      libp2pNode,
      multiaddrs,
      announced: false,
      tombstoned: false,
    });

    if (i < opts.nodeCount - 1) {
      await sleep(500);
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️  Cluster spawn had ${errors.length} non-fatal errors:`);
    for (const e of errors) console.warn(`   - ${e}`);
  }

  // --- 3. Wait for DHT convergence ---
  const minPeers = opts.nodeCount - 1;
  const pollIntervalMs = 500;
  const deadline = Date.now() + opts.convergenceTimeoutMs;
  let converged = false;

  while (Date.now() < deadline) {
    const aliveNodes = nodes.filter((n) => n.libp2pNode != null);
    const peerCounts = aliveNodes.map(
      (n: any) => n.libp2pNode.getPeers().length,
    );
    const allConverged = peerCounts.every((c: number) => c >= minPeers);

    if (allConverged) {
      converged = true;
      break;
    }

    // Also accept partial convergence: every alive node has at least 1 peer
    const partialConverged = peerCounts.every((c: number) => c >= 1);
    if (partialConverged && peerCounts.some((c: number) => c >= minPeers)) {
      converged = true;
      break;
    }

    await sleep(pollIntervalMs);
  }

  if (!converged) {
    const aliveNodes = nodes.filter((n) => n.libp2pNode != null);
    const peerCounts = aliveNodes.map(
      (n: any) => `${n.id}=${n.libp2pNode.getPeers().length}`,
    );
    throw new Error(
      `DHT convergence timeout after ${opts.convergenceTimeoutMs}ms. Peer counts: ${peerCounts.join(", ")}`,
    );
  }

  // --- 4. Announce all nodes (AFTER mesh is formed) ---
  // contentRouting.put() requires connected peers; announcing on an
  // isolated node hangs forever.
  const announceTimeoutMs = 10_000;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.libp2pNode) continue;

    const config = buildHarnessProxyConfig(node.peerId, i, opts);
    try {
      await Promise.race([
        announceProxyConfig(node.libp2pNode, config),
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error("announce timeout")),
            announceTimeoutMs,
          ),
        ),
      ]);
      node.announced = true;
      node.config = config;
    } catch (err) {
      errors.push(
        `node-${i} failed to announce: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️  Cluster announce had ${errors.length} non-fatal errors:`);
    for (const e of errors) console.warn(`   - ${e}`);
  }

  // --- 5. Return cluster handle ---
  return {
    nodes,

    async stopAll(): Promise<void> {
      const stopPromises = nodes
        .filter((n) => n.libp2pNode != null)
        .map(async (n) => {
          try {
            await n.libp2pNode.stop();
          } catch {
            // Best-effort shutdown
          }
        });
      await Promise.all(stopPromises);
    },

    getMultiaddrs(nodeIndex: number): string[] {
      const node = nodes[nodeIndex];
      if (!node) return [];
      if (node.libp2pNode == null) return [];
      return node.libp2pNode
        .getMultiaddrs()
        .map((ma: { toString: () => string }) => ma.toString());
    },
  };
}
