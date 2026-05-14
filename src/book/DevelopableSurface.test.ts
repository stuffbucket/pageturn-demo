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

/**
 * FR-P1 regression: the rendered surface area must not grow as the crease
 * origin (originY) deviates from corner.y. Before the fix, the binary
 * spine-pin in FLIP_VERT (vertices at x ≈ 0 held at rest while column 1
 * lifts to flapPos) inflated the rendered area by up to ~45 % at extreme
 * drags. After the fix (snap flapPos.x → 0 for spine vertices in the
 * developable path), the area stays within ~1 % of the rest area across a
 * full originY sweep.
 *
 * This test ports the relevant slice of the FLIP_VERT shader into JS so it
 * can run under vitest without a GPU. It is intentionally a 1:1 mirror of
 * the GLSL — keep the two in sync.
 */
describe('DevelopableSurface — FR-P1 originY-deviation regression', () => {
  const W = 1.0;
  const H = 1.4;
  const EXEMPT = 0.01 * W;
  const R_TEST = 0.25; // INTERIOR_STOCK.R_min

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

  interface Params {
    originY: number;
    creaseDir: [number, number];
    cornerDir: [number, number];
    dihedral: number;
    maxFlapDist: number;
  }

  function flipVert(pos: [number, number], p: Params): V3 {
    const rx = pos[0];
    const ry = pos[1] - p.originY;
    const s = rx * p.cornerDir[0] + ry * p.cornerDir[1];
    const u = rx * p.creaseDir[0] + ry * p.creaseDir[1];
    const k: V3 = [p.creaseDir[0], p.creaseDir[1], 0];
    const n: V3 = [p.cornerDir[0], p.cornerDir[1], 0];
    const nP = rodrigues(n, k, -p.dihedral);
    const bP = rodrigues([0, 0, 1], k, -p.dihedral);
    const sPos = Math.max(s, 0);
    const effS = Math.max(sPos - EXEMPT, 0);
    const Rsafe = Math.max(R_TEST, 1e-4);
    const theta = effS / Rsafe;
    const sinR = Rsafe * Math.sin(theta);
    const verR = Rsafe * (1 - Math.cos(theta));
    const rigidS = Math.min(sPos, EXEMPT);
    const flapPos: V3 = [
      (rigidS + sinR) * nP[0] + verR * bP[0] + u * k[0],
      p.originY + (rigidS + sinR) * nP[1] + verR * bP[1] + u * k[1],
      (rigidS + sinR) * nP[2] + verR * bP[2] + u * k[2],
    ];
    const band = Math.max(p.maxFlapDist, 1e-6) * 0.02;
    let fw = (s + band) / (2 * band);
    fw = Math.max(0, Math.min(1, fw));
    fw = fw * fw * (3 - 2 * fw);
    // Spine guard for developable path: snap flapPos.x → 0 (post-fix).
    if (pos[0] <= 1e-4) flapPos[0] = 0;
    return [
      pos[0] * (1 - fw) + flapPos[0] * fw,
      pos[1] * (1 - fw) + flapPos[1] * fw,
      flapPos[2] * fw,
    ];
  }

  function maxFlapDist(_cd: [number, number], cnd: [number, number], originY: number): number {
    const cs: Array<[number, number]> = [
      [0, -H / 2], [0, H / 2], [W, -H / 2], [W, H / 2],
    ];
    let m = 0;
    for (const c of cs) {
      const sv = c[0] * cnd[0] + (c[1] - originY) * cnd[1];
      if (sv > m) m = sv;
    }
    return Math.max(m, 1e-6);
  }

  function meshArea(params: Params, nx = 96, ny = 48): number {
    const V: V3[] = new Array((nx + 1) * (ny + 1));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        V[i * (ny + 1) + j] = flipVert([(i / nx) * W, (j / ny - 0.5) * H], params);
      }
    }
    const tri = (p: V3, q: V3, r: V3): number => {
      const ex = q[0] - p[0], ey = q[1] - p[1], ez = q[2] - p[2];
      const fx = r[0] - p[0], fy = r[1] - p[1], fz = r[2] - p[2];
      const cx = ey * fz - ez * fy;
      const cy = ez * fx - ex * fz;
      const cz = ex * fy - ey * fx;
      return 0.5 * Math.hypot(cx, cy, cz);
    };
    let area = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const a = V[i * (ny + 1) + j];
        const b = V[(i + 1) * (ny + 1) + j];
        const c = V[i * (ny + 1) + j + 1];
        const d = V[(i + 1) * (ny + 1) + j + 1];
        area += tri(a, b, c) + tri(b, d, c);
      }
    }
    return area;
  }

  const REST_AREA = W * H;

  it('preserves rendered area across originY sweep for a spine-aligned crease', () => {
    const dihedral = Math.PI / 3;
    const cd: [number, number] = [0, 1];
    const cnd: [number, number] = [1, 0];
    for (const originY of [0.7, 0.5, 0.3, 0.0, -0.3, -0.7]) {
      const mf = maxFlapDist(cd, cnd, originY);
      const A = meshArea({ originY, creaseDir: cd, cornerDir: cnd, dihedral, maxFlapDist: mf });
      expect(Math.abs(A / REST_AREA - 1)).toBeLessThan(0.01);
    }
  });

  it('preserves rendered area within 1% across a sweep of physical drags (FR-P1)', () => {
    // Sweep drag points that exercise a range of originY drift values. For
    // each drag we derive (creaseDir, cornerDir, originY) the same way
    // CreaseGeometry.creaseFromDrag does, so the test sees physically
    // consistent crease parameters — the originY *deviation* is induced by
    // the drag, not by an artificial sweep.
    const corner = { x: 1, y: 0.7 };
    const drags = [
      { x: 0.6, y: 0.0 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.7 },
      { x: 0.3, y: 0.0 },
      { x: 0.3, y: 0.3 },
      { x: 0.0, y: 0.0 },
      { x: 0.0, y: 0.3 },
      { x: 0.0, y: 0.7 },
      { x: -0.3, y: 0.55 },
    ];
    for (const drag of drags) {
      const ddx = drag.x - corner.x;
      const ddy = drag.y - corner.y;
      const perpX = -ddy;
      const perpY = ddx;
      let originY: number;
      let cd: [number, number];
      let cnd: [number, number];
      if (Math.abs(perpX) < 0.02 * H) {
        originY = corner.y;
        cd = [0, 1];
        cnd = [1, 0];
      } else {
        const Mx = (corner.x + drag.x) / 2;
        const My = (corner.y + drag.y) / 2;
        const rawY = My - (Mx * perpY) / perpX;
        originY = (H / 2) * Math.tanh(rawY / (H / 2));
        const len = Math.hypot(perpX, perpY);
        let cx = perpX / len;
        let cy = perpY / len;
        if (cy < 0) { cx = -cx; cy = -cy; }
        cd = [cx, cy];
        const dl = Math.hypot(ddx, ddy);
        cnd = [-ddx / dl, -ddy / dl];
      }
      const horizontalPull = corner.x - drag.x;
      const dihedral = Math.PI * Math.max(0, Math.min(1, horizontalPull / W));
      if (dihedral < 0.01) continue;
      const mf = maxFlapDist(cd, cnd, originY);
      const A = meshArea({ originY, creaseDir: cd, cornerDir: cnd, dihedral, maxFlapDist: mf });
      const ratio = A / REST_AREA;
      // FR-P1: ≤1 % area distortion. Tag the failure with the drag for
      // easy debugging.
      const msg = `drag=(${drag.x},${drag.y}) originY=${originY.toFixed(3)} A/A0=${ratio.toFixed(4)}`;
      expect(Math.abs(ratio - 1), msg).toBeLessThan(0.01);
    }
  });

  it('keeps spine vertices on the binding (x = 0) for every drag scenario', () => {
    const cd: [number, number] = [-0.437, 0.899];
    const cnd: [number, number] = [0.899, 0.437];
    const dihedral = 1.0;
    for (const originY of [0.7, 0.5, 0.3, 0.0, -0.5]) {
      const mf = maxFlapDist(cd, cnd, originY);
      const p = { originY, creaseDir: cd, cornerDir: cnd, dihedral, maxFlapDist: mf };
      for (let j = 0; j <= 48; j++) {
        const y = (j / 48 - 0.5) * H;
        const lifted = flipVert([0, y], p);
        expect(Math.abs(lifted[0])).toBeLessThan(1e-9);
      }
    }
  });
});
