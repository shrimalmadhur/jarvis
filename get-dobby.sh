#!/usr/bin/env bash
# Dobby installer/upgrader — designed to be piped from curl:
#
#   curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash
#
# By default, installs the latest released version. If no releases exist,
# falls back to the main branch.
#
#   curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch main
#   curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --version v0.2.0
#
# Or download-and-inspect first:
#
#   curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh -o get-dobby.sh
#   less get-dobby.sh
#   sudo bash get-dobby.sh
#
set -euo pipefail

REPO_URL="https://github.com/shrimalmadhur/dobby.git"
SRC_DIR="/usr/local/src/dobby"
INSTALL_DIR="/usr/local/lib/dobby"
LOCK_DIR="/var/lock/dobby-install.lock"
BRANCH=""
VERSION=""
EXPLICIT_BRANCH=false
OS="$(uname -s)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

resolve_latest_version() {
    # Derive GitHub API URL from REPO_URL so forks work correctly
    local github_repo
    github_repo=$(echo "$REPO_URL" | sed 's|.*github.com/||; s|\.git$||')
    local api_url="https://api.github.com/repos/$github_repo/releases/latest"
    local tag=""
    local http_code=""
    local response=""

    # Try curl first (most likely available), fall back to wget
    if command -v curl &>/dev/null; then
        response=$(curl -fsSL --max-time 10 -w "\n%{http_code}" "$api_url" 2>/dev/null || true)
        http_code=$(echo "$response" | tail -1)
        if [[ "$http_code" == "200" ]]; then
            tag=$(echo "$response" | grep -m1 '"tag_name"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)
        elif [[ "$http_code" == "404" ]]; then
            # Genuinely no releases — not an error
            tag=""
        else
            # IMPORTANT: redirect to stderr — this function's stdout is captured
            # by command substitution; writing diagnostics to stdout would corrupt
            # the return value.
            if [[ -z "$http_code" ]]; then
                yellow "  Warning: Could not reach GitHub API — will use main branch" >&2
            else
                yellow "  Warning: Could not query GitHub API (HTTP $http_code) — will use main branch" >&2
            fi
            tag=""
        fi
    elif command -v wget &>/dev/null; then
        # NOTE: wget path doesn't distinguish HTTP 404 (no releases) from other
        # failures (rate limit, network error). All failures silently return empty.
        # This is acceptable because curl is overwhelmingly more common and is
        # already required to pipe this script (curl | bash).
        tag=$(wget -qO- --timeout=10 "$api_url" 2>/dev/null | grep -m1 '"tag_name"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)
    fi

    echo "${tag:-}"
}

usage() {
    cat <<'EOF'
Usage: curl -fsSL <url>/get-dobby.sh | sudo bash [-s -- OPTIONS]

By default, installs the latest released version. If no releases exist,
falls back to the main branch.

Options:
  --branch NAME     Clone/checkout a specific branch (e.g., main, dev)
  --version TAG     Checkout a specific version tag (e.g., v0.2.0)
  --help            Show this help message

Examples:
  # Install latest release (default)
  curl -fsSL <url>/get-dobby.sh | sudo bash

  # Install from a specific branch
  curl -fsSL <url>/get-dobby.sh | sudo bash -s -- --branch main

  # Install a specific version
  curl -fsSL <url>/get-dobby.sh | sudo bash -s -- --version v0.2.0
EOF
    exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch)
            [[ -n "${2:-}" ]] || { red "Error: --branch requires a value"; exit 1; }
            BRANCH="$2"; EXPLICIT_BRANCH=true; shift 2 ;;
        --version|--tag)
            [[ -n "${2:-}" ]] || { red "Error: --version requires a value"; exit 1; }
            VERSION="$2"; shift 2 ;;
        --help|-h)
            usage ;;
        *)
            red "Unknown option: $1"
            echo "Run with --help for usage information."
            exit 1 ;;
    esac
done

# Reject mutually exclusive flags
if [[ -n "$VERSION" ]] && [[ "$EXPLICIT_BRANCH" == true ]]; then
    red "Error: --branch and --version are mutually exclusive"
    exit 1
