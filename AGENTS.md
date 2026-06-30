# BPB Action Mesh

> **Agent Readiness:** This file contains two kinds of guidance:
> - **Universal rules** — project structure, branching, architecture, and security patterns that apply regardless of what tooling you have.
> - **Workflow recommendations** — tool-specific tips that are helpful when the relevant tools are available, but not required to complete tasks. Use whatever tools you have access to.

Decentralized mesh of ephemeral proxy nodes (VLESS/Hysteria2) on GitHub Actions runners, discovered via libp2p Kademlia DHT. Research experiment — not production.

## Structure

```
src/        Express + Socket.IO dashboard (server.ts, assets/panel/)
node/       libp2p DHT mesh node — discovery + lifecycle
worker/     Cloudflare Worker coordinator — register, heartbeat, subscription
scripts/    CLI: proxy-up.sh, animamesh-connect.sh, proxy-down.sh, proxy-status.sh
.github/    proxy.yml (GHA runner), panel.yml (build/deploy dashboard)
docs/       SPEC-V2-MESH.md, SPEC-V3-ANIMAMESH-BACKEND.md, ANIMAMESH-CLIENT.md
```

## Commands

| Action | Command |
|---|---|
| Dev dashboard | `npm run dev` |
| Dev mesh node | `cd node && npm run dev` |
| Dev coordinator | `cd worker && npm run dev` |
| Build all | `npm run build` |
| Build panel | `npm run build:panel` |
| Test | `npm test` (no-op stub) |
| Lint | `npm run lint` |
| Launch proxy | `./scripts/proxy-up.sh --protocol hysteria2` |
| Deploy coordinator | `cd worker && npm run deploy` |
| P2P connect | `./scripts/animamesh-connect.sh --coordinator URL --auth-token TOKEN` |

## Agent SOP — The Delegate-Verify Loop

This is the critical workflow for any code-change task. **Follow it every time.**

### Step 1: Analyze & Plan

Use structured exploration tools (if available) to understand the codebase before planning changes:

1. Start by exploring the codebase — identify the relevant symbols/files for your task. (If you have a code-indexing or symbol-search tool, use it here instead of brute-reading full files.)
2. Assess blast radius — understand what depends on the symbols you're about to change. Check both direct and transitive dependents.
3. Map module boundaries — know what crosses package boundaries. This repo crosses three packages (root, `node/`, `worker/` with different module systems).

Break into smallest incremental steps. Delegate one step at a time.

### Step 2: Delegate ONE Step (If Sub-Agent Tool Is Available)

When delegating to a sub-agent, every prompt must include:

1. **Repo identifier** — the repo/project name so the sub-agent knows where it's working
2. **Code-tool mandate:** instruct the sub-agent to use structured code-lookup tools (if available) instead of reading full files
3. **Target symbols/files:** exact symbols the sub-agent needs to read or modify
4. **All required context:** the sub-agent is stateless — include everything it needs to complete the task
5. **Token budget:** if your delegation tool supports token caps, set a reasonable limit to keep context focused

Example delegation preamble (adapt to your available tooling):

```
Repo: bpb-action
Use structured lookup for all code exploration — avoid reading full files.
Target symbols: <list symbol_ids>
Include all context the sub-agent needs.
```

Delegate only the immediate next step. Never bundle multiple steps. If work can be parallelized across disjoint files, instruct the sub-agent to fan out.

**Recursive safety:** If you are the spawned sub-agent, do your designated job directly. Do not recursively spawn further sub-agents unless explicitly instructed to "fan out."

### Step 3: ❗ Verify the Result (CRITICAL)

**Never trust a sub-agent's report.** Sub-agents frequently claim success while leaving code unmodified. After every delegated task:

1. **Read the actual file** — use `grep` / `read_file` to confirm the expected code is present. Do not rely on cached or pre-indexed reads.
2. Check blast radius — confirm impact matches expectations by tracing importers and callers of changed symbols.
3. Verify no call site is broken — check references to changed symbols across the project.
4. Re-index or invalidate caches if your tooling requires it after edits.
5. Run tests: `npm test` (currently a no-op stub, but check anyway).

□ **Before committing:** Did I verify with grep that all expected code is actually in the files?

### Step 4: Iterate

