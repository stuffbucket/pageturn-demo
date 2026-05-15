/**
 * SpineStripStretch.regression.test.ts — failing regression test for the
 * "drag-only stretch" defect diagnosed 2026-05-14.
 *
 * USER REPORT (verbatim):
 *   "I notice that when we are in a state that we should not be in it is
 *    when the mouse button is down. The moment the mouse is released the
 *    stretching is immediately disappearing with the page otherwise
 *    resuming its normal behavior to settle into position."
 *
 * ROOT-CAUSE SUMMARY
 * ──────────────────
 * The page-turn shader receives the same FLIP_VERT uniforms during drag and
 * during settle, but they are computed from DIFFERENT inputs:
 *
 *   • DRAG path:
 *       BookState.setDragPoint(cursorX, cursorY)  →  dragPoint = {cursorX, cursorY}
 *       BookState.getCrease()                     →  creaseFromDrag(corner, dragPoint)
 *     The crease is fully tilted: (creaseDir, cornerDir) follow the cursor
 *     direction and `originY` drifts away from `corner.y` whenever the cursor
 *     is not at corner-height.
 *
 *   • SETTLE path:
 *       BookState.setTurningProgress(p)           →  this.dragPoint = null
 *       BookState.getCrease()  // dragPoint cleared, falls back to synthesis:
 *                              →  drag = { x: corner.x − span·phi/π,  y: corner.y }
 *     Synthesised drag has y == corner.y, so dy = 0, perpX ≈ 0, and the
 *     HORIZONTAL_DRAG_EPSILON branch fires:  originY = corner.y,
 *     creaseDir = (0, 1). Crease is always vertical = standard book turn.
 *
 * The shader's spine-pin guard (`if (pos.x <= spineEps) flapPos = pos;`)
 * forces the column at x=0 to stay at its rest position. With a tilted
 * crease, the very next mesh column is fully rotated about an axis whose
 * origin is at (0, originY ≠ corner.y), so the chord between column-0 and
 * column-1 stretches by an unbounded amount that grows with `corner.y −
 * originY`. With a horizontal crease (settle), originY == corner.y, so the
 * spine column lies on the rotation axis and no stretch arises.
 *
 * NUMERIC EVIDENCE (sin2phi path, INTERIOR_STOCK ignored — this is geometry,
 * not material):
 *
 *   drag = (0.5, 0)         phi=π/2   originY drift 0.103   max stretch 1.14×
 *   drag = (0.3, -0.3)      phi=2.2   originY drift 0.187   max stretch 13×
 *   drag = (0.0, -0.5)      phi=π     originY drift 0.260   max stretch 25×
 *
 * Same dihedral via settle-style horizontal-synthesis drag never exceeds 1.0
 * (the spine strip slightly compresses as it lifts — the inverse defect).
 *
 * RELATED ISSUES
 * ──────────────
 *   #50  Sliding crease originY along spine grows turning-page area.
 *        ← This regression is the "drag-only" specialisation of #50.
 *   #64  originY snap quantization causes per-row stretch.
 *   #68  Page can rotate off the spine even though pull is correctly constrained.
 *   #76  Page pivots around mouse position rather than spine binding.
 *
 * CONCEPTUAL FIX (not implemented in this PR)
 * ───────────────────────────────────────────
 * Make the drag path produce the same crease the settle path would for the
 * same φ. Two options under discussion:
 *
 *   A. Drive the crease only from `horizontalPull` (drag.x) and ignore
 *      drag.y for crease geometry, keeping originY = corner.y always. The
 *      crease tilt would survive only as a visual cue computed *after* the
 *      crease is built (e.g., as a curl-asymmetry term).
 *   B. Move the spine-pin onto the crease axis itself: instead of pinning
 *      x=0 to rest, pin the *intersection of the crease with the spine* to
 *      rest. This requires a developable-surface formulation (#18, PRD #11)
 *      and is the long-term direction of the model.
 *
 * This PR introduces only the failing regression test. A follow-up PR will
 * land the chosen fix and remove the `.fails` marker.
 *
 * The test is `it.fails(...)`, so vitest expects it to fail — `npm test`
 * stays green. When the fix lands, the assertion will pass and vitest will
 * report a "failed-fail" which is the signal to drop the marker.
 */

import { describe, it, expect } from 'vitest';
import { creaseFromDrag, type Crease, type Vec2 } from './CreaseGeometry';

const W = 1.0;
const H = 1.4;
const BEND_AMOUNT = 0.4;

// ── Pure-math sin2phi vertex replica ─────────────────────────────────────────
// Mirrors the inline FLIP_VERT shader in `Book.ts` (sin2phi branch). Kept
// minimal: no smoothstep band, no developable curl — those are orthogonal to
// the spine-strip stretch this test isolates.

type V3 = [number, number, number];

function rodrigues(v: V3, k: V3, ang: number): V3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const cx = k[1] * v[2] - k[2] * v[1];
  const cy = k[2] * v[0] - k[0] * v[2];
  const cz = k[0] * v[1] - k[1] * v[0];
  const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + cx * s + k[0] * kd * (1 - c),
    v[1] * c + cy * s + k[1] * kd * (1 - c),
    v[2] * c + cz * s + k[2] * kd * (1 - c),
  ];
}

