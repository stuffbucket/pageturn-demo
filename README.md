# Page Turn Demo

An interactive 3D book built with Three.js, TypeScript, and Vite. Features drag-to-turn pages with physics settle, a gravity-based curl shader, rich procedural content, and a Big Buck Bunny video spread.

## Running

```bash
npm install
npm run dev        # dev server at localhost:5173
npm run build      # production build
```

**Controls:** click-drag pages to turn, arrow keys, or the prev/next buttons. Orbit with right-drag or scroll to zoom.

## Architecture

```
src/
  main.ts              Scene, camera, OrbitControls, drag system, physics settle
  book/
    Book.ts            Book orchestrator — two spread meshes + animated flip page + crease shadow
    BookState.ts       Pure state machine: j ∈ {-1, 0, …, n+1}, φ ∈ [0, π]
    PageGeometry.ts    Subdivided PlaneGeometry factory
    PageMaterial.ts    ShaderMaterial setup (legacy, unused by current flip shader)
  shaders/
    page.vert/frag     Legacy cylinder-wrap shaders (unused — flip shaders are inline in Book.ts)
  textures/
    atlas.ts           Procedural texture generation: covers, endpapers, poems, landscapes, video spread
```

### Key modules

- **BookState** — Discrete state index `j` tracks which spread is visible. During a turn, progress `p ∈ [0,1]` drives the rotation angle. Forward and reverse turns are symmetric.

- **Book** — Manages two static spread meshes (left/right) that always show the resting state. During a turn, a third `turningPageMesh` is spawned with a custom vertex shader, rotated, and destroyed on completion. A crease shadow strip fades in at mid-turn.

- **main.ts** — Drag interaction uses pointer capture and a hit-test plane matching the book tilt. On release, a gravity + drag physics model settles the page to its target. OrbitControls are disabled during drags and re-enabled immediately on release.

- **atlas.ts** — Generates 1024×1024 canvas textures for all book surfaces: gradient covers with gold typography, marbled endpapers, a Robert Frost poem page, an Unsplash forest photo, a Big Buck Bunny video spread (dual canvas textures updated per rAF), a Tolkien pull quote, landscape paintings, prose pages, and a colophon.

## Page motion equations

Progress `p ∈ [0, 1]` maps to spine angle `φ = −πp`. Each vertex at normalized distance `t ∈ [0, 1]` from the spine gets a per-vertex angle:

```
φ(t) = φ_spine + A · t · sin(2 · φ_spine)     A = 0.4
```

The `sin(2φ)` envelope makes the free edge lag during the lift and lead during the fall — a natural gravity curl. The constraint `A < 0.5` ensures the edge velocity never reverses.

After drag release, progress settles via:

```
v̇ = dir · G − D · v       G = 5.0, D = 6.5
p ← clamp(p + v · Δt)
```

## Author Notes

This implementation follows the cylinder-wrap model used across Unity, Blender, and After Effects. The core insight is that page turns are simplified to wrapping around a moving cylinder, not full developable surface simulation. This reduces the math to basic trigonometry and geometry while maintaining visual plausibility.

The formalization decouples concerns: state machine (Section 1) is pure logic and testable independently, geometry (Section 2) is math-heavy but deterministic, and texturing (Section 3) is a shader concern orthogonal to shape.

---

**Total Implementation**: ~700 lines of TypeScript + ~100 lines of GLSL, fully compatible with Vite's module semantics and Three.js conventions.
