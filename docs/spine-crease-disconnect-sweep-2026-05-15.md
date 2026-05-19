# Spine/Crease Disconnect — Cross-Fix Sweep (2026-05-19)

> Filename retains the planning date (`2026-05-15`) for continuity with PR #82 / PR #87
> reports; run executed at HEAD `87c9a11` on 2026-05-19.

## Why this sweep

The user has repeatedly reported pages visibly "coming off the crease" / detaching from
the spine across many releases. Seven PRs have nominally addressed this defect
(#10, #28, #45, #59, #74, #82, #87). PR #88 *documents* a successor regime
(`BindingConstraint.ts` / FR-P6 / FR-P7) but **does not wire it into the live drag**.
The residual visual is therefore unsurprising; the question is which of the
remaining gaps is the most likely cause and where to spend the next PR.

## Fix lineage (claim → numeric verification at HEAD)

| PR    | Claim                                                            | DOF-sweep verification (HEAD) |
|-------|------------------------------------------------------------------|-------------------------------|
| #10   | Shader `pos.x > spineEps` guard pins x=0 column                  | `spine_pin_world` = 0 / 5600, `spine_pin_local` = 0 / 5600 |
| #28   | Long-press capture phase/order (capture, not model)              | (out of scope — capture-only) |
| #45   | Build-info HUD / back-face bleed surface                         | bleed visual; not numeric here |
| #59   | originY-deviation area growth + spine shear + curl clamp         | `area_conservation` violations = 1848 / 5600, **max mag 0.023** (just over the 0.01 threshold) |
| #74   | Back-face texture binding (front gradient bled through cover)    | visual; `rest_face_uv` = 1232 |
| #82   | Per-gesture `creaseAnchorY` pinned at pointerdown                | spine pin invariants stay at zero — anchor pinning **holds** numerically |
| #87   | Anchor blends toward mid-spine via smoothstep on \|wx\|/W        | wired in `CreaseGeometry.computeGestureAnchorY`; called from `src/main.ts:496` |
| #88   | `BindingConstraint` regime detector (FR-P6/FR-P7)                | **NOT WIRED** — `grep -rn BindingConstraint src/` shows only the module + its unit tests; no import in `Book.ts` or `main.ts` |

## DOF-sweep snapshot at HEAD (`npm run dof:sweep:quick`)

5600 scenarios, 13 invariants. Excerpt from
`contrib/debug/dof-sweep/summary.json`:

| Invariant            | Violations | Max magnitude   | Threshold |
|----------------------|------------|-----------------|-----------|
| spine_pin_local      | **0**      | —               | 1e-4      |
| spine_pin_world      | **0**      | —               | 1e-3      |
| no_tube              | 0          | —               | 0.15      |
| no_disappear         | 0          | —               | 4         |
| curl_angle           | 0          | —               | π/3       |
| path_smoothness      | 0          | —               | 1         |
| fr_p1                | 1848       | 0.0228          | 0.01      |
| area_conservation    | 1848       | 0.0228          | 0.01      |
| rest_face_uv         | 1232       | 1.0             | 0.5       |
| crease_tilt          | 5536       | ~1.0            | 0.05 (issue #70: threshold too tight) |
| monotonic_phi        | 2800       | 0.110           | 0         |
| settle_symmetry      | 2688       | 5000            | 50 (issue #63 — bend envelope sign asymmetry) |
| settle_sign          | 2016       | 1               | 0         |

**Key reading:** the *numerical* spine-pin invariants are clean. Whatever the user is
seeing is **not** a column-0 vertex sliding in world space. The residual must be
one of:

1. A pin that holds, but the *adjacent* column shears off it (the strip-stretch
   path documented in `SpineStripStretch.regression.test.ts` — area_conservation
   2.3 %, well above the 1 % threshold).
2. A perceived "disconnect" that is actually a regime-II event (BindingConstraint
   never enforced).
3. The anchor-blend pop on gesture start when the grab is near `|wx|/W ≈ 0.3`.
4. A perspective artifact — the differential-diagnostic doc agent owns that
   investigation; this report defers.

## Ranked candidates for the next root cause

### Candidate (a) — `BindingConstraint` regime never enforced (HIGH confidence)

**Evidence.**
* `src/book/BindingConstraint.ts` (PR #88) is a pure detector. No call site in
  `Book.ts` or `main.ts` reads `regimeDetect`. `criticalPhi` / `criticalRadius`
  are unused outside their own unit tests.
* The PRD passage in `docs/prd-page-model.md` ("Bend-binding-tangent constraint")
  explicitly says the renderer must migrate the spine anchor to ±H/2 when the
  bend's lateral reach `R·sin(φ)·|sin θ|` exceeds the remaining anchor-to-corner
  distance. The live shader does **not** do this — it always uses the gesture-
  start `anchorY` produced by `computeGestureAnchorY`, regardless of φ.
* Concrete reproduction: `R = 0.25` (INTERIOR_STOCK.R_min), `θ = π/6`,
  `anchorY = 0.1·H`. `criticalRadius(top) = (0.5 − 0.1·H)/sin(π/6) ≈ 0.4·H/0.5`,
  so over the second half of a forward drag the bend pushes geometrically past
  the top corner *without the anchor migrating*. The flap then either tears
  area (the `area_conservation` 1848 violations) or visually "comes off" the
  spine corner.
* The PRD calls this the "next" model gap. Closed issue #85 ("Bend tangent to
  binding endpoint forces anchor migration") was the trigger for the module;
  PR #88 was the *documentation* sub-step.

**Confidence:** high — this is the only known model gap on the page-turn PRD
that is documented but unimplemented in the renderer path, and it predicts
exactly the failure mode (page detaches from the corner of the spine at large
φ and non-zero θ).

### Candidate (b) — Anchor-blend pop on gesture start (MEDIUM confidence)

**Evidence.**
* `computeGestureAnchorY` uses a smoothstep on `|wx|/W` over `[0, 0.3]`. At
  `|wx|/W = 0.3` the anchor is fully mid-spine; for grabs just inside that band
  the anchor is computed once at pointerdown and frozen.
* Two pointerdowns 1 px apart that straddle `|wx|/W ≈ 0.15` produce different
  anchors, which manifests as a per-gesture "jump" of the spine intersection.
* The anchor is *frozen* for the gesture, so this is a startup-only pop, not a
  drag-time disconnect — explains the user's "always at the start" reports but
  not the "during drag" reports.

**Confidence:** medium — explains a subset of reports (gesture-start pop) but
not steady-state disconnect at large φ.

### Candidate (c) — Smoothstep band lands on wrong side of spine (LOW confidence)

**Evidence.**
* `FLIP_VERT` uses `band = uMaxFlapDist * 0.02` for the flap-classifier
  smoothstep around `s = 0`. `uMaxFlapDist` is computed from the *farthest*
  page corner along `cornerDir` — for steeply tilted creases with a near-spine
  anchor this distance is dominated by the far corner, so 2 % of it can be
  larger than the distance from spine to the nearest mesh column.
* If the band straddles the spine, the smoothstep weight at x = 0 is non-zero
  but the `pos.x <= spineEps` guard then *forces* `flapPos = pos`. The mix at
  the next column is partial, so the spine column is rest, the next column is
  blended halfway — visually the strip slumps off the binding by ~½ cell.
* PR #59 / PR #82 partially addressed this with the explicit binding-Dirichlet
  guard; the comment block at `Book.ts:198-207` acknowledges the residual
  area distortion this causes ("the geometrically inevitable cost of imposing
  a Dirichlet binding on an otherwise developable surface — it models the
  physical bunching/wrinkling of paper at the spine").
* So this is *known and accepted* as an area defect; it would be a surprising
  candidate to re-prosecute now unless paired with a real-paper photograph
  showing the strip slump.

**Confidence:** low — already accounted for in the model comments.

### Candidate (d) — other (camera/perspective artifact)

Owned by the differential-diagnostic doc agent. Not investigated here.

## Recommended next PR scope

Wire `BindingConstraint.regimeDetect` into the live drag path:

1. In `Book.updateTurningDrag` (or wherever the per-frame crease is materialised),
   after computing `(R, anchorY, theta, phi)`, call `regimeDetect`.
2. If `regime !== 'free'`, override the shader uniform `uCreaseOrigin.y` with
   `migrated_anchor_y` (±H/2). For continuity, blend over a short window so
   the migration is C¹ — `tangentMargin` is exposed for exactly this purpose.
3. Add a harness scenario `bend-tangent-corner-migration` that pulls a corner
   pinch through the regime crossing and asserts the spine-anchor migrates to
   the binding endpoint (telemetry: emit a new `regime-transition` event).
4. The dihedral-mapping question (does the cursor's residual DOF rotate around
   the corner now?) is **FR-P7**, separate follow-up.

Diagnosis-only PR; do not implement the fix.

## Reproducible commands

```bash
# Sweep at HEAD (this report's source data):
npm run dof:sweep:quick

# Look at the worst-case fr_p1 violators:
jq -s '
  map(select(.invariant == "fr_p1"))
  | sort_by(-.magnitude)
  | .[0:5]
' contrib/debug/dof-sweep/violations.jsonl

# Verify BindingConstraint is unwired:
grep -rn BindingConstraint src/ | grep -v '\.test\.\|BindingConstraint\.ts'
```

## Cross-references

* Sweep raw data: `contrib/debug/dof-sweep/violations.jsonl`,
  `contrib/debug/dof-sweep/summary.json`, `contrib/debug/dof-sweep/top-violators.md`.
* Regression skeleton: `src/book/SpineDisconnect.regression.test.ts` (marked
  `it.todo` — documents the candidate-(a) gap without flipping CI red).
* Existing failing-mode regression: `src/book/SpineStripStretch.regression.test.ts`.
* PRD: `docs/prd-page-model.md` (FR-P6, FR-P7).
* Pinned shader source at HEAD:
  https://raw.githubusercontent.com/stuffbucket/pageturn-demo/87c9a1116b1756b8c7fa8cf90097a2e9803dea02/src/book/Book.ts
* Pinned BindingConstraint module at HEAD:
  https://raw.githubusercontent.com/stuffbucket/pageturn-demo/87c9a1116b1756b8c7fa8cf90097a2e9803dea02/src/book/BindingConstraint.ts
