/**
 * CreaseGeometry.ts — pure-math derivation of the fold crease for a
 * bound-book tilted-crease page turn.
 *
 * No Three.js imports.  Operates on plain `{x, y}` tuples in *page-local 2D
 * space*: spine at x = 0, free edge at x = pageWidth, top at y = +pageHeight/2,
 * bottom at y = -pageHeight/2.
 *
 * Bound-book differences from the free-sheet (turn.js) model:
 *
 *  • The crease line is **pinned to the spine** (x = 0) so the page binding
 *    is preserved: the rotation axis always passes through a point on the
 *    spine, and the spine vertices at that point stay put.  Without this
 *    pin (as in turn.js, where the crease is the perpendicular bisector of
 *    `(corner, drag)` no matter where that lies), the page can detach
 *    from the spine entirely for tilted drags.
 *
 *  • The crease is still **perpendicular to the drag direction**
 *    `(drag − corner)`, but its origin is moved from the midpoint M of
 *    `(corner, drag)` to the intersection of the perpendicular-through-M
 *    line with the spine x = 0:
 *
 *        spineY = M.y − M.x · perp.y / perp.x       (perp = (−dy, dx))
 *
 *    Degenerate case `perp.x ≈ 0` (drag direction has no y-component, i.e.
 *    horizontal pull): the crease degenerates to the spine itself — the
 *    standard book-turn behavior.
 *
 *  • The dihedral mapping is **direction-aware**:
 *
 *        forward:  dihedral = π · clamp((corner.x − drag.x) /         W, 0, 1)
 *        reverse:  dihedral = π · clamp((corner.x − drag.x) / (2 ·    W), 0, 1)
 *
 *    A forward turn commits with one pageWidth of horizontal pull (snappy);
 *    a reverse turn (which conceptually starts at drag = (−W, H/2), already
 *    π-folded) needs the full `2W` span to map cleanly across `[π, 0]`.
 *
 *  • The follower angle `alpha` and the unit `creaseDir` and `cornerDir`
 *    perpendiculars are exposed for the renderer to build the rotation axis.
 *
 *  • `farPoint` is the **reflection of `corner` across the actual (spine-
 *    pinned) crease line** — i.e. where the dragged corner *physically*
 *    lands once the constraint is enforced.  In general this is *not* the
 *    raw `drag` point (which is just the user's pointer position).
 */

export type Vec2 = { x: number; y: number };

export interface Crease {
  /** Crease angle in radians, per the turn.js convention. */
  alpha: number;
  /**
   * Origin of the crease line in page-local 2D coords.  Always lies on the
   * spine (x = 0).  This is the point used as the rotation-axis origin in
   * the vertex shader.
   */
  originOnEdge: Vec2;
  /**
   * Unit direction vector along the crease line, with `y >= 0`.  This is
   * the rotation-axis direction (lifted to `(creaseDir.x, creaseDir.y, 0)`
   * in 3D) about which the flap rotates.
   *
   * For the degenerate horizontal-drag case this is `(0, 1)` — the spine
   * itself becomes the rotation axis.
   */
  creaseDir: Vec2;
  /**
   * Unit perpendicular to `creaseDir`, pointing toward the dragged corner
   * side of the crease line.  The shader uses this to classify flap-side
   * vertices (where `dot(P − origin, cornerDir) > 0`).
   */
  cornerDir: Vec2;
  /**
   * Reflection of `corner` across the (spine-pinned) crease line.  In the
   * bound model this is generally *not* equal to `drag`.
   */
  farPoint: Vec2;
  /** Dihedral angle of the fold in radians, in [0, π]. */
  dihedral: number;
  /** Normalized turn progress, dihedral / π, in [0, 1]. */
  progress: number;
}

const TAU = Math.PI * 2;

/**
 * Default blend distance (as a fraction of `pageWidth`) for the
 * mid-spine anchor blend in `computeGestureAnchorY`. When the grab is
 * closer to the spine than this distance the anchor follows the cursor
 * y exactly; beyond this distance it smoothly blends toward the
 * mid-spine (y = 0). The value `0.3` is heuristic — chosen so that
 * grabs within the inner third of the page still feel pivot-through-
 * grab while corner-region pinches behave like a mid-spine crease.
 *
 * See real-paper photo analysis in PR #84:
 * https://github.com/stuffbucket/pageturn-demo/pull/84
 * Verdict (verbatim): "corner-pinches still produce mid-spine creases."
 */
export const ANCHOR_BLEND_DIST = 0.3;

/** Clamp `x` to `[a, b]`. */
function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

