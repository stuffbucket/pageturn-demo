# Trajectory diff: developable vs sin2phi page model

_Generated 2026-05-14 from a fresh harness re-capture of `harness/baselines/developable/` with `?dev-surface=1` (PRD #11, landed via PR #40), diffed pairwise against the legacy `harness/baselines/sin2phi/` reference. Refs PRD #11 ([`docs/prd-page-model.md`](prd-page-model.md)). Closes #16._

## Methodology

- 5 scenarios: `cancel-mid-drag`, `corner-peel`, `flick-and-release`, `horizontal-pull`, `reverse-turn` (the same set covered by `harness/baselines/sin2phi/`).
- The harness ran each scenario twice — once under the legacy sin2phi shader (pinned baseline) and once under `?dev-surface=1`. Both runs use the analytical `fiducialWorldPosition` predictor in `harness/src/bootstrap.ts` so the trajectory dataset is a faithful witness of the shader math (PR #40 §"Phase D").
- **Trajectory delta** `Δ = ‖p_developable(t) − p_sin2phi(t)‖` is reported in world units (page width = 1.0, page height = 1.4). The developable trajectory is resampled at the sin2phi baseline's frame timestamps via linear interpolation in `(x,y,z)`.
- **FR-P1 invariant** on the developable set: for every adjacent fiducial pair (58 pairs/frame across the 5×7 grid), `ratio = chord_3d / restPageDistance`. Computed frame-by-frame on the dev capture's own sample times (no interpolation) so each ratio uses positions that lie exactly on the developable manifold. PRD §FR-P1 requires `ratio ≤ 1.01`; undershoot (< 1) is chord-vs-arc geometry on the curl cylinder, not material strain.

## FR-P1 invariant on the developable baseline

| Scenario | pair-frames | min ratio | **max ratio (≤ 1.01)** | mean |
|---|---:|---:|---:|---:|
| `cancel-mid-drag` | 2552 | 0.9735 | **1.0000** ✅ | 0.9872 |
| `corner-peel` | 1450 | 0.9735 | **1.0000** ✅ | 0.9872 |
| `flick-and-release` | 1566 | 0.9735 | **1.0000** ✅ | 0.9872 |
| `horizontal-pull` | 9570 | 0.9735 | **1.0000** ✅ | 0.9872 |
| `reverse-turn` | 3074 | 0.9735 | **1.0000** ✅ | 0.9872 |

**Global**: min=0.9735, max=1.0000, mean=0.9872 across 18212 pair-frame samples. **FR-P1 passes**: max stretch ratio is 1.0000 across all five scenarios (≤ 1.01, with ~6 orders of magnitude of margin). The fiducial grid (`u∈{0.1,…,0.9}`, `v∈{0.08,…,0.92}`) places no adjacent pair within the 1%-of-page-width crease exemption strip, so every pair is non-crease-straddling and the unconditional bound applies.

The 2.65% chord-undershoot floor (min ≈ 0.9735) is the elementary geometry of a chord on the `R_min=0.25` interior-stock cylinder; it reproduces PR #40's reported figure to 4 decimal places, confirming the capture is functionally identical to the PR-#40 landing run.

## Per-scenario trajectory delta vs sin2phi

| Scenario | frames | mean Δ (world) | max Δ (world) |
|---|---:|---:|---:|
| `cancel-mid-drag` | 44 | 0.4881 | 1.2222 |
| `corner-peel` | 24 | 0.4969 | 1.2216 |
| `flick-and-release` | 27 | 0.5017 | 1.2251 |
| `horizontal-pull` | 132 | 0.6071 | 1.3867 |
| `reverse-turn` | 44 | 0.6111 | 1.3870 |

Δ is the per-frame 3D distance between the two models' predicted fiducial positions. Magnitudes range from a fraction of a page width (single-turn scenarios) up to >1 page width on `horizontal-pull` / `reverse-turn` (six consecutive turns each, where phase drift between the two animation paths compounds across the scenario).

**This is informational, not a pass/fail signal.** PRD #11's "Visual regression" item explicitly accepts that trajectories will diverge — the developable model swaps sin2phi's per-vertex shear for a constant-curvature cylinder, so non-zero Δ is the expected outcome of the model swap. Any future agent regressing against this set should diff against the developable baseline only.

## Top 5 fiducials by max trajectory delta (per scenario)

### `cancel-mid-drag`

| Fiducial | mean Δ | max Δ |
|---|---:|---:|
| `P_4_0` | 1.0861 | 1.2222 |
| `P_4_2` | 1.0861 | 1.2222 |
| `P_4_1` | 1.0861 | 1.2222 |
| `P_4_3` | 1.0861 | 1.2222 |
| `P_4_4` | 1.0861 | 1.2222 |

### `corner-peel`

| Fiducial | mean Δ | max Δ |
|---|---:|---:|
| `P_4_1` | 1.0982 | 1.2216 |
| `P_4_3` | 1.0982 | 1.2216 |
| `P_4_4` | 1.0982 | 1.2216 |
| `P_4_5` | 1.0982 | 1.2216 |
| `P_4_6` | 1.0982 | 1.2216 |

### `flick-and-release`

| Fiducial | mean Δ | max Δ |
|---|---:|---:|
| `P_4_0` | 1.1092 | 1.2251 |
| `P_4_1` | 1.1092 | 1.2251 |
| `P_4_2` | 1.1092 | 1.2251 |
| `P_4_3` | 1.1092 | 1.2251 |
| `P_4_4` | 1.1092 | 1.2251 |

### `horizontal-pull`

| Fiducial | mean Δ | max Δ |
|---|---:|---:|
| `P_4_0` | 1.2101 | 1.3867 |
| `P_4_1` | 1.2101 | 1.3867 |
| `P_4_2` | 1.2101 | 1.3867 |
| `P_4_3` | 1.2101 | 1.3867 |
| `P_4_4` | 1.2101 | 1.3867 |

### `reverse-turn`

| Fiducial | mean Δ | max Δ |
|---|---:|---:|
| `P_4_0` | 1.2164 | 1.3870 |
| `P_4_1` | 1.2164 | 1.3870 |
| `P_4_2` | 1.2164 | 1.3870 |
| `P_4_3` | 1.2164 | 1.3870 |
| `P_4_4` | 1.2164 | 1.3870 |

## Reproducing

```bash
# From the repo root, with Docker running:
docker build -t pageturn-harness:dev -f harness/Dockerfile .
docker run --rm \
  -v "$(pwd)/harness/output:/work/harness/output" \
  -v "$(pwd)/harness/scenarios:/work/harness/scenarios:ro" \
  --entrypoint sh pageturn-harness:dev -c '
    cd /work; npx vite --host 0.0.0.0 --port 5173 >/tmp/v.log 2>&1 &
    for i in $(seq 1 60); do curl -fsS http://localhost:5173/harness.html >/dev/null 2>&1 && break; sleep 0.5; done
    cd harness && HARNESS_URL="http://localhost:5173/harness.html?dev-surface=1" \
      npx tsx runner/run.ts --trajectories \
      cancel-mid-drag corner-peel flick-and-release horizontal-pull reverse-turn
  '
# Then copy harness/output/trajectories/*.json into harness/baselines/developable/.
```

## See also

- [`docs/developable-vs-sin2phi-2026-05-12.md`](developable-vs-sin2phi-2026-05-12.md) — the PR #40 landing report (adjacent-pair stretch ratios in tabular form).
- [`docs/prd-page-model.md`](prd-page-model.md) — PRD #11, including FR-P1 / FR-P3 specification.
- [`harness/baselines/README.md`](../harness/baselines/README.md) — baseline layout and reproduction workflow.
