# CLAUDE.md

Guidance for Claude Code sessions working in this repo.

This is an interactive 3D book built with Three.js + TypeScript + Vite. Drag-to-turn pages with a tilted-crease curl shader, a physics settle, a procedural texture atlas, and a Big Buck Bunny video spread.

## Quick orientation for a fresh agent

Before debugging anything, read [`docs/inner-loop-feedback.md`](docs/inner-loop-feedback.md) — it codifies the telemetry/HUD/capture loop that makes this codebase tractable. The two active modeling efforts are specified in [`docs/prd-page-model.md`](docs/prd-page-model.md) (developable surface / inextensibility, issue #18) and [`docs/prd-settle-physics.md`](docs/prd-settle-physics.md) (aerodynamic settle, issue #19). Architectural decisions live as Michael-Nygard-style ADRs in [`docs/adr/`](docs/adr/) — currently only ADR-0001 (popup feature disabled). Long-form architecture and shader narratives live in the Starlight docs site under [`docs-site/`](docs-site/), which deploys to https://stuffbucket.github.io/pageturn-demo/ via `.github/workflows/deploy-docs.yml`. CLAUDE.md deliberately stays terse so it fits in context — when a section feels thin, the docs site has the prose.

## Architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| State | `src/book/BookState.ts` | Pure state machine, no Three.js imports |
| Crease math | `src/book/CreaseGeometry.ts` | Pure-math tilted-crease module, no Three.js |
| Page geometry | `src/book/PageGeometry.ts` | Subdivided plane (96×48 segments) |
| Material | `src/book/PageMaterial.ts` | Front/back materials, polygon-offset config |
| Rendering | `src/book/Book.ts` | Mesh lifecycle, inline `FLIP_VERT` shader, animations |
| Scene | `src/main.ts` | Camera, input (2D drag), settle ODE, animation loop |
| Content | `src/textures/atlas.ts` | Procedural canvas textures + fiducial overlay |
| Debug HUD | `src/debug.ts` | Live drag/crease/turn/camera/fps overlay |
| Telemetry | `src/telemetry.ts` | JSONL events POSTed to dev-server sink |
| Capture | `src/long-press-capture.ts` | Long-press PNG + sidecar JSON |

### Page-turn model (current)

Drag is **2D**. The crease line tilts with drag direction (see `CreaseGeometry.ts`, fully unit-tested). The rotation axis origin is **clamped to the spine** with a `tanh` asymptote — see the `pos.x > spineEps` guard in `FLIP_VERT`. Reverse turns invert the polarity of `getTurningProgress`. Cancel is a hard reset (`hardCancelDrag`) — never let a settle decay through stale state.

The vertex shader inlined in `Book.ts` still rides on
```
φ(t) = uDihedral + uBendAmount * t * sin(2.0 * uDihedral)
```
with `uBendAmount = 0.4`, but t is now distance along the *tilted* crease normal. The turning-page `ShaderMaterial` is `DoubleSide` with `polygonOffset` enabled (factor/units = −2) so the curl wins the depth test against the static spread when surfaces are nearly co-planar; issue #31 tracks remaining bleed-through. The **vertex** shader uses a smoothstep across `s = 0` (the tilted-crease boundary) to dissolve houndstooth artifacts at tilted creases — the fragment shader is a plain `gl_FrontFacing` front/back switch.

Two static spread meshes always show the resting state; a third `turningPageMesh` is spawned during animation so abort/cancel logic is atomic. The crease shadow is a separate Gaussian-along-spine mesh that fades with turn progress.

### Physics settle

On drag-end, energy-based ODE in rAF until convergence:
```
v̇ = dir · G − D · v     (G = 5.0, D = 6.5)
termination: ½v² + G·|p − target| < 0.005
```
Aerodynamic replacement is specified in `docs/prd-settle-physics.md` (issue #19, in flight).

### Texture management

`generateBookTextures()` paints 1024×1024 canvases. `TexturePool.retainWindow()` evicts GPU textures for far-away spreads. Video spreads update dual canvas textures every rAF via `drawImage`. Linear filtering, sRGB. `FIDUCIAL_US` / `FIDUCIAL_VS` (in `atlas.ts`) define the 5×7 dot grid baked in when `?fiducials=1` is active.

### Legacy

`src/shaders/page.vert` and `src/shaders/page.frag` are unused — the active shader is the inline `FLIP_VERT` constant in `Book.ts`.

## Inner-loop tools

These are the URL flags and CLI moves an agent reaches for first.

| Knob | Effect |
|------|--------|
| `?debug=1` (or help-menu checkbox) | Live HUD: drag/crease/turn/camera/fps |
| `?fiducials=1` (or help-menu checkbox) | 5×7 dot grid overlaid on every page |
| `?telemetry=1` | POSTs JSONL events to the dev server's `telemetry-sink` plugin |
| `?capture=1` (or help-menu checkbox) | Hold mouse 5s motionless → PNG + sidecar JSON in `contrib/screenshots/` |
| `?session=<urlEscaped>` | Tags capture filenames with a session id |

Telemetry events: `boot`, `fps-sample` (1Hz), `state-transition`, `drag-start`, `pointer-move` (10Hz throttled), `drag-end`, `screenshot-captured`, `error`. Default log path is `/tmp/pageturn-telemetry.jsonl`, override with `PAGETURN_TELEMETRY_LOG`.

```bash
# Tail telemetry while you reproduce a bug
tail -f /tmp/pageturn-telemetry.jsonl | jq .
```

Captures embed the full state JSON via a W3C PNG `eXIf` chunk (Make/Model/Software/DateTime/ImageDescription/UserComment) **and** as a sidecar JSON that adds `git_commit`, `git_branch`, `git_dirty` so a future agent can rewind to the exact tree state. The capture handler re-arms after motion past a 4px tolerance, so you don't get duplicate PNGs of the same state.

## Harness

`harness/` runs Playwright + MediaRecorder (640×360 @ 24 fps VP9 — not CCapture for perf). Scenarios live in `harness/scenarios/`:

```
bleed-through-mid-fold   cancel-mid-drag        corner-peel
drag-out-of-window       flick-and-release      horizontal-pull
long-press-capture       reverse-turn           spine-pin-diagonal
```

Each scenario can declare `assertions[]` of types: `telemetry-event`, `file-exists-glob`, `pixel-min-luma`, `pixel-max-variance`, `trajectory`. Failures exit 2.

Trajectory dataset mode (`runScenarioTrajectories(s)`) replicates the FLIP_VERT math analytically in JS; baselines under `harness/baselines/sin2phi/`.

The Docker harness mounts `../contrib/screenshots:/work/contrib/screenshots`, so harness-driven captures persist on the host.

## Testing

- `npm test` — Vitest. Currently **262 pass + 10 skipped + 0 fail**. The 10 skipped are the popup tests disabled per ADR-0001 — don't be alarmed.
- `npm run test:mutation` — full StrykerJS run. As of 2026-05-14 the mutate set includes `Book.ts` and `PageMaterial.ts` (ADR-0001 unblocked the dry run).
- `npm run test:mutation:if-changed` — gated on test-file diff + green tests; cheap to run in CI/pre-commit.
- Mutation policy: [`docs/mutation-testing-policy.md`](docs/mutation-testing-policy.md). Latest report: [`docs/mutation-test-report-2026-05-14.md`](docs/mutation-test-report-2026-05-14.md). Test audit: [`docs/test-audit-2026-05-12.md`](docs/test-audit-2026-05-12.md).

No linter is configured.

## Common scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server at localhost:5173 |
| `npm run build` | `tsc` then Vite production build |
| `npm run preview` | Preview the production build |
| `npm test` | Vitest (use `-- --run path/to/file.test.ts` for one file) |
| `npm run test:ui` | Vitest UI |
| `npm run test:coverage` | Coverage report |
| `npm run test:mutation` | StrykerJS full run |
| `npm run test:mutation:if-changed` | Run Stryker only if test/source files changed and tests are green |
| `npm run docs:dev` | Starlight dev server |
| `npm run docs:build` | Build the docs site |
| `npm run docs:preview` | Preview the built docs site |

## Conventions for agents

- **Worktrees.** Agents work in `.claude/worktrees/<agent-id>/`. The shared main worktree at `/Users/brian/github/bstucker/pageturn-demo/` is **off-limits** — always operate inside your isolated worktree path.
- **gh CLI** is authenticated as `stuffbucket` for this repo.
- **PR titles** must NOT contain issue or PR numbers. Numbers go in the body via `Closes #N` / `Refs #N`. (See `~/.claude/skills/pr-monitor/SKILL.md`.)
- **Memory** for this project lives at `~/.claude/projects/-Users-brian-github-bstucker-pageturn-demo/memory/`. Notable entries:
  - `agent-worktree-path-anchor.md`
  - `continue-merge-train-without-asking.md`
  - `poll-pr-merges-in-background.md`
  - `third-party-licenses-policy.md`
  - `deferred-harness-scenarios.md`

## Current open work

Live list of issues — verify with `gh issue list --state open` before assuming any are still open.

- **#18** — Inextensibility violation: page stretches as drag advances. Tracked by `docs/prd-page-model.md`.
- **#19** — Aerodynamic settle not implemented. Tracked by `docs/prd-settle-physics.md`.
- **#29** — On release, animation reverts to edge-bend model instead of continuing from current state under the corner-curl model.
- **#31** — Back face of turning page bleeds through the front (cover gradient visible through cover front).

## Pre-existing oddities

- **Popup feature is disabled** by design — see ADR-0001. The 10 skipped tests in `Book.test.ts` (the entire `describe.skip('Book - Fan × Popup', …)` block) are intentional, not failing. `createPopup` carries a `@ts-expect-error` annotation that will self-clean when the popup ships.
- **Big Buck Bunny video is not in the repo.** After a fresh clone, fetch it manually:
  ```bash
  curl -L -o public/videos/big-buck-bunny.mp4 \
    'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4'
  ```
- **`contrib/screenshots/`** is gitignored except for `.gitkeep`. The harness Docker mount lands captures here on the host.
- **Two top-level `package.json` trees**: the root project and `docs-site/`. Don't conflate them.