- **Approved:** Move to next step (return to Step 2).
- **Revision needed:** Re-delegate with corrective feedback. Instruct the sub-agent to read the current state before editing. **Do not fix code yourself** — delegate the fix so the sub-agent builds correct context.

**Lesson learned — sub-agent false-positive:** A sub-agent for a code-restructuring task reported "all changes applied successfully" but the target file was never modified — only unrelated comments were touched. The missing function body was discovered when verifying by reading the source with `grep`. Always verify the actual output — not just the sub-agent's summary.

## Git Rules

| Rule | Detail |
|---|---|
| Default branch | `main` — push triggers proxy workflow via GHA |
| Layout | Monorepo: root `package.json` owns dashboard; `node/` and `worker/` have own packages |
| Sync | `proxy.yml` runs on `ubuntu-latest`, 45-min timeout; DHT node step is commented out — do not re-enable |

Emergency recovery: push to main or `workflow_dispatch` → `proxy-up.sh` → `curl $COORDINATOR_URL/health` → `proxy-down.sh` to cancel stuck runs.

## Testing Rules

- `npm test` exits 0 (no tests yet)
- When adding tests: place adjacent to source (e.g. `node/src/lifecycle.test.ts`), use same module system as the source package, update the relevant `package.json` test script
- `panel.yml` has `continue-on-error: true` on deploy/release — failures are silently ignored

## Architecture Landmines

| Constraint | Why it matters |
|---|---|
| **DHT is discovery-only** | Never route proxy traffic through libp2p — unanimous consillium agreement |
| **Coordinator is optional** | Every feature must work DHT-only — graceful degradation |
| **No serial multi-hop** | `route: []` was killed by consillium — parallel multiplexing is the resilience model |
| **Ephemeral by design** | Nodes live 15-60 min, no persistent state, identity is per-lifecycle PeerId |
| **Stagger, don't sync** | Random TTLs, jittered announces — no herd behavior |
| **DHT key schema** | `/bpb/v2/{network-id}/{protocol}/{peer-id}` — changing it requires updating both `node/announce.ts` and the spec |
| **Module system mismatch** | Root tsconfig = CommonJS, `node/tsconfig.json` = ES2022 — never mix import styles across packages |
| **`/sub/all` format** | Consumed by Hiddify/v2ray clients — any output change breaks existing subscriptions |