fi

# Validate branch/version names — first char must not be a hyphen, no .. sequences
if [[ -n "$BRANCH" ]] && ! [[ "$BRANCH" =~ ^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$ ]]; then
    red "Error: Invalid branch name '$BRANCH'"
    exit 1
fi
if [[ -n "$BRANCH" ]] && [[ "$BRANCH" == *".."* ]]; then
    red "Error: Invalid branch name '$BRANCH'"
    exit 1
fi
if [[ -n "$VERSION" ]] && ! [[ "$VERSION" =~ ^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$ ]]; then
    red "Error: Invalid version '$VERSION'"
    exit 1
fi
if [[ -n "$VERSION" ]] && [[ "$VERSION" == *".."* ]]; then
    red "Error: Invalid version '$VERSION'"
    exit 1
fi

# ---------------------------------------------------------------------------
# Check root
# ---------------------------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
    red "Error: This script must be run with sudo"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$(whoami)}"
ACTUAL_GROUP="$(id -gn "$ACTUAL_USER")"

# ---------------------------------------------------------------------------
# Resolve default version (latest release) if no explicit flags given
# ---------------------------------------------------------------------------
if [[ -z "$BRANCH" ]] && [[ -z "$VERSION" ]]; then
    echo "Resolving latest release..."
    LATEST=$(resolve_latest_version)
    if [[ -n "$LATEST" ]]; then
        VERSION="$LATEST"
        green "  Latest release: $VERSION"
    else
        BRANCH="main"
        yellow "  No releases found — installing from main branch"
    fi
elif [[ -z "$BRANCH" ]]; then
    # --version was explicitly set, BRANCH not needed yet
    BRANCH="main"  # Needed for initial clone
fi

# Ensure BRANCH has a value for cloning (even when using VERSION, we clone main first)
if [[ -z "$BRANCH" ]]; then
    BRANCH="main"
fi

# Validate auto-resolved version (same checks as user-provided VERSION above)
if [[ -n "$VERSION" ]] && ! [[ "$VERSION" =~ ^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$ ]]; then
    yellow "  Warning: Unexpected tag format '$VERSION' — falling back to main branch"
    VERSION=""
    BRANCH="main"
fi
if [[ -n "$VERSION" ]] && [[ "$VERSION" == *".."* ]]; then
    yellow "  Warning: Unexpected tag format '$VERSION' — falling back to main branch"
    VERSION=""
    BRANCH="main"
fi

# ---------------------------------------------------------------------------
# Portable lock (mkdir is atomic on all filesystems)
# ---------------------------------------------------------------------------
acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        # Write our PID so stale detection works
        echo $$ > "$LOCK_DIR/pid"
        return 0
    fi

    # Lock dir exists — check if it's stale
    if [ -f "$LOCK_DIR/pid" ]; then
        OLD_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
        if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
            # Process is gone — stale lock
            yellow "Removing stale lock (PID $OLD_PID no longer running)"
            rm -rf "$LOCK_DIR"
            mkdir "$LOCK_DIR" 2>/dev/null || { red "Error: Could not acquire lock"; exit 1; }
            echo $$ > "$LOCK_DIR/pid"
            return 0
        fi
    fi

    red "Error: Another install/upgrade is already running (lock: $LOCK_DIR)"
    exit 1
}

acquire_lock
# Clean up lock on exit — no exec used, so this trap always fires
trap 'rm -rf "$LOCK_DIR"' EXIT

# ---------------------------------------------------------------------------
# Minimal bootstrap — ensure git is available
# ---------------------------------------------------------------------------
echo ""
echo "Bootstrapping..."

