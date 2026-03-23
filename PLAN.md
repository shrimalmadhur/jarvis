## Implementation Plan: Curl-Based Install & Upgrade for Dobby

### Overview

Create a single entry-point script (`get-dobby.sh`) hosted in the repo root that users can pipe to bash via curl. This script handles both fresh installs and upgrades by cloning the repo to a persistent source directory (`/usr/local/src/dobby`), then **always delegating to `scripts/install.sh`** — which is already fully idempotent (preserves DB, skips existing env file, re-syncs cron).

**User experience:**
```bash
# First-time install
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash

# Upgrade (same command)
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash

# With options
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch dev
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --version v0.2.0

# Safer: inspect before running
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh -o get-dobby.sh
less get-dobby.sh
sudo bash get-dobby.sh
```

### Key Design Decision: Always Use `install.sh`

Both reviewers identified that calling `upgrade.sh` from the curl pipe is fundamentally broken:

1. `upgrade.sh` runs as non-root and interactively prompts for sudo (line 23-25) — this fails when stdin is consumed by the curl pipe.
2. `upgrade.sh` and `install.sh` have incompatible privilege models — reconciling them adds complexity for no benefit.

`install.sh` already handles re-installs correctly:
- Backs up the database (lines 160-167)
- Preserves `data/` directory across re-deploys (line 169)
- Skips env file if it already exists (lines 203-236)
- Re-installs/updates service files idempotently (lines 238-322)
- Re-syncs cron jobs (line 357)
- Runs as root with `SUDO_USER` detection — no interactive prompts needed

Therefore `get-dobby.sh` always calls `install.sh`, eliminating the entire upgrade.sh privilege problem. Users who want the lighter upgrade path can still use `make upgrade` from a manual clone.

---

### Codebase Analysis

**Key files examined:**

| File | Purpose |
|------|---------|
| `scripts/install.sh` (358 lines) | First-time install: prerequisites, Bun, build, deploy to `/usr/local/lib/dobby/`, service setup, env file, cron. Already idempotent for re-installs. |
| `scripts/upgrade.sh` (265 lines) | Upgrade: runs as user, `git pull`, rebuild, backup DB, redeploy, restart service, re-sync cron. **Not modified by this plan.** |
| `scripts/run.sh` (19 lines) | Service runner: sources `/etc/dobby/env`, starts `bun server.js` on port 7749 |
| `scripts/install-cron.sh` (136 lines) | Queries DB for enabled agents, generates crontab entries |
| `dobby.service` | Systemd unit template with `__USER__`, `__GROUP__`, `__INSTALL_DIR__` placeholders |
| `dobby.plist` | macOS LaunchAgent template with `__INSTALL_DIR__` placeholder |
| `Makefile` | `install` → `sudo bash scripts/install.sh`, `upgrade` → `bash scripts/upgrade.sh` |
| `next.config.ts` | `output: "standalone"` — produces self-contained server in `.next/standalone/` |

**Critical patterns:**

1. **`scripts/install.sh` expects `REPO_DIR`** (line 7): `REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"` — it derives the repo root from its own location. The curl script must clone to a known location so this resolves correctly.

2. **`scripts/install.sh` requires root** (line 24): `if [ "$EUID" -ne 0 ]` — the curl command must use `sudo bash`. This is compatible with `curl | sudo bash`.

3. **`scripts/install.sh` uses `SUDO_USER`** (line 30): `ACTUAL_USER="${SUDO_USER:-$(whoami)}"` — runs bun install/build as the real user, not root. No interactive prompts.

4. **Install dir**: `/usr/local/lib/dobby/` (deployed app), data preserved at `/usr/local/lib/dobby/data/dobby.db`

5. **Source dir** (new): `/usr/local/src/dobby/` — where the git clone will live

6. **GitHub remote**: Must use HTTPS URL for curl installs: `https://github.com/shrimalmadhur/dobby.git`