Coordinator API to preserve:

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/register` | POST | Bearer | Runner registers proxy config |
| `/heartbeat` | POST | Bearer | Runner refreshes TTL |
| `/sub/all` | GET | None | Hiddify subscription (all proxies) |
| `/sub/{id}` | GET | None | Single proxy subscription |
| `/proxies` | GET | None | JSON list of active proxies |
| `/delete/{id}` | DELETE | Bearer | Remove a proxy record |
| `/health` | GET | None | Service health check |

## Fleet Architecture — Multi-Account Matrix

Animamesh operates across a fleet of throwaway GitHub accounts to distribute proxy runners, avoid rate limits, and reduce the blast radius of any single account being suspended. Each account is self-contained but shares a single coordinator.

### Account Naming & Scope

Accounts follow the pattern `vi70x5` through `vi70x20` (16 accounts total). Each account has:

| Resource | Example | Details |
|---|---|---|
| **GitHub account** | `vi70x5` | Throwaway account with `repo` + `workflow` scopes |
| **Fork repo** | `vi70x5/retry-queue` | Fresh standalone repo (NOT a fork). Only obfuscated workflow + innocent README, zero parent relationship |
| **Cloudflare account** | Same as GH (e.g. `vi70x5`) | Optional — for permanent tunnel domains (`tun.vi70x5.qzz.io`). 2 domains per account via CF partner |
| **Coordinator** | Shared — `bpb-action-coordinator.vi70x3.workers.dev` | One Worker for the whole fleet. Multiple GH accounts deploy runners, all register on the same coordinator |

### Storage Layout

```
~/.animamesh/
├── gh/token                     # Default GitHub token (current active account)
├── fleet.env                    # Shared fleet config (COORDINATOR_URL, AUTH_TOKEN, NETWORK_ID, n2n vars)
├── accounts/
│   ├── vi70x5/
│   │   ├── token                # GitHub PAT (raw string, chmod 600)
│   │   ├── cf_token             # Cloudflare API token (raw string, chmod 600) — optional
│   │   ├── cf_account_id        # Cloudflare account ID — optional, for Worker deployment
│   │   ├── gh/                  # Per-account gh CLI config dir
│   │   │   └── hosts.yml        # gh auth state (oauth_token inside)
│   │   └── repo/                # Local clone of the minimal repo (workflow + fake source)
│   ├── vi70x6/
│   │   ├── token
│   │   ├── cf_token
│   │   ├── cf_account_id
│   │   └── gh/hosts.yml
│   └── ...
├── repos/                       # Fleet metadata (renamed from forks/)
│   ├── vi70x5.meta              # repo_name=retry-queue, gh_user=vi70x5
│   └── vi70x6.meta
└── .gitignore                   # Prevents accidental commit of tokens
```

### Credential Security

| Practice | Why |
|---|---|
| **All token files are `chmod 600`** | Prevents other users on the machine from reading PATs and CF tokens. The fleet script sets this automatically on `add` |
| **`~/.animamesh/` has its own `.gitignore`** | Contains `*token*`, `*secret*`, `fleet.env`, `hosts.yml` — ensures tokens are never accidentally committed even if `~/.animamesh` is inside a git repo |
| **No tokens in source code** | `COORDINATOR_URL`, `AUTH_TOKEN`, `NETWORK_ID` → GitHub Actions secrets only. Never in source, never in `wrangler.toml` |
| **`http.extraHeader` for git push** | The fleet script uses `git config http.extraHeader` instead of embedding tokens in remote URLs. If the script crashes, the extraHeader is cleaned up on next run. No token persists in `.git/config` |
| **Per-account isolation** | Each account stores its own GH + CF tokens in separate subdirectories. Compromising one account's directory doesn't expose others |
| **`fleet.env` is the shared config** | Contains `COORDINATOR_URL`, `AUTH_TOKEN`, `N2N_*` — these are fleet-wide, not per-account. Read by `deploy` and `init-secrets` commands |

### How Fleet Management Works

#### Adding an Account (`animamesh-fleet.sh add <token>`)

1. **Auth capture** — Stores the PAT in `~/.animamesh/accounts/<name>/token` (chmod 600) and runs `gh auth login --with-token` into a per-account `GH_CONFIG_DIR`
2. **Cloudflare capture** — Optionally stores CF API token in `~/.animamesh/accounts/<name>/cf_token` and account ID in `cf_account_id` (both chmod 600). Used for permanent tunnel deployment and Worker deployment
3. **Fresh repo creation** — Creates a brand new standalone repo via `gh repo create` (NOT a fork — no fork network, no visible link to animamesh)
4. **Minimal content** — Only two files go into the repo:
   - `.github/workflows/proxy.yml` — obfuscated workflow (step names renamed to generic CI terms, all revealing comments stripped)
   - `README.md` — describes it as a CI pipeline config repo (static template or LLM-generated)
5. **2-commit push** — Commit 1: "Initial commit" (README + .gitignore). Commit 2: "Add CI workflow" (workflow file). Looks like organic development.
6. **Meta tracking** — Records `repo_name` and `gh_user` in `~/.animamesh/repos/<name>.meta` for self-contained re-runs

#### Deploying Proxy Runners (`animamesh-fleet.sh deploy`)

1. Reads the repo name and account name from `.meta` files
2. Sets required secrets on the repo via `gh secret set` with explicit `GH_TOKEN` injection:
   - `COORDINATOR_URL` — Worker URL (shared across fleet)
   - `AUTH_TOKEN` — Worker auth token (shared across fleet)
   - `VLESS_UUID` / `HY2_PASSWORD` — per-account, random, generated
   - `CLOUDFLARE_API_TOKEN` — optional, for named tunnel mode
3. Calls `gh workflow run proxy.yml` with `--field protocol=<...> --field tunnel=<...>`, using `--repo <gh_user>/<fork_name>` targeting syntax

#### Fleet Coordination (the Shared Coordinator Model)

```
                          ┌──────────────────────┐
                          │  Cloudflare Worker    │
                          │  vi70x3 account       │
                          │  (single coordinator) │
                          │                      │
                          │  KV: proxies, config │
                          └──────┬───────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │ vi70x5 fork  │      │ vi70x6 fork  │      │ vi70x7 fork  │
   │ retry-queue  │      │ cloud-sync   │      │ data-pipe    │
   │ (run 1)      │      │ (run 1)      │      │ (run 1)      │
   │ (run 2)      │      │ (run 2)      │      │ ...          │
   └──────┬───────┘      └──────┬───────┘      └──────┬───────┘
          │ POST /register      │ POST /register      │ POST /register
          │ heartbeat           │ heartbeat           │ heartbeat
          ▼                      ▼                      ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Coordinator KV (shared pool)                │
   │  gha-28171: {host, port, protocol, tunnel, expiresAt}   │
   │  gha-28172: {host, port, protocol, tunnel, expiresAt}   │
   │  gha-28173: {host, port, protocol, tunnel, expiresAt}   │
   └─────────────────────────────────────────────────────────┘
                                      │
                                      │ GET /sub/all, /proxies
                                      ▼
                             ┌──────────────────┐
                             │  End user client  │
                             │  (Hiddify, curl)  │
                             └──────────────────┘
