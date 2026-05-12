#!/usr/bin/env bash
# install-pii-hook.sh — install a local pre-push git hook that scans pending
# commits (messages + diffs) for path-PII patterns and warns. Non-blocking.
#
# Usage:
#   bash scripts/install-pii-hook.sh           # install
#   bash scripts/install-pii-hook.sh --remove  # remove
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOK_PATH="${REPO_ROOT}/.git/hooks/pre-push"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$HOOK_PATH"
  echo "Removed $HOOK_PATH"
  exit 0
fi

cat > "$HOOK_PATH" <<'HOOK'
#!/usr/bin/env bash
# pre-push hook installed by scripts/install-pii-hook.sh
# Scans commits-to-be-pushed (messages + patches) for path-PII patterns.
# Warns but does not block — set PII_HOOK_STRICT=1 to make it blocking.
set -u

REGEX='/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/|\.claude/worktrees/agent-[a-f0-9]+|/\.claude/projects/-Users-[A-Za-z0-9._-]+|[Cc]:\\Users\\[A-Za-z0-9._-]+'

remote="$1"
hits=0

while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    range="$local_sha"
    rev_args="$local_sha --not --remotes=$remote"
  else
    range="${remote_sha}..${local_sha}"
    rev_args="$range"
  fi

  # Scan commit messages
  msgs=$(git log --format='%H%n%B%n--END--' $rev_args 2>/dev/null || true)
  if printf '%s' "$msgs" | grep -nEo "$REGEX" >/dev/null 2>&1; then
    echo "[pii-hook] path-PII in commit message(s) on $range:" >&2
    printf '%s' "$msgs" | grep -nEo "$REGEX" >&2 | head -20
    hits=$((hits+1))
  fi

  # Scan added lines in diffs (skip removals and lock files)
  diff=$(git log -p --no-color --format= --unified=0 $rev_args -- \
    ':(exclude)package-lock.json' ':(exclude)*.lock' 2>/dev/null || true)
  added=$(printf '%s' "$diff" | grep -E '^\+' | grep -v '^+++ ')
  if printf '%s' "$added" | grep -Eo "$REGEX" >/dev/null 2>&1; then
    echo "[pii-hook] path-PII in added lines on $range:" >&2
    printf '%s' "$added" | grep -nEo "$REGEX" >&2 | head -20
    hits=$((hits+1))
  fi
done

if [ $hits -gt 0 ]; then
  echo "[pii-hook] $hits batch(es) contain path-PII patterns." >&2
  echo "[pii-hook] See docs/pii-prevention.md. Set PII_HOOK_STRICT=1 to block." >&2
  if [ "${PII_HOOK_STRICT:-0}" = "1" ]; then
    exit 1
  fi
fi
exit 0
HOOK

chmod +x "$HOOK_PATH"
echo "Installed pre-push hook at $HOOK_PATH"
echo "Set PII_HOOK_STRICT=1 in your env to make it blocking."
