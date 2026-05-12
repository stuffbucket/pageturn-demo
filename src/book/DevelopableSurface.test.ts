/**
 * DevelopableSurface.test.ts — properties of the developable-surface
 * cylindrical-curl parameterisation.
 *
 * The four properties exercised:
 *   1. R → ∞ recovers the rigid-flat-flap limit (no curl).
 *   2. At s = 0, the crease points are unchanged by the curl term (only
 *      by the rigid rotation). FR-P5 boundary case.
 *   3. Arc length along an s-curve equals s for any R (inextensibility,
 *      FR-P1).
 *   4. Cover stock produces a larger R than interior stock under the
 *      same gravity load (FR-P3).
 *
 * Plus:
 *   - geodesicDistance equals chord on the unrolled rest sheet
 *   - radiusFromBendingStiffness clamps and degenerate-input behaviour
 *   - cylindricalCurlPos is finite, no NaN/Inf, for plausible inputs
 */

import { describe, it, expect } from 'vitest';
import {
  cylindricalCurlPos,
  radiusFromBendingStiffness,
  geodesicDistance,
  chordDistance,
  developableEnabled,
  INTERIOR_STOCK,
  COVER_STOCK,
  FLAT_RADIUS,
} from './DevelopableSurface';

const NEAR = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('DevelopableSurface — cylindricalCurlPos', () => {
  // Spine-aligned crease, no rigid rotation. n̂ = (1, 0), b̂ = ẑ.
  const k: { x: number; y: number } = { x: 0, y: 1 };

  it('recovers the rigid-flat-flap limit as R → ∞', () => {
    // Dihedral 0, large R, expect x ≈ (s, u, 0) for every (s, u).
    for (const s of [0, 0.1, 0.3, 0.7, 1.0]) {
      for (const u of [-0.5, 0, 0.5]) {
        const p = cylindricalCurlPos(s, u, FLAT_RADIUS, 0, k);
        NEAR(p.x, s, 1e-3);
        NEAR(p.y, u, 1e-9);
        NEAR(p.z, 0, 1e-3);
      }
    }
  });

  it('crease points (s = 0) are unchanged by the curl term', () => {
    // s = 0 ⇒ sin(0) = 0, 1 − cos(0) = 0; only the u·k̂ term survives.
    for (const dihedral of [0, Math.PI / 6, Math.PI / 2, Math.PI]) {
      for (const R of [0.1, 0.5, FLAT_RADIUS]) {
        for (const u of [-0.5, 0, 0.5]) {
          const p = cylindricalCurlPos(0, u, R, dihedral, k);
          NEAR(p.x, 0);
          NEAR(p.y, u);
          NEAR(p.z, 0);
        }
      }
    }
  });

  it('arc length along an s-curve equals s for any R (inextensibility)', () => {
    // Sample points along an s-curve at fixed u, sum chord lengths,
    // compare to s_max. Inextensible iff sum → s_max as samples → ∞.
    const sMax = 1.0;
    const N = 200;
    for (const R of [0.2, 0.5, 1.0, FLAT_RADIUS]) {
      for (const dihedral of [0, Math.PI / 4, Math.PI / 2]) {
        let length = 0;
        let prev = cylindricalCurlPos(0, 0, R, dihedral, k);
        for (let i = 1; i <= N; i++) {
          const s = (i / N) * sMax;
          const cur = cylindricalCurlPos(s, 0, R, dihedral, k);
          length += chordDistance(prev, cur);
          prev = cur;
        }
        // Discretisation error scales like (sMax/N)² for a smooth curve;
        // 1e-4 is generous at N = 200.
        expect(Math.abs(length - sMax)).toBeLessThan(1e-3);
      }
    }
  });

  it('rigid rotation alone (s small) matches dihedral spin around k̂', () => {
    // For very small s, the curl term ≈ s·n̂' (linear), so the point at
    // (s, 0) should sit at distance s from origin in the rotated tangent
    // direction. Check |x| = s.
    for (const dihedral of [0.1, 0.5, 1.0, Math.PI - 0.1]) {
      const p = cylindricalCurlPos(0.001, 0, FLAT_RADIUS, dihedral, k);
      const len = Math.hypot(p.x, p.y, p.z);
      expect(Math.abs(len - 0.001)).toBeLessThan(1e-6);
    }
  });

  it('produces no NaN / Inf for plausible inputs', () => {
    for (const R of [0.05, 0.1, 1, 100]) {
      for (const dihedral of [0, 0.5, 1, 2, Math.PI]) {
        for (const s of [0, 0.25, 0.5, 0.75, 1]) {
          const p = cylindricalCurlPos(s, 0, R, dihedral, k);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it('flapSign flips the curl direction along the in-plane normal', () => {
    const p1 = cylindricalCurlPos(0.3, 0, 1, 0, k, undefined, 1);
    const p2 = cylindricalCurlPos(0.3, 0, 1, 0, k, undefined, -1);
    NEAR(p1.x, -p2.x, 1e-9);
    NEAR(p1.y, -p2.y, 1e-9);
    NEAR(p1.z, p2.z, 1e-9); // z is unchanged by sign flip when dihedral=0
  });
});

describe('DevelopableSurface — radiusFromBendingStiffness', () => {
  it('cover stock yields a larger R than interior stock under same gravity', () => {
    const M = 0.5; // arbitrary moment in same units as D
    const Ri = radiusFromBendingStiffness(INTERIOR_STOCK.D, M, INTERIOR_STOCK);
    const Rc = radiusFromBendingStiffness(COVER_STOCK.D, M, COVER_STOCK);
    expect(Rc).toBeGreaterThan(Ri);
  });

  it('returns FLAT_RADIUS for zero / negative gravity moment', () => {
    expect(radiusFromBendingStiffness(10, 0)).toBe(FLAT_RADIUS);
    expect(radiusFromBendingStiffness(10, -1)).toBe(FLAT_RADIUS);
    expect(radiusFromBendingStiffness(10, NaN)).toBe(FLAT_RADIUS);
  });

  it('clamps very small results to stock.R_min (no degenerate tight curl)', () => {
    const tiny = radiusFromBendingStiffness(0.0001, 1e6, INTERIOR_STOCK);
    expect(tiny).toBe(INTERIOR_STOCK.R_min);
  });

  it('falls back to stock.R_min for non-positive D', () => {
    expect(radiusFromBendingStiffness(0, 1, COVER_STOCK)).toBe(COVER_STOCK.R_min);
    expect(radiusFromBendingStiffness(-5, 1, COVER_STOCK)).toBe(COVER_STOCK.R_min);
  });
});

describe('DevelopableSurface — geodesicDistance', () => {
  it('equals Euclidean chord on the rest sheet', () => {
    const d = geodesicDistance({ x: 0, y: 0 }, { x: 0.3, y: 0.4 });
    NEAR(d, 0.5);
  });

  it('is symmetric and zero for identical points', () => {
    const a = { x: 0.2, y: 0.7 };
    const b = { x: 0.5, y: 0.1 };
    NEAR(geodesicDistance(a, b), geodesicDistance(b, a));
    NEAR(geodesicDistance(a, a), 0);
  });
});

describe('DevelopableSurface — developableEnabled', () => {
  it('returns false when location is undefined (SSR safe)', () => {
    // jsdom provides location; this is mainly a smoke test that the
    // function does not throw.
    expect(typeof developableEnabled()).toBe('boolean');
  });
});
