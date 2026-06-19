/**
 * BPB Action Panel - Cloudflare Worker Coordinator
 *
 * This worker acts as a coordinator between GitHub Actions runners
 * and end users. It receives proxy configs from runners and serves
 * Hiddify-compatible subscription URLs.
 */

export interface Env {
  BPB_KV: KVNamespace;
}

// In-memory fallback when KV is not available (for testing)
const memoryStore = new Map<string, string>();

// Helper to check if KV is available
function hasKV(env: Env): boolean {
  return !!env.BPB_KV;
}

// KV wrappers with fallback to in-memory
async function kvPut(
  env: Env,
  key: string,
  value: string,
  options?: KVNamespacePutOptions,
) {
  if (hasKV(env)) {
    return env.BPB_KV.put(key, value, options);
  }
  memoryStore.set(key, value);
  return Promise.resolve();
}

async function kvGet(env: Env, key: string) {
  if (hasKV(env)) {
    return env.BPB_KV.get(key);
  }
  return memoryStore.get(key) || null;
}

async function kvDelete(env: Env, key: string) {
  if (hasKV(env)) {
    return env.BPB_KV.delete(key);
  }
  memoryStore.delete(key);
  return Promise.resolve();
}

async function kvList(env: Env, options: KVNamespaceListOptions) {
  if (hasKV(env)) {
    return env.BPB_KV.list(options);
  }
  // Simple in-memory listing
  const keys = Array.from(memoryStore.keys())
    .filter((k) => k.startsWith(options.prefix || ""))
    .map((name) => ({ name }));
  return { keys, list_complete: true, cursor: undefined } as any;
}

interface ProxyConfig {
  protocol: "vless" | "hysteria2";
  id: string;
  host: string;
  port: number;
  password?: string;
  uuid?: string;
  tls?: boolean;
  sni?: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Generate a VLESS URL for Hiddify
 */
function generateVlessURL(config: ProxyConfig): string {
  const params = new URLSearchParams({
    security: config.tls ? "tls" : "none",
    encryption: "none",
    headerType: "none",
    type: "tcp",
  });

  if (config.sni) {
    params.set("sni", config.sni);
  }

  return `vless://${config.uuid}@${config.host}:${config.port}?${params.toString()}#BPB-Action-${config.id}`;
}

/**
 * Generate a Hysteria2 URL for Hiddify
 */
function generateHysteria2URL(config: ProxyConfig): string {
  const params = new URLSearchParams({
    insecure: "1",
  });

  if (config.sni) {
    params.set("sni", config.sni);
  }

  return `hysteria2://${config.password}@${config.host}:${config.port}?${params.toString()}#BPB-Action-${config.id}`;
}

/**
 * Generate subscription content in Hiddify format
 */
function generateSubscription(configs: ProxyConfig[]): string {
  return configs
    .map((config) => {
      if (config.protocol === "vless") {
        return generateVlessURL(config);
      } else if (config.protocol === "hysteria2") {
        return generateHysteria2URL(config);
      }
      return "";
    })
    .filter((url) => url.length > 0)
    .join("\n");
}

/**
 * Generate demo proxy configs
 */
function generateDemoConfigs(): ProxyConfig[] {
  return [
    {
      protocol: "vless",
      id: "demo-1",
      host: "bpb-action-demo.example.com",
      port: 443,
      uuid: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      tls: true,
      sni: "bpb-action-demo.example.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      protocol: "hysteria2",
      id: "demo-2",
      host: "bpb-action-demo.example.com",
      port: 443,
      password: "supersecurepassword123",
      tls: true,
      sni: "bpb-action-demo.example.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", service: "BPB Action Coordinator" }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // Register proxy config from GitHub Actions
      if (path === "/register" && request.method === "POST") {
        const data = (await request.json()) as ProxyConfig;

        // Validate required fields
        if (!data.id || !data.host || !data.port) {
          return new Response(
            JSON.stringify({ error: "Missing required fields" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        // Store in KV with 24h expiration
        await kvPut(env, `proxy:${data.id}`, JSON.stringify(data), {
          expirationTtl: 86400,
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Proxy registered",
            subscriptionUrl: `${url.origin}/sub/${data.id}`,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // Get subscription for a specific proxy
      if (path.startsWith("/sub/")) {
        const id = path.replace("/sub/", "");

        if (id === "all") {
          // Get all active proxies
          const list = await kvList(env, { prefix: "proxy:" });
          const configs: ProxyConfig[] = [];

          for (const key of list.keys) {
            const data = await kvGet(env, key.name);
            if (data) {
              configs.push(JSON.parse(data));
            }
          }

          const subscription = generateSubscription(configs);

          return new Response(subscription, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...corsHeaders,
            },
          });
        }

        // Get specific proxy
        const data = await kvGet(env, `proxy:${id}`);

        if (!data) {
          return new Response(JSON.stringify({ error: "Proxy not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const config: ProxyConfig = JSON.parse(data);
        const subscription = generateSubscription([config]);

        return new Response(subscription, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...corsHeaders,
          },
        });
      }

      // Get all active proxies info
      if (path === "/proxies") {
        const list = await kvList(env, { prefix: "proxy:" });
        const proxies = [];

        for (const key of list.keys) {
          const data = await kvGet(env, key.name);
          if (data) {
            const config: ProxyConfig = JSON.parse(data);
            proxies.push({
              id: config.id,
              protocol: config.protocol,
              host: config.host,
              port: config.port,
              createdAt: config.createdAt,
              expiresAt: config.expiresAt,
            });
          }
        }

        return new Response(JSON.stringify(proxies), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // Delete proxy
      if (path.startsWith("/delete/") && request.method === "DELETE") {
        const id = path.replace("/delete/", "");
        await kvDelete(env, `proxy:${id}`);

        return new Response(
          JSON.stringify({ success: true, message: "Proxy deleted" }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // Default: return API info
      return new Response(
        JSON.stringify({
          name: "BPB Action Coordinator",
          version: "1.0.0",
          endpoints: {
            "POST /register": "Register a new proxy config",
            "GET /sub/{id}": "Get subscription for specific proxy",
            "GET /sub/all": "Get subscription for all proxies",
            "GET /proxies": "List all active proxies",
            "DELETE /delete/{id}": "Delete a proxy",
            "GET /health": "Health check",
          },
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    } catch (error) {
      console.error("Error:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
};
