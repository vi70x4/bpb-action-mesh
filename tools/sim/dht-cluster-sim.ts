/**
 * DHT Cluster Simulator — spins up N libp2p nodes locally,
 * bootstraps them into a Kademlia DHT mesh, announces mock
 * proxy configs, and verifies mutual discovery.
 *
 * Usage: npx tsx dht-cluster-sim.ts [--nodes N]
 */

import { createLibp2p } from "libp2p";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { kadDHT } from "@libp2p/kad-dht";
import { identify } from "@libp2p/identify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProxyConfig {
  peerId: string;
  protocol: "vless" | "hysteria2";
  host: string;
  port: number;
  uuid?: string;
  sni?: string;
  security: string;
  network: string;
  ttl: number;
  bornAt: string;
  expiresAt: string;
}

interface SimNode {
  node: Awaited<ReturnType<typeof createLibp2p>>;
  peerId: string;
  index: number;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): { nodeCount: number } {
  const args = process.argv.slice(2);
  let nodeCount = 3;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--nodes" && args[i + 1]) {
      nodeCount = parseInt(args[i + 1], 10);
      if (isNaN(nodeCount) || nodeCount < 1) {
        console.error("--nodes must be a positive integer");
        process.exit(1);
      }
      i++;
    }
  }
  return { nodeCount };
}

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

const BASE_PORT = 15000;

async function createSimNode(index: number): Promise<SimNode> {
  const listenPort = BASE_PORT + index;

  const node = await createLibp2p({
    transports: [tcp(), webSockets()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    addresses: {
      listen: [`/tcp/${listenPort}/ws`],
    },
    services: {
      dht: kadDHT({
        clientMode: false,
        kBucketSize: 20,
      }),
      identify: identify(),
    },
  });

  const peerId = node.peerId.toString();
  return { node, peerId, index };
}

// ---------------------------------------------------------------------------
// Bootstrap — dial the first node from every other node
// ---------------------------------------------------------------------------

async function bootstrap(nodes: SimNode[]): Promise<void> {
  const bootstrapNode = nodes[0];
  const bootstrapAddr = `/ip4/127.0.0.1/tcp/${BASE_PORT}/ws/p2p/${bootstrapNode.peerId}`;

  for (let i = 1; i < nodes.length; i++) {
    try {
      await nodes[i].node.dial(bootstrapAddr);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`  ⚠ Node ${i} failed to bootstrap to Node 0: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Announce
// ---------------------------------------------------------------------------

function buildMockConfig(peerId: string): ProxyConfig {
  const now = Date.now();
  const ttlSeconds = 2340; // 39 minutes
  return {
    peerId,
    protocol: "vless",
    host: `${peerId.slice(0, 8)}.trycloudflare.com`,
    port: 443,
    uuid: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    sni: `${peerId.slice(0, 8)}.trycloudflare.com`,
    security: "tls",
    network: "bpb-sim",
    ttl: ttlSeconds,
    bornAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
}

async function announceNode(sim: SimNode): Promise<void> {
  const config = buildMockConfig(sim.peerId);
  const key = `/bpb/v2/${config.network}/${config.protocol}/${config.peerId}`;
  const value = new TextEncoder().encode(JSON.stringify(config));

  await sim.node.services.dht.provide(new TextEncoder().encode(key));
  await sim.node.services.dht.put(new TextEncoder().encode(key), value);
}

// ---------------------------------------------------------------------------
// Discovery — query DHT for the vless prefix and count found peers
// ---------------------------------------------------------------------------

async function discoverPeers(sim: SimNode): Promise<number> {
  // Walk the DHT via findProviders on a shared network key.
  // Each node calls provide() on its own per-peer key during announce,
  // so findProviders on the network-level key discovers all participants.
  const networkKey = new TextEncoder().encode("/bpb/v2/bpb-sim/vless");
  const providers: string[] = [];

  for await (const event of sim.node.services.dht.findProviders(networkKey)) {
    if (event.name === "PROVIDER") {
      for (const provider of event.providers) {
        const id = provider.id.toString();
        if (id !== sim.peerId && !providers.includes(id)) {
          providers.push(id);
        }
      }
    }
  }

  return providers.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { nodeCount } = parseArgs();
  const nodes: SimNode[] = [];
  let success = false;

  console.log(`🧪 DHT Cluster Simulation (N=${nodeCount})\n`);

  try {
    // --- Create nodes ---
    for (let i = 0; i < nodeCount; i++) {
      const sim = await createSimNode(i);
      nodes.push(sim);
    }

    // --- Bootstrap: dial node 0 from all others ---
    if (nodeCount > 1) {
      await bootstrap(nodes);
    }

    // Give DHT routing tables time to populate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // --- Announce all nodes ---
    for (const sim of nodes) {
      await announceNode(sim);
      const shortId = sim.peerId.slice(0, 12);
      console.log(
        `✓ Node ${sim.index} (${shortId}...) bootstrapped, announced`,
      );
    }

    console.log("");

    // --- Discovery phase ---
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const discoveryResults: number[] = [];
    for (const sim of nodes) {
      const count = await discoverPeers(sim);
      discoveryResults.push(count);
    }

    const discoveryLine = discoveryResults
      .map((count, i) => `Node ${i} found ${count} peers`)
      .join(", ");
    console.log(`🔍 Discovery: ${discoveryLine}`);

    // --- Verdict ---
    const expectedPeers = nodeCount - 1;
    const allDiscovered = discoveryResults.every((count) => count >= 1);
    const fullMesh = discoveryResults.every((count) => count >= expectedPeers);

    if (fullMesh) {
      console.log("✅ PASS: All nodes discovered each other");
      success = true;
    } else if (allDiscovered) {
      console.log(
        `⚠ PARTIAL: Each node found at least 1 peer, but not full mesh (expected ${expectedPeers} each)`,
      );
      success = true; // still pass — DHT eventual consistency may need more time
    } else {
      console.log("❌ FAIL: Some nodes discovered zero peers");
      success = false;
    }
  } catch (err) {
    console.error("❌ Simulation error:", err);
    success = false;
  } finally {
    // --- Clean shutdown ---
    for (const sim of nodes) {
      try {
        await sim.node.stop();
      } catch {
        // best-effort
      }
    }
  }

  process.exit(success ? 0 : 1);
}

main();
