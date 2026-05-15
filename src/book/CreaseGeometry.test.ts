/**
 * Tests for CreaseGeometry — the spine-pinned bound-book fold model.
 */

import { describe, it, expect } from 'vitest';
import {
  creaseFromDrag,
  reflectAcrossLine,
  wrapAngle,
  type Vec2,
} from './CreaseGeometry';

const PAGE: Vec2 = { x: 1.0, y: 1.4 };
const CORNER: Vec2 = { x: 1.0, y: 0.7 };  // top-right corner of the right page

describe('creaseFromDrag — spine pinning (bound-book invariant)', () => {
  it('pins originOnEdge to the spine (x = 0) for arbitrary drag points', () => {
    const drags: Vec2[] = [
      { x: 0.5, y: 0.7 },
      { x: 0.0, y: 0.0 },
      { x: -0.4, y: 0.55 },
      { x: 0.3, y: 1.2 },
      { x: 0.6, y: -0.4 },
    ];
    for (const drag of drags) {
      const c = creaseFromDrag(CORNER, drag, PAGE);
      expect(c.originOnEdge.x).toBe(0);
    }
  });

  it('produces a vertical crease (along the spine) for horizontal drag', () => {
    const drag: Vec2 = { x: 0.4, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.originOnEdge.x).toBe(0);
    expect(c.creaseDir.x).toBeCloseTo(0, 12);
    expect(c.creaseDir.y).toBeCloseTo(1, 12);
    // alpha is the standard "vertical crease" angle, -π/2.
    expect(wrapAngle(c.alpha + Math.PI / 2)).toBeCloseTo(0, 12);
  });

  it('clamps originOnEdge to the page bounds (top edge) when the unclamped intersection lies above the page', () => {
    // Drag with very small dy (nearly horizontal) such that the perpendicular
    // intersection with x=0 is far above the page.  Without clamping, the
    // rotation axis is far off-page and the page detaches from the spine.
    const drag: Vec2 = { x: -0.4, y: 0.55 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.originOnEdge.x).toBe(0);
    expect(c.originOnEdge.y).toBeLessThanOrEqual(PAGE.y / 2 + 1e-12);
    expect(c.originOnEdge.y).toBeGreaterThanOrEqual(-PAGE.y / 2 - 1e-12);
  });

  it('clamps originOnEdge to the bottom edge when intersection lies below the page', () => {
    // Mirror of the above test: drag downward so the intersection lies below.
    const drag: Vec2 = { x: -0.4, y: 0.85 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.originOnEdge.x).toBe(0);
    expect(c.originOnEdge.y).toBeLessThanOrEqual(PAGE.y / 2 + 1e-12);
    expect(c.originOnEdge.y).toBeGreaterThanOrEqual(-PAGE.y / 2 - 1e-12);
  });

  it('treats near-horizontal drag (within ~1°) as exact horizontal — degenerate to spine-aligned crease', () => {
    // dy is tiny relative to dx but nonzero. Without the epsilon-widening,
    // perpY/perpX would still be huge and originY would land far off-page.
    const drag: Vec2 = { x: 0.3, y: CORNER.y + 0.0001 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.originOnEdge.x).toBe(0);
    expect(Math.abs(c.creaseDir.x)).toBeLessThan(0.01);
    expect(c.creaseDir.y).toBeGreaterThan(0.99);
  });
});

