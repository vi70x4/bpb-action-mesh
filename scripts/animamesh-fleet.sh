#!/usr/bin/env bash
#
# animamesh-fleet.sh — Multi-account fleet manager for Animamesh
#
# Manages throwaway GitHub accounts as proxy runner farms.
# Each account gets its own GH_CONFIG_DIR for isolated auth,
# a minimal clean repo with only the runner workflow file,
# and all required secrets.
#
# Usage:
#   ./animamesh-fleet.sh add <token> [--name NAME] [--fork-name NAME]
#       Register a new throwaway account and set it up
#
#   ./animamesh-fleet.sh deploy [--all|--name NAME] [--protocol hy2|vless]
#       Trigger proxy runners on one or all accounts
#
#   ./animamesh-fleet.sh status [--all|--name NAME]
#       Check active runners across the fleet
#
#   ./animamesh-fleet.sh logs <name> [--run-id ID]
#       Fetch runner logs from an account
#
#   ./animamesh-fleet.sh list
#       List all registered accounts
#
#   ./animamesh-fleet.sh remove <name>
#       Remove an account from the fleet
#
#   ./animamesh-fleet.sh init-secrets
#       Prompt to set shared secrets on all repos
#
# Config:
#   ~/.animamesh/fleet.env       — shared config (COORDINATOR_URL, AUTH_TOKEN, etc.)
#   ~/.animamesh/accounts/       — per-account directories
#       <name>/
#           gh/                  — GH_CONFIG_DIR (gh auth isolated)
#           repo/                — clean minimal repo (only workflow + README)
#           .meta                — account metadata (repo name, gh username)
#

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANIMAMESH_DIR="${HOME}/.animamesh"
ACCOUNTS_DIR="${ANIMAMESH_DIR}/accounts"
FLEET_ENV="${ANIMAMESH_DIR}/fleet.env"
GENERATED_NAMES=(
  "ci-config"
  "pipeline-tools"
  "build-workflows"
  "task-runner"
  "action-tester"
  "batch-process"
  "retry-queue"
  "job-scheduler"
  "workflow-templates"
  "ci-helpers"
  "deploy-scripts"
  "automation-toolkit"
  "build-cache"
  "devops-toolkit"
  "pipeline-orchestrator"
  "config-manager"
  "release-automation"
  "test-workflows"
  "integration-tests"
  "pipeline-config"
)

# ─── Colors ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ${NC} $*"; }
log_ok()    { echo -e "${GREEN}✔${NC} $*"; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
log_error() { echo -e "${RED}✘${NC} $*" >&2; }
log_step()  { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }

# ─── Help ─────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Animamesh Fleet Manager — multi-account proxy runner farm

USAGE:
  $SCRIPT_NAME add <token> [--name NAME] [--fork-name NAME]
  $SCRIPT_NAME deploy [--all|--name NAME] [--protocol hy2|vless] [--tunnel n2n|trycloudflare|direct]
  $SCRIPT_NAME status [--all|--name NAME]
  $SCRIPT_NAME logs <name> [--run-id ID]
  $SCRIPT_NAME list
  $SCRIPT_NAME remove <name>
  $SCRIPT_NAME init-secrets

COMMANDS:
  add            Register a new throwaway account (creates fresh repo, not a fork)
  deploy         Trigger proxy runners (parallel by default)
  status         Check active runs
  logs           Fetch runner logs
  list           List all registered accounts
  remove         Remove an account from the fleet
  init-secrets   Set shared secrets on all repos

OPTIONS:
  --name NAME           Account name (auto-generated if omitted)
  --fork-name NAME      GitHub repo name (random if omitted — innocent-looking)
  --all                 Target all accounts
  --protocol PROTO      hysteria2 (default) or vless
  --tunnel TUNNEL       trycloudflare (default), n2n, or direct
  --run-id ID           Specific run ID for logs
  -h, --help            Show this message

EOF
  exit 0
}

# ─── Bootstrap ────────────────────────────────────────────────────────────

ensure_dirs() {
  mkdir -p "$ACCOUNTS_DIR"
}

require_fleet_env() {
  if [ ! -f "$FLEET_ENV" ]; then
    log_warn "No fleet.env found. Run 'init-secrets' first or create manually:"
    echo "  $FLEET_ENV"
    echo ""
    echo "Required variables:"
    echo "  COORDINATOR_URL=https://your-worker.workers.dev"
    echo "  AUTH_TOKEN=your-secret"
    echo "  NETWORK_ID=my-mesh"
    echo "  N2N_COMMUNITY=auto-generated-if-omitted"
    echo "  N2N_KEY=auto-generated-if-omitted"
    echo "  N2N_SUPERNODE=supernode.ntop.org:7777"
    return 1
  fi
  # shellcheck source=/dev/null
  source "$FLEET_ENV"
}

