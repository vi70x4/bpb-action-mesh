# 🧠 Consillium Brainstorm Prompt

**Status:** COMPLETED — All 4 AIs have voted. Results synthesized into SPEC v0.3.

**Original instructions:** Copy this prompt into ChatGPT, Claude, and Gemini Pro separately. Collect all answers, then synthesize.

**Outcome:** ChatGPT, Sonnet 4.5, and Gemini Pro all voted. DeepSeek (Chinese LLM) provided an additional independent review with 7 questions (including Q7: Node Defection, missed by the others). All decisions are now recorded in `docs/SPEC-V2-MESH.md` §8.

---

**Below is the original prompt preserved for historical reference.**

---

You are part of a 3-AI consillium (ChatGPT, Claude, Gemini Pro) reviewing an architectural specification for **BPB Mesh v2** — a pure science experiment in decentralized ephemeral proxy meshes. This is research, not production software. Think boldly.

## What We're Building

We're evolving a GitHub Actions-based proxy system from a centralized architecture (v1) to a fully decentralized mesh (v2). The core idea:

**Nodes run VLESS/Hysteria2 proxy servers inside GitHub Actions runners. They discover each other via libp2p Kademlia DHT (like BitTorrent finds peers). Actual proxy traffic flows on VLESS/Hy2 directly — libp2p is ONLY for discovery, never in the data path. Nodes live 15-60 minutes (random TTL), then die and trigger a fresh runner via git push or GitHub API. A Cloudflare Worker coordinator exists as an optional "tracker" (like in BitTorrent) — helpful but not required.**

Think of it as: **BitTorrent Sync meets VLESS, running on ephemeral CI infrastructure.**

## v1 Architecture (Current — Centralized)

```
Client → CF Worker (coordinator, /sub/all) → single GHA runner → trycloudflare tunnel
```

Problems: coordinator is SPOF, only 1 runner at a time, manual respawn, if coordinator dies everything breaks.

## v2 Architecture (Target — Decentralized)

```
Client → [DHT resolver OR coordinator] → multiple GHA runners → trycloudflare tunnels
         DHT for peer discovery only               VLESS/Hy2 for actual traffic
```

## Your Task

Read the specification at `docs/SPEC-V2-MESH.md` (I'll paste it below). Then answer these **6 open questions** with your strongest opinion + reasoning + any alternatives I haven't considered:

### Q1: DHT Bootstrap — Chicken & Egg

All nodes are ephemeral (15-60 min TTL). When a brand-new node boots, how does it find existing peers? Options on the table:
- A) Coordinator as permanent bootstrap node
- B) Persist last-known peer addresses in git repo (but they're dead after TTL)
- C) Public libp2p DHT bootstrap nodes (`bootstrap.libp2p.io`)
- D) Coordinator-as-DNS (DNS TXT record lookup)
- E) GossipSub — nodes subscribe to a pubsub topic, new nodes listen for announcements

**What's the right balance of decentralization vs reliability?**

### Q2: Client-Side DHT — How Thin Can We Go?

For Hiddify/v2rayNG clients to resolve proxies directly from DHT without a coordinator:
- A) Full libp2p node in client (pure P2P but heavy)
- B) HTTP-to-DHT gateway (thin API)
- C) IPNS records resolved via public IPFS gateways
- D) WASM-compiled libp2p in browser
- E) Give up — always use coordinator or gateway

**What's the lightest viable client experience?**

### Q3: Multi-Hop Relay (Tor-like) — YAGNI or Future-Proof?

Client → Node A (entry) → Node B (relay) → Node C (exit) → Internet. No single node sees both client IP and destination.
- A) Skip — single-hop VLESS + CF tunnel is enough
- B) Design for it now, implement single-hop first
- C) Implement 2-hop immediately
- D) Use libp2p circuit relay (but then libp2p IS in data path)

**Is multi-hop worth the complexity, or is CF tunnel + ephemeral nodes sufficient?**

### Q4: Respawn Race Condition

When a dying node triggers a new runner, there's a 30-120s gap. Old node still in DHT but might be dead. New node hasn't announced yet.
- A) Accept the gap — staggered TTLs cover it
- B) Handoff — old node stays alive until new node confirms DHT announce
- C) Proactive overspawn — always 1 extra hot standby
- D) Coordinator-assisted heartbeats

**How do we guarantee mesh continuity?**

### Q5: Network Identity — How to Share the Mesh

Nodes need a shared `network-id` to find each other on DHT. How does a user "join"?
- A) Repo secrets (one mesh per repo)
- B) Derive from repo URL (fork = same mesh)
- C) Invitation codes (signed by coordinator)
- D) Public mesh by default (global DHT, filter by protocol/region)

**What's the right trust boundary?**

### Q6: The trycloudflare Dependency

The free tunnel is rate-limited, no SLA. It's still a SPOF in v2.
- A) Accept — it's free and works 90% of the time
- B) Multi-provider tunnel (CF, ngrok, bore, localhost.run) with auto-fallback
- C) Self-hosted relay VPS
- D) libp2p circuit relay as tunnel substitute (but libp2p in data path)
- E) Remove tunnel entirely — libp2p circuit relay for NAT traversal

**How critical is the tunnel SPOF?**

---

## The Full Specification

[PASTE THE CONTENT OF docs/SPEC-V2-MESH.md HERE]

---

## Output Format

For each question, respond with:

1. **Your pick** (letter + name)
2. **Why** (2-3 sentences of reasoning)
3. **Alternative I haven't considered** (1 idea that's not in the options above)
4. **Confidence** (high/medium/low)

Be opinionated. Don't hedge. We have 3 AIs voting — the interesting stuff happens at the disagreements.

---

*After all three responses are collected, we'll synthesize a final design decision on each question based on majority vote + reasoning quality.*
