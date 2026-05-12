# Test audit — 2026-05-12

Author: test-harness audit pass
Branch: `feature/test-audit-and-harness`
Scope: all `src/**/*.test.ts`, the headless `harness/` rig, and regression
coverage for fixes merged in PRs #10, #12, #13, #14, #15, #16, #17.

This document only audits and recommends. Source files (`src/main.ts`,
`src/book/**`, `src/textures/atlas.ts`, `src/long-press-capture.ts`,
`src/telemetry.ts`, `src/debug.ts`, `vite.config.ts`) are not modified.

---

## 1. Inventory

| File | Tests | Purpose |
|---|---:|---|
| `src/book/BookState.test.ts`     | 72 | Pure state machine: j/φ invariants, fan turns, impulse model |
| `src/book/Book.test.ts`          | 37 | Three.js integration: meshes, animations, popup, fan-cancel |
| `src/book/PageGeometry.test.ts`  | 17 | Cylinder-curl displacement (CPU reference) |
| `src/book/CreaseGeometry.test.ts`| 19 | `creaseFromDrag` — spine pinning, alpha tilt, dihedral |
| `src/book/Settle.test.ts`        | 18 | Energy-based settle ODE: convergence, dt sensitivity |
| `src/book/ShaderMath.test.ts`    | 21 | JS reimplementation of vertex-shader math |
| **Total**                        | **184** | |

Current run (`npm test` on `origin/main`):
- **176 passing, 8 failing** (one file: `Book.test.ts` "Fan × Popup" describe)
- Wall-clock: ~0.5s

The 8 failures are pre-existing and have been ignored across multiple PRs.

---

## 2. The 8 popup-test failures — root cause

All 8 failures are in `describe('Book - Fan × Popup', …)`. They expect
`book.isPopupVisible()` and `book.getPopupFoldProgress()` to track actual
popup geometry. The accessors return:

```ts
getPopupFoldProgress(): number { return this.popupFoldProgress; }
isPopupVisible(): boolean { return this.popupGroup?.visible ?? false; }
```

But the `Book` constructor contains:

```ts
this.syncDisplay();
// Popup diorama temporarily disabled.
// this.createPopup();
```

`popupGroup` is therefore always `null`, so `isPopupVisible()` is always
`false` and `popupFoldProgress` is always `0`. Every assertion against a
non-zero fold progress or a `true` visibility fails.

**This is not a test bug, it is a feature being shipped behind a hard-
disabled call site.** The tests are accurate descriptions of the popup
contract; the code that fulfills it is commented out.

### Recommendation

Three options, in increasing order of work:

1. **Skip with documented reason** (`it.skip(...)` + comment pointing at
   the disabled `createPopup()` line). Cheapest. Keeps the contract
   documented in code so the next person re-enabling the popup feature
   has the spec ready.
2. **Move the whole describe into a `*.skipped.test.ts` file** so they're
   visibly out-of-scope and don't pollute the failing-tests count anyone
   sees on first `npm test`.
3. **Re-enable popup**, fix the resulting visual issues, let the tests
   pass. Out of scope here.

**Audit verdict: option 1.** Don't delete — the tests encode the popup
contract and we want them back when popup ships. The current state
(red on every CI run) trains everyone to ignore failures, which is the
worst possible signal.

---

## 3. Coverage gaps for recently-merged fixes

| PR | Fix | Unit-test coverage | Gap |
|---|---|---|---|
| #10 | spine vertex pin in FLIP_VERT shader | none | The bug lived in inline GLSL; no unit test reaches a real GPU. The JS shader-math reimplementation in `ShaderMath.test.ts` does not model the flap classifier at all. |
| #12 | polygon offset prevents bleed-through on turning page | none | Z-fighting/bleed-through is purely a render artifact; visible only in pixels. No test loads a real WebGL context to exercise it. |
| #13 | `hardCancelDrag` on lostpointercapture / pointercancel | none | The handler lives in `main.ts`, which has zero tests. There is no test that simulates the OS yanking pointer capture mid-drag and asserts that the drag state cleans up before the next gesture. |
| #14 | long-press screenshot capture (browser side) | none | `src/long-press-capture.ts` has no companion `.test.ts`. No test that holds for 5s, asserts the timer fires, asserts the POST goes out. |
| #15 | screenshot-server Vite plugin | none | `vite.config.ts` plugin has no test for schema validation, EXIF embed, sidecar JSON layout, or the JPEG SOI sniff. |
| #16/#17 | (capture polish, file-format negotiation) | none | Same as #14/#15 — captured downstream of code with no harness assertion. |

Every one of these fixes was merged on the strength of "I clicked and it
worked" plus the pre-existing 176 passing tests, none of which exercise
the changed code paths.

---

## 4. False-positive analysis — tests that would still pass after meaningful breakage

The unit suite is dense around pure logic but very thin against
"observable rendered output". A surprising number of tests assert
internal state and never look at what the user sees.

Concrete examples:

