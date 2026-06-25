#!/usr/bin/env bash
#
# meshify-wizard.sh — ⚡ Meshify Fleet Wizard ⚡
#
# Interactive magical wizard for deploying proxy runner fleets
# across throwaway GitHub accounts. Just bring tokens, we handle the rest.
#
# Inspired by BPB Wizard's UX philosophy — make complex ops feel like magic.
#
# Usage:
#   ./meshify-wizard.sh                   # Interactive wizard mode
#   ./meshify-wizard.sh add <token>        # Quick-add an account
#   ./meshify-wizard.sh deploy             # Deploy to all accounts
#   ./meshify-wizard.sh status             # Check fleet status
#   ./meshify-wizard.sh list               # List accounts
#   ./meshify-wizard.sh remove <name>      # Remove an account
#   ./meshify-wizard.sh logs <name>        # View logs
#   ./meshify-wizard.sh confetti           # 🎉 just for fun

set -euo pipefail

# Cleanup handler — kill background jobs on Ctrl+C
trap 'kill $(jobs -p) 2>/dev/null; echo -e "\n\n  ${YELLOW}⚠ Aborted.${NC}\n"; exit 1' INT TERM

# ──────────────────────────────────────────────────────────────────────────────
# ── CONSTANTS ────────────────────────────────────────────────────────────────

SCRIPT_NAME="$(basename "$0")"
ANIMAMESH_DIR="${HOME}/.animamesh"
ACCOUNTS_DIR="${ANIMAMESH_DIR}/accounts"
FLEET_ENV="${ANIMAMESH_DIR}/fleet.env"
FLEET_SCRIPT="$(cd "$(dirname "$0")" && pwd)/animamesh-fleet.sh"

# LLM config — override via env vars, default to localhost for local dev
LLM_URL="${LLM_URL:-http://localhost:3001/v1/chat/completions}"
LLM_KEY="${LLM_KEY:-api-gateway-b4168fe31e050d0429c6b9f0a6be01026a2ee979abfc3a19}"

# Colors — using tput for wider support, fallback to ANSI codes
if [ -t 1 ] && command -v tput &>/dev/null; then
  BOLD=$(tput bold)
  DIM=$(tput dim)
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)
  MAGENTA=$(tput setaf 5)
  CYAN=$(tput setaf 6)
  ORANGE=$(tput setaf 208 2>/dev/null || tput setaf 3)
  WHITE=$(tput setaf 7)
  NC=$(tput sgr0)
  # Backgrounds
  BG_RED=$(tput setab 1)
  BG_GREEN=$(tput setab 2)
  BG_BLUE=$(tput setab 4)
  BG_MAGENTA=$(tput setab 5)
  BG_CYAN=$(tput setab 6)
else
  BOLD='\033[1m'; DIM='\033[2m'
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; CYAN='\033[0;36m'
  ORANGE='\033[0;33m'; WHITE='\033[1;37m'; NC='\033[0m'
  BG_RED='\033[41m'; BG_GREEN='\033[42m'; BG_BLUE='\033[44m'
  BG_MAGENTA='\033[45m'; BG_CYAN='\033[46m'
fi

# Spinner frames
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
CONFETTI=('█' '▓' '▒' '░' '█' '▓' '▒' '░')
PARTY_EMOJIS=('🎉' '✨' '🚀' '⚡' '🌟' '💫' '🔥' '🎊')
DOT_SPINNER=('⡀' '⡄' '⡆' '⡇' '⣇' '⣧' '⣷' '⣿' '⣾' '⣼' '⣤' '⣠')

# ──────────────────────────────────────────────────────────────────────────────
# ── LOGO & HEADER ────────────────────────────────────────────────────────────
MAGENTA="${MAGENTA:-$BLUE}"

render_logo() {
  echo ""
  echo -e "  ${CYAN}███╗   ███╗███████╗███████╗██╗  ██╗███████╗███████╗${NC}"
  echo -e "  ${CYAN}████╗ ████║██╔════╝██╔════╝██║  ██║██╔════╝██╔════╝${NC}"
  echo -e "  ${CYAN}██╔████╔██║█████╗  ███████╗███████║█████╗  █████╗  ${NC}"
  echo -e "  ${CYAN}██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║██╔══╝  ██╔══╝  ${NC}"
  echo -e "  ${CYAN}██║ ╚═╝ ██║███████╗███████║██║  ██║██║     ██║     ${NC}"
  echo -e "  ${CYAN}╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝     ${NC}"
  echo -e "  ${BG_MAGENTA}${WHITE}${BOLD}  ⚡ FLEET WIZARD ⚡  ${NC}  ${DIM}v1.0.0${NC}"
  echo ""
}

