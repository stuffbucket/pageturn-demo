# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Type-check then Vite production build
npm test             # Run all tests with Vitest
npm test -- --run src/book/BookState.test.ts   # Run a single test file
npm run test:coverage  # Generate coverage report
```

No linter is configured (no ESLint/Prettier).

## Architecture

This is an interactive 3D book built with Three.js that simulates realistic page turns with physics-based curl and settlement.

### Separation of concerns

| Layer | File | Responsibility |
|-------|------|----------------|
| State | `src/book/BookState.ts` | Pure state machine — no Three.js imports |
| Rendering | `src/book/Book.ts` | Mesh lifecycle, shaders, animations |
| Scene | `src/main.ts` | Camera, input, physics settle, animation loop |
| Content | `src/textures/atlas.ts` | Procedural canvas texture generation |

### BookState — the state machine

`j` is the discrete "spread index" (−1 = before cover, 0…n = interior spreads, n+1 = after back cover). `φ` is the current rotation angle in [0, π] during a turn. Methods (`startTurn`, `completeTurn`, `cancelTurn`, etc.) are pure and fully unit-tested — keep them that way. `maxFanCount()` uses a friction-coupling impulse model; covers are weighted so they naturally stop fan propagation without special-casing.

### Book — three-mesh rendering model

Two static spread meshes always show the resting state. During an animation, a third `turningPageMesh` is spawned. This atomicity prevents z-fighting and simplifies abort/cancel logic. Fan turns spawn multiple staggered pages with delays. The crease shadow (tight Gaussian along spine) is a separate mesh that fades with turn progress.

**Vertex shader** (inline `FLIP_VERT` constant in `Book.ts`):
```glsl
φ(t) = uAngle + uBendAmount * t * sin(2.0 * uAngle)
```
`t ∈ [0, 1]` is normalized distance from spine; the `sin(2φ)` envelope produces gravity-based free-edge lag. `uBendAmount` is 0.4.

### Physics settle (main.ts)

On drag-end, an energy-based ODE runs in rAF until convergence:
```
v̇ = dir · G − D · v     (G = 5.0, D = 6.5)
```
Terminates when `½v² + G·|p − target| < 0.005`.

### Texture management (atlas.ts)

`generateBookTextures()` creates 1024×1024 canvas textures for all content. `TexturePool.retainWindow()` evicts GPU textures for spreads far from the current page. Video spreads use dual canvas textures updated every rAF via `drawImage`. All textures use linear filtering + sRGB color space.

### Files in `src/shaders/`

`page.vert` and `page.frag` are legacy and currently unused — the active shader is inlined in `Book.ts`.