if ! command -v git &>/dev/null; then
    if [ "$OS" = "Darwin" ]; then
        if ! xcode-select -p &>/dev/null; then
            xcode-select --install 2>/dev/null || true
            yellow "Xcode CLI tools install triggered — if a dialog appeared, complete it and re-run this script."
            exit 1
        fi
        # xcode-select claims tools are installed but git still missing
        if ! command -v git &>/dev/null; then
            red "Error: Xcode CLI tools appear installed but git is not available"
            red "Try: sudo xcode-select --reset"
            exit 1
        fi
    elif [ "$OS" = "Linux" ]; then
        echo "  Installing git..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq git > /dev/null
        elif command -v dnf &>/dev/null; then
            dnf install -y -q git > /dev/null
        elif command -v pacman &>/dev/null; then
            pacman -Sy --noconfirm --needed git > /dev/null
        elif command -v apk &>/dev/null; then
            apk add --no-cache git > /dev/null
        else
            red "Error: Could not install git — no supported package manager found"
            exit 1
        fi
    else
        red "Error: Unsupported OS '$OS'. This script supports macOS (Darwin) and Linux."
        exit 1
    fi
fi

if ! command -v git &>/dev/null; then
    red "Error: git is required but could not be installed"
    exit 1
fi

green "  git $(git --version | awk '{print $3}')"

# ---------------------------------------------------------------------------
# Clone or update source
# ---------------------------------------------------------------------------
if [ -d "$SRC_DIR" ]; then
    # --- Existing source directory ---
    if ! git -C "$SRC_DIR" rev-parse --git-dir &>/dev/null; then
        # Corrupted / not a git repo — wipe and re-clone atomically
        yellow "Warning: $SRC_DIR exists but is not a valid git repo. Re-cloning..."
        rm -rf "$SRC_DIR"
        TEMP_DIR="${SRC_DIR}.tmp.$$"
        # Update trap to also clean temp dir
        trap 'rm -rf "$TEMP_DIR" "$LOCK_DIR"' EXIT
        git clone --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR"
        mv "$TEMP_DIR" "$SRC_DIR"
        trap 'rm -rf "$LOCK_DIR"' EXIT
        chown -R "$ACTUAL_USER:$ACTUAL_GROUP" "$SRC_DIR"

        if [ -n "$VERSION" ]; then
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" fetch origin --tags
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" checkout "$VERSION"
        fi
    else
        # Valid repo — fetch and update
        echo ""
        echo "Updating source..."
        if [ -n "$VERSION" ]; then
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" fetch origin --tags
        else
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" fetch origin
        fi

        yellow "Warning: Discarding any local changes in $SRC_DIR"
        sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" reset --hard HEAD
        sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" clean -fd

        if [ -n "$VERSION" ]; then
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" checkout "$VERSION"
        else
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" checkout "$BRANCH"
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
        fi
    fi
else
    # --- Fresh clone (atomic: clone to temp dir, then mv) ---
    echo ""
    echo "Cloning Dobby..."
    mkdir -p "$(dirname "$SRC_DIR")"
    TEMP_DIR="${SRC_DIR}.tmp.$$"
    # Update trap to also clean temp dir on failure
    trap 'rm -rf "$TEMP_DIR" "$LOCK_DIR"' EXIT
    git clone --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR"
    mv "$TEMP_DIR" "$SRC_DIR"
    trap 'rm -rf "$LOCK_DIR"' EXIT
    chown -R "$ACTUAL_USER:$ACTUAL_GROUP" "$SRC_DIR"

    if [ -n "$VERSION" ]; then
        sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" fetch origin --tags
        sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" checkout "$VERSION"
    fi
fi

green "  Source ready at $SRC_DIR"

# ---------------------------------------------------------------------------
# Delegate to install.sh (handles both fresh install and re-install)
#
# install.sh is idempotent: preserves data/, skips env file if exists,
# re-syncs cron. Using it for both paths avoids the upgrade.sh sudo-prompt
# issue when stdin is consumed by the curl pipe.
# ---------------------------------------------------------------------------
echo ""
if [ -d "$INSTALL_DIR" ]; then
    green "Upgrading Dobby..."
else
    green "Installing Dobby..."
fi

# install.sh derives REPO_DIR from its own location, so running it from
# the source clone Just Works. It expects to run as root.
bash "$SRC_DIR/scripts/install.sh"