**Architecture flow (proposed):**
```
User: curl ... | sudo bash
            ↓
      get-dobby.sh (runs as root)
            ↓
      acquire lock (mkdir /tmp/dobby-install.lock)
            ↓
  ┌─── /usr/local/src/dobby exists? ───┐
  │ NO                                  │ YES
  ↓                                     ↓
git clone as root to temp dir       validate git repo
  chown temp dir to $SUDO_USER      git fetch + reset
  mv atomically to SRC_DIR            as $SUDO_USER
  │                                     │
  └──────────┬──────────────────────────┘
             ↓
     chown -R $SUDO_USER:$GROUP $SRC_DIR
             ↓
     scripts/install.sh (already root)
       (unchanged — idempotent)
```

---

### Detailed Steps

#### Step 1: Create `get-dobby.sh` (new file, repo root)

The main entry-point script. Must be idempotent — running it twice does an upgrade on the second run.

**Full logic:**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Constants
REPO_URL="https://github.com/shrimalmadhur/dobby.git"
SRC_DIR="/usr/local/src/dobby"
BRANCH="main"
VERSION=""

# Color helpers (same style as existing scripts)
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"; shift 2 ;;
    --version|--tag)
      VERSION="$2"; shift 2 ;;
    *)
      red "Unknown option: $1"
      echo "Usage: curl -fsSL <url> | sudo bash -s -- [--branch NAME] [--version TAG]"
      exit 1 ;;
  esac
done

# --- Validate inputs ---
# Prevent shell injection and option confusion via --branch or --version
if [[ -n "$BRANCH" ]] && ! [[ "$BRANCH" =~ ^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$ ]]; then
    red "Error: Invalid branch name: $BRANCH"
    exit 1
fi
if [[ -n "$VERSION" ]] && ! [[ "$VERSION" =~ ^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$ ]]; then
    red "Error: Invalid version/tag: $VERSION"
    exit 1
fi
# --branch and --version are mutually exclusive
if [[ -n "$VERSION" ]] && [[ "$BRANCH" != "main" ]]; then
    red "Error: --branch and --version are mutually exclusive"
    exit 1
fi

# --- Verify root ---
if [ "$EUID" -ne 0 ]; then
    red "Error: This script must be run with sudo"
    echo "Usage: curl -fsSL <url> | sudo bash"
    exit 1
fi

# --- Concurrent execution guard (cross-platform) ---
LOCK_DIR="/tmp/dobby-install.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Check if the PID that created the lock is still running
    if [ -f "$LOCK_DIR/pid" ]; then
        OLD_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
        if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
            # Stale lock — previous run crashed
            yellow "Warning: Removing stale lock from PID $OLD_PID"
            rm -rf "$LOCK_DIR"
            mkdir "$LOCK_DIR"
        else
            red "Error: Another install/upgrade is already running (PID ${OLD_PID:-unknown})"
            exit 1
        fi
    else
        red "Error: Another install/upgrade is already running"
        exit 1
    fi
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

# --- Detect real user and OS ---
ACTUAL_USER="${SUDO_USER:-$(whoami)}"
ACTUAL_GROUP="$(id -gn "$ACTUAL_USER")"
OS="$(uname -s)"

# --- Minimal bootstrap: ensure git is available ---
if ! command -v git &>/dev/null; then
    echo "Installing git..."
    if [ "$OS" = "Darwin" ]; then
        # Match install.sh pattern: trigger xcode-select, then exit so user
        # can complete the GUI dialog and re-run
        if ! xcode-select -p &>/dev/null; then
            xcode-select --install 2>/dev/null || true
            yellow "Xcode CLI tools install triggered — if a dialog appeared, complete it and re-run this script."
            exit 1
        fi
    elif command -v apt-get &>/dev/null; then
        apt-get update -qq && apt-get install -y -qq git > /dev/null
    elif command -v dnf &>/dev/null; then
        dnf install -y -q git > /dev/null
    elif command -v pacman &>/dev/null; then
        pacman -Sy --noconfirm git > /dev/null
    elif command -v apk &>/dev/null; then
        apk add --no-cache git > /dev/null
    else
        red "Error: git is not installed and no supported package manager found"
        exit 1
    fi
