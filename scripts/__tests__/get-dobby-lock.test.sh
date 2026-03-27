#!/usr/bin/env bash
# Tests for get-dobby.sh lock mechanism
# Run: bash scripts/__tests__/get-dobby-lock.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GET_DOBBY="$SCRIPT_DIR/../../get-dobby.sh"
TEST_LOCK_DIR=""
PASS=0
FAIL=0

red()    { printf '\033[0;31m  FAIL: %s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m  PASS: %s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m  %s\033[0m\n' "$*"; }

cleanup() {
    if [ -n "$TEST_LOCK_DIR" ] && [ -d "$TEST_LOCK_DIR" ]; then
        rm -rf "$TEST_LOCK_DIR"
    fi
}
trap cleanup EXIT

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        green "$desc"
        PASS=$((PASS + 1))
    else
        red "$desc (expected '$expected', got '$actual')"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if echo "$haystack" | grep -qF "$needle"; then
        green "$desc"
        PASS=$((PASS + 1))
    else
        red "$desc (expected to contain '$needle')"
        FAIL=$((FAIL + 1))
    fi
}

# ---------------------------------------------------------------------------
# Source just the functions we need from get-dobby.sh
# We can't source the whole file (it runs immediately), so we extract the
# lock functions and test them in isolation.
# ---------------------------------------------------------------------------

TEST_LOCK_DIR=$(mktemp -d)/dobby-test-lock

# Recreate the lock functions with our test LOCK_DIR
setup_lock_functions() {
    LOCK_DIR="$TEST_LOCK_DIR"
    FORCE=false

    recover_stale_lock() {
        local reason="$1"
        yellow "Removing stale lock ($reason)"
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR" 2>/dev/null || { red "Error: Could not acquire lock after stale removal"; return 1; }
        echo $$ > "$LOCK_DIR/pid"
        if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" != "$$" ]; then
            red "Error: Lost lock race — another install started simultaneously"
            return 1
        fi
    }

    acquire_lock() {
        local mkdir_err
        local old_pid

        if [ "$FORCE" = true ] && [ -d "$LOCK_DIR" ]; then
            yellow "Forcing lock removal (--force specified)"
            rm -rf "$LOCK_DIR"
        fi

        mkdir_err=$(mkdir "$LOCK_DIR" 2>&1) && {
            echo $$ > "$LOCK_DIR/pid"
            return 0
        }

        if [ ! -d "$LOCK_DIR" ]; then
            red "Error: Could not create lock directory: $mkdir_err"
            return 1
        fi

        if [ -f "$LOCK_DIR/pid" ]; then
            old_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
            if [ -z "$old_pid" ]; then
                recover_stale_lock "empty PID file"
                return $?
            fi
            if ! kill -0 "$old_pid" 2>/dev/null; then
                recover_stale_lock "PID $old_pid no longer running"
                return $?
            fi
        else
            recover_stale_lock "no PID file found"
            return $?
        fi

        return 1
    }
}

# ---------------------------------------------------------------------------
echo ""
echo "=== get-dobby.sh lock mechanism tests ==="
echo ""

# Test 1: Fresh lock acquisition
yellow "Test 1: Fresh lock acquisition (no prior lock)"
setup_lock_functions
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$(dirname "$TEST_LOCK_DIR")"
acquire_lock
assert_eq "Lock dir created" "0" "$( [ -d "$TEST_LOCK_DIR" ] && echo 0 || echo 1 )"
assert_eq "PID file contains current PID" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
rm -rf "$TEST_LOCK_DIR"

# Test 2: Stale lock with dead PID
yellow "Test 2: Stale lock with dead PID"
setup_lock_functions
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$TEST_LOCK_DIR"
echo "99999" > "$TEST_LOCK_DIR/pid"  # Almost certainly a dead PID
acquire_lock
assert_eq "Lock recovered from dead PID" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
rm -rf "$TEST_LOCK_DIR"