# ─── Random name generator ───────────────────────────────────────────────

pick_name() {
  local used=("$@")
  local candidate
  while true; do
    candidate="${GENERATED_NAMES[$((RANDOM % ${#GENERATED_NAMES[@]}))]}"
    local taken=false
    for u in "${used[@]}"; do
      if [ "$candidate" = "$u" ]; then taken=true; break; fi
    done
    if [ "$taken" = false ]; then
      echo "$candidate"
      return 0
    fi
  done
}

pick_community() {
  local suffix
  suffix=$(head -c 8 /dev/urandom | base32 | tr -d '=' | tr '[:upper:]' '[:lower:]')
  echo "animamesh-${suffix}"
}

pick_key() {
  head -c 18 /dev/urandom | base64 | tr -d '=' | head -c 24
}

# ─── Account metadata ────────────────────────────────────────────────────

write_meta() {
  local name="$1"
  local fork_name="$2"
  local gh_user="$3"
  cat > "$ACCOUNTS_DIR/$name/.meta" <<META
# Animamesh fleet account
name=${name}
fork=${fork_name}
user=${gh_user}
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
META
}

read_meta() {
  local name="$1"
  local key="$2"
  if [ -f "$ACCOUNTS_DIR/$name/.meta" ]; then
    grep "^${key}=" "$ACCOUNTS_DIR/$name/.meta" | cut -d= -f2-
  fi
}

# ─── Commands ─────────────────────────────────────────────────────────────

cmd_add() {
  local token="" name="" fork_name=""

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="$2"; shift 2 ;;
      --fork-name) fork_name="$2"; shift 2 ;;
      -h|--help) usage ;;
      *)
        if [ -z "$token" ]; then
          token="$1"; shift
        else
          log_error "Unknown: $1"; usage
        fi
        ;;
    esac
  done

  if [ -z "$token" ]; then
    log_error "Token required. Usage: $SCRIPT_NAME add <token> [--name NAME]"
    exit 1
  fi

  ensure_dirs

  # Pick name if not provided
  if [ -z "$name" ]; then
    local existing_names
    existing_names=()
    for d in "$ACCOUNTS_DIR"/*/; do
      [ -d "$d" ] && existing_names+=("$(basename "$d")")
    done
    name=$(pick_name "${existing_names[@]}")
  fi

  local account_dir="$ACCOUNTS_DIR/$name"
  if [ -d "$account_dir" ]; then
    log_error "Account '$name' already exists at $account_dir"
    exit 1
  fi

  log_step "Registering account: $name"
  mkdir -p "$account_dir/gh"

  # Login with gh
  log_info "Authenticating with gh CLI..."
  echo "$token" | GH_CONFIG_DIR="$account_dir/gh" gh auth login --with-token 2>&1 || {
    log_error "gh auth failed. Check token."
    rm -rf "$account_dir"
    exit 1
  }

  # Get the account username
  local gh_user
  gh_user=$(GH_CONFIG_DIR="$account_dir/gh" gh api user --jq '.login' 2>/dev/null || echo "unknown")

  log_ok "Authenticated as ${BOLD}$gh_user${NC}"

  # Add delete_repo scope if needed (pipe token to avoid browser prompt)
  echo "$token" | GH_CONFIG_DIR="$account_dir/gh" gh auth refresh -h github.com -s delete_repo --with-token 2>/dev/null || true

  # Pick repo name if not provided
  if [ -z "$fork_name" ]; then
    local used_names
    used_names=()
    for d in "$ACCOUNTS_DIR"/*/; do
      [ -d "$d" ] && used_names+=("$(read_meta "$(basename "$d")" "fork")" "")
    done
    fork_name=$(pick_name "${used_names[@]}")
  fi

  # Delete existing repo with this name (if any — e.g. from a previous run)
  log_info "Checking for existing repo: ${gh_user}/${fork_name}..."
  if GH_CONFIG_DIR="$account_dir/gh" gh repo view "$gh_user/$fork_name" --json name &>/dev/null; then
    log_warn "Deleting existing repo: $gh_user/$fork_name"
    GH_CONFIG_DIR="$account_dir/gh" gh repo delete "$gh_user/$fork_name" --yes 2>/dev/null || true
    # Sleep briefly to let GitHub process the deletion
    sleep 3
  fi

  # Create a fresh standalone repo (NOT a fork — no fork network, no connection to animamesh)
  log_info "Creating fresh repo: ${gh_user}/${fork_name}..."
  local descriptions=(
    "Automated build and test pipeline configuration"
    "Continuous integration workflow definitions"
    "CI/CD pipeline setup and configuration"
    "Build automation and deployment workflows"
    "Development pipeline orchestration"
    "Automated testing and deployment config"
    "Infrastructure pipeline definitions"
    "Release automation and CI tooling"
  )
  local desc="${descriptions[$((RANDOM % ${#descriptions[@]}))]}"
  GH_CONFIG_DIR="$account_dir/gh" gh repo create "$fork_name" --private=false --description "$desc" --homepage="" --add-topic ci,automation 2>&1 || {
    log_error "Repo creation failed"
    rm -rf "$account_dir"
    exit 1
  }
  log_ok "Repo created: ${gh_user}/${fork_name}"

  # Write metadata
  write_meta "$name" "$fork_name" "$gh_user"

  # Build minimal repo locally (no cloning — create from scratch)
  create_minimal_repo "$account_dir" "$fork_name" "$gh_user"

  log_ok "Account ${BOLD}$name${NC} (${gh_user}) → repo ${BOLD}$fork_name${NC}"
  log_info "Account dir: $account_dir"
  echo ""
  log_info "Next: Set secrets with: $SCRIPT_NAME init-secrets"
}