fi

# --- Clone or update source ---
if [ -d "$SRC_DIR" ]; then
    # Validate existing directory is a git repo
    if sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" rev-parse --git-dir > /dev/null 2>&1; then
        echo "Updating existing source at $SRC_DIR..."
        sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" fetch origin
        if [ -n "$VERSION" ]; then
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" checkout "$VERSION"
        else
            yellow "Warning: Discarding any local changes in $SRC_DIR"
            sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
        fi
    else
        # Directory exists but is not a valid git repo (partial clone, corruption)
        yellow "Warning: $SRC_DIR exists but is not a valid git repo. Re-cloning..."
        rm -rf "$SRC_DIR"
        # Clone as root (user can't write to /usr/local/src/), then chown
        mkdir -p "$(dirname "$SRC_DIR")"
        git clone --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
        if [ -n "$VERSION" ]; then
            git -C "$SRC_DIR" checkout "$VERSION"
        fi
    fi
else
    echo "Cloning Dobby to $SRC_DIR..."
    # /usr/local/src/ is owned by root (755) — non-root users cannot create
    # entries in it. Clone as root to a temp directory, then move atomically
    # to prevent partial clones from poisoning the state on interruption.
    mkdir -p "$(dirname "$SRC_DIR")"
    TEMP_DIR="${SRC_DIR}.tmp.$$"
    # Add temp dir cleanup to the existing EXIT trap (which also cleans up the lock)
    trap 'rm -rf "$TEMP_DIR" "$LOCK_DIR"' EXIT
    git clone --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR"
    if [ -n "$VERSION" ]; then
        git -C "$TEMP_DIR" checkout "$VERSION"
    fi
    mv "$TEMP_DIR" "$SRC_DIR"
    # Restore trap to only clean up the lock
    trap 'rm -rf "$LOCK_DIR"' EXIT
fi

# Ensure consistent ownership (all files belong to the real user).
# This is critical for both the clone-as-root path (fresh install / corruption
# re-clone) and as a safety net for the update path.
chown -R "$ACTUAL_USER:$ACTUAL_GROUP" "$SRC_DIR"

green "Source ready at $SRC_DIR ($(sudo -u "$ACTUAL_USER" git -C "$SRC_DIR" rev-parse --short HEAD))"

