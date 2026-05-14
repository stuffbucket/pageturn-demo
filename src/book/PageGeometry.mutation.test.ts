/**
 * PageGeometry.mutation.test.ts — targeted tests added in the 2026-05-14
 * mutation-test audit. Each `it` is annotated with the mutant it was
 * written to kill (file:line:mutator).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPageGeometry, applyCurlDisplacement } from './PageGeometry';

describe('PageGeometry.applyCurlDisplacement — buffer integrity (kills L58, L81)', () => {
  it('does not write past the BufferAttribute and produces no NaN', () => {
    const geo = createPageGeometry(1.0, 1.4, 16, 4);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    const before = positions.count;
    applyCurlDisplacement(geo, 0.5, 0.15);
    expect(positions.count).toBe(before);
    const arr = positions.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      expect(Number.isNaN(arr[i])).toBe(false);
    }
  });

  it('marks positions.needsUpdate = true (kills the false-mutation on L81)', () => {
    const geo = createPageGeometry(1.0, 1.4, 8, 2);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    // BufferAttribute.needsUpdate is a setter that increments `.version`;
    // there is no getter (returns undefined), so we observe .version.
    const before = positions.version;
    applyCurlDisplacement(geo, 0.5, 0.15);
    expect(positions.version).toBeGreaterThan(before);
  });
});

describe('PageGeometry.applyCurlDisplacement — region boundaries (kills L66, L70)', () => {
  it('a vertex strictly behind the curl axis (d < 0) is mirrored with z = 0.001 offset', () => {
    // Place curl axis at x = 0.7 so the leftmost column (x = 0) has d = -0.7.
    const geo = createPageGeometry(1.0, 1.4, 8, 2);
    applyCurlDisplacement(geo, 0.7, 0.15);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    // First vertex of the top row sits at x = 0 (spine).
    const x = positions.getX(0);
    const z = positions.getZ(0);
    expect(x).toBeCloseTo(2 * 0.7 - 0, 5);
    expect(z).toBeCloseTo(0.001, 6);
  });

  it('a vertex exactly at the curl axis (d = 0) is left in the page plane (z = 0)', () => {
    // 8 segments across width 1 ⇒ vertex spacing 1/8 = 0.125. Pick curlAxisX
    // on a vertex column (x = 0.5) so one row has d = 0 exactly.
    const geo = createPageGeometry(1.0, 1.4, 8, 2);
    applyCurlDisplacement(geo, 0.5, 0.15);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    // Find the vertex column at x ≈ 0.5 in the original positions.
    const original = geo.userData.originalPositions as Float32Array;
    let foundDZero = false;
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(original[i * 3] - 0.5) < 1e-9) {
        // d = 0 ⇒ no displacement (Case 3) ⇒ x unchanged, z = 0.
        expect(positions.getX(i)).toBeCloseTo(0.5, 9);
        expect(positions.getZ(i)).toBeCloseTo(0, 9);
        foundDZero = true;
      }
    }
    expect(foundDZero).toBe(true);
  });

  it('a vertex ahead of the cylinder (d > π·radius) is left flat (kills L70)', () => {
    // curlAxisX at 0; radius = 0.1 ⇒ d ≤ π·0.1 ≈ 0.314 lies on the cylinder.
    // Far edge at x = 1 has d = 1 > 0.314 ⇒ Case 3 (unchanged). Compare to
    // the cylinder boundary at d = π·radius.
    const geo = createPageGeometry(1.0, 1.4, 16, 2);
    applyCurlDisplacement(geo, 0, 0.1);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    const original = geo.userData.originalPositions as Float32Array;
    for (let i = 0; i < positions.count; i++) {
      const x0 = original[i * 3];
      if (x0 > Math.PI * 0.1 + 1e-6) {
        // Far side, unchanged.
        expect(positions.getX(i)).toBeCloseTo(x0, 9);
        expect(positions.getZ(i)).toBeCloseTo(0, 9);
      }
    }
  });
});

describe('PageGeometry.applyCurlDisplacement — missing originalPositions warning path (kills L53)', () => {
  it('returns gracefully when originalPositions is absent', () => {
    // Construct a bare PlaneGeometry without going through createPageGeometry.
    const geo = new THREE.PlaneGeometry(1, 1.4, 4, 1);
    // Capture console.warn so test output stays clean.
    const warnSpy = (globalThis as { console: Console }).console.warn;
    let warned = false;
    (globalThis as { console: Console }).console.warn = () => { warned = true; };
    try {
      // Should not throw and should warn once.
      applyCurlDisplacement(geo, 0.5, 0.15);
    } finally {
      (globalThis as { console: Console }).console.warn = warnSpy;
    }
    expect(warned).toBe(true);
  });
});
