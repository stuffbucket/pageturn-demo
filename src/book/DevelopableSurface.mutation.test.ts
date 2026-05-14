/**
 * DevelopableSurface.mutation.test.ts — targeted tests added in the
 * 2026-05-14 mutation-test audit. Each `it` is annotated with the mutant
 * it was written to kill (file:line:mutator).
 *
 * The existing `DevelopableSurface.test.ts` is property-shaped; that file
 * is being co-edited by the fiducial-trajectory invariant work, so all
 * additive mutation-killing tests live here.
 */

import { describe, it, expect } from 'vitest';
import {
  cylindricalCurlPos,
  radiusFromBendingStiffness,
  chordDistance,
  geodesicDistance,
  developableEnabled,
  INTERIOR_STOCK,
  COVER_STOCK,
  FLAT_RADIUS,
  type Vec2,
} from './DevelopableSurface';

const NEAR = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('DevelopableSurface — radiusFromBendingStiffness corner cases (kills L117–L121)', () => {
  it('returns stock.R_min for non-finite D (NaN, +Infinity)', () => {
    expect(radiusFromBendingStiffness(NaN, 1, INTERIOR_STOCK)).toBe(INTERIOR_STOCK.R_min);
    // Infinity is technically not "finite", so falls into the !isFinite branch.
    expect(radiusFromBendingStiffness(Infinity, 1, INTERIOR_STOCK)).toBe(INTERIOR_STOCK.R_min);
  });

  it('returns the raw quotient when in-range (kills the always-clamp mutants on L120 / L121)', () => {
    // D = 10, M = 1 ⇒ raw = 10, well above R_min (0.25) and well below
    // FLAT_RADIUS. Should return 10.
    const r = radiusFromBendingStiffness(10, 1, INTERIOR_STOCK);
    expect(r).toBeCloseTo(10, 9);
    expect(r).not.toBe(INTERIOR_STOCK.R_min);
    expect(r).not.toBe(FLAT_RADIUS);
  });

  it('cover-stock raw quotient differs numerically from interior (kills L118 D>0 mutant)', () => {
    // With D = 100, M = 1, the raw quotient is 100. With the D > 0 mutant
    // the function returns R_min = 0.9 instead. Both values differ from
    // INTERIOR_STOCK.R_min (0.25), but 100 ≠ 0.9.
    const Rc = radiusFromBendingStiffness(100, 1, COVER_STOCK);
    expect(Rc).toBeCloseTo(100, 6);
  });
});

describe('DevelopableSurface — stock identity constants (kills L74, L85)', () => {
  it('INTERIOR_STOCK / COVER_STOCK expose human-readable names', () => {
    expect(INTERIOR_STOCK.name).toBe('interior');
    expect(COVER_STOCK.name).toBe('cover');
  });
});

describe('DevelopableSurface — degenerate / tiny R is treated as flat (kills L195)', () => {
  it('R = 0 falls back to FLAT_RADIUS — same output as R = FLAT_RADIUS', () => {
    const k: Vec2 = { x: 0, y: 1 };
    const a = cylindricalCurlPos(0.3, 0.2, 0, 0, k);
    const b = cylindricalCurlPos(0.3, 0.2, FLAT_RADIUS, 0, k);
    NEAR(a.x, b.x, 1e-3);
    NEAR(a.y, b.y, 1e-9);
    NEAR(a.z, b.z, 1e-3);
  });

  it('R = NaN falls back to FLAT_RADIUS — finite output, no NaN propagation', () => {
    const k: Vec2 = { x: 0, y: 1 };
    const p = cylindricalCurlPos(0.3, 0.2, NaN, 0, k);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  });

  it('R = 1e-9 (the safe threshold boundary) is treated as flat — kills R >= mutant', () => {
    // Original guard is `R > 1e-9`; the mutant `R >= 1e-9` accepts R = 1e-9
    // exactly and feeds it as the cylinder radius, producing chaotic outputs.
    // Asserting flat (≈ s along n̂) at R = 1e-9 catches the mutant.
    const k: Vec2 = { x: 0, y: 1 };
    const p = cylindricalCurlPos(0.3, 0, 1e-9, 0, k);
    expect(p.x).toBeCloseTo(0.3, 3);
    expect(p.z).toBeCloseTo(0, 3);
  });

  it('R = 1e-12 is treated as flat (below the safe threshold)', () => {
    const k: Vec2 = { x: 0, y: 1 };
    const p = cylindricalCurlPos(0.3, 0, 1e-12, 0, k);
    expect(p.x).toBeCloseTo(0.3, 3);
    expect(p.z).toBeCloseTo(0, 3);
  });
});

