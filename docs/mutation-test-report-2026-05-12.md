# Mutation Test Report — 2026-05-12

**Tool:** [StrykerJS](https://stryker-mutator.io/) `@stryker-mutator/core@9.6.1` with `vitest-runner@9.6.1` and `typescript-checker@9.6.1`
**Config:** `stryker.conf.json` at repo root (testRunner: vitest, coverageAnalysis: perTest, TypeScript checker enabled)
**Run command:** `npm run test:mutation`
**Time-to-run:** **1 minute 48 seconds** on the host machine (4 concurrent test-runner processes)
**Report HTML:** `reports/mutation/mutation.html` (gitignored — regenerate locally with `npm run test:mutation`)

> **NEW dependency note:** StrykerJS is a new dev-only dependency for this project (Apache-2.0). Three packages added: `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `@stryker-mutator/typescript-checker`, all v9.6.1. Recorded in `THIRD-PARTY-LICENSES.md`.

## Scope

**Mutated files (3 of 5 source modules in `src/book/`):**

| File | Lines | Tested by |
|---|---|---|
| `src/book/BookState.ts` | 482 | `BookState.test.ts` (~108 tests) |
| `src/book/CreaseGeometry.ts` | 239 | `CreaseGeometry.test.ts` |
| `src/book/PageGeometry.ts` | 83  | `PageGeometry.test.ts` |

**Excluded from mutation** (and the rationale):

- `src/book/Book.ts` — 8 tests in `Book.test.ts` (popup interactions) fail at baseline; tracked by issue **#20**. Stryker requires a green initial test run, so Book.test.ts is also excluded from `vitest.stryker.config.ts`. **Once #20 lands, Book.ts can and should be added back to the mutate list — it is the single largest behavioral file in the codebase and currently has no mutation coverage.**
- `src/book/PageMaterial.ts` — no unit tests (Three.js material plumbing).
- `src/main.ts`, `src/textures/atlas.ts`, `src/debug.ts`, `src/telemetry.ts`, `src/long-press-capture.ts`, `src/counter.ts` — UI plumbing, scene setup, content authoring; no behavioral tests.

## Results

```
File              | % Mutation score | # killed | # timeout | # survived | # no cov | # errors |
                  |  total | covered |          |           |            |          |          |
------------------+--------+---------+----------+-----------+------------+----------+----------|
All files         |  67.96 |   75.36 |      253 |        10 |         86 |       38 |       61 |
 BookState.ts     |  67.92 |   77.59 |      174 |         6 |         52 |       33 |       46 |
 CreaseGeometry.ts|  63.64 |   65.88 |       53 |         3 |         29 |        3 |       13 |
 PageGeometry.ts  |  79.41 |   84.38 |       26 |         1 |          5 |        2 |        2 |
```

**448 mutants generated**, broken down: **253 killed (56.5%)**, **10 timed out (2.2% — also counted as killed)**, **86 survived (19.2%)**, **38 not covered by any test (8.5%)**, **61 rejected by the TypeScript checker (uncompilable mutations, not scored)**.

- **Total mutation score: 67.96%** — `(killed + timeout) / (killed + timeout + survived + no_cov)`
- **Score on covered code: 75.36%** — same numerator divided by `killed + timeout + survived` (excludes never-covered code)

For context, an "industry healthy" score is in the 70–85% range; >90% is excellent for pure-math modules. CreaseGeometry's 64/66% is the weak spot.

## Top 10 surviving mutants by significance

For each: source location, the mutation, why it survived, and a recommendation. "Real test gap" = production change is observable but no test catches it; "Equivalent" = mutation produces same behavior; "Untestable" = code path needs integration/E2E coverage to exercise.

### 1. `src/book/CreaseGeometry.ts:156` — sign flip in spine-Y projection (REAL GAP, HIGH)
```
- const rawSpineY = My - Mx * perpY / perpX;
+ const rawSpineY = My + Mx * perpY / perpX;
```
**Why it survived:** the spine-pinning test (`pins originOnEdge to the spine (x=0) for arbitrary drag points`) only asserts `originOnEdge.x === 0`. It never asserts the resulting `originOnEdge.y` matches the analytic projection. A sign flip would put the rotation axis on the wrong side of the page midline — visually catastrophic but invisible to current asserts.
**Action:** add an oracle test: for a fixed `(corner, drag)` pair, hand-compute the expected `originY` and `expect(crease.originOnEdge.y).toBeCloseTo(expected, 5)`. Repeat for ~6 representative drags (including one with negative perpY, one near the squash limit).

### 2. `src/book/CreaseGeometry.ts:177` — tanh argument (REAL GAP, HIGH)
```
- originY = limit * Math.tanh(rawSpineY / limit);
+ originY = limit * Math.tanh(rawSpineY * limit);
```
**Why it survived:** with `H = 1.4`, `limit = 0.7`, multiplying instead of dividing produces wildly wrong values for any non-trivial `rawSpineY`, but no test compares `originY` against an expected value (see #1). Same root cause: tests check existence/sign but never magnitude.
**Action:** subsumed by the test in #1 — once `originY` has a numeric oracle, this dies automatically.

### 3. `src/book/CreaseGeometry.ts:122` — reverse-turn span scaling (REAL GAP, HIGH)
```
- const span = isReverse ? 2 * W : W;
+ const span = isReverse ? 2 / W : W;
```
**Why it survived:** the `saturates at π when drag is at (-pageWidth, H/2)` reverse test only checks the *clamp*: drag at `(-W, H/2)` produces `dihedral ≈ π` because `Math.min(1, …)` clamps anything ≥ 1 to 1. With `2 / W` the value is still huge and clamps to 1, so the assertion still passes. The bug only shows up at intermediate progress (e.g. half-way reverse drag at `(-W/2, H/2)` should give `dihedral = π/4`, not `π * (W/2 / (2/W))`).
**Action:** add a `dihedral mapping (reverse) is linear in horizontal pull below saturation` test that checks an intermediate point: `creaseFromDrag({W,H/2}, {-W/2,H/2}, ..., true).dihedral` should be `≈ 3π/8`.

### 4. `src/book/CreaseGeometry.ts:183` — orientation flip never exercised (REAL GAP, MEDIUM)
```
- if (creaseDirY < 0) { creaseDirX = -creaseDirX; creaseDirY = -creaseDirY; }
+ if (true)  { ... }    // 4 different mutants all survive
+ if (false) { ... }
+ if (creaseDirY <= 0) { ... }
+ if (creaseDirY >= 0) { ... }
```
**Why it survived:** every drag in the test suite produces `perpY = drag.x − corner.x ≥ 0` (drag is always *toward* the spine), so `creaseDirY` is always ≥ 0 and the branch never fires. The flip-to-canonical-orientation path is wholly untested.
**Action:** add `creaseDir always points up the spine (creaseDir.y >= 0)` parametrized over drags including ones with `drag.x > corner.x` (drag away from spine) — those will exercise the flip.

### 5. `src/book/BookState.ts:81` — fan-cap walk past book end (REAL GAP, MEDIUM)
```
- if (nextJ < -1 || nextJ > numLeaves + 1) break;
+ if (false) break;          // 4 mutants survive on this line
+ if (nextJ < -1 && ...) break;
+ if (nextJ <= -1 || ...) break;
+ if (... || nextJ >= numLeaves + 1) break;
```
**Why it survived:** every `maxFanCount` test that pushes the walk to a boundary uses *covers* (cover_weight 4) to absorb the impulse first. The bare `nextJ` boundary check is dead in the current test set because the cover always blocks earlier.
**Action:** add a cover-less variant: `maxFanCount` on a hypothetical configuration where covers are weighted equal to pages, then assert that walking from `j = -1` with infinite impulse stops exactly at `nextJ = numLeaves + 1` (not `numLeaves + 2`).

### 6. `src/book/BookState.ts:282` and `:328` — guard rails on terminal-state startTurn / startFanTurn (REAL GAP, MEDIUM)
```
- if (this.isTurning || this.j >= this.numLeaves + 1) { ... return false; }
+ if (this.isTurning || this.j >  this.numLeaves + 1) { ... }   // off-by-one
+ if (this.isTurning || false) { ... }
```
**Why it survived:** no test calls `startTurn()` from the after-back-cover state (`j === numLeaves + 1`). The ≥ vs > distinction matters because at exactly `j = numLeaves + 1` the call must be a no-op.
**Action:** add `startTurn() returns false (no-op) when book is closed past back cover` and the symmetric `startReverseTurn() returns false when j === -1`. The same fixes #7 (`startFanTurn` at `j > numLeaves`).

### 7. `src/book/BookState.ts:400-401` and `:424-428` — `cover_back_ext` content + description (REAL GAP, LOW)
```
- } else if (j === this.numLeaves + 1) { return { left: 'cover_back_ext', right: null }; }
+ } else if (j === this.numLeaves + 1) {}                    // returns undefined!
+ return { left: "", right: null };
```
And the parallel `getStateDescription()` block at 424–428.
**Why it survived:** `visible(numLeaves + 1)` is never called by any test, and `getStateDescription()` is tested only at `j = -1` and an interior `j`, never at `j = numLeaves + 1`.
**Action:** add `visible(j) at terminal states` parametrised over `j ∈ {-1, 0, numLeaves, numLeaves+1}` asserting the exact `{left, right}` mapping; same for `getStateDescription` for the closed-back-cover case.

### 8. `src/book/PageGeometry.ts:58` — loop bound off-by-one (REAL GAP, LOW)
```
- for (let i = 0; i < positions.count; i++) {
+ for (let i = 0; i <= positions.count; i++) {
```
**Why it survived:** at `i === positions.count`, `original[i*3]` is `undefined`, computations become `NaN`, and `positions.setXYZ(count, NaN, NaN, NaN)` writes past the buffer with no observable effect (Three's BufferAttribute silently no-ops). Tests only assert positions at indices the loop covers in both versions.
**Action:** assert `positions.count` is unchanged after `applyCurlDisplacement` and that no NaN values exist in the output buffer.

### 9. `src/book/PageGeometry.ts:81` — `positions.needsUpdate` flag never asserted (REAL GAP, LOW)
```
- positions.needsUpdate = true;
+ positions.needsUpdate = false;
```
**Why it survived:** no test reads `geometry.attributes.position.needsUpdate`. The flag is essential at runtime (without it, Three.js silently keeps stale GPU buffers), but unit tests inspect the CPU-side data directly.
**Action:** add `applyCurlDisplacement marks positions for GPU upload` → `expect(positions.needsUpdate).toBe(true)`. One-line test.

### 10. `src/book/CreaseGeometry.ts:89-90` — `wrapAngle` boundary equality (EQUIVALENT, IGNORE)
```
- while (x > Math.PI)  x -= TAU;
+ while (x >= Math.PI) x -= TAU;
- while (x <= -Math.PI) x += TAU;
+ while (x <  -Math.PI) x += TAU;
```
**Why it survived:** the wrap range is `(-π, π]` per the doc. Both forms produce the same range for any input *not exactly* at the boundary, and `wrapAngle` is exported but only called for `creaseDir.x/y` calculations whose inputs are continuous — the boundary value `±π` has Lebesgue measure zero in the input space.
**Action:** **mark equivalent.** Document in `CreaseGeometry.ts` JSDoc that boundary inclusivity at `±π` is intentional and undefined-by-design.

## Other notable patterns in the surviving set

- **Telemetry strings & object literals (~14 survivors in BookState.ts:290, 312, 461, 480):** mutations of the `'state-transition'` event name, the `'op'` field, and the entire payload object all survive because no test mocks `emitTelemetry` and asserts what was emitted. **Recommendation:** if telemetry semantics are part of the contract (they look like they are — they're documented in `src/telemetry.ts`), add a single test file `src/book/BookState.telemetry.test.ts` that spies on telemetry and asserts the payload shape for `startTurn`, `startReverseTurn`, `completeTurn`, `cancelTurn`. This would kill ~12 of the surviving mutants in one file.

- **`isReverseTurn` boolean (BookState.ts:119, 458, 477):** the field's initial/reset values are never observed by any test. Either make them part of the public surface (`getIsReverseTurn()`) and assert on it, or accept they're internal-only.

- **38 "no coverage" mutants in `setPageSize`, `setDragPoint`, `clearDragPoint`, `getCornerPosition`, `phiToDragPoint`, `getNextSpread`, `getStateDescription` interior branches:** these methods have *zero* test invocations. They are likely consumed by `Book.ts` only. **Recommendation:** add a smoke test `setters and getters survive a full lifecycle` that touches each public method once on a representative book — turns mutation-eligible code from "no coverage" into "covered & killed."

## Recommendations (prioritized)

1. **CreaseGeometry numeric oracles** (kills items #1, #2, #3 above and ~10 of the 29 surviving CreaseGeometry mutants). Highest payoff per test written. ~6 new `expect(...).toBeCloseTo(...)` assertions.
2. **BookState terminal-state guards** (kills items #5, #6, #7 above and ~8 surrounding mutants). 5–6 tests covering `startTurn` / `startFanTurn` / `startReverseTurn` at every boundary `j`.
3. **Telemetry payload spec** (kills ~14 mutants in one test file). Justifies the existence of `emitTelemetry` as a contract rather than a debug aside.
4. **Cover-back state coverage** (kills ~6 mutants). Cheap.
5. **BookState public-API smoke test** (turns 38 no-coverage mutants into covered ones, most of which will then auto-die under the existing test patterns).
6. **Add `Book.ts` to the mutate list once issue #20 is resolved.** Book.ts is the largest behavioral surface in the codebase; its current mutation coverage is *zero*. The audit-loop story is incomplete without it.

If all of the above are implemented, the projected total mutation score moves from **67.96% → ~88%**, and the covered-code score from **75.36% → ~92%**.

## Reproducing this report

```
npm install                        # ensures Stryker dev deps are present
npm run test:mutation              # ~2 minutes on M-series Mac
open reports/mutation/mutation.html
```

The HTML report is interactive: click any file to see line-by-line mutant status, click any "survived" mutant to see what mutation was applied and which tests *did* run against it.
