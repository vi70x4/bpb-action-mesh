/**
 * Bootstrap Peer Health Validator
 *
 * Validates bootstrap peer multiaddrs for the BPB mesh DHT.
 * Performs TCP-level connectivity checks and optional coordinator fetch.
 * No libp2p dependency — lightweight, standalone tool.
 *
 * Exit codes:
 *   0 = all peers reachable
 *   1 = majority unreachable
 *   2 = all unreachable
 *   3 = no bootstrap peers configured
 */

import { createConnection } from "net";
import { request } from "http";
import { URL } from "url";

// ── Types ────────────────────────────────────────────────────────────────

interface PeerResult {
  multiaddr: string;
  status: "ok" | "timeout" | "refused" | "error" | "invalid";
  latencyMs: number | null;
  error?: string;
}

interface HistogramBin {
  label: string;
  count: number;
}

interface ParsedAddr {
  host: string;
  port: number;
  peerId?: string;
}

// ── Multiaddr parsing ────────────────────────────────────────────────────

const MULTIADDR_RE =
  /\/(ip4|dns4|dns6|ip6)\/([^/]+)\/tcp\/(\d+)(?:\/p2p\/([^/]+))?/;

function parseMultiaddr(addr: string): ParsedAddr | null {
  const m = addr.match(MULTIADDR_RE);
  if (!m) return null;
  return {
    host: m[2],
    port: parseInt(m[3], 10),
    peerId: m[4] || undefined,
  };
}

function isValidMultiaddr(addr: string): boolean {
  return MULTIADDR_RE.test(addr);
}

// ── TCP health check ─────────────────────────────────────────────────────

function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: null; error: string }> {
  return new Promise((resolve) => {
    const start = Date.now();

    const socket = createConnection({ host, port }, () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ ok: true, latencyMs: latency });
    });

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, latencyMs: null, error: "TIMEOUT" });
    });

    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ECONNREFUSED") {
        resolve({ ok: false, latencyMs: null, error: "REFUSED" });
      } else if (code === "ENOTFOUND") {
        resolve({ ok: false, latencyMs: null, error: "DNS_FAIL" });
      } else if (code === "EHOSTUNREACH") {
        resolve({ ok: false, latencyMs: null, error: "UNREACHABLE" });
      } else {
        resolve({ ok: false, latencyMs: null, error: err.message });
      }
    });
  });
}

// ── Coordinator fetch ────────────────────────────────────────────────────

interface CoordinatorCheck {
  healthy: boolean;
  proxyAddrs: string[];
  error?: string;
}

async function fetchFromCoordinator(
  coordinatorUrl: string,
  timeoutMs: number,
): Promise<CoordinatorCheck> {
  const url = new URL(coordinatorUrl);

  // 1. Health check
  const healthOk = await httpGet(url, "/health", timeoutMs);
  if (!healthOk.ok) {
    return { healthy: false, proxyAddrs: [], error: `Coordinator health failed: ${healthOk.error}` };
  }

  // 2. Try /bootstrap/peers, fall back to /proxies
  const bootstrap = await httpGet(url, "/bootstrap/peers", timeoutMs);
  if (bootstrap.ok && Array.isArray(bootstrap.data)) {
    const addrs = bootstrap.data
      .map((p: unknown) => (typeof p === "string" ? p : (p as Record<string, unknown>).multiaddr ?? (p as Record<string, unknown>).address))
      .filter((a: unknown): a is string => typeof a === "string" && a.length > 0);
    return { healthy: true, proxyAddrs: addrs };
  }

  const proxies = await httpGet(url, "/proxies", timeoutMs);
  if (proxies.ok && Array.isArray(proxies.data)) {
    const addrs = proxies.data
      .map((p: unknown) => (typeof p === "string" ? p : (p as Record<string, unknown>).multiaddr ?? (p as Record<string, unknown>).address))
      .filter((a: unknown): a is string => typeof a === "string" && a.length > 0);
    return { healthy: true, proxyAddrs: addrs };
  }

  return {
    healthy: true,
    proxyAddrs: [],
    error: "No peer addresses returned from coordinator",
  };
}

function httpGet(
  url: URL,
  path: string,
  timeoutMs: number,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path,
        method: "GET",
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve({ ok: true, data: JSON.parse(body) });
            } catch {
              resolve({ ok: true, data: body });
            }
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "TIMEOUT" });
    });

    req.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.end();
  });
}

