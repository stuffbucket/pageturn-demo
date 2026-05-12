#!/usr/bin/env bash
# scan-path-pii.sh — regex-scan PR body / PR comments / review comments for
# absolute filesystem paths, agent-worktree paths, and project-memory paths.
# Posts (or updates) a single explanatory comment on the PR/issue if hits are
# found. Does NOT fail the workflow — purely visibility / nudge.
#
# Required env:
#   GH_TOKEN     — token with pull-requests:write / issues:write
#   EVENT_NAME   — github.event_name
#   EVENT_PATH   — github.event_path (path to JSON payload)
#   REPO         — owner/repo
set -euo pipefail

MARKER="<!-- path-pii-bot:v1 -->"

extract() {
  case "$EVENT_NAME" in
    pull_request)
      ISSUE_NUMBER=$(jq -r .pull_request.number "$EVENT_PATH")
      BODY=$(jq -r '.pull_request.body // ""' "$EVENT_PATH")
      SOURCE="PR #${ISSUE_NUMBER} body"
      ;;
    pull_request_review_comment)
      ISSUE_NUMBER=$(jq -r .pull_request.number "$EVENT_PATH")
      BODY=$(jq -r '.comment.body // ""' "$EVENT_PATH")
      COMMENT_URL=$(jq -r '.comment.html_url' "$EVENT_PATH")
      SOURCE="review comment ${COMMENT_URL}"
      ;;
    issue_comment)
      ISSUE_NUMBER=$(jq -r .issue.number "$EVENT_PATH")
      BODY=$(jq -r '.comment.body // ""' "$EVENT_PATH")
      COMMENT_URL=$(jq -r '.comment.html_url' "$EVENT_PATH")
      SOURCE="comment ${COMMENT_URL}"
      # Avoid scanning the bot's own nudge comment.
      if printf '%s' "$BODY" | grep -qF "$MARKER"; then
        echo "Skipping bot's own marker comment."
        exit 0
      fi
      ;;
    *)
      echo "Unsupported event: $EVENT_NAME"; exit 0;;
  esac
}

scan() {
  # Patterns of concern. Each line: name|regex (extended).
  PATTERNS=(
    "abs_users_path|/Users/[A-Za-z0-9._-]+/"
    "abs_home_path|/home/[A-Za-z0-9._-]+/"
    "agent_worktree|\\.claude/worktrees/agent-[a-f0-9]+"
    "project_memory|~?/\\.claude/projects/-Users-[A-Za-z0-9._-]+"
    "win_users_path|[Cc]:\\\\Users\\\\[A-Za-z0-9._-]+"
  )

  HITS=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    for entry in "${PATTERNS[@]}"; do
      name="${entry%%|*}"
      regex="${entry#*|}"
      if printf '%s' "$line" | grep -Eo "$regex" >/dev/null 2>&1; then
        snippet=$(printf '%s' "$line" | grep -Eo "$regex" | head -1)
        HITS+="- \`${name}\`: \`${snippet}\`"$'\n'
      fi
    done
  done <<< "$BODY"

  printf '%s' "$HITS"
}

extract

if [ -z "${BODY:-}" ]; then
  echo "Empty body; nothing to scan."; exit 0
fi

HITS=$(scan)

if [ -z "$HITS" ]; then
  echo "No path-PII patterns matched in ${SOURCE}."
  exit 0
fi

echo "Path-PII detected in ${SOURCE}:"
echo "$HITS"

NUDGE_BODY=$(cat <<EOF
${MARKER}
:wave: A path-PII scan flagged the following pattern(s) in **${SOURCE}**:

${HITS}

These look like absolute filesystem paths, agent worktree paths, or project-memory paths. They probably shouldn't be in public PR content. Please edit to redact (e.g. \`/Users/<user>/...\` → \`<repo>/...\`, \`.claude/worktrees/agent-<hash>/\` → \`<worktree>/\`).

See \`docs/pii-prevention.md\` for the full strategy and \`docs/pr-pii-scrub-2026-05-12.md\` for the policy this enforces. This check is advisory — it does not fail the build.
EOF
)

# Idempotent: find an existing nudge on this issue and update it; else create.
EXISTING=$(gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"${MARKER}\")) | .id" | head -1 || true)

if [ -n "$EXISTING" ]; then
  echo "Updating existing nudge comment id=$EXISTING"
  gh api -X PATCH "repos/${REPO}/issues/comments/${EXISTING}" \
    -f body="$NUDGE_BODY" >/dev/null
else
  echo "Posting new nudge comment on issue/PR #${ISSUE_NUMBER}"
  gh api -X POST "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" \
    -f body="$NUDGE_BODY" >/dev/null
fi
