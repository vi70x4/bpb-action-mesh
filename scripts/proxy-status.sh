#!/usr/bin/env bash
#
# proxy-status.sh — Check active proxies and coordinator health
#
# Usage:
#   ./scripts/proxy-status.sh [--repo owner/repo] [--coordinator URL]

set -euo pipefail

REPO="${BPB_REPO:-}"
COORDINATOR_URL="${BPB_COORDINATOR_URL:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo|-r) REPO="$2"; shift 2 ;;
    --coordinator|-c) COORDINATOR_URL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--repo owner/repo] [--coordinator URL]"
      echo ""
      echo "Shows active GHA runs and coordinator proxy list."
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$REPO" ]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  [ -n "$REMOTE_URL" ] && REPO=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?|\1|')
fi

echo "🔍 BPB Action Proxy — Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# GHA runs
if [ -n "$REPO" ]; then
  echo ""
  echo "📋 GitHub Actions runs (last 5):"
  gh run list \
    --repo "$REPO" \
    --workflow proxy.yml \
    --limit 5 \
    --json databaseId,status,conclusion,createdAt,displayTitle \
    --jq '.[] | "  \(.status | if . == "in_progress" then "🟢 RUNNING" elif . == "queued" then "🟡 QUEUED" elif . == "completed" then (if .conclusion == "success" then "✅ DONE" else "❌ FAILED" end) else . end)  #\(.databaseId)  \(.createdAt)  \(.displayTitle)"' 2>/dev/null || echo "  (could not fetch runs)"
fi

# Coordinator proxies
if [ -n "$COORDINATOR_URL" ]; then
  echo ""
  echo "🌐 Coordinator proxies:"

  HEALTH=$(curl -s --max-time 5 "${COORDINATOR_URL}/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH" ]; then
    echo "  Health: ✅ $HEALTH"
  else
    echo "  Health: ❌ unreachable"
  fi

  PROXIES=$(curl -s --max-time 5 "${COORDINATOR_URL}/proxies" 2>/dev/null || echo "")
  if [ -n "$PROXIES" ] && echo "$PROXIES" | grep -qE '"id"'; then
    echo "$PROXIES" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for p in data:
            proto = p.get('protocol','?')
            host = p.get('host','?')
            exp = p.get('expiresAt','?')
            print(f'  🟢 {proto} → {host}  expires: {exp}')
    else:
        print(f'  {data}')
except:
    print('  (parse error)')
" 2>/dev/null || echo "  $PROXIES"
  else
    echo "  No active proxies registered."
  fi

  # Subscription content
  SUB=$(curl -s --max-time 5 "${COORDINATOR_URL}/sub/all" 2>/dev/null || echo "")
  if [ -n "$SUB" ] && echo "$SUB" | grep -qE '^(vless|hysteria2)://'; then
    echo ""
    echo "📋 Subscription content:"
    echo "$SUB" | while IFS= read -r line; do
      echo "   $line"
    done
  fi
else
  echo ""
  echo "⚠️  No COORDINATOR_URL set. Set it with --coordinator or BPB_COORDINATOR_URL"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
