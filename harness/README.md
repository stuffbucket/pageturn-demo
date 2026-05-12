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

## Why this isolation?

- No changes to `index.html` or `src/main.ts` — the demo stays runnable as-is.
- No new runtime dependencies in the app bundle.
- Only shared-code change: a one-branch `data-harness` check in `atlas.ts`
  that swaps the video texture for a static placeholder in harness mode.
- The harness can be deleted or rebuilt without touching the demo.