# ─── Minimal Repo Builder ───────────────────────────────────────────────

create_minimal_repo() {
  local account_dir="$1"
  local fork_name="$2"
  local gh_user="$3"
  local repo_dir="$account_dir/repo"

  log_step "Building minimal repo: ${fork_name}"

  # Clean slate — remove any previous repo dir
  rm -rf "$repo_dir"
  mkdir -p "$repo_dir/.github/workflows"

  # ── 1. Copy workflow from the real backend ──
  local workflow_src="$BACKEND_DIR/.github/workflows/proxy.yml"
  local workflow_dst="$repo_dir/.github/workflows/proxy.yml"
  if [ ! -f "$workflow_src" ]; then
    log_error "proxy.yml not found at $workflow_src"
    exit 1
  fi
  cp "$workflow_src" "$workflow_dst"
  log_info "Copied workflow from backend"

  # ── 2. Obfuscate the workflow (strip revealing names and comments) ──
  local wf="$workflow_dst"
  sed -i 's/name: BPB Action Proxy/name: CI Pipeline/' "$wf"
  sed -i 's/description: Launch.*/description: Automated build and test pipeline/' "$wf" 2>/dev/null || true
  sed -i 's/name: Install Hysteria2/name: Install dependencies/' "$wf"
  sed -i 's/name: Install sing-box (VLESS)/name: Setup runtime/' "$wf"
  sed -i 's/name: Generate credentials/name: Configure environment/' "$wf"
  sed -i 's/name: Setup n2n P2P Network/name: Configure network overlay/' "$wf"
  sed -i 's/name: Setup Hysteria2/name: Start server/' "$wf"
  sed -i 's/name: Setup sing-box (VLESS)/name: Start service/' "$wf"
  sed -i 's/name: Setup Cloudflare Tunnel/name: Setup tunnel/' "$wf"
  sed -i 's/name: Setup Direct P2P Tunnel/name: Configure direct tunnel/' "$wf"
  sed -i 's/name: Register proxy/name: Register with registry/' "$wf"
  sed -i 's/name: Output subscription info/name: Print connection info/' "$wf"
  sed -i 's/name: Start DHT Mesh Node/name: Start discovery service/' "$wf"
  sed -i 's/name: Keep runner alive with heartbeat/name: Keep alive/' "$wf"
  # Strip revealing comments (case-sensitive is fine — we know the exact casing)
  sed -i '/^# ---.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*BPB.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*animamesh.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*mesh.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*proxy.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*Hiddify.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*VLESS.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*Hysteria2.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*sing-box.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*cloudflared.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*n2n.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*STUN.*$/d' "$wf" 2>/dev/null || true
  sed -i '/^#.*WebSocket.*$/d' "$wf" 2>/dev/null || true
  log_info "Obfuscated workflow file"

  # ── 3. Create innocent README ──
  log_info "Generating README..."
  if gen_readme "$fork_name" > "$repo_dir/README.md" 2>/dev/null; then
    log_ok "README generated via LLM"
  else
    log_warn "LLM unavailable, using static template"
    local generic_desc
    local generic_desc_options=(
      "CI pipeline configuration and automation workflows"
      "Build, test, and deployment pipeline definitions"
      "Continuous integration setup for automated testing"
      "Development workflow automation scripts"
      "Automated build pipeline and release tooling"
    )
    generic_desc="${generic_desc_options[$((RANDOM % ${#generic_desc_options[@]}))]}"

    cat > "$repo_dir/README.md" <<READEOF
# ${fork_name}

${generic_desc}

## Usage

This repository contains CI workflow definitions for automated build, test,
and deployment pipelines. The workflows are triggered via workflow_dispatch
or on push events.

## License

MIT
READEOF
    log_info "Created README.md (static)"
  fi

  # ── 4. Create minimal .gitignore ──
  cat > "$repo_dir/.gitignore" <<'GITIGNORE'
node_modules/
.env
*.log
dist/
coverage/
GITIGNORE

  # ── 5. Generate fake source code (looks like a real TS project) ──
  gen_fake_source "$repo_dir" "$fork_name"

  # ── 6. Init git, make 2 commits, push ──
  cd "$repo_dir"

  # Get gh token for git push
  local gh_token
  gh_token=$(GH_CONFIG_DIR="$account_dir/gh" gh auth token 2>/dev/null || true)

  git init --quiet
  git checkout -b main --quiet 2>/dev/null || git branch -m main

  # Local git config for commits (don't depend on user's global config)
  git config user.name "CI Bot"
  git config user.email "bot@ci.local"

  # Commit 1: initial project structure (README + configs only)
  git add README.md .gitignore package.json tsconfig.json jest.config.js
  git commit -m "Initial commit" --quiet 2>/dev/null || true

  # Commit 2: add source code and CI pipeline (looks like a later addition)
  git add src/ .github/
  git commit -m "Add source code and CI workflow" --quiet 2>/dev/null || true

  # Set remote (no token in URL — use extraHeader for auth)
  git remote add origin "https://github.com/${gh_user}/${fork_name}.git"

  # Stateless auth via extraHeader instead of embedding token in URL
  # This avoids leaking the token to .git/config if the script crashes
  if [ -n "$gh_token" ]; then
    local auth_header
    auth_header=$(echo -n "x-access-token:${gh_token}" | base64 -w0 2>/dev/null || echo -n "x-access-token:${gh_token}" | base64)
    git config http.extraHeader "AUTHORIZATION: basic ${auth_header}"
  fi

  # Push (force as fallback — repo was just created, no conflicts expected)
  git push -u origin main --quiet 2>/dev/null || {
    log_warn "Push failed, retrying with force..."
    sleep 2
    git push -u origin main --force --quiet 2>/dev/null || {
      log_error "Push failed. Check token permissions."
      cd - >/dev/null
      exit 1
    }
  }

  # Clean up extraHeader so it doesn't affect other git operations
  git config --unset http.extraHeader 2>/dev/null || true

  cd - >/dev/null
  log_ok "Minimal repo created, pushed: ${gh_user}/${fork_name}"
}