# --- Delegate to install.sh ---
# install.sh is fully idempotent: preserves data/, skips existing env file,
# re-installs service, re-syncs cron. Works for both fresh install and upgrade.
echo ""
echo "Running install..."
exec bash "$SRC_DIR/scripts/install.sh"
```

**Key design decisions addressing review findings:**

1. **Always use `install.sh`** — eliminates CRITICAL-1 (upgrade.sh sudo prompt), WARNING-6 (user-context mismatch), and Completeness findings 1 and 7. `install.sh` runs as root with `SUDO_USER` detection, no interactive prompts.

2. **All git operations run as `$SUDO_USER`** on the update path via `sudo -u "$ACTUAL_USER" git ...` — eliminates original CRITICAL-2 (mixed file ownership) and Completeness-2 (`safe.directory` error). Files are always created with the correct owner.

3. **Fresh clone and corruption re-clone run as root** — `/usr/local/src/` is `root:root 755`, so non-root users cannot create entries in it. The clone runs as root, then `chown -R` at line 221 fixes ownership before delegating to `install.sh`. This directly addresses Round 2 CRITICAL-1 (NEW-1).

4. **Atomic clone via temp dir + mv** — eliminates original CRITICAL-3 (partial clone poisoning). If interrupted, the temp dir is cleaned up by the trap. On re-run, `$SRC_DIR` doesn't exist so it clones fresh.

5. **Existing directory validation** — if `$SRC_DIR` exists but `git rev-parse --git-dir` fails, it's wiped and re-cloned.

6. **`chown -R` after every git operation** — belt-and-suspenders ownership fix (Completeness-3). Critical for fresh installs where clone runs as root. Safety net for updates where git runs as `$SUDO_USER`.

7. **Cross-platform lockfile** using `mkdir` (atomic on all filesystems) at `/tmp/dobby-install.lock` — eliminates WARNING-4 (concurrent execution) and Round 2 CRITICAL-2 (flock/var/lock don't exist on macOS). Includes stale lock detection via PID file and cleanup via EXIT trap.

8. **Input validation** — branch/version names validated against `^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$` — the first character must not be a hyphen, preventing option confusion (Round 2 WARNING-4/WARNING-6). `--branch` and `--version` are mutually exclusive (Round 2 WARNING-1/WARNING-3).

9. **`--version`/`--tag` support** — addresses Completeness-5. Users can pin to a release tag.

10. **No `--uninstall` flag** — deferred to a separate issue (WARNING-5/Completeness-4). Uninstall is a destructive operation that deserves its own design and review, not a hastily-specified flag.

11. **macOS git bootstrap matches install.sh pattern** — `xcode-select -p` checks if tools are already installed; if not, triggers the dialog, prints a message, and exits so the user can re-run after completing the GUI install. This directly addresses Round 2 WARNING-3/WARNING-5.

12. **Warning before `git reset --hard`** — addresses Round 2 WARNING-2/WARNING-4.

#### Step 2: Update `README.md` — add curl install instructions

Add the curl install command to the "Deploying to the Castle" section alongside the existing `make install`/`make upgrade` instructions:

**In the deployment section, add before the existing `make install` instructions:**

```markdown
### Quick Install (via curl)