```

### Repo Obfuscation Strategy

Since throwaway GitHub accounts are used, the repos must look completely unrelated to Animamesh. Each repo is created from scratch with NO fork relationship:

1. **Repo name** — Random descriptive name: `ci-config`, `build-workflows`, `task-runner`, `batch-process`, `retry-queue`, `job-scheduler`, `config-manager`, etc.
2. **README** — Describes a CI pipeline config repo. LLM-generated if available, else static template. Zero mention of proxy, VPN, mesh, or tunnels.
3. **Workflow** — Renamed to `CI Pipeline` with generic step names: `Install dependencies`, `Setup runtime`, `Start service`, `Setup tunnel`, `Register with registry`
4. **Description** — "Automated build and test pipeline"
5. **Topics** — `ci`, `automation`
6. **No fork network** — Repo is created via `gh repo create`, NOT `gh repo fork`. No "forked from animamesh/backend" badge.
7. **Minimal footprint** — Only `.github/workflows/proxy.yml`, `README.md`, fake TypeScript source files, and build config exist. No real source code, no specs, no scripts.

### Cloudflare Account Integration (Planned)

Each GitHub account (`vi70x5`–`vi70x20`) can optionally have a paired Cloudflare account for permanent tunnel domains:

- 2 domains per CF account, provisioned via Cloudflare Partner
- Named tunnels: `mesh-tun-1` → `tun.<gh_user>.qzz.io`, `mesh-tun-2` → `tun.<gh_user>.dpdns.org`
- Credentials stored as `CLOUDFLARE_TUNNEL_CREDS` secret (base64-encoded JSON) on each repo
- `proxy.yml` switches from trycloudflare random subdomain to named tunnel when creds are present
- CF tokens stored locally in `~/.animamesh/accounts/<name>/cf_token` for programmatic tunnel/DNS management
- Single coordinator Worker (deployed under `vi70x3` account) remains unchanged — Cloudflare accounts are only for tunnel DNS, not for the coordinator

### Authentication Matrix

| Secret | Scope | Where stored | Rotated |
|---|---|---|---|
| GitHub PAT | Per-account | `~/.animamesh/accounts/<name>/token` (chmod 600) + `gh/hosts.yml` | Per-session |
| CF API Token | Per-account | `~/.animamesh/accounts/<name>/cf_token` (chmod 600) | If leaked |
| CF Account ID | Per-account | `~/.animamesh/accounts/<name>/cf_account_id` | Rarely |
| COORDINATOR_URL | Fleet-wide | `~/.animamesh/fleet.env` + GH Actions secret on every repo | Rarely |
| AUTH_TOKEN | Fleet-wide | `~/.animamesh/fleet.env` + GH Actions secret on every repo | If leaked |
| N2N_COMMUNITY | Fleet-wide | `~/.animamesh/fleet.env` + GH Actions secret on every repo | Per-deployment |
| N2N_KEY | Fleet-wide | `~/.animamesh/fleet.env` + GH Actions secret on every repo | Per-deployment |
| CLOUDFLARE_API_TOKEN | Per-account | GH Actions secret on repo | If leaked |
| CLOUDFLARE_TUNNEL_CREDS | Per-account | GH Actions secret on repo | If leaked |
| VLESS_UUID / HY2_PASSWORD | Per-run | Generated in workflow, posted to coordinator | Every run |

### Operational Notes

- **One coordinator to rule them all** — All runners, regardless of which GH account they ran under, register on the same Worker. This is safe because the Worker is control-plane only (never in the data path) and the AUTH_TOKEN gates write operations.
- **Account suspension ≠ fleet loss** — If `vi70x5` is suspended, the other 15 accounts keep running. Only the coordinator stays up (deployed under `vi70x3`, a separate account).
- **Rate limit distribution** — GitHub API has 5000 req/hr per account. Spreading across 16 accounts gives ~80k req/hr aggregate for workflow dispatches and secret management.
- **No cross-account contamination** — Each repo has its own secrets. There is no shared KV or cross-account token that could compromise the fleet if a single account is breached.
- **`GH_CONFIG_DIR` caveat** — The `gh` CLI stores auth per-account in `~/.animamesh/accounts/<name>/gh/`. However, `git push` via `GH_CONFIG_DIR` silently fails on some repos. The fleet script works around this by using `git config http.extraHeader` for stateless auth (safer than embedding tokens in remote URLs).

## Credential Rules

- `COORDINATOR_URL`, `AUTH_TOKEN`, `NETWORK_ID` → stored in `~/.animamesh/fleet.env` locally, GitHub Actions secrets on repos, never in source
- Worker `AUTH_TOKEN` set via `wrangler secret put AUTH_TOKEN` — if absent, worker allows all requests (dev mode)
- `wrangler.toml` KV namespace id is a placeholder — replace after `wrangler kv:namespace create BPB_KV`, don't commit real ids
- All token files under `~/.animamesh/accounts/` are `chmod 600` — set automatically by fleet script
- `~/.animamesh/.gitignore` excludes `*token*`, `*secret*`, `fleet.env`, `hosts.yml` — prevents accidental credential leaks
- CF tokens (`cf_token`, `cf_account_id`) are optional — only needed for permanent tunnel domains or Worker deployment

## Further Reference

- `docs/SPEC-V2-MESH.md` — Full architecture (DHT topology, lifecycle, threat model, consillium decisions)
- `docs/SPEC-V3-ANIMAMESH-BACKEND.md` — V3 architecture (n2n P2P overlay, coordinator, signing)
- `docs/ANIMAMESH-CLIENT.md` — n2n P2P Linux client documentation
- `README.md` — Quick start, threat model, FAQ, roadmap

## jcodemunch

Repo: `animamesh/backend` (indexed). Symbol ID: `{file_path}::{qualified_name}#{kind}`

