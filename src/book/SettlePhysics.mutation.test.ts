/**
 * SettlePhysics.mutation.test.ts — targeted tests added in the 2026-05-14
 * mutation-test audit. Each `it` is annotated with the mutant it was
 * written to kill (file:line:mutator).
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AERO_PARAMS,
  entry,
  step,
  isConverged,
  aerodynamicSettleEnabled,
} from './SettlePhysics';

const PI = Math.PI;

describe('SettlePhysics — phi acceleration is G·sin(phi), not G/sin(phi) (kills L110)', () => {
  it('first-step phiDot matches dir·G·sin(phi)·dt analytically', () => {
    // Use a very small dt so the linear approximation is tight, and a phi
    // where sin and 1/sin differ by more than 4×.
    const phi0 = PI / 6;             // sin = 0.5, 1/sin = 2
    const dt = 1e-4;
    const s0 = entry(phi0, 0);
    const s1 = step(s0, 1, dt);
    // phiAcc = G·sin(phi) (correct) ⇒ phiDot ≈ 5 · 0.5 · 1e-4 = 2.5e-4.
    // phiAcc = G/sin(phi)            ⇒ phiDot ≈ 5 / 0.5 · 1e-4 = 1.0e-3 (4× larger).
    const expected = DEFAULT_AERO_PARAMS.G * Math.sin(phi0) * dt;
    expect(s1.phiDot).toBeCloseTo(expected, 8);
  });
});

describe('SettlePhysics — b natural frequency is ω² (kills L114)', () => {
  it('b restoring acceleration at b = b0 + δ is −ω²·δ, not −δ', () => {
    const delta = 0.1;
    const s0 = entry(0, 0);
    s0.b = DEFAULT_AERO_PARAMS.b0 + delta;
    s0.bDot = 0;
    const dt = 1e-4;
    const s1 = step(s0, 1, dt);
    // bAcc = ω²·(b0 − b) − Db·bDot + κ·phiDot² = -ω²·δ (since bDot=phiDot=0).
    const omega = DEFAULT_AERO_PARAMS.omega;
    const expectedBDot = -omega * omega * delta * dt;
    expect(s1.bDot).toBeCloseTo(expectedBDot, 8);
  });
});

describe('SettlePhysics — phi clamp guards (kills L130, L131)', () => {
  it('phi clamped to 0 also zeros negative phiDot (no perpetual escape)', () => {
    // Spawn a state that the integrator will push past phi = 0 in one step.
    // Strong negative initial phiDot, dir = -1 to maintain pressure.
    let s = entry(0.05, -2.0);
    s = step(s, -1, 0.1);
    expect(s.phi).toBe(0);
    expect(s.phiDot).toBe(0);
    // Subsequent steps: phi stays at 0, phiDot stays at 0 — no negative
    // velocity leaks through.
    s = step(s, -1, 0.1);
    expect(s.phi).toBe(0);
    expect(s.phiDot).toBe(0);
  });

  it('phi clamped to π also zeros positive phiDot (no escape past the wall)', () => {
    let s = entry(PI - 0.01, 5.0);
    s = step(s, 1, 0.1);
    expect(s.phi).toBe(PI);
    expect(s.phiDot).toBe(0);
    s = step(s, 1, 0.1);
    expect(s.phi).toBe(PI);
    // After the clamp, any residual gravity at phi=π is sin(π)≈0, so phiDot
    // stays at zero too.
    expect(Math.abs(s.phiDot)).toBeLessThan(1e-9);
  });
});

describe('SettlePhysics — b clamp guards (kills L134, L135)', () => {
  it('b clamped to bMax also zeros positive bDot (kills the inner phiDot guard)', () => {
    const s0 = entry(0, 0);
    s0.b = DEFAULT_AERO_PARAMS.bMax - 0.01;
    s0.bDot = 50; // unphysical initial bDot, will push b past bMax in one step
    const s1 = step(s0, 1, 1 / 60);
    expect(s1.b).toBe(DEFAULT_AERO_PARAMS.bMax);
    expect(s1.bDot).toBe(0);
  });

  it('b clamped to 0 also zeros negative bDot', () => {
    const s0 = entry(0, 0);
    s0.b = 0.01;
    s0.bDot = -50;
    const s1 = step(s0, 1, 1 / 60);
    expect(s1.b).toBe(0);
    expect(s1.bDot).toBe(0);
  });
});

describe('SettlePhysics — inner-clamp guards only fire on the wrong-sign velocity (kills L130/131/134/135 inner ConditionalExpression true)', () => {
  // When `step()` receives an out-of-domain `state.phi` (off-spec but
  // possible if caller is buggy), the outer clamp still triggers — but the
  // inner `if (phiDot < 0)` should ONLY zero phiDot when phiDot is actually
  // pointed into the wall. The mutants "if (true)" would zero phiDot
  // unconditionally; these tests catch that by feeding a wrong-side phi
  // with phiDot pointed away from the wall.

  it('phi already past 0 with positive phiDot — clamp keeps the positive phiDot', () => {
    // state.phi = -0.5 (below domain), phiDot = +0.1 (pointing back into
    // the domain). After one step, new phi is still < 0 ⇒ outer clamp
    // triggers ⇒ phi = 0. Inner `if (phiDot < 0)` is false (phiDot ~+0.05),
    // so phiDot is preserved.
    const s = step({ phi: -0.5, phiDot: 0.1, b: 0.4, bDot: 0 }, 1, 1 / 60);
    expect(s.phi).toBe(0);
    expect(s.phiDot).toBeGreaterThan(0);
  });

  it('phi already past π with negative phiDot — clamp keeps the negative phiDot', () => {
    const s = step({ phi: PI + 0.5, phiDot: -0.1, b: 0.4, bDot: 0 }, -1, 1 / 60);
    expect(s.phi).toBe(PI);
    expect(s.phiDot).toBeLessThan(0);
  });

  it('b already past bMax with negative bDot — clamp keeps the negative bDot', () => {
    const s = step(
      { phi: 0, phiDot: 0, b: DEFAULT_AERO_PARAMS.bMax + 0.05, bDot: -0.01 },
      1,
      1 / 60,
    );
    expect(s.b).toBe(DEFAULT_AERO_PARAMS.bMax);
    // bDot has been changed by bAcc·dt but should retain its negative sign:
    // the inner `if (bDot > 0)` clause must NOT fire.
    expect(s.bDot).toBeLessThan(0);
  });

  it('b already below 0 with positive bDot — clamp keeps the positive bDot', () => {
    // Force a configuration that stays below 0 after one step.
    const s = step(
      { phi: 0, phiDot: 0, b: -0.5, bDot: 0.01 },
      1,
      1 / 60,
    );
    expect(s.b).toBe(0);
    // bAcc = ω²·(b0 - b) ≈ 144·0.9 = 129.6 → bDot increases. Sign stays +.
    expect(s.bDot).toBeGreaterThan(0);
  });
});

describe('SettlePhysics — isConverged returns false away from target (defensive)', () => {
  it('mid-fold state with zero velocity is NOT converged for either dir', () => {
    // Marginal coverage for the energy / target plumbing in isConverged.
    const mid = entry(PI / 2, 0);
    expect(isConverged(mid, 1)).toBe(false);
    expect(isConverged(mid, -1)).toBe(false);
  });
});

describe('SettlePhysics — aerodynamicSettleEnabled URL parsing (kills L188, L190, L192)', () => {
  it('returns true when ?settle=aero is set, false otherwise', () => {
    const original = window.location.search;
    try {
      window.history.replaceState({}, '', '?settle=aero');
      expect(aerodynamicSettleEnabled()).toBe(true);
      window.history.replaceState({}, '', '?settle=rigid');
      expect(aerodynamicSettleEnabled()).toBe(false);
      window.history.replaceState({}, '', '?other=1');
      expect(aerodynamicSettleEnabled()).toBe(false);
      window.history.replaceState({}, '', '');
      expect(aerodynamicSettleEnabled()).toBe(false);
    } finally {
      window.history.replaceState({}, '', original);
    }
  });
});
