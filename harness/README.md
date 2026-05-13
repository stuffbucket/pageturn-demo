# Harness

Headless capture rig for the page-turn demo. Drives `harness.html` (a parallel
entry point that boots the same app under `window.__harness`) via Playwright,
records each scenario to webm via `MediaRecorder` on `canvas.captureStream()`,
and writes the output to `harness/output/`.

The main demo app (`index.html`, `src/main.ts`) is **not modified** — the
harness mounts the same module under a separate HTML entry. The only change
to shared code is a check in `atlas.ts` for `<body data-harness="1">`: when
set, the BBB video texture is replaced with a static placeholder so the
harness doesn't depend on a remote CDN.

## Quick start (Docker — recommended)

```bash
docker compose -f harness/docker-compose.yml up --build --abort-on-container-exit
```

Captured videos appear in `harness/output/<scenario-name>.webm`.

The compose file mounts three host paths into the container:

| Host path | Container path | Purpose |
|---|---|---|
| `harness/output/` | `/work/harness/output` | Recorded webm captures land here. |
| `harness/scenarios/` | `/work/harness/scenarios` (ro) | Edit scenario JSON without rebuilding. |
| `contrib/screenshots/` | `/work/contrib/screenshots` | Long-press screenshot captures from the Vite `screenshot-server` plugin. |

Long-press captures from the prototype running inside the harness will appear
on the host at `contrib/screenshots/` (gitignored). Use this for
harness-driven validation runs — without the mount, files written by the
in-container POST `/__screenshot` handler would disappear when the container
exits.

The base image is `mcr.microsoft.com/playwright:v1.49.0-jammy`. Docker's layer
cache shares it with every other project on the host that uses the same tag,
so the multi-gigabyte Playwright browser download happens at most once.

## Quick start (host — for iterating)

```bash
# Terminal 1: dev server
npm run dev

# Terminal 2: harness
cd harness && npm install
npm run run            # default: runs all scenarios
npm run run -- horizontal-pull   # one named scenario
```

## Adding a scenario

Drop a JSON file in `harness/scenarios/`:

```json
{
  "name": "my-scenario",
  "viewport": { "width": 1280, "height": 720 },
  "duration": 1500,
  "fps": 60,
  "events": [
    { "t": 0,   "type": "pointerdown", "x": 0.9, "y": 0.5 },
    { "t": 600, "type": "pointermove", "x": 0.2, "y": 0.5 },
    { "t": 700, "type": "pointerup",   "x": 0.2, "y": 0.5 }
  ]
}
```

`x` / `y` are fractions of viewport — robust to viewport changes.

### Scenario step types

| `type` | Fields | Description |
|---|---|---|
| `pointerdown` / `pointermove` / `pointerup` | `t, x, y` | Synthesized PointerEvent dispatched on the canvas. Pointer moves are densified to ~120 Hz. |
| `raw-event` | `t, event` | Dispatch an arbitrary `Event` by name on the canvas. Used to simulate browser-initiated events that no real gesture can produce, e.g. `lostpointercapture`, `pointercancel`. The handler in main.ts ignores event payloads, so a bare Event suffices. |

### Optional scenario fields

| Field | Default | Effect |
|---|---|---|
| `url` | `$HARNESS_URL` | Override the page URL (use this to set `?capture=1`, `?telemetry=1`, etc.). |
| `trajectories` | `false` | Force trajectory mode even without `--trajectories`. Required by `trajectory` assertions. |
| `assertions` | none | Run regression assertions; see below. |

### Assertions (regression-test mode)

When a scenario carries an `assertions` array, the runner switches to
**assertion mode**: it captures whichever artifacts each assertion needs
(telemetry events, trajectory data, canvas screenshots), evaluates each
assertion, prints pass/fail per scenario, and exits with code `2` if any
fail. Use this for regression coverage of fixed bugs.

Available assertion types (full schema in `harness/src/ccapture.d.ts`):

| `type` | Purpose |
|---|---|
| `telemetry-event` | Match a captured `emit(...)` event by name + payload subset, optionally constrained to `withinMsAfterT` of an `afterEventAtT` anchor. Requires the page URL to include `?telemetry=1`. |
| `file-exists-glob` | Assert that at least one file matching a single-`*` glob (relative to repo root) exists. Optional `extensions` whitelist (e.g. `[".png", ".jpg"]`) makes assertions robust to format-rename refactors. Optional `sidecarSessionId` requires a matching `<file>.json` sidecar with that sessionId. |
| `pixel-min-luma` | Take a canvas screenshot at scenario time `atT`, sample a rectangular region in viewport-fraction coords, assert mean Rec.601 luma ≥ threshold. Use to assert "page should be visible here." |
| `pixel-max-variance` | Same screenshot + region, assert mean adjacent-pixel luma delta ≤ threshold. Catches z-fighting / bleed-through stripes. |
| `trajectory` | After a trajectory-mode replay, assert a fiducial position (`P_<i>_<j>`) along an axis (`x`/`y`/`z`) satisfies a min/max bound, optionally pinned to the sample closest to `atTApprox`. Note: trajectories use the JS reimplementation of FLIP_VERT, not the GPU shader, so they do not catch GPU-only regressions — pair with a `pixel-*` assertion when the bug lives in GLSL. |

