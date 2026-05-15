/**
 * FiducialPositions.test.ts — sanity tests for the browser-side mirror of
 * the harness's analytic fiducial position function.
 *
 * The cross-check against `harness/src/bootstrap.ts` is a hand-comparison
 * in the diagnostic report (docs/diagnostic-2026-05-14.md); these unit
 * tests pin the publicly observable behaviour we depend on inside src/.
 */

import { describe, it, expect } from 'vitest';
import {
  fiducialWorldPosition,
  sampleAllFiducials,
  approxAreaRatio,
  nearestFiducial,
} from './FiducialPositions';
import { FIDUCIAL_US, FIDUCIAL_VS } from '../textures/atlas';

describe('FiducialPositions', () => {
  it('flat page (uAngle=0, sin2phi) produces area ratio ≈ 1', () => {
    const r = approxAreaRatio({ uAngle: 0, developable: false, curlR: 1e6, exempt: 0 });
    expect(r).toBeGreaterThan(0.99);
    expect(r).toBeLessThan(1.01);
  });

  it('flat page (uAngle=0, developable) produces area ratio ≈ 1', () => {
    const r = approxAreaRatio({
      uAngle: 0, developable: true, curlR: 0.25, exempt: 0.01,
    });
    expect(r).toBeGreaterThan(0.99);
    expect(r).toBeLessThan(1.01);
  });

  it('sampleAllFiducials returns 35 samples in row-major order', () => {
    const s = sampleAllFiducials({ uAngle: 0, developable: false, curlR: 1e6, exempt: 0 });
    expect(s).toHaveLength(FIDUCIAL_US.length * FIDUCIAL_VS.length);
    expect(s[0].id).toBe('P_0_0');
    expect(s[1].id).toBe('P_0_1');
    expect(s[FIDUCIAL_VS.length].id).toBe('P_1_0');
  });

  it('nearestFiducial snaps to the closest grid cell', () => {
    const r = nearestFiducial(0.31, 0.21);
    // FIDUCIAL_US[1] = 0.3, FIDUCIAL_VS[1] = 0.22
    expect(r.i).toBe(1);
    expect(r.j).toBe(1);
    expect(Math.abs(r.du)).toBeLessThan(0.05);
    expect(Math.abs(r.dv)).toBeLessThan(0.05);
  });

  it('fiducialWorldPosition at (u=0.5, v=0.5) lies on the page-tilt plane at uAngle=0', () => {
    const p = fiducialWorldPosition(0, 0.5, 0.5, false, 1e6, 0);
    // v=0.5 → localY=0, so worldY = 0 and worldZ = 0 after rotation.
    expect(Math.abs(p.y)).toBeLessThan(1e-9);
    expect(Math.abs(p.z)).toBeLessThan(1e-9);
    expect(p.x).toBeCloseTo(0.5, 6);
  });

  it('large dihedral lifts the free-edge fiducials off the page plane', () => {
    const flat = fiducialWorldPosition(0, 0.9, 0.5, false, 1e6, 0);
    const lifted = fiducialWorldPosition(-Math.PI / 2, 0.9, 0.5, false, 1e6, 0);
    expect(Math.abs(lifted.x - flat.x)).toBeGreaterThan(0.1);
  });
});