```bash
# Install or upgrade Dobby with a single command:
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash

# Pin to a specific version:
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --version v0.2.0

# Use a specific branch:
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh | sudo bash -s -- --branch dev

# Or inspect before running:
curl -fsSL https://raw.githubusercontent.com/shrimalmadhur/dobby/main/get-dobby.sh -o get-dobby.sh
less get-dobby.sh
sudo bash get-dobby.sh
```
```

This addresses Round 2 NEW-3 (README not updated with curl install command despite plan claiming it).

#### Step 3: No changes to `Makefile`

The `get` target was removed per WARNING-1 (circular — you'd need the repo to run `make get`, but if you have the repo you'd just `make install`). Existing `install` and `upgrade` targets remain unchanged for manual-clone users.

#### Step 4: No changes to `scripts/install.sh`

The `.source-dir` breadcrumb from the original plan is removed per WARNING-2/Completeness-6 — nothing reads it, it's dead code. `install.sh` is already fully idempotent and needs no modifications for this feature.

#### Step 5: No changes to `scripts/upgrade.sh`

The `--skip-pull` flag from the original plan is no longer needed since `get-dobby.sh` always delegates to `install.sh`. `upgrade.sh` continues to work as-is for `make upgrade` from a manual clone.

---

### File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `get-dobby.sh` | **CREATE** | Curl-friendly entry point (~120 lines) |
| `README.md` | **MODIFY** | Add curl install instructions to deployment section |

**No other existing files are modified.** This is a minimally invasive change.

### New Dependencies

None. The script only requires `git` (bootstrapped if missing) and `curl` (implied by the curl-pipe invocation).

### Edge Cases & Risks

1. **User already has a manual clone elsewhere**: The curl script creates its own clone at `/usr/local/src/dobby`. The manual clone is unaffected. Users can still use `make install` / `make upgrade` from their clone.

2. **Interrupted fresh clone**: The atomic temp-dir-then-mv pattern ensures `$SRC_DIR` either contains a complete clone or doesn't exist at all. The `trap` cleans up the temp dir on any failure. Re-running starts a fresh clone.

3. **Interrupted upgrade (git fetch succeeds, install.sh fails)**: Safe — re-running `get-dobby.sh` fetches again (idempotent) and re-runs `install.sh` (also idempotent).

4. **Corrupted source directory**: If `$SRC_DIR` exists but `git rev-parse --git-dir` fails, the script removes the directory and does a fresh clone as root, then chowns to the real user.

5. **Permission/ownership on fresh install**: `/usr/local/src/` is `root:root 755`. Fresh clones (and corruption re-clones) run as root since the user cannot create entries in the parent directory. The `chown -R` after cloning transfers ownership to `$SUDO_USER` before `install.sh` runs. On the update path, git runs as `$SUDO_USER` directly (the directory already exists and is user-owned), with `chown -R` as a safety net.

6. **Network failure during clone**: `set -euo pipefail` ensures clean exit. The trap removes the temp directory and the lock directory. Re-running starts fresh.

7. **Piping to bash loses stdin**: `curl ... | sudo bash` means stdin is consumed by the pipe. `install.sh` never prompts for interactive input (it uses `$SUDO_USER` detection and automated package installation), so this is safe. `upgrade.sh` is NOT called, avoiding its interactive sudo prompt.

8. **macOS vs Linux differences**: Already handled by `install.sh`. `get-dobby.sh` handles git bootstrap on macOS by matching `install.sh`'s pattern: check `xcode-select -p`, trigger install dialog if needed, print message, and exit for the user to re-run. The lockfile uses portable `mkdir` (not Linux-specific `flock`).

9. **Running without sudo**: Detected early with clear error message and correct invocation example.

10. **Concurrent execution**: Lockfile directory at `/tmp/dobby-install.lock` using `mkdir` (atomic on all filesystems, works on both Linux and macOS). Stale lock detection via PID file. Cleanup via EXIT trap. Second invocation fails immediately with a clear message.

11. **`curl | sudo bash` security**: This is standard practice (rustup, Homebrew, nvm, etc.) but users concerned about MITM/supply-chain attacks can download the script first and inspect it. The README documents the inspect-first approach as an alternative.

12. **`--branch` and `--version` together**: Rejected with a clear error message. These are mutually exclusive — `--branch` selects a branch HEAD, `--version` checks out a specific tag/ref.

13. **Branch/version names starting with `-`**: The regex `^[a-zA-Z0-9._/][a-zA-Z0-9._/-]*$` requires the first character to be non-hyphen, preventing values like `--foo` from being interpreted as git options.

### Testing Strategy

1. **Fresh install on Linux VM**: `curl ... | sudo bash` from a clean Ubuntu/Debian
2. **Fresh install on macOS**: Verify xcode-select detection and launchd path
3. **Upgrade on existing install**: Run the curl command again after fresh install — should preserve DB, skip env file, rebuild and redeploy
4. **Idempotency**: Run 3 times consecutively — should succeed each time with no data loss
5. **Branch selection**: `curl ... | sudo bash -s -- --branch dev`
6. **Version pinning**: `curl ... | sudo bash -s -- --version v0.2.0`
7. **Error cases**:
   - Run without sudo → clear error message
   - Run with no network (after clone exists) → git fetch fails cleanly
   - Kill during fresh clone (Ctrl+C) → temp dir cleaned up, re-run clones fresh
   - Corrupt `$SRC_DIR` (e.g., `mkdir -p /usr/local/src/dobby && echo garbage > /usr/local/src/dobby/x`) → detected and re-cloned
   - Invalid branch name → rejected with error
   - Branch name starting with `-` → rejected with error
   - Both `--branch` and `--version` specified → rejected with error
   - Concurrent execution → second instance blocked by lockfile
   - Stale lockfile (from crashed previous run) → detected and cleaned up
8. **macOS-specific**: Verify lockfile works (mkdir-based, not flock), verify xcode-select bootstrap
9. **Backward compatibility**: Verify `make install` and `make upgrade` still work from a manual clone (no existing files modified)