/** GLSL-style smoothstep: 0 below `edge0`, 1 above `edge1`, smooth between. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Choose the per-gesture spine anchor y for the crease line, given the
 * pointerdown world point in page-local 2D coords.
 *
 * Real-paper analysis (29 photo frames, summarised in PR #84) shows that
 * the crease's intersection with the spine sits near mid-spine for
 * almost every grab — even corner pinches produce a near-mid-spine
 * crease. The anchor only follows the cursor y when the user grabs near
 * the spine itself (where there's no leverage to pull the crease
 * away from the bound edge).
 *
 * The mapping blends between two extremes:
 *
 *   • grab at the spine     (|wp.x| ≈ 0)   → anchor = clamp(wp.y)
 *   • grab at the far edge  (|wp.x| ≈ W)   → anchor = 0  (mid-spine)
 *
 * The interpolation uses GLSL smoothstep over `[0, ANCHOR_BLEND_DIST]`
 * of `|wp.x| / W`, so the blend is symmetric for forward and reverse
 * drags. Once `|wp.x| / W ≥ ANCHOR_BLEND_DIST` the anchor is fully
 * mid-spine.
 *
 * Refines PR #82 (which used `clamp(wp.y, ±H/2)` unconditionally).
 *
 * @param wp           World drag-start point in page-local coords (spine at x=0).
 * @param pageSize     {x: pageWidth, y: pageHeight}.
 * @param blendDist    Optional override for `ANCHOR_BLEND_DIST` (units:
 *   fraction of `pageWidth`). Must be > 0.
 */
export function computeGestureAnchorY(
  wp: Vec2,
  pageSize: Vec2,
  blendDist: number = ANCHOR_BLEND_DIST,
): number {
  const W = pageSize.x;
  const halfH = pageSize.y / 2;
  const clampedY = clamp(wp.y, -halfH, halfH);
  // Symmetric in sign(wp.x): reverse turns use |wp.x| just like forward turns.
  const distFromSpine = W > 0 ? Math.abs(wp.x) / W : 0;
  const blend = smoothstep(0, blendDist, distFromSpine);
  // mix(clampedY, 0, blend) === clampedY * (1 - blend)
  return clampedY * (1 - blend);
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x <= -Math.PI) x += TAU;
  return x;
}

/**
 * Compute the spine-pinned fold crease produced by dragging `corner` to
 * `drag`.
 *
 * @param corner    Page corner being grabbed (e.g. top-right = (pageWidth, pageHeight/2)).
 * @param drag      Current pointer position in page-local 2D coords.
 * @param pageSize  {x: pageWidth, y: pageHeight}.
 * @param isReverse If true, dihedral is mapped over a `2·pageWidth` span so
 *   that the conceptual reverse-turn start `drag = (−W, H/2)` saturates at
 *   π.  Defaults to false (forward turn, `pageWidth` span).
 * @param anchorY   Optional **per-gesture spine anchor**. When provided, the
 *   crease line's intersection with the spine is locked to `(0, anchorY)`
 *   for the duration of the gesture instead of drifting along with the
 *   cursor. This is the **Option B** fix for issue #78: it preserves the
 *   directional fold feel (the crease line still tilts with drag direction)
 *   while preventing the unbounded spine-strip stretch the drift caused.
 *   When `null`/omitted the legacy tanh-asymptotic behavior is used (this
 *   path is kept only for the synthesised settle drag where drag.y ≡
 *   corner.y, which already collapses to the horizontal-drag fast path).
 */
