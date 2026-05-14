# Mutation Testing Policy

We run [StrykerJS](https://stryker-mutator.io) over a curated subset of pure-logic
modules in `src/book/` (see `stryker.conf.json` for the exact list). Each Stryker
run takes roughly two minutes on an M-series Mac and requires a fully green test
suite to even start its dry run, so we treat it as a **gated** check rather than
something that fires on every commit.

## When to run Stryker

Run mutation tests when at least one of these is true:

- A **test file** under `src/**/*.test.ts` has changed and `npm test` is green.
  New or modified tests are precisely what mutation analysis exists to grade.
- A **production source** file under `src/**/*.ts` (excluding `*.test.ts`) that
  is in the Stryker `mutate` set has changed. New behavior should come with new
  killing tests; mutation analysis tells us whether they actually kill.
- You are explicitly investigating coverage / score (`npm run test:mutation`).
  Manual runs are always fair game.

## When NOT to run Stryker

Skip Stryker when:

- `npm test` is **red**. Stryker requires a green dry run; running while broken
  wastes ~2 minutes only to fail. Fix tests first.
- The diff is **only** docs, configs, harness scripts, assets, or other files
  outside `src/**/*.ts`. None of those change what Stryker mutates.
- You are working on a low-effort branch (typo fix, README tweak, dependency
  bump that doesn't touch mutated modules).

## The trigger we ship: `npm run test:mutation:if-changed`

`scripts/test-mutation-if-changed.sh` automates the policy above. It:

1. Reads the previous-run SHA from `.stryker-last-run` (gitignored, per-developer
   state). Missing or empty file is treated as "first run, always execute."
2. Diffs `HEAD` against that SHA, scoped to production sources and test sources
   under `src/`. If neither set has changes, exits 0 with a skip message.
3. Otherwise runs `npm test` first. If red, exits 1 with a clear message. If
   green, runs `npm run test:mutation`.
4. On a successful Stryker run, records the current `HEAD` SHA back into
   `.stryker-last-run` so the next invocation has a fresh baseline.

Use it locally before opening a PR that touches `src/`:

```bash
npm run test:mutation:if-changed
```

`npm run test:mutation` is still available for unconditional runs.

## Optional CI integration (not enabled)

We have intentionally **not** added a workflow file. If/when we want this in CI,
something like the following would slot in at `.github/workflows/mutation.yml`:

```yaml
name: Mutation testing
on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - 'stryker.conf.json'
      - 'vitest.stryker.config.ts'
      - 'scripts/test-mutation-if-changed.sh'
jobs:
  stryker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # need history for the SHA diff
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      # In CI we don't have .stryker-last-run; use the merge-base instead.
      - name: Run conditional mutation suite
        run: |
          git rev-parse "origin/${{ github.base_ref }}" > .stryker-last-run
          npm run test:mutation:if-changed
      - name: Comment surviving mutants
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const path = 'reports/mutation/mutation.json';
            if (!fs.existsSync(path)) return;
            // ...summarize survivors and post as a PR comment.
```

This is a sketch only -- enabling it is a separate decision that should weigh
the ~2-minute job runtime against value to PR review.

## Current blocker: issue #20

~~`Book.ts` is **not** in the Stryker `mutate` set today.~~ **Resolved 2026-05-14.**
Per ADR-0001 the popup feature is disabled-by-design and the eight previously
failing tests live behind `describe.skip(...)`, so `Book.test.ts` is now part of
the Stryker dry run and `Book.ts` is back in the `mutate` set. `PageMaterial.ts`
was also added at the same time, backed by a new smoke-test suite. See
`docs/mutation-test-report-2026-05-14.md` for the post-reactivation baseline.

## Mutation-score floors (informational)

These are the per-file floors observed on the 2026-05-14 baseline. They are
**not enforced** in CI today — they are reference points so a future agent can
tell at a glance whether a change pulled a number down. Drops > 2 % warrant
investigation; the JSON report at `reports/mutation/mutation.html` is the
ground truth.

| File | Total score | Score on covered code | Notes |
|---|---|---|---|
| `src/book/CreaseGeometry.ts` | 89.8 % | 90.8 % | Pure math + numeric oracles |
| `src/book/SettlePhysics.ts` | 84.2 % | 86.0 % | Boundary-equality survivors are equivalent mutants |
| `src/book/PageGeometry.ts` | 91.2 % | 91.2 % | Three.js plumbing |
| `src/book/PageMaterial.ts` | 100 % | 100 % | Legacy / unused, smoke tests only |
| `src/book/DevelopableSurface.ts` | 79.3 % | 80.7 % | Equivalent-mutant ceiling (Rodrigues terms multiply zero by construction) |
| `src/book/BookState.ts` | 68 % | 75 % | Baseline from 2026-05-12; telemetry payload tests would lift this |
| `src/book/Book.ts` | 19.6 % | 29.6 % | Shader/Three.js mesh-lifecycle code; most mutants live in code Stryker cannot meaningfully observe through unit tests |
