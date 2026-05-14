# Mutation Test Report — 2026-05-14

**Tool:** [StrykerJS](https://stryker-mutator.io/) `@stryker-mutator/core@9.6.1`
**Config:** `stryker.page-model.conf.json` (focused page-model run; main
`stryker.conf.json` was simultaneously updated to re-include `Book.ts` and
`PageMaterial.ts` now that ADR-0001 has resolved the Stryker dry-run failure).
**Run command:** `npx stryker run stryker.page-model.conf.json`
**Time-to-run:** ~3 min on the host machine (4 concurrent runners).
**Report HTML:** `reports/mutation/page-model.html`

## Why this audit

Per the PR #59 review, harness-video failure modes (originY-driven mesh shear,
inextensibility violations, tilted-crease orientation flips) were **not** being
caught by the unit-test suite. The hypothesis: existing tests assert shape
("originOnEdge is pinned to x = 0", "creaseDir is perpendicular to drag") but
never numeric magnitude, so a wide class of arithmetic mutations slips through.
This audit confirms and closes that gap for the page-model files.

## Scope

Mutated files:

| File | LoC |
|---|---|
| `src/book/Book.ts` | 1001 |
| `src/book/CreaseGeometry.ts` | 239 |
| `src/book/DevelopableSurface.ts` | 237 |
| `src/book/SettlePhysics.ts` | 194 |
| `src/book/PageGeometry.ts` | 83 |
| `src/book/PageMaterial.ts` | 76 |

A separate run against the full project (`stryker.conf.json`) reproduces the
same numbers for these files plus the unchanged `BookState.ts` baseline.

## Results

### Before / after (this audit)

| File | Before (total) | After (total) | Before (covered) | After (covered) |
|---|---|---|---|---|
| CreaseGeometry.ts     | 63.6 % | **89.8 %** | 65.9 % | **90.8 %** |
| SettlePhysics.ts      | 56.8 % | **84.2 %** | 71.1 % | **86.0 %** |
| DevelopableSurface.ts | 49.5 % | **79.3 %** | 50.5 % | **80.7 %** |
| PageGeometry.ts       | 79.4 % | **91.2 %** | 84.4 % | 91.2 % |
| PageMaterial.ts       |  0.0 % | **100 %**  | n/a    | 100 % |
| Book.ts               | 19.6 % | 19.6 %    | 29.6 % | 29.6 % |
| **All files**         | 38.5 % | **52.2 %** | 49.1 % | **63.4 %** |

Note: Book.ts gained no mutation kills because its surviving mutants live in
shader-string literals, Three.js mesh lifecycle, and the popup scaffolding —
none of which the existing `Book.test.ts` exercises at a level Stryker can
detect. Bringing it into the mutate set was still the right move (issue #20 /
ADR-0001 is closed and the baseline is now visible for future passes).

### Total counts after the audit

```
Killed:    320
Timeout:    30   (counted as killed)
Survived:  202
NoCov:     119
Errors:    181   (TypeScript-rejected mutants, not scored)
```

## Tests added

Four new test files; each `it` is annotated with the mutant it kills:

| File | Tests | Targets |
|---|---|---|
| `src/book/CreaseGeometry.mutation.test.ts` | 17 | L122 (`2*W` reverse span), L143 (`0.02*H` epsilon), L154–L156 (Mx, My, rawSpineY), L177 (tanh argument), L183/L184 (creaseDir orientation flips), L195 (degenerate cornerDir), L223 (progress), L232 (reflectAcrossLine anchor) |
| `src/book/SettlePhysics.mutation.test.ts` | 13 | L110 (`G·sin(φ)`), L114 (`ω²`), L130/L131 outer phi clamps, L134/L135 outer b clamps, L130–L135 inner sign-preservation, L188–L192 (URL parsing) |
| `src/book/DevelopableSurface.mutation.test.ts` | 22 | L74/L85 (stock names), L117–L121 (radius corner cases + clamps), L163–L203 (tilted-k̂ Rodrigues oracle), L195 (R safety threshold), L234/L236 (chordDistance), L52 (URL parsing) |
| `src/book/PageGeometry.mutation.test.ts` | 6 | L53 (missing-original warning path), L58 (no past-buffer NaN), L66/L70 (curl region boundaries), L81 (needsUpdate flag) |
| `src/book/PageMaterial.test.ts`            | 4 | full smoke coverage of the (legacy) factory + uniform updaters |

