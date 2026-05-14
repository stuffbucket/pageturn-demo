/**
 * SettlePhysics.test.ts — unit tests for the aerodynamic settle integrator.
 *
 * The integrator is pure (no Three.js, no DOM), so these tests exercise
 * the math directly. Behaviours under test mirror the FRs in
 * `docs/prd-settle-physics.md`:
 *
 *   - FR-1.x  phi evolves toward the target with continuous crease state
 *   - FR-2.x  b ramps up under φ̇ and relaxes to b₀ when the flap stills
 *   - FR-4.x  the trajectory may overshoot the monotone-interpolation envelope
 *
 * Convergence numbers were chosen so each test simulates ≤ 3 seconds of
 * wall-clock motion at a 60 fps step, keeping the suite fast.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AERO_PARAMS,
  type AeroSettleState,
  entry,
  step,
  targetPhi,
  dirFromTarget,
  isConverged,
  progressFromPhi,
} from './SettlePhysics';

const PI = Math.PI;

/** Roll the integrator forward up to `maxFrames` 60 fps steps, returning the trace. */
function simulate(
  initial: AeroSettleState,
  dir: 1 | -1,
  opts: { dt?: number; maxFrames?: number; stopOnConverge?: boolean } = {},
): AeroSettleState[] {
  const dt = opts.dt ?? 1 / 60;
  const maxFrames = opts.maxFrames ?? 600;
  const trace: AeroSettleState[] = [initial];
  let s = initial;
  for (let i = 0; i < maxFrames; i++) {
    s = step(s, dir, dt);
    trace.push(s);
    if (opts.stopOnConverge && isConverged(s, dir)) break;
  }
  return trace;
}

describe('SettlePhysics — entry / direction helpers', () => {
  it('entry() snapshots phi, phiDot and seeds b at the rest amplitude', () => {
    const s = entry(0.6, 1.2);
    expect(s.phi).toBe(0.6);
    expect(s.phiDot).toBe(1.2);
    expect(s.b).toBe(DEFAULT_AERO_PARAMS.b0);
    expect(s.bDot).toBe(0);
  });

  it('targetPhi maps +1 → π and -1 → 0', () => {
    expect(targetPhi(1)).toBe(PI);
    expect(targetPhi(-1)).toBe(0);
  });

  it('dirFromTarget rebases forward/reverse turn target onto absolute phi', () => {
    expect(dirFromTarget(1, false)).toBe(1);   // commit forward → phi=π
    expect(dirFromTarget(0, false)).toBe(-1);  // cancel forward → phi=0
    expect(dirFromTarget(1, true)).toBe(-1);   // commit reverse → phi=0
    expect(dirFromTarget(0, true)).toBe(1);    // cancel reverse → phi=π
  });

  it('progressFromPhi inverts for reverse turns and clamps out-of-domain phi', () => {
    expect(progressFromPhi(0, false)).toBe(0);
    expect(progressFromPhi(PI, false)).toBe(1);
    expect(progressFromPhi(0, true)).toBe(1);
    expect(progressFromPhi(PI, true)).toBe(0);
    expect(progressFromPhi(-0.5, false)).toBe(0);
    expect(progressFromPhi(PI + 0.5, false)).toBe(1);
  });
});

describe('SettlePhysics — convergence (FR-1.x)', () => {
  it('commits forward from mid-fold (target φ=π)', () => {
    const trace = simulate(entry(PI / 2, 0), 1, { stopOnConverge: true });
    const final = trace[trace.length - 1];
    expect(isConverged(final, 1)).toBe(true);
    expect(final.phi).toBeGreaterThan(PI - 0.2);
    // Settle should land within the rAF budget of ~5 s.
    expect(trace.length).toBeLessThan(300);
  });

  it('cancels from mid-fold (target φ=0)', () => {
    const trace = simulate(entry(PI / 2, 0), -1, { stopOnConverge: true });
    const final = trace[trace.length - 1];
    expect(isConverged(final, -1)).toBe(true);
    expect(final.phi).toBeLessThan(0.2);
  });

  it('treats φ̇ ≈ 0 at flat configurations as the equilibrium (no gravity torque at φ=0 / φ=π)', () => {
    // At φ = 0 with phi-dot = 0, sin(φ)=0 ⇒ no torque, no motion.
    const flat = entry(0, 0);
    const s = step(flat, -1, 1 / 60);
    expect(s.phi).toBe(0);
    expect(s.phiDot).toBe(0);

    // At φ = π with phi-dot = 0, sin(π) ≈ 0 ⇒ no torque, no motion.
    const flipped = entry(PI, 0);
    const s2 = step(flipped, 1, 1 / 60);
    expect(s2.phi).toBe(PI);
    expect(Math.abs(s2.phiDot)).toBeLessThan(1e-9);
  });

  it('phi stays clamped to [0, π] even with absurd release velocity', () => {
    let s = entry(PI / 2, 50); // unphysical flick
    for (let i = 0; i < 60; i++) {
      s = step(s, 1, 1 / 60);
      expect(s.phi).toBeGreaterThanOrEqual(0);
      expect(s.phi).toBeLessThanOrEqual(PI);
    }
  });
});