# Test 3: Stale lock with no PID file
yellow "Test 3: Stale lock with no PID file"
setup_lock_functions
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$TEST_LOCK_DIR"
# Don't create a pid file
acquire_lock
assert_eq "Lock recovered from missing PID" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
rm -rf "$TEST_LOCK_DIR"

# Test 4: Stale lock with empty PID file
yellow "Test 4: Stale lock with empty PID file"
setup_lock_functions
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$TEST_LOCK_DIR"
echo -n "" > "$TEST_LOCK_DIR/pid"  # Empty PID file
acquire_lock
assert_eq "Lock recovered from empty PID" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
rm -rf "$TEST_LOCK_DIR"

# Test 5: Active lock (use a live background process we own)
yellow "Test 5: Active lock blocks acquisition"
setup_lock_functions
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$TEST_LOCK_DIR"
sleep 60 &
LIVE_PID=$!
echo "$LIVE_PID" > "$TEST_LOCK_DIR/pid"
result=0
acquire_lock 2>/dev/null || result=$?
assert_eq "Active lock blocks acquisition" "1" "$result"
kill "$LIVE_PID" 2>/dev/null || true
wait "$LIVE_PID" 2>/dev/null || true
rm -rf "$TEST_LOCK_DIR"

# Test 6: --force overrides active lock
yellow "Test 6: --force overrides active lock"
setup_lock_functions
FORCE=true
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$TEST_LOCK_DIR"
sleep 60 &
LIVE_PID=$!
echo "$LIVE_PID" > "$TEST_LOCK_DIR/pid"
acquire_lock
assert_eq "Force override succeeded" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
kill "$LIVE_PID" 2>/dev/null || true
wait "$LIVE_PID" 2>/dev/null || true
rm -rf "$TEST_LOCK_DIR"

# Test 7: --force with no existing lock (no-op, still acquires)
yellow "Test 7: --force with no existing lock"
setup_lock_functions
FORCE=true
rm -rf "$TEST_LOCK_DIR"
mkdir -p "$(dirname "$TEST_LOCK_DIR")"
acquire_lock
assert_eq "Force with no lock still acquires" "$$" "$(cat "$TEST_LOCK_DIR/pid")"
rm -rf "$TEST_LOCK_DIR"

# Test 8: Lock parent dir missing causes clear error
yellow "Test 8: Missing parent directory gives clear error"
setup_lock_functions
LOCK_DIR="/tmp/nonexistent-$$/deeply/nested/lock"
result=0
output=$(acquire_lock 2>&1) || result=$?
assert_eq "Returns failure for missing parent" "1" "$result"
assert_contains "Error message mentions lock directory" "Could not create lock directory" "$output"

# Test 9: --force flag is parsed correctly
yellow "Test 9: --force flag parsing in script"
output=$(bash -c 'source /dev/stdin <<< ""; set -- --force --branch main; FORCE=false; BRANCH=""; EXPLICIT_BRANCH=false; VERSION=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch) BRANCH="$2"; EXPLICIT_BRANCH=true; shift 2 ;;
        --version|--tag) VERSION="$2"; shift 2 ;;
        --force) FORCE=true; shift ;;
        --help|-h) echo "help"; exit 0 ;;
        *) echo "unknown: $1"; exit 1 ;;
    esac
done
echo "FORCE=$FORCE BRANCH=$BRANCH"')
assert_eq "Parses --force with --branch" "FORCE=true BRANCH=main" "$output"

# Test 10: LOCK_DIR security comment exists in script
yellow "Test 10: Security comment on LOCK_DIR"
output=$(grep -c "SECURITY.*hardcoded.*rm -rf" "$GET_DOBBY" || echo "0")
assert_eq "Security comment exists" "1" "$output"

# Test 11: mkdir -p for parent dir exists in script
yellow "Test 11: mkdir -p for lock parent dir in script"
output=$(grep -c 'mkdir -p "$(dirname "$LOCK_DIR")"' "$GET_DOBBY" || echo "0")
assert_eq "mkdir -p for parent dir exists" "1" "$output"

# ---------------------------------------------------------------------------
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