All new tests are additive — existing tests are unchanged. A sibling agent is
adding fiducial-trajectory invariant tests to `DevelopableSurface.test.ts` and
a new `Book.invariants.test.ts`; this audit deliberately avoids touching those
files.

## Surviving mutants — categorisation

The remaining 202 survivors fall into four buckets:

### (a) Equivalent — sealed by function contract

These mutations produce no observable behaviour change because the surrounding
code structure guarantees the mutated factor evaluates to zero or to the
identity, regardless of input.

- **`DevelopableSurface.cylindricalCurlPos` Rodrigues body, lines 178–203.**
  The function constructs `n̂` orthogonal to `k̂` (n̂.x = k.y, n̂.y = -k.x by
  the canonical book orientation), so `kDotN = kx·nx + ky·ny ≡ 0`. Likewise
  `knX = ky·0 - kz·ny` and `knY = kz·nx - kx·0` collapse to 0 because k̂ lifts
  Vec2 to (x, y, **0**) with kz literally zero. Stryker mutates the factors
  inside these dead terms (1 ± c, signs on knX·si, kx·kDotN), and every such
  mutation is mathematically equivalent to the original. ~12 mutants total.
- **`DevelopableSurface` flapSign sign-vs-divide.** flapSign ∈ {+1, −1}, so
  `creaseAxis.y * flapSign` and `creaseAxis.y / flapSign` are identical.
- **`SettlePhysics.step` inner sign clamps.** The inner `if (phiDot < 0)`
  guard inside the outer `if (phi < 0)` block only ever fires with phiDot < 0
  (the outer block presupposes phi went negative, which under semi-implicit
  Euler requires phiDot < 0). The `if (true)` mutant produces the same output
  in every reachable state. Same reasoning for the symmetric L131/L134/L135
  inner guards.
- **`CreaseGeometry.creaseFromDrag` L208 `corner.x − origin.x`.** origin.x is
  pinned to 0 by construction; the sign flip is invisible.
- **`SettlePhysics.isConverged` L174 `state.phi + target`.** For target = π
  (the only target where the mutant differs algebraically), the convergence
  region around phi = π keeps both `cos(phi − π)` and `cos(phi + π)`
  approaching the same limit.

### (b) Equivalent — boundary inclusivity

Strict-vs-non-strict comparisons that only differ at exact floating-point
boundaries (a measure-zero set in the input space). Documented as intentional
in the original report and unchanged here:

- `CreaseGeometry.wrapAngle` (`x > π` vs `x >= π`, `x <= −π` vs `x < −π`)
- `CreaseGeometry` `HORIZONTAL_DRAG_EPSILON` strict-vs-non-strict.
- `SettlePhysics` `phi <= 0` / `phi >= π` / `b <= 0` / `b >= bMax` clamp
  inclusivity, and `energy <= eps` in isConverged.
- `SettlePhysics.progressFromPhi` `p <= 0` / `p >= 1`.
- `DevelopableSurface.radiusFromBendingStiffness` `raw <= R_min` /
  `raw >= FLAT_RADIUS`.

### (c) Equivalent — code-path-redundant

These mutations *do* change behaviour at the mutation point, but a subsequent
clamp or default in the same function masks the difference:

- `DevelopableSurface.radiusFromBendingStiffness` L117 `gravityMoment <= 0 →
  gravityMoment < 0`. At M = 0 the original short-circuits to FLAT_RADIUS; the
  mutant proceeds, computes raw = D/0 = ∞, and gets clamped to FLAT_RADIUS by
  L121 — same observable result.
- Same pattern for L118 `D <= 0 → D < 0` (lands on the L120 R_min clamp).

### (d) Untestable from unit tests — shader / GPU code