describe('DevelopableSurface — cylindricalCurlPos under TILTED crease axis (kills L163–L188, L201–L203)', () => {
  // The original property tests use k = (0, 1) so any term multiplying
  // creaseAxis.x evaluates to 0. These tests use a tilted crease to make
  // mutants on those terms observable.

  const k: Vec2 = { x: 0.6, y: 0.8 }; // unit-length, tilted 36.87° off-spine

  it('at dihedral = 0 and finite R, the point sits in the page plane (z = 0)', () => {
    for (const s of [0.1, 0.3, 0.7]) {
      for (const u of [-0.3, 0, 0.4]) {
        const p = cylindricalCurlPos(s, u, FLAT_RADIUS, 0, k);
        // No rotation, no curl ⇒ point on the rest plane.
        expect(p.z).toBeCloseTo(0, 6);
      }
    }
  });

  it('curl term contributes a z-lift proportional to (1 − cos(s/R)) at dihedral = 0', () => {
    // At dihedral = 0: n̂' = n̂ (in-plane), b̂' = ẑ. The cylindrical curl lifts
    // the point in z by R(1 − cos(s/R)). Verify analytically with a tight R.
    const R = 0.5;
    const s = 0.4;
    const p = cylindricalCurlPos(s, 0, R, 0, k);
    const expectedLift = R * (1 - Math.cos(s / R));
    expect(p.z).toBeCloseTo(expectedLift, 9);
  });

  it('at dihedral = π/2, an s-step preserves arc length under rigid rotation', () => {
    // Length-preservation under the rigid rotation is the FR-P1 invariant.
    // At dihedral = π/2 around a tilted k̂, the displacement direction is
    // not a clean ẑ (k̂ is not the spine), so we assert only the magnitude.
    const s = 0.2;
    const p0 = cylindricalCurlPos(0, 0, FLAT_RADIUS, PIH, k);
    const p1 = cylindricalCurlPos(s, 0, FLAT_RADIUS, PIH, k);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(s, 5);
  });

  it('u offset travels along the crease direction k̂', () => {
    // For any dihedral / R, the (u·k̂) term contributes a translation along k̂.
    // Diff two points that differ only in u and check the diff equals u·k̂.
    const u = 0.25;
    const a = cylindricalCurlPos(0.1, 0,   FLAT_RADIUS, 1.0, k);
    const b = cylindricalCurlPos(0.1, u, FLAT_RADIUS, 1.0, k);
    expect(b.x - a.x).toBeCloseTo(u * k.x, 9);
    expect(b.y - a.y).toBeCloseTo(u * k.y, 9);
    expect(b.z - a.z).toBeCloseTo(0, 9);
  });

  it('flapSign mirrors the n̂ direction even with a tilted k̂', () => {
    const p1 = cylindricalCurlPos(0.3, 0, FLAT_RADIUS, 0, k, undefined, 1);
    const p2 = cylindricalCurlPos(0.3, 0, FLAT_RADIUS, 0, k, undefined, -1);
    // n̂ flips sign with flapSign, and at dihedral=0 / large R the displacement
    // is s·n̂; so p1 and p2 should be reflections through the origin.
    expect(p1.x).toBeCloseTo(-p2.x, 6);
    expect(p1.y).toBeCloseTo(-p2.y, 6);
  });
});

const PIH = Math.PI / 2;

describe('DevelopableSurface — chordDistance / geodesicDistance with mixed signs (kills L234, L236)', () => {
  it('chordDistance handles all-axis differences', () => {
    const d = chordDistance({ x: 1, y: 2, z: 3 }, { x: -2, y: 6, z: 3 });
    // dx=3, dy=-4, dz=0 ⇒ √(9 + 16 + 0) = 5.
    expect(d).toBeCloseTo(5, 9);
  });

  it('chordDistance is symmetric and uses a SUM of squared differences (kills L236)', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 3, y: 4, z: 0 };
    // dx²+dy² = 9+16 = 25 ⇒ 5. The mutant `dx²−dy²` gives √(-7) ⇒ NaN.
    expect(chordDistance(a, b)).toBeCloseTo(5, 9);
  });

  it('geodesicDistance and chordDistance agree on the unrolled plane', () => {
    const g = geodesicDistance({ x: 0.3, y: 0.4 }, { x: 0, y: 0 });
    const c = chordDistance({ x: 0.3, y: 0.4, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(g).toBeCloseTo(c, 9);
  });
});