### Session start
- `resolve_repo(path=".")` — **always first call** — confirm repo is indexed. If not: `index_folder(path=".")`

### Core lookup
- `assemble_task_context(repo="animamesh/backend", task="...")` — opening move; auto-classifies intent (explore/debug/refactor/extend/audit/review), surfaces symbols + ranked context
- `get_file_outline` → `get_symbol_source` / `get_context_bundle(symbol_ids=[...])` — targeted retrieval, never full files
- `search_symbols(repo="animamesh/backend", query="...")` — find by name, signature, summary
  - `mode="context"` — query-less ranked context assembly
  - `mode="winnow"` — multi-axis constraint filter (kind, language, complexity, churn, etc.)
  - `semantic=true` — embedding-based search (requires embed provider)
  - `detail_level="compact"` — 15 tokens/row (broad discovery); `"standard"` (default); `"full"` (inline source)
  - `fusion=true` — Weighted Reciprocal Rank across lexical/structural/similarity/identity channels; best for vague queries
- `search_text(repo="animamesh/backend", query="...")` — full-text search across file contents (string literals, comments, configs)
- `search_ast(repo="animamesh/backend", pattern="..." | category="...")` — structural anti-pattern scan (empty_catch, god_function, hardcoded_secret, etc.)

### Impact & safety
- `get_blast_radius(symbol="...", include_source=true)` — check impact before changes. Key params: `call_depth` (0–3, find callers), `include_decisions=true` (surfaces commit intent), `source_budget`
- `find_references(mode="refs"|"importers"|"related", quick=true|false)` — trace who uses a symbol. `quick=true` returns lightweight `{is_referenced, import_count}` for dead-code checks
- `get_call_hierarchy(symbol_id="...", direction="both", depth=3)` — trace call graph. Key params: `chains=true` (discover HTTP/CLI/event signal chains), `kind` (http/cli/event/task/main/test), `max_depth` (1–8), `include_impact=true`
- `check_safe(repo="animamesh/backend", symbol="...", mode="edit"|"delete")` — composite preflight: can this symbol be safely edited/deleted?
- `plan_refactoring(repo="animamesh/backend", symbol="...", refactor_type="rename"|"move"|"extract"|"signature")` — generate multi-file edit plan before refactoring
- `get_changed_symbols(repo="animamesh/backend")` — map git diff to affected symbols
- `get_pr_risk_profile(repo="animamesh/backend")` — unified risk assessment for a PR/branch

