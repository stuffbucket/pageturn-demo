# ADR-0001: Popup feature temporarily disabled; tests skipped

**Status:** Accepted (2026-05-12)

## Context

The paper-craft popup diorama (mountains, sun, trees) is implemented as
`Book.createPopup()` in `src/book/Book.ts` and was originally invoked
from the `Book` constructor. At some point during development the call
site was commented out:

```ts
// src/book/Book.ts:191
this.syncDisplay();
// Popup diorama temporarily disabled.
// this.createPopup();
```

The method body and all popup support code (`popupGroup`,
`popupFoldProgress`, `applyPopupFold()`, `isPopupVisible()`,
`getPopupFoldProgress()`, the `POPUP_SPREAD` constant, etc.) remain in
place. Because `createPopup()` is never called, `popupGroup` is always
`null` — so `isPopupVisible()` always returns `false` and
`getPopupFoldProgress()` always returns `0`.

This left two coupled symptoms:

- **Issue #20** — 10 tests in the `Book - Fan × Popup` describe block
  failed on every CI run. Each test asserts on accessor values that
  the disabled feature can no longer produce.
- **Issue #21** — TypeScript emits `TS6133: 'createPopup' is declared
  but its value is never read`. The repo has `noUnusedLocals: true` in
  `tsconfig.json` and no ESLint configured, so the warning is a
  TS-native one.
- **Mutation testing** — `stryker.conf.json` (added in PR #25) had to
  exclude `src/book/Book.ts` from its `mutate:` array because baseline
  tests were red. Stryker requires a green baseline.

The audit in `docs/test-audit-2026-05-12.md` (PR #27) considered three
options: (1) skip the tests with a comment, (2) delete them, (3)
re-enable the popup feature and fix any visual regressions. The audit
recommended option 1 — preserve the contract in code so the next
person re-enabling the feature has executable specifications to run.

## Decision

Apply the audit recommendation:

1. **Tests:** Change `describe('Book - Fan × Popup', ...)` to
   `describe.skip('Book - Fan × Popup', ...)` in `src/book/Book.test.ts`,
   with a comment immediately above the block explaining why and
   pointing at issue #20.

2. **TS6133 suppression:** Add a `// @ts-expect-error TS6133: unused
   while popup feature is disabled (see issue #21)` directive directly
   above the `private createPopup(): void {` declaration in
   `src/book/Book.ts`.

### Why these specific primitives

- **`describe.skip` (vs. deletion or per-`it.skip`)** — the popup
  describe block is cohesive: every test belongs to the same disabled
  feature, so a single skip at the describe level is less noisy than
  10 individual `it.skip` calls and easier to flip back when the
  feature ships. Deletion would lose the executable contract.

- **`@ts-expect-error` (vs. `@ts-ignore` or renaming to
  `_createPopup`)** — `@ts-expect-error` is self-cleaning: the
  moment line 191 is uncommented and `createPopup` becomes "used,"
  the directive itself starts failing the build with "Unused
  '@ts-expect-error' directive," which forces a future contributor
  to remove it. `@ts-ignore` would silently linger. Renaming to
  `_createPopup` would require also editing the commented-out call
  site, increasing the risk of drift between the comment and the
  method name.

## Consequences

### Positive

- CI is green; `npm test` reports `174 passed | 10 skipped | 0 failed`.
- `npm run build` is free of `TS6133` noise; other warnings (if any)
  are unaffected.
- The popup contract is still encoded in `Book.test.ts`; flipping
  `describe.skip` back to `describe` runs the full spec suite against
  the re-enabled feature.
- The `@ts-expect-error` directive will self-flag and force removal
  the moment the call site is restored — no manual cleanup reminder
  required at the suppression site.

### Negative

- 10 popup integration tests are not exercised on every run. If the
  popup support code (`applyPopupFold`, `popupFoldProgress` math,
  arriving/leaving fan logic) is refactored while the feature is
  disabled, those changes won't be caught by the test suite until
  someone runs `describe` (not `describe.skip`) locally or ships the
  feature. Mitigated by the reactivation checklist below.
- `stryker.conf.json` still excludes `src/book/Book.ts` from its
  `mutate:` array. The exclusion was originally required because the
  baseline was red; with this PR the baseline is green, so the
  exclusion is no longer technically necessary — but re-including
  `Book.ts` would surface mutants in the popup support code that no
  active test can kill (because the tests are skipped). Tracked as a
  separate follow-up; the right move is probably to re-include only
  after the popup feature is shipped and tests are unskipped.

## Reactivation checklist

When shipping the popup feature, perform the following in order:

1. In `src/book/Book.ts`, uncomment line 191:
   ```ts
   this.createPopup();
   ```
2. Remove the `// @ts-expect-error TS6133: ...` directive above the
   `createPopup` method declaration. (If you forget this step, the
   build will fail with "Unused '@ts-expect-error' directive" — that
   is by design.)
3. In `src/book/Book.test.ts`, change
   `describe.skip('Book - Fan × Popup', ...)` back to
   `describe('Book - Fan × Popup', ...)` and remove the multi-line
   "Skipped because the popup feature is currently disabled..."
   comment above it.
4. Run `npm test -- --run`. Expect 184 passing, 0 skipped (assuming
   no further tests have been added or skipped). Fix any popup test
   failures uncovered by the re-enabled feature.
5. Run `npm run build`. Expect a clean build with no TS6133 warnings.
6. In `stryker.conf.json`, add `'src/book/Book.ts'` to the `mutate:`
   array (or remove its exclusion, depending on the configured
   pattern). Re-run `npx stryker run` and triage any surviving
   mutants in the popup code paths.
7. Close issues #20 and #21 if they have not already been closed by
   PR #28; open a new issue for any popup-feature visual regressions
   surfaced during reactivation.

## Links

- PR #28 — https://github.com/stuffbucket/pageturn-demo/pull/28
- Issue #20 — popup test failures
- Issue #21 — `createPopup` unused-variable warning
- `docs/test-audit-2026-05-12.md` — audit that recommended this
  approach (option 1)
- `stryker.conf.json` — mutation testing config that currently
  excludes `Book.ts`
- `src/book/Book.ts:191` — the disabled call site
- `src/book/Book.test.ts` — the skipped describe block