// ── CLI argument parsing ──────────────────────────────────────────────────

interface CliArgs {
  peers: string[];
  coordinator: string | null;
  timeout: number;
  threshold: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    peers: [],
    coordinator: null,
    timeout: 5000,
    threshold: 50,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--peers":
        args.peers = argv[++i]?.split(",").filter(Boolean) ?? [];
        break;
      case "--coordinator":
        args.coordinator = argv[++i] ?? null;
        break;
      case "--timeout": {
        const val = parseInt(argv[++i] ?? "", 10);
        args.timeout = Number.isNaN(val) ? 5000 : val;
        break;
      }
      case "--threshold": {
        const val = parseInt(argv[++i] ?? "", 10);
        args.threshold = Number.isNaN(val) ? 50 : Math.max(0, Math.min(100, val));
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage: tsx validate-bootstrap.ts [options]

Options:
  --peers <multiaddrs>      Comma-separated list of bootstrap peer multiaddrs
  --coordinator <url>       Fetch peers from coordinator (GET /bootstrap/peers or GET /proxies)
  --timeout <ms>           TCP connect timeout in milliseconds (default: 5000)
  --threshold <pct>        Fail if less than this % reachable (default: 50)
  -h, --help               Show this help

Peer sources (checked in order):
  1. --peers CLI argument
  2. BOOTSTRAP_PEERS environment variable (comma-separated)
  3. --coordinator URL (fetches from API)
`.trim());
}

// ── Peer source resolution ───────────────────────────────────────────────

function resolvePeers(args: CliArgs): { peers: string[]; source: string } {
  // Priority 1: explicit CLI arg
  if (args.peers.length > 0) {
    return { peers: args.peers, source: `CLI --peers (${args.peers.length} peers)` };
  }

  // Priority 2: env var
  const envPeers = process.env.BOOTSTRAP_PEERS;
  if (envPeers && envPeers.trim().length > 0) {
    const peers = envPeers.split(",").map((s) => s.trim()).filter(Boolean);
    if (peers.length > 0) {
      return { peers, source: `BOOTSTRAP_PEERS env (${peers.length} peers)` };
    }
  }

  return { peers: [], source: "none" };
}

// ── Formatting helpers ──────────────────────────────────────────────────

function truncateAddr(addr: string, maxLen: number = 60): string {
  return addr.length > maxLen ? addr.slice(0, maxLen - 3) + "..." : addr;
}

function formatStatus(result: PeerResult): string {
  switch (result.status) {
    case "ok":
      return `✓ ${truncateAddr(result.multiaddr).padEnd(62)}  latency: ${result.latencyMs}ms`;
    case "timeout":
      return `⚠ ${truncateAddr(result.multiaddr).padEnd(62)}  TIMEOUT`;
    case "refused":
      return `✗ ${truncateAddr(result.multiaddr).padEnd(62)}  REFUSED`;
    case "invalid":
      return `✗ ${truncateAddr(result.multiaddr).padEnd(62)}  INVALID MULTIADDR`;
    default:
      return `✗ ${truncateAddr(result.multiaddr).padEnd(62)}  ${result.error ?? "ERROR"}`;
  }
}

function buildHistogram(results: PeerResult[]): HistogramBin[] {
  const bins: HistogramBin[] = [
    { label: "<50ms", count: 0 },
    { label: "<100ms", count: 0 },
    { label: "<250ms", count: 0 },
    { label: "<500ms", count: 0 },
    { label: ">500ms", count: 0 },
    { label: "timeout", count: 0 },
    { label: "failed", count: 0 },
  ];

  for (const r of results) {
    if (r.status === "ok" && r.latencyMs !== null) {
      if (r.latencyMs < 50) bins[0].count++;
      else if (r.latencyMs < 100) bins[1].count++;
      else if (r.latencyMs < 250) bins[2].count++;
      else if (r.latencyMs < 500) bins[3].count++;
      else bins[4].count++;
    } else if (r.status === "timeout") {
      bins[5].count++;
    } else {
      bins[6].count++;
    }
  }

  return bins;
}

function renderHistogram(bins: HistogramBin[]): string {
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const barWidth = 10;

  return bins
    .map((bin) => {
      const barLen = Math.round((bin.count / maxCount) * barWidth);
      const bar = "█".repeat(barLen);
      const count = bin.count > 0 ? ` (${bin.count})` : "";
      return `  ${bin.label.padEnd(8)} ${bar}${count}`;
    })
    .join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<never> {
  const args = parseArgs(process.argv);
  const timeoutMs = args.timeout;

  // Resolve peer list
  const { peers: cliPeers, source } = resolvePeers(args);
  let allPeers = [...cliPeers];

  // If coordinator specified, fetch peers from it
  if (args.coordinator) {
    const coord = await fetchFromCoordinator(args.coordinator, timeoutMs);
    if (coord.error) {
      console.error(`⚠  Coordinator warning: ${coord.error}`);
    }
    if (coord.proxyAddrs.length > 0) {
      allPeers = [...allPeers, ...coord.proxyAddrs];
    }
  }

  // Deduplicate
  allPeers = [...new Set(allPeers)];

  // No peers → exit 3
  if (allPeers.length === 0) {
    console.log("🌐 Bootstrap Peer Health Check");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Source: ${source}`);
    console.log();
    console.log("💀 No bootstrap peers configured");
    console.log("Summary: 0 peers available");
    process.exit(3);
  }

  // Display effective source
  const effectiveSource = args.coordinator && cliPeers.length > 0
    ? `${source} + coordinator`
    : args.coordinator
      ? `coordinator (${allPeers.length} peers)`
      : source;

  console.log("🌐 Bootstrap Peer Health Check");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Source: ${effectiveSource}`);
  console.log();

  // Validate each peer
  const results: PeerResult[] = [];

  for (const addr of allPeers) {
    // Validate multiaddr format first
    if (!isValidMultiaddr(addr)) {
      results.push({
        multiaddr: addr,
        status: "invalid",
        latencyMs: null,
        error: "INVALID MULTIADDR",
      });
      continue;
    }

    const parsed = parseMultiaddr(addr);
    if (!parsed) {
      results.push({
        multiaddr: addr,
        status: "invalid",
        latencyMs: null,
        error: "PARSE FAILED",
      });
      continue;
    }

    const result = await tcpCheck(parsed.host, parsed.port, timeoutMs);

    if (result.ok) {
      results.push({
        multiaddr: addr,
        status: "ok",
        latencyMs: result.latencyMs,
      });
    } else if (result.error === "TIMEOUT") {
      results.push({
        multiaddr: addr,
        status: "timeout",
        latencyMs: null,
        error: result.error,
      });
    } else if (result.error === "REFUSED") {
      results.push({
        multiaddr: addr,
        status: "refused",
        latencyMs: null,
        error: result.error,
      });
    } else {
      results.push({
        multiaddr: addr,
        status: "error",
        latencyMs: null,
        error: result.error,
      });
    }
  }

  // Print per-peer results
  for (const r of results) {
    if (r.status === "timeout") {
      console.log(`⚠ ${truncateAddr(r.multiaddr).padEnd(62)}  TIMEOUT (${timeoutMs}ms)`);
    } else {
      console.log(formatStatus(r));
    }
  }

  // Histogram
  const bins = buildHistogram(results);
  console.log();
  console.log("Latency histogram:");
  console.log(renderHistogram(bins));

  // Summary
  const reachable = results.filter((r) => r.status === "ok").length;
  const dead = results.filter((r) => r.status !== "ok");
  const total = results.length;
  const pct = Math.round((reachable / total) * 100);

  console.log();

  if (dead.length > total / 2) {
    console.log(`💀 Dead peers: ${dead.length}/${total} — PRUNE RECOMMENDED`);
  }

  console.log(`Summary: ${reachable}/${total} reachable (${pct}%)`);

  // Pruning suggestion
  if (dead.length > total / 2 && reachable > 0) {
    const livePeers = results
      .filter((r) => r.status === "ok")
      .map((r) => r.multiaddr);
    console.log();
    console.log("Suggested BOOTSTRAP_PEERS:");
    console.log(livePeers.join(","));
  }

  // Exit code
  if (reachable === 0) {
    process.exit(2); // all unreachable
  }

  if (pct < args.threshold) {
    process.exit(1); // majority unreachable or below threshold
  }

  process.exit(0); // all reachable (or above threshold)
}

main();
