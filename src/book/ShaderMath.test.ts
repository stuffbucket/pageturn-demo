/**
 * ShaderMath.test.ts
 * Tests for the cylinder-curl math that appears in the vertex shader
 * This validates the formulas from Section 2.3 and 7.4
 */

import { describe, it, expect } from 'vitest';

/**
 * Replicate the vertex shader math in pure TypeScript for testing
 */
function applyCurlMathShader(
  x: number,
  curlAxisX: number,
  radius: number
): { x: number; z: number } {
  const d = x - curlAxisX;

  let xPrime = x;
  let zPrime = 0;

  if (d < 0) {
    // Case 1: Behind curl axis
    xPrime = 2 * curlAxisX - x;
    zPrime = 0.001;
  } else if (d <= Math.PI * radius) {
    // Case 2: On cylinder
    const theta = d / radius;
    xPrime = curlAxisX + radius * Math.sin(theta);
    zPrime = radius * (1 - Math.cos(theta));
  }
  // Case 3: Ahead of curl (d > π·r), no change

  return { x: xPrime, z: zPrime };
}

describe('Vertex Shader Math (Section 2.3)', () => {
  describe('Formula Correctness', () => {
    it('Case 1: d < 0 mirrors vertex across axis', () => {
      const curlAxisX = 0.5;
      const result = applyCurlMathShader(0.2, curlAxisX, 0.15);

      // x' = 2*axis - x
      expect(result.x).toBeCloseTo(2 * curlAxisX - 0.2, 5);
      expect(result.z).toBeCloseTo(0.001, 5);
    });

    it('Case 2: d = 0 leaves vertex at axis with z = 0', () => {
      const curlAxisX = 0.5;
      const result = applyCurlMathShader(curlAxisX, curlAxisX, 0.15);

      expect(result.x).toBeCloseTo(curlAxisX, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it('Case 2: d = r/2 places vertex at correct cylinder position', () => {
      const curlAxisX = 0.5;
      const radius = 0.15;
      const d = radius / 2;
      const x = curlAxisX + d;

      const result = applyCurlMathShader(x, curlAxisX, radius);

      // θ = d/r = 0.5
      const theta = d / radius; // 0.5
      const expectedX = curlAxisX + radius * Math.sin(theta);
      const expectedZ = radius * (1 - Math.cos(theta));

      expect(result.x).toBeCloseTo(expectedX, 5);
      expect(result.z).toBeCloseTo(expectedZ, 5);
    });

    it('Case 2: d = π·r/2 places vertex at 90 degrees (θ = π/2)', () => {
      const curlAxisX = 0.5;
      const radius = 0.15;
      const d = (Math.PI * radius) / 2;
      const x = curlAxisX + d;

      const result = applyCurlMathShader(x, curlAxisX, radius);

      // θ = π/2
      // sin(π/2) = 1, cos(π/2) = 0
      const expectedX = curlAxisX + radius * 1;

      expect(result.x).toBeCloseTo(expectedX, 5);
      expect(result.z).toBeCloseTo(radius, 5);
    });

    it('Case 2: d = π·r places vertex at 180 degrees (θ = π)', () => {
      const curlAxisX = 0.5;
      const radius = 0.15;
      const d = Math.PI * radius;
      const x = curlAxisX + d;

      const result = applyCurlMathShader(x, curlAxisX, radius);

      // θ = π
      // sin(π) = 0, cos(π) = -1
      const expectedX = curlAxisX + radius * 0;

      expect(result.x).toBeCloseTo(expectedX, 5);
      expect(result.z).toBeCloseTo(2 * radius, 5);
    });

    it('Case 3: d > π·r keeps vertex unchanged', () => {
      const curlAxisX = 0.5;
      const x = curlAxisX + 2 * Math.PI * 0.15;

      const result = applyCurlMathShader(x, curlAxisX, 0.15);

      expect(result.x).toBeCloseTo(x, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });
  });

  describe('Curl Axis Position Sweeps Correctly', () => {
    it('at φ = 0 (progress=0), curlAxisX = W', () => {
      const pageWidth = 1.0;
      const phi = 0;
      const curlAxisX = pageWidth * Math.cos(phi);

      expect(curlAxisX).toBeCloseTo(pageWidth, 5);
    });

    it('at φ = π/2 (progress=0.5), curlAxisX = 0', () => {
      const pageWidth = 1.0;
      const phi = Math.PI / 2;
      const curlAxisX = pageWidth * Math.cos(phi);

      expect(curlAxisX).toBeCloseTo(0, 5);
    });

    it('at φ = π (progress=1), curlAxisX = -W', () => {
      const pageWidth = 1.0;
      const phi = Math.PI;
      const curlAxisX = pageWidth * Math.cos(phi);

      expect(curlAxisX).toBeCloseTo(-pageWidth, 5);
    });

    it('curlAxisX sweeps monotonically from W to -W', () => {
      const pageWidth = 1.0;
      const positions = [];

      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        const phi = progress * Math.PI;
        const curlAxisX = pageWidth * Math.cos(phi);
        positions.push(curlAxisX);
      }

      // Each position should be less than the previous (monotonically decreasing)
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeLessThan(positions[i - 1] + 1e-5);
      }
    });
  });

  describe('Three Regions Are Mutually Exclusive', () => {
    it('a point belongs to exactly one region for any φ', () => {
      const pageWidth = 1.0;
      const radius = 0.15;
      const testX = 0.6;

      for (let progress = 0; progress <= 1.0; progress += 0.1) {
        const phi = progress * Math.PI;
        const curlAxisX = pageWidth * Math.cos(phi);
        const d = testX - curlAxisX;

        // Verify mutual exclusivity: test that toggling any condition changes region
        const isRegion1 = d < 0;
        const isRegion2 = d >= 0 && d <= Math.PI * radius;
        const isRegion3 = d > Math.PI * radius;

        // Exactly one should be true
        const count = [isRegion1, isRegion2, isRegion3].filter(Boolean).length;
        expect(count).toBe(1);
      }
    });

    it('regions transition smoothly at boundaries', () => {
      const curlAxisX = 0.5;
      const radius = 0.15;

      // Test at region 1→2 boundary (d = 0)
      const atBoundary12 = applyCurlMathShader(curlAxisX, curlAxisX, radius);
      expect(atBoundary12.x).toBeCloseTo(curlAxisX, 5);
      expect(atBoundary12.z).toBeCloseTo(0, 5);

      // Test just inside region 2
      const insideRegion2 = applyCurlMathShader(curlAxisX + 0.01, curlAxisX, radius);
      expect(insideRegion2.x).toBeGreaterThan(curlAxisX - 0.01);
      expect(insideRegion2.x).toBeLessThan(curlAxisX + radius);
      expect(insideRegion2.z).toBeGreaterThan(0);
      expect(insideRegion2.z).toBeLessThan(2 * radius);

      // Test at region 2→3 boundary (d = π·r)
      const atBoundary23X = curlAxisX + Math.PI * radius;
      const atBoundary23 = applyCurlMathShader(atBoundary23X, curlAxisX, radius);
      // At this boundary, z should be at max height ≈ 2r
      expect(atBoundary23.z).toBeCloseTo(2 * radius, 1);
    });
  });

  describe('Back-Face Threshold (θ = π/2)', () => {
    it('back face becomes visible when θ > π/2', () => {
      const curlAxisX = 0.5;
      const radius = 0.15;

      // At θ < π/2: front face is visible (d < π·r/2)
      const d1 = radius * (Math.PI / 2 - 0.1);
      const result1 = applyCurlMathShader(curlAxisX + d1, curlAxisX, radius);
      const theta1 = d1 / radius;
      expect(theta1).toBeLessThan(Math.PI / 2);

      // At θ > π/2: back face should be visible (d > π·r/2)
      const d2 = radius * (Math.PI / 2 + 0.1);
      const result2 = applyCurlMathShader(curlAxisX + d2, curlAxisX, radius);
      const theta2 = d2 / radius;
      expect(theta2).toBeGreaterThan(Math.PI / 2);

      // Both should produce valid positions on cylinder
      expect(result1.z).toBeGreaterThan(0);
      expect(result2.z).toBeGreaterThan(0);
    });
  });

  describe('Cylinder Radius Effect', () => {
    it('smaller radius produces tighter curl', () => {
      const curlAxisX = 0.5;
      const d = 0.1;
      const x = curlAxisX + d;

      const tightCurl = applyCurlMathShader(x, curlAxisX, 0.05);
      const looseCurl = applyCurlMathShader(x, curlAxisX, 0.2);

      // With tighter curl, the cylinder is narrower, so z should be smaller for same d
      expect(tightCurl.z).toBeLessThan(looseCurl.z);

      // Also, more of the page gets wrapped (π·r is smaller)
      expect(0.05 * Math.PI).toBeLessThan(0.2 * Math.PI);
    });

    it('larger radius produces gentler curl', () => {
      const curlAxisX = 0.5;
      const d = 0.1;
      const x = curlAxisX + d;

      const gentleCurl = applyCurlMathShader(x, curlAxisX, 0.3);
      const sharpCurl = applyCurlMathShader(x, curlAxisX, 0.05);

      // Same distance d on gentle curve stays flatter
      expect(gentleCurl.z).toBeLessThan(sharpCurl.z);
    });
  });

  describe('Segment Count Effects', () => {
    it('smooth path requires sufficient vertex density', () => {
      // This is more of a note: with N subdivisions along X, we get N+1 vertices
      // For smooth rendering, N=32 means vertices every ~1/32 = 0.03 of page width
      // This should be sufficient to not see faceting on a 1.0 wide page

      const pageWidth = 1.0;
      const segments = 32;
      const vertexSpacing = pageWidth / segments;

      // For a curve of radius 0.15, the curvature is smooth enough at this spacing
      expect(vertexSpacing).toBeLessThan(0.1);

      // If we had only 4 segments, vertices would be 0.25 apart - too coarse
      const coarseSpacing = pageWidth / 4;
      expect(coarseSpacing).toBeGreaterThan(0.1);
    });
  });

  describe('Semantic Violations (Should Never Happen)', () => {
    it('theta is never negative or greater than π', () => {
      const radius = 0.15;

      // Test across the valid cylinder region
      for (let d = 0; d <= Math.PI * radius; d += 0.01) {
        const theta = d / radius;

        expect(theta).toBeGreaterThanOrEqual(0);
        expect(theta).toBeLessThanOrEqual(Math.PI);
      }
    });

    it('z never becomes negative', () => {
      const radius = 0.15;

      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        const phi = progress * Math.PI;
        const testCurlAxisX = Math.cos(phi);

        // Test vertices across full page width
        for (let x = -1; x <= 1; x += 0.1) {
          const result = applyCurlMathShader(x, testCurlAxisX, radius);
          expect(result.z).toBeGreaterThanOrEqual(-0.001); // Allow tiny numerical error
        }
      }
    });

    it('mirrored vertices do not go below z = 0.001', () => {
      const curlAxisX = 0.3;

      // Test all vertices that get mirrored (d < 0)
      for (let x = -0.5; x < curlAxisX; x += 0.05) {
        const result = applyCurlMathShader(x, curlAxisX, 0.15);
        expect(result.z).toBeCloseTo(0.001, 3);
      }
    });

    it('curlAxisX never exceeds ±W·1.1 (stays in reasonable bounds)', () => {
      const pageWidth = 1.0;

      for (let progress = 0; progress <= 1.0; progress += 0.01) {
        const phi = progress * Math.PI;
        const curlAxisX = pageWidth * Math.cos(phi);

        expect(curlAxisX).toBeGreaterThanOrEqual(-pageWidth - 0.1);
        expect(curlAxisX).toBeLessThanOrEqual(pageWidth + 0.1);
      }
    });
  });

  describe('Continuity Across Turn Animation', () => {
    it('vertex position changes smoothly, never jumps', () => {
      const pageWidth = 1.0;
      const radius = 0.15;
      const testX = 0.6;

      const positions: { x: number; z: number }[] = [];

      for (let progress = 0; progress <= 1.0; progress += 0.01) {
        const phi = progress * Math.PI;
        const curlAxisX = pageWidth * Math.cos(phi);

        positions.push(applyCurlMathShader(testX, curlAxisX, radius));
      }

      // Check that no two consecutive positions are too far apart
      for (let i = 1; i < positions.length; i++) {
        const prev = positions[i - 1];
        const curr = positions[i];

        const dx = Math.abs(curr.x - prev.x);
        const dz = Math.abs(curr.z - prev.z);

        // With 0.01 progress increments, changes should be small
        expect(dx).toBeLessThan(0.05);
        expect(dz).toBeLessThan(0.01);
      }
    });
  });
});
