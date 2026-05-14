/**
 * SettlePhysics.ts — Aerodynamic page-settle integrator (PRD #9).
 *
 * Replaces the rigid 1-DOF energy-based settle (`v̇ = dir·G − D·v` on a
 * scalar `dragProgress`) with a coupled 2-DOF damped oscillator:
 *
 *     φ̈ = dir · G · sin(φ) − D · φ̇                  (gravity torque on the flap)
 *     b̈ = ω² · (b₀ − b) − Dᵦ · ḃ + κ · φ̇²            (aero "puff" excited by flap rate)
 *
 * `φ` is the absolute dihedral angle in [0, π], shared with `BookState`
 * (no rebasing for forward vs. reverse). `dir = +1` for a commit whose
 * target is `φ = π`, `dir = -1` for a cancel whose target is `φ = 0`.
 *
 * The `sin(φ)` term makes torque vanish at both equilibria (page flat in
 * either direction), so the integrator no longer needs the artificial
 * "minimum velocity" seed the rigid model used to escape `p = 0.5`.
 *
 * The `κ · φ̇²` term injects energy into `b` proportional to how fast the
 * flap is sweeping air — a phenomenological aerodynamic puff. `b` returns
 * to its rest amplitude `b₀` via the damped-oscillator dynamics.
 *
 * This module is intentionally Three.js-free so it can be unit-tested
 * cheaply and reused by both the renderer (main.ts) and the offline
 * trajectory predictor (harness/src/bootstrap.ts).
 *
 * Inspiration (cite, do not copy): Weil 1986 "The synthesis of cloth
 * objects" + Provot 1995 mass-spring papers — qualitative observation
 * that single-DOF dihedral + free-edge bias is enough for visually
 * plausible paper-fall.
 */

/** Integrator state vector. */
export interface AeroSettleState {
  /** Dihedral angle in radians (shared with BookState.phi, range [0, π]). */
  phi: number;
  /** dφ/dt, radians/second. */
  phiDot: number;
  /** Bend-envelope amplitude (the legacy `uBendAmount`). */
  b: number;
  /** db/dt. */
  bDot: number;
}

/** Tunable art knobs (units: phi=radians, b=dimensionless, time=seconds). */
export interface AeroSettleParams {
  /** Gravity torque coefficient. */
  G: number;
  /** φ̇ damping (air resistance on the flap). */
  D: number;
  /** Natural frequency of the b oscillator (rad/s). */
  omega: number;
  /** ḃ damping coefficient. */
  Db: number;
  /** Aerodynamic forcing coefficient — couples |φ̇|² into b. */
  kappa: number;
  /** Rest amplitude of b (target when φ̇ = 0). */
  b0: number;
  /** Optional upper cap on b — prevents the flap from "ballooning" past a visible-billow envelope. */
  bMax: number;
}

/**
 * Tuned defaults (PR #49 follow-up).
 *
 * The PRD §"Math sketch" starting values (G=5, D=6.5, ω=12, Dᵦ=6, κ=0.05)
 * produced a heavily over-damped φ oscillator (ζ_φ = D/(2√G) ≈ 1.45) and a
 * lightly under-damped but slowly-decaying b oscillator (ζ_b = Dᵦ/(2ω) =
 * 0.25, envelope time-constant 1/(ζω) ≈ 0.33 s). The visible result was a
 * page that crawled into its equilibrium over several seconds — the "tail"
 * the human reviewer flagged on PR #49.
 *
 * These tuned values keep both oscillators *lightly* under-damped, which is
 * what real paper exhibits:
 *
 *   ζ_φ = D / (2·√G) = 4 / (2·√10) ≈ 0.63   (just past 1/√2; one tiny
 *                                            overshoot absorbed by the
 *                                            inelastic wall clamp at φ=π)
 *   ζ_b = Dᵦ / (2·ω) = 18 / 36 = 0.50       (well inside the [0.4, 0.7]
 *                                            "lightly underdamped" band —
 *                                            quick puff, fast recovery)
 *
 * Gravity is also doubled (G=5→10) so the natural-frequency timescale of φ
 * (1/√G) is √2 shorter — a typical mid-fold flick now lands in ~300–700 ms
 * instead of ~3–5 s. κ is raised in step with ω² (the analytic puff
 * equilibrium offset is κ·φ̇²/ω²) so the visible bend bump under a flick is
 * preserved, not shrunk by the stiffer oscillator.
 */
export const DEFAULT_AERO_PARAMS: AeroSettleParams = {
  G:     10.0,
  D:     4.0,
  omega: 18,
  Db:    18,
  kappa: 0.08,
  b0:    0.4,
  bMax:  0.7,
};

/**
 * Build the initial integrator state at drag-release.
 *
 * `phi0` and `phiDot0` come from the live `BookState` (absolute phi
 * convention — no reverse-turn rebasing). `b0` defaults to the params
 * value but may be overridden if the renderer captured a different
 * baseline (e.g. for cover stock).
 */
export function entry(
  phi0: number,
  phiDot0: number,
  params: AeroSettleParams = DEFAULT_AERO_PARAMS,
): AeroSettleState {
  return {
    phi: phi0,
    phiDot: phiDot0,
    b: params.b0,
    bDot: 0,
  };
}

