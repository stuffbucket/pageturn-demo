/**
 * CreaseGeometry.ts — pure-math derivation of the fold crease for a tilted
 * page turn (turn.js-inspired model).
 *
 * No Three.js imports.  Operates on plain `{x, y}` tuples in *page-local 2D
 * space*: spine at x = 0, free edge at x = pageWidth, top at y = +pageHeight/2,
 * bottom at y = -pageHeight/2.
 *
 * The model:
 *   When the user grabs a corner of the page and drags it to a new position,
 *   the fold crease is the perpendicular bisector of the segment
 *   (corner, drag).  This is the locus of points equidistant from the original
 *   and folded-over corner — i.e. where an inextensible sheet must crease.
 *
 *   The folded flap is the reflection of the un-folded region across the
 *   crease line, so the dragged corner lands exactly at `drag`.
 *
 *   Following turn.js, the "crease angle" alpha is:
 *
 *       alpha = π/2 − atan2(drag.y − corner.y, drag.x − corner.x)
 *
 *   so that horizontal drag (drag.y == corner.y) yields a vertical crease
 *   parallel to the spine — the standard book-turn case.
 *
 *   The 3D dihedral angle is not uniquely determined by the 2D drag (the same
 *   flat configuration can come from many out-of-plane fold angles).  Per the
 *   spec we map drag distance linearly to dihedral, saturating at π:
 *
 *       dihedral = π · clamp(|drag − corner| / pageWidth, 0, 1)
 */

export type Vec2 = { x: number; y: number };

export interface Crease {
  /** Crease angle in radians, per the turn.js convention. */
  alpha: number;
  /**
   * A point lying on the crease line, in page-local 2D coords.  Currently
   * the midpoint of (corner, drag) — the most natural anchor for a
   * perpendicular-bisector crease.  Named "originOnEdge" to reflect its role
   * as the origin of the crease line in shader-space; not necessarily on a
   * page boundary.
   */
  originOnEdge: Vec2;
  /**
   * Reflection of `corner` across the crease line.  By construction this is
   * exactly the drag point.
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
 * Compute the fold crease produced by dragging `corner` to `drag`.
 *
 * @param corner    Page corner being grabbed (e.g. top-right = (pageWidth, pageHeight/2)).
 * @param drag      Current pointer position in page-local 2D coords.
 * @param pageSize  {x: pageWidth, y: pageHeight}.
 */
export function creaseFromDrag(corner: Vec2, drag: Vec2, pageSize: Vec2): Crease {
  const dx = drag.x - corner.x;
  const dy = drag.y - corner.y;
  const dist = Math.hypot(dx, dy);

  // turn.js angle convention: horizontal drag → -π/2 (vertical crease ‖ spine).
  const alpha = Math.PI / 2 - Math.atan2(dy, dx);

  const mid: Vec2 = {
    x: (corner.x + drag.x) / 2,
    y: (corner.y + drag.y) / 2,
  };

  const dihedral = Math.PI * Math.min(1, dist / pageSize.x);

  return {
    alpha,
    originOnEdge: mid,
    farPoint: { x: drag.x, y: drag.y },
    dihedral,
    progress: dihedral / Math.PI,
  };
}

/**
 * Unit direction vector along the crease line, with `y >= 0` (so it always
 * points "up the spine").  Defined as the perpendicular to (drag − corner).
 *
 * For shader use: this is the rotation axis (in page-local XY, with z=0)
 * about which the folded flap rotates.
 *
 * Returns (0, 1) when drag == corner (degenerate: vertical crease).
 */
export function creaseDirection(corner: Vec2, drag: Vec2): Vec2 {
  const dx = drag.x - corner.x;
  const dy = drag.y - corner.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return { x: 0, y: 1 };
  // Perpendicular to (dx, dy): (-dy, dx).  Flip sign so y >= 0.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  // If ny is exactly 0, prefer positive nx for determinism.
  if (ny === 0 && nx < 0) { nx = -nx; ny = -ny; }
  return { x: nx, y: ny };
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
