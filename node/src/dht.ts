import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';

export async function createDHTNode(listenPort: number = 4001) {
  const node = await createLibp2p({
    transports: [tcp(), webSockets()],
    addresses: {
      listen: [`/tcp/${listenPort}/ws`]
    },
    services: {
      dht: kadDHT({
        clientMode: false,
        // GLM 5.1: aggressive refresh in high-churn environments
        kBucketSize: 20,
      }),
      identify: identify()
    }
  });

  return node;
}
