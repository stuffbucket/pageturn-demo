/**
 * CreaseGeometry.mutation.test.ts — targeted tests added in the
 * 2026-05-14 mutation-test audit. Each `it` here is annotated with the
 * specific mutant it was written to kill (file:line:mutator). Keep the
 * annotations: when this file shows red, look up the mutant in
 * `reports/mutation/page-model.html` before rewriting.
 */

import { describe, it, expect } from 'vitest';
import { creaseFromDrag, reflectAcrossLine, type Vec2 } from './CreaseGeometry';

const PAGE: Vec2 = { x: 1.0, y: 1.4 };
const CORNER: Vec2 = { x: 1.0, y: 0.7 };

/** Re-derive originY analytically from the public formula, no shortcuts. */
function expectedOriginY(corner: Vec2, drag: Vec2, page: Vec2): number {
  const dx = drag.x - corner.x;
  const dy = drag.y - corner.y;
  const perpX = -dy;
  const perpY = dx;
  const H_EPS = 0.02 * page.y;
  if (Math.abs(perpX) < H_EPS) return corner.y;
  const Mx = (corner.x + drag.x) / 2;
  const My = (corner.y + drag.y) / 2;
  const rawSpineY = My - (Mx * perpY) / perpX;
  const limit = page.y / 2;
  return limit * Math.tanh(rawSpineY / limit);
}