render_title() {
  clear 2>/dev/null || true
  render_logo
}

# ──────────────────────────────────────────────────────────────────────────────
# ── SPINNER ──────────────────────────────────────────────────────────────────

# Run a command with a spinner while it's running
# Usage: with_spinner "Message" command arg1 arg2 ...
with_spinner() {
  local msg="$1"
  shift
  local pid
  local frame=0
  local start_time
  start_time=$(date +%s)

  # Run the command in background
  "$@" >/dev/null 2>&1 &
  pid=$!

  # Show spinner while command runs
  while kill -0 "$pid" 2>/dev/null; do
    local elapsed=$(( $(date +%s) - start_time ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))
    local time_str
    if [ "$mins" -gt 0 ]; then
      time_str="${mins}m${secs}s"
    else
      time_str="${secs}s"
    fi
    printf "\r  ${SPINNER[$frame]} ${CYAN}%s${NC} ${DIM}%s${NC}" "$msg" "$time_str"
    frame=$(( (frame + 1) % ${#SPINNER[@]} ))
    sleep 0.1
  done

  wait "$pid"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    printf "\r  ${GREEN}✔${NC} ${CYAN}%s${NC} ${DIM}(%ss)${NC}\n" "$msg" "$(($(date +%s) - start_time))"
  else
    printf "\r  ${RED}✘${NC} ${CYAN}%s${NC} ${DIM}(%ss)${NC}\n" "$msg" "$(($(date +%s) - start_time))"
  fi

  return $exit_code
}

# Same as with_spinner but shows output on failure
with_spinner_verbose() {
  local msg="$1"
  shift
  local pid
  local frame=0
  local start_time
  start_time=$(date +%s)
  local tmp_out
  tmp_out=$(mktemp)

  # Run the command in background with output captured
  "$@" >"$tmp_out" 2>&1 &
  pid=$!

  # Show spinner while command runs
  while kill -0 "$pid" 2>/dev/null; do
    local elapsed=$(( $(date +%s) - start_time ))
    printf "\r  ${SPINNER[$frame]} ${CYAN}%s${NC} ${DIM}%ss${NC}" "$msg" "$elapsed"
    frame=$(( (frame + 1) % ${#SPINNER[@]} ))
    sleep 0.1
  done

  wait "$pid"
  local exit_code=$?
  local duration=$(($(date +%s) - start_time))

  if [ $exit_code -eq 0 ]; then
    printf "\r  ${GREEN}✔${NC} ${CYAN}%s${NC} ${DIM}(%ss)${NC}\n" "$msg" "$duration"
  else
    printf "\r  ${RED}✘${NC} ${CYAN}%s${NC} ${DIM}(%ss)${NC}\n" "$msg" "$duration"
    # Show output on failure
    if [ -s "$tmp_out" ]; then
      echo ""
      sed 's/^/     /' "$tmp_out" | head -20
    fi
  fi

  rm -f "$tmp_out"
  return $exit_code
}

# ──────────────────────────────────────────────────────────────────────────────
# ── PROGRESS BAR ─────────────────────────────────────────────────────────────

# Show a determinate progress bar
# Usage: progress_bar current total label
progress_bar() {
  local current="$1"
  local total="$2"
  local label="${3:-}"
  local width=40
  local pct=$(( current * 100 / total ))
  local filled=$(( current * width / total ))
  local empty=$(( width - filled ))

  printf "\r  ${BLUE}[${NC}"
  printf "%${filled}s" '' | tr ' ' '█'
  printf "%${empty}s" '' | tr ' ' '░'
  printf "${BLUE}]${NC} ${GREEN}%3d%%${NC}" "$pct"
  if [ -n "$label" ]; then
    printf " ${DIM}%s${NC}" "$label"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# ── CELEBRATION ──────────────────────────────────────────────────────────────

confetti_burst() {
  local colors=("$RED" "$GREEN" "$YELLOW" "$BLUE" "$MAGENTA" "$CYAN" "$ORANGE")
  local lines=6
  local cols=50

  for ((i=0; i<lines; i++)); do
    echo ""
    for ((j=0; j<cols; j++)); do
      if [ $((RANDOM % 5)) -eq 0 ]; then
        local c="${colors[$((RANDOM % ${#colors[@]}))]}"
        echo -ne "${c}${CONFETTI[$((RANDOM % ${#CONFETTI[@]}))]}${NC}"
      else
        echo -n " "
      fi
    done
  done
  echo ""
}

celebrate() {
  local msg="${1:-🎉 Mission Complete!}"
  echo ""

  # Confetti rain
  for ((i=0; i<3; i++)); do
    confetti_burst
    sleep 0.2
  done

  # Big success message
  echo ""
  echo -e "  ${BG_GREEN}${WHITE}${BOLD}  ✦ ${msg} ✦  ${NC}"
  echo ""

  # Random party emojis
  echo -n "  "
  for _ in {1..8}; do
    echo -ne "${PARTY_EMOJIS[$((RANDOM % ${#PARTY_EMOJIS[@]}))]} "
    sleep 0.1
  done
  echo ""
  echo ""

  # Wisdom
  local wisdoms=(
    "With great power comes great ping."
    "P2P is the answer. What was the question?"
    "Another proxy joins the mesh."
    "Decentralize all the things."
    "Your fleet is ready, commander."
    "The mesh grows stronger."
    "UDP hole punching through the universe."
  )
  echo -e "  ${DIM}${wisdoms[$((RANDOM % ${#wisdoms[@]}))]}${NC}"
  echo ""
}

# ──────────────────────────────────────────────────────────────────────────────
# ── STEP INDICATOR ───────────────────────────────────────────────────────────

# step <current> <total> <description>
step() {
  local current="$1"
  local total="$2"
  local desc="$3"
  echo ""
  echo -e "  ${BOLD}${BLUE}─── Step ${current}/${total}${NC} ${CYAN}${desc}${NC} ${BLUE}${BOLD}───${NC}"
  echo ""
}

# section <title>
section() {
  echo ""
  echo -e "  ${BOLD}${MAGENTA}╭─ ${1} ─────────────────────────────────────╮${NC}"
  echo ""
}

section_done() {
  echo ""
  echo -e "  ${BOLD}${GREEN}╰─ ✓ ${1} ───────────────────────────────╯${NC}"
  echo ""
}

# ──────────────────────────────────────────────────────────────────────────────
# ── PROMPT HELPERS ───────────────────────────────────────────────────────────

prompt_text() {
  local prompt="$1"
  local default="${2:-}"
  local input
  echo ""
  echo -ne "  ${BOLD}${prompt}${NC} "
  read -r input
  if [ -z "$input" ] && [ -n "$default" ]; then
    echo "$default"
    return 0
  fi
  echo "$input"
}

prompt_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  local input

  while true; do
    echo ""
    echo -e "  ${BOLD}${CYAN}${prompt}${NC}"
    echo ""
    local i=1
    for opt in "${options[@]}"; do
      echo -e "    ${GREEN}${i}${NC}) ${opt}"
      i=$((i + 1))
    done
    echo ""
    echo -ne "  ${BOLD}Select [1-${#options[@]}]:${NC} "
    read -r input

    if [[ "$input" =~ ^[0-9]+$ ]] && [ "$input" -ge 1 ] && [ "$input" -le "${#options[@]}" ]; then
      echo "${options[$((input - 1))]}"
      return 0
    else
      echo -e "\n  ${RED}✘ Invalid selection. Try again.${NC}"
    fi
  done
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local input

  local default_display
  if [ "$default" = "y" ]; then
    default_display="Y/n"
  else
    default_display="y/N"
  fi

  echo ""
  echo -ne "  ${BOLD}${prompt} ${CYAN}[${default_display}]${NC} "
  read -r input

  if [ -z "$input" ]; then
    [ "$default" = "y" ] && return 0 || return 1
  fi

  case "$input" in
    y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ──────────────────────────────────────────────────────────────────────────────
# ── CHECK REQUIREMENTS ───────────────────────────────────────────────────────

check_deps() {
  local missing=()
  for cmd in gh git curl python3; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${RED}✘ Missing dependencies:${NC} ${missing[*]}"
    echo -e "  ${YELLOW}ℹ Install them first:${NC}"
    echo "    sudo apt install ${missing[*]}"
    echo ""
    exit 1
  fi

  # Check fleet script exists
  if [ ! -f "$FLEET_SCRIPT" ]; then
    echo ""
    echo -e "  ${RED}✘ Fleet script not found at:${NC} ${FLEET_SCRIPT}"
    echo -e "  ${YELLOW}ℹ Make sure animamesh-fleet.sh is in the same directory.${NC}"
    echo ""
    exit 1
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# ── FLEET COMMAND WRAPPERS ───────────────────────────────────────────────────

# Wrapper that delegates to the fleet script
fleet_cmd() {
  bash "$FLEET_SCRIPT" "$@"
}

# ──────────────────────────────────────────────────────────────────────────────
# ── WIZARD COMMANDS ──────────────────────────────────────────────────────────

cmd_wizard() {
  render_title

  echo -e "  ${DIM}Welcome to the Meshify Fleet Wizard!${NC}"
  echo -e "  ${DIM}I'll guide you through setting up your proxy runner fleet.${NC}"
  echo ""
  echo -e "  ${DIM}You'll need:${NC}"
  echo -e "    ${CYAN}•${NC} GitHub ${BOLD}personal access tokens${NC} (one per throwaway account)"
  echo -e "    ${CYAN}•${NC} A ${BOLD}coordinator URL${NC} (your Cloudflare Worker)"
  echo -e "    ${CYAN}•${NC} An ${BOLD}auth token${NC} for the coordinator"
  echo ""
  echo -e "  ${DIM}Let's begin!${NC}"
  echo ""
  sleep 1

  if ! prompt_yes_no "Ready to start?"; then
    echo ""
    echo -e "  ${YELLOW}ℹ Come back when you're ready!${NC}"
    exit 0
  fi

  # ── Step 1: Coordinator Setup ──
  step 1 5 "Configure Coordinator"

  section "Coordinator"

  if [ -f "$FLEET_ENV" ]; then
    echo -e "  ${GREEN}✔${NC} Fleet config found at ${FLEET_ENV}"
    if prompt_yes_no "Use existing configuration?" "y"; then
      echo -e "  ${GREEN}✔${NC} Using existing configuration"
    else
      echo -e "  ${YELLOW}ℹ Removing old config...${NC}"
      rm -f "$FLEET_ENV"
      _wizard_setup_coordinator
    fi
  else
    _wizard_setup_coordinator
  fi

  section_done "Coordinator configured"

  # ── Step 2: Add Accounts ──
  step 2 5 "Register Throwaway Accounts"

  section "Accounts"

  _wizard_add_accounts

  section_done "Accounts registered"

  # ── Step 3: Set Secrets ──
  step 3 5 "Push Secrets to Forks"

  section "Secrets"

  _wizard_set_secrets

  section_done "Secrets deployed"

  # ── Step 4: Review & Deploy ──
  step 4 5 "Deploy the Fleet"

  echo ""
  fleet_cmd list

  echo ""
  echo -e "  ${CYAN}●${NC} Ready to deploy ${BOLD}$(fleet_cmd list 2>/dev/null | grep -c 'vi70x5\|vi')${NC} accounts"
  echo ""

  if prompt_yes_no "Deploy the fleet now?" "y"; then
    echo ""

    section "Deploying..."

    local protocols=("hysteria2" "vless")
    local tunnels=("n2n" "bore" "pinggy" "trycloudflare" "direct")

    local protocol
    protocol=$(prompt_choice "Choose protocol:" "${protocols[@]}")

    local tunnel
    tunnel=$(prompt_choice "Choose tunnel:" "${tunnels[@]}")

    echo ""
    echo -e "  ${CYAN}⟐${NC} Deploying with ${BOLD}${protocol}${NC} + ${BOLD}${tunnel}${NC}"
    echo ""

    with_spinner_verbose "Deploying to all accounts..." fleet_cmd deploy --all --protocol "$protocol" --tunnel "$tunnel"

    echo ""
    fleet_cmd status
  fi

  section_done "Deployment complete"

  # ── Step 5: Celebration ──
  step 5 5 "All Done!"

  celebrate "FLEET IS LIVE"

  # Show what to do next
  echo ""
  echo -e "  ${BOLD}${BLUE}╭─ Next Steps ─────────────────────────╮${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}  ${CYAN}•${NC} Check status:  ${WHITE}./${SCRIPT_NAME} status${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}  ${CYAN}•${NC} View logs:     ${WHITE}./${SCRIPT_NAME} logs <name>${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}  ${CYAN}•${NC} Add account:   ${WHITE}./${SCRIPT_NAME} add <token>${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}  ${CYAN}•${NC} Run wizard:    ${WHITE}./${SCRIPT_NAME}${NC}"
  echo -e "  ${BOLD}${BLUE}│${NC}"
  echo -e "  ${BOLD}${BLUE}╰──────────────────────────────────────╯${NC}"
  echo ""
}

_wizard_setup_coordinator() {
  echo ""

  # Coordinator URL
  while true; do
    echo -e "  ${CYAN}?${NC} What's your ${BOLD}Coordinator URL${NC}?"
    echo -e "    ${DIM}(The Cloudflare Worker endpoint like https://my-worker.workers.dev)${NC}"
    echo ""
    echo -ne "  ${BOLD}URL:${NC} "
    read -r coordinator_url

    if [ -n "$coordinator_url" ]; then
      echo ""
      echo -ne "  ${CYAN}⟐${NC} Testing connection... "
      if curl -sf --max-time 5 "${coordinator_url}/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        break
      else
        echo -e "${YELLOW}⚠${NC} Could not reach ${coordinator_url}"
        if ! prompt_yes_no "Continue anyway?" "n"; then
          continue
        fi
        break
      fi
    fi
  done

  # Auth token
  echo ""
  echo -e "  ${CYAN}?${NC} What's your ${BOLD}Auth Token${NC}?"
  echo -e "    ${DIM}(The shared secret the coordinator expects)${NC}"
  echo ""
  echo -ne "  ${BOLD}Token:${NC} "
  read -rs auth_token
  echo ""

  if [ -z "$auth_token" ]; then
    echo ""
    echo -e "  ${YELLOW}⚠${NC} No token provided — using placeholder. Update fleet.env later."
    auth_token="placeholder-$(head -c 12 /dev/urandom | base32 | tr -d '=' | tr '[:upper:]' '[:lower:]')"
  fi

  # Network ID
  echo ""
  echo -e "  ${CYAN}?${NC} ${BOLD}Network ID${NC} (mesh identifier)"
  echo -ne "  ${BOLD}[${NC}${DIM}animamesh-fleet${NC}${BOLD}]:${NC} "
  read -r network_id
  network_id="${network_id:-animamesh-fleet}"

  # n2n community (auto-generate)
  local n2n_community
  n2n_community="animamesh-$(head -c 8 /dev/urandom | base32 | tr -d '=' | tr '[:upper:]' '[:lower:]')"
  echo ""
  echo -e "  ${GREEN}✔${NC} n2n community auto-generated: ${CYAN}${n2n_community}${NC}"

  # n2n key (auto-generate)
  local n2n_key
  n2n_key="$(head -c 18 /dev/urandom | base64 | tr -d '=' | head -c 24)"
  echo -e "  ${GREEN}✔${NC} n2n key auto-generated: ${CYAN}${n2n_key}${NC}"

  # Write fleet.env
  mkdir -p "$ANIMAMESH_DIR"
  cat > "$FLEET_ENV" <<FLEETEOF
# Meshify Fleet — shared configuration
# Generated by wizard: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# WARNING: This file contains secrets. Keep it safe.

COORDINATOR_URL=${coordinator_url}
AUTH_TOKEN=${auth_token}
NETWORK_ID=${network_id}
N2N_COMMUNITY=${n2n_community}
N2N_KEY=${n2n_key}
N2N_SUPERNODE=supernode.ntop.org:7777
FLEETEOF
  chmod 600 "$FLEET_ENV"

  echo ""
  echo -e "  ${GREEN}✔${NC} Config saved to ${FLEET_ENV}"
}

_wizard_add_accounts() {
  local add_more=true

  while $add_more; do
    echo ""
    echo -e "  ${CYAN}⟐${NC} Paste a GitHub ${BOLD}personal access token${NC} to add an account."
    echo -e "    ${DIM}(Or press Enter to skip)${NC}"
    echo ""
    echo -ne "  ${BOLD}Token (ghp_...):${NC} "
    read -rs token
    echo ""

    if [ -z "$token" ]; then
      add_more=false
      continue
    fi

    echo ""
    echo -ne "  ${CYAN}⟐${NC} Registering account..."

    # Call fleet script add with the token, capture output
    local output
    output=$(fleet_cmd add "$token" 2>&1) && {
      echo -e "\r  ${GREEN}✔${NC} Account registered!              "
      echo ""
      # Extract the account name from output
      local account_name
      account_name=$(echo "$output" | grep -oP "'[^']+' \(\w+\)" | head -1 | cut -d"'" -f2)
      echo "$output" | grep -v "^$" | while IFS= read -r line; do
        echo "    $line"
      done
    } || {
      echo -e "\r  ${RED}✘${NC} Registration failed                "
      echo ""
      echo "$output" | sed 's/^/    /'
    }

    echo ""
    if ! prompt_yes_no "Add another account?" "y"; then
      add_more=false
    fi
  done
}

_wizard_set_secrets() {
  # Check fleet.env exists
  if [ ! -f "$FLEET_ENV" ]; then
    echo -e "  ${YELLOW}⚠${NC} No fleet.env found. Set up coordinator first."
    return 1
  fi

  # Source the fleet.env
  set -a
  # shellcheck source=/dev/null
  source "$FLEET_ENV"
  set +a

  # List existing accounts
  local accounts=()
  for d in "$ACCOUNTS_DIR"/*/; do
    [ -d "$d" ] || continue
    accounts+=("$(basename "$d")")
  done

  if [ ${#accounts[@]} -eq 0 ]; then
    echo -e "  ${YELLOW}⚠${NC} No accounts to set secrets on."
    return 0
  fi

  echo -e "  ${CYAN}⟐${NC} Pushing secrets to ${BOLD}${#accounts[@]}${NC} forks..."
  echo ""

  local total=${#accounts[@]}
  local current=0

  for name in "${accounts[@]}"; do
    current=$((current + 1))
    local account_dir="$ACCOUNTS_DIR/$name"
    local fork_name
    fork_name=$(grep "^fork=" "$account_dir/.meta" 2>/dev/null | cut -d= -f2- || echo "unknown")
    local gh_user
    gh_user=$(grep "^user=" "$account_dir/.meta" 2>/dev/null | cut -d= -f2- || echo "unknown")

    printf "\r  ${CYAN}⟐${NC} [${current}/${total}] ${BOLD}${fork_name}${NC} (${gh_user})..."
    export GH_CONFIG_DIR="$account_dir/gh"

    # Set all secrets
    echo "$COORDINATOR_URL" 2>/dev/null | gh secret set COORDINATOR_URL --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true
    echo "$AUTH_TOKEN" 2>/dev/null | gh secret set AUTH_TOKEN --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true
    echo "$NETWORK_ID" 2>/dev/null | gh secret set NETWORK_ID --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true
    echo "$N2N_COMMUNITY" 2>/dev/null | gh secret set N2N_COMMUNITY --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true
    echo "$N2N_KEY" 2>/dev/null | gh secret set N2N_KEY --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true
    echo "$N2N_SUPERNODE" 2>/dev/null | gh secret set N2N_SUPERNODE --repo "${gh_user}/${fork_name}" --quiet 2>/dev/null || true

    printf "\r  ${GREEN}✔${NC} [${current}/${total}] ${BOLD}${fork_name}${NC} ${DIM}— secrets set${NC}\n"
  done

  echo ""
  echo -e "  ${GREEN}✔${NC} All secrets deployed!"
}

# ──────────────────────────────────────────────────────────────────────────────
# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_add() {
  local token="${1:-}"
  if [ -z "$token" ]; then
    echo ""
    echo -ne "  ${CYAN}⟐${NC} Paste GitHub token: "
    read -rs token
    echo ""
    echo ""
  fi

  with_spinner "Registering account..." fleet_cmd add "$token" ||
    with_spinner_verbose "Trying again..." fleet_cmd add "$token"
}

cmd_deploy() {
  local protocol="${2:-hysteria2}"
  local tunnel="${4:-n2n}"

  # Count accounts
  local count=0
  for d in "$ACCOUNTS_DIR"/*/; do
    [ -d "$d" ] && count=$((count + 1))
  done

  if [ "$count" -eq 0 ]; then
    echo -e "  ${RED}✘${NC} No accounts registered. Run the wizard first."
    exit 1
  fi

  echo ""
  echo -e "  ${CYAN}⟐${NC} Deploying ${BOLD}${protocol}${NC} / ${BOLD}${tunnel}${NC} to ${count} account(s)"
  echo ""

  with_spinner_verbose "Triggering workflows..." fleet_cmd deploy --all --protocol "$protocol" --tunnel "$tunnel"

  echo ""
  cmd_status
  echo ""

  celebrate "Deploy triggered!"
}

cmd_status() {
  render_title
  echo ""
  fleet_cmd status
  echo ""

  # Show a quick overview
  local running=0
  local idle=0
  local failed=0
  while IFS= read -r line; do
    if echo "$line" | grep -q "● running"; then
      running=$((running + 1))
    elif echo "$line" | grep -q "○ idle"; then
      idle=$((idle + 1))
    elif echo "$line" | grep -q "✗"; then
      failed=$((failed + 1))
    fi
  done < <(fleet_cmd status 2>/dev/null)

  echo -e "  ${GREEN}● ${running} running${NC}  ${BLUE}○ ${idle} idle${NC}  ${RED}✗ ${failed} failed${NC}"
  echo ""
}

cmd_list() {
  render_title
  fleet_cmd list
}

cmd_remove() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo ""
    echo -ne "  ${CYAN}⟐${NC} Account name to remove: "
    read -r name
    echo ""
  fi

  if prompt_yes_no "Remove ${BOLD}${name}${NC}?" "n"; then
    with_spinner "Removing ${name}..." fleet_cmd remove "$name"
    echo ""
    echo -e "  ${GREEN}✔${NC} Account removed."
  fi
}

cmd_logs() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo ""
    echo -ne "  ${CYAN}⟐${NC} Account name: "
    read -r name
    echo ""
  fi
  fleet_cmd logs "$name" 2>&1 | head -100
}

cmd_confetti() {
  render_title
  celebrate "${1:-🎉 Just because!}"
}

# ──────────────────────────────────────────────────────────────────────────────
# ── MAIN ─────────────────────────────────────────────────────────────────────

check_deps

case "${1:-wizard}" in
  wizard|"")
    render_title
    cmd_wizard
    ;;
  add)
    shift
    cmd_add "$@"
    ;;
  deploy)
    shift
    cmd_deploy "$@"
    ;;
  status)
    cmd_status
    ;;
  list)
    cmd_list
    ;;
  remove)
    shift
    cmd_remove "$@"
    ;;
  logs)
    shift
    cmd_logs "$@"
    ;;
  confetti)
    shift
    cmd_confetti "$@"
    ;;
  init-secrets)
    render_title
    _wizard_set_secrets
    ;;
  help|--help|-h)
    render_title
    echo "Usage:"
    echo "  ./$SCRIPT_NAME                  # Interactive wizard"
    echo "  ./$SCRIPT_NAME add <token>       # Quick add account"
    echo "  ./$SCRIPT_NAME deploy            # Deploy to fleet"
    echo "  ./$SCRIPT_NAME status            # Fleet status"
    echo "  ./$SCRIPT_NAME list              # List accounts"
    echo "  ./$SCRIPT_NAME remove <name>     # Remove account"
    echo "  ./$SCRIPT_NAME logs <name>       # View logs"
    echo "  ./$SCRIPT_NAME confetti          # 🎉"
    echo "  ./$SCRIPT_NAME init-secrets      # Push secrets to forks"
    ;;
  *)
    echo -e "  ${RED}✘ Unknown: ${1}${NC}"
    echo "  Use: ./$SCRIPT_NAME help"
    exit 1
    ;;
esac
