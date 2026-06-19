import { createDHTNode } from './dht.js';
import { announceProxyConfig, type ProxyConfig } from './announce.js';
import { startLifecycle } from './lifecycle.js';

// Config from environment variables
const PORT = parseInt(process.env.MESH_PORT || '4001');
const NETWORK = process.env.NETWORK_ID || 'bpb-default';
const PROTOCOL = (process.env.PROXY_PROTOCOL || 'vless') as 'vless' | 'hysteria2';
const PROXY_HOST = process.env.PROXY_HOST || 'unknown';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '443');
const VLESS_UUID = process.env.VLESS_UUID || '';
const HY2_PASSWORD = process.env.HY2_PASSWORD || '';
const TTL_MINUTES = parseInt(process.env.TTL_MINUTES || `${15 + Math.floor(Math.random() * 46)}`); // random 15-60

const BORN_AT = Date.now();

function buildProxyConfig(peerId: string): ProxyConfig {
  const elapsedSeconds = Math.floor((Date.now() - BORN_AT) / 1000);
  const totalTtlSeconds = TTL_MINUTES * 60;
  const remainingTtl = Math.max(0, totalTtlSeconds - elapsedSeconds);

  return {
    peerId,
    protocol: PROTOCOL,
    host: PROXY_HOST,
    port: PROXY_PORT,
    uuid: VLESS_UUID || undefined,
    password: HY2_PASSWORD || undefined,
    sni: PROXY_HOST,
    security: 'tls',
    network: NETWORK,
    ttl: remainingTtl,
    bornAt: new Date(BORN_AT).toISOString(),
    expiresAt: new Date(BORN_AT + totalTtlSeconds * 1000).toISOString()
  };
}

async function main() {
  console.log('🌀 BPB Mesh Node starting...');
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Protocol: ${PROTOCOL}`);
  console.log(`   TTL: ${TTL_MINUTES} minutes`);
  console.log(`   DHT Port: ${PORT}`);

  // 1. Create and start DHT node
  const node = await createDHTNode(PORT);
  const peerId = node.peerId.toString();
  console.log(`🆔 PeerId: ${peerId}`);

  // 2. Wait for DHT to be ready
  console.log('⏳ Waiting for DHT...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Announce proxy config to DHT
  if (PROXY_HOST !== 'unknown') {
    const config = buildProxyConfig(peerId);
    await announceProxyConfig(node, config);
  } else {
    console.log('⚠️  No PROXY_HOST set. Will announce when tunnel is ready.');
  }

  // 4. Re-announce every 5 minutes (keep DHT records fresh)
  const reannounceInterval = setInterval(async () => {
    if (PROXY_HOST !== 'unknown') {
      try {
        const config = buildProxyConfig(peerId);
        await announceProxyConfig(node, config);
        console.log('🔄 Re-announced to DHT');
      } catch (err) {
        console.error('Re-announce failed:', err);
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  // 5. Start lifecycle management
  const lifecycle = startLifecycle(node, {
    ttlMinutes: TTL_MINUTES,
    network: NETWORK,
    protocol: PROTOCOL,
    peerId,
    reannounceIntervalSeconds: 300
  });

  // Clean up re-announce interval on shutdown
  process.on('exit', () => clearInterval(reannounceInterval));

  console.log('✅ BPB Mesh Node is running');
  console.log(`   DHT peers: ${node.getPeers().length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