describe('creaseFromDrag — alpha tilt direction', () => {
  it('tilts alpha downward for diagonal drag toward the bottom-left', () => {
    const drag: Vec2 = { x: 0.3, y: 0.0 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const tilt = wrapAngle(c.alpha - (-Math.PI / 2));
    expect(tilt).toBeLessThan(0);
    expect(tilt).toBeGreaterThan(-Math.PI);
  });

  it('tilts alpha the opposite direction for diagonal drag toward the top-left', () => {
    const drag: Vec2 = { x: 0.3, y: 1.2 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const tilt = wrapAngle(c.alpha - (-Math.PI / 2));
    expect(tilt).toBeGreaterThan(0);
    expect(tilt).toBeLessThan(Math.PI);
  });
});

describe('creaseFromDrag — geometric properties', () => {
  it('crease direction is perpendicular to (drag − corner) for non-horizontal drags', () => {
    // The crease line through originOnEdge always points perpendicular to
    // the drag direction. (Originally we checked that the crease passes
    // through the perpendicular-bisector midpoint M, but the smooth tanh
    // squash on originY breaks that for any in-bounds nonzero rawSpineY —
    // the perpendicularity invariant is the one that still holds.)
    const drags: Vec2[] = [
      { x: 0.0, y: -0.5 },
      { x: 0.5, y: 0.2 },
      { x: -0.3, y: 0.55 },
      { x: 0.2, y: -0.6 },
    ];
    for (const drag of drags) {
      const c = creaseFromDrag(CORNER, drag, PAGE);
      const dx = drag.x - CORNER.x;
      const dy = drag.y - CORNER.y;
      const dragLen = Math.hypot(dx, dy);
      // creaseDir · (drag − corner) should be zero (perpendicular).
      const dot = (c.creaseDir.x * dx + c.creaseDir.y * dy) / dragLen;
      expect(Math.abs(dot)).toBeLessThan(1e-9);
    }
  });

  it('cornerDir is unit length, perpendicular to creaseDir, and points toward the corner', () => {
    const drags: Vec2[] = [
      { x: 0.5, y: 0.7 },
      { x: 0.2, y: 0.1 },
      { x: -0.3, y: 0.4 },
      { x: 0.4, y: 1.0 },
    ];
    for (const drag of drags) {
      const c = creaseFromDrag(CORNER, drag, PAGE);
      const cd = c.cornerDir;
      expect(Math.hypot(cd.x, cd.y)).toBeCloseTo(1, 12);
      const dot = cd.x * c.creaseDir.x + cd.y * c.creaseDir.y;
      expect(Math.abs(dot)).toBeLessThan(1e-9);
      const cx = CORNER.x - c.originOnEdge.x;
      const cy = CORNER.y - c.originOnEdge.y;
      expect(cx * cd.x + cy * cd.y).toBeGreaterThan(0);
    }
  });

  it('reflection of corner across the spine-pinned crease equals farPoint', () => {
    const drag: Vec2 = { x: 0.2, y: 0.1 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    // Normal to the crease = (creaseDir.y, -creaseDir.x).
    const n: Vec2 = { x: c.creaseDir.y, y: -c.creaseDir.x };
    const reflected = reflectAcrossLine(CORNER, c.originOnEdge, n);
    expect(reflected.x).toBeCloseTo(c.farPoint.x, 9);
    expect(reflected.y).toBeCloseTo(c.farPoint.y, 9);
  });
});

describe('creaseFromDrag — dihedral mapping (forward)', () => {
  it('yields dihedral ≈ 0 for a tiny drag near the corner', () => {
    const drag: Vec2 = { x: CORNER.x - 1e-6, y: CORNER.y + 1e-6 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeLessThan(1e-5);
  });

  it('yields dihedral = π/2 at half-pull (drag horizontally to the page midline)', () => {
    const drag: Vec2 = { x: CORNER.x - PAGE.x / 2, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeCloseTo(Math.PI / 2, 9);
  });

  it('yields dihedral ≈ π when drag has been pulled one full pageWidth toward the spine', () => {
    const drag: Vec2 = { x: CORNER.x - PAGE.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeCloseTo(Math.PI, 9);
  });

  it('clamps dihedral at π for drags past the spine', () => {
    const drag: Vec2 = { x: -2 * PAGE.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeCloseTo(Math.PI, 9);
  });

  it('yields dihedral 0 for a pure vertical drag (no horizontal pull)', () => {
    const drag: Vec2 = { x: CORNER.x, y: -0.5 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBe(0);
  });
});

describe('creaseFromDrag — dihedral mapping (reverse)', () => {
  it('saturates at π when drag is at the conceptual reverse-start (-pageWidth, H/2)', () => {
    const drag: Vec2 = { x: -PAGE.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE, /* isReverse */ true);
    expect(c.dihedral).toBeCloseTo(Math.PI, 9);
  });

  it('hits dihedral = π/2 at the spine (drag.x = 0) for reverse turns', () => {
    const drag: Vec2 = { x: 0, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE, /* isReverse */ true);
    expect(c.dihedral).toBeCloseTo(Math.PI / 2, 9);
  });

  it('returns to dihedral = 0 when drag reaches the corner (rest state) for reverse', () => {
    const drag: Vec2 = { x: CORNER.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE, /* isReverse */ true);
    expect(c.dihedral).toBe(0);
  });

  it('maps dihedral linearly across the full reverse drag span (no plateau)', () => {
    const samples: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const dragX = -PAGE.x + (i / 8) * 2 * PAGE.x;
      const c = creaseFromDrag(CORNER, { x: dragX, y: CORNER.y }, PAGE, true);
      samples.push(c.dihedral);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-12);
    }
    expect(samples[0]).toBeCloseTo(Math.PI, 9);
    expect(samples[samples.length - 1]).toBeCloseTo(0, 9);
  });
});

describe('creaseFromDrag — Option B per-gesture spine anchor (issue #78)', () => {
  it('pins originOnEdge.y exactly to the supplied anchor (no tanh drift)', () => {
    const drag: Vec2 = { x: 0.3, y: -0.3 };       // tilted drag, would drift
    const anchor = 0.25;                           // arbitrary anchor on spine
    const c = creaseFromDrag(CORNER, drag, PAGE, false, anchor);
    expect(c.originOnEdge.x).toBe(0);
    expect(c.originOnEdge.y).toBe(anchor);
  });

  it('preserves crease tilt direction (creaseDir.y < 1 for tilted drags)', () => {
    // The whole point of Option B (vs Option A): the crease still tilts.
    const drag: Vec2 = { x: 0.3, y: -0.3 };
    const c = creaseFromDrag(CORNER, drag, PAGE, false, CORNER.y);
    expect(c.creaseDir.y).toBeLessThan(1);
    expect(Math.abs(c.creaseDir.x)).toBeGreaterThan(0);
  });

  it('originY = anchor regardless of drag y (no drift across a drag arc)', () => {
    const anchor = CORNER.y;     // typical: anchor matches click at corner
    const samples: Vec2[] = [
      { x: 0.5, y: 0 },
      { x: 0.3, y: -0.3 },
      { x: 0.0, y: -0.5 },
      { x: -0.5, y: -0.5 },
    ];
    for (const drag of samples) {
      const c = creaseFromDrag(CORNER, drag, PAGE, false, anchor);
      expect(c.originOnEdge.y).toBe(anchor);
    }
  });

  it('horizontal-drag fast path also honors the anchor', () => {
    const anchor = -0.2;
    const drag: Vec2 = { x: 0.5, y: CORNER.y };  // dy = 0 exactly
    const c = creaseFromDrag(CORNER, drag, PAGE, false, anchor);
    expect(c.originOnEdge.y).toBe(anchor);
    // Crease still degenerates to spine-aligned (creaseDir = (0,1)).
    expect(c.creaseDir.x).toBe(0);
    expect(c.creaseDir.y).toBe(1);
  });

  it('falls back to legacy tanh behavior when anchor is null/omitted', () => {
    const drag: Vec2 = { x: 0.3, y: -0.3 };
    const c1 = creaseFromDrag(CORNER, drag, PAGE);
    const c2 = creaseFromDrag(CORNER, drag, PAGE, false, null);
    expect(c1.originOnEdge.y).toBe(c2.originOnEdge.y);
    // And the legacy result is NOT equal to corner.y (it drifted).
    expect(Math.abs(c1.originOnEdge.y - CORNER.y)).toBeGreaterThan(1e-3);
  });
});