export function creaseFromDrag(
  corner: Vec2,
  drag: Vec2,
  pageSize: Vec2,
  isReverse = false,
  anchorY: number | null = null,
): Crease {
  const W = pageSize.x;
  const H = pageSize.y;

  const dx = drag.x - corner.x;
  const dy = drag.y - corner.y;

  // Dihedral driven by horizontal pull toward the spine.  Pure vertical drag
  // contributes nothing.  Forward saturates at π over one pageWidth (snappy);
  // reverse uses 2·pageWidth so the full [-W, +W] sweep maps across [π, 0]
  // (reverse rest = drag at (-W, H/2) → pull = 2W → dihedral = π).
  const horizontalPull = corner.x - drag.x;
  const span = isReverse ? 2 * W : W;
  const dihedral = Math.PI * Math.max(0, Math.min(1, horizontalPull / span));

  // turn.js angle convention: horizontal drag → -π/2 (vertical crease ‖ spine).
  const alpha = Math.PI / 2 - Math.atan2(dy, dx);

  // Crease line: perpendicular to (drag − corner), pinned to (0, spineY).
  // perp = (-dy, dx) is rotated 90° CCW from the drag direction.
  const perpX = -dy;
  const perpY = dx;

  let originY: number;
  let creaseDirX: number;
  let creaseDirY: number;

  // Threshold below which we treat the crease as parallel to the spine.
  // Bumped from 1e-9 to a fraction of pageHeight: when perpX is tiny but
  // nonzero, perpY/perpX explodes and originY lands far off the page,
  // producing a rotation axis that's not on the spine and tearing the
  // page off its binding. For drag directions within ~1° of horizontal,
  // collapsing to the standard book turn is visually correct.
  const HORIZONTAL_DRAG_EPSILON = 0.02 * H;
  if (Math.abs(perpX) < HORIZONTAL_DRAG_EPSILON) {
    // Drag direction has (essentially) no y-component → crease is parallel
    // to the spine. Degenerate to crease ≡ spine itself: standard book turn.
    // The anchor (when provided) still pins the spine intersection so the
    // rotation axis sits on the user's grip rather than corner-height.
    originY = anchorY ?? corner.y;
    creaseDirX = 0;
    creaseDirY = 1;
  } else {
    if (anchorY !== null) {
      // ── Option B (issue #78): per-gesture spine anchor ──────────────────
      // The spine intersection of the crease line is locked to the anchor
      // chosen at pointerdown. The crease *direction* still tilts with the
      // drag (perpendicular to the drag delta), so the directional fold
      // feel is preserved. Because originY no longer drifts with the
      // cursor, the spine vertices remain geodesically reachable from the
      // rotation axis and the spine-strip stretch defect disappears.
      originY = anchorY;
    } else {
      // Find where the perpendicular-through-M line hits the spine x=0.
      //   M = (corner + drag) / 2
      //   spineY = M.y − M.x · perp.y / perp.x
      const Mx = (corner.x + drag.x) / 2;
      const My = (corner.y + drag.y) / 2;
      const rawSpineY = My - Mx * perpY / perpX;
      // Smoothly squash the spine intersection toward the page edges instead
      // of hard-clamping. A hard clamp introduces a derivative discontinuity:
      // inside [-H/2, H/2] originY tracks rawSpineY 1:1; at the boundary it
      // slams to a stop. The user perceives this as the constraint "breaking"
      // (no visual response when drag would push originY further off-page)
      // and "sticky" (drag must reverse far enough to bring rawSpineY back
      // into bounds before any visual response resumes).
      //
      // Smooth function used:  originY = limit · tanh(rawSpineY / limit)
      //   - For |rawSpineY| << limit:  originY ≈ rawSpineY (linear, identity)
      //   - For |rawSpineY| → ∞:       originY → ±limit (asymptotic, never hits)
      //   - Continuous and continuously differentiable everywhere.
      //
      // The squash starts to bite around |rawSpineY| ≈ limit, so a generous
      // limit means the in-page region behaves identically to the unclamped
      // model and only large off-page intersections get squashed. Using H/2
      // as the limit means originY can asymptotically approach but never reach
      // the page edge, preserving the binding constraint without the visual
      // discontinuity.
      const limit = H / 2;
      originY = limit * Math.tanh(rawSpineY / limit);
    }

    const len = Math.hypot(perpX, perpY);
    creaseDirX = perpX / len;
    creaseDirY = perpY / len;
    // Convention: y >= 0 (axis points "up the spine").
    if (creaseDirY < 0) { creaseDirX = -creaseDirX; creaseDirY = -creaseDirY; }
    if (creaseDirY === 0 && creaseDirX < 0) { creaseDirX = -creaseDirX; }
  }

  const origin: Vec2 = { x: 0, y: originY };

  // cornerDir = unit perpendicular to creaseDir on the same side as the
  // grabbed corner.  Equivalently: -unit(drag − corner), since the corner
  // sits opposite to the drag direction across the crease.
  const dragLen = Math.hypot(dx, dy);
  let cornerDirX: number;
  let cornerDirY: number;
  if (dragLen < 1e-9) {
    // No drag — pick the page-interior direction (+x).
    cornerDirX = 1;
    cornerDirY = 0;
  } else {
    cornerDirX = -dx / dragLen;
    cornerDirY = -dy / dragLen;
  }

  // farPoint: reflection of the original corner across the spine-pinned
  // crease line.  Normal to the crease = (creaseDirY, -creaseDirX).
  const nx = creaseDirY;
  const ny = -creaseDirX;
  const cx = corner.x - origin.x;
  const cy = corner.y - origin.y;
  const dProj = cx * nx + cy * ny;
  const farPoint: Vec2 = {
    x: corner.x - 2 * dProj * nx,
    y: corner.y - 2 * dProj * ny,
  };

  return {
    alpha,
    originOnEdge: origin,
    creaseDir: { x: creaseDirX, y: creaseDirY },
    cornerDir: { x: cornerDirX, y: cornerDirY },
    farPoint,
    dihedral,
    progress: dihedral / Math.PI,
  };
}

/**
 * Reflect `p` across the line through `m` perpendicular to unit normal `n`.
 * (Helper exposed for tests.)
 */
export function reflectAcrossLine(p: Vec2, m: Vec2, n: Vec2): Vec2 {
  const rx = p.x - m.x;
  const ry = p.y - m.y;
  const d = rx * n.x + ry * n.y;
  return {
    x: p.x - 2 * d * n.x,
    y: p.y - 2 * d * n.y,
  };
}
