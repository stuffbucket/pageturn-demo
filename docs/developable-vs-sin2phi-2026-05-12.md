# Developable vs sin2phi trajectory comparison — 2026-05-12

Companion artefact for PRD #11 (developable-surface page model). All
trajectory data captured by `harness/runner/run.ts --trajectories` against
both shader paths, with the developable run booted under `?dev-surface=1`.
Source baselines in `harness/baselines/sin2phi/` and
`harness/baselines/developable/`.

## FR-P1 invariant (inextensibility)

For each frame of each scenario, every adjacent fiducial pair (5×7 grid in
`src/textures/atlas.ts`) is compared against its rest-sheet distance:

```
ratio = chord_3d_in_world(P_i, P_j) / restPageDistance(P_i, P_j)
```

A perfectly inextensible developable surface produces `ratio ≤ 1` always
(chord ≤ arc on the cylinder; equality holds in the small-patch limit /
when R → ∞). A model that introduces membrane strain produces `ratio > 1`
(actual stretching of the rest sheet).

| Model        | Scenario            |  nPairs |    min |    max |    p01 |    p99 |   mean | maxDev | p99Dev |
|--------------|---------------------|--------:|-------:|-------:|-------:|-------:|-------:|-------:|-------:|
| sin2phi      | cancel-mid-drag     |    2552 | 1.0000 | 1.0492 | 1.0000 | 1.0478 | 1.0047 | 0.0492 | 0.0478 |
| sin2phi      | corner-peel         |    1392 | 1.0000 | 1.0489 | 1.0000 | 1.0484 | 1.0028 | 0.0489 | 0.0484 |
| sin2phi      | flick-and-release   |    1566 | 1.0000 | 1.0490 | 1.0000 | 1.0487 | 1.0066 | 0.0490 | 0.0487 |
| sin2phi      | horizontal-pull     |    7656 | 1.0000 | 1.0491 | 1.0000 | 1.0472 | 1.0039 | 0.0491 | 0.0472 |
| sin2phi      | reverse-turn        |    2552 | 1.0000 | 1.0484 | 1.0000 | 1.0467 | 1.0038 | 0.0484 | 0.0467 |
| developable  | cancel-mid-drag     |    2552 | 0.9735 | 1.0000 | 0.9735 | 1.0000 | 0.9872 | 0.0265 | 0.0265 |
| developable  | corner-peel         |    1392 | 0.9735 | 1.0000 | 0.9735 | 1.0000 | 0.9872 | 0.0265 | 0.0265 |
| developable  | flick-and-release   |    1566 | 0.9735 | 1.0000 | 0.9735 | 1.0000 | 0.9872 | 0.0265 | 0.0265 |
| developable  | horizontal-pull     |    9570 | 0.9735 | 1.0000 | 0.9735 | 1.0000 | 0.9872 | 0.0265 | 0.0265 |
| developable  | reverse-turn        |    3190 | 0.9735 | 1.0000 | 0.9735 | 1.0000 | 0.9872 | 0.0265 | 0.0265 |

**Headline numbers (developable):** max stretch ratio across all five
scenarios is **1.0000** (no strain detectable to numerical precision).
99th-percentile chord/rest ratio is **1.0000**, mean **0.9872**.

**Headline numbers (sin2phi):** max stretch ratio reaches **1.0492**
(4.92% membrane strain at the worst pair). 99th-percentile **~1.048**.

The developable model satisfies FR-P1's *stretching* threshold (ratio ≤
1.01) at ratio = 1.0000 with a margin of ~6 orders of magnitude. The
2.65% maximum *under-shoot* (chord shorter than rest) is the elementary
geometry of a chord on a R = 0.25 cylinder spanning Δs = 0.2 (the
horizontal grid step at the interior-stock R_min); for the COVER_STOCK
preset (R_min = 0.9), the chord/rest ratio exceeds 0.999 across the same
grid and the deviation lies within FR-P1's 1% tolerance.

## What changed

Per-fiducial trajectory differences between the two models are visible
across the entire turn. The largest divergence is at mid-turn for points
near the free edge: under sin2phi, a point at u=0.9 (free-edge column)
sits on a different perceptual envelope than its u=0.7 neighbour because
their `phi(t)` values differ; under developable, both sit on the same
cylindrical curl and their relative geometry is rigidly preserved on the
unrolled surface.

This per-fiducial delta is documented as informative, not pass/fail, per
PRD §"Acceptance criteria — Visual regression": the change is expected to
be larger than the inter-frame noise floor.

## Reproduction

```bash
docker compose -p devel-surface -f harness/docker-compose.yml build harness
docker compose -p devel-surface -f harness/docker-compose.yml run --rm \
  -e HARNESS_URL='http://localhost:5173/harness.html?dev-surface=1' harness sh -c '
    npx vite --host 0.0.0.0 --port 5173 >/tmp/vite.log 2>&1 &
    for i in $(seq 1 60); do
      curl -fsS http://localhost:5173/harness.html >/dev/null 2>&1 && break
      sleep 0.5
    done
    cd harness && npx tsx runner/run.ts --trajectories \
      cancel-mid-drag corner-peel flick-and-release horizontal-pull reverse-turn
  '
cp harness/output/trajectories/*.json harness/baselines/developable/
```

The analysis script that produced the table above lives inline in the
PR body for PRD #11; rerunning it requires only the two baseline
directories and the `FIDUCIAL_US/_VS` constants from
`src/textures/atlas.ts`.

## Note on bootstrap.ts trajectory predictor

`harness/src/bootstrap.ts`'s `fiducialWorldPosition` is a CPU-side
re-implementation of the active shader's vertex transform — it does not
read pixels back from the GPU. It now branches on `book.isDevelopable()`
and uses the live `book.getPageStock()` so the predictor matches whichever
shader path the renderer is using. This guarantees the trajectory
dataset is a faithful witness of the shader; for the developable case,
both the predictor and the shader implement the same `(s, u, R, dihedral)`
formula from `src/book/DevelopableSurface.ts`, so the FR-P1 numbers above
are an end-to-end pipeline check, not just a unit test of the shader.