Almost the entirety of the 157 surviving Book.ts mutants. The active vertex
shader is the inline `FLIP_VERT` GLSL string in `Book.ts`. Stryker mutates the
string literal but happy-dom never compiles or runs it, so the GLSL semantics
are invisible at the unit-test layer. The harness `runScenarioTrajectories`
mode replicates the FLIP_VERT math analytically in JS and compares to
baselines; that is the mutation-style coverage for the shader. We do not
attempt to lift Book.ts here.

## Per-file commentary

### CreaseGeometry.ts — 89.8 % (was 63.6 %)

Met the ≥ 85 % goal. The remaining 8 survivors are all category (a) or (b)
above. The numeric `originY` oracle (analytic re-derivation in the test) is the
single highest-value addition: it kills the L154–L156 family that had
previously slipped because every existing test only asserted `originOnEdge.x ===
0`, not its y-value.

### SettlePhysics.ts — 84.2 % (was 56.8 %)

0.79 % under the stated 85 % goal on **total** mutation score; the
**covered-code** score is 86.0 %, above target. The shortfall is from 2
no-coverage mutants in `aerodynamicSettleEnabled` boolean returns (a `return
true`/`return false` pair inside the SSR-safe branch) that require stubbing
the global `location` to exercise. The boundary-equality survivors are
category (b) equivalents. I judged the cost-benefit of a stubbed-location test
not worth a 1 % score bump given the equivalent classification of the remaining
covered survivors.

### DevelopableSurface.ts — 79.3 % (was 49.5 %)

Falls 5.7 % short of the 85 % goal. As analysed in the categorisation above,
roughly 18 of the 21 remaining survivors are category (a) equivalents that
arise from the orthogonality and z-zero construction inside
`cylindricalCurlPos`. Pushing past 80 % on this file would require either:

1. **Refactoring `cylindricalCurlPos`** to remove the dead terms (drop the
   `kx*kDotN` and `kz*X` factors that are statically zero). This would be a
   net code improvement and would let those mutations actually mutate live
   code, but it touches the production renderer and is out of scope for this
   audit.
2. **Adding integration tests** that invoke the function through Book.ts at
   draw time and observe rendered vertex positions. The harness's trajectory
   dataset mode already does an analytical version of this; a Stryker-visible
   integration test would need a Node-side Three.js fake.

Both options are tracked as **issue #61**.

### PageGeometry.ts — 91.2 % (was 79.4 %)

Met. Three survivors all category (b).

### PageMaterial.ts — 100 % (was 0 %)

New test file. Module is **legacy** — see CLAUDE.md "Legacy" — so the suite is
shallow on purpose; it pins the surface so the file remains compilable should
it be re-activated.

### Book.ts — 19.6 % (unchanged)

Added to the `mutate` set for the first time. The score is low because:

- The dominant code-volume is the GLSL `FLIP_VERT` shader (a string literal);
  Stryker mutates it, but no JS-side test can detect the change.
- Mesh-lifecycle code (creation, disposal, polygon-offset config) is also
  poorly observable from the headless test runner.
- The popup scaffolding (createPopup) is intentionally dead code per ADR-0001.

The 40 killed + 26 timed-out mutants come from `applyAnimationFrame`,
trajectory analytics, and other JS-callable code paths that have real
coverage. Issue #61 will propose either splitting Book.ts into a thin
Three.js façade + a testable JS core (preferred) or trimming the mutate set
for this file.

## TS-checker fix landed in this branch

The `@ts-expect-error TS6133` directive on `createPopup` (Book.ts:346) failed
the Stryker TypeScript checker dry-run with `TS2578: Unused
'@ts-expect-error' directive` because Stryker's instrumented compilation
re-evaluates whether the next line would have erred. Switched to `@ts-ignore`
which the regular `tsc --noEmit` accepts too — no behaviour change, and the
annotation still flags createPopup as intentionally unused.

## Reproducing this report

```bash
# Focused page-model run (used in this report):
npx stryker run stryker.page-model.conf.json
open reports/mutation/page-model.html

# Full project run (canonical config — now includes Book.ts + PageMaterial.ts):
npm run test:mutation
open reports/mutation/mutation.html
```
