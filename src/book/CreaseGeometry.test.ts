/**
 * Tests for CreaseGeometry — the pure-math turn.js fold model.
 */

import { describe, it, expect } from 'vitest';
import {
  creaseFromDrag,
  creaseDirection,
  reflectAcrossLine,
  wrapAngle,
  type Vec2,
} from './CreaseGeometry';

const PAGE: Vec2 = { x: 1.0, y: 1.4 };
const CORNER: Vec2 = { x: 1.0, y: 0.7 };  // top-right corner of the right page

describe('creaseFromDrag', () => {
  it('produces a vertical crease (alpha = -π/2) when drag is along the spine direction', () => {
    // Pure horizontal drag from the corner toward the spine.
    const drag: Vec2 = { x: 0.4, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(wrapAngle(c.alpha + Math.PI / 2)).toBeCloseTo(0, 12);
  });

  it('tilts alpha downward for diagonal drag toward the bottom-left', () => {
    // dx < 0, dy < 0 → atan2 ∈ (-π, -π/2) → alpha ∈ (π, 3π/2) → wrap gives a
    // negative tilt vs the vertical-crease angle (-π/2).
    const drag: Vec2 = { x: 0.3, y: 0.0 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const tilt = wrapAngle(c.alpha - (-Math.PI / 2));
    expect(tilt).toBeLessThan(0);
    expect(tilt).toBeGreaterThan(-Math.PI);
  });

  it('tilts alpha the opposite direction for diagonal drag toward the top-left', () => {
    // dx < 0, dy > 0 → atan2 ∈ (π/2, π) → alpha ∈ (-π/2, 0) → positive tilt.
    const drag: Vec2 = { x: 0.3, y: 1.2 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const tilt = wrapAngle(c.alpha - (-Math.PI / 2));
    expect(tilt).toBeGreaterThan(0);
    expect(tilt).toBeLessThan(Math.PI);
  });

  it('reflects corner across the crease line to exactly the drag point (= farPoint)', () => {
    const drag: Vec2 = { x: 0.2, y: 0.1 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const n = creaseDirection(CORNER, drag);
    // The crease is perpendicular to (drag − corner), so its normal is the
    // unit vector ALONG (drag − corner).  reflectAcrossLine takes that normal.
    const dragDir: Vec2 = {
      x: (drag.x - CORNER.x) / Math.hypot(drag.x - CORNER.x, drag.y - CORNER.y),
      y: (drag.y - CORNER.y) / Math.hypot(drag.x - CORNER.x, drag.y - CORNER.y),
    };
    const reflected = reflectAcrossLine(CORNER, c.originOnEdge, dragDir);
    expect(reflected.x).toBeCloseTo(c.farPoint.x, 9);
    expect(reflected.y).toBeCloseTo(c.farPoint.y, 9);
    expect(reflected.x).toBeCloseTo(drag.x, 9);
    expect(reflected.y).toBeCloseTo(drag.y, 9);
    // And ensure crease direction `n` is perpendicular to dragDir:
    expect(n.x * dragDir.x + n.y * dragDir.y).toBeCloseTo(0, 12);
  });

  it('places the crease line through the midpoint of (corner, drag)', () => {
    const drag: Vec2 = { x: -0.4, y: 0.55 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.originOnEdge.x).toBeCloseTo((CORNER.x + drag.x) / 2, 12);
    expect(c.originOnEdge.y).toBeCloseTo((CORNER.y + drag.y) / 2, 12);
  });

  it('yields dihedral ≈ 0 for a tiny drag near the corner', () => {
    const drag: Vec2 = { x: CORNER.x - 1e-6, y: CORNER.y + 1e-6 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeLessThan(1e-5);
    expect(c.progress).toBeLessThan(1e-5);
  });

  it('yields dihedral ≈ π when drag is a full pageWidth opposite the corner', () => {
    // Distance pageWidth in any direction → dihedral saturates at π.
    const drag: Vec2 = { x: CORNER.x - PAGE.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeCloseTo(Math.PI, 9);
    expect(c.progress).toBeCloseTo(1, 9);
  });

  it('clamps dihedral at π for drag distance exceeding pageWidth', () => {
    const drag: Vec2 = { x: CORNER.x - 3 * PAGE.x, y: CORNER.y };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.dihedral).toBeCloseTo(Math.PI, 9);
  });
});

describe('creaseDirection', () => {
  it('returns a unit vector with y >= 0', () => {
    const cases: Vec2[] = [
      { x: 0.5, y: 0.5 },
      { x: -0.3, y: 1.1 },
      { x: 0.0, y: -0.2 },
      { x: 0.7, y: 0.7 },
    ];
    for (const drag of cases) {
      const n = creaseDirection(CORNER, drag);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 12);
      expect(n.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to (0, 1) when drag == corner', () => {
    const n = creaseDirection(CORNER, CORNER);
    expect(n.x).toBe(0);
    expect(n.y).toBe(1);
  });

  it('returns (0, 1) for a horizontal drag (vertical crease)', () => {
    const n = creaseDirection(CORNER, { x: -0.5, y: CORNER.y });
    expect(Math.abs(n.x)).toBeLessThan(1e-12);
    expect(n.y).toBeCloseTo(1, 12);
  });
});
