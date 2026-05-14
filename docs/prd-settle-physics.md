# PRD: Aerodynamic settle physics with dihedral preservation

Status: Draft
Owner: Page-turn renderer
Scope: Visual / physics behavior of the page-release "settle" phase

## Background

Today, when a drag (or flick) ends mid-turn, `main.ts` enters a `settling`
state and runs an energy-based 1D ODE on a single scalar `dragProgress` (see
`src/main.ts` ~480–540). The integrator is

```
v̇ = dir · G − D · v       (G = GRAVITY = 5.0, D = DRAG_COEFF = 6.5)
p  = clamp(p + v·dt, 0, 1)
stop when ½v² + G·|p − target| < SETTLE_ENERGY_EPS (= 0.005)
```

`p` is then fed back through `book.updateTurningPage(p)`, which drives the
`uDihedral` uniform of the inline `FLIP_VERT` shader in `src/book/Book.ts`.
The crease parameters captured at drag-end (`creaseDir`, `originOnEdge`,
`alpha`, see `CreaseGeometry.ts`) are effectively frozen; only `uDihedral` is
animated. The result is a rigid, geometric interpolation of one degree of
freedom — the page reads as a kinematic prop rather than a physical sheet.

What is missing: (1) the tilted-crease state captured at release is not
*evolved* during settle, (2) there is no aerodynamic forcing — the flap does
not feel trapped air escaping from the free edges, (3) the initial fall
direction does not depend on the page's center-of-gravity offset and the
release velocity, (4) the bend envelope itself is constant — the page never
flutters, billows, or relaxes in shape independently of `φ`.

## Goals

- A released page visually behaves like a real falling page: it continues to
  curl, the curl shape evolves, and it settles with a soft, slightly damped
  motion rather than a snap.
- Releases at different angles and velocities produce visibly different fall
  paths (steep release → near-vertical drop; shallow release → tangential
  drift before settle).
- A subtle, perceptible flutter/billow appears under the lifted flap,
  strongest near the free edges and absent at the crease.
- Commit-vs-cancel behavior remains predictable. A release past the existing
  threshold still commits; a release before it still cancels. Aerodynamics
  perturb the *shape* of the trajectory, not the discrete outcome (modulo a
  small documented overshoot window — see Open Questions).
- No regression in frame-time budget on mid-tier hardware (see Validation).

## Non-goals

- Full N-body cloth simulation (mass-spring lattice, FEM, position-based
  dynamics) on the page mesh.
- Real fluid dynamics (Navier–Stokes / SPH) of the air pocket.
- Multi-page interactions during settle (next/previous spread pages remain
  static; only the lifted flap is dynamic).
- GPU compute / transform-feedback vertex physics. The proposed model is
  small enough to evaluate analytically per vertex inside the existing
  vertex shader, with at most a handful of new uniforms updated on the CPU.
- Physical accuracy beyond visual plausibility. Coefficients are art knobs.

## Functional requirements

**FR-1. Continued dihedral curl during settle.**
- FR-1.1 At settle entry, `dihedral`, `creaseDir`, `originOnEdge`, and `alpha`
  shall be snapshotted as the *initial state* of the settle integrator, not
  as constants. The integrator state vector grows from `{p, v}` to at least
  `{φ, φ̇, originY, ȯriginY}` (or an equivalent parameterization).
- FR-1.2 During settle, `creaseDir` and `originOnEdge` shall evolve
  continuously such that on commit they reach the canonical
  fully-turned crease, and on cancel they reach the canonical rest crease,
  with no C0 discontinuity at hand-off to the static spread mesh.
- FR-1.3 At any sample during settle, `getCrease()` telemetry shall report
  values that vary frame-to-frame (i.e., the crease is not frozen).

**FR-2. Aerodynamic normal forcing.**
- FR-2.1 The bend envelope shall depend on a per-vertex pressure scalar
  `q(t)` such that, at any time during settle, the normal-direction
  displacement at vertices within 10% of the *free* edge of the lifted flap
  is at least 1.5× the displacement at vertices within 10% of the crease,
  at equal `uDihedral`.