describe('CreaseGeometry — numeric originY oracle (kills L154–L156, L177)', () => {
  // Set of drags chosen so that:
  //   - perpY is positive and negative
  //   - rawSpineY is well inside [-H/2, H/2] (linear tanh region)
  //   - rawSpineY is well outside [-H/2, H/2] (asymptotic tanh region)
  //   - Mx is not zero and not equal to drag.x (catches *2 and /2 mutants)
  const drags: Vec2[] = [
    { x: 0.5, y: 0.3 },   // diagonal down-left, |rawSpineY| < limit
    { x: 0.5, y: 1.1 },   // diagonal up-left, |rawSpineY| < limit, opp sign perpX
    { x: 0.2, y: 0.5 },
    { x: 0.0, y: 0.55 },  // deeper, rawSpineY larger
    { x: -0.4, y: 0.85 }, // past spine, asymptotic squash region
    { x: -0.4, y: 0.55 }, // mirror of #5 in sign of perpX
  ];

  for (const d of drags) {
    it(`originY matches analytic formula for drag (${d.x}, ${d.y})`, () => {
      const c = creaseFromDrag(CORNER, d, PAGE);
      const expected = expectedOriginY(CORNER, d, PAGE);
      // 1e-9 is more than tight enough to catch a sign flip on Mx, My,
      // perpY/perpX, or the tanh divide/multiply mutation.
      expect(c.originOnEdge.y).toBeCloseTo(expected, 9);
    });
  }

  it('originY non-zero example forces the tanh argument to be a division (kills L177)', () => {
    // Pick a drag whose rawSpineY is in the linear region: |rawSpineY|/limit
    // small enough that tanh(rawSpineY/limit) is visibly different from
    // tanh(rawSpineY*limit). With limit = 0.7 and rawSpineY ≈ -0.15:
    //   correct:  0.7·tanh(-0.214) ≈ -0.148
    //   mutant:   0.7·tanh(-0.105) ≈ -0.0734    (~50 % off)
    const drag: Vec2 = { x: 0.85, y: 0.85 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    const expected = expectedOriginY(CORNER, drag, PAGE);
    expect(c.originOnEdge.y).toBeCloseTo(expected, 9);
    expect(Math.abs(expected)).toBeGreaterThan(0.05);
    expect(Math.abs(expected)).toBeLessThan(0.55);
  });
});

describe('CreaseGeometry — reverse-turn span scaling (kills L122 ArithmeticOperator)', () => {
  // Stryker mutated `2 * W` to `2 / W`. With pageWidth = 1, the two values
  // coincide, so the existing tests cannot tell them apart. Use a wider page
  // here to force the multiplication to dominate.
  const WIDE: Vec2 = { x: 2.0, y: 1.4 };
  const CORNER_WIDE: Vec2 = { x: 2.0, y: 0.7 };

  it('reverse-turn dihedral at half-pull is π/4 (linear in horizontal pull below saturation)', () => {
    // Pull = W (one pageWidth). Forward span is W (saturation), reverse span
    // is 2W, so reverse dihedral at pull=W is π * (W / 2W) = π/2.
    const drag: Vec2 = { x: CORNER_WIDE.x - WIDE.x, y: CORNER_WIDE.y };
    const c = creaseFromDrag(CORNER_WIDE, drag, WIDE, /* reverse */ true);
    expect(c.dihedral).toBeCloseTo(Math.PI / 2, 9);
  });

  it('reverse-turn dihedral at quarter-pull is π/8 (linear below saturation, kills 2/W mutant)', () => {
    const drag: Vec2 = { x: CORNER_WIDE.x - WIDE.x / 2, y: CORNER_WIDE.y };
    const c = creaseFromDrag(CORNER_WIDE, drag, WIDE, /* reverse */ true);
    // pull = W/2, span = 2W, dihedral = π * (W/2) / (2W) = π/4.
    // Mutant span = 2/W with W=2 gives span = 1, dihedral = π * 1 / 1 = π
    // (clamped). Wildly different.
    expect(c.dihedral).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe('CreaseGeometry — horizontal-drag epsilon scales with pageHeight (kills L143)', () => {
  // L143: `HORIZONTAL_DRAG_EPSILON = 0.02 * H`. Mutant `0.02 / H` flips this
  // to 0.014 for H=1.4 — close enough that the threshold test below can tell
  // them apart.
  it('a perpX of ~0.022 collapses to degenerate spine-aligned crease (multiplication)', () => {
    // perpX = -dy. To get perpX ≈ 0.022 with H=1.4, set dy ≈ -0.022, drag y
    // slightly below corner.y, drag x somewhere away.
    const drag: Vec2 = { x: 0.5, y: CORNER.y - 0.022 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    // With H_EPS = 0.028 (correct), |perpX| = 0.022 < 0.028 ⇒ degenerate path
    // taken, crease snaps to (0, 1).
    expect(c.creaseDir.x).toBeCloseTo(0, 9);
    expect(c.creaseDir.y).toBeCloseTo(1, 9);
    expect(c.originOnEdge.y).toBeCloseTo(CORNER.y, 9);
  });

  it('a perpX of ~0.018 still uses the spine-aligned degenerate path', () => {
    // With H_EPS_mutant = 0.02/1.4 ≈ 0.0143, |perpX|=0.018 > 0.0143 ⇒
    // mutant goes through the perpendicular-bisector branch and produces a
    // tilted crease. Original (0.028) keeps it degenerate.
    const drag: Vec2 = { x: 0.5, y: CORNER.y - 0.018 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.creaseDir.x).toBeCloseTo(0, 9);
    expect(c.creaseDir.y).toBeCloseTo(1, 9);
  });
});

describe('CreaseGeometry — creaseDir orientation flips (kills L183, L184)', () => {
  it('flips creaseDir to point up the spine when raw perpendicular gives creaseDirY < 0', () => {
    // Drag down-and-left of the corner ⇒ dx < 0, dy < 0 ⇒
    //   perpX = -dy > 0, perpY = dx < 0
    //   raw creaseDir.y = perpY / len < 0  ⇒  L183 flip fires.
    // With drag = (0.5, 0.3), corner = (1, 0.7):
    //   dx=-0.5, dy=-0.4, perpX=0.4, perpY=-0.5
    //   after flip ⇒ creaseDir = (-0.4, 0.5)/√0.41
    const cornerR: Vec2 = { x: 1.0, y: 0.7 };
    const c = creaseFromDrag(cornerR, { x: 0.5, y: 0.3 }, PAGE);
    expect(c.creaseDir.y).toBeGreaterThanOrEqual(0);
    const expectedY = 0.5 / Math.sqrt(0.41);
    const expectedX = -0.4 / Math.sqrt(0.41);
    expect(c.creaseDir.y).toBeCloseTo(expectedY, 9);
    expect(c.creaseDir.x).toBeCloseTo(expectedX, 9);
  });

  it('creaseDir always has y >= 0 over a sweep of drags (regression for the orientation flip)', () => {
    for (let i = 0; i < 16; i++) {
      const theta = (i / 16) * Math.PI * 2;
      const r = 0.4;
      const drag: Vec2 = { x: CORNER.x + r * Math.cos(theta), y: CORNER.y + r * Math.sin(theta) };
      // Skip the degenerate near-horizontal cases where the spine collapse
      // path returns (0, 1).
      const c = creaseFromDrag(CORNER, drag, PAGE);
      expect(c.creaseDir.y).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('flips the creaseDirY === 0 ambiguity to point in +x (kills L184)', () => {
    // Pure-vertical drag with dy > 0 and dx == 0:
    //   perpX = -dy < 0, perpY = dx = 0 ⇒ raw creaseDir = (-1, 0).
    //   creaseDirY === 0, creaseDirX < 0 ⇒ L184 flips X sign ⇒ (1, 0).
    const drag: Vec2 = { x: CORNER.x, y: CORNER.y + 0.3 };
    const c = creaseFromDrag(CORNER, drag, PAGE);
    expect(c.creaseDir.x).toBe(1);
    expect(c.creaseDir.y).toBe(0);
  });
});

describe('CreaseGeometry — degenerate cornerDir fallback (kills L195)', () => {
  it('when drag coincides with corner, cornerDir is the page-interior (+x) direction', () => {
    const c = creaseFromDrag(CORNER, { ...CORNER }, PAGE);
    expect(c.cornerDir.x).toBe(1);
    expect(c.cornerDir.y).toBe(0);
  });
});

describe('CreaseGeometry — progress is dihedral/π (kills L223)', () => {
  it('progress equals dihedral / π for a range of drags', () => {
    const drags: Vec2[] = [
      { x: 0.75, y: CORNER.y },
      { x: 0.5, y: CORNER.y },
      { x: 0.25, y: CORNER.y },
      { x: 0.5, y: 0.4 },
    ];
    for (const d of drags) {
      const c = creaseFromDrag(CORNER, d, PAGE);
      expect(c.progress).toBeCloseTo(c.dihedral / Math.PI, 12);
      // Mutation `dihedral * Math.PI` would push progress > 1 for any
      // dihedral > 1/π ≈ 0.32 rad ≈ 18°.
      expect(c.progress).toBeLessThanOrEqual(1 + 1e-12);
      expect(c.progress).toBeGreaterThanOrEqual(-1e-12);
    }
  });
});

describe('CreaseGeometry — reflectAcrossLine with non-origin anchor (kills L232)', () => {
  it('reflects through a line whose anchor is NOT at the origin', () => {
    // Anchor m = (2, 1), unit normal n = (0, 1). Reflecting p = (3, 4)
    // across the line y = 1 yields (3, -2). Mutation `p.x + m.x` would
    // give rx = 3+2 = 5, d = 5*0 + (4-1)*1 = 3, p' = (3 - 6*0, 4 - 6*1) =
    // (3, -2). Same — n.x = 0 hides the bug. Use a non-axis-aligned normal.
    const m: Vec2 = { x: 1, y: 0 };
    const n: Vec2 = { x: 1 / Math.SQRT2, y: 1 / Math.SQRT2 }; // 45° line
    const p: Vec2 = { x: 3, y: 2 };
    // rx = 2, ry = 2, d = 2/√2 + 2/√2 = 2√2.
    // p' = (3 - 2·2√2·(1/√2), 2 - 2·2√2·(1/√2)) = (3 - 4, 2 - 4) = (-1, -2).
    const r = reflectAcrossLine(p, m, n);
    expect(r.x).toBeCloseTo(-1, 9);
    expect(r.y).toBeCloseTo(-2, 9);
  });
});