# ─── Fake Source Code Generator ────────────────────────────────────────

# Generates deterministic TypeScript utility files so the repo looks like
# a legitimate software project with CI, not an empty shell repo.
# Uses the repo name as a seed so output is stable across re-runs.
# All code is syntactically valid TypeScript — boring utility functions.

gen_fake_source() {
  local repo_dir="$1"
  local repo_name="$2"

  # Deterministic seed from repo name
  local seed
  seed=$(echo "$repo_name" | md5sum 2>/dev/null | head -c 8 || echo "a1b2c3d4")
  # Pick a variant (0-15) for function name variation
  local variant=$(( 0x${seed:0:1} % 4 ))

  mkdir -p "$repo_dir/src/__tests__"

  # ── package.json ──
  cat > "$repo_dir/package.json" <<'JSON'
{
  "name": "REPO_NAME",
  "version": "0.1.0",
  "description": "Utility helpers for data processing",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest --passWithNoTests",
    "lint": "echo ok",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.3.0"
  },
  "license": "MIT"
}
JSON
  sed -i "s/REPO_NAME/$repo_name/" "$repo_dir/package.json"

  # ── tsconfig.json ──
  cat > "$repo_dir/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
JSON

  # ── jest.config.js ──
  cat > "$repo_dir/jest.config.js" <<'JS'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**'],
};
JS

  # ── src/collect.ts — collection utilities ──
  case $variant in
    0)
      cat > "$repo_dir/src/collect.ts" <<'TS'