- FR-2.2 The pressure scalar shall vanish (or asymptote to its rest value)
  as `dihedral → 0` (page flat against next/previous spread) — air has
  escaped, no further forcing.
- FR-2.3 The forcing shall be smooth in time (C1) and bounded — no NaNs,
  no per-frame spikes > 2× the prior frame's pressure value.

**FR-3. Center-of-gravity initial direction.**
- FR-3.1 At settle entry, the lifted flap's center of gravity shall be
  computed in page-local space as the area-weighted centroid of the
  flap region (vertices with `s > 0` in the `FLIP_VERT` half-space).
- FR-3.2 The settle integrator's initial *direction* shall combine
  (a) gravity acting straight down in world space, and (b) the release
  velocity vector inferred from `dragVelocity` and the crease tangent. A
  release with `dihedral ≈ π/2` shall produce a settle whose first 100 ms
  of CoG motion is within 15° of world-down; a release with `dihedral`
  small and large tangential `dragVelocity` shall produce CoG motion whose
  tangential component dominates for the first 100 ms.
- FR-3.3 The flick threshold (`FLICK_THRESHOLD = 1.5`) and the 0.5 commit
  threshold are preserved as the *gating* logic for target selection.

**FR-4. Shape evolution through gravity.**
- FR-4.1 `uBendAmount` (currently a constant 0.4) shall become a
  time-varying uniform during settle, driven by the same integrator that
  drives `φ`. At rest (commit or cancel) it returns to its baseline value.
- FR-4.2 Whether the page commits or cancels is determined at settle entry
  by current rules (FR-3.3); however, the *shape* trajectory (curl over
  time) is free to overshoot or relax outside the monotone interpolation
  the current model enforces — see Open Questions for the overshoot
  envelope cap.
- FR-4.3 Hand-off to the static spread mesh on `completeTurn`/`cancelTurn`
  shall match the final dynamic shape to within a per-vertex tolerance of
  0.5% of `pageWidth`, to avoid a visible pop.

## Math sketch

Augment the integrator state to `(φ, φ̇, b, ḃ)` where `b` is the bend
envelope amplitude (current `uBendAmount`). Drive both with damped,
gravity-forced ODEs:

```
φ̈ = dir · G · sin(φ) − D · φ̇                (gravity torque on the flap)
b̈ = ω² · (b₀ − b) − Db · ḃ + κ · φ̇²         (aero "puff" excited by flap rate)
```

`sin(φ)` makes torque vanish when the flap is flat (matching reality and
removing the current artificial "minimum velocity" hack at `beginSettle`).
The `κ · φ̇²` term injects energy into `b` proportional to how fast the
flap is sweeping air — this is the aerodynamic puff. `ω, Dᵦ, κ` are art
knobs.

**Initial suggested values** (PRD draft): `G = 5`, `D = 6.5`, `ω = 12 rad/s`,
`Dᵦ = 6`, `κ = 0.05`. These produced a heavily over-damped φ tail
(ζ_φ ≈ 1.45) and a slowly-decaying b oscillator (ζ_b = 0.25). On review
the page took ~3–5 s to land from a low-velocity commit, with a visible
"crawl" through the last 10–20% of the motion.

