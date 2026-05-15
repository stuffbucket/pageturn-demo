# DOF coverage report — 2026-05-15

Output of the new exhaustive Degree-of-Freedom sweep diagnostic
([`scripts/dof-sweep.mjs`](../scripts/dof-sweep.mjs), tracked by
[#69](https://github.com/stuffbucket/pageturn-demo/issues/69)).

## Run metadata

- **Scenarios sampled:** 560,000 (full enumeration of 1,120 discrete tuples
  × 500 Latin-hypercube draws over continuous DOFs).
- **Wall time:** 120 s on M-series laptop, single-threaded Node.
- **Substrate:** analytic JS replica of `FLIP_VERT`
  (`src/book/FiducialPositions.ts`) + JS port of the aero settle integrator
  (`src/book/SettlePhysics.ts`). No Three.js, no GPU.
- **Quick variant** (`npm run dof:sweep:quick`): 5,600 scenarios in ~1.3 s,
  cheap enough for pre-commit.

Outputs land in `contrib/debug/dof-sweep/`:

| File | Purpose |
|---|---|
| `violations.jsonl` | One JSON record per scenario with at least one invariant out of spec. |
| `top-violators.md` | Per-invariant top-10 ranking with a one-line repro recipe. |
| `summary.json` | Run metadata + violation counts + top-10 DOF tuples. |
| `heatmap-<invariant>.html` | 5×7 fiducial grid × 16 theta bins, max violation per cell, one HTML per invariant. |

Repro recipe format: `?<flags> | spread=<N> {fwd|rev} grab page{R|L} fid (i,j) at u=<U>,v=<V> drag (<dx>W,<dy>W) <velocity> {commit|cancel}`. Open the dev server with the URL flags, navigate to the spread, and reproduce the gesture.

## Violation rate per invariant

| Invariant | Threshold | Violations | Rate | Cluster issue |
|---|---|---|---|---|
| `fr_p1` (inextensibility, max chord/rest − 1) | 0.01 | 207,592 | 37.07% | [#18](https://github.com/stuffbucket/pageturn-demo/issues/18), [#50](https://github.com/stuffbucket/pageturn-demo/issues/50), [#64](https://github.com/stuffbucket/pageturn-demo/issues/64) |
| `no_tube` (1 − row chord/rest) | 0.15 | 0 | 0.00% | — |
| `no_disappear` (max ‖world‖/W) | 4.0 | 0 | 0.00% | — |
| `curl_angle` (max θ in developable curl) | π/3 | 0 | 0.00% | clamp working ([#53](https://github.com/stuffbucket/pageturn-demo/issues/53), [#57](https://github.com/stuffbucket/pageturn-demo/issues/57)) |
| `spine_pin_local` | 1e-4 | 0 | 0.00% | — |
| `spine_pin_world` | 1e-3 | 0 | 0.00% | analytic model holds; live shader still flags via [#68](https://github.com/stuffbucket/pageturn-demo/issues/68) |
| `crease_tilt` (\|creaseDir.x\|) | 0.05 | 557,216 | 99.50% | **surprise**, see below |
| `monotonic_phi` (max neg dφ/dt × dir) | 0 | 280,000 | 50.00% | **partly artifact**, see below |
| `path_smoothness` | 1.0 | 38,752 | 6.92% | **surprise**, see below |
| `settle_symmetry` (\|dur_fwd − dur_rev\| ms) | 50 | 271,572 | 48.49% | [#51](https://github.com/stuffbucket/pageturn-demo/issues/51), [#63](https://github.com/stuffbucket/pageturn-demo/issues/63) |
| `settle_sign` (bend-envelope sign mismatch fraction) | 0 | 242,816 | 43.36% | [#63](https://github.com/stuffbucket/pageturn-demo/issues/63) |
| `area_conservation` (\|area/rest − 1\|) | 0.01 | 207,592 | 37.07% | [#18](https://github.com/stuffbucket/pageturn-demo/issues/18), [#50](https://github.com/stuffbucket/pageturn-demo/issues/50) |
| `rest_face_uv` (UV-flip fraction during dihedral ∈ [0, π/2]) | 0.5 | 155,176 | 27.71% | [#54](https://github.com/stuffbucket/pageturn-demo/issues/54), [#65](https://github.com/stuffbucket/pageturn-demo/issues/65) |

## Where each invariant breaks

For every invariant the corresponding `heatmap-<invariant>.html` shows max
violation per (page side, fiducial i, fiducial j, theta bin), aggregated
across the other DOFs. Patches in the heat map mark the surface in DOF space
that breaks the invariant.

### Known clusters (cross-references)

- **`fr_p1` + `area_conservation`** — both peak in the `sin2phi` flag combo
  with diagonal pulls from low-`v` fiducials. The two metrics co-violate
  100% of the time (the chord-length integral that drives `area_conservation`
  is a weighted sum of the same row chord ratios `fr_p1` reads). Maps to the
  long-standing FR-P1 violation tracked by **#18 / #50 / #64**.
- **`settle_symmetry` + `settle_sign`** — concentrated on the `aero` settle
  flag. The bend envelope `b` retains its sign across `sin(2φ)` regardless
  of release direction, which is exactly the asymmetry called out in **#63**.
- **`rest_face_uv`** — fires on `sin2phi` flag and during mid-fold (φ near
  π/4..π/3). The cross-product test approximates the Front/Back issue tracked
  by **#54** (and the polygon-offset bleed in **#65**).
- **`curl_angle`** clamp holds across all 560k scenarios — confirms the
  `MAX_CURL_ANGLE = π/3` clamp added with the developable surface stays
  honored (covers **#53** / **#57**).

### Surprises (no existing issue)

- **`crease_tilt` (99.5% violation rate).** `|creaseDir.x| ≤ 0.05` was set
  optimistically. In the bound-book model `creaseDir = (-dy, dx)/|·|`
  normalized — i.e. `creaseDir.x` is essentially `−sin(drag-angle)`, which
  exceeds 0.05 for any drag with vertical component above ~3°. The user-
  facing concern in **#68** is that the rotation axis tilts off the spine,
  not that `creaseDir.x` is large per se: spine-pinning constrains
  `originOnEdge.x = 0` regardless of `creaseDir`, and the analytic model
  confirms `spine_pin_world ≤ 1e-3` for every scenario (0 violations). So
  the threshold here is too tight and the per-cell story doesn't actually
  point at a bug. **Filed as #70** to retune the threshold or replace the
  invariant with the off-spine drift it was intended to proxy.
- **`monotonic_phi` (50%).** The bound-book dihedral mapping is
  `π · max(0, min(1, (corner.x − drag.x)/W))`. For `decel` and `pause`
  velocity profiles where the gesture slows mid-stroke, the per-frame `φ`
  delta dips toward zero but stays non-negative — yet the threshold is
  exactly 0, so any rounding-noise dip flags. The 50% rate is dominated by
  the cancel branch (where `dir`-signed slope is by-construction negative
  during release). The *real* violations to fix would be `max(neg slope) >
  ε` for some practical ε — current top entries hit 0.32 rad/frame which
  is well past noise and worth investigating. **Filed as #71** to split the
  metric into "monotonic during gesture" + "monotonic during settle".
- **`path_smoothness` (6.92%).** Concentrated entirely on `pause` velocity
  profile + extreme-`r` (1.5W) drags. The page center jumps a noticeable
  fraction of W between adjacent frames at the pause-release transition —
  small enough to slip past visual review but the harness should be able
  to confirm whether the live demo exhibits the same step. **Filed as
  #72** to add a `pause-and-release` harness scenario and confirm.

## CI hook

```
npm run dof:sweep         # full 560k-sample run, ~2 min
npm run dof:sweep:quick   # 5.6k-sample downsample, ~1.3 s; safe for pre-commit
```

The quick sweep produces the same files (truncated lists, per-cell maxima
that may underestimate the worst case) and is intended as the
"is-the-violation-distribution-shifting" smoke signal a PR can run before
opening.

## Followups

The diagnostic itself does not fix any of the violations. New issues filed
for the surprise findings are **#70 (crease_tilt threshold)**, **#71
(monotonic_phi split)**, **#72 (path_smoothness pause-release)**.