### Repository intelligence
- `get_repo_health(repo="animamesh/backend")` — one-call triage (dead code %, complexity, hotspots, cycle count)
- `get_repo_map(repo="animamesh/backend")` — signature-level overview ranked by PageRank (cold-start orientation). `mode="outline"` for lightweight directory/language/symbol count overview
- `get_tectonic_map(repo="animamesh/backend")` — logical module topology (hidden boundaries, misplaced files, drifters)
- `find_hot_paths(repo="animamesh/backend")` — top-N symbols by runtime hit count (requires ingested traces)
- `get_dead_code_v2(repo="animamesh/backend", min_confidence=0.67)` — multi-signal dead code detection
- `find_similar_symbols(repo="animamesh/backend")` — cluster similar functions/methods (consolidation candidates)
- `get_symbol_provenance(repo="animamesh/backend", symbol="...")` — git authorship lineage & evolution narrative
- `get_symbol_complexity(repo="animamesh/backend", symbol_id="...")` — cyclomatic complexity, nesting, params
- `get_class_hierarchy(repo="animamesh/backend", class_name="...")` — inheritance ancestors + descendants
- `find_implementations(repo="animamesh/backend", symbol="...")` — find concrete impls of an interface/abstract
- `get_project_intel(repo="animamesh/backend")` — auto-discover Dockerfiles, CI configs, deps, APIs
- `list_workspaces(repo="animamesh/backend")` — enumerate monorepo workspace members
- `search_columns(repo="animamesh/backend", query="...")` — search column metadata across indexed models

### Runtime & indexing
- `import_runtime_signal(repo="animamesh/backend", path="...", source="otel"|"sql_log"|"stack_log")` — ingest runtime traces
- `embed_repo(repo="animamesh/backend")` — precompute symbol embeddings for semantic search. `force=true` to recompute all, `batch_size=50` (default)
- `summarize_repo(repo="animamesh/backend", force=true)` — re-run AI summarization pipeline
- `index_file(path="...")` — surgical single-file reindex after edits
- `index_folder(path="...")` / `index_repo(url="...")` — full index/reindex
- `register_edit(repo="animamesh/backend", file_paths=[...], reindex=true)` — invalidate caches after file edits

### Power User Guide

#### Code Exploration Policy

**Always use jcodemunch-MCP tools for code navigation.** Never fall back to `read_file`, `grep`, `find_path`, or shell for code exploration — they waste tokens and miss structural context.

**Exception:** Use `read_file` when you need to **edit** a file (to get exact line content for the edit tool). Even then, read only the target section, never the full file.

#### Session-Aware Routing (confidence + negative evidence)

Every tool response includes `_meta.confidence` and `_meta.freshness`. Route your behavior by confidence tier:

| Confidence | Action | Max supplementary reads |
|---|---|---|
| `high` (≥ 0.8) | Act directly on the result | 2 |
| `medium` (0.4–0.79) | Explore recommended files to validate | 5 |
| `low` (< 0.4) | Report the gap — don't keep searching | 0 |

**Negative evidence rule:** If a search returns `verdict: "no_implementation_found"` — **stop.** Do not re-search with different terms, broader queries, or fallback tools. Report the absence to the user; let them decide whether the thing should exist.

#### Interpreting Search Results

| `_meta` field | Meaning | Action |
|---|---|---|
| `confidence < 0.4` | Weak result — likely noise | Widen search or report gap, don't proceed as-is |
| `freshness: stale` / `repo_is_stale: true` | Index may not reflect current HEAD | Run `index_file` / `index_folder` before trusting the result |
| `verdict: "no_implementation_found"` | Confirmed absence | Stop searching — report to user |
| `tokens_remaining` ≈ 0 | Budget exhausted | Narrow query or increase `token_budget` |