export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export function uniqueBy<T>(items: T[], key: keyof T): T[] {
  const seen = new Set<T[keyof T]>();
  return items.filter((item) => {
    const k = item[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of items) {
    if (predicate(item)) pass.push(item);
    else fail.push(item);
  }
  return [pass, fail];
}
TS
      ;;
    1)
      cat > "$repo_dir/src/collect.ts" <<'TS'
export function groupBy<T>(items: T[], key: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = String(item[key]);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function flatten<T>(items: T[][]): T[] {
  const result: T[] = [];
  for (const arr of items) {
    for (const item of arr) result.push(item);
  }
  return result;
}

export function sample<T>(items: T[], count: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, items.length));
}
TS
      ;;
    2)
      cat > "$repo_dir/src/collect.ts" <<'TS'
export function compact<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((item): item is T => item != null);
}

export function diff<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => !setB.has(item));
}

export function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}
TS
      ;;
    3)
      cat > "$repo_dir/src/collect.ts" <<'TS'
export function sortBy<T>(items: T[], key: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  return [...items].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va < vb) return order === 'asc' ? -1 : 1;
    if (va > vb) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

export function takeWhile<T>(items: T[], predicate: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (!predicate(item)) break;
    result.push(item);
  }
  return result;
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
TS
      ;;
  esac

  # ── src/format.ts — string utilities ──
  case $variant in
    0)
      cat > "$repo_dir/src/format.ts" <<'TS'
export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

export function kebabCase(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}
TS
      ;;
    1)
      cat > "$repo_dir/src/format.ts" <<'TS'
export function camelCase(text: string): string {
  return text
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export function padStart(text: string, length: number, char = ' '): string {
  if (text.length >= length) return text;
  return char.repeat(length - text.length) + text;
}

export function words(text: string): string[] {
  return text.match(/[a-zA-Z]+/g) || [];
}
TS
      ;;
    2)
      cat > "$repo_dir/src/format.ts" <<'TS'
export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural || singular + 's';
}

export function trimLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function ellipsis(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '\u2026';
}
TS
      ;;
    3)
      cat > "$repo_dir/src/format.ts" <<'TS'
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function mask(text: string, visible = 4, char = '*'): string {
  if (text.length <= visible) return text;
  return char.repeat(text.length - visible) + text.slice(-visible);
}

export function indent(text: string, level = 1, spaces = 2): string {
  const prefix = ' '.repeat(level * spaces);
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n');
}
TS
      ;;
  esac

  # ── src/__tests__/collect.test.ts ──
  cat > "$repo_dir/src/__tests__/collect.test.ts" <<'TS'
import { describe, it, expect } from '@jest/globals';

