/**
 * SpineDisconnect.regression.test.ts — pending regression test for the
 * candidate-(a) "BindingConstraint regime never enforced" root cause
 * identified in the 2026-05-19 spine/crease disconnect sweep
 * (docs/spine-crease-disconnect-sweep-2026-05-15.md).
 *
 * The test is `it.todo` — it documents the gap without flipping CI red.
 * The expected-behaviour spec is below; flipping `it.todo` → `it` (and
 * implementing the assertion's other half) once the renderer wires
 * `BindingConstraint.regimeDetect` in is the diagnostic acceptance
 * criterion.
 *
 * USER OBSERVATION (recurring across PRs #10/#28/#45/#59/#74/#82/#87)
 * ──────────────────────────────────────────────────────────────────
 * The page visibly detaches from the spine at the top/bottom corner when
 * the curl has any tilt and the dihedral is past the half-way mark.
 *
 * PREDICTION (from BindingConstraint.ts, FR-P6/FR-P7)
 * ───────────────────────────────────────────────────
 * When the bend's lateral reach R·sin(φ)·|sin θ| exceeds the remaining
 * anchor-to-corner distance (H/2 ∓ anchorY), real paper migrates the
 * spine anchor to ±H/2. The live shader does NOT do this — it
 * continues using the gesture-start anchorY, so the geometric "spine
 * intersection of the crease line" sits *inside* the page, the bend
 * keeps growing past the binding endpoint, and visually the page peels
 * off the spine corner.
 *
 * This file exists so a future agent reading the sweep doc has the
 * exact numeric scenario in code-form and can flip `it.todo` → `it`
 * once `regimeDetect` is wired into the renderer (likely in
 * `Book.updateTurningDrag` or `setCrease`).
 */

import { describe, it, expect } from 'vitest';
import { regimeDetect, criticalPhi } from './BindingConstraint';

describe('SpineDisconnect — candidate (a): BindingConstraint not wired', () => {
  // Geometry: page is 1 wide, height 0.667 (book aspect 1.5:1). Corner is at
  // (0, +H/2) = (0, +0.333…). Curl radius is the interior-stock minimum.
  const W = 1.0;
  const H = 0.667;
  // Realistic curl radius for an interior page lifted high (looser curl ≈
  // higher hand). The PRD notes R grows with hand height; R = 0.5 (twice the
  // INTERIOR_STOCK minimum) is the regime where the user's "off the crease"
  // observation is most pronounced.
  const R = 0.5;

  it('demonstrates that the BindingConstraint module fires for a realistic drag', () => {
    // Sanity: the *module* correctly detects the regime crossing. This part
    // already passes — it's the renderer that doesn't honour the detector.
    const theta = Math.PI / 3;      // 60° tilt — corner-pull on a tall page
    const anchorY = 0;              // mid-spine anchor (the PR #87 default)
    const phi = Math.PI / 2;        // peak lateral reach (φ at midline)

    const result = regimeDetect({ W, H, R, anchorY, theta, phi });

    // For this geometry the bend reaches the top corner well before φ=π.
    const phiCrit = criticalPhi(R, theta, anchorY, H, 'top');
    expect(phiCrit).toBeGreaterThan(0);
    expect(phiCrit).toBeLessThan(Math.PI / 2);
    expect(phi).toBeGreaterThan(phiCrit);

    // The detector says: migrate the anchor to the binding endpoint that the
    // bend leans toward (sign(sin θ) selects top vs. bottom — see module).
    expect(result.regime === 'tangent-top' || result.regime === 'tangent-bottom').toBe(true);
    expect(Math.abs(result.migrated_anchor_y)).toBeCloseTo(H / 2, 6);
  });

  it.todo(
    'live renderer migrates the crease spine anchor to ±H/2 once regime !== "free"',
    // When implemented, this test should:
    //   1. Build a Book at the geometry above.
    //   2. Simulate a forward drag whose pointer trajectory crosses the
    //      criticalPhi boundary for the top corner.
    //   3. Read back `book.getState().getCrease().originOnEdge.y` at the
    //      post-crossing frame and assert it equals +H/2 (within a small
    //      tolerance), NOT the pointerdown anchorY.
    //   4. Optionally assert that a `regime-transition` telemetry event
    //      was emitted at the crossing.
    //
    // Today this test would fail: the live shader uses the gesture-start
    // anchorY for the entire drag. Wiring `regimeDetect` into
    // `Book.updateTurningDrag` (or the equivalent per-frame crease
    // computation in `Book.ts`) is the diagnostic acceptance criterion.
  );

  it.todo(
    'live renderer continues using free-regime anchorY when bend stays inside binding',
    // Symmetric guardrail: with a smaller R or smaller θ that never crosses
    // criticalPhi, the spine anchor must remain at the gesture-start
    // anchorY for the full drag (no false-positive migration).
  );
});
