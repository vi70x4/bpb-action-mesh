import { runHarness } from "./runner.js";
import type { HarnessOptions } from "./types.js";

async function main() {
  const mode = process.argv[2] || "smoke";

  console.log("🧪 Swarm Truth Harness v1");
  console.log(`   Mode: ${mode}`);

  const opts: HarnessOptions = mode === "stress"
    ? {
        nodeCount: 5,
        convergenceTimeoutMs: 20000,
        ttlSeconds: 600,
        network: "harness-stress",
        protocol: "vless",
        verifyTombstones: true,
        killNodeIndex: 4,
      }
    : {
        nodeCount: 3,
        convergenceTimeoutMs: 15000,
        ttlSeconds: 300,
        network: "harness-smoke",
        protocol: "vless",
        verifyTombstones: true,
        killNodeIndex: 2,
      };

  console.log(`   Nodes: ${opts.nodeCount}`);
  console.log(`   Network: ${opts.network}`);
  console.log("");

  const result = await runHarness(opts);

  console.log("\n" + "═".repeat(50));
  console.log("📊 HARNESS RESULT");
  console.log("═".repeat(50));
  console.log(`Success: ${result.success ? "✅" : "❌"}`);
  console.log(`Health: ${result.metrics.health}`);
  console.log(`Connectivity: ${(result.metrics.connectivityScore * 100).toFixed(1)}%`);
  console.log(`Discovery: ${(result.metrics.discoveryScore * 100).toFixed(1)}%`);
  console.log(`Tombstone: ${(result.metrics.tombstoneScore * 100).toFixed(1)}%`);
  console.log(`Isolated nodes: ${result.metrics.isolatedCount}`);
  console.log(`Duration: ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    console.log(`\n⚠️  Errors:`);
    result.errors.forEach(e => console.log(`   - ${e}`));
  }

  if (result.metrics.discoveryResults) {
    console.log(`\n🔍 Discovery matrix:`);
    for (const [querier, discovered] of Object.entries(result.metrics.discoveryResults)) {
      const shortId = querier.slice(0, 12) + "...";
      console.log(`   ${shortId} found: [${discovered.map(d => d.slice(0, 8) + "...").join(", ")}]`);
    }
  }

  console.log("\n" + JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(2);
});
