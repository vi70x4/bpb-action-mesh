# TODO — Dashboard Repurpose

## Goal

Serving the dashboard from the **coordinator Worker** instead of a standalone Express server.

The Worker already has all the data (proxies, mesh nodes, n2n peers, subscriptions). The Express server only exists to host the static panel HTML and add Socket.IO on top of mock data. By moving the panel into the Worker, we get:

- One fewer service to deploy
- Real data from the coordinator instead of mock data
- True real-time visibility into what the mesh is doing
- A dashboard URL that's just `<coordinator>/` instead of a separate port

## Migration Plan

### Phase 1 — Static Panel → Worker Route

- [ ] Move `src/assets/panel/` → `worker/src/panel/` (just HTML + JS + CSS)
- [ ] In the Worker's `fetch()` handler, add a catch-all route that serves `panel/index.html` for `/` and `/panel/*`
- [ ] If the panel has images/fonts, serve them too from the Worker (inline or KV)
- [ ] Remove the old `src/server.ts` Express server entirely
- [ ] Remove the old `src/index.ts` Express entry point
- [ ] Update `package.json` scripts (remove panel server, keep only node/worker)

### Phase 2 — Replace Mock Data with Real Coordinator API

The current panel JS makes no real API calls (all data is hardcoded in `script.js`). Replace these with calls to the coordinator's real endpoints:

- [ ] Dashboard metrics (`/health`) → real kv/memory status
- [ ] Active proxies (`/proxies`) → real proxy list
- [ ] Mesh status (`/mesh/status`) → real mesh health
- [ ] Node list (`/mesh/snapshot`) → real mesh nodes
- [ ] Subscription URL (`/sub/all`) → real subscription endpoint
- [ ] Proxy details (`/sub/{id}`) → per-proxy subscription

### Phase 3 — Stats Dashboard

Build a proper stats view into the panel using coordinator data:

- [ ] **Proxy table** — id, protocol, host, port, TTL remaining, last heartbeat, network
- [ ] **Mesh node table** — nodeId, networkId, protocol, host, port, expiresAt, heartbeatAt
- [ ] **Protocol breakdown** — pie/bar showing vless vs hysteria2 split (CSS-only, no chart lib)
- [ ] **TTL heatmap** — color-coded proxies about to expire (red = <5min, yellow = <15min)
- [ ] **N2N status** — current n2n community name, supernode, connected peers count
- [ ] **Subscription stats** — total subs served, bandwidth estimate (if logged)
- [ ] **Timeline** — recent registrations / heartbeats / deregistrations

### Phase 4 — Monitoring & Alerts

- [ ] **Dead proxy detector** — heartbeat grace period 90s. If no heartbeat > TTL/2, flag as stale
- [ ] **Dashboard auto-refresh** — poll `/proxies` and `/mesh/status` every 10s
- [ ] **Visual health indicator** — green/yellow/red bar at the top of the panel
- [ ] **Export CSV** — download active proxies as CSV from the dashboard

### Phase 5 — Polish

- [ ] Mobile-responsive layout (the current panel is desktop-only)
- [ ] Dark/light theme toggle (already in panel JS, wire it up)
- [ ] Animations on data change (CSS transitions when proxy count changes)
- [ ] Error state handling (show "coordinator unreachable" banner)
- [ ] Loading skeletons instead of "Loading..." text

## Architecture

```
┌──────────────┐     ┌──────────────────────────────────┐
│   Browser    │────▶│     Cloudflare Worker             │
│  Dashboard   │     │                                  │
│  / → HTML    │     │  GET  /           → panel/index   │
│  /panel/*    │     │  GET  /proxies    → proxy list    │
│              │     │  GET  /mesh/status→ mesh health   │
│              │     │  GET  /health     → kv status     │
│              │     │  POST /register   → auth required │
│              │     │  ... (all existing API routes)    │
└──────────────┘     │                                  │
                     │  KV / Memory Store               │
                     └──────────────────────────────────┘
```

## Files to Touch

| File | Action |
|---|---|
| `worker/src/index.ts` | Add panel route handler |
| `worker/src/panel/index.html` | Move + update (remove Socket.IO refs) |
| `worker/src/panel/script.js` | Rewrite to call coordinator API |
| `worker/wrangler.toml` | Maybe add route for static assets |
| `src/server.ts` | Delete (no longer needed) |
| `src/index.ts` | Delete (Express entry point) |
| `package.json` | Remove `dev`/`build` scripts for Express server |
| `docs/SPEC-V3-ANIMAMESH-BACKEND.md` | Update architecture diagram |

## Out of Scope (for now)

- Real-time WebSocket via Worker — Workers don't support persistent WebSocket in all environments. Polling at 10s is fine for now.
- Authentication for the dashboard — The Worker's auth is for proxy/mesh operations only. The dashboard is public (like `/sub/all`).
- Persistent storage of historical stats — Keep it fire-and-forget in KV with TTL expiry.
