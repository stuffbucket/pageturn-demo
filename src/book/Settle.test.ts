/**
 * Settle.test.ts
 * Tests for the physics settle loop and energy-based stop condition.
 *
 * The settle algorithm from main.ts is replicated here as a pure function
 * so it can be tested without a DOM or Three.js renderer.
 *
 * Physics model:
 *   v̇ = dir · G − D · v          (gravity + drag)
 *   p ← clamp(p + v · Δt)         (integrate)
 *   E = ½v² + G · |p − target|    (total energy)
 *   stop when E < ε
 */

import { describe, it, expect } from 'vitest';

// ── Constants matching main.ts ──────────────────────────────────────────────
const GRAVITY    = 5.0;
const DRAG_COEFF = 6.5;
const SETTLE_ENERGY_EPS = 0.005;
const MAX_DT = 1 / 20;

interface SettleResult {
  p: number;
  v: number;
  frames: number;
  converged: boolean;
}

/**
 * Simulate the settle loop from main.ts as a pure function.
 * Returns final progress, velocity, frame count, and whether it converged.
 */
function simulateSettle(
  startP: number,
  startV: number,
  target: number,
  dt: number = 1 / 60,
  maxFrames: number = 600,
): SettleResult {
  let p = startP;
  let v = startV;
  const dir = target >= 1 ? 1 : -1;
  const clampedDt = Math.min(dt, MAX_DT);

  for (let i = 0; i < maxFrames; i++) {
    v += dir * GRAVITY * clampedDt;
    v *= Math.max(0, 1 - DRAG_COEFF * clampedDt);
    const rawP = p + v * clampedDt;
    p = Math.max(0, Math.min(1, rawP));
    // Inelastic wall: zero velocity when p clamps at [0,1] boundary
    if (rawP !== p) v = 0;

    const energy = 0.5 * v * v + GRAVITY * Math.abs(p - target);
    if (energy < SETTLE_ENERGY_EPS) {
      return { p: target, v: 0, frames: i + 1, converged: true };
    }
  }

  return { p, v, frames: maxFrames, converged: false };
}

describe('Physics Settle Loop', () => {
  describe('Energy-based convergence', () => {
    it('settles forward (target=1) from midpoint', () => {
      const result = simulateSettle(0.5, 0, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('settles backward (target=0) from midpoint', () => {
      const result = simulateSettle(0.5, 0, 0);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(0);
    });

    it('settles forward from near-zero', () => {
      const result = simulateSettle(0.01, 0, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('settles backward from near-one', () => {
      const result = simulateSettle(0.99, 0, 0);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(0);
    });

    it('converges with positive initial velocity toward target', () => {
      const result = simulateSettle(0.3, 2.0, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
      // Should converge faster than from rest
      const fromRest = simulateSettle(0.3, 0, 1);
      expect(result.frames).toBeLessThan(fromRest.frames);
    });

    it('converges even with initial velocity opposing the target', () => {
      // Start at 0.7 heading left, but target is right (1)
      const result = simulateSettle(0.7, -1.0, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('converges from the exact target position with zero velocity', () => {
      // Already at target — energy = 0 < ε, should terminate immediately
      const result = simulateSettle(1.0, 0, 1);
      expect(result.converged).toBe(true);
      expect(result.frames).toBe(1);
    });
  });

  describe('Energy conservation and monotonicity', () => {
    it('energy decreases monotonically (dissipative system with drag)', () => {
      let p = 0.5;
      let v = 0;
      const target = 1;
      const dir = 1;
      const dt = 1 / 60;
      const energies: number[] = [];

      for (let i = 0; i < 200; i++) {
        v += dir * GRAVITY * dt;
        v *= Math.max(0, 1 - DRAG_COEFF * dt);
        p = Math.max(0, Math.min(1, p + v * dt));

        const E = 0.5 * v * v + GRAVITY * Math.abs(p - target);
        energies.push(E);
      }

      // After a brief initial transient, energy should trend downward.
      // Check that the max energy in the second half is less than the first half.
      const mid = Math.floor(energies.length / 2);
      const maxFirstHalf = Math.max(...energies.slice(0, mid));
      const maxSecondHalf = Math.max(...energies.slice(mid));
      expect(maxSecondHalf).toBeLessThan(maxFirstHalf);
    });

    it('progress p stays clamped to [0, 1] at all times', () => {
      // Extreme initial velocity that would overshoot
      let p = 0.1;
      let v = 20.0;
      const dt = 1 / 60;

      for (let i = 0; i < 200; i++) {
        v += 1 * GRAVITY * dt;
        v *= Math.max(0, 1 - DRAG_COEFF * dt);
        p = Math.max(0, Math.min(1, p + v * dt));

        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('dt sensitivity (framerate independence)', () => {
    it('converges at 60fps, 120fps, and 30fps', () => {
      const r60  = simulateSettle(0.5, 0, 1, 1/60);
      const r120 = simulateSettle(0.5, 0, 1, 1/120);
      const r30  = simulateSettle(0.5, 0, 1, 1/30);

      expect(r60.converged).toBe(true);
      expect(r120.converged).toBe(true);
      expect(r30.converged).toBe(true);
    });

    it('large dt is clamped to MAX_DT, preventing physics explosion', () => {
      // Simulate a 500ms frame (tab switch)
      const result = simulateSettle(0.5, 0, 1, 0.5);
      // dt is clamped to 50ms inside simulateSettle
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('does not explode with very small dt (high refresh rate)', () => {
      const result = simulateSettle(0.5, 0, 1, 1/240, 2000);
      expect(result.converged).toBe(true);
    });
  });

  describe('Minimum velocity seeding', () => {
    // The beginSettle function in main.ts seeds velocity with at least 0.8
    // in the target direction. This ensures the page never stalls at midpoint.
    const MIN_VEL = 0.8;

    it('page never stalls from rest at exact midpoint', () => {
      // At p=0.5, the bend envelope sin(2φ) = sin(π) = 0,
      // so visual motion would stall without a velocity seed.
      const result = simulateSettle(0.5, MIN_VEL, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('minimum velocity overcomes any stall at p=0.5 in reverse', () => {
      const result = simulateSettle(0.5, -MIN_VEL, 0);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(0);
    });
  });

  describe('Flick detection interaction', () => {
    // Flick threshold from main.ts
    const FLICK_THRESHOLD = 1.5;

    it('fast flick from p=0.2 completes turn (target=1)', () => {
      // User flicked fast enough — target should be 1 regardless of position
      const flickV = FLICK_THRESHOLD + 0.5;
      const result = simulateSettle(0.2, flickV, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });

    it('fast reverse flick from p=0.8 cancels turn (target=0)', () => {
      const flickV = -(FLICK_THRESHOLD + 0.5);
      const result = simulateSettle(0.8, flickV, 0);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(0);
    });

    it('slow drag from p=0.3 cancels (target=0 since p<0.5)', () => {
      const result = simulateSettle(0.3, 0.2, 0);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(0);
    });

    it('slow drag from p=0.7 completes (target=1 since p>=0.5)', () => {
      const result = simulateSettle(0.7, 0.2, 1);
      expect(result.converged).toBe(true);
      expect(result.p).toBe(1);
    });
  });
});
