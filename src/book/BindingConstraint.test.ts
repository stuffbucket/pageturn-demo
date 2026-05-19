/**
 * BindingConstraint.test.ts — unit tests for the regime detector.
 *
 * These exercise the closed-form tangent condition derived in
 * `BindingConstraint.ts` and documented in `docs/prd-page-model.md`
 * (Bend-binding-tangent constraint section). The detector is currently a
 * pure analytic classifier — no renderer wiring — so the tests stay at
 * the math level.
 */

import { describe, it, expect } from 'vitest';
import {
  regimeDetect,
  criticalPhi,
  criticalRadius,
} from './BindingConstraint';

const W = 1;
const H = 1;

describe('BindingConstraint.regimeDetect', () => {
  it('returns free when crease is parallel to spine (θ = 0) regardless of R, φ', () => {
    const r = regimeDetect({ W, H, R: 10, anchorY: 0, theta: 0, phi: Math.PI / 2 });
    expect(r.regime).toBe('free');
    expect(r.migrated_anchor_y).toBe(0);
    expect(r.residual_phi).toBeCloseTo(Math.PI / 2);
  });

  it('regime I: low φ, small tilt, tight curl ⇒ free', () => {
    // R = 0.25 (interior stock), θ = 5°, φ = 0.2 rad, anchor mid-page.
    const r = regimeDetect({
      W, H,
      R: 0.25,
      anchorY: 0,
      theta: (5 * Math.PI) / 180,
      phi: 0.2,
    });
    expect(r.regime).toBe('free');
    expect(r.migrated_anchor_y).toBe(0);
    expect(r.tangentMargin).toBeLessThan(0);
  });

  it('regime II at top: tilt < 0, anchor below top, large R ⇒ tangent-top', () => {
    // sin θ < 0 means the bend's spine footprint moves toward +y, so the
    // top corner is reachable first.
    const r = regimeDetect({
      W, H,
      R: 2.0,                       // very loose curl (hand held high)
      anchorY: 0,
      theta: -Math.PI / 6,          // sin θ = -0.5
      phi: Math.PI / 2,             // peak sin φ = 1; reach = 2.0·1·0.5 = 1.0 > 0.5
    });
    expect(r.regime).toBe('tangent-top');
    expect(r.migrated_anchor_y).toBe(+H / 2);
    expect(r.tangentMargin).toBeGreaterThan(0);
  });

  it('regime II at bottom: tilt > 0, anchor above bottom, large R ⇒ tangent-bottom', () => {
    const r = regimeDetect({
      W, H,
      R: 2.0,
      anchorY: 0,
      theta: +Math.PI / 6,          // sin θ = +0.5
      phi: Math.PI / 2,
    });
    expect(r.regime).toBe('tangent-bottom');
    expect(r.migrated_anchor_y).toBe(-H / 2);
  });

  it('tight curl (small R) stays free even at peak sin φ', () => {
    const r = regimeDetect({
      W, H,
      R: 0.25,                      // interior stock, reach = 0.125 < 0.5
      anchorY: 0,
      theta: -Math.PI / 6,
      phi: Math.PI / 2,
    });
    expect(r.regime).toBe('free');
  });

  it('regime transitions: scanning φ across the threshold, regime jumps free → tangent-top exactly once', () => {
    // Pick (R, θ, anchorY) so that φ_crit ∈ (0, π/2) is well-defined.
    const R = 2.0;
    const theta = -Math.PI / 6;
    const anchorY = 0;
    const samples = 100;
    let transitions = 0;
    let prev: ReturnType<typeof regimeDetect> | null = null;
    for (let i = 0; i <= samples; i++) {
      const phi = (i / samples) * Math.PI;
      const r = regimeDetect({ W, H, R, anchorY, theta, phi });
      if (prev && prev.regime !== r.regime) transitions++;
      prev = r;
    }
    // Free → tangent-top → free across the [0, π] sweep (sin φ rises then falls).
    expect(transitions).toBe(2);
  });

  it('tangentMargin is continuous in φ (no NaN/Inf at the boundary)', () => {
    const R = 2.0;
    const theta = -Math.PI / 6;
    const anchorY = 0.05;
    const samples = 200;
    let prevMargin = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const phi = (i / samples) * Math.PI;
      const r = regimeDetect({ W, H, R, anchorY, theta, phi });
      expect(Number.isFinite(r.tangentMargin)).toBe(true);
      // Margin can rise then fall as φ sweeps; just assert no wild jumps.
      if (i > 0) {
        expect(Math.abs(r.tangentMargin - prevMargin)).toBeLessThan(0.1);
      }
      prevMargin = r.tangentMargin;
    }
  });

  it('off-center anchor near top reaches tangent-top sooner (smaller R needed)', () => {
    const theta = -Math.PI / 6;
    const Rc_centered = criticalRadius(theta, 0, H, 'top');
    const Rc_nearTop = criticalRadius(theta, 0.4, H, 'top');
    // anchorY closer to +H/2 ⇒ smaller distance ⇒ smaller R_c.
    expect(Rc_nearTop).toBeLessThan(Rc_centered);
  });
});

describe('BindingConstraint.criticalPhi', () => {
  it('returns NaN when R is below the critical radius', () => {
    const theta = -Math.PI / 6;
    const anchorY = 0;
    const Rc = criticalRadius(theta, anchorY, H, 'top');
    const phiNan = criticalPhi(Rc / 10, theta, anchorY, H, 'top');
    expect(Number.isNaN(phiNan)).toBe(true);
  });

  it('matches the closed-form sin φ_crit = dist / (R · |sinθ|)', () => {
    const theta = -Math.PI / 6;        // |sin θ| = 0.5
    const anchorY = 0;                 // dist = H/2 = 0.5
    const R = 2.0;                     // dist / (R·|sinθ|) = 0.5 / 1.0 = 0.5
    const phiCrit = criticalPhi(R, theta, anchorY, H, 'top');
    expect(Math.sin(phiCrit)).toBeCloseTo(0.5, 6);
  });

  it('hand-height analog: doubling R halves sin(φ_crit) (tangency reached at smaller φ)', () => {
    // The closed form sin φ_crit = dist / (R · |sinθ|) is inversely
    // proportional to R, so doubling R exactly halves sin φ_crit. This
    // directly confirms the user's "hand high above the book → larger R
    // → bend hits binding sooner."
    const theta = -Math.PI / 4;
    const anchorY = 0;
    const R = 2.0;
    const phiOld = criticalPhi(R, theta, anchorY, H, 'top');
    const phiNew = criticalPhi(2 * R, theta, anchorY, H, 'top');
    expect(Math.sin(phiNew)).toBeCloseTo(Math.sin(phiOld) / 2, 6);
    expect(phiNew).toBeLessThan(phiOld);
  });
});

describe('BindingConstraint.criticalRadius', () => {
  it('R_c = (H/2 − anchorY) / |sin θ| for top corner', () => {
    const theta = -Math.PI / 6;
    const anchorY = 0.1;
    const Rc = criticalRadius(theta, anchorY, H, 'top');
    expect(Rc).toBeCloseTo((H / 2 - anchorY) / 0.5, 9);
  });

  it('R_c → ∞ as θ → 0 (parallel crease never tangents)', () => {
    expect(criticalRadius(0, 0, H, 'top')).toBe(Infinity);
  });
});