function maxFlapDist(cnd: { x: number; y: number }, originY: number): number {
  const corners: Array<[number, number]> = [
    [0, -H / 2], [0, H / 2], [W, -H / 2], [W, H / 2],
  ];
  let m = 0;
  for (const c of corners) {
    const sv = c[0] * cnd.x + (c[1] - originY) * cnd.y;
    if (sv > m) m = sv;
  }
  return Math.max(m, 1e-6);
}

function sin2phiVert(pos: [number, number], crease: Crease): V3 {
  const originY = crease.originOnEdge.y;
  const flap = maxFlapDist(crease.cornerDir, originY);

  const rx = pos[0];
  const ry = pos[1] - originY;
  const s = rx * crease.cornerDir.x + ry * crease.cornerDir.y;
  const k: V3 = [crease.creaseDir.x, crease.creaseDir.y, 0];
  const t = Math.max(0, Math.min(1, s / flap));
  const phi = crease.dihedral + BEND_AMOUNT * t * Math.sin(2 * crease.dihedral);

  const rel: V3 = [pos[0], pos[1] - originY, 0];
  const rotated = rodrigues(rel, k, -phi);
  const flapPos: V3 = [rotated[0], originY + rotated[1], rotated[2]];

  // Spine-pin guard (must mirror Book.ts FLIP_VERT). Column at x ≈ 0 stays
  // at rest, regardless of the flap-side classifier. This is the binding
  // constraint that, in combination with a tilted crease, produces the
  // spine-strip stretch this test characterises.
  if (pos[0] <= 1e-4) return [pos[0], pos[1], 0];
  return flapPos;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** What the drag path computes from a live cursor position. */
function dragStyleCrease(corner: Vec2, cursor: Vec2): Crease {
  return creaseFromDrag(corner, cursor, { x: W, y: H });
}

/**
 * What the settle path computes for the SAME dihedral. Mirrors
 * `BookState.getCrease()` after `setTurningProgress` clears `dragPoint` —
 * the synthesis branch fabricates a horizontal drag at corner-height.
 */
function settleStyleCreaseAtPhi(corner: Vec2, phi: number): Crease {
  const synth: Vec2 = { x: corner.x - W * (phi / Math.PI), y: corner.y };
  return creaseFromDrag(corner, synth, { x: W, y: H });
}

function chord(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Maximum chord-stretch ratio over the spine-strip cell (column 0 → column
 * one tessellation cell to its right) across a sweep of v rows. A value of
 * 1.0 means the strip is inextensible; > 1.0 means the strip stretches.
 */
function maxSpineStripStretch(crease: Crease): number {
  // 96-segment width → ~0.0104 W per cell. Sample at 0.01 W to be model-mesh
  // agnostic; the divergence is geometric, not tessellation-dependent.
  const dx = 0.01 * W;
  let worst = 0;
  for (let vi = 0; vi < 7; vi++) {
    const v = (vi + 0.5) / 7;
    const py = (v - 0.5) * H;
    const a = sin2phiVert([0, py], crease);
    const b = sin2phiVert([dx, py], crease);
    const ratio = chord(a, b) / dx;
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Spine-strip stretch — drag vs settle uniform divergence', () => {
  const corner: Vec2 = { x: W, y: H / 2 };

  // Three drag scenarios spanning the regime (slight tilt → extreme tilt).
  // Each row pairs a live cursor position with the same-dihedral synthetic
  // drag the settle path would have used.
  const scenarios = [
    { label: 'mid drag, mid tilt',     cursor: { x: 0.5, y: 0 } },
    { label: 'deep drag, strong tilt', cursor: { x: 0.3, y: -0.3 } },
    { label: 'across, extreme tilt',   cursor: { x: 0.0, y: -0.5 } },
  ];

  for (const sc of scenarios) {
    it(`settle-style crease never stretches the spine strip (${sc.label})`, () => {
      const liveCrease = dragStyleCrease(corner, sc.cursor);
      const settleCrease = settleStyleCreaseAtPhi(corner, liveCrease.dihedral);
      // Sanity: same dihedral on both sides.
      expect(settleCrease.dihedral).toBeCloseTo(liveCrease.dihedral, 6);
      // Settle path is inextensible on the spine strip.
      expect(maxSpineStripStretch(settleCrease)).toBeLessThanOrEqual(1.01);
    });

    // Failing assertion: the live drag path must produce the same
    // inextensibility as the settle path for the same dihedral. Currently
    // it does not — the live crease's tilted (creaseDir, originY, cornerDir)
    // produces an originY drift that the spine-pin guard converts into raw
    // spine-strip stretch.
    //
    // `it.fails` flips the polarity: vitest treats this as a passing slot
    // while the assertion fails. When the fix lands and the assertion
    // passes, vitest will surface "failed-fail" → drop the marker.
    it.fails(
      `drag-style crease must not stretch the spine strip (${sc.label})`,
      () => {
        const liveCrease = dragStyleCrease(corner, sc.cursor);
        expect(maxSpineStripStretch(liveCrease)).toBeLessThanOrEqual(1.01);
      },
    );
  }
});
