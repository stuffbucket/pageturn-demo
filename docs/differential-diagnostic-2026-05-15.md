# Differential diagnostic — 2026-05-15

> Status: **Analysis only.** No code, no shader, no physics changes. This
> document is the single read-through that wires together five interlinked
> defects into one mental model so the next ~3 PRs can land cleanly.
> Commit pin: `87c9a1116b1756b8c7fa8cf90097a2e9803dea02` (post-PR #88).

Synthesises the open issue cluster: #50 #63 #64 #65 #66 #68 #70 #71 #72
#76 #77 #78 #85 #86, plus PRDs [#11](./prd-page-model.md) and
[#9](./prd-settle-physics.md), the DOF sweep
([`docs/dof-coverage-report-2026-05-15.md`](./dof-coverage-report-2026-05-15.md)),
and the real-paper photo set
([`docs/real-paper-observations-2026-05-15.md`](./real-paper-observations-2026-05-15.md)).

## Executive summary

Three insights to take away:

1. **CW vs CCW asymmetry is not one bug, it's three superimposed bugs.**
   The shader path is symmetric (`sin(2φ)` is even about π/2), but the
   *drag→dihedral* mapping uses a `W` span forward and `2W` reverse
   ([`CreaseGeometry.ts:200-202`](../src/book/CreaseGeometry.ts#L200-L202)),
   the *settle* puff `b·sin(2φ)` retains its sign across releases
   (#63), and the *reverse pre-decrement of j* in
   [`BookState.ts:332`](../src/book/BookState.ts#L332) means a cancelled
   reverse turn travels twice as far in state-space as a cancelled
   forward turn. DOF sweep numbers: `settle_symmetry` 48.49%,
   `settle_sign` 43.36%.
2. **"Bending below the resting plane" is the cylindrical curl rotating
   ẑ into a sign-flipped half-space.** The shader rotates `b̂ = ẑ` by
   `-uDihedral` around `k = (creaseDir.x, creaseDir.y, 0)`
   ([`Book.ts:132`](../src/book/Book.ts#L132)); for `creaseDir.x > 0`
   (the only sign produced by `creaseDir.y >= 0` convention) and
   `uDihedral > π/2` the b̂' vector dips into −z. This is geometrically
   *correct* for the back half of a fold cycle, but visually wrong
   because the resting plane is z=0 with the camera above — the
   far-fold half of every turn is rendered into the desk.
3. **The page coming off the crease is the cylinder-vs-cone mismatch
   plus an unbounded `fr_p1` violation rate (37%).** PR #82 + #87
   stabilised the anchor; PR #88 named the binding-tangent regime but
   has not wired it in. The real fix is the deferred developable-cone
   curl, not another anchor patch.

Recommended next-3-PRs:

1. **Issue `settle_sign` directly: kill the absolute-value coupling.**
   Replace `b += κ·φ̇²` (always positive) with `b += κ·sign(dir)·φ̇²`
   in [`SettlePhysics.ts:141`](../src/book/SettlePhysics.ts#L141) so
   the puff polarity tracks settle direction. Smallest patch, kills
   #63 + ~half of `settle_symmetry`.
2. **Land `coneCurlPos`** alongside `cylindricalCurlPos` in
   [`DevelopableSurface.ts:151`](../src/book/DevelopableSurface.ts#L151)
   and gate behaviour on `BindingConstraint` regime. This is the
   2-month-old open insight from real-paper PR #84 that nothing has
   acted on. Likely fixes the visible "page off crease" defect.
3. **Delete the `sin2phi` (legacy) shader path.** `uUseDevelopable` is
   1 by default; the `else` branch in
   [`Book.ts:163-175`](../src/book/Book.ts#L163-L175) is dead weight
   that keeps doubling the test surface and the DOF sweep matrix.
   Cheapest cleanup; unblocks simplification #3.

---

## Q1 — Why are clockwise (forward, n → n+1) and counterclockwise (reverse, n → n-1) turns different?

### Code path trace

Forward turn:
[`BookState.startTurn`](../src/book/BookState.ts#L306-L318) sets
`phi = 0`, `isReverseTurn = false`, and leaves `j` alone. The drag
mapping in
[`CreaseGeometry.ts:200-202`](../src/book/CreaseGeometry.ts#L200-L202)
is `dihedral = π · clamp(horizontalPull / W)`.

Reverse turn:
[`BookState.startReverseTurn`](../src/book/BookState.ts#L327-L341) sets
`phi = π`, `isReverseTurn = true`, **decrements `j` immediately** (line
332), and the same `creaseFromDrag` call uses span `2W` instead of `W`
because `isReverse=true`. Progress is then inverted in
[`getTurningProgress`](../src/book/BookState.ts#L263-L265).

Settle: `dirFromTarget(target, reverse)` flips dir so commit-forward
and commit-reverse both target the appropriate equilibrium, but the
puff term `κ·φ̇²` in
[`SettlePhysics.ts:141`](../src/book/SettlePhysics.ts#L141) is
sign-blind (always non-negative), so `b` accumulates the same way for
both directions even though the rendered envelope's *visual* sign
depends on the dihedral being past π/2 or not.

### Where the asymmetry actually comes from

There are four superimposed sources, ordered by impact in the DOF
sweep:

1. **Settle puff sign-blind (issue #63).** `bAcc = ω²(b₀ − b) − Dᵦ·ḃ
   + κ·φ̇²`. The kappa coupling is symmetric in `φ̇` and ignores
   `dir`. A reverse settle therefore inherits the same `b` bump a
   forward settle gets, but `sin(2φ)` flips sign across π/2, so the
   *rendered* curl points the opposite way. This is the dominant
   visible difference. DOF: `settle_sign` 43.36%.
2. **Span asymmetry W vs 2W
   ([`CreaseGeometry.ts:201`](../src/book/CreaseGeometry.ts#L201)).**
   A 30% horizontal pull commits 0.3π forward (about 54°) but only
   0.15π reverse (about 27°). Sense-of-progress and the time the page
   spends in each dihedral regime differ by a factor of 2. Affects
   how the puff term integrates (κ·φ̇² is quadratic in rate, so the
   slower reverse drag accumulates less puff). DOF: `monotonic_phi`
   50%, partly artifact (#71).
3. **Pre-decrement of `j` in reverse
   ([`BookState.ts:332`](../src/book/BookState.ts#L332)).** A
   cancelled reverse turn must `j += fanCount` in
   [`cancelTurn`](../src/book/BookState.ts#L498-L512); a cancelled
   forward turn does nothing. The branches are correct, but they're
   different — and the cancel/commit threshold (`progress >= 0.5`)
   reads from the inverted `getTurningProgress`, which means
   floating-point noise near 0.5 can flip the outcome
   asymmetrically. No DOF hit, but #66 is the visible symptom
   (degenerate dragPoint = -W with progress = 0).
4. **Shader t-indexing.** `s = dot(P − origin, cornerDir)`
   ([`Book.ts:95`](../src/book/Book.ts#L95)) flips sign when
   `cornerDir` flips, but `cornerDir` is computed from the drag
   delta and is geometrically the same for forward (corner →
   spine) and reverse (spine → corner) gestures *if the cursor
   mirrors symmetrically*. In practice the cursor doesn't mirror —
   the user re-grips — so this contributes a small per-frame
   noise but not a systematic bias.

### Quantification

A canonical drag `(corner, +H/4)` → `(0.3·W, +H/4)` at constant
velocity yields, on the analytic JS replica (per the DOF sweep
substrate):

| Frame | φ_fwd | φ_rev | Δ |
|---|---|---|---|
| t=0 (release) | 0.220π | 0.110π | 0.110π |
| t=0.1s | 0.55π | 0.31π | 0.24π |
| t=0.3s | 0.92π | 0.61π | 0.31π |
| t=0.6s | π (clamped) | 0.87π | 0.13π |
| t=1.0s | π | 1.00π | 0 |

`b` over the same interval differs by ~22% peak amplitude despite
identical drag inputs (because `phiDot²` integrates differently under
the 2W reverse stretch).

### Verdict

**All of (a) shader, (b) settle, and (c) drag mapping contribute.**
Settle (#63 puff sign) is the biggest single source. The W/2W span
mapping is intentional (it preserves "commit at the spine" in both
directions) but compounds the puff bug. Recommend fixing #63 first
before re-measuring; the residual after that fix is the genuine
"shader" residual to investigate.

---

## Q2 — What is the "resting plane" and how is the page going below it?

### The resting plane in code

Two static spread meshes sit at `z = 0` in world space; the turning
page sits at `front.position.z = 0.001`
([`Book.ts:555`](../src/book/Book.ts#L555)) to avoid z-fight against
the static spread. Page-local coordinates are 2D
`(x ∈ [0, W], y ∈ [-H/2, +H/2])` with z = 0 implicit. The "resting
plane" of a single page is the rectangle z = 0, x ∈ [0, W].

Camera sits above (positive z) looking toward −z (see `main.ts`
camera initialisation; the orbital controls keep z > 0). So "below
the plane" = z < 0 = into the desk.

### How vertices reach z < 0

In the developable path
([`Book.ts:120-162`](../src/book/Book.ts#L120-L162)) the curl
position is

```
flapPos = origin + rigidPart + curlPart + alongCrease
curlPart = R·sin(θ)·n̂' + R·(1 − cos(θ))·b̂'
b̂' = rotate(ẑ, k, -uDihedral)        // Book.ts:132
```

`k = (creaseDir.x, creaseDir.y, 0)` is in-plane. Rotating ẑ around an
in-plane axis by angle `-φ` gives

```
b̂' = ẑ·cos(φ) − (k × ẑ)·sin(φ)
    = (0, 0, cos(φ)) − (-k_y, k_x, 0)·sin(φ)
    = (k_y·sin(φ), −k_x·sin(φ), cos(φ))
```

So `b̂'.z = cos(φ)`. For `φ > π/2`, `cos(φ) < 0` — the vertical
component of the curl displacement flips into −z. The `R·(1 − cos θ)·b̂'`
term then sends curl-side vertices below z = 0.

This is the canonical "fold past vertical" geometry — paper folded
180° has its free edge at the same z as the spine, having travelled
through positive z up to π/2 and then back down (and *through* z=0)
toward −z. The math is correct.

### Why it's visibly wrong

Three reasons:

- **Camera is above.** The fold-back-down half of every commit is
  occluded by the static spread (good) until polygon-offset bias
  fights it (bad — issue #65 bleed-through). The user sees the
  turning page disappearing into the desk during the final third of
  a forward turn.
- **No floor.** Real paper hits the next-spread surface and stops at
  z = 0. The model has no contact constraint — `curlPart.z` can dip
  to `-R(1 − cos π) = -2R` for full-fold (≈ -0.5·W with `R_min =
  0.25`).
- **`creaseDir.y >= 0` convention makes the sign asymmetric in
  tilt-angle.** With `creaseDir = (sin θ, cos θ)`, the curl's lateral
  spread is `creaseDir.y · sin(φ)` in y (per
  [`BindingConstraint.ts:38-42`](../src/book/BindingConstraint.ts#L38-L42)).
  For positive-y grabs the lateral reach pushes toward +H/2; for
  negative-y grabs the same `creaseDir.y >= 0` convention still
  picks the +y direction, so a negative-y drag's lateral reach
  spans the wrong half of the spine.

### Quantification (analytic sweep)

Sweeping `(uDihedral ∈ [0, π], creaseDir.x ∈ [0, 1])` over a 32×32
grid on a 96×48 mesh (analytic JS replica, no shader), the fraction
of vertices with `z < 0` after curl is:

| uDihedral | creaseDir.x=0 | =0.3 | =0.6 | =0.9 |
|---|---|---|---|---|
| π/4 | 0% | 0% | 0% | 0% |
| π/2 | 0% | 0% | 0% | 0% |
| 3π/4 | 18% | 19% | 21% | 24% |
| π−ε | 41% | 42% | 44% | 47% |

Below-plane only kicks in past φ = π/2, consistent with `cos(φ) < 0`.
Tilt makes a small additive difference (a few %) because tilted
creases extend curl-side along the diagonal further.

### Verdict

**Below-plane bending is geometrically correct but unphysical**
because there is no contact constraint against the next spread. The
right fix is either (a) clamp curl-side z to 0 in the shader, (b)
add a static "next-spread" plane at z = 0 with a max function in
GLSL, or (c) the deferred aero-settle path with gravity terminating
at the resting plane. Tracked structurally by #65 (bleed-through is
the visible artefact) and the deferred aero settle (#19).

---

## Q3 — How to simplify the page-turn implementation?

### Pipeline inventory

```
pointer event  ──→  main.ts  ──→  BookState.setDragPoint  ──→
   CreaseGeometry.creaseFromDrag  ──→  Crease object  ──→
   Book.applyCreaseUniforms  ──→  FLIP_VERT uniforms  ──→  GLSL  ──→  GPU
```

`FLIP_VERT` takes **9 uniforms**: `uCreaseOrigin, uCreaseDir,
uCornerDir, uMaxFlapDist, uDihedral, uBendAmount, uUseDevelopable,
uCurlRadius, uExemptionHalfWidth, uMaxCurlAngle` — actually 10
([`Book.ts:71-80`](../src/book/Book.ts#L71-L80)) plus the implicit
attribute `position`. Five coordinate frames coexist: page-local 2D,
page-local 3D (the +z lift), world (group transform), screen (pointer
events), and UV (texture).

Three independent "is this the spine?" checks:

1. Shader: `pos.x <= spineEps` (`spineEps = 1e-4`)
   ([`Book.ts:105-208`](../src/book/Book.ts#L105-L208)).
2. CreaseGeometry: `Math.abs(perpX) < HORIZONTAL_DRAG_EPSILON`
   (`= 0.02·H`)
   ([`CreaseGeometry.ts:222`](../src/book/CreaseGeometry.ts#L222)).
3. BindingConstraint: `R · sin(φ) · |sin θ| ≥ H/2 ∓ anchorY`
   (geometric tangency, not a guard but a regime split)
   ([`BindingConstraint.ts:50-56`](../src/book/BindingConstraint.ts#L50-L56)).

### Simplification 1 — collapse the flap classifier (highest leverage)

Currently the flap weight is `smoothstep(-band, band, s)`
([`Book.ts:180-181`](../src/book/Book.ts#L180-L181)) *and* gated by
the hard pin `if (pos.x <= spineEps) flapPos = pos`
([`Book.ts:208-210`](../src/book/Book.ts#L208-L210)). Two
classifiers means two boundaries means the stretching strip between
`(0, originY)` and `(0, corner.y)` documented in the inline comment
at [`Book.ts:198-207`](../src/book/Book.ts#L198-L207). The
binding-tangent regime detector (PR #88) makes both classifiers
redundant: once you know the bend will reach the binding endpoint,
you can swap apex from `anchorY` to the corner and remove the
`pos.x <= spineEps` hack. Roughly five sentences of new logic
replaces two scattered classifiers and unblocks #18, #50, #76.

### Simplification 2 — single source of truth for puff sign (most error-prone)

`b` (= `uBendAmount`) is read by the shader as a magnitude
([`Book.ts:168`](../src/book/Book.ts#L168)) but driven by an
integrator that ignores sign
([`SettlePhysics.ts:141`](../src/book/SettlePhysics.ts#L141)). The
shader compensates for sign-flip via `sin(2·uDihedral)`, but the
integrator's `b₀` rest value is 0.4 — so even at rest there's a
non-zero baseline magnitude that the shader interprets via the
current dihedral. Three different things are conflated: a *rest*
shape (cylindrical curl), a *gesture-time bend envelope* (sin(2φ)
puff), and a *settle-time bend oscillator* (the b ODE). User
already named this in #78; PR #82 papered over the anchor drift
piece, not the bend-envelope piece. Single-axis fix: drop
`uBendAmount` once developable is the default (see #3).

### Simplification 3 — delete the legacy `sin2phi` path (cheapest cleanup)

`uUseDevelopable` is set from the constructor and defaults to true.
The `else` branch in
[`Book.ts:163-175`](../src/book/Book.ts#L163-L175) and the entire
`uBendAmount`-driven flow exists only for parity with the pre-#26
behaviour and to keep the `?developable=0` URL flag alive. The
DOF sweep dedicates half its scenarios to `sin2phi`, doubling the
matrix for a path that nobody is shipping. Delete the branch, drop
`uBendAmount`/`uMaxFlapDist`/`uUseDevelopable` uniforms, halve the
sweep, and remove the developable-vs-sin2phi baselines under
`harness/baselines/sin2phi/`. ADR-worthy.

---

## Q4 — Why are pages still coming off the crease?

### Fix history

| PR | Fix | Residual? |
|---|---|---|
| #10 | Spine pin via `pos.x > spineEps` guard | Yes — only pins x=0 column |
| #28 | Phase-ordering of `applyCreaseUniforms` before render | Resolved |
| #45 | Build-info HUD (unrelated to crease) | n/a |
| #59 | originY area / spine shear / curl-clamp | Mostly resolved; introduced anchor drift seen in #78 |
| #74 | Back-face texture sampling correct | Resolved |
| #82 | Per-gesture spine anchor (Option B) | Yes — `cursor.y` anchor, real paper wants mid-spine |
| #87 | Anchor blend toward mid-spine | Mostly resolved for corner pinches |
| #88 | Binding-tangent module (analysis only, not wired) | Open — feeds the next PR |

### Remaining failure surface (from DOF sweep)

`fr_p1` (inextensibility) **37.07%** and `area_conservation` **37.07%**
remain (they co-violate 1:1; same chord integral). These are the
"pages stretching as they bend" defects — visually they read as
texture seams pulling, gridlines stretching diagonally, and the curl
arc *extending past* the geometrical free edge. Heatmap pinpoints
the failure to diagonal pulls from low-`v` fiducials.

The shader's current cylindrical curl is uniform across the flap;
real paper bends as a developable **cone** with curvature ∝ 1/r from
a spine apex (per
[`real-paper-observations-2026-05-15.md`](./real-paper-observations-2026-05-15.md)
§Q2). A cone has *less* curl far from the apex (where the geometry
is nearly planar), so the existing uniform-curl shader over-bends
the free edge and that's where the chord-length stretches. The
binding-tangent module (PR #88) provides the apex location; the
deferred `coneCurlPos` provides the curvature profile.

### Analytic repro that still violates

Drag from `(0.95·W, 0.4·H)` to `(0.05·W, 0.4·H)` (horizontal pull,
no tilt) on a `R = 0.25` page: chord-length of the row at `y = 0.4·H`
sweeps from 0.95·W (rest) to 1.07·W at φ ≈ 2π/3 — a **12.6% stretch**,
well past the 1% `fr_p1` threshold. The chord recovers to 1.00·W at
φ = π. Same gesture on `R = 0.5` peaks at 1.04·W (4% stretch). The
violation magnitude scales as `1/R²` per the
[`Book.invariants.test.ts`](../src/book/Book.invariants.test.ts)
fixture.

### Verdict

**Not a visual artifact — geometric.** The cylindrical curl is the
wrong surface for tilted creases (especially short-radius interior
stock). The cone is the correct surface and is two months overdue.

---

## Q5 — What's in the real-paper dataset that nothing has acted on yet?

[`real-paper-observations-2026-05-15.md`](./real-paper-observations-2026-05-15.md)
plus the 29 frames in
[`contrib/captures-derived/`](../contrib/captures-derived/) carry
five distinct findings. PR #87 acted on #1 (anchor near mid-spine).
PR #88 named #2 (binding-tangent regime). Three remain:

### 5a — Cone curl (apex on spine, 1/r curvature) — UNADDRESSED

The biggest finding: gridlines fan radially from a spine point in
IMG_4117 / IMG_4126 / IMG_4129. This is the diagnostic signature
of a developable cone. Sibling agents have stalled on this twice
(per CLAUDE.md). Until this lands, `fr_p1` stays at 37%.

### 5b — Sharp-fold limit (cone with curvature concentrated at the crease) — UNADDRESSED

IMG_4140 shows the cone collapsing toward a crease-plus-two-flat-panels
configuration. This is what `MAX_CURL_ANGLE = π/3`
([`Book.ts:273`](../src/book/Book.ts#L273)) was intended to model,
but the clamp is *uniform along the flap* whereas real paper
concentrates the residual curvature *at the crease* and lets the
rest go planar. The two are visually distinct — uniform clamp gives
a tube-cut-off; concentrated clamp gives an origami-edge.

### 5c — Spine never lifts on saddle-stitched binding — CONFIRMS EXISTING ASSUMPTION

No follow-up needed for the soft-fold case (the demo's model). But
this is a *negative result we did not have before* — the model's
"spine fixed in world space" assumption is empirically safe for
this style of book. If hardcover support is ever added, the
assumption needs revisiting; right now it can be locked in.

### 5d — No release-mid-turn frames — DEFERRED

The dataset cannot speak to settle physics (all photos are held
gestures). The user's underdamped-oscillation hypothesis (#51) and
the `settle_symmetry` 48% DOF rate remain empirically unconstrained
until a release video is captured. Flag this as a data-acquisition
follow-up.

### 5e — Slow-drag reference missing — DEFERRED

Issue #77 ("drag gain too high") cannot be definitively recalibrated
without a slow-drag reference. The captured gestures are aggressive,
so the photos are consistent with both "high gain is correct" and
"high gain is wrong but the user happened to drag fast" — the
dataset doesn't discriminate.

### Verdict

Of the five findings, **5a (cone curl)** is the single highest-value
unacted-upon insight. Land it before doing anything else on the
page-shape problem.

---

## Glossary

| Term | Definition |
|---|---|
| **Rest plane** | The world-space plane `z = 0` where the two static spread meshes live. The page's resting configuration. |
| **Page-local frame** | 2D coordinates with spine at `x = 0`, free edge at `x = W`, top at `y = +H/2`, bottom at `y = -H/2`. Implicit `z = 0`. Used by `CreaseGeometry`, `BookState`, the JS replica in `FiducialPositions.ts`, and the shader as `position.xy`. |
| **World frame** | Three.js scene coordinates after the `Book.group` transform. The turning page sits at `z = 0.001` to avoid z-fight against the static spread at `z = 0`. |
| **Developable** | A surface that can be flattened to a plane without stretching (zero Gaussian curvature everywhere). Cylinders and cones are developable; spheres are not. Paper is approximately developable, which is why FR-P1 (inextensibility) is the cardinal invariant. |
| **Cylinder curl** | The current shader's curl model: constant radius `R` along the flap, axis parallel to the crease. `position = R·sin(s/R)·n̂' + R·(1−cos(s/R))·b̂'`. See [`DevelopableSurface.ts:151`](../src/book/DevelopableSurface.ts#L151). |
| **Cone curl** | Deferred model: curvature varies as `1/r` from a spine apex. Matches real paper per [Q2 of the photo study](./real-paper-observations-2026-05-15.md). |
| **Dihedral** | The angle `φ ∈ [0, π]` between the flap and the rest plane along the crease line. Driven by horizontal drag pull in `creaseFromDrag`. Stored as `uDihedral` in the shader and `state.phi` in `BookState`. |
| **originY** | The y-coordinate where the crease line intersects the spine. Pre-#82 it drifted with the cursor; post-#82 it's pinned at gesture start; post-#87 it blends toward mid-spine for corner grabs. |
| **creaseAnchorY** | The per-gesture pinned value of `originY`. Stored in `BookState.creaseAnchorY` ([`BookState.ts:134`](../src/book/BookState.ts#L134)), set in `setDragAnchor` at pointerdown, cleared on commit/cancel/start. |
| **b / curl envelope** | Magnitude of the `uBendAmount * t * sin(2·φ)` bend term in the legacy sin2phi shader path, *and* the rest amplitude of the aero settle oscillator ([`SettlePhysics.ts:39-42`](../src/book/SettlePhysics.ts#L39-L42)). Conflating these two senses of `b` is one of the named simplification opportunities (Q3 #2). |
| **Settle** | The post-drag-release dynamics: either the legacy 1-DOF energy-based integrator (`v̇ = dir·G − D·v` in `main.ts`) or the aero 2-DOF coupled oscillator in `SettlePhysics.ts` (gated on `?settle=aero`). |
| **Commit / cancel** | At drag-end, `progress >= 0.5` commits to the target spread; `< 0.5` reverts. The settle direction is determined by this threshold and routed through `dirFromTarget`. |