describe('collect', () => {
  it('should export functions', () => {
    const mod = require('../collect');
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
TS

  # ── src/__tests__/format.test.ts ──
  cat > "$repo_dir/src/__tests__/format.test.ts" <<'TS'
import { describe, it, expect } from '@jest/globals';

describe('format', () => {
  it('should export functions', () => {
    const mod = require('../format');
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
TS

  # ── src/index.ts — barrel exports ──
  cat > "$repo_dir/src/index.ts" <<'TS'
export * from './collect';
export * from './format';
TS

  log_info "Generated fake source code (variant ${variant})"
}

# ─── LLM-backed README generation ─────────────────────────────────────

gen_readme() {
  local fork_name="$1"
  local llm_url="${LLM_URL:-http://localhost:3001/v1/chat/completions}"
  local llm_key="${LLM_KEY:-}"

  # If no LLM key is configured, skip straight to fallback
  if [ -z "$llm_key" ]; then
    return 1
  fi

  local prompt
  prompt="Generate a concise README.md in English for a GitHub repository called '${fork_name}'. It contains CI/CD workflow definitions for automated build, test, and deployment pipelines using GitHub Actions. Describe it as a collection of reusable pipeline configurations with a realistic use case. Include a Usage section describing how to trigger workflows via workflow_dispatch, and a License section (MIT). Keep it under 25 lines. Do NOT mention proxy, mesh, VPN, network tunnel, Hysteria, VLESS, Cloudflare, or any infrastructure/proxy concepts. Just plain CI pipeline automation."

  # Construct JSON payload safely using python3 to avoid shell escaping issues
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'model':'auto','messages':[{'role':'user','content':sys.argv[1]}],'temperature':0.7,'max_tokens':400}))" "$prompt" 2>/dev/null) || return 1

  local result
  result=$(curl -s --max-time 15 "$llm_url" \
    -H "Authorization: Bearer $llm_key" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || echo "")

  if [ -n "$result" ]; then
    # Parse JSON with python3 — handles thinking/reasoning content, multiline, unicode
    local readme
    readme=$(echo "$result" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    content = data["choices"][0]["message"]["content"]
    # Strip leading thinking/reasoning: find first line that starts with #
    lines = content.split("\n")
    out_lines = []
    found = False
    for line in lines:
        if not found and line.strip().startswith("#"):
            found = True
        if found:
            out_lines.append(line)
    result = "\n".join(out_lines).strip()
    if not result:
        result = content
    print(result)
except Exception:
    sys.exit(1)
' 2>/dev/null || echo "")

    if [ -n "$readme" ]; then
      echo "$readme"
      return 0
    fi
  fi

  # Fallback: static template
  return 1
}

cmd_deploy() {
  local targets=() protocol="hysteria2" tunnel="n2n"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all) shift ;;
      --name) targets+=("$2"); shift 2 ;;
      --protocol) protocol="$2"; shift 2 ;;
      --tunnel) tunnel="$2"; shift 2 ;;
      -h|--help) usage ;;
      *) log_error "Unknown: $1"; usage ;;
    esac
  done

  require_fleet_env || exit 1

  # If no specific targets, deploy to all
  if [ ${#targets[@]} -eq 0 ]; then
    for d in "$ACCOUNTS_DIR"/*/; do
      [ -d "$d" ] && targets+=("$(basename "$d")")
    done
  fi

  if [ ${#targets[@]} -eq 0 ]; then
    log_error "No accounts registered. Use 'add' first."
    exit 1
  fi

  log_step "Deploying to ${#targets[@]} account(s)"
  log_info "Protocol: ${protocol}   Tunnel: ${tunnel}"
  echo ""

  local pids=()
  local i=0

  for name in "${targets[@]}"; do
    local account_dir="$ACCOUNTS_DIR/$name"
    if [ ! -d "$account_dir" ]; then
      log_warn "Account '$name' not found, skipping"
      continue
    fi

    local fork_name
    fork_name=$(read_meta "$name" "fork")
    local gh_user
    gh_user=$(read_meta "$name" "user")

    if [ -z "$fork_name" ] || [ -z "$gh_user" ]; then
      log_warn "Account '$name' missing metadata, skipping"
      continue
    fi

    (
      log_info "[$name] Triggering ${gh_user}/${fork_name} (protocol=$protocol, tunnel=$tunnel)"

      # Determine the dispatch payload
      local payload
      payload=$(cat <<JSON
{
  "ref": "main",
  "inputs": {
    "protocol": "${protocol}",
    "tunnel": "${tunnel}"
  }
}
JSON
      )

      # Use GH_CONFIG_DIR for gh-aware dispatch
      GH_CONFIG_DIR="$account_dir/gh" gh api \
        --method POST \
        "/repos/${gh_user}/${fork_name}/actions/workflows/proxy.yml/dispatches" \
        --input <(echo "$payload") \
        --silent 2>/dev/null

      local exit_code=$?
      if [ $exit_code -eq 0 ]; then
        log_ok "[$name] ✅ Workflow dispatched"
        # Get the run URL
        sleep 3
        local run_url
        run_url=$(GH_CONFIG_DIR="$account_dir/gh" gh run list \
          --repo "${gh_user}/${fork_name}" \
          --workflow proxy.yml \
          --limit 1 \
          --json url \
          --jq '.[0].url' 2>/dev/null || echo "")
        if [ -n "$run_url" ]; then
          echo "  ${BLUE}→${NC} $run_url"
        fi
      else
        log_error "[$name] ❌ Dispatch failed"
      fi
    ) &
    pids+=("$!")
    i=$((i + 1))

    # Small stagger between accounts to avoid API rate limits
    sleep 1
  done

  # Wait for all
  echo ""
  log_info "Waiting for ${#pids[@]} dispatch(es)..."
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  log_ok "Deploy complete"
}

cmd_status() {
  local targets=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all) shift ;;
      --name) targets+=("$2"); shift 2 ;;
      *) log_error "Unknown: $1"; usage ;;
    esac
  done

  if [ ${#targets[@]} -eq 0 ]; then
    for d in "$ACCOUNTS_DIR"/*/; do
      [ -d "$d" ] && targets+=("$(basename "$d")")
    done
  fi

  if [ ${#targets[@]} -eq 0 ]; then
    log_info "No accounts registered"
    exit 0
  fi

  log_step "Fleet Status"
  echo ""
  printf "  ${BOLD}%-18s %-22s %-10s %-24s${NC}\n" "ACCOUNT" "FORK" "STATUS" "RUN"
  printf "  %-18s %-22s %-10s %-24s\n" "───────" "────" "──────" "───"

  for name in "${targets[@]}"; do
    local account_dir="$ACCOUNTS_DIR/$name"
    local fork_name
    fork_name=$(read_meta "$name" "fork")
    local gh_user
    gh_user=$(read_meta "$name" "user")

    if [ ! -f "$account_dir/.meta" ]; then
      printf "  %-18s %-22s ${YELLOW}%-10s${NC}\n" "$name" "?" "no meta"
      continue
    fi

    local run_info
    run_info=$(GH_CONFIG_DIR="$account_dir/gh" gh run list \
      --repo "${gh_user}/${fork_name}" \
      --workflow proxy.yml \
      --limit 1 \
      --json status,conclusion,displayTitle,createdAt,url \
      --jq '.[0] // {}' 2>/dev/null || echo "{}")

    local status
    status=$(echo "$run_info" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "none")
    local conclusion
    conclusion=$(echo "$run_info" | grep -o '"conclusion":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    local title
    title=$(echo "$run_info" | grep -o '"displayTitle":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    local url
    url=$(echo "$run_info" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

    local status_display
    if [ "$status" = "in_progress" ]; then
      status_display="${GREEN}● running${NC}"
    elif [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        status_display="${GREEN}✓ success${NC}"
      else
        status_display="${RED}✗ ${conclusion}${NC}"
      fi
    elif [ "$status" = "queued" ]; then
      status_display="${YELLOW}◐ queued${NC}"
    else
      status_display="${BLUE}○ idle${NC}"
    fi

    local run_display
    if [ -n "$url" ]; then
      run_display="${title:0:23}"
    else
      run_display="-"
    fi

    printf "  %-18s %-22s %b %-24s\n" "$name" "${fork_name}" "$status_display" "$run_display"
  done
  echo ""
}

cmd_logs() {
  local name="" run_id=""
  name="${1:-}"
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-id) run_id="$2"; shift 2 ;;
      *) log_error "Unknown: $1"; usage ;;
    esac
  done

  if [ -z "$name" ]; then
    log_error "Account name required. Usage: $SCRIPT_NAME logs <name>"
    exit 1
  fi

  local account_dir="$ACCOUNTS_DIR/$name"
  if [ ! -d "$account_dir" ]; then
    log_error "Account '$name' not found"
    exit 1
  fi

  local fork_name
  fork_name=$(read_meta "$name" "fork")
  local gh_user
  gh_user=$(read_meta "$name" "user")

  if [ -z "$run_id" ]; then
    # Get latest run ID
    run_id=$(GH_CONFIG_DIR="$account_dir/gh" gh run list \
      --repo "${gh_user}/${fork_name}" \
      --workflow proxy.yml \
      --limit 1 \
      --json databaseId \
      --jq '.[0].databaseId' 2>/dev/null || echo "")
    if [ -z "$run_id" ]; then
      log_error "No runs found for $name"
      exit 1
    fi
  fi

  GH_CONFIG_DIR="$account_dir/gh" gh run view "$run_id" \
    --repo "${gh_user}/${fork_name}" \
    --log 2>&1 || true
}

cmd_list() {
  log_step "Fleet Accounts"
  echo ""
  printf "  ${BOLD}%-18s %-22s %-18s %-20s${NC}\n" "NAME" "FORK" "GITHUB USER" "CREATED"
  printf "  %-18s %-22s %-18s %-20s\n" "────" "────" "───────────" "───────"

  for d in "$ACCOUNTS_DIR"/*/; do
    [ -d "$d" ] || continue
    local name
    name=$(basename "$d")
    local fork_name
    fork_name=$(read_meta "$name" "fork") || fork_name="?"
    local gh_user
    gh_user=$(read_meta "$name" "user") || gh_user="?"
    local created
    created=$(read_meta "$name" "created") || created="?"

    printf "  %-18s %-22s %-18s %-20s\n" "$name" "${fork_name:0:21}" "${gh_user:0:17}" "${created:0:19}"
  done
  echo ""
}

cmd_remove() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    log_error "Account name required. Usage: $SCRIPT_NAME remove <name>"
    exit 1
  fi

  local account_dir="$ACCOUNTS_DIR/$name"
  if [ ! -d "$account_dir" ]; then
    log_error "Account '$name' not found"
    exit 1
  fi

  local fork_name
  fork_name=$(read_meta "$name" "fork")
  local gh_user
  gh_user=$(read_meta "$name" "user")

  log_info "Deleting fork ${gh_user}/${fork_name}..."
  GH_CONFIG_DIR="$account_dir/gh" gh repo delete "${gh_user}/${fork_name}" --yes 2>/dev/null || true

  log_info "Removing account directory..."
  rm -rf "$account_dir"
  log_ok "Account '$name' removed"
}

cmd_init_secrets() {
  if [ -f "$FLEET_ENV" ]; then
    log_warn "fleet.env already exists. Edit it directly: $FLEET_ENV"
    log_info "Then run: $SCRIPT_NAME deploy"
    exit 0
  fi

  log_step "Setting up shared fleet config"

  echo ""
  echo "Enter the shared configuration values."
  echo "Leave blank to auto-generate n2n community/key."
  echo ""

  read -rp "  COORDINATOR_URL (Worker URL): " COORDINATOR_URL
  read -rsp "  AUTH_TOKEN (shared secret): " AUTH_TOKEN
  echo ""

  if [ -z "$COORDINATOR_URL" ]; then
    log_error "COORDINATOR_URL is required"
    exit 1
  fi
  if [ -z "$AUTH_TOKEN" ]; then
    log_error "AUTH_TOKEN is required"
    exit 1
  fi

  read -rp "  NETWORK_ID (mesh id, default: animamesh-fleet): " NETWORK_ID
  NETWORK_ID="${NETWORK_ID:-animamesh-fleet}"

  read -rp "  N2N_SUPERNODE (default: supernode.ntop.org:7777): " N2N_SUPERNODE
  N2N_SUPERNODE="${N2N_SUPERNODE:-supernode.ntop.org:7777}"

  # Generate n2n credentials
  local N2N_COMMUNITY N2N_KEY
  N2N_COMMUNITY=$(pick_community)
  N2N_KEY=$(pick_key)

  cat > "$FLEET_ENV" <<EOF
# Animamesh Fleet — shared configuration
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# WARNING: This file contains secrets. Keep it safe.

COORDINATOR_URL=${COORDINATOR_URL}
AUTH_TOKEN=${AUTH_TOKEN}
NETWORK_ID=${NETWORK_ID}
N2N_COMMUNITY=${N2N_COMMUNITY}
N2N_KEY=${N2N_KEY}
N2N_SUPERNODE=${N2N_SUPERNODE}
EOF

  chmod 600 "$FLEET_ENV"
  log_ok "Config written to $FLEET_ENV"

  echo ""
  log_info "Now setting secrets on all registered forks..."

  for d in "$ACCOUNTS_DIR"/*/; do
    [ -d "$d" ] || continue
    local name
    name=$(basename "$d")
    local fork_name
    fork_name=$(read_meta "$name" "fork")
    local gh_user
    gh_user=$(read_meta "$name" "user")

    if [ -z "$fork_name" ] || [ -z "$gh_user" ]; then
      log_warn "Skipping $name (incomplete metadata)"
      continue
    fi

    log_info "[$name] Setting secrets on ${gh_user}/${fork_name}..."

    # Set secrets via gh CLI with explicit token from account's auth
    local gh_token
    gh_token=$(cat "$d/gh/hosts.yml" 2>/dev/null | grep oauth_token | awk '{print $2}' | tr -d '"' || true)
    if [ -z "$gh_token" ]; then
      log_warn "[$name] No gh token found, skipping secret sync"
      continue
    fi

    for secret_name in COORDINATOR_URL AUTH_TOKEN NETWORK_ID N2N_COMMUNITY N2N_KEY N2N_SUPERNODE; do
      local secret_value
      eval "secret_value=\$$secret_name"
      if ! echo "$secret_value" | GH_TOKEN="$gh_token" gh secret set "$secret_name" --repo "${gh_user}/${fork_name}" 2>&1; then
        log_warn "[$name] Failed to set $secret_name (repo may not exist or token expired)"
      fi
    done

    log_ok "[$name] Secrets synced"
  done
}

# ─── Main ─────────────────────────────────────────────────────────────────

ensure_dirs

case "${1:-help}" in
  add)            shift; cmd_add "$@" ;;
  deploy)         shift; cmd_deploy "$@" ;;
  status)         shift; cmd_status "$@" ;;
  logs)           shift; cmd_logs "$@" ;;
  list)           cmd_list ;;
  remove)         shift; cmd_remove "$@" ;;
  init-secrets)   cmd_init_secrets ;;
  help|--help|-h) usage ;;
  *)
    log_error "Unknown command: ${1:-}"
    echo ""
    usage
    ;;
esac
