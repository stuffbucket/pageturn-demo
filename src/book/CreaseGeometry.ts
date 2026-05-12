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
 */
export function creaseFromDrag(
  corner: Vec2,
  drag: Vec2,
  pageSize: Vec2,
  isReverse = false,
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
    originY = corner.y;
    creaseDirX = 0;
    creaseDirY = 1;
  } else {
    // Find where the perpendicular-through-M line hits the spine x=0.
    //   M = (corner + drag) / 2
    //   spineY = M.y − M.x · perp.y / perp.x
    const Mx = (corner.x + drag.x) / 2;
    const My = (corner.y + drag.y) / 2;
    const rawSpineY = My - Mx * perpY / perpX;
    // Clamp the spine intersection to the page bounds. If the geometric
    // intersection lies far off-page (e.g. shallow tilt with large drag),
    // an unclamped axis at (0, ±100) produces a rotation that whips the
    // whole page off the spine. Clamping keeps the rotation axis on the
    // page edge so the binding constraint is preserved; the visual is
    // close to "crease tilted as far as it can while still touching the
    // spine within the page".
    originY = Math.max(-H / 2, Math.min(H / 2, rawSpineY));

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