/**
 * Advance the integrator one step using semi-implicit (symplectic) Euler.
 *
 * @param state    Current state — not mutated; returned object is fresh.
 * @param dir      +1 if target is φ = π (commit forward / cancel reverse),
 *                 −1 if target is φ = 0 (cancel forward / commit reverse).
 * @param dt       Timestep in seconds. Caller should clamp to ~50 ms.
 * @param params   Art knobs (see DEFAULT_AERO_PARAMS).
 */
export function step(
  state: AeroSettleState,
  dir: 1 | -1,
  dt: number,
  params: AeroSettleParams = DEFAULT_AERO_PARAMS,
): AeroSettleState {
  // Accelerations from the current state.
  const phiAcc = dir * params.G * Math.sin(state.phi) - params.D * state.phiDot;
  // κ·φ̇² is always non-negative — the puff term injects energy independent
  // of sweep direction (a flap whooshing either way moves the same air).
  const bAcc =
    params.omega * params.omega * (params.b0 - state.b) -
    params.Db * state.bDot +
    params.kappa * state.phiDot * state.phiDot;

  // Semi-implicit Euler: update velocities first, then positions with the
  // new velocity. Robust at the timesteps the rAF loop produces and avoids
  // the energy-drift that plain Euler exhibits on oscillators.
  let phiDot = state.phiDot + phiAcc * dt;
  let bDot   = state.bDot   + bAcc   * dt;

  let phi = state.phi + phiDot * dt;
  let b   = state.b   + bDot   * dt;

  // Hard clamps so the integrator never escapes the physical domain.
  // φ ∈ [0, π]: hitting either wall is an inelastic stop (gravity has done
  // its job; the page has landed on the next/previous spread).
  if (phi < 0) { phi = 0; if (phiDot < 0) phiDot = 0; }
  if (phi > Math.PI) { phi = Math.PI; if (phiDot > 0) phiDot = 0; }

  // b ∈ [0, bMax]: bMax caps the visible "balloon"; b cannot go negative.
  if (b < 0)            { b = 0;            if (bDot < 0) bDot = 0; }
  if (b > params.bMax)  { b = params.bMax;  if (bDot > 0) bDot = 0; }

  return { phi, phiDot, b, bDot };
}

/** Target phi for the settle. */
export function targetPhi(dir: 1 | -1): 0 | typeof Math.PI {
  return dir === 1 ? Math.PI : 0;
}

/**
 * Settle direction from (target progress, isReverseTurn). The progress
 * convention in BookState is direction-agnostic (0 = start of gesture,
 * 1 = commit), but the integrator works in absolute phi, so commit
 * forward (`target=1, reverse=false`) targets π while commit reverse
 * (`target=1, reverse=true`) targets 0.
 */
export function dirFromTarget(target: 0 | 1, isReverseTurn: boolean): 1 | -1 {
  const wantPi = isReverseTurn ? target === 0 : target === 1;
  return wantPi ? 1 : -1;
}

/**
 * Energy-like convergence test, plus a visual-quiescence shortcut.
 *
 * Primary criterion is mechanical energy (per unit moment of inertia):
 *   E = ½φ̇² + G·(1 − cos(φ − target))
 * which for small residuals collapses to ½φ̇² + ½G·(Δφ)² — same Lyapunov
 * shape as the legacy rigid settle, but in radians.
 *
 * Secondary criterion catches the asymptotic crawl that the energy stop
 * leaves on the table when the oscillator is lightly under-damped: if Δφ,
 * φ̇, AND the bend residual |b − b₀| are all visually negligible, the
 * page has stopped *to the eye* even if there is mathematical energy left.
 * Including b here directly addresses the PR #49 review comment that the
 * tail (the bend amplitude returning to b₀) was held open by residual
 * curl ringing.
 */
export function isConverged(
  state: AeroSettleState,
  dir: 1 | -1,
  params: AeroSettleParams = DEFAULT_AERO_PARAMS,
  eps: number = 0.005,
): boolean {
  const target = targetPhi(dir);
  const dPhi = state.phi - target;
  const energy = 0.5 * state.phiDot * state.phiDot + params.G * (1 - Math.cos(dPhi));
  if (energy < eps) return true;
  // Visual quiescence: Δφ ≤ ~1.7°, page rotating ≤ ~17°/s, bend within 5%
  // of rest — at sub-frame visibility on a 1080p target.
  return (
    Math.abs(dPhi) < 0.03 &&
    Math.abs(state.phiDot) < 0.3 &&
    Math.abs(state.b - params.b0) < 0.02
  );
}

/** Map absolute phi → BookState progress (0..1, direction-agnostic). */
export function progressFromPhi(phi: number, isReverseTurn: boolean): number {
  const p = phi / Math.PI;
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  return isReverseTurn ? 1 - clamped : clamped;
}

/** Whether the `?settle=aero` URL flag is set. */
export function aerodynamicSettleEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('settle') === 'aero';
  } catch {
    return false;
  }
}