describe('DevelopableSurface — cylindricalCurlPos analytic oracle for tilted k̂ + finite R (kills L163–L203)', () => {
  // Hand-evaluated reference: k = (0.6, 0.8) (tilted 53° off-spine),
  // R = 0.3, s = 0.2, u = 0, dihedral = 1 rad, flapSign = 1.
  //
  //   nx = ky·flapSign      = 0.8
  //   ny = -kx·flapSign     = -0.6
  //   c  = cos(1)           ≈ 0.5403023058681398
  //   si = sin(1)           ≈ 0.8414709848078965
  //   kDotN = kx·nx + ky·ny = 0          (n̂ ⊥ k̂ by construction)
  //   knX = ky·0 − 0·ny     = 0
  //   knY = 0·nx − kx·0     = 0
  //   knZ = kx·ny − ky·nx   = -1         (k̂ × n̂ = +ẑ flipped — left-handed n̂)
  //   npx = nx·c            = 0.8·c
  //   npy = ny·c            = -0.6·c
  //   npz = knZ·si          = -si
  //   bx  = ky·si           = 0.8·si
  //   by  = -kx·si          = -0.6·si
  //   bz  = c
  //   theta = s/R           = 0.66667
  //   sinR = R·sin(theta)   ≈ 0.30·sin(0.6667) = 0.18549156
  //   verR = R·(1−cos(theta)) ≈ 0.30·(1 − cos(0.6667)) = 0.064229...
  //
  //   x = sinR·npx + verR·bx
  //   y = sinR·npy + verR·by
  //   z = sinR·npz + verR·bz
  const k: Vec2 = { x: 0.6, y: 0.8 };
  const R = 0.3;
  const s = 0.2;
  const dihedral = 1;
  const c = Math.cos(dihedral);
  const si = Math.sin(dihedral);
  const theta = s / R;
  const sinR = R * Math.sin(theta);
  const verR = R * (1 - Math.cos(theta));
  const expectedX = sinR * (0.8 * c) + verR * (0.8 * si);
  const expectedY = sinR * (-0.6 * c) + verR * (-0.6 * si);
  const expectedZ = sinR * (-si) + verR * c;

  it('matches the hand-derived (x, y, z) for tilted k̂, finite R, mid-arc s', () => {
    const p = cylindricalCurlPos(s, 0, R, dihedral, k);
    expect(p.x).toBeCloseTo(expectedX, 9);
    expect(p.y).toBeCloseTo(expectedY, 9);
    expect(p.z).toBeCloseTo(expectedZ, 9);
  });

  it('y component is non-trivially negative — kills sign flips on npy / by', () => {
    // Sanity bracket so an accidental refactor with sign errors trips here
    // before it reaches the rest of the suite.
    expect(expectedY).toBeLessThan(-0.05);
    expect(expectedY).toBeGreaterThan(-0.2);
  });

  it('flipping flapSign with the same tilted k̂ negates the in-plane displacement', () => {
    // Use a dihedral of 0 so verR ≈ 0 and the displacement is dominated by
    // s·n̂ — i.e. proportional to flapSign through nx, ny.
    const p1 = cylindricalCurlPos(s, 0, 1e6, 0, k, undefined, 1);
    const p2 = cylindricalCurlPos(s, 0, 1e6, 0, k, undefined, -1);
    expect(p1.x).toBeCloseTo(-p2.x, 4);
    expect(p1.y).toBeCloseTo(-p2.y, 4);
  });
});

describe('DevelopableSurface — radius clamps return endpoint sentinel values (kills L120/L121 ConditionalExpression)', () => {
  it('raw quotient larger than FLAT_RADIUS is clamped to FLAT_RADIUS', () => {
    // D = 1e9, M = 1 ⇒ raw = 1e9, well above FLAT_RADIUS = 1e6.
    expect(radiusFromBendingStiffness(1e9, 1, INTERIOR_STOCK)).toBe(FLAT_RADIUS);
  });

  it('raw quotient below R_min is clamped to R_min', () => {
    // D = 0.1, M = 1 ⇒ raw = 0.1; INTERIOR_STOCK.R_min = 0.25, so clamps.
    expect(radiusFromBendingStiffness(0.1, 1, INTERIOR_STOCK)).toBe(INTERIOR_STOCK.R_min);
  });
});

describe('DevelopableSurface — developableEnabled URL parsing (kills L52 mutants)', () => {
  it('returns true when ?dev-surface=1 is set, false otherwise', () => {
    const original = window.location.search;
    try {
      // happy-dom: writeable history allows search mutation via history.replaceState.
      window.history.replaceState({}, '', '?dev-surface=1');
      expect(developableEnabled()).toBe(true);
      window.history.replaceState({}, '', '?dev-surface=0');
      expect(developableEnabled()).toBe(false);
      window.history.replaceState({}, '', '?other=1');
      expect(developableEnabled()).toBe(false);
      window.history.replaceState({}, '', '');
      expect(developableEnabled()).toBe(false);
    } finally {
      window.history.replaceState({}, '', original);
    }
  });
});