describe('SettlePhysics — bend-envelope dynamics (FR-2.x, FR-4.x)', () => {
  it('puff term excites b above b₀ when the flap is sweeping fast (FR-2.1)', () => {
    // Release with a hard flick — κ·φ̇² should pump b detectably above b₀.
    // Tuned defaults: ω=18, κ=0.08, so analytic equilibrium offset
    // ≈ κ·φ̇²/ω² ≈ 0.08·64/324 ≈ 0.016 at φ̇=8 rad/s; the under-damped
    // oscillator overshoots that on the way up.
    const trace = simulate(entry(PI / 2, 8), 1, { maxFrames: 60 });
    const peakB = trace.reduce((m, s) => (s.b > m ? s.b : m), DEFAULT_AERO_PARAMS.b0);
    expect(peakB).toBeGreaterThan(DEFAULT_AERO_PARAMS.b0 + 0.01);
  });

  it('b decays back to near b₀ within 250 ms of an injected puff (tail decay)', () => {
    // PR #49 review: "the tail of the page settling appears to be too slow
    // relative to what would be observed in nature." This pins the b
    // oscillator's decay envelope. ζ_b = Dᵦ/(2ω) = 0.5 ⇒ envelope decays as
    // exp(−ζω·t) = exp(−9·t), so a 0.05 bump should fall under 0.02 within
    // ln(0.05/0.02)/9 ≈ 100 ms; 250 ms gives a comfortable headroom.
    let s = { phi: PI, phiDot: 0, b: DEFAULT_AERO_PARAMS.b0 + 0.05, bDot: 0 };
    const dt = 1 / 60;
    let underToleranceAt: number | null = null;
    for (let i = 0; i < 30; i++) {
      s = step(s, 1, dt);
      const t = (i + 1) * dt;
      if (underToleranceAt === null && Math.abs(s.b - DEFAULT_AERO_PARAMS.b0) < 0.02) {
        underToleranceAt = t;
      }
    }
    expect(underToleranceAt).not.toBeNull();
    expect(underToleranceAt!).toBeLessThan(0.25);
  });

  it('b oscillator is lightly underdamped (ζ_b in [0.4, 0.7])', () => {
    // Visible quick oscillation instead of over-damped crawl. Pin the
    // canonical damping ratio so future tuning preserves the "paper-like"
    // tail.
    const zetaB = DEFAULT_AERO_PARAMS.Db / (2 * DEFAULT_AERO_PARAMS.omega);
    expect(zetaB).toBeGreaterThanOrEqual(0.4);
    expect(zetaB).toBeLessThanOrEqual(0.7);
  });

  it('b returns to b₀ as the flap settles (FR-2.2)', () => {
    const trace = simulate(entry(PI / 2, 2.5), 1, { maxFrames: 600, stopOnConverge: true });
    const final = trace[trace.length - 1];
    expect(Math.abs(final.b - DEFAULT_AERO_PARAMS.b0)).toBeLessThan(0.05);
    expect(Math.abs(final.bDot)).toBeLessThan(0.2);
  });

  it('b stays bounded above by bMax — never balloons indefinitely (FR-2.3)', () => {
    // Hammer the puff term with an unrealistically high phi-dot.
    let s = entry(PI / 2, 20);
    for (let i = 0; i < 60; i++) {
      s = step(s, 1, 1 / 60);
      expect(s.b).toBeLessThanOrEqual(DEFAULT_AERO_PARAMS.bMax + 1e-9);
      expect(s.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('release at rest with phi-dot = 0 still settles (no flutter required)', () => {
    // FR-3.2: a "steep" release with near-zero velocity should produce a
    // near-monotonic phi trajectory toward π, no edge-bend snap.
    const trace = simulate(entry(0.4 * PI, 0), 1, { stopOnConverge: true });
    const final = trace[trace.length - 1];
    expect(isConverged(final, 1)).toBe(true);
    // phi should be monotone non-decreasing for steep release (gravity-only).
    let maxBackstep = 0;
    for (let i = 1; i < trace.length; i++) {
      const back = trace[i - 1].phi - trace[i].phi;
      if (back > maxBackstep) maxBackstep = back;
    }
    // Small negative excursions allowed by the integrator (overshoot at the
    // wall + damping), but never large rebounds.
    expect(maxBackstep).toBeLessThan(0.05);
  });
});

describe('SettlePhysics — no edge-bend snap on release (issue #29)', () => {
  it('trajectory is continuous from release through settle (no progress jump)', () => {
    // Simulate the failure mode in #29: settle entry must consume the live
    // phi, not reset it. We model this by feeding the live phi back through
    // progressFromPhi and checking the first-frame progress is within an
    // eps of the release progress.
    const releaseProgress = 0.62;
    const releasePhi = releaseProgress * PI;
    const s0 = entry(releasePhi, 1.0);
    const s1 = step(s0, 1, 1 / 60);
    const p0 = progressFromPhi(s0.phi, false);
    const p1 = progressFromPhi(s1.phi, false);
    expect(p0).toBeCloseTo(releaseProgress, 6);
    // First-frame progress delta is bounded by phi-dot · dt / π — i.e. no snap.
    expect(Math.abs(p1 - p0)).toBeLessThan(0.05);
  });

  it('a slow release near the commit threshold still commits without snap-back', () => {
    // φ just past π/2 with a tiny forward velocity ⇒ should commit smoothly.
    const trace = simulate(entry(0.55 * PI, 0.2), 1, { stopOnConverge: true });
    const final = trace[trace.length - 1];
    expect(isConverged(final, 1)).toBe(true);
    // No initial backward jump — the bug in #29 manifested as a hard reset
    // of phi to a lower edge-bend value before integration could begin.
    expect(trace[1].phi).toBeGreaterThanOrEqual(trace[0].phi - 1e-6);
  });
});