1. **`ShaderMath.test.ts` (all 21 tests)** — These exercise a JS
   reimplementation (`ShaderMath.ts`) of the vertex shader math. **A
   meaningful change to the inline GLSL `FLIP_VERT` in `Book.ts` would
   not break any of these tests** because they never run the real GLSL.
   This is exactly how the spine-pin bug (#10) shipped to main: the JS
   model was correct, the GPU shader was wrong, no test caught the
   divergence. (Note: the harness `fiducialWorldPosition` in
   `bootstrap.ts` shares this weakness — it is also a JS reimplementation.)

2. **`Book.test.ts` > "page geometry remains within bounds"** — checks
   the position of vertices in the JS-side BufferGeometry of the
   turning page. After PR #11 the rendering uses an inextensible /
   developable surface model, but the test still measures vertex
   positions of a `PlaneGeometry` whose vertices are deformed only on
   the GPU. The CPU-side geometry would look "in bounds" even if the
   GPU shader rendered the page completely off-screen.

3. **`Book.test.ts` > "curl axis sweeps right to left during turn"** —
   asserts on `book.getState().getCrease().curlAxisX` (a state value),
   not on what is drawn. If the curl shader silently dropped the
   uniform, the test would still pass.

4. **`BookState.test.ts` > "isTurning = true until completeTurn"** —
   covers transition logic but never checks that the page mesh is
   actually replaced. PR #13's bug (drag-state corruption) was a state
   inconsistency between `BookState.dragPoint` and the visible
   turningPageMesh; `isTurning` was correct in both buggy and fixed
   versions.

5. **`Settle.test.ts`** — runs the settle integrator in isolation
   against a synthetic state. It does not test that the settle is ever
   actually started by `onPointerUp`, or that it is *not* started by
   `hardCancelDrag` (which was the entire point of PR #13). The unit
   tests would be 100% green even if `main.ts` accidentally routed
   pointercancel through `beginSettle` again.

6. **All `cancelFanTurn` tests** — assert that state index reverts and
   meshes are removed. They never assert that crease shadow opacity
   resets, that popup state resets, or that any outgoing telemetry was
   correct. A regression that left `creaseMesh.uOpacity = 0.7` after
   cancel would be invisible.

The pattern: tests live close to the code they were written alongside.
The seams between `BookState` ↔ `Book` ↔ `main.ts` ↔ GPU are exactly
where bugs land, and nothing covers those seams.

---

## 5. Top-5 prioritized missing test cases

These are ranked by "would have caught a real bug we shipped this
session", not by elegance.

1. **(spine pin in real GLSL) End-to-end pixel-level check that the
   spine column does not separate from the binding under a corner-peel
   diagonal drag.** The fix in PR #10 is a single line in inline GLSL;
   the only way to test it is to render real pixels with real WebGL
   and assert that the spine area still shows page color at peak
   dihedral. A trajectory-only check is **not sufficient** — the
   harness's JS trajectory math doesn't model the flap classifier
   (see §4.1).

2. **(hardCancelDrag) lostpointercapture mid-drag emits a `drag-end`
   event with `canceled: true, reason: "lostpointercapture"` and the
   next pointerdown is accepted within one frame.** Catches PR #13.
   Equally important: assert that `settling` is *not* set, since the
   bug was settle-after-cancel pop.

3. **(bleed-through) At dihedral ≈ π/2 on a content-vs-content spread,
   the rasterized turning page does not contain pixels from the spread
   underneath.** The fix in PR #12 is a polygon-offset constant; a
   visual delta test on a known content pair (e.g. j=5 BBB → credits)
   is the only way to verify.

4. **(long-press capture pipeline) Holding pointerdown for >5s with
   `?capture=1&session=harness` produces (a) a `screenshot-captured`
   telemetry event, (b) a file in `contrib/screenshots/` whose
   sidecar JSON contains the expected sessionId.** Single test
   exercising PRs #14 and #15 end-to-end.

5. **(popup-mode failures) Either re-enable `createPopup()` so the
   8 failing tests pass, or skip them with `it.skip()` and a comment
   pointing at the disabled call site.** Failing tests-that-are-known-
   to-fail train developers to not look at the failure summary.

Numbers 1–4 are implemented in this PR as Playwright scenarios under
`harness/scenarios/`. Number 5 is left for the user to decide
(see §2).

---

## 6. Bonus observations

- **No `main.ts` test at all.** All input handling, all settle driving,
  all telemetry call sites live there. Coverage: 0%. Every PR in the
  last week (#10, #12, #13, #14, #15) touched code that has zero unit
  tests and zero integration tests prior to this audit.
- **Test discoverability is good.** Naming and `describe` structure
  in `BookState.test.ts` and `PageGeometry.test.ts` are exemplary —
  invariant numbers map cleanly to PRD sections. Worth preserving as a
  template when adding tests for `main.ts`.
- **`harness/` already has the bones for end-to-end coverage.** Adding
  scenario-level `assertions[]` + a simple telemetry interceptor (this
  PR does both) cleanly extends it without altering app source.
- **No coverage gates.** `npm test` will report 8 failures and exit
  with a non-zero status, but nothing in CI/git hooks blocks merging
  on that. Worth wiring up.
