# Trajectory baselines

This directory holds canonical "before" trajectory datasets captured from the
headless harness. Each subdirectory pins the trajectories produced by a
specific page-curl model so that future model changes can be diffed against
a reproducible reference.

## Layout

```
baselines/
  <model-name>/
    <scenario>.json     # one per harness/scenarios/*.json
```

Each JSON has the shape:

```jsonc
{
  "scenario": "horizontal-pull",
  "viewport": { "width": 640, "height": 360 },
  "fiducials": {
    "P_0_0": [{ "t": 0, "x": ..., "y": ... }, ...],
    "P_0_1": [...],
    ...
    "P_4_6": [...]
  }
}
```

35 fiducials per scenario, arranged as a 5x7 grid (`P_<row>_<col>` with
`row ∈ [0,4]` and `col ∈ [0,6]`). The grid u/v positions are defined as
constants in `src/textures/atlas.ts`. Sample timestamps `t` are in
milliseconds from scenario start; `x`/`y` are screen-space pixel coordinates
in the captured viewport. Sampling occurs each frame the page is actively
rendering, so the sample count per scenario is roughly bounded by
`duration_ms * fps / 1000` (it can be lower when nothing is animating).

## Reproducing

```bash
docker compose -p baselines -f harness/docker-compose.yml run --rm harness sh -c '
  npx vite --host 0.0.0.0 --port 5173 >/tmp/vite.log 2>&1 &
  for i in $(seq 1 60); do
    curl -fsS http://localhost:5173/harness.html >/dev/null 2>&1 && break
    sleep 0.5
  done
  cd harness && npx tsx runner/run.ts --trajectories --all
'
```

Outputs land in `harness/output/trajectories/` (gitignored). Copy them into
the appropriate `baselines/<model-name>/` directory to update the reference.

## `sin2phi/` — current production model

Captured from the inline `FLIP_VERT` shader in `src/book/Book.ts`:

```glsl
φ(t) = uAngle + uBendAmount * t * sin(2.0 * uAngle)
```

with `uBendAmount = 0.4`. `t ∈ [0, 1]` is normalized distance from the spine,
giving a single gravity-driven free-edge lag along a horizontal hinge. The
crease axis is the spine — there is no tilt in this model.

Source SHA: produced from a working tree at parent commit
`69f5188a14c335f81effb48e0d7a264db504bdec` (the merge of #3
`feature/fiducials` into `main`). The commit that introduces these JSON files
is, by chicken-and-egg, the immediate child of that parent on the
`feature/baseline-trajectories` branch. The capturing source code is
identical to the parent — only the captured artifacts are added.

Per-scenario sample counts (35 fiducials each):

| Scenario           | Duration | FPS | Samples per fiducial |
|--------------------|---------:|----:|---------------------:|
| cancel-mid-drag    |  2000 ms |  24 |                   44 |
| corner-peel        |  1500 ms |  24 |                   24 |
| flick-and-release  |  2000 ms |  24 |                   27 |
| horizontal-pull    | 10000 ms |  24 |                  132 |
| reverse-turn       |  5000 ms |  24 |                   44 |