**Tuned values** (PR #49 follow-up, current `DEFAULT_AERO_PARAMS`):
`G = 10`, `D = 4`, `ω = 18 rad/s`, `Dᵦ = 18`, `κ = 0.08`, `b₀ = 0.4`,
`bMax = 0.7`. These give:

- ζ_φ = D / (2·√G) ≈ 0.63 — lightly under-damped, one small overshoot
  absorbed by the inelastic wall clamp at φ ∈ {0, π}.
- ζ_b = Dᵦ / (2·ω) = 0.50 — inside the [0.4, 0.7] paper-like band; the
  envelope decays as exp(−ζω·t) = exp(−9·t), so a typical puff bump falls
  under 0.02 in ~100 ms.
- `G` doubled (5 → 10) so the natural-frequency timescale 1/√G is √2
  shorter; typical mid-fold flicks now land in 300–700 ms instead of
  3–5 s.
- `κ` raised in step with ω² so the visible puff amplitude (analytic
  κ·φ̇²/ω²) is preserved as the b oscillator stiffens.

Per-vertex pressure shaping extends the existing shader formula. Today:

```
φ_vertex(t) = uAngle + 0.4·t·sin(2·uAngle)
```

Proposed (with `t` = normalized distance from crease, `e = 1 − t` = distance
from free edge, both in [0,1]):

```
φ_vertex(t) = uAngle + b(τ) · t · sin(2·uAngle) + uPuff(τ) · t² · (1 − e²)
```

where `uPuff` is a new uniform fed by `b − b₀`. The `t² · (1 − e²)` profile
peaks near the free edge (FR-2.1) and vanishes at both crease (`t=0`) and
infinity. CoG-driven initial direction (FR-3.2) is encoded by mapping the
initial `φ̇` and a new `uTangentDrift` uniform that decays over ~150 ms.

Inspired-by (cite, do not copy): Weil 1986 "The synthesis of cloth objects",
and Provot 1995 mass-spring papers, for the qualitative observation that a
single-DOF dihedral plus a free-edge bias is sufficient for visually
plausible paper-fall — full lattice cloth is overkill at this scale.

## Open questions

1. Should the integrator allow the flap to *overshoot* past `dihedral = 0`
   on the commit side (i.e., briefly enter the next spread's half-space)
   before relaxing? Aesthetically pleasant; but will it z-fight or clip
   into the popup spread?
2. Does the popup diorama (`POPUP_SPREAD = 7`) need collision response
   from a falling page, or do we keep them visually independent?
3. Is `uBendAmount` allowed to *exceed* its baseline 0.4 transiently, or
   should it strictly satisfy `b ≤ b₀`? (Affects whether the flap can
   appear to balloon outward before settling.)
4. Should `creaseDir` and `originOnEdge` evolve on a separate, faster
   timescale than `φ` (i.e., the crease "untilts" before the page is fully
   down), or co-evolve on the same timescale?
5. Does fan-turn settle reuse this model, or remain on the current rigid
   timed interpolation? (Recommend: keep fan as-is for v1.)
6. Telemetry: do we add a new `settle-sample` event type for QA, or extend
   `pointer-move`'s crease payload?

## Implementation hints (non-binding)

- **`src/main.ts`** — replace the `if (this.settling) { ... }` block in
  `animate()` and `beginSettle()` with calls into a new module. State on
  `App` likely grows from `settleVelocity` to a small struct.
- **`src/book/Book.ts`** — `FLIP_VERT` gains `uPuff` and `uTangentDrift`
  uniforms; `BookMaterial` needs the matching defaults; `updateTurningPage`
  grows an overload (or a sibling method) that takes the full settle state
  rather than a scalar.
- **New `src/book/SettlePhysics.ts`** — pure module exporting
  `step(state, dt) → state` and `entry(release) → state`. Pure, easy to
  unit-test in the same style as `BookState`.
- **`src/book/CreaseGeometry.ts`** — likely gains a helper for "interpolate
  crease toward rest" given a `b ∈ [0,1]` parameter, used by FR-1.2.

## Validation plan

1. Add a `settle-aero` baseline directory under `harness/baselines/`, with
   the same per-scenario JSON layout documented in
   `harness/baselines/README.md`.
2. Add two new scenarios under `harness/scenarios/`:
   - `release-steep` — drag to `dihedral ≈ 0.4·π`, release with near-zero
     velocity. Expected: near-vertical CoG drop with visible flutter.
   - `release-shallow-flick` — drag to `dihedral ≈ 0.15·π`, release with
     large tangential velocity. Expected: tangential drift dominates first
     ~150 ms, then commit.
3. Capture the current (rigid) baseline first as `settle-aero/_pre.json`,
   land the new model behind a feature flag, then capture
   `settle-aero/<scenario>.json` post-change.
4. Author a `harness/runner` assertion that, for each new scenario, the
   per-fiducial trajectory satisfies FR-2.1 (free-edge displacement
   dominates crease-edge displacement) and FR-1.3 (crease parameters are
   not constant during settle).
5. Frame-time budget: capture a `fps-sample` histogram during the longest
   scenario (`horizontal-pull`) before/after; require p95 frame time
   regression < 1 ms on the reference Docker harness.