Telemetry capture works by patching `navigator.sendBeacon` and `fetch`
in `bootstrap.ts` *before* `src/main.ts` is imported; the captured
event stream is exposed to the runner via `window.__harness.drainTelemetry()`.

### Regression scenarios shipped with this repo

| Scenario | What it covers |
|---|---|
| `spine-pin-diagonal` | PR #10 — corner-peel diagonal drag; trajectory + spine-area luma. |
| `bleed-through-mid-fold` | PR #12 — mid-fold pixel-variance check on the turning page. |
| `drag-out-of-window` | PR #13 — `lostpointercapture` mid-drag → `drag-end{canceled, reason}` telemetry within 100ms. |
| `long-press-capture` | PRs #14/#15 — 5.5s hold with `?capture=1&session=harness` produces a `screenshot-captured` event AND a file under `contrib/screenshots/`. |

Run a single regression scenario locally:

```bash
docker compose -p audit-harness -f harness/docker-compose.yml \
  run --rm harness sh -c 'cd harness && npx tsx runner/run.ts spine-pin-diagonal'
```

## How it works

1. Playwright opens `harness.html` against a running Vite dev server.
2. The page-side bootstrap (`harness/src/bootstrap.ts`) imports `src/main.ts`
   (same app the demo serves) and exposes `window.__harness.runScenario`.
3. `runScenario` starts a `MediaRecorder` on `canvas.captureStream(fps)`,
   dispatches the scenario's pointer events at their real-time offsets,
   waits for the scenario duration, then stops the recorder.
4. The resulting webm blob is base64-encoded and returned through
   `page.evaluate`. The Node runner decodes and writes to `harness/output/`.

Why MediaRecorder and not frame-by-frame capture (e.g., CCapture.js)?
Headless Chromium in Docker doesn't have GPU passthrough, so WebGL falls
back to software (SwiftShader). Per-frame `ReadPixels` in that environment
is pathologically slow (hundreds of ms per frame). `MediaRecorder` taps
the canvas's underlying surface and avoids the readback entirely. The
tradeoff: events are dispatched in wall-clock time, so capture isn't
frame-perfect. When frame-perfect determinism is needed, swap the
implementation inside `runScenarioInner` — the public API doesn't change.

## Troubleshooting

### Host `contrib/screenshots/` is empty after a harness run

If the harness ran successfully (you saw `✓ file-exists-glob: ...` for
`long-press-capture` or any other scenario that emits a screenshot) but
nothing appears on the host at `contrib/screenshots/`, the most likely
cause is a **stale container image** that predates the volume mount added
in PR #34. Compose only honors the `volumes:` block at container-create
time, and the mount line was missing from older `docker-compose.yml`
revisions baked into cached images.

Rebuild the image, then re-run:

```bash
docker compose -p <project-name> -f harness/docker-compose.yml build
docker compose -p <project-name> -f harness/docker-compose.yml up --abort-on-container-exit
```

To sanity-check the mount itself without re-running scenarios:

```bash
docker compose -p volume-diag -f harness/docker-compose.yml run --rm harness \
  sh -c "touch /work/contrib/screenshots/mount-check.txt"
ls contrib/screenshots/mount-check.txt   # should exist on host
```

If `mount-check.txt` does not appear on the host, the bind mount itself
is misconfigured — check `docker compose -f harness/docker-compose.yml config`
to see the resolved absolute source path Compose is using.

## Why this isolation?

- No changes to `index.html` or `src/main.ts` — the demo stays runnable as-is.
- No new runtime dependencies in the app bundle.
- Only shared-code change: a one-branch `data-harness` check in `atlas.ts`
  that swaps the video texture for a static placeholder in harness mode.
- The harness can be deleted or rebuilt without touching the demo.

## Troubleshooting

### Host `contrib/screenshots/` is empty after a harness run

If the harness ran successfully (you saw a `file-exists-glob` assertion pass
for `long-press-capture` or another scenario that emits a screenshot) but
nothing appears on the host at `contrib/screenshots/`, the most likely
cause is a **stale container image** that predates the volume mount added
in PR #34. Compose only honors the `volumes:` block at container-create
time, and the mount line was missing from older `docker-compose.yml`
revisions baked into cached images.

Rebuild the image, then re-run:

```bash
docker compose -p <project-name> -f harness/docker-compose.yml build
docker compose -p <project-name> -f harness/docker-compose.yml up --abort-on-container-exit
```

To sanity-check the mount itself without re-running scenarios:

```bash
docker compose -p volume-diag -f harness/docker-compose.yml run --rm harness \
  sh -c "touch /work/contrib/screenshots/mount-check.txt"
ls contrib/screenshots/mount-check.txt   # should exist on host
```

If `mount-check.txt` does not appear on the host, the bind mount itself
is misconfigured — check `docker compose -f harness/docker-compose.yml config`
to see the resolved absolute source path Compose is using.
