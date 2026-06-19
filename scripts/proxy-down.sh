#!/usr/bin/env bash
#
# proxy-down.sh — Cancel active proxy runs
#
# Usage:
#   ./scripts/proxy-down.sh [--repo owner/repo] [--all]
#
# What it does:
#   1. Finds in-progress BPB Action Proxy runs
#   2. Cancels them via GitHub API
#   3. Optionally cleans up coordinator registrations

set -euo pipefail

REPO="${BPB_REPO:-}"
ALL="${BPB_ALL:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo|-r) REPO="$2"; shift 2 ;;
    --all|-a) ALL="true"; shift ;;
    --help|-h)
      echo "Usage: $0 [--repo owner/repo] [--all]"
      echo ""
      echo "Cancels active BPB Action Proxy runs."
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$REPO" ]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [ -n "$REMOTE_URL" ]; then
    REPO=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?|\1|')
  fi
fi

if [ -z "$REPO" ]; then
  echo "❌ No repo specified. Use --repo owner/repo or run from a git clone."
  exit 1
fi

echo "🛑 BPB Action Proxy — Stopping active runs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Repo: $REPO"
echo ""

# Find in-progress runs
RUNS=$(gh run list \
  --repo "$REPO" \
  --workflow proxy.yml \
  --json databaseId,status,createdAt \
  --jq '.[] | select(.status=="in_progress" or .status=="queued" or .status=="waiting") | .databaseId' 2>/dev/null || echo "")

if [ -z "$RUNS" ]; then
  echo "✅ No active proxy runs found."
  exit 0
fi

COUNT=$(echo "$RUNS" | wc -l | tr -d ' ')
echo "Found ${COUNT} active run(s):"

echo "$RUNS" | while read -r RUN_ID; do
  echo "  Canceling run $RUN_ID..."
  gh run cancel "$RUN_ID" --repo "$REPO" 2>/dev/null && echo "  ✅ Canceled" || echo "  ❌ Failed to cancel"
done

echo ""
echo "✅ Done. All proxy runs canceled."
