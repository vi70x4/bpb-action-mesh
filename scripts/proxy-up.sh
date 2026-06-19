#!/usr/bin/env bash
#
# proxy-up.sh — KISS one-command proxy launcher
#
# Usage:
#   ./scripts/proxy-up.sh [--protocol vless|hysteria2] [--wait]
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: gh auth login
#   - Or set GITHUB_TOKEN env var
#
# What it does:
#   1. Triggers the BPB Action Proxy workflow via GitHub API
#   2. Polls the workflow run until it's in progress
#   3. Waits for the runner to register with the coordinator
#   4. Prints your subscription URL
#
# Everything else (VLESS server, tunnel, worker registration)
# happens inside the GHA runner automatically.

set -euo pipefail

# --- Defaults ---
PROTOCOL="${BPB_PROTOCOL:-hysteria2}"
REPO="${BPB_REPO:-}"          # auto-detected from git remote
COORDINATOR_URL="${BPB_COORDINATOR_URL:-}"
WAIT="${BPB_WAIT:-true}"
POLL_INTERVAL=10              # seconds between status checks
MAX_WAIT=300                  # max seconds to wait for subscription (5 min)

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --protocol|-p)
      PROTOCOL="$2"; shift 2 ;;
    --repo|-r)
      REPO="$2"; shift 2 ;;
    --coordinator|-c)
      COORDINATOR_URL="$2"; shift 2 ;;
    --no-wait)
      WAIT="false"; shift ;;
    --wait|-w)
      WAIT="true"; shift ;;
    --help|-h)
      echo "Usage: $0 [--protocol vless|hysteria2] [--repo owner/repo] [--wait]"
      echo "       [--coordinator URL] [--no-watch]"
      echo ""
      echo "Triggers BPB Action Proxy and waits for subscription URL."
      echo ""
      echo "Env vars: BPB_PROTOCOL, BPB_REPO, BPB_COORDINATOR_URL, BPB_WAIT"
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Auto-detect repo from git remote ---
if [ -z "$REPO" ]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [ -n "$REMOTE_URL" ]; then
    # Extract owner/repo from various URL formats
    REPO=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?|\1|')
  fi
fi

if [ -z "$REPO" ]; then
  echo "❌ No repo specified. Use --repo owner/repo or run from a git clone."
  exit 1
fi

echo " 🌀 BPB Action Proxy — KISS Launcher"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Repo:     $REPO"
echo "  Protocol: $PROTOCOL"
echo ""

# --- Step 1: Trigger the workflow ---
echo "🚀 Triggering workflow..."

RUN_ID=$(gh workflow run proxy.yml \
  --repo "$REPO" \
  --field protocol="$PROTOCOL" 2>&1 | grep -oE '[0-9]+' || echo "")

# gh workflow run doesn't return run ID directly, so we find it
if [ -z "$RUN_ID" ]; then
  # Find the most recent workflow run
  echo "⏳ Looking for the triggered run..."
  sleep 3
  RUN_ID=$(gh run list \
    --repo "$REPO" \
    --workflow proxy.yml \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId' 2>/dev/null || echo "")
fi

if [ -z "$RUN_ID" ]; then
  echo "✅ Workflow triggered! Check status at:"
  echo "   https://github.com/$REPO/actions/workflows/proxy.yml"
  if [ "$WAIT" = "false" ]; then
    exit 0
  fi
  echo ""
  echo "⏳ Waiting for runner to start (polling every ${POLL_INTERVAL}s)..."

  # Poll until we find the run
  ELAPSED=0
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    RUN_ID=$(gh run list \
      --repo "$REPO" \
      --workflow proxy.yml \
      --limit 1 \
      --json databaseId,status \
      --jq '.[] | select(.status=="in_progress" or .status=="queued") | .databaseId' 2>/dev/null | head -1 || echo "")
    if [ -n "$RUN_ID" ]; then
      break
    fi
    sleep $POLL_INTERVAL
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done
fi

if [ -z "$RUN_ID" ]; then
  echo "❌ Could not find the workflow run. Check GitHub Actions manually."
  exit 1
fi

echo "📋 Run ID: $RUN_ID"
echo "   https://github.com/$REPO/actions/runs/$RUN_ID"

if [ "$WAIT" = "false" ]; then
  echo ""
  echo "✅ Done! The proxy will be available after the runner starts (~2 min)."
  exit 0
fi

# --- Step 2: Wait for the runner to be running ---
echo ""
echo "⏳ Waiting for runner to start..."

ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(gh run view "$RUN_ID" \
    --repo "$REPO" \
    --json status,conclusion \
    --jq '.status' 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "in_progress" ]; then
    echo "✅ Runner is active!"
    break
  elif [ "$STATUS" = "completed" ]; then
    CONCLUSION=$(gh run view "$RUN_ID" \
      --repo "$REPO" \
      --json conclusion \
      --jq '.conclusion' 2>/dev/null || echo "unknown")
    echo "❌ Workflow completed with: $CONCLUSION"
    exit 1
  fi

  echo "   Status: $STATUS... (${ELAPSED}s elapsed)"
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# --- Step 3: Get subscription URL ---
echo ""
echo "📋 Waiting for proxy to register..."

ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Try coordinator first
  if [ -n "$COORDINATOR_URL" ]; then
    SUB_CONTENT=$(curl -s --max-time 5 "${COORDINATOR_URL}/sub/all" 2>/dev/null || echo "")
    if [ -n "$SUB_CONTENT" ] && echo "$SUB_CONTENT" | grep -qE '^(vless|hy2|hysteria2)://'; then
      echo ""
      echo "═══════════════════════════════════════════════"
      echo "🎉 Your proxy is ready!"
      echo ""
      echo "📋 Subscription URL:"
      echo "   ${COORDINATOR_URL}/sub/all"
      echo ""
      echo "   Paste this into Hiddify → Subscriptions → Add"
      echo ""
      echo "🔗 Active proxies:"
      echo "$SUB_CONTENT" | while IFS= read -r line; do
        echo "   $line"
      done
      echo "═══════════════════════════════════════════════"
      exit 0
    fi
  fi

  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  # Check if runner is still alive
  STATUS=$(gh run view "$RUN_ID" \
    --repo "$REPO" \
    --json status \
    --jq '.status' 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "⚠️  Runner has completed. Checking logs for direct connection string..."

    # Try to grab the output from the run logs
    LOG_URL=$(gh run view "$RUN_ID" \
      --repo "$REPO" \
      --json jobs \
      --jq '.jobs[] | select(.name=="proxy") | .steps[] | select(.name=="Output subscription info") | .url' 2>/dev/null || echo "")

    if [ -n "$LOG_URL" ]; then
      echo "   View logs: $LOG_URL"
    fi

    echo ""
    echo "💡 Tip: If you set COORDINATOR_URL, your subscription is served at:"
    echo "   ${COORDINATOR_URL:-<not set>}/sub/all"
    exit 0
  fi
done

echo ""
echo "⏰ Timed out waiting for subscription (${MAX_WAIT}s)."
echo "   The runner may still be starting up. Check manually:"
echo "   https://github.com/$REPO/actions/runs/$RUN_ID"
exit 1
