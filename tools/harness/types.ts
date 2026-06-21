import type { ProxyConfig } from "../../node/src/announce.js";

export interface HarnessNode {
  id: string;            // test id like "node-0"
  peerId: string;        // actual libp2p PeerId string
  libp2pNode: any;       // the real Libp2p instance
  multiaddrs: string[];  // observable multiaddrs
  announced: boolean;    // whether this node announced a proxy config
  tombstoned: boolean;   // whether this node published a tombstone
  config?: ProxyConfig; // the config it announced (if any)
}

export interface TopologyEdge {
  from: string;   // peerId of source
  to: string;      // peerId of target
  observed: boolean; // was this connection actually observed?
}

export interface TopologySnapshot {
  edges: TopologyEdge[];
  nodes: HarnessNode[];
  isolatedPeerIds: string[];  // peerIds that have no edges
  connectivityScore: number;  // 0.0 - 1.0
}

export interface HarnessMetrics {
  connectivityScore: number;   // 0.0 - 1.0
  discoveryScore: number;       // fraction of nodes discoverable via DHT
  tombstoneScore: number;       // fraction of tombstoned nodes actually absent from DHT
  staleRecordCount: number;     // records that exist but shouldn't
  isolatedCount: number;         // nodes with zero observed edges
  health: "GREEN" | "YELLOW" | "RED";
  peerCounts: Record<string, number>;  // peerId -> number of connected peers
  discoveryResults: Record<string, string[]>;  // queryPeerId -> [discovered peerIds]
}

export interface HarnessResult {
  success: boolean;
  metrics: HarnessMetrics;
  topology: TopologySnapshot;
  errors: string[];
  durationMs: number;
}

export interface HarnessOptions {
  nodeCount: number;          // how many nodes to spawn (default 3)
  convergenceTimeoutMs: number; // max wait for DHT convergence (default 15000)
  ttlSeconds: number;         // TTL for proxy configs (default 300)
  network: string;            // DHT network namespace (default "harness-test")
  protocol: "vless" | "hysteria2"; // proxy protocol to advertise (default "vless")
  verifyTombstones: boolean;  // whether to test tombstone propagation (default true)
  killNodeIndex?: number;     // index of node to kill for tombstone test
}