#### After Editing Files

**Always** call `register_edit(repo="animamesh/backend", file_paths=[...], reindex=true)` after modifying any indexed file. This invalidates stale BM25/search caches so subsequent tool calls in the same session return fresh results. Without it, later searches may return outdated data or miss your changes entirely.

#### Golden Rules
1. **Always start with `resolve_repo` then `assemble_task_context`** — `resolve_repo` confirms the index exists; `assemble_task_context` auto-classifies intent and returns ranked symbols + context in one call. Never manually hunt for entry points.
2. **Batch everything** — use `symbol_ids[]` in `get_context_bundle`, `get_symbol_source`, `search_symbols` instead of serial calls. Token budget is your friend.
3. **Verify with `verify=true` / `verify_against="git_sha"`** — catches index drift vs. working tree.
4. **Use `mode` switches** on `search_symbols`: `context` for query-less ranked context, `winnow` for multi-axis filters, `semantic=true` for embedding search.
5. **Prefer `get_context_bundle` over raw file reads** — deduplicates imports, respects token budget, returns ready-to-use context.
6. **Check `_meta.confidence` before acting** — low confidence means widen the search or report a gap, not proceed as-is.

#### Common Workflows

##### 1. Cold-start orientation (new repo / unfamiliar area)
```
resolve_repo(path=".")                                                      # Confirm repo is indexed
get_repo_map(repo="animamesh/backend", group_by="flat", top_n=30)     # Top symbols by PageRank
get_tectonic_map(repo="animamesh/backend")                               # Logical module boundaries
get_repo_health(repo="animamesh/backend", detailed=true)                 # Dead code %, complexity, cycles
```

##### 2. Feature exploration — "How does X work?"
```
assemble_task_context(repo="animamesh/backend", task="How does X work?")
# → returns ranked symbols + context
get_context_bundle(symbol_ids=[...], budget_strategy="core_first")
```

##### 3. Refactoring safety (rename/move/extract)
```
check_safe(repo="animamesh/backend", symbol="SymbolName", mode="edit")
plan_refactoring(repo="animamesh/backend", symbol="SymbolName", refactor_type="rename", new_name="newName")
get_blast_radius(symbol="SymbolName", depth=2, include_source=true)
```

##### 4. Dead code cleanup
```
get_dead_code_v2(repo="animamesh/backend", min_confidence=0.67, file_pattern="src/**")
find_similar_symbols(repo="animamesh/backend", threshold=0.85, include_kinds=["function", "method"])
```

##### 5. Performance hotspot triage
```
find_hot_paths(repo="animamesh/backend", top_n=20)
get_repo_health(repo="animamesh/backend", detailed=true, top_n=30)
get_symbol_complexity(repo="animamesh/backend", symbol_id="...")
```

##### 6. PR / change risk assessment
```
get_changed_symbols(repo="animamesh/backend", include_blast_radius=true, max_blast_depth=3)
get_pr_risk_profile(repo="animamesh/backend", base_ref="main", head_ref="HEAD")
```

##### 7. Understanding unfamiliar code before modifying
```
get_symbol_provenance(repo="animamesh/backend", symbol="SymbolName", max_commits=30)
get_call_hierarchy(symbol_id="...", direction="both", depth=3, include_impact=true)
find_implementations(repo="animamesh/backend", symbol="InterfaceName", include_subclasses=true)
```

##### 8. Finding config / string literals / comments (not symbols)
```
search_text(repo="animamesh/backend", query="MAX_RETRIES", context_lines=3)
search_ast(repo="animamesh/backend", category="security")              # hardcoded_secret, eval_exec
search_ast(repo="animamesh/backend", pattern="string:/password/i")      # custom pattern
```

#### Parameter Cheatsheet

