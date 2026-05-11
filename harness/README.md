# Harness

Headless capture rig for the page-turn demo. Drives `harness.html` (a parallel
entry point that boots the same app under `window.__harness`) via Playwright,
records each scenario to webm with [CCapture.js](https://github.com/spite/ccapture.js),
and writes the output to `harness/output/`.

The main demo app (`index.html`, `src/main.ts`) is **not modified** — the
harness mounts the same module under a separate HTML entry.

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
3. `runScenario` instantiates a `CCapture` and walks a virtual clock at the
   scenario's framerate. At each tick it dispatches due pointer events on
   the canvas, lets the app render, and grabs the frame.
4. CCapture's `.save()` callback hands us a webm blob; we base64-encode it
   and return through `page.evaluate`. The Node runner decodes and writes
   to `harness/output/`.

## Why this isolation?

- No changes to `index.html` or `src/main.ts` — the demo stays runnable as-is.
- No new runtime dependencies in the app bundle. CCapture.js is loaded by
  `harness.html` only, from a CDN.
- The harness can be deleted or rebuilt without touching the demo.
