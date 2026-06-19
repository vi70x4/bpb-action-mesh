import { toString } from 'uint8arrays';

export interface ProxyConfig {
  peerId: string;
  protocol: 'vless' | 'hysteria2';
  host: string;
  port: number;
  uuid?: string;
  password?: string;
  sni?: string;
  security: string;
  network: string;
  ttl: number;
  bornAt: string;
  expiresAt: string;
}

export async function announceProxyConfig(
  node: any,
  config: ProxyConfig
): Promise<void> {
  const key = `/bpb/v2/${config.network}/${config.protocol}/${config.peerId}`;
  const value = new TextEncoder().encode(JSON.stringify(config));

  await node.services.dht.provide(new TextEncoder().encode(key));
  await node.services.dht.put(new TextEncoder().encode(key), value);

  console.log(`📢 Announced to DHT: ${key}`);
}

export async function publishTombstone(
  node: any,
  network: string,
  protocol: string,
  peerId: string,
  successorId?: string
): Promise<void> {
  const key = `/bpb/v2/${network}/tombstone/${peerId}`;
  const value = JSON.stringify({
    deadPeer: peerId,
    diedAt: new Date().toISOString(),
    successor: successorId || null,
    lastKnownPeers: node.getPeers().map((p: any) => p.toString())
  });

  await node.services.dht.put(
    new TextEncoder().encode(key),
    new TextEncoder().encode(value)
  );

  console.log(`🪦 Published tombstone: ${key}`);
}
