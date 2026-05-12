#!/usr/bin/env bash
# Conditionally run StrykerJS mutation tests.
#
# Stryker is expensive (~2 minutes) and requires a green test suite to even
# start its dry run. We only want to spend that budget when there is something
# new to mutate or a new test that might cover it.
#
# Decision tree:
#   1. If `.stryker-last-run` is missing  -> run Stryker (first run).
#   2. Else diff HEAD against the recorded SHA, scoped to:
#        - production sources: src/**/*.ts excluding *.test.ts
#        - test sources:       src/**/*.test.ts
#      If neither set has changes -> skip.
#   3. If changes exist, run `npm test` first.
#        - red    -> bail out with a clear message.
#        - green  -> run `npm run test:mutation`.
#   4. On a successful Stryker run, record the current HEAD SHA so the next
#      invocation has a fresh baseline.
#
# This script is intentionally dependency-free (bash + git + npm).

set -uo pipefail

LAST_RUN_FILE=".stryker-last-run"
CURRENT_SHA="$(git rev-parse HEAD)"

log() { printf '[mutation:if-changed] %s\n' "$*"; }

run_stryker_and_record() {
  log "Running test suite first (Stryker requires green tests)..."
  if ! npm test --silent -- --run; then
    log "Skipping mutation: test suite is red - fix tests first."
    exit 1
  fi
  log "Tests green. Running Stryker..."
  if npm run test:mutation; then
    printf '%s\n' "$CURRENT_SHA" > "$LAST_RUN_FILE"
    log "Stryker completed. Recorded SHA $CURRENT_SHA in $LAST_RUN_FILE."
    exit 0
  else
    rc=$?
    log "Stryker failed (exit $rc). Not updating $LAST_RUN_FILE."
    exit "$rc"
  fi
}

if [ ! -f "$LAST_RUN_FILE" ]; then
  log "No $LAST_RUN_FILE found - treating as first run."
  run_stryker_and_record
fi

LAST_SHA="$(tr -d '[:space:]' < "$LAST_RUN_FILE")"

if [ -z "$LAST_SHA" ]; then
  log "$LAST_RUN_FILE is empty - treating as first run."
  run_stryker_and_record
fi

if ! git cat-file -e "${LAST_SHA}^{commit}" 2>/dev/null; then
  log "Recorded SHA $LAST_SHA not in repo (rebase/force-push?). Treating as first run."
  run_stryker_and_record
fi

if [ "$LAST_SHA" = "$CURRENT_SHA" ]; then
  log "HEAD unchanged since last mutation run ($LAST_SHA). Skipping."
  exit 0
fi

PROD_CHANGED="$(git diff --name-only "$LAST_SHA"..HEAD -- 'src/**/*.ts' ':(exclude)src/**/*.test.ts')"
TEST_CHANGED="$(git diff --name-only "$LAST_SHA"..HEAD -- 'src/**/*.test.ts')"

if [ -z "$PROD_CHANGED" ] && [ -z "$TEST_CHANGED" ]; then
  log "Skipping mutation: no test/source changes since $LAST_SHA."
  exit 0
fi

if [ -n "$PROD_CHANGED" ]; then
  log "Production sources changed since $LAST_SHA:"
  printf '  %s\n' $PROD_CHANGED
fi
if [ -n "$TEST_CHANGED" ]; then
  log "Test sources changed since $LAST_SHA:"
  printf '  %s\n' $TEST_CHANGED
fi

run_stryker_and_record
