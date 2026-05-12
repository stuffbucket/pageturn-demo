# Page Turn Demo

An interactive 3D book built with Three.js, TypeScript, and Vite. Drag-to-turn pages with a gravity-based curl shader and physics settle, plus a Big Buck Bunny video spread.

## Quickstart

```bash
git clone https://github.com/stuffbucket/pageturn-demo.git
cd pageturn-demo

# Fetch the Big Buck Bunny video used by the video spread (~150 MB).
curl -L -o public/videos/big-buck-bunny.mp4 \
  'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4'

npm install
npm run dev
```

Then open one of:

- <http://localhost:5173/> — default demo
- <http://localhost:5173/?debug=1&fiducials=1&capture=1&telemetry=1> — full inner-loop debug build (overlays, fiducial markers, frame capture, telemetry)

**Controls:** click-drag a page to turn, arrow keys, or the prev/next buttons. Right-drag to orbit, scroll to zoom.

## Useful URL flags

| Flag | Effect |
|------|--------|
| `?debug=1` | Enables on-screen debug overlay (state, FPS, page index) |
| `?fiducials=1` | Renders registration markers used by the headless capture rig |
| `?capture=1` | Streams per-frame canvas snapshots to the harness |
| `?telemetry=1` | Emits structured telemetry events to the harness/console |
| `?session=<id>` | Tags telemetry/capture output with a session id |

Flags compose, e.g. `?debug=1&telemetry=1`.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server at <http://localhost:5173> |
| `npm run build` | Type-check then production build |
| `npm test` | Run the Vitest suite |
| `npm run test:mutation:if-changed` | Run Stryker mutation testing on changed files only |
| `npm run test:coverage` | Generate Vitest coverage report |

## Where to find more

- **Docs site** — architecture, PRDs, page-motion math, settle physics, debugging guides: <https://stuffbucket.github.io/pageturn-demo/>
- **`CLAUDE.md`** — guidance for Claude Code / agents working in this repo
- **`harness/README.md`** — the headless Playwright + CCapture.js capture rig
- **`docs/inner-loop-feedback.md`** — agent-driven debugging workflow

## License

ISC. Third-party licenses tracked in `THIRD-PARTY-LICENSES.md`.