| Tool | Key params | When to use |
|---|---|---|
| `assemble_task_context` | `task`, `token_budget`, `symbols[]` | **First call for any task** — returns intent, symbols, context |
| `resolve_repo` | `path` | **Session start** — confirm repo is indexed; if not, `index_folder` |
| `search_symbols` | `mode`, `semantic`, `fusion`, `detail_level`, `token_budget` | Symbol discovery; `fusion=true` for vague queries; `detail_level="compact"` = 15 tokens/row |
| `get_context_bundle` | `symbol_ids[]`, `budget_strategy`, `token_budget` | Multi-symbol context in one call; `core_first` keeps primary symbol; `compact` = signatures only |
| `get_blast_radius` | `depth`, `include_source`, `include_depth_scores`, `call_depth`, `include_decisions` | Pre-edit impact; `include_decisions` surfaces commit intent; `call_depth` finds callers |
| `find_references` | `mode` (refs/importers/related), `quick`, `cross_repo` | `quick=true` for dead-code fast-path; `mode="importers"` for file-level deps |
| `get_call_hierarchy` | `direction`, `depth`, `include_impact`, `chains`, `kind`, `max_depth` | `chains=true` discovers signal chains (HTTP/CLI/event); `include_impact=true` for delete-safety |
| `check_safe` | `mode` (edit/delete), `include_runtime` | Preflight — returns verdict + top-5 blockers |
| `plan_refactoring` | `refactor_type`, `new_name`/`new_file`/`new_signature` | Returns `{old_text, new_text}` blocks ready for Edit tool |
| `get_repo_health` | `detailed`, `rules` (layer defs) | One-call triage; `detailed=true` adds cycles, coupling, hotspots |
| `get_repo_map` | `group_by`, `top_n`, `mode` (map/outline) | `mode="outline"` = lightweight dir/lang/symbol counts |
| `get_tectonic_map` | `days`, `min_plate_size` | Module topology; finds drifters, nexus plates (coupled ≥4) |
| `find_similar_symbols` | `threshold`, `semantic_weight`, `include_tests` | Consolidation candidates; `semantic_weight=0.6` default |
| `get_symbol_provenance` | `max_commits` | Authorship lineage + evolution narrative |
| `search_ast` | `category`, `pattern`, `language` | Anti-pattern sweep; `category=all` runs everything |
| `get_changed_symbols` | `since_sha`, `until_sha`, `include_blast_radius` | Maps git diff → symbols + downstream impact |
| `get_pr_risk_profile` | `base_ref`, `head_ref`, `days` | Composite risk score (blast + complexity + churn + tests + volume) |
| `embed_repo` | `force`, `batch_size` | Precompute embeddings; `force=true` to recompute all |

#### Anti-patterns to Avoid
- ❌ Reading full files with `read_file` — use `get_context_bundle` or `get_symbol_source`
- ❌ Using `grep`/`find_path`/shell for code exploration — `search_symbols` understands signatures, imports, types; `grep` is for non-symbol text only
- ❌ Calling `search_symbols` repeatedly — batch with `symbol_ids[]` in `get_context_bundle`
- ❌ Skipping `check_safe` before edits/deletes — 5s call prevents hours of revert
- ❌ Not verifying with `verify=true` — index can drift from working tree
- ❌ Ignoring `_meta.confidence` < 0.4 — low confidence means widen the search or report a gap, not proceed as-is
- ❌ Manual blast radius tracing — `get_blast_radius(depth=2, include_source=true)` is instant
- ❌ Re-searching after `verdict: "no_implementation_found"` — the absence is confirmed; report it, don't re-query with different terms
- ❌ Skipping `register_edit` after modifying files — stale caches cause later searches to return outdated data

#### Pro Tips
- **`budget_strategy="compact"`** on `get_context_bundle` — returns signatures only (min tokens), great for call-chain mapping
- **`embed_repo(repo="animamesh/backend")` once** — then `semantic=true` on `search_symbols` works instantly for semantic queries
- **`index_file` after every edit** — keeps index fresh for subsequent tool calls in same session
- **`cross_repo=true`** on `get_blast_radius` / `find_references` — finds consumers in other indexed repos
- **`chains=true`** on `get_call_hierarchy` — discovers end-to-end signal chains (HTTP routes, CLI commands, event handlers) that involve the symbol
- **Stale index?** `get_repo_health` returns `repo_is_stale`. If true, run `index_folder(path=".")` before trusting search results

#### Token Budget Discipline
- `assemble_task_context(token_budget=4000)` for focused tasks
- `get_context_bundle(token_budget=6000, budget_strategy="core_first")` for multi-symbol context
- `search_symbols(token_budget=3000)` with `detail_level="compact"` for broad discovery (15 tokens/row)
- Always check `_meta.tokens_used` / `_meta.tokens_remaining` in responses